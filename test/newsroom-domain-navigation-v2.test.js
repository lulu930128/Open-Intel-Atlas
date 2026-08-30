import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  appendUniqueEvents,
  buildDomainEventsPath,
  domainAvailability,
  selectDomain
} from "../public/domainPageModel.js";

const registry = [
  { id: "politics", label_zh_hant: "政治", active: true },
  { id: "technology", label_zh_hant: "科技發展", active: true },
  { id: "archived", label_zh_hant: "封存", active: false }
];

test("domain page 只接受 backend registry 中啟用的 canonical domain", () => {
  assert.equal(selectDomain("?domain=politics", registry)?.label_zh_hant, "政治");
  assert.equal(selectDomain("?domain=archived", registry), null);
  assert.equal(selectDomain("?domain=infrastructure", registry), null);
  assert.equal(selectDomain("", registry), null);
});

test("domain event query 使用 bounded v1 cursor", () => {
  const path = buildDomainEventsPath("technology", { cursor: "next page", limit: 999 });
  const url = new URL(path, "http://atlas.test");
  assert.equal(url.pathname, "/api/v1/events");
  assert.equal(url.searchParams.get("domain"), "technology");
  assert.equal(url.searchParams.get("cursor"), "next page");
  assert.equal(url.searchParams.get("limit"), "200");
  assert.throws(() => buildDomainEventsPath("not valid"), /canonical domain id/);
});

test("domain pagination 會去重並遵守 client cap", () => {
  const current = [{ id: "event-1" }, { id: "event-2" }];
  const incoming = [{ id: "event-2" }, { id: "event-3" }, { title: "missing id" }];
  assert.deepEqual(appendUniqueEvents(current, incoming, 3).map((event) => event.id), ["event-1", "event-2", "event-3"]);
});

test("partial coverage 優先成為 domain outward state", () => {
  const result = domainAvailability({
    data: {
      freshness: { status: "stale", data_as_of: "2026-08-30T00:00:00.000Z" },
      coverage: { status: "partial", successful_sources: 2, expected_sources: 3 },
      warnings: [{ code: "SOURCE_FAILED" }]
    }
  });
  assert.equal(result.state, "partial");
  assert.equal(result.freshness.status, "stale");
  assert.equal(result.warnings.length, 1);
});

test("首頁摘要與共用 domain 子頁使用分層導覽", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const newsroom = readFileSync(new URL("../public/newsroom.js", import.meta.url), "utf8");
  const newsroomCss = readFileSync(new URL("../public/newsroom.css", import.meta.url), "utf8");
  const domainHtml = readFileSync(new URL("../public/domain.html", import.meta.url), "utf8");
  const domainClient = readFileSync(new URL("../public/domain.js", import.meta.url), "utf8");

  assert.match(index, /id="domain-overview"/);
  assert.match(index, /\/domain\.html\?domain=politics/);
  assert.doesNotMatch(index, /class="domain-grid"|data-domain-list=/);
  assert.match(newsroom, /slice\(0, 6\)/);
  assert.match(newsroom, /\/api\/v1\/domains/);
  assert.match(newsroom, /limit=2/);

  assert.match(domainHtml, /src="\/domain\.js"/);
  assert.match(domainHtml, /id="domain-load-more"/);
  assert.match(domainClient, /buildDomainEventsPath/);
  assert.match(domainClient, /\/api\/v1\/freshness\?domain=/);
  assert.match(domainClient, /\/api\/v1\/sources\?domain=/);
  assert.doesNotMatch(domainClient, /\/api\/dashboard|COUNTRY_HINTS|fetch\([^)]*https?:/);
  assert.match(newsroomCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(newsroomCss, /\.domain-warning p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});
