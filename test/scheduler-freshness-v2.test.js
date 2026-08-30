import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createCollector, buildCatchupWindow, computeScheduleOutcome, startCollectorScheduler } from "../src/atlasCollector.js";
import { sourceFetchResult } from "../src/atlasContracts.js";
import { createHttpClient } from "../src/atlasHttp.js";
import { queryState } from "../src/atlasApi.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { loadConfig } from "../src/config.js";
import { createIntelDocument } from "../src/documents/normalize.js";

test("schema v1 database upgrades to v5 without losing source runs", () => {
  withTempDatabase((dbPath) => {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_type TEXT NOT NULL,
        source_class TEXT NOT NULL, authority_class TEXT NOT NULL, document_type TEXT NOT NULL,
        homepage TEXT, docs_url TEXT, attribution TEXT, policy_note TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, disabled_reason TEXT,
        domains_json TEXT NOT NULL, languages_json TEXT NOT NULL, countries_json TEXT NOT NULL,
        cadence_ms INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE source_runs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL, http_status INTEGER, item_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0,
        error_type TEXT, error_message TEXT, duration_ms INTEGER,
        FOREIGN KEY (source_id) REFERENCES sources(id)
      );
      INSERT INTO schema_migrations VALUES (1, '2026-08-22T00:00:00.000Z');
      INSERT INTO sources VALUES (
        'legacy-source','Legacy','test','publisher','professional_media','news',NULL,NULL,NULL,NULL,
        1,NULL,'["politics"]','["en"]','[]',60000,1000,
        '2026-08-22T00:00:00.000Z','2026-08-22T00:00:00.000Z'
      );
      INSERT INTO source_runs (
        id,source_id,started_at,finished_at,status,item_count,inserted_count,updated_count
      ) VALUES ('run:legacy','legacy-source','2026-08-22T00:00:00.000Z','2026-08-22T00:00:01.000Z','success',1,1,0);
    `);
    legacy.close();

    const store = openAtlasStore(dbPath);
    assert.equal(store.getStats().schema_version, 5);
    assert.equal(store.getStats().source_runs, 1);
    assert.equal(store.db.prepare("SELECT status FROM source_runs WHERE id = ?").get("run:legacy").status, "success");
    const sourceColumns = store.db.prepare("PRAGMA table_info(sources)").all().map((column) => column.name);
    const runColumns = store.db.prepare("PRAGMA table_info(source_runs)").all().map((column) => column.name);
    const storyColumns = store.db.prepare("PRAGMA table_info(stories)").all().map((column) => column.name);
    assert.ok(sourceColumns.includes("catchup_mode"));
    assert.ok(runColumns.includes("scheduler_owner"));
    assert.ok(storyColumns.includes("version"));
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version = 3").get().count, 1);
    assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_updates'").get());
    store.close();
  });
});

test("schedule lease survives restart boundaries and expired work backs off", () => {
  withTempStore((store) => {
    const source = fixtureSource("lease-source", "politics", { cadenceMs: 60_000 });
    store.registerSources([source]);
    const now = "2026-08-23T00:00:00.000Z";
    store.initializeScheduleState([source], { now, collectOnStart: true });
    assert.equal(store.listDueSchedules(now).length, 1);

    const claimed = store.claimSchedule(source.id, "owner:a", now, "2026-08-23T00:00:30.000Z");
    assert.equal(claimed.source_id, source.id);
    assert.equal(store.claimSchedule(source.id, "owner:b", now, "2026-08-23T00:00:30.000Z"), null);
    const runId = store.beginSourceRun(source, now, {
      triggerKind: "scheduler",
      schedulerOwner: "owner:a",
      scheduledForAt: now
    });

    assert.deepEqual(store.recoverExpiredSchedules("2026-08-23T00:00:31.000Z"), [source.id]);
    assert.equal(store.db.prepare("SELECT status FROM source_runs WHERE id = ?").get(runId).status, "failed");
    const recovered = store.getScheduleState(source.id);
    assert.equal(recovered.lease_owner, null);
    assert.equal(recovered.consecutive_failures, 1);
    assert.equal(recovered.next_due_at, "2026-08-23T00:01:31.000Z");
    assert.equal(store.listDueSchedules("2026-08-23T00:01:00.000Z").length, 0);
  });
});

test("catch-up windows are bounded and latest-only gaps remain explicit", () => {
  const now = "2026-08-23T12:00:00.000Z";
  const schedule = {
    last_success_at: "2026-08-20T12:00:00.000Z",
    cadence_ms: 600_000,
    consecutive_failures: 0
  };
  const window = buildCatchupWindow(
    { cadenceMs: 600_000, catchupMode: "window" },
    schedule,
    now,
    24 * 60 * 60 * 1000
  );
  assert.equal(window.from, "2026-08-22T12:00:00.000Z");
  assert.equal(window.gapStatus, "recoverable_partial");

  const latestOnly = buildCatchupWindow(
    { cadenceMs: 600_000, catchupMode: "latest_only" },
    schedule,
    now,
    24 * 60 * 60 * 1000
  );
  assert.equal(latestOnly.gapStatus, "unrecoverable");

  const failed = computeScheduleOutcome({
    result: { status: "failed" },
    schedule,
    source: { cadenceMs: 600_000 },
    catchup: latestOnly,
    finishedAt: now,
    config: { maxBackoffMs: 86_400_000, jitterRatio: 0, pollMs: 5000 },
    random: () => 0
  });
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.nextDueAt, "2026-08-23T12:10:00.000Z");

  const recovered = computeScheduleOutcome({
    result: { status: "success" },
    schedule: { ...schedule, consecutive_failures: 3 },
    source: { cadenceMs: 600_000 },
    catchup: window,
    finishedAt: now,
    config: { maxBackoffMs: 86_400_000, jitterRatio: 0, pollMs: 5000 },
    random: () => 0
  });
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.backoffUntil, null);
});

test("window-capable adapters pass bounded dates to provider APIs", async () => {
  const config = loadConfig({ ...process.env, ATLAS_AUTO_COLLECT: "false" });
  const registry = buildSourceRegistry(config);
  const calls = new Map();
  const http = {
    async getJson(input) {
      const url = new URL(input);
      calls.set(url.hostname, url);
      return {
        url: url.toString(),
        status: 200,
        contentType: "application/json",
        etag: null,
        lastModified: null,
        rawPayload: "{}",
        payloadTruncated: false,
        data: url.hostname === "earthquake.usgs.gov" ? { features: [] } : url.hostname === "www.federalregister.gov" ? { results: [] } : { articles: [] }
      };
    }
  };
  const catchup = { from: "2026-08-22T12:34:56.000Z", to: "2026-08-23T12:34:56.000Z" };
  for (const sourceId of ["gdelt-doc", "federal-register", "usgs-earthquake"]) {
    const source = registry.get(sourceId);
    await source.run({ source, http, config, catchup, now: () => "2026-08-23T12:34:56.000Z" });
  }

  const gdelt = calls.get("api.gdeltproject.org");
  assert.equal(gdelt.searchParams.get("startdatetime"), "20260822123456");
  assert.equal(gdelt.searchParams.get("enddatetime"), "20260823123456");
  const federal = calls.get("www.federalregister.gov");
  assert.equal(federal.searchParams.get("conditions[publication_date][gte]"), "2026-08-22");
  assert.equal(federal.searchParams.get("conditions[publication_date][lte]"), "2026-08-23");
  const usgs = calls.get("earthquake.usgs.gov");
  assert.equal(usgs.pathname, "/fdsnws/event/1/query");
  assert.equal(usgs.searchParams.get("starttime"), catchup.from);
  assert.equal(usgs.searchParams.get("limit"), "200");
});

test("ETag validator produces a successful 304 without duplicate documents", async (t) => {
  const requests = [];
  const fixtureServer = createServer((request, response) => {
    requests.push(request.headers["if-none-match"] || null);
    if (request.headers["if-none-match"] === '"fixture-v1"') {
      response.writeHead(304, { ETag: '"fixture-v1"' });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", ETag: '"fixture-v1"' });
    response.end(JSON.stringify({ title: "Conditional fixture" }));
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => fixtureServer.close(resolve)));
  const port = fixtureServer.address().port;

  await withTempStoreAsync(async (store) => {
    const config = loadConfig({ ...process.env, ATLAS_AUTO_COLLECT: "false" });
    const source = fixtureSource("etag-source", "technology", {
      async run({ source: definition, http, now }) {
        const startedAt = now();
        const fetch = await http.getJson(`http://127.0.0.1:${port}/feed`, { retries: 0 });
        const fetchedAt = now();
        const documents = fetch.notModified
          ? []
          : [
              createIntelDocument(
                definition,
                {
                  externalId: "conditional-1",
                  title: fetch.data.title,
                  url: `http://127.0.0.1:${port}/item/1`,
                  publishedAt: "2026-08-23T00:00:00Z"
                },
                fetchedAt
              )
            ];
        return sourceFetchResult(definition, fetch, documents, startedAt, fetchedAt);
      }
    });
    const registry = fixtureRegistry([source]);
    store.registerSources(registry.all);
    const collector = createCollector({ store, registry, http: createHttpClient(config.http), config });

    const first = await collector.runSource(source.id);
    const second = await collector.runSource(source.id);
    assert.equal(first.inserted_count, 1);
    assert.equal(second.status, "success");
    assert.equal(second.not_modified, true);
    assert.equal(store.getStats().documents, 1);
    assert.deepEqual(requests, [null, '"fixture-v1"']);
  });
});

test("freshness coverage is scoped by domain", () => {
  withTempStore((store) => {
    const politics = fixtureSource("politics-source", "politics");
    const hazards = fixtureSource("hazards-source", "hazards");
    store.registerSources([politics, hazards]);
    const now = new Date().toISOString();
    for (const [source, status] of [[politics, "failed"], [hazards, "success"]]) {
      const runId = store.beginSourceRun(source, now);
      store.finishSourceRun(runId, {
        finishedAt: now,
        status,
        errorType: status === "failed" ? "FixtureError" : null,
        errorMessage: status === "failed" ? "fixture failure" : null
      });
    }

    const politicsState = queryState({ store }, { domain: "politics" });
    const hazardsState = queryState({ store }, { domain: "hazards" });
    assert.equal(politicsState.coverage.status, "missing");
    assert.equal(politicsState.coverage.failed_sources, 1);
    assert.equal(hazardsState.coverage.status, "full");
    assert.equal(hazardsState.coverage.failed_sources, 0);
  });
});

test("persistent scheduler keeps next_due_at across a runtime restart", async () => {
  await withTempStoreAsync(async (store) => {
    let runCount = 0;
    let resolveFirstRun;
    const firstRun = new Promise((resolve) => {
      resolveFirstRun = resolve;
    });
    const source = fixtureSource("persistent-source", "hazards", {
      async run({ source: definition, now }) {
        runCount += 1;
        resolveFirstRun();
        const timestamp = now();
        return sourceFetchResult(definition, [], [], timestamp, timestamp);
      }
    });
    const registry = fixtureRegistry([source]);
    const config = loadConfig({ ...process.env, ATLAS_AUTO_COLLECT: "true", ATLAS_COLLECT_ON_START: "true" });
    config.collector.pollMs = 25;
    config.collector.leaseMs = 1000;
    config.collector.jitterRatio = 0;
    store.registerSources(registry.all);
    const collector = createCollector({ store, registry, http: createHttpClient(config.http), config });
    const firstScheduler = startCollectorScheduler({ collector, registry, store, config });
    await withTimeout(firstRun, 2000, "scheduler did not run due source");
    await firstScheduler.stop();

    const persisted = store.getScheduleState(source.id);
    assert.equal(runCount, 1);
    assert.equal(persisted.lease_owner, null);
    assert.ok(Date.parse(persisted.next_due_at) > Date.parse(persisted.last_success_at));
    assert.equal(store.db.prepare("SELECT trigger_kind FROM source_runs ORDER BY started_at DESC LIMIT 1").get().trigger_kind, "scheduler");

    config.collector.collectOnStart = false;
    const secondScheduler = startCollectorScheduler({ collector, registry, store, config });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await secondScheduler.stop();
    assert.equal(runCount, 1, "restart must honor persisted next_due_at instead of collecting immediately");
  });
});

function fixtureSource(id, domain, overrides = {}) {
  const source = {
    id,
    name: id,
    providerType: "test",
    sourceClass: "publisher",
    authorityClass: "professional_media",
    documentType: "news",
    catchupMode: "latest_only",
    domains: [domain],
    languages: ["en"],
    countries: [],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Fixture",
    policyNote: "Fixture only",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    cadence: "1m",
    async run() {
      throw new Error("fixture source run not configured");
    },
    ...overrides
  };
  return source;
}

function fixtureRegistry(sources) {
  return {
    all: sources,
    enabled: sources.filter((source) => source.enabled),
    get(sourceId) {
      return sources.find((source) => source.id === sourceId) || null;
    }
  };
}

function withTempDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-scheduler-test-"));
  try {
    return callback(join(directory, "atlas.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withTempStore(callback) {
  return withTempDatabase((dbPath) => {
    const store = openAtlasStore(dbPath);
    try {
      return callback(store);
    } finally {
      store.close();
    }
  });
}

async function withTempStoreAsync(callback) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-scheduler-test-"));
  const store = openAtlasStore(join(directory, "atlas.sqlite"));
  try {
    return await callback(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
