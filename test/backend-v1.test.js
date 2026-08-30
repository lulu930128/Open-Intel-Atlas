import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
  assert.equal(stats.story_updates, 2, "new Story plus corroboration must produce two durable semantic changes");
  assert.equal(stats.events, 1, "market observation marked ineligible must not become an event");

  const storedEvent = runtime.store.listEvents({ limit: 10 }).items[0];
  assert.equal(storedEvent.verification_status, "multi_source");
  assert.equal(storedEvent.evidence_count, 2);
  assert.equal(storedEvent.location, null, "missing coordinates must not become a 0,0 location");
  assert.equal(storedEvent.representative_media.display_policy, "remote_embed");
  assert.equal(storedEvent.representative_media.url, "https://images.example.test/policy.jpg");
  const mediaDocumentId = storedEvent.representative_media.document_id;
  assert.ok(mediaDocumentId);
  assert.equal(storedEvent.representative_media.source_id, source.id);

  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.version, "1.3.0");
  assert.equal(health.contract_version, "1.1");
  assert.equal(health.storage.schema_version, 4);
  assert.equal(health.storage.events, 1);
  assert.equal(health.coverage.status, "full");
  assert.equal("db_file" in health.storage, false, "public health response must not expose local paths");

  const newsroomResponse = await fetch(`${baseUrl}/`);
  assert.equal(newsroomResponse.status, 200);
  assert.equal(newsroomResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(newsroomResponse.headers.get("content-security-policy"), /img-src 'self' https: data:/);

  const eventsResponse = await fetch(`${baseUrl}/api/v1/events?domain=politics&limit=5`);
  const events = await eventsResponse.json();
  assert.equal(eventsResponse.status, 200);
  assert.equal(events.data.length, 1);
  assert.equal(events.pagination.count, 1);
  assert.equal(events.data[0].representative_media.document_id, mediaDocumentId);
  assert.equal(events.data[0].representative_media.source_id, source.id);

  const originalGetEvent = runtime.store.getEvent;
  runtime.store.getEvent = () => assert.fail("latest_events_v1 must not hydrate every list item with getEvent");
  let profiledEventsResponse;
  try {
    profiledEventsResponse = await fetch(`${baseUrl}/api/v1/events?profile=latest_events_v1&domain=politics&limit=5`);
  } finally {
    runtime.store.getEvent = originalGetEvent;
  }
  const profiledEvents = await profiledEventsResponse.json();
  assert.equal(profiledEventsResponse.status, 200);
  assert.equal(profiledEvents.profile, "latest_events_v1");
  assert.deepEqual(
    profiledEvents.data[0].evidence_ids.sort(),
    runtime.store.getEvent(storedEvent.id).evidence.map((evidence) => evidence.id).sort()
  );
  assert.equal(profiledEvents.data[0].representative_media.url, "https://images.example.test/policy.jpg");
  assert.equal(profiledEvents.data[0].representative_media.document_id, mediaDocumentId);
  assert.equal(profiledEvents.data[0].representative_media.source_id, source.id);

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
  assert.equal(detail.data.representative_media.document_id, mediaDocumentId);
  const detailStoryId = detail.data.stories[0].id;
  const storyResponse = await fetch(`${baseUrl}/api/v1/stories/${encodeURIComponent(detailStoryId)}`);
  const story = await storyResponse.json();
  assert.equal(storyResponse.status, 200);
  assert.equal(story.data.representative_media.document_id, mediaDocumentId);
  const documentResponse = await fetch(`${baseUrl}/api/v1/documents/${encodeURIComponent(mediaDocumentId)}`);
  const document = await documentResponse.json();
  assert.equal(documentResponse.status, 200);
  assert.equal(document.data.representative_media.document_id, mediaDocumentId);
  assert.equal(document.data.representative_media.source_id, source.id);

  const changesResponse = await fetch(`${baseUrl}/api/v1/changes?domain=politics&limit=10`);
  const changes = await changesResponse.json();
  assert.equal(changesResponse.status, 200);
  assert.equal(changes.profile, "change_feed_v1");
  assert.deepEqual(changes.data.map((change) => change.change_type), ["story_created", "verification_changed"]);
  assert.equal(changes.data[1].story_version, 2);
  assert.ok(changes.data[1].importance.reason_codes.includes("EVIDENCE_CHANGED"));
  assert.equal(changes.pagination.has_more, false);
  assert.ok(changes.pagination.next_cursor);

  const caughtUpResponse = await fetch(
    `${baseUrl}/api/v1/changes?domain=politics&cursor=${encodeURIComponent(changes.pagination.next_cursor)}`
  );
  const caughtUp = await caughtUpResponse.json();
  assert.equal(caughtUpResponse.status, 200);
  assert.deepEqual(caughtUp.data, []);

  const invalidCursorResponse = await fetch(`${baseUrl}/api/v1/changes?cursor=not-a-cursor`);
  const invalidCursor = await invalidCursorResponse.json();
  assert.equal(invalidCursorResponse.status, 400);
  assert.equal(invalidCursor.error.code, "invalid_cursor");

  const mismatchedCursorResponse = await fetch(
    `${baseUrl}/api/v1/changes?domain=hazards&cursor=${encodeURIComponent(changes.pagination.next_cursor)}`
  );
  const mismatchedCursor = await mismatchedCursorResponse.json();
  assert.equal(mismatchedCursorResponse.status, 400);
  assert.equal(mismatchedCursor.error.code, "cursor_scope_mismatch");

  const profilesResponse = await fetch(`${baseUrl}/api/v1/profiles`);
  const profiles = await profilesResponse.json();
  assert.equal(profilesResponse.status, 200);
  assert.ok(profiles.data.some((profile) => profile.id === "brief_compact_v1"));

  const invalidProfileResponse = await fetch(`${baseUrl}/api/v1/sources?profile=unknown_profile`);
  const invalidProfile = await invalidProfileResponse.json();
  assert.equal(invalidProfileResponse.status, 400);
  assert.equal(invalidProfile.error.code, "invalid_profile");

  runtime.store.getEvent = () => assert.fail("brief_compact_v1 must not hydrate every list item with getEvent");
  let briefResponse;
  try {
    briefResponse = await fetch(`${baseUrl}/api/v1/brief?profile=brief_compact_v1&domain=politics`);
  } finally {
    runtime.store.getEvent = originalGetEvent;
  }
  const brief = await briefResponse.json();
  assert.equal(briefResponse.status, 200);
  assert.equal(brief.profile, "brief_compact_v1");
  assert.ok(brief.data.generated_at, "brief data keeps the legacy v1 generated_at field");
  assert.equal(brief.data.highlights[0].id, storedEvent.id);
  assert.equal(brief.data.highlights[0].domain, "politics", "compact profile keeps the v1 brief domain alias");
  assert.equal(typeof brief.data.highlights[0].confidence, "number", "compact profile keeps the v1 confidence field");
  assert.equal(brief.data.highlights[0].representative_media.url, "https://images.example.test/policy.jpg");
  assert.equal(brief.data.highlights[0].representative_media.document_id, mediaDocumentId);
  assert.equal(brief.coverage.status, "full");

  const discoverResponse = await modernMcpRequest(baseUrl, "server/discover");
  assert.equal(discoverResponse.status, 200);
  const discover = await readMcpJson(discoverResponse);
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discover.result.resultType, "complete");

  const toolsResponse = await modernMcpRequest(baseUrl, "tools/list");
  assert.equal(toolsResponse.status, 200);
  const tools = await readMcpJson(toolsResponse);
  const toolNames = tools.result.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "atlas.latest",
    "atlas.search",
    "atlas.story.get",
    "atlas.brief",
    "atlas.changes",
    "atlas.sources.status"
  ]);
  assert.ok(tools.result.tools.every((tool) => tool.annotations.readOnlyHint === true));

  const mcpBriefResponse = await modernMcpRequest(
    baseUrl,
    "tools/call",
    { name: "atlas.brief", arguments: { domain: "politics", limit: 5 } },
    "atlas.brief"
  );
  assert.equal(mcpBriefResponse.status, 200);
  const mcpBrief = await readMcpJson(mcpBriefResponse);
  assert.equal(mcpBrief.result.structuredContent.profile, "brief_compact_v1");
  assert.equal(mcpBrief.result.structuredContent.data.highlights[0].id, storedEvent.id);
  assert.equal(mcpBrief.result.structuredContent.data.highlights[0].representative_media.url, "https://images.example.test/policy.jpg");
  assert.equal(mcpBrief.result.structuredContent.data.highlights[0].representative_media.document_id, mediaDocumentId);
  assert.equal(mcpBrief.result.structuredContent.coverage.status, "full");

  const mcpLatestResponse = await modernMcpRequest(
    baseUrl,
    "tools/call",
    { name: "atlas.latest", arguments: { domain: "politics", limit: 5 } },
    "atlas.latest"
  );
  assert.equal(mcpLatestResponse.status, 200);
  const mcpLatest = await readMcpJson(mcpLatestResponse);
  assert.equal(mcpLatest.result.structuredContent.data[0].representative_media.document_id, mediaDocumentId);
  assert.equal(mcpLatest.result.structuredContent.data[0].representative_media.source_id, source.id);

  const invalidMcpCursorResponse = await modernMcpRequest(
    baseUrl,
    "tools/call",
    { name: "atlas.changes", arguments: { cursor: "not-a-cursor" } },
    "atlas.changes"
  );
  assert.equal(invalidMcpCursorResponse.status, 200);
  const invalidMcpCursor = await readMcpJson(invalidMcpCursorResponse);
  assert.equal(invalidMcpCursor.result.isError, true);
  assert.equal(invalidMcpCursor.result.structuredContent.error.code, "invalid_cursor");

  const storyId = runtime.store.listStories({ limit: 10 }).items[0].id;
  const storyResourceResponse = await modernMcpRequest(
    baseUrl,
    "resources/read",
    { uri: `atlas://stories/${storyId}` },
    `atlas://stories/${storyId}`
  );
  assert.equal(storyResourceResponse.status, 200);
  const storyResource = await readMcpJson(storyResourceResponse);
  const resourcePayload = JSON.parse(storyResource.result.contents[0].text);
  assert.equal(resourcePayload.profile, "story_detail_v1");
  assert.equal(resourcePayload.data.story.id, storyId);
  assert.ok(resourcePayload.data.story.summary, "story profile must include a representative source-backed summary");

  const rejectedOriginResponse = await modernMcpRequest(baseUrl, "tools/list", {}, undefined, {
    Origin: "https://example.test"
  });
  assert.equal(rejectedOriginResponse.status, 403);

  const rejectedHostResponse = await rawMcpRequest(baseUrl, "example.test");
  assert.equal(rejectedHostResponse.status, 403);

  const legacyInitializeResponse = await legacyMcpRequest(baseUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "atlas-regression", version: "1.0.0" }
    }
  });
  assert.equal(legacyInitializeResponse.status, 200);
  const legacyInitialize = await readMcpJson(legacyInitializeResponse);
  assert.equal(legacyInitialize.result.protocolVersion, "2025-11-25");

  const legacyToolsResponse = await legacyMcpRequest(baseUrl, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  assert.equal(legacyToolsResponse.status, 200);
  const legacyTools = await readMcpJson(legacyToolsResponse);
  assert.ok(legacyTools.result.tools.some((tool) => tool.name === "atlas.changes"));

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

  await runtime.close();
  const reopenedRuntime = createAtlasRuntime({ config, registry });
  try {
    assert.equal(reopenedRuntime.store.getStats().story_updates, 2, "semantic change log must survive a runtime restart");
    const persistedChanges = reopenedRuntime.capabilities.changes({ limit: 10 });
    assert.deepEqual(persistedChanges.data.map((change) => change.id), changes.data.map((change) => change.id));
    const persistedCatchUp = reopenedRuntime.capabilities.changes({ domain: "politics", cursor: changes.pagination.next_cursor });
    assert.deepEqual(persistedCatchUp.data, [], "a persisted cursor must resume without replaying acknowledged changes");
  } finally {
    await reopenedRuntime.close();
  }
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
    mediaPolicy: {
      version: "fixture-media-v1",
      default_display_policy: "remote_embed",
      rights_class: "publisher_owned",
      display_authorization: "explicit_license",
      allowed_hosts: ["images.example.test"],
      terms_url: "https://example.test/media-license",
      reviewed_at: "2026-08-30T00:00:00.000Z",
      reason: "Fixture publisher authorizes remote display."
    },
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
          eventTypeCandidate: "politics.regulation",
          media: [{ url: "https://images.example.test/policy.jpg", width: 1200, height: 675, altText: "Policy announcement" }]
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

async function modernMcpRequest(baseUrl, method, params = {}, name, extraHeaders = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
      ...extraHeaders
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${name || "request"}`,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "atlas-regression", version: "1.0.0" }
        }
      }
    })
  });
}

async function legacyMcpRequest(baseUrl, body) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function readMcpJson(response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(text);
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .find(Boolean);
  assert.ok(data, `MCP response did not contain a JSON or SSE data payload: ${text.slice(0, 200)}`);
  return JSON.parse(data);
}

function rawMcpRequest(baseUrl, hostHeader) {
  const target = new URL("/mcp", baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          Host: hostHeader,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json"
        }
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode }));
      }
    );
    request.once("error", reject);
    request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  });
}
