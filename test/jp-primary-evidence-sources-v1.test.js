import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hazardSources } from "../src/atlasAdaptersHazards.js";
import { politicsSources } from "../src/atlasAdaptersPolitics.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const NOW = "2026-08-30T12:00:00.000Z";

test("FDMA、METI、NDL 以 canonical registry 揭露官方來源契約", () => {
  const registry = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" }));
  assert.equal(registry.all.length, 33);
  assert.equal(registry.enabled.length, 26);

  const fdma = registry.get("jp-fdma-disaster-info");
  const meti = registry.get("jp-meti-latest");
  const ndl = registry.get("jp-ndl-diet-minutes");
  for (const source of [fdma, meti, ndl]) {
    assert.ok(source);
    assert.equal(source.authorityClass, "official");
    assert.deepEqual(source.countries, ["JP"]);
  }
  assert.equal(fdma.enabled, true);
  assert.equal(ndl.enabled, true);
  assert.equal(meti.enabled, false);
  assert.equal(fdma.sourceClass, "official_feed");
  assert.equal(meti.sourceClass, "official_feed");
  assert.equal(ndl.sourceClass, "primary_legislative_evidence");
  assert.deepEqual(fdma.languages, ["ja"]);
  assert.deepEqual(meti.languages, ["en"]);
  assert.deepEqual(ndl.languages, ["ja"]);
});

test("FDMA 保留 provider fragment identity，兩筆災害不因共用 listing URL 而 collapse", async () => {
  const source = getSource(hazardSources, "jp-fdma-disaster-info");
  const result = await source.run({
    source,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, fdmaFixture(2)) }
  });

  assert.equal(result.documents.length, 2);
  assert.deepEqual(result.documents.map((document) => document.canonical_url), [
    "https://www.fdma.go.jp/disaster/info#070131",
    "https://www.fdma.go.jp/disaster/info#070127"
  ]);
  assert.deepEqual(result.documents.map((document) => document.raw_metadata.event_key), ["fdma:070131", "fdma:070127"]);
  assert.equal(result.documents[0].published_at, "2026-08-26T21:20:00.000Z");
  assert.equal(result.documents[0].observed_at, "2026-08-29T15:00:00.000Z");
  assert.ok(result.documents.every((document) => document.raw_metadata.event_eligible === true));
  assert.ok(result.documents.every((document) => document.raw_metadata.location === null));
});

test("FDMA 非官方 record URL fail closed，不形成 eligible Event", async () => {
  const source = getSource(hazardSources, "jp-fdma-disaster-info");
  const xml = `<rss version="2.0"><channel><item><title>災害情報</title><link>https://example.test/disaster/#outside</link><guid>https://example.test/disaster/#outside</guid><pubDate>Sun, 30 Aug 2026 09:00:00 +0900</pubDate></item></channel></rss>`;
  const result = await source.run({
    source,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, xml) }
  });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].canonical_url, null);
  assert.equal(result.documents[0].raw_metadata.event_eligible, false);
  assert.equal(result.documents[0].raw_metadata.event_key, null);
});

test("METI official policy feed 保持 Document-only 並投影跨領域 metadata", async () => {
  const source = getSource(politicsSources, "jp-meti-latest");
  const result = await source.run({
    source,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, metiFixture()) }
  });

  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.canonical_url, "https://www.meti.go.jp/english/press/2026/0615_001.html");
  assert.equal(document.language, "en");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.source_scope, "JP");
  assert.deepEqual(document.domains.map((entry) => entry.domain), ["politics", "technology", "finance"]);
});

test("NDL 只抓一個 bounded meeting-list page，不保存 speech text", async () => {
  const source = getSource(politicsSources, "jp-ndl-diet-minutes");
  let requestUrl;
  const result = await source.run({
    source,
    catchup: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.000Z" },
    now: () => NOW,
    http: {
      async getJson(url) {
        requestUrl = new URL(url);
        return fetchFixture(url, ndlFixture(), "application/json");
      }
    }
  });

  assert.equal(requestUrl.searchParams.get("from"), "2026-07-01");
  assert.equal(requestUrl.searchParams.get("until"), "2026-07-31");
  assert.equal(requestUrl.searchParams.get("maximumRecords"), "30");
  assert.equal(requestUrl.searchParams.get("recordPacking"), "json");
  assert.equal(result.fetches.length, 1);
  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.external_id, "122105254X03520260724");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.transcript_stored, false);
  assert.equal(document.raw_metadata.speaker_count, 1);
  assert.equal(document.raw_metadata.result_next_record, 31);
  assert.doesNotMatch(document.summary, /本文は保存対象外です/);
});

test("三來源對 valid empty／unknown shape 如實回傳 0 Documents", async () => {
  const cases = [
    [getSource(hazardSources, "jp-fdma-disaster-info"), "getText", "<rss><channel /></rss>"],
    [getSource(politicsSources, "jp-meti-latest"), "getText", "<feed xmlns=\"http://www.w3.org/2005/Atom\" />"],
    [getSource(politicsSources, "jp-ndl-diet-minutes"), "getJson", { unexpected: [] }]
  ];
  for (const [source, method, data] of cases) {
    const result = await source.run({
      source,
      catchup: null,
      now: () => NOW,
      http: { [method]: async (url) => fetchFixture(url, data) }
    });
    assert.equal(result.documents.length, 0, source.id);
  }
});

test("三來源 isolated store 重跑冪等，FDMA 只有 regional relevance、沒有假 event country", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-jp-primary-"));
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const fullRegistry = buildSourceRegistry(config);
  const sourceIds = ["jp-fdma-disaster-info", "jp-meti-latest", "jp-ndl-diet-minutes"];
  const sources = sourceIds.map((id) => {
    const source = fullRegistry.get(id);
    return id === "jp-meti-latest" ? { ...source, enabled: true, disabledReason: null } : source;
  });
  const registry = {
    all: sources,
    enabled: sources,
    get(id) { return sources.find((source) => source.id === id) || null; }
  };
  const http = {
    async getText(url) {
      const value = String(url);
      if (value.includes("fdma.go.jp")) return fetchFixture(url, fdmaFixture(1));
      if (value.includes("meti.go.jp")) return fetchFixture(url, metiFixture());
      throw new Error(`unexpected text fixture URL: ${value}`);
    },
    async getJson(url) {
      if (String(url).includes("kokkai.ndl.go.jp")) return fetchFixture(url, ndlFixture(), "application/json");
      throw new Error(`unexpected JSON fixture URL: ${url}`);
    }
  };
  const runtime = createAtlasRuntime({ config, registry, http });
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  for (const source of sources) {
    const first = await runtime.collector.runSource(source.id);
    const second = await runtime.collector.runSource(source.id);
    assert.equal(first.status, "success");
    assert.equal(first.inserted_count, 1);
    assert.equal(second.inserted_count, 0);
    assert.equal(second.updated_count, 1);
  }

  const stats = runtime.store.getStats();
  assert.equal(stats.documents, 3);
  assert.equal(stats.events, 1);
  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM event_locations").get().count, 0);
  assert.equal(stats.event_regional_relevance, 2);
  const japanBrief = runtime.capabilities.brief({ presentation: "japan_focus", limit: 5 }).data;
  assert.equal(japanBrief.event_count, 1);
  assert.equal(japanBrief.highlights[0].location ?? null, null);
});

function getSource(sources, id) {
  const source = sources.find((entry) => entry.id === id);
  assert.ok(source, `missing source ${id}`);
  return source;
}

function fetchFixture(url, data, contentType = "application/xml") {
  const rawPayload = typeof data === "string" ? data : JSON.stringify(data);
  return {
    url: String(url),
    status: 200,
    contentType,
    etag: null,
    lastModified: null,
    rawPayload,
    payloadTruncated: false,
    data
  };
}

function fdmaFixture(count = 1) {
  const items = [
    `<item><title>令和８年８月２７日からの大雨による被害及び消防機関等の対応状況（第14報・R8.8.30更新）</title><link>/disaster/info/#070131</link><guid>/disaster/info/#070131</guid><pubDate>Thu, 27 Aug 2026 06:20:00 +0900</pubDate></item>`,
    `<item><title>台風第18号による被害及び消防機関等の対応状況（第２報・R8.8.27更新）</title><link>/disaster/info/#070127</link><guid>/disaster/info/#070127</guid><pubDate>Wed, 26 Aug 2026 08:50:21 +0900</pubDate></item>`
  ].slice(0, count).join("");
  return `<rss version="2.0"><channel>${items}</channel></rss>`;
}

function metiFixture() {
  return `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>IP5 Agree on New AI-Focused Cooperation for Global Supply Chains</title>
    <link rel="alternate" type="text/html" href="https://www.meti.go.jp/english/press/2026/0615_001.html" />
    <updated>2026-06-15T15:00:00Z</updated>
    <summary>METI announced artificial intelligence and trade cooperation.</summary>
  </entry></feed>`;
}

function ndlFixture() {
  return {
    numberOfRecords: 45,
    numberOfReturn: 1,
    startRecord: 1,
    nextRecordPosition: 31,
    meetingRecord: [{
      issueID: "122105254X03520260724",
      session: 221,
      nameOfHouse: "衆議院",
      nameOfMeeting: "本会議",
      issue: "第35号",
      date: "2026-07-24",
      closing: null,
      speechRecord: [
        { speechID: "record-info", speaker: "会議録情報", speech: "本文は保存対象外です" },
        { speechID: "speaker-1", speaker: "森英介", speech: "この発言本文も保存しません" },
        { speechID: "speaker-missing", speech: "speaker missing" }
      ],
      meetingURL: "https://kokkai.ndl.go.jp/txt/122105254X03520260724",
      pdfURL: null
    }]
  };
}
