import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hazardSources } from "../src/atlasAdaptersHazards.js";
import { politicsSources } from "../src/atlasAdaptersPolitics.js";
import { technologySources } from "../src/atlasAdaptersTechnology.js";
import { parseFeedItems } from "../src/atlasParsers.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const NOW = "2026-08-30T10:00:00.000Z";

test("日本官方核心來源由 canonical registry 揭露", () => {
  const registry = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" }));
  for (const id of ["jp-mod-news", "jp-jpcert-alerts", "jp-jma-eqvol"]) {
    const source = registry.get(id);
    assert.ok(source, `missing source ${id}`);
    assert.equal(source.authorityClass, "official");
    assert.deepEqual(source.countries, ["JP"]);
    assert.deepEqual(source.languages, ["ja"]);
    assert.equal(source.enabled, true);
  }
});

test("RSS 1.0 parser 保留 dc identifier 與 dc date", () => {
  const [item] = parseFeedItems(jpcertFixture());
  assert.equal(item.id, "at260024");
  assert.equal(item.publishedAt, "2026-08-15T14:31+09:00");
});

test("MOD 相對 URL 會解析成官方 absolute URL 並保持 Document-only", async () => {
  const source = getSource(politicsSources, "jp-mod-news");
  const result = await source.run({
    source,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, modFixture()) }
  });

  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.canonical_url, "https://www.mod.go.jp/j/press/news/2026/08/28h.html");
  assert.equal(document.publisher_key, "jp-mod");
  assert.equal(document.published_at, "2026-08-28T09:01:24.000Z");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.location, null);
});

test("JPCERT advisory 使用 CVE identity，但 promotion fail closed", async () => {
  const source = getSource(technologySources, "jp-jpcert-alerts");
  const result = await source.run({
    source,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, jpcertFixture()) }
  });

  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.external_id, "at260024");
  assert.equal(document.published_at, "2026-08-15T05:31:00.000Z");
  assert.equal(document.raw_metadata.event_key, "cve:CVE-2026-8452");
  assert.deepEqual(document.raw_metadata.cves, ["CVE-2026-8452"]);
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.location, null);
});

test("JMA Atom 只展開實際事件 XML，保留 EventID／Serial 與 provider coordinate", async () => {
  const source = getSource(hazardSources, "jp-jma-eqvol");
  const requests = [];
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      async getText(url) {
        requests.push(String(url));
        return fetchFixture(url, requests.length === 1 ? jmaFeedFixture() : jmaReportFixture());
      }
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(result.fetches.length, 2);
  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.raw_metadata.event_key, "jma:20260830170400_506");
  assert.equal(document.raw_metadata.serial, "1");
  assert.equal(document.raw_metadata.event_eligible, true);
  assert.equal(document.raw_metadata.raw_fetch_index, 1);
  assert.equal(document.raw_metadata.event_type_candidate, "hazards.volcano");
  assert.equal(document.raw_metadata.magnitude, null);
  assert.equal(document.raw_metadata.location.label, "桜島");
  assert.equal(document.raw_metadata.location.country_code, null);
  assert.ok(Math.abs(document.raw_metadata.location.latitude - 31.5925) < 0.0001);
  assert.ok(Math.abs(document.raw_metadata.location.longitude - 130.6566667) < 0.0001);
});

test("JMA 取消報不會成為 eligible Event", async () => {
  const source = getSource(hazardSources, "jp-jma-eqvol");
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      getText: async (url) => fetchFixture(url, String(url).includes("feed/") ? jmaFeedFixture() : jmaReportFixture("取消"))
    }
  });
  assert.equal(result.documents[0].raw_metadata.event_eligible, false);
});

test("JMA decimal-degree 震央座標與 magnitude 保持 provider truth", async () => {
  const source = getSource(hazardSources, "jp-jma-eqvol");
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      getText: async (url) => fetchFixture(url, String(url).includes("feed/") ? jmaEarthquakeFeedFixture() : jmaEarthquakeReportFixture())
    }
  });
  const [document] = result.documents;
  assert.equal(document.raw_metadata.event_type_candidate, "hazards.earthquake");
  assert.equal(document.raw_metadata.magnitude, 2.6);
  assert.equal(document.raw_metadata.location.label, "熊本県天草・芦北地方");
  assert.equal(document.raw_metadata.location.latitude, 32.3);
  assert.equal(document.raw_metadata.location.longitude, 130.5);
  assert.equal(document.raw_metadata.location.country_code, null);
});

test("日本三來源在 isolated canonical store 重跑保持 idempotent", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-jp-sources-"));
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const fullRegistry = buildSourceRegistry(config);
  const sources = ["jp-mod-news", "jp-jpcert-alerts", "jp-jma-eqvol"].map((id) => fullRegistry.get(id));
  const registry = {
    all: sources,
    enabled: sources,
    get(id) {
      return sources.find((source) => source.id === id) || null;
    }
  };
  const http = {
    async getText(url) {
      const value = String(url);
      if (value.endsWith("news.xml")) return fetchFixture(url, modFixture());
      if (value.endsWith("jpcert.rdf")) return fetchFixture(url, jpcertFixture());
      if (value.includes("feed/eqvol.xml")) return fetchFixture(url, jmaFeedFixture());
      if (value.endsWith("event.xml")) return fetchFixture(url, jmaReportFixture());
      throw new Error(`unexpected fixture URL: ${value}`);
    },
    async getJson(url) {
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
});

function getSource(sources, id) {
  const source = sources.find((entry) => entry.id === id);
  assert.ok(source, `missing source ${id}`);
  return source;
}

function fetchFixture(url, data) {
  return {
    url: String(url),
    status: 200,
    contentType: "application/xml",
    etag: null,
    lastModified: null,
    rawPayload: data,
    payloadTruncated: false,
    data
  };
}

function modFixture() {
  return `<rss version="2.0"><channel><item>
    <title>インドネシア共和国における国際緊急援助活動の実施について</title>
    <link>/j/press/news/2026/08/28h.html</link>
    <guid>/j/press/news/2026/08/28h.html</guid>
    <category>行政</category>
    <pubDate>Fri, 28 Aug 2026 18:01:24 +0900</pubDate>
  </item></channel></rss>`;
}

function jpcertFixture() {
  return `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <item rdf:about="https://www.jpcert.or.jp/at/2026/at260024.html">
      <title>注意喚起: NetScaler の脆弱性（CVE-2026-8452）に関する注意喚起</title>
      <link>https://www.jpcert.or.jp/at/2026/at260024.html</link>
      <dc:identifier>at260024</dc:identifier>
      <dc:date>2026-08-15T14:31+09:00</dc:date>
    </item>
  </rdf:RDF>`;
}

function jmaFeedFixture() {
  return `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>降灰予報（定時）</title><id>https://www.data.jma.go.jp/developer/xml/data/routine.xml</id><updated>2026-08-30T08:00:00Z</updated><link href="https://www.data.jma.go.jp/developer/xml/data/routine.xml"/><content>routine</content></entry>
    <entry><title>噴火に関する火山観測報</title><id>https://www.data.jma.go.jp/developer/xml/data/event.xml</id><updated>2026-08-30T08:04:55Z</updated><link href="https://www.data.jma.go.jp/developer/xml/data/event.xml"/><content>桜島で噴火</content></entry>
  </feed>`;
}

function jmaReportFixture(infoType = "発表") {
  return `<Report><Control><DateTime>2026-08-30T08:04:55Z</DateTime><Status>通常</Status><PublishingOffice>福岡管区気象台 鹿児島地方気象台</PublishingOffice></Control>
    <Head><Title>火山名 桜島 噴火に関する火山観測報</Title><ReportDateTime>2026-08-30T17:04:00+09:00</ReportDateTime><TargetDateTime>2026-08-30T16:58:00+09:00</TargetDateTime><EventID>20260830170400_506</EventID><InfoType>${infoType}</InfoType><Serial>1</Serial><InfoKind>噴火に関する火山観測報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion><Headline><Text>桜島で噴火を観測しました。</Text><Information><Item><Areas><Area><Name>桜島</Name><Code>506</Code></Area></Areas></Item></Information></Headline></Head>
    <Body><VolcanoInfo><Item><Areas><Area><Name>桜島</Name><Code>506</Code><Coordinate>+3135.55+13039.40+1117/</Coordinate></Area></Areas></Item></VolcanoInfo></Body>
  </Report>`;
}

function jmaEarthquakeFeedFixture() {
  return `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>震源・震度に関する情報</title><id>https://www.data.jma.go.jp/developer/xml/data/quake.xml</id><updated>2026-08-30T05:13:06Z</updated><link href="https://www.data.jma.go.jp/developer/xml/data/quake.xml"/><content>地震情報</content></entry></feed>`;
}

function jmaEarthquakeReportFixture() {
  return `<Report><Control><DateTime>2026-08-30T05:13:06Z</DateTime><Status>通常</Status><PublishingOffice>気象庁</PublishingOffice></Control>
    <Head><Title>震源・震度情報</Title><ReportDateTime>2026-08-30T14:13:00+09:00</ReportDateTime><TargetDateTime>2026-08-30T14:13:00+09:00</TargetDateTime><EventID>20260830141018</EventID><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>地震情報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion><Headline><Text>３０日１４時１０分ころ、地震がありました。</Text></Headline></Head>
    <Body><Earthquake><Hypocenter><Area><Name>熊本県天草・芦北地方</Name><Code>743</Code><jmx_eb:Coordinate>+32.3+130.5-10000/</jmx_eb:Coordinate></Area></Hypocenter><jmx_eb:Magnitude>2.6</jmx_eb:Magnitude></Earthquake></Body>
  </Report>`;
}
