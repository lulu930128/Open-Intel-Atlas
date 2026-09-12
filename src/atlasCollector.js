import { performance } from "node:perf_hooks";
import { macroNextDue, wakeMacroSchedules } from "./macro/scheduler.js";
import { randomUUID } from "node:crypto";
import { createSourceResult } from "./atlasContracts.js";
import { boundedJson } from "./core/utils.js";
import { processSourceResult } from "./atlasPipeline.js";
import { buildTargetIdentityContext, NEWS_SOURCE } from "./entities/companyNewsRelevance.js";

export function createCollector({ store, registry, http, config, logger = console, clock = () => new Date(), afterPersist }) {
  const active = new Set();
  const lastResults = new Map();
  const nowIso = () => clock().toISOString();

  async function runSource(sourceId, options = {}) {
    const source = registry.get(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    if (active.has(sourceId)) {
      return { source_id: sourceId, status: "skipped", reason: "already_running" };
    }

    const startedAt = nowIso();
    const runId = store.beginSourceRun(source, startedAt, options);
    if (!source.enabled) {
      const result = { source_id: sourceId, run_id: runId, status: "disabled", reason: source.disabledReason };
      lastResults.set(sourceId, result);
      return result;
    }

    active.add(sourceId);
    const started = performance.now();
    let targetExecution = null;
    let targetRunsFinalized = false;
    try {
      const sourceHttp = conditionalHttpForSource(store, http, source.id);
      const sourceContext = { source, http: sourceHttp, config, catchup: options.catchup || null, now: nowIso };
      targetExecution = typeof source.runTarget === "function"
        ? await runTargetedSource({ store, runId, source, context: sourceContext, now: nowIso })
        : null;
      const sourceResult = targetExecution?.result || await source.run(sourceContext);
      if (sourceResult.source_id !== source.id) {
        throw new Error(`Source result mismatch: expected ${source.id}, got ${sourceResult.source_id}`);
      }
      const persisted = processSourceResult(store, runId, sourceResult, nowIso());
      const derivedWarnings = [];
      if (typeof afterPersist === "function") {
        try {
          const derived = afterPersist({ source, sourceResult, persisted });
          if (derived?.status === "deferred") derivedWarnings.push(`company_news_targets_deferred:${derived.missing_or_incomplete_markets.join(",")}`);
        } catch (error) {
          derivedWarnings.push(`derived_target_registry_failed:${String(error?.message || error).slice(0, 240)}`);
        }
      }
      const finishedAt = nowIso();
      if (targetExecution) {
        finalizeTargetRuns(store, targetExecution.outcomes, config.collector, finishedAt);
        targetRunsFinalized = true;
      }
      const result = {
        source_id: sourceId,
        run_id: runId,
        status: persisted.status === "partial" ? "partial" : "success",
        finished_at: finishedAt,
        duration_ms: Math.round(performance.now() - started),
        item_count: persisted.itemCount,
        inserted_count: persisted.insertedCount,
        updated_count: persisted.updatedCount,
        event_count: persisted.eventCount,
        upstream_item_count: sourceResult.counts?.upstream_item_count ?? null,
        processed_item_count: persisted.processedItemCount,
        document_count: sourceResult.counts?.document_count ?? sourceResult.documents?.length ?? 0,
        entity_count: Array.isArray(sourceResult.master_items) ? persisted.entityCount : sourceResult.counts?.entity_count ?? sourceResult.entities?.length ?? 0,
        relation_count: Array.isArray(sourceResult.master_items) ? persisted.relationCount : sourceResult.counts?.relation_count ?? sourceResult.relations?.length ?? 0,
        intentionally_skipped_count: sourceResult.counts?.intentionally_skipped_count ?? 0,
        failed_count: persisted.failedItemCount,
        truncated: Boolean(persisted.completeness?.truncated),
        warnings: [...persisted.warnings, ...derivedWarnings],
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
        notModified: result.not_modified,
        upstreamItemCount: result.upstream_item_count,
        processedItemCount: result.processed_item_count,
        documentCount: result.document_count,
        entityCount: result.entity_count,
        relationCount: result.relation_count,
        intentionallySkippedCount: result.intentionally_skipped_count,
        failedCount: result.failed_count,
        truncated: result.truncated,
        warnings: result.warnings
      });
      lastResults.set(sourceId, result);
      return result;
    } catch (error) {
      const finishedAt = nowIso();
      if (targetExecution && !targetRunsFinalized) {
        finalizeTargetRuns(store, targetExecution.outcomes, config.collector, finishedAt, error);
        targetRunsFinalized = true;
      }
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

async function runTargetedSource({ store, runId, source, context, now }) {
  const targets = store.listDueSourceTargets(source.id, now(), source.targetBatchSize || 10);
  if (targets.length === 0) {
    return {
      result: createSourceResult({
        source,
        startedAt: now(),
        finishedAt: now(),
        counts: { upstream_item_count: 0, processed_item_count: 0 },
        completeness: { status: "complete" },
        warnings: ["no_targets_due"]
      }),
      outcomes: []
    };
  }

  const results = [];
  const outcomes = [];
  for (const target of targets) {
    const targetStartedAt = now();
    const targetRunId = store.beginSourceTargetRun(runId, target, targetStartedAt);
    const started = performance.now();
    try {
      const identityContext = source.id === NEWS_SOURCE ? buildTargetIdentityContext(store, target) : undefined;
      const result = await source.runTarget({ ...context, target, identityContext });
      if (result.source_id !== source.id) throw new Error(`Source target result mismatch: expected ${source.id}, got ${result.source_id}`);
      results.push({ target, result });
      const hasMatch = result.documents?.some(document => source.id !== NEWS_SOURCE ||
        document.raw_metadata?.target_relevance?.[`${target.identifier.authority}:${target.identifier.value}`]?.status === "matched");
      const matchWarnings = source.id === NEWS_SOURCE && result.documents?.length && !hasMatch
        ? [identityContext ? "NO_ENTITY_MATCH" : "IDENTITY_UNAVAILABLE"] : [];
      outcomes.push({
        runId: targetRunId,
        target,
        startedAt: targetStartedAt,
        status: result.status,
        finishedAt: result.finished_at || now(),
        durationMs: Math.round(performance.now() - started),
        httpStatus: result.fetches?.find((fetch) => fetch.http_status)?.http_status ?? null,
        itemCount: result.counts?.processed_item_count ?? result.documents?.length ?? 0,
        matchAt: hasMatch ? result.finished_at || now() : null,
        warnings: [...(result.warnings || []), ...matchWarnings]
      });
    } catch (error) {
      outcomes.push({
        runId: targetRunId,
        target,
        startedAt: targetStartedAt,
        status: error?.status === 429 ? "rate_limited" : "failed",
        finishedAt: now(),
        durationMs: Math.round(performance.now() - started),
        httpStatus: error?.status ?? null,
        itemCount: 0,
        errorType: error?.name || "Error",
        errorMessage: String(error?.message || error),
        warnings: []
      });
    }
  }
  return { result: combineTargetResults(source, results, outcomes, now()), outcomes };
}

function combineTargetResults(source, results, outcomes, finishedAt) {
  const documents = [];
  const fetches = [];
  const warnings = [];
  let upstreamItemCount = 0;
  let upstreamUnknown = false;
  let processedItemCount = 0;
  let intentionallySkippedCount = 0;
  let failedItemCount = 0;

  for (const { target, result } of results) {
    const fetchOffset = fetches.length;
    fetches.push(...result.fetches.map((fetch) => ({
      url: fetch.request_url,
      status: fetch.http_status,
      contentType: fetch.content_type,
      etag: fetch.etag,
      lastModified: fetch.last_modified,
      rawPayload: fetch.payload_text || "",
      payloadTruncated: Boolean(fetch.payload_truncated)
    })));
    for (const document of result.documents) {
      const metadata = {
        ...(document.raw_metadata || {}),
        source_target_id: target.id,
        raw_fetch_index: fetchOffset + Math.max(0, Number(document.raw_metadata?.raw_fetch_index || 0))
      };
      documents.push({ ...document, raw_metadata: metadata, raw_metadata_json: boundedJson(metadata, 32_000) });
    }
    if (result.counts.upstream_item_count === null) upstreamUnknown = true;
    else upstreamItemCount += result.counts.upstream_item_count;
    processedItemCount += result.counts.processed_item_count;
    intentionallySkippedCount += result.counts.intentionally_skipped_count;
    failedItemCount += result.counts.failed_count;
    warnings.push(...result.warnings.map((warning) => `${target.id}:${warning}`));
  }
  const targetFailures = outcomes.filter((outcome) => !["success", "partial"].includes(outcome.status));
  warnings.push(...targetFailures.map((outcome) => `${outcome.target.id}:target_${outcome.status}`));
  const partial = targetFailures.length > 0 || results.some(({ result }) => result.status === "partial");
  return createSourceResult({
    source,
    fetches,
    documents,
    startedAt: outcomes[0]?.startedAt || results[0]?.result.started_at || finishedAt,
    finishedAt,
    status: partial ? "partial" : "success",
    counts: {
      upstream_item_count: upstreamUnknown ? null : upstreamItemCount,
      processed_item_count: processedItemCount,
      intentionally_skipped_count: intentionallySkippedCount,
      failed_count: failedItemCount
    },
    completeness: { status: partial ? "partial" : upstreamUnknown ? "unknown" : "complete" },
    warnings
  });
}

function finalizeTargetRuns(store, outcomes, config, finishedAt, persistenceError = null) {
  for (const outcome of outcomes) {
    const failedByPersistence = Boolean(persistenceError) && ["success", "partial"].includes(outcome.status);
    const status = failedByPersistence ? "failed" : outcome.status;
    const success = ["success", "partial"].includes(status);
    const failures = success ? 0 : Number(outcome.target.consecutive_failures || 0) + 1;
    const base = Math.max(60_000, Number(outcome.target.cadence_ms || 0));
    const delayMs = success ? base : Math.min(config.maxBackoffMs, base * 2 ** Math.min(10, Math.max(0, failures - 1)));
    const completedAt = outcome.finishedAt || finishedAt;
    store.finishSourceTargetRun(outcome.runId, {
      ...outcome,
      status,
      finishedAt: completedAt,
      nextDueAt: new Date(Date.parse(completedAt) + delayMs).toISOString(),
      consecutiveFailures: failures,
      backoffUntil: success ? null : new Date(Date.parse(completedAt) + delayMs).toISOString(),
      successAt: success ? completedAt : null,
      matchAt: success ? outcome.matchAt : null,
      errorType: failedByPersistence ? persistenceError?.name || "PersistenceError" : outcome.errorType,
      errorMessage: failedByPersistence ? String(persistenceError?.message || persistenceError) : outcome.errorMessage
    });
  }
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
    getBytes(url, options = {}) {
      return http.getBytes(url, withConditionalHeaders(url, options));
    },
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
    wakeMacroSchedules(store, registry, tickAt);
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
    if (source.macroGroup && ["success", "partial"].includes(result.status)) {
      outcome.nextDueAt = macroNextDue(store, source.macroGroup, finishedAt, outcome.nextDueAt);
    }
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
