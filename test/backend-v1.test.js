import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIntelDocument, dedupeDocuments } from "../src/documents/normalize.js";
import { sourceFetchResult } from "../src/atlasContracts.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";
import { canonicalizeUrl, cleanText, parseRocTimestamp, redactUrl } from "../src/core/utils.js";

test("基礎清洗會移除標記、追蹤參數並解析民國日期", () => {
  assert.equal(cleanText("<p>Hello&nbsp; <strong>world</strong></p>"), "Hello world");
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM/news/?utm_source=x&b=2&a=1#fragment"),
    "https://example.com/news?a=1&b=2"
  );
  assert.equal(parseRocTimestamp("1150823", "091530"), "2026-08-23T01:15:30.000Z");
  assert.equal(
    redactUrl("https://api.example.test/items?api_key=secret&limit=5"),
    "https://api.example.test/items?api_key=%5BREDACTED%5D&limit=5"
  );
});

test("同來源重複文件會在寫入前去重", () => {
  const source = fixtureSource();
  const first = createIntelDocument(source, {
    externalId: "same",
    title: "Test event",
    url: "https://example.test/item?utm_source=a"
  });
  const second = createIntelDocument(source, {
    externalId: "same",
    title: "Test event updated",
    url: "https://example.test/item?utm_source=b"
  });
  assert.equal(dedupeDocuments([first, second]).length, 1);
});

test("collector、canonical store、v1 API 與舊前端相容層可端到端運作", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-test-"));
  const dbPath = join(tempRoot, "atlas.sqlite");
  const source = fixtureSource();
  const registry = {
    all: [source],
    enabled: [source],
    get(sourceId) {
      return sourceId === source.id ? source : null;
    }
  };
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: dbPath,
    HOST: "127.0.0.1",
    PORT: "1"
  });
  config.port = 0;
  const runtime = createAtlasRuntime({ config, registry });
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const collection = await runtime.collector.runSource(source.id);
  assert.equal(collection.status, "success");
  assert.equal(collection.item_count, 3);
  assert.equal(collection.inserted_count, 3);

  const repeatedCollection = await runtime.collector.runSource(source.id);
  assert.equal(repeatedCollection.inserted_count, 0);
  assert.equal(repeatedCollection.updated_count, 3);

  const stats = runtime.store.getStats();
  assert.equal(stats.documents, 3);
  assert.equal(stats.stories, 2);
  assert.equal(stats.events, 1, "market observation marked ineligible must not become an event");

  const storedEvent = runtime.store.listEvents({ limit: 10 }).items[0];
  assert.equal(storedEvent.verification_status, "multi_source");
  assert.equal(storedEvent.evidence_count, 2);
  assert.equal(storedEvent.location, null, "missing coordinates must not become a 0,0 location");

  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.version, "1.1.0");
  assert.equal(health.contract_version, "1.0");
  assert.equal(health.storage.schema_version, 2);
  assert.equal(health.storage.events, 1);
  assert.equal(health.coverage.status, "full");
  assert.equal("db_file" in health.storage, false, "public health response must not expose local paths");

  const eventsResponse = await fetch(`${baseUrl}/api/v1/events?domain=politics&limit=5`);
  const events = await eventsResponse.json();
  assert.equal(eventsResponse.status, 200);
  assert.equal(events.data.length, 1);
  assert.equal(events.pagination.count, 1);

  const domainsResponse = await fetch(`${baseUrl}/api/v1/domains`);
  const domains = await domainsResponse.json();
  assert.equal(domainsResponse.status, 200);
  assert.deepEqual(domains.data.map((domain) => domain.id), ["politics", "technology", "finance", "hazards"]);

  const freshnessResponse = await fetch(`${baseUrl}/api/v1/freshness?domain=politics`);
  const freshness = await freshnessResponse.json();
  assert.equal(freshnessResponse.status, 200);
  assert.equal(freshness.data.coverage.status, "full");
  assert.equal(freshness.data.coverage.expected_sources, 1);
  assert.equal(freshness.coverage.expected_sources, 1);

  const detailResponse = await fetch(`${baseUrl}/api/v1/events/${encodeURIComponent(storedEvent.id)}`);
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.evidence.length, 2);

  const searchResponse = await fetch(`${baseUrl}/api/v1/search?q=infrastructure`);
  const search = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(search.data.events.length, 1);

  const invalidResponse = await fetch(`${baseUrl}/api/v1/events?domain=unknown`);
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.error.code, "invalid_domain");

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard?range=all`);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.dashboard.coverage.event_count, 1);
  assert.deepEqual(dashboard.dashboard.mini_map_points, []);

  const staticResponse = await fetch(`${baseUrl}/`);
  assert.equal(staticResponse.status, 200);
  assert.match(staticResponse.headers.get("content-type"), /^text\/html/);
});

function fixtureSource() {
  const source = {
    id: "fixture-source",
    name: "Fixture Source",
    providerType: "test",
    sourceClass: "publisher",
    authorityClass: "professional_media",
    documentType: "news",
    domains: ["politics"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Test fixture",
    policyNote: "Test only",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    cadence: "1m",
    async run({ now }) {
      const fetchedAt = now();
      const documents = [
        createIntelDocument(source, {
          externalId: "event-a",
          title: "Government announces resilient infrastructure policy",
          summary: "A new infrastructure policy was announced.",
          url: "https://alpha.example.test/policy?utm_source=test",
          publishedAt: "2026-08-23T00:00:00Z",
          publisher: "Alpha News",
          publisherKey: "alpha.example.test",
          eventKey: "policy-2026",
          eventTypeCandidate: "politics.regulation"
        }, fetchedAt),
        createIntelDocument(source, {
          externalId: "event-b",
          title: "Government announces resilient infrastructure policy",
          summary: "Independent reporting confirms the policy.",
          url: "https://beta.example.test/policy",
          publishedAt: "2026-08-23T00:05:00Z",
          publisher: "Beta News",
          publisherKey: "beta.example.test",
          eventKey: "policy-2026",
          eventTypeCandidate: "politics.regulation"
        }, fetchedAt),
        createIntelDocument(source, {
          externalId: "market-observation",
          title: "Reference exchange rate observation",
          summary: "A point-in-time market value, not a news event.",
          url: "https://example.test/rate",
          publishedAt: "2026-08-23T00:10:00Z",
          documentType: "market_observation",
          rawMetadata: { event_eligible: false }
        }, fetchedAt)
      ];
      return sourceFetchResult(
        source,
        {
          url: "https://example.test/feed",
          status: 200,
          contentType: "application/json",
          etag: null,
          lastModified: null,
          rawPayload: JSON.stringify({ items: 3 }),
          payloadTruncated: false
        },
        documents,
        fetchedAt,
        fetchedAt
      );
    }
  };
  return source;
}
