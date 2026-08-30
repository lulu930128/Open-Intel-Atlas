import assert from "node:assert/strict";
import test from "node:test";

import { politicsSources } from "../src/atlasAdaptersPolitics.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { loadConfig } from "../src/config.js";

const NOW = "2026-08-30T08:00:00.000Z";

test("台灣官方來源由 canonical registry 揭露，通過 bounded Node smoke 後才 default enabled", () => {
  const registry = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" }));
  const ids = [
    "tw-president-office-news",
    "tw-executive-yuan-news",
    "tw-mofa-press-releases"
  ];

  for (const id of ids) {
    const source = registry.get(id);
    assert.ok(source, `missing source ${id}`);
    assert.equal(source.authorityClass, "official");
    assert.deepEqual(source.countries, ["TW"]);
    assert.deepEqual(source.languages, ["zh-TW"]);
    assert.equal(source.requiredConfig.length, 0);
  }

  assert.equal(registry.get("tw-president-office-news").enabled, true);
  assert.equal(registry.get("tw-executive-yuan-news").enabled, true);
  assert.equal(registry.get("tw-mofa-press-releases").enabled, true);
  assert.equal(registry.get("tw-mofa-press-releases").disabledReason, null);
});

test("總統府 JSON 會清理 HTML、轉換台灣時間並保留 candidate media", async () => {
  const source = getSource("tw-president-office-news");
  let requestedUrl = null;
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      async getJson(url) {
        requestedUrl = String(url);
        const data = [{
          PublishDate: "2026/8/30 下午 12:50:00",
          Title: "【<span lang=\"EN-US\">2026</span>大事】總統府發布消息",
          Description: "第一段政策說明。\n\n第二段補充。",
          URL: "https://www.president.gov.tw/NEWS/40299",
          Images: [{
            FileTitle: "<p>總統府官方照片</p>",
            FileUrl: "https://www.president.gov.tw/img/Image/example.jpg"
          }],
          Videos: []
        }];
        return fetchFixture(url, data);
      }
    }
  });

  assert.equal(requestedUrl, "https://www.president.gov.tw/Handler/GetNews.ashx");
  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.title, "【2026大事】總統府發布消息");
  assert.equal(document.published_at, "2026-08-30T04:50:00.000Z");
  assert.equal(document.publisher_key, "tw-president-office");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.location, null);
  assert.equal(document.media.length, 1);
  assert.equal(document.media[0].origin, "official");
  assert.equal(document.media[0].display_policy, "candidate");
  assert.equal(document.media[0].alt_text, "總統府官方照片");
});

test("行政院 RSS 形成 Document-only 官方證據", async () => {
  const source = getSource("tw-executive-yuan-news");
  let requestedUrl = null;
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      async getText(url) {
        requestedUrl = String(url);
        return fetchFixture(url, officialRssFixture());
      }
    }
  });

  assert.equal(requestedUrl, "https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3");
  assert.equal(result.documents.length, 1);
  const [document] = result.documents;
  assert.equal(document.canonical_url, "https://agency.example.gov.tw/News/123?x=1&y=2");
  assert.equal(document.summary, "官方發布內容與補充資料。");
  assert.equal(document.published_at, "2026-08-28T03:55:00.000Z");
  assert.equal(document.publisher_key, "tw-executive-yuan");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.location, null);
});

test("外交部使用有界官方新聞分頁，保留日期精度且不抓取歷史全集", async () => {
  const source = getSource("tw-mofa-press-releases");
  let requestedUrl = null;
  const result = await source.run({
    source,
    now: () => NOW,
    http: {
      async getText(url) {
        requestedUrl = String(url);
        return fetchFixture(url, mofaNewsListFixture());
      }
    }
  });

  assert.equal(requestedUrl, "https://www.mofa.gov.tw/News.aspx?PageSize=30&n=96&sms=74");
  assert.equal(result.documents.length, 2);
  const [document] = result.documents;
  assert.equal(document.canonical_url, "https://www.mofa.gov.tw/News_Content.aspx?n=96&s=122972");
  assert.equal(document.title, "外交部長出席「太平洋繁榮特展」");
  assert.equal(document.published_at, "2026-08-28T16:00:00.000Z");
  assert.equal(document.publisher_key, "tw-mofa");
  assert.equal(document.raw_metadata.timestamp_precision, "date");
  assert.equal(document.raw_metadata.event_eligible, false);
  assert.equal(document.raw_metadata.evidence_support, true);
  assert.equal(document.raw_metadata.location, null);
});

test("外交部官方頁面結構無法辨識時 fail closed", async () => {
  const source = getSource("tw-mofa-press-releases");
  await assert.rejects(
    source.run({
      source,
      now: () => NOW,
      http: { getText: async (url) => fetchFixture(url, "<html><main>unexpected</main></html>") }
    }),
    /no parseable press-release rows/
  );
});

test("空或 malformed payload 不產生文件，provider error 不會被吞掉", async () => {
  const president = getSource("tw-president-office-news");
  const emptyJson = await president.run({
    source: president,
    now: () => NOW,
    http: { getJson: async (url) => fetchFixture(url, { unexpected: true }) }
  });
  assert.deepEqual(emptyJson.documents, []);

  const executiveYuan = getSource("tw-executive-yuan-news");
  const malformedFeed = await executiveYuan.run({
    source: executiveYuan,
    now: () => NOW,
    http: { getText: async (url) => fetchFixture(url, "<rss><channel><item>truncated") }
  });
  assert.deepEqual(malformedFeed.documents, []);

  await assert.rejects(
    executiveYuan.run({
      source: executiveYuan,
      now: () => NOW,
      http: { getText: async () => { throw new Error("HTTP 429 rate limited"); } }
    }),
    /429 rate limited/
  );
});

function getSource(id) {
  const source = politicsSources.find((entry) => entry.id === id);
  assert.ok(source, `missing politics source ${id}`);
  return source;
}

function fetchFixture(url, data) {
  const rawPayload = typeof data === "string" ? data : JSON.stringify(data);
  return {
    url: String(url),
    status: 200,
    contentType: typeof data === "string" ? "application/rss+xml" : "application/json",
    etag: null,
    lastModified: null,
    rawPayload,
    payloadTruncated: false,
    data
  };
}

function officialRssFixture() {
  return `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0"><channel><item>
      <title><![CDATA[官方發布標題]]></title>
      <link>https://agency.example.gov.tw/News/123?x=1&amp;y=2</link>
      <description><![CDATA[<p>官方發布內容與補充資料。</p>]]></description>
      <author>news@example.gov.tw (官方機關)</author>
      <pubDate>Fri, 28 Aug 2026 03:55:00 GMT</pubDate>
    </item></channel></rss>`;
}

function mofaNewsListFixture() {
  return `<!doctype html><html><body><table><tbody>
    <tr><td class="is-center" data-title="發布時間"><span>2026-08-29</span></td>
      <td class="is-left" data-title="主旨"><span><a href="News_Content.aspx?n=96&amp;s=122972">外交部長出席「太平洋繁榮特展」</a></span></td></tr>
    <tr><td data-title='發布時間'><span>2026-08-28</span></td>
      <td data-title='主旨'><span><a title="第二則" href='/News_Content.aspx?n=96&amp;s=122967'><em>外交部歡迎</em>智庫學者訪團</a></span></td></tr>
  </tbody></table></body></html>`;
}
