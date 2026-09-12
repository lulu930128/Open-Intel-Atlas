import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourceResult } from "../src/atlasContracts.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";
import { createIntelDocument } from "../src/documents/normalize.js";
import { applyClassificationConvergence } from "../src/atlasReprocess.js";
import { rebuildEventForStory } from "../src/atlasEvents.js";

const now = "2026-09-06T03:00:00.000Z";

test("Company REST and MCP share one snapshot capability", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-capability-"));
  const source = fixtureSource();
  const registry = { all: [source], enabled: [source], get: (id) => id === source.id ? source : null };
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(root, "atlas.sqlite"),
    HOST: "127.0.0.1",
    PORT: "1"
  });
  config.port = 0;
  const runtime = createAtlasRuntime({ config, registry, clock: () => new Date(now) });
  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });
  const collection = await runtime.collector.runSource(source.id);
  assert.equal(collection.entity_count, 2);
  assert.equal(collection.document_count, 1);

  const stock = await json(`${baseUrl}/api/v1/stocks/TWSE/2330`);
  assert.equal(stock.profile, "company_snapshot_v1");
  assert.equal(stock.data.entity.canonical_name, "台灣積體電路製造股份有限公司");
  assert.equal(stock.data.summary.document_count, 1);
  assert.equal(stock.data.relations[0].to.id, "security:twse:2330");

  const profile = await json(`${baseUrl}/api/v1/companies/${encodeURIComponent("company:tw:22099131")}`);
  assert.equal(profile.profile, "company_profile_v1");
  assert.equal(profile.data.identifiers[0].value, "22099131");

  const evidence = await json(`${baseUrl}/api/v1/companies/${encodeURIComponent("company:tw:22099131")}/evidence`);
  assert.equal(evidence.data.documents[0].entity_context.method, "structured_identifier");

  const relations = await json(`${baseUrl}/api/v1/companies/${encodeURIComponent("company:tw:22099131")}/relations?limit=1`);
  assert.equal(relations.data.relations.length, 1);
  assert.equal(relations.pagination.byte_budget, 512 * 1024);
  assert.ok(relations.pagination.serialized_bytes <= relations.pagination.byte_budget);

  const mcp = await mcpRequest(baseUrl, "atlas.company.snapshot", { exchange: "TWSE", symbol: "2330", limit: 12 });
  assert.equal(mcp.result.structuredContent.profile, "company_snapshot_v1");
  assert.deepEqual(mcp.result.structuredContent.data, stock.data);
  assert.deepEqual(mcp.result.structuredContent.coverage, stock.coverage);
  assert.equal(stock.coverage.company_master.status, "current");
  assert.equal(stock.coverage.official_disclosure.status, "current");
  assert.equal(stock.coverage.general_news.status, "unknown");
  assert.equal(stock.coverage.status, "partial");

  const beforeReads = runtime.store.db.prepare("SELECT total_changes() count").get().count;
  const disclosures = await json(`${baseUrl}/api/v1/company-disclosures?market=TWSE&limit=1`);
  assert.equal(disclosures.profile, "company_disclosures_v1");
  assert.equal(disclosures.data.length, 1);
  assert.equal(disclosures.data[0].promotion_decision.status, "held");
  assert.equal(disclosures.data[0].classification.primary_domain, "finance");
  const stockDisclosures = await json(`${baseUrl}/api/v1/company-disclosures?exchange=TWSE&symbol=2330`);
  assert.equal(stockDisclosures.coverage.scope, "stock");
  assert.equal(stockDisclosures.data[0].id, disclosures.data[0].id);
  assert.equal((await fetch(`${baseUrl}/api/v1/company-disclosures?exchange=TWSE&symbol=9999`)).status, 404);
  assert.equal((await json(`${baseUrl}/api/v1/company-news`)).data.length, 0);
  const disclosureMcp = await mcpRequest(baseUrl, "atlas.company.disclosures", { market: "TWSE", limit: 1 });
  assert.deepEqual(disclosureMcp.result.structuredContent, disclosures);
  assert.equal((await json(`${baseUrl}/api/v1/companies?market=TPEX&q=2330`)).data.length, 0);
  assert.equal((await json(`${baseUrl}/api/v1/companies?market=TWSE&q=2330`)).data.length, 1);
  assert.equal(runtime.store.db.prepare("SELECT total_changes() count").get().count, beforeReads, "GET and MCP reads must not write");

  // Recreate a pre-policy Event, then converge without deleting historical evidence.
  const document = runtime.store.getDocument(disclosures.data[0].id, true);
  runtime.store.saveDocumentPromotionDecision(document.id, { ...document.promotion_decision, status: "promoted", eligible: true, version: "1.0.0" });
  const storyId = runtime.store.db.prepare("SELECT story_id FROM story_documents WHERE document_id = ?").get(document.id).story_id;
  const oldEvent = rebuildEventForStory(runtime.store, storyId, now);
  const evidenceCount = runtime.store.db.prepare("SELECT COUNT(*) count FROM event_evidence").get().count;
  const result = applyClassificationConvergence(runtime.store, { evaluatedAt: now });
  assert.equal(result.held_events, 1);
  assert.equal(runtime.store.listEvents().items.length, 0);
  assert.equal(runtime.store.getEvent(oldEvent.id).publication_status, "held");
  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) count FROM event_evidence").get().count, evidenceCount);
  assert.ok(runtime.store.listStoryUpdates().items.some((item) => item.importance.reason_codes.includes("PUBLICATION_POLICY_CHANGED")));
  assert.equal(runtime.store.getEntityDocuments("company:tw:22099131").documents.length, 1);
  assert.throws(() => applyClassificationConvergence(runtime.store, { maxDocuments: 0 }), /bound/);
  const second = applyClassificationConvergence(runtime.store, { evaluatedAt: now });
  assert.equal(second.classification_writes + second.promotion_writes + second.event_writes + second.held_events, 0);
  runtime.store.db.prepare("UPDATE events SET publication_status = 'published' WHERE id = ?").run(oldEvent.id);
  assert.equal(applyClassificationConvergence(runtime.store, { evaluatedAt: now }).held_events, 1, "repair interrupted Event publication even when Document decisions are already current");
  const unresolved = createIntelDocument(source, { externalId: "unresolved", title: "公司例行公告（未解析公司）", publishedAt: now,
    rawMetadata: { disclosure_type: "company_material_information" } }, now);
  runtime.store.upsertDocument(unresolved, null, null, now);
  const pageOne = await json(`${baseUrl}/api/v1/company-disclosures?market=TWSE&limit=1`);
  assert.ok(pageOne.pagination.next_cursor);
  const pageTwo = await json(`${baseUrl}/api/v1/company-disclosures?market=TWSE&limit=1&cursor=${encodeURIComponent(pageOne.pagination.next_cursor)}`);
  assert.notEqual(pageOne.data[0].id, pageTwo.data[0].id);
  assert.deepEqual(new Set([pageOne.data[0].id, pageTwo.data[0].id]), new Set([document.id, unresolved.id]));
  assert.equal((await fetch(`${baseUrl}/api/v1/company-disclosures?market=TPEX&cursor=${encodeURIComponent(pageOne.pagination.next_cursor)}`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/v1/company-disclosures?exchange=TWSE&symbol=2330&cursor=${encodeURIComponent(pageOne.pagination.next_cursor)}`)).status, 400);
  assert.throws(() => applyClassificationConvergence(runtime.store, { maxDocuments: 1 }), /truncated/);
});

function fixtureSource() {
  const source = {
    id: "company-capability-fixture",
    name: "Company capability fixture",
    providerType: "official_json",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "financial_release",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Fixture",
    policyNote: "Test only",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    catchupMode: "latest_only",
    cadence: "1m",
    mediaPolicy: {},
    coverage: { capabilities: ["company.master", "company.disclosures"], markets: ["TWSE"], guarantee: "complete_snapshot" }
  };
  source.run = async () => createSourceResult({
    source,
    startedAt: now,
    finishedAt: now,
    fetches: fixtureFetch(),
    entities: [
      {
        id: "company:tw:22099131",
        entity_type: "company",
        canonical_name: "台灣積體電路製造股份有限公司",
        country_code: "TW",
        master_authority: "official",
        aliases: ["台積電", "TSMC"],
        identifiers: [{ namespace: "business_registration", authority: "Taiwan MOEA", scope: "TW", value: "22099131" }],
        metadata: { ticker: "2330", exchange: "TWSE" }
      },
      {
        id: "security:twse:2330",
        entity_type: "security",
        canonical_name: "台積電 2330",
        country_code: "TW",
        master_authority: "official",
        aliases: ["2330"],
        identifiers: [{ namespace: "ticker", authority: "TWSE", scope: "TWSE", value: "2330" }],
        metadata: { ticker: "2330", exchange: "TWSE" }
      }
    ],
    relations: [{ from_entity_id: "company:tw:22099131", to_entity_id: "security:twse:2330", relation_type: "listed_as" }],
    documents: [createIntelDocument(source, {
      externalId: "disclosure:1",
      canonicalUrl: "https://example.test/disclosures/1",
      title: "台積電重大訊息",
      summary: "董事會決議。",
      publishedAt: now,
      eventKey: "disclosure:1",
      eventTypeCandidate: "finance.corporate",
      rawMetadata: {
        disclosure_type: "company_material_information",
        entity_hints: [{ name: "台積電", role: "issuer", identifier: { namespace: "ticker", authority: "TWSE", scope: "TWSE", value: "2330" } }]
      }
    }, now)],
    counts: { upstream_item_count: 1, processed_item_count: 1 },
    completeness: { status: "complete", snapshot_complete: true }
  });
  return source;
}

function fixtureFetch() {
  return { url: "https://example.test/feed", status: 200, contentType: "application/json", rawPayload: "{}", payloadTruncated: false };
}

async function json(url) {
  const response = await fetch(url);
  if (response.status !== 200) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function mcpRequest(baseUrl, name, input) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: name,
      method: "tools/call",
      params: {
        name,
        arguments: input,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "company-regression", version: "1.0.0" }
        }
      }
    })
  });
  if (response.status !== 200) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
