import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { processSourceResult } from "./atlasPipeline.js";

export function createCollector({ store, registry, http, config, logger = console }) {
  const active = new Set();
  const lastResults = new Map();

  async function runSource(sourceId, options = {}) {
    const source = registry.get(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    if (active.has(sourceId)) {
      return { source_id: sourceId, status: "skipped", reason: "already_running" };
    }

    const startedAt = new Date().toISOString();
    const runId = store.beginSourceRun(source, startedAt, options);
    if (!source.enabled) {
      const result = { source_id: sourceId, run_id: runId, status: "disabled", reason: source.disabledReason };
      lastResults.set(sourceId, result);
      return result;
    }

    active.add(sourceId);
    const started = performance.now();
    try {
      const sourceHttp = conditionalHttpForSource(store, http, source.id);
      const sourceResult = await source.run({
        source,
        http: sourceHttp,
        config,
        catchup: options.catchup || null,
        now: () => new Date().toISOString()
      });
      if (sourceResult.source_id !== source.id) {
        throw new Error(`Source result mismatch: expected ${source.id}, got ${sourceResult.source_id}`);
      }
      const persisted = processSourceResult(store, runId, sourceResult, new Date().toISOString());
      const finishedAt = new Date().toISOString();
      const result = {
        source_id: sourceId,
        run_id: runId,
        status: sourceResult.status === "partial" ? "partial" : "success",
        finished_at: finishedAt,
        duration_ms: Math.round(performance.now() - started),
        item_count: persisted.itemCount,
        inserted_count: persisted.insertedCount,
        updated_count: persisted.updatedCount,
        event_count: persisted.eventCount,
        http_status: persisted.httpStatus,
        not_modified:
          sourceResult.fetches.length > 0 && sourceResult.fetches.every((fetch) => Number(fetch.http_status) === 304)
      };
      store.finishSourceRun(runId, {
        finishedAt,
        status: result.status,
        httpStatus: result.http_status,
        itemCount: result.item_count,
        insertedCount: result.inserted_count,
        updatedCount: result.updated_count,
        durationMs: result.duration_ms,
        notModified: result.not_modified
      });
      lastResults.set(sourceId, result);
      return result;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const status = error?.status === 429 ? "rate_limited" : "failed";
      const result = {
        source_id: sourceId,
        run_id: runId,
        status,
        finished_at: finishedAt,
        duration_ms: Math.round(performance.now() - started),
        error_type: error?.name || "Error",
        error_message: String(error?.message || error).slice(0, 2000),
        http_status: error?.status ?? null
      };
      store.finishSourceRun(runId, {
        finishedAt,
        status,
        httpStatus: result.http_status,
        errorType: result.error_type,
        errorMessage: result.error_message,
        durationMs: result.duration_ms
      });
      lastResults.set(sourceId, result);
      logger.warn?.(`[atlas] source ${sourceId} ${status}: ${result.error_message}`);
      return result;
    } finally {
      active.delete(sourceId);
    }
  }

  async function runCycle(sourceIds = registry.enabled.map((source) => source.id)) {
    const ids = [...new Set(sourceIds)].filter(Boolean);
    const results = [];
    let cursor = 0;
    const workerCount = Math.min(config.collector.concurrency, ids.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < ids.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await runSource(ids[index]);
        }
      })
    );

    return {
      started_sources: ids.length,
      success: results.filter((result) => result?.status === "success").length,
      partial: results.filter((result) => result?.status === "partial").length,
      failed: results.filter((result) => ["failed", "rate_limited"].includes(result?.status)).length,
      results
    };
  }

  return {
    runSource,
    runCycle,
    status() {
      return {
        active_sources: [...active],
        last_results: Object.fromEntries(lastResults)
      };
    }
  };
}

function conditionalHttpForSource(store, http, sourceId) {
  const withConditionalHeaders = (url, options = {}) => {
    if (options.conditional === false) return options;
    const validator = store.getHttpValidator(sourceId, url);
    if (!validator) return options;
    return {
      ...options,
      headers: {
        ...(validator.etag ? { "If-None-Match": validator.etag } : {}),
        ...(validator.lastModified ? { "If-Modified-Since": validator.lastModified } : {}),
        ...(options.headers || {})
      }
    };
  };
  return {
    getJson(url, options = {}) {
      return http.getJson(url, withConditionalHeaders(url, options));
    },
    getText(url, options = {}) {
      return http.getText(url, withConditionalHeaders(url, options));
    }
  };
}

export function startCollectorScheduler({
  collector,
  registry,
  store,
  config,
  logger = console,
  clock = () => new Date(),
  random = Math.random
}) {
  const owner = `scheduler:${randomUUID()}`;
  let timer = null;
  let stopped = false;
  let inFlight = Promise.resolve();
  let lastTickAt = null;
  let lastDueTickAt = null;
  let lastTickResults = [];
  const nowIso = () => clock().toISOString();

  store.initializeScheduleState(registry.all, {
    now: nowIso(),
    collectOnStart: config.collector.schedulerEnabled && config.collector.collectOnStart
  });
  store.recoverExpiredSchedules(nowIso());

  if (!config.collector.schedulerEnabled) {
    return {
      enabled: false,
      owner: null,
      status: () => ({ enabled: false, schedules: store.listScheduleStates() }),
      requestRun: () => ({ queued_sources: 0, reason: "scheduler_disabled" }),
      async stop() {}
    };
  }

  function arm(delayMs) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      inFlight = tick().catch((error) => logger.error?.("[atlas] scheduler tick failed", error));
    }, Math.max(0, delayMs));
    timer.unref();
  }

  async function tick() {
    if (stopped) return;
    const tickAt = nowIso();
    lastTickAt = tickAt;
    store.recoverExpiredSchedules(tickAt);
    const due = store.listDueSchedules(tickAt, Math.max(config.collector.concurrency * 4, 20));
    if (due.length > 0) lastDueTickAt = tickAt;
    const results = new Array(due.length);
    let cursor = 0;
    const workerCount = Math.min(config.collector.concurrency, due.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (!stopped && cursor < due.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await runScheduledSource(due[index], tickAt);
        }
      })
    );
    if (due.length > 0) lastTickResults = results.filter(Boolean);
    if (!stopped) arm(config.collector.pollMs);
  }

  async function runScheduledSource(schedule, tickAt) {
    const source = registry.get(schedule.source_id);
    if (!source?.enabled) return { source_id: schedule.source_id, status: "disabled" };
    const leaseMs = Math.max(config.collector.leaseMs, Number(source.timeoutMs || 0) * 4);
    const leaseExpiresAt = new Date(Date.parse(tickAt) + leaseMs).toISOString();
    const claimed = store.claimSchedule(source.id, owner, tickAt, leaseExpiresAt);
    if (!claimed) return { source_id: source.id, status: "not_claimed" };

    const catchup = buildCatchupWindow(source, claimed, tickAt, config.collector.maxCatchupMs);
    let result;
    try {
      result = await collector.runSource(source.id, {
        triggerKind: catchup.gapStatus === "none" ? "scheduler" : "catchup",
        schedulerOwner: owner,
        scheduledForAt: claimed.next_due_at,
        catchupMode: source.catchupMode,
        catchupFrom: catchup.from,
        catchupTo: catchup.to,
        gapStatus: catchup.gapStatus,
        catchup
      });
    } catch (error) {
      result = { source_id: source.id, status: "failed", error_message: String(error?.message || error) };
    }

    const finishedAt = result.finished_at || nowIso();
    const outcome = computeScheduleOutcome({
      result,
      schedule: claimed,
      source,
      catchup,
      finishedAt,
      config: config.collector,
      random
    });
    store.completeSchedule(source.id, owner, outcome);
    return { ...result, next_due_at: outcome.nextDueAt, gap_status: catchup.gapStatus };
  }

  arm(config.collector.collectOnStart ? 250 : config.collector.pollMs);

  return {
    enabled: true,
    owner,
    status() {
      return {
        enabled: true,
        owner,
        last_tick_at: lastTickAt,
        last_due_tick_at: lastDueTickAt,
        last_tick_results: lastTickResults,
        schedules: store.listScheduleStates()
      };
    },
    requestRun(sourceIds = registry.enabled.map((source) => source.id)) {
      const ids = [...new Set(sourceIds)].filter((sourceId) => registry.get(sourceId)?.enabled);
      const queued = store.markSchedulesDue(ids, nowIso());
      if (queued > 0) arm(0);
      return { queued_sources: queued, source_ids: ids };
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      store.releaseScheduleLeases(owner, nowIso());
    }
  };
}

export function buildCatchupWindow(source, schedule, now, maxCatchupMs) {
  const nowMs = Date.parse(now);
  const lastSuccessMs = Date.parse(schedule.last_success_at || "");
  const cadenceMs = Math.max(60_000, Number(source.cadenceMs || schedule.cadence_ms || 0));
  const overdue = Number.isFinite(lastSuccessMs) && nowMs - lastSuccessMs > cadenceMs * 2;
  const lowerBoundMs = nowMs - maxCatchupMs;
  const mode = source.catchupMode || "latest_only";

  if (mode === "window") {
    const requestedFromMs = Number.isFinite(lastSuccessMs) ? lastSuccessMs : lowerBoundMs;
    const fromMs = Math.max(requestedFromMs, lowerBoundMs);
    return {
      mode,
      from: new Date(fromMs).toISOString(),
      to: now,
      gapStatus: requestedFromMs < lowerBoundMs ? "recoverable_partial" : overdue ? "bounded" : "none",
      missedIntervals: Number.isFinite(lastSuccessMs) ? Math.max(0, Math.floor((nowMs - lastSuccessMs) / cadenceMs) - 1) : 0
    };
  }

  const gapStatus = overdue ? (mode === "provider_history" ? "bounded" : "unrecoverable") : "none";
  return {
    mode,
    from: Number.isFinite(lastSuccessMs) && gapStatus !== "none" ? new Date(Math.max(lastSuccessMs, lowerBoundMs)).toISOString() : null,
    to: gapStatus !== "none" ? now : null,
    gapStatus,
    missedIntervals: Number.isFinite(lastSuccessMs) ? Math.max(0, Math.floor((nowMs - lastSuccessMs) / cadenceMs) - 1) : 0
  };
}

export function computeScheduleOutcome({ result, schedule, source, catchup, finishedAt, config, random = Math.random }) {
  const success = ["success", "partial"].includes(result.status);
  const skipped = ["skipped", "not_claimed"].includes(result.status);
  const previousFailures = Number(schedule.consecutive_failures || 0);
  let failures = success ? 0 : skipped ? previousFailures : previousFailures + 1;
  let delayMs;
  let backoffUntil = null;

  if (success) {
    delayMs = withPositiveJitter(Math.max(60_000, Number(source.cadenceMs || schedule.cadence_ms)), config.jitterRatio, random);
  } else if (skipped) {
    delayMs = Math.max(1000, Number(config.pollMs || 5000));
  } else {
    const base = Math.max(60_000, Number(source.cadenceMs || schedule.cadence_ms));
    const exponential = Math.min(config.maxBackoffMs, base * 2 ** Math.min(10, Math.max(0, failures - 1)));
    delayMs = withPositiveJitter(exponential, config.jitterRatio, random);
    backoffUntil = new Date(Date.parse(finishedAt) + delayMs).toISOString();
  }

  return {
    nextDueAt: new Date(Date.parse(finishedAt) + delayMs).toISOString(),
    consecutiveFailures: failures,
    backoffUntil,
    attemptedAt: finishedAt,
    successAt: success ? finishedAt : null,
    status: result.status,
    gapStatus: catchup.gapStatus,
    catchupFrom: catchup.from,
    catchupTo: catchup.to
  };
}

function withPositiveJitter(milliseconds, ratio, random) {
  const boundedRatio = Math.max(0, Math.min(0.25, Number(ratio || 0)));
  return Math.round(milliseconds * (1 + random() * boundedRatio));
}
