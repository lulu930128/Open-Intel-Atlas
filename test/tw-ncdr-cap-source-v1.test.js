import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hazardSources } from "../src/atlasAdaptersHazards.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const NOW = "2026-08-30T12:00:00.000Z";

test("NCDR active CAP source 由 canonical registry 揭露且不需 credential", () => {
  const registry = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" }));
  assert.equal(registry.all.length, 33);
  assert.equal(registry.enabled.length, 26);

  const source = registry.get("tw-ncdr-active-cap-alerts");
  assert.ok(source);
  assert.equal(source.enabled, true);
  assert.equal(source.sourceClass, "official_aggregator");
  assert.equal(source.authorityClass, "official");
  assert.deepEqual(source.countries, ["TW"]);
  assert.deepEqual(source.languages, ["zh-TW"]);
  assert.deepEqual(source.requiredConfig, []);
});

test("NCDR active feed 保留原發布機關與 CAP lifecycle，不從摘要猜 location", async () => {
  const source = getSource();
  let requestedUrl = null;
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      async getText(url, options) {
        requestedUrl = String(url);
        assert.equal(options.retries, 0);
        return fetchFixture(url, ncdrFixture());
      }
    }
  });

  assert.equal(requestedUrl, "https://alerts.ncdr.nat.gov.tw/RssAtomFeeds.ashx");
  assert.equal(result.documents.length, 3);

  const [active, cancelled, outside] = result.documents;
  assert.equal(active.external_id, "CWA-Weather_extremely-rain_202608301922001");
  assert.equal(active.canonical_url, "https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/Weather_warnings_RAIN/example.cap");
  assert.equal(active.publisher, "中央氣象署");
  assert.equal(active.publisher_key, "tw-ncdr-origin:中央氣象署");
  assert.equal(active.published_at, "2026-08-30T11:22:55.000Z");
  assert.equal(active.observed_at, "2026-08-30T11:20:00.000Z");
  assert.equal(active.raw_metadata.cap_expires, "2026-08-30T21:00:00.000Z");
  assert.equal(active.raw_metadata.rights, "Public Domain");
  assert.equal(active.raw_metadata.event_eligible, true);
  assert.equal(active.raw_metadata.event_key, "ncdr-cap:CWA-Weather_extremely-rain_202608301922001");
  assert.equal(active.raw_metadata.event_type_candidate, "hazards.flood");
  assert.equal(active.raw_metadata.location, null);

  assert.equal(cancelled.raw_metadata.cap_message_type, "Cancel");
  assert.equal(cancelled.raw_metadata.event_eligible, false);
  assert.equal(cancelled.raw_metadata.event_key, null);

  assert.equal(outside.canonical_url, null);
  assert.equal(outside.raw_metadata.event_eligible, false);
  assert.equal(outside.raw_metadata.event_key, null);
});

test("NCDR feed 移除 Public Domain 宣告時 fail closed", async () => {
  const source = getSource();
  await assert.rejects(
    source.run({
      source,
      now: () => NOW,
      http: { getText: async (url) => fetchFixture(url, ncdrFixture({ rights: "All Rights Reserved" })) }
    }),
    /rights are not Public Domain/
  );
});

test("NCDR isolated store 重跑冪等，只建立 TW relevance、不建立假 location", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-tw-ncdr-"));
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const source = buildSourceRegistry(config).get("tw-ncdr-active-cap-alerts");
  const registry = {
    all: [source],
    enabled: [source],
    get(id) { return id === source.id ? source : null; }
  };
  const http = { getText: async (url) => fetchFixture(url, ncdrFixture({ onlyActive: true })) };
  const runtime = createAtlasRuntime({ config, registry, http });
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const first = await runtime.collector.runSource(source.id);
  const second = await runtime.collector.runSource(source.id);
  assert.equal(first.status, "success");
  assert.equal(first.inserted_count, 1);
  assert.equal(second.inserted_count, 0);
  assert.equal(second.updated_count, 1);

  const stats = runtime.store.getStats();
  assert.equal(stats.documents, 1);
  assert.equal(stats.events, 1);
  assert.equal(stats.event_regional_relevance, 2);
  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM event_locations").get().count, 0);
  const relevance = runtime.store.db
    .prepare("SELECT region_code, score FROM event_regional_relevance ORDER BY region_code")
    .all()
    .map((row) => ({ region_code: row.region_code, score: row.score }));
  assert.deepEqual(relevance, [
    { region_code: "EAST_ASIA", score: 0.75 },
    { region_code: "TW", score: 0.75 }
  ]);
  const taiwanBrief = runtime.capabilities.brief({ presentation: "taiwan_focus", limit: 5 }).data;
  assert.equal(taiwanBrief.event_count, 1);
  assert.equal(taiwanBrief.highlights[0].location ?? null, null);
});

function getSource() {
  const source = hazardSources.find((entry) => entry.id === "tw-ncdr-active-cap-alerts");
  assert.ok(source);
  return source;
}

function fetchFixture(url, data) {
  return {
    url: String(url),
    status: 200,
    contentType: "application/atom+xml",
    etag: null,
    lastModified: null,
    rawPayload: data,
    payloadTruncated: false,
    data
  };
}

function ncdrFixture({ rights = "Public Domain", onlyActive = false } = {}) {
  const active = `<entry>
    <id>CWA-Weather_extremely-rain_202608301922001</id>
    <title>降雨</title>
    <updated>2026-08-30T19:22:55+08:00</updated>
    <author><name>中央氣象署</name></author>
    <link rel="alternate" href="https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/Weather_warnings_RAIN/example.cap" />
    <summary type="html">低壓帶影響，屏東及臺東地區有局部大雨發生的機率。</summary>
    <category term="降雨" />
    <cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType>
    <cap:effective>2026/8/30 下午 07:20:00</cap:effective>
    <cap:expires>2026/8/31 上午 05:00:00</cap:expires>
  </entry>`;
  const extra = onlyActive ? "" : `<entry>
    <id>WRA_floodSensor_20260830174700_0000</id>
    <title>淹水感測</title><updated>2026-08-30T17:47:00+08:00</updated>
    <author><name>水利署</name></author>
    <link rel="alternate" href="https://alerts.ncdr.nat.gov.tw/Capstorage/WRA/2026/FloodSensor/cancel.cap" />
    <summary>水位已退至警戒值以下。</summary><category term="淹水感測" />
    <cap:status>Actual</cap:status><cap:msgType>Cancel</cap:msgType>
    <cap:effective>2026/8/30 下午 05:47:00</cap:effective><cap:expires>2026/8/30 下午 08:47:00</cap:expires>
  </entry><entry>
    <id>OUTSIDE-1</id><title>地震</title><updated>2026-08-30T16:00:00+08:00</updated>
    <author><name>未知來源</name></author><link rel="alternate" href="https://example.test/outside.cap" />
    <summary>非官方 record URL。</summary><category term="地震" />
    <cap:status>Actual</cap:status><cap:msgType>Update</cap:msgType>
  </entry>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.1">
      <id>https://alerts.ncdr.nat.gov.tw/RSS.aspx</id><rights>${rights}</rights>${active}${extra}
    </feed>`;
}
