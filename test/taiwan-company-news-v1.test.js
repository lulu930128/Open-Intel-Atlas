import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCollector } from "../src/atlasCollector.js";
import { createSourceResult } from "../src/atlasContracts.js";
import { processSourceResult } from "../src/atlasPipeline.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { loadConfig } from "../src/config.js";
import { createIntelDocument } from "../src/documents/normalize.js";
import { fetchYahooTwStockNewsTarget } from "../src/sources/finance/taiwanCompanyNews.js";
import { buildTargetIdentityContext, classifyTargetRelevance, relevanceMetadata } from "../src/entities/companyNewsRelevance.js";
import { planCompanyNewsRemediation, applyCompanyNewsRemediation } from "../src/entities/remediateCompanyNews.js";
import { mergeDocumentMetadata } from "../src/atlasStore.js";

const NOW = "2026-09-06T10:00:00.000Z";

test("content relevance rejects feed scope, bare numeric collisions and unavailable identity", () => {
  const identity = { identifier: { namespace: "ticker", authority: "TWSE", value: "2330" }, names: ["台積電", "TSMC"] };
  assert.equal(classifyTargetRelevance({ title: "台生材(6649) 營收公告" }, identity).status, "not_matched");
  assert.equal(classifyTargetRelevance({ title: "營收 2330 萬元、12330、TSMCX" }, identity).status, "not_matched");
  assert.equal(classifyTargetRelevance({ title: "台積電 新聞" }, null).status, "identity_unavailable");
  for (const title of ["台積電法說", "台積電（2330）", "股票代號:2330", "TSMC earnings"]) {
    assert.equal(classifyTargetRelevance({ title }, identity).status, "matched");
  }
});

test("canonical unique two-character Chinese aliases remain usable", () => {
  const security = { id: "security", entity_type: "security", canonical_name: "鴻海證券" };
  const company = { id: "company", canonical_name: "鴻海精密工業股份有限公司" };
  const store = { findEntityByIdentifier: () => security, findCompanyForSecurity: () => company,
    findEntitiesByExactName: name => name === "鴻海" ? [company] : [company, { id: "another-company" }],
    db: { prepare: () => ({ all: () => [{ alias: "鴻海" }, { alias: "台灣" }] }) } };
  const identity = buildTargetIdentityContext(store, { identifier: { authority: "TWSE", value: "2317" } });
  assert.ok(identity.names.includes("鴻海")); assert.ok(!identity.names.includes("台灣"));
  assert.equal(classifyTargetRelevance({ title: "鴻海8月營收創同期高" }, identity).status, "matched");
});

test("target retraction preserves another target and another evidence owner", () => {
  const target = { identifier: { namespace: "ticker", authority: "TWSE", scope: "TWSE", value: "2330" } };
  const legacy = { identifier: target.identifier, role: "mentioned", confidence: 1 };
  const otherTarget = { ...legacy, identifier: { ...legacy.identifier, value: "2317" } };
  const official = { ...legacy, provenance: { source_id: "official-source" } };
  const result = mergeDocumentMetadata({ entity_hints: [legacy, otherTarget, official], discovery_targets: ["TWSE:2330", "TWSE:2317"] },
    relevanceMetadata({ title: "台生材(6649)" }, target, { identifier: target.identifier, names: ["台積電"] }), "yahoo-tw-stock-news");
  assert.deepEqual(result.entity_hints, [otherTarget, official]);
  assert.deepEqual(result.discovery_targets, ["TWSE:2330", "TWSE:2317"]);
});

test("historical repair retracts false mentions atomically, preserves documents and is idempotent", () => {
  const store = openAtlasStore(":memory:");
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const registry = buildSourceRegistry(config);
  store.registerSources(registry.all, NOW); store.registerSourceTargets(registry.all, NOW);
  seedMaster(store, registry.get("twse-company-master"), "TWSE", ["2330"]);
  const source = registry.get("yahoo-tw-stock-news");
  const target = source.targets[0];
  const runId = store.beginSourceRun(source, NOW);
  const documents = ["台生材(6649) 營收公告", "測試公司 2330（2330）法說"].map((title, i) => createIntelDocument(source, {
    title, canonicalUrl: `https://tw.stock.yahoo.com/news/repair-${i}`, publishedAt: NOW,
    rawMetadata: { event_eligible: false, discovery_targets: ["TWSE:2330"],
      entity_hints: [{ role: "mentioned", confidence: 1, identifier: target.identifier }] }
  }, NOW));
  processSourceResult(store, runId, createSourceResult({ source, documents, startedAt: NOW, finishedAt: NOW }), NOW);
  store.db.prepare("UPDATE source_targets SET last_match_at = ? WHERE source_id = ?").run(NOW, source.id);
  try {
    const plan = planCompanyNewsRemediation(store);
    assert.equal(plan.changes.length, 2);
    const original = store.replaceDocumentEntityMentions;
    store.replaceDocumentEntityMentions = () => { throw new Error("injected failure"); };
    assert.throws(() => applyCompanyNewsRemediation(store, plan), /injected failure/);
    assert.deepEqual(planCompanyNewsRemediation(store), plan, "outer transaction rolls back metadata and resolution runs");
    store.replaceDocumentEntityMentions = original;
    applyCompanyNewsRemediation(store, plan);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM documents").get().count, 2);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM document_entity_mentions WHERE document_id = ?").get(documents[0].id).count, 0);
    const positive = store.db.prepare("SELECT method, confidence FROM document_entity_mentions WHERE document_id = ?").get(documents[1].id);
    assert.equal(positive.method, "content_identity_match"); assert.equal(positive.confidence, 0.9);
    assert.equal(planCompanyNewsRemediation(store).changes.length, 0);
    assert.ok(store.listSourceTargets(source.id).every(target => target.last_match_at === null));
  } finally { store.close(); }
});

test("successful unrelated feed updates fetch success but never target match", async () => {
  const store = openAtlasStore(":memory:");
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const registry = buildSourceRegistry(config);
  store.registerSources(registry.all, NOW); store.registerSourceTargets(registry.all, NOW);
  seedMaster(store, registry.get("twse-company-master"), "TWSE", ["2330"]);
  const collector = createCollector({ store, registry, config, clock: () => new Date(NOW),
    http: { getText: async () => feedFetch("6649", "https://tw.stock.yahoo.com/news/unrelated") } });
  try {
    await collector.runSource("yahoo-tw-stock-news");
    const target = store.listSourceTargets("yahoo-tw-stock-news").find(target => target.identifier.value === "2330");
    assert.equal(target.last_success_at, NOW); assert.equal(target.last_match_at, null);
    const run = store.db.prepare("SELECT warnings_json FROM source_target_runs WHERE source_target_id = ?").get(target.id);
    assert.ok(JSON.parse(run.warnings_json).includes("NO_ENTITY_MATCH"));
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM document_entity_mentions").get().count, 0);
  } finally { store.close(); }
});

test("Yahoo company news is fail-closed until personal non-commercial use is explicit", () => {
  const blocked = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" })).get("yahoo-tw-stock-news");
  assert.equal(blocked.enabled, false);
  assert.match(blocked.disabledReason, /Content usage context/);

  const enabled = buildSourceRegistry(loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial"
  })).get("yahoo-tw-stock-news");
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.targets.length, 5);
});

test("Yahoo target adapter keeps publisher unknown, structured ticker lineage, and Event held", async () => {
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const source = buildSourceRegistry(config).get("yahoo-tw-stock-news");
  const target = source.targets[0];
  const result = await fetchYahooTwStockNewsTarget({
    source,
    target: { ...target, request_key: target.requestKey },
    identityContext: { identifier: target.identifier, names: ["測試公司 2330"] },
    config,
    now: () => NOW,
    http: { getText: async () => feedFetch("2330", "https://tw.stock.yahoo.com/news/fixture-2330") }
  });
  assert.equal(result.status, "success");
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].publisher_key, "unknown");
  assert.equal(result.documents[0].raw_metadata.event_eligible, false);
  assert.equal(result.documents[0].raw_metadata.entity_hints[0].identifier.authority, "TWSE");
  assert.equal(result.documents[0].body_excerpt, null);
  assert.equal(result.documents[0].raw_metadata.attribution, "Yahoo股市");
  assert.deepEqual(result.documents[0].raw_metadata.rights, {
    usage_context: "personal_noncommercial",
    full_text_stored: false,
    attribution_required: true,
    advertising_allowed: false,
    source_link_required: true,
    requires_unmodified_display: true
  });
});

test("Company News API aggregates companies, exposes rights, and remains a read-only GET", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-api-"));
  let requestCount = 0;
  const config = loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial",
    ATLAS_DB_PATH: join(root, "atlas.sqlite"),
    HOST: "127.0.0.1",
    PORT: "1"
  });
  config.port = 0;
  const registry = buildSourceRegistry(config);
  const runtime = createAtlasRuntime({
    config,
    registry,
    clock: () => new Date(NOW),
    http: {
      async getText(url) {
        requestCount += 1;
        const ticker = new URL(url).searchParams.get("s");
        return ["2330", "2317"].includes(ticker)
          ? feedFetch(ticker, "https://tw.stock.yahoo.com/news/shared-api-article")
          : { ...feedFetch(ticker, null), data: "<rss><channel></channel></rss>", rawPayload: "<rss><channel></channel></rss>" };
      },
      async getJson() { throw new Error("unexpected getJson"); }
    }
  });
  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });

  seedMaster(runtime.store, registry.get("twse-company-master"), "TWSE", ["2330", "2317", "2454", "3035", "1101"]);
  seedMaster(runtime.store, registry.get("tpex-company-master"), "TPEX", ["6488"]);
  const collection = await runtime.collector.runSource("yahoo-tw-stock-news");
  assert.equal(collection.status, "success");
  assert.equal(requestCount, 5);

  const countsBefore = runtime.store.getStats();
  const envelope = await json(`${baseUrl}/api/v1/company-news?market=TWSE&market=TPEX&limit=20`);
  const countsAfter = runtime.store.getStats();
  assert.equal(requestCount, 5, "GET must not invoke the provider client");
  assert.deepEqual(countsAfter, countsBefore, "GET must not mutate persisted Atlas counts");
  assert.equal(envelope.profile, "company_news_latest_v1");
  assert.equal(envelope.data.length, 1);
  assert.deepEqual(envelope.data[0].companies.map((company) => company.securities[0].ticker).sort(), ["2317", "2330"]);
  assert.equal(envelope.data[0].publisher, "Unknown publisher");
  assert.equal(envelope.data[0].publisher_key, "unknown");
  assert.equal(envelope.data[0].source_attribution, "Yahoo股市");
  assert.equal(envelope.data[0].rights.requires_unmodified_display, true);
  assert.equal(envelope.coverage.scope, "limited_targets");
  assert.equal(envelope.coverage.enabled_targets, 5);
  assert.equal(envelope.coverage.eligible_targets, 6);
  assert.equal(envelope.coverage.target_mode, "canary");
  assert.equal(envelope.freshness.status, "current");
  const commaMarkets = await json(`${baseUrl}/api/v1/company-news?market=TWSE,TPEX&limit=1`);
  assert.equal(commaMarkets.profile, "company_news_latest_v1");

  const invalid = await fetch(`${baseUrl}/api/v1/company-news?market=NYSE`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_market");

  // SQLite query_only rejects INSERT/UPDATE/DELETE, including unchanged row counts.
  runtime.store.db.exec("PRAGMA query_only = ON");
  const stock = await json(`${baseUrl}/api/v1/stocks/TWSE/2330/news?limit=1`);
  assert.equal(stock.profile, "company_news_stock_v1");
  assert.equal(stock.stock.security_id, "security:twse:2330");
  assert.equal(stock.data.length, 1);
  assert.deepEqual(stock.data[0].companies.map((company) => company.securities[0].ticker).sort(), ["2317", "2330"]);
  assert.equal(stock.data[0].event_eligible, false);
  assert.equal(stock.data[0].rights.requires_unmodified_display, true);
  assert.equal(stock.coverage.scope, "stock");
  assert.equal(stock.coverage.target_count, 1);
  const unrelated = await json(`${baseUrl}/api/v1/stocks/TWSE/2454/news`);
  assert.equal(unrelated.data.length, 0);
  const uncovered = await json(`${baseUrl}/api/v1/stocks/TWSE/1101/news`);
  assert.equal(uncovered.freshness.status, "missing");
  assert.equal(uncovered.coverage.target_count, 0);
  const tpex = await json(`${baseUrl}/api/v1/stocks/TPEX/6488/news`);
  assert.equal(tpex.stock.symbol, "6488");
  assert.equal(tpex.freshness.status, "current");
  for (const [path, status] of [["NYSE/2330/news", 400], ["TWSE/9999/news", 404], ["TWSE/2330/news?cursor=bad", 400]]) {
    assert.equal((await fetch(`${baseUrl}/api/v1/stocks/${path}`)).status, status);
  }
  const wrongCursor = Buffer.from(JSON.stringify({ kind: "company_news_stock_v1", exchange: "TWSE", symbol: "2317",
    company_id: stock.stock.company_id, security_id: stock.stock.security_id, time: NOW, id: stock.data[0].id })).toString("base64url");
  assert.equal((await fetch(`${baseUrl}/api/v1/stocks/TWSE/2330/news?cursor=${wrongCursor}`)).status, 400);
  const mcp = await fetch(`${baseUrl}/mcp`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "atlas.company.news" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "atlas.company.news", arguments: { exchange: "TWSE", symbol: "2330", limit: 1 },
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "stock-news-test", version: "1.0.0" } }
    } })
  });
  assert.deepEqual((await mcp.json()).result.structuredContent, stock);
  assert.equal(requestCount, 5);
  runtime.store.db.exec("PRAGMA query_only = OFF");
  runtime.config.contentUsageContext = "unreviewed";
  assert.equal((await fetch(`${baseUrl}/api/v1/stocks/TWSE/2330/news`)).status, 403);
  runtime.config.contentUsageContext = "personal_noncommercial";
});

test("stock news keyset pagination preserves timestamp ties, fallback times and byte bounds", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-stock-news-pages-"));
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_COLLECT_ON_START: "false",
    ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial", ATLAS_DB_PATH: join(root, "atlas.sqlite") });
  const registry = buildSourceRegistry(config);
  const runtime = createAtlasRuntime({ config, registry, clock: () => new Date(NOW),
    http: { getText: async () => { throw new Error("provider I/O forbidden"); } } });
  t.after(async () => { await runtime.close(); rmSync(root, { recursive: true, force: true }); });
  seedMaster(runtime.store, registry.get("twse-company-master"), "TWSE", ["2330", "2317"]);
  const source = registry.get("yahoo-tw-stock-news");
  for (let index = 0; index < 3; index += 1) {
    const target = source.targets.find((item) => item.identifier.value === "2330");
    const result = await fetchYahooTwStockNewsTarget({ source, target: { ...target, request_key: target.requestKey }, config,
      identityContext: { identifier: target.identifier, names: ["測試公司 2330"] },
      now: () => NOW, http: { getText: async () => feedFetch("2330", `https://tw.stock.yahoo.com/news/page-${index}`) } });
    const runId = runtime.store.beginSourceRun(source, NOW);
    processSourceResult(runtime.store, runId, result, NOW);
  }
  runtime.store.db.exec("UPDATE documents SET published_at = NULL, observed_at = NULL");
  runtime.store.db.exec("PRAGMA query_only = ON");
  const ids = [];
  let cursor;
  do {
    const page = runtime.capabilities.companyNewsStock({ exchange: "TWSE", symbol: "2330", limit: 1, cursor });
    ids.push(...page.data.map((item) => item.id));
    cursor = page.pagination.next_cursor;
    if (cursor) assert.throws(() => runtime.capabilities.companyNewsStock({ exchange: "TWSE", symbol: "2317", cursor }), /cursor/);
  } while (cursor && ids.length < 10);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  runtime.store.db.exec("PRAGMA query_only = OFF");
  runtime.store.db.prepare("UPDATE documents SET title = ?").run("原".repeat(100000));
  const first = runtime.capabilities.companyNewsStock({ exchange: "TWSE", symbol: "2330", limit: 3 });
  assert.equal(first.data.length, 1);
  assert.equal(first.pagination.truncated_by_byte_budget, true);
  assert.ok(first.pagination.serialized_bytes <= first.pagination.byte_budget);
  const second = runtime.capabilities.companyNewsStock({ exchange: "TWSE", symbol: "2330", limit: 3, cursor: first.pagination.next_cursor });
  assert.notEqual(first.data[0].id, second.data[0].id);
  runtime.store.db.prepare(`INSERT INTO entity_relations
    (id, from_entity_id, to_entity_id, relation_type, confidence, method, status, created_at, updated_at)
    VALUES ('ambiguous-fixture', ?, 'security:twse:2330', 'listed_as', 1, 'fixture', 'active', ?, ?)`)
    .run("company:tw:fixture-twse-2317", NOW, NOW);
  assert.throws(() => runtime.capabilities.companyNewsStock({ exchange: "TWSE", symbol: "2330" }),
    (error) => error.status === 409 && error.code === "ambiguous_stock_identity");
});

test("bounded master target registry waits for complete inventories and links canonical owners", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-targets-"));
  const config = loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial",
    ATLAS_COMPANY_NEWS_TARGET_MODE: "master_bounded",
    ATLAS_COMPANY_NEWS_MAX_ACTIVE_TARGETS: "7",
    ATLAS_DB_PATH: join(root, "atlas.sqlite")
  });
  const registry = buildSourceRegistry(config);
  const runtime = createAtlasRuntime({ config, registry, clock: () => new Date(NOW) });
  t.after(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });

  seedMaster(runtime.store, registry.get("twse-company-master"), "TWSE", ["2330", "2317", "2454", "3035", "1101"]);
  assert.equal(runtime.targetRegistry.reconcile().status, "deferred");
  assert.equal(runtime.store.listSourceTargets("yahoo-tw-stock-news").length, 5);

  seedMaster(runtime.store, registry.get("tpex-company-master"), "TPEX", ["6488", "8069"]);
  const result = runtime.targetRegistry.reconcile();
  assert.equal(result.status, "reconciled");
  assert.equal(result.candidate_count, 7);
  assert.equal(result.enabled_count, 7);
  const targets = runtime.store.listSourceTargets("yahoo-tw-stock-news");
  assert.equal(targets.length, 7);
  assert.equal(targets.filter((target) => target.enabled).length, 7);
  assert.equal(targets.filter((target) => target.policy.target_origin === "definition").every((target) => target.entity_id && target.security_id), true);
  assert.equal(targets.filter((target) => target.policy.target_origin === "canonical_master").length, 2);
  assert.equal(runtime.targetRegistry.reconcile().generated_count, 2, "reconcile must be idempotent");
});

test("Yahoo malformed or non-Yahoo article links fail soft as failed feed items", async () => {
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const source = buildSourceRegistry(config).get("yahoo-tw-stock-news");
  const target = { ...source.targets[0], request_key: source.targets[0].requestKey };
  const data = `<rss><channel>
    <item><title>有效項目</title><link>https://tw.stock.yahoo.com/news/valid</link></item>
    <item><title>缺少連結</title></item>
    <item><title>不允許的 host</title><link>http://127.0.0.1/private</link></item>
  </channel></rss>`;
  const result = await fetchYahooTwStockNewsTarget({
    source,
    target,
    config,
    now: () => NOW,
    http: { getText: async () => ({ ...feedFetch("2330", null), data, rawPayload: data }) }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.documents.length, 1);
  assert.equal(result.counts.failed_count, 2);
  assert.deepEqual(result.warnings, ["invalid_feed_items:2"]);
});

test("target collector isolates one 429 and persists observations per target", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-collector-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  const config = loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial",
    COLLECTOR_CONCURRENCY: "1"
  });
  const registry = buildSourceRegistry(config);
  store.registerSources(registry.all, NOW);
  store.registerSourceTargets(registry.all, NOW);
  const http = {
    async getText(url) {
      const ticker = new URL(url).searchParams.get("s");
      if (ticker === "2454") {
        const error = new Error("HTTP 429 fixture");
        error.status = 429;
        throw error;
      }
      const article = ["2330", "2317"].includes(ticker)
        ? "https://tw.stock.yahoo.com/news/shared-article"
        : `https://tw.stock.yahoo.com/news/${ticker}`;
      return feedFetch(ticker, article);
    },
    async getJson() { throw new Error("unexpected getJson"); }
  };
  const clock = () => new Date(NOW);
  const collector = createCollector({ store, registry, http, config, clock, logger: { warn() {} } });
  try {
    const result = await collector.runSource("yahoo-tw-stock-news");
    assert.equal(result.status, "partial");
    const targetRuns = store.db.prepare("SELECT status, COUNT(*) count FROM source_target_runs GROUP BY status ORDER BY status").all().map((row) => ({ ...row }));
    assert.deepEqual(targetRuns, [{ status: "rate_limited", count: 1 }, { status: "success", count: 4 }]);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM documents WHERE source_id = 'yahoo-tw-stock-news'").get().count, 3);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM document_observations WHERE source_id = 'yahoo-tw-stock-news'").get().count, 4);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM events").get().count, 0);
    const shared = store.db.prepare("SELECT raw_metadata_json FROM documents WHERE canonical_url = 'https://tw.stock.yahoo.com/news/shared-article'").get();
    assert.deepEqual(JSON.parse(shared.raw_metadata_json).discovery_targets.sort(), ["TWSE:2317", "TWSE:2330"]);
    const failedTarget = store.listSourceTargets("yahoo-tw-stock-news").find((target) => target.identifier.value === "2454");
    assert.equal(failedTarget.last_outcome, "rate_limited");
    assert.equal(failedTarget.consecutive_failures, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("successful empty target run becomes current without fabricating last match", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-empty-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const registry = buildSourceRegistry(config);
  store.registerSources(registry.all, NOW);
  store.registerSourceTargets(registry.all, NOW);
  const collector = createCollector({
    store,
    registry,
    config,
    clock: () => new Date(NOW),
    logger: { warn() {} },
    http: {
      getText: async () => ({ ...feedFetch("empty", null), data: "<rss><channel></channel></rss>", rawPayload: "<rss><channel></channel></rss>" }),
      getJson: async () => { throw new Error("unexpected getJson"); }
    }
  });
  try {
    const result = await collector.runSource("yahoo-tw-stock-news");
    assert.equal(result.status, "success");
    const targets = store.listSourceTargets("yahoo-tw-stock-news");
    assert.equal(targets.every((target) => target.last_success_at === NOW), true);
    assert.equal(targets.every((target) => target.last_match_at === null), true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact canonical URL dedupe preserves the first Document owner and both discovery observations", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-cross-source-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial" });
  const registry = buildSourceRegistry(config);
  store.registerSources(registry.all, NOW);
  store.registerSourceTargets(registry.all, NOW);
  try {
    const canonicalUrl = "https://publisher.example.test/articles/canonical-1";
    const sources = [registry.get("yahoo-tw-stock-news"), registry.get("bbc-world-rss")];
    for (const [index, source] of sources.entries()) {
      const runId = store.beginSourceRun(source, NOW);
      const document = createIntelDocument(source, {
        externalId: `${source.id}:external`,
        canonicalUrl,
        title: "同一篇 canonical 公司新聞",
        summary: "fixture",
        publisher: index === 0 ? "Unknown publisher" : "Publisher",
        publisherKey: index === 0 ? "unknown" : "publisher",
        language: "zh-TW",
        domains: [{ domain: "finance", confidence: 1 }],
        rawMetadata: {
          event_eligible: false,
          source_target_id: index === 0 ? "yahoo-tw-stock-news:TWSE:2330" : null,
          discovery_provider: source.name,
          discovered_url: canonicalUrl
        }
      }, NOW);
      const result = createSourceResult({ source, documents: [document], startedAt: NOW, finishedAt: NOW });
      processSourceResult(store, runId, result, NOW);
    }
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM documents WHERE canonical_url = ?").get(canonicalUrl).count, 1);
    const document = store.db.prepare("SELECT source_id, publisher_key FROM documents WHERE canonical_url = ?").get(canonicalUrl);
    assert.equal(document.source_id, "yahoo-tw-stock-news");
    assert.equal(document.publisher_key, "unknown");
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM document_observations WHERE document_id = (SELECT id FROM documents WHERE canonical_url = ?)").get(canonicalUrl).count, 2);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function feedFetch(ticker, link) {
  const item = link ? `<item><title>測試公司 ${ticker}(${ticker}) 公司新聞</title><link>${link}</link><pubDate>Sun, 06 Sep 2026 18:00:00 +0800</pubDate><description>僅保存 RSS 摘要。</description></item>` : "";
  const data = `<rss version="2.0"><channel>${item}</channel></rss>`;
  return {
    url: `https://tw.stock.yahoo.com/rss?s=${ticker}`,
    status: 200,
    contentType: "application/rss+xml",
    etag: null,
    lastModified: null,
    rawPayload: data,
    payloadTruncated: false,
    data
  };
}

function seedMaster(store, source, market, tickers) {
  const masterItems = tickers.map((ticker) => {
    const companyId = `company:tw:fixture-${market.toLowerCase()}-${ticker}`;
    const securityId = `security:${market.toLowerCase()}:${ticker}`;
    return {
      key: `${market}:${ticker}`,
      entities: [
        {
          id: companyId,
          entity_type: "company",
          canonical_name: `測試公司 ${ticker}`,
          country_code: "TW",
          master_authority: "official",
          aliases: [],
          identifiers: [{ namespace: "business_registration", authority: "Taiwan MOEA", scope: "TW", value: `${market}${ticker}` }]
        },
        {
          id: securityId,
          entity_type: "security",
          canonical_name: `測試證券 ${ticker}`,
          country_code: "TW",
          master_authority: "official",
          aliases: [ticker],
          identifiers: [{ namespace: "ticker", authority: market, scope: market, value: ticker }]
        }
      ],
      relations: [{ from_entity_id: companyId, to_entity_id: securityId, relation_type: "listed_as", status: "active" }]
    };
  });
  const runId = store.beginSourceRun(source, NOW);
  const result = createSourceResult({
    source,
    masterItems,
    startedAt: NOW,
    finishedAt: NOW,
    counts: { upstream_item_count: masterItems.length, processed_item_count: masterItems.length },
    completeness: { status: "complete", snapshot_complete: true }
  });
  const persisted = processSourceResult(store, runId, result, NOW);
  store.finishSourceRun(runId, {
    finishedAt: NOW,
    status: persisted.status,
    itemCount: persisted.itemCount,
    processedItemCount: persisted.processedItemCount,
    failedCount: persisted.failedItemCount,
    documentCount: 0,
    entityCount: persisted.entityCount,
    relationCount: persisted.relationCount,
    insertedCount: 0,
    updatedCount: 0,
    warnings: persisted.warnings
  });
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
