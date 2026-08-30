import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCountryEventMap,
  buildEventQuery,
  eventToMapPoint,
  eventToMapRecord,
  fetchCanonicalEvents,
  getFeatureAlpha2
} from "../public/atlasMapModel.js";

test("Map v1 query 使用 canonical domain、UTC range 與 cursor", () => {
  const query = new URLSearchParams(buildEventQuery({
    domain: "hazards",
    range: "24h",
    cursor: "next page",
    limit: 200,
    now: new Date("2026-08-30T08:00:00.000Z")
  }));
  assert.equal(query.get("domain"), "hazards");
  assert.equal(query.get("from"), "2026-08-29T08:00:00.000Z");
  assert.equal(query.get("cursor"), "next page");
  assert.equal(query.get("limit"), "200");
  assert.equal(new URLSearchParams(buildEventQuery({ domain: "infrastructure", range: "all" })).has("domain"), false);
});

test("Map client 逐頁讀取 v1 cursor、去重，並如實標記 cap truncation", async () => {
  const calls = [];
  const pages = new Map([
    ["", page([{ id: "event-1" }, { id: "event-2" }], "cursor-1")],
    ["cursor-1", page([{ id: "event-2" }, { id: "event-3" }], null)]
  ]);
  const fetchImpl = async (url) => {
    calls.push(url);
    const cursor = new URL(url, "http://atlas.test").searchParams.get("cursor") || "";
    return { ok: true, status: 200, json: async () => pages.get(cursor) };
  };

  const result = await fetchCanonicalEvents(fetchImpl, { range: "all", maxEvents: 10, limit: 2 });
  assert.deepEqual(result.events.map((event) => event.id), ["event-1", "event-2", "event-3"]);
  assert.equal(result.pageCount, 2);
  assert.equal(result.truncated, false);
  assert.ok(calls.every((url) => url.startsWith("/api/v1/events?")));
  assert.ok(calls.every((url) => !url.includes("/api/dashboard")));

  const capped = await fetchCanonicalEvents(async () => ({
    ok: true,
    status: 200,
    json: async () => page([{ id: "event-1" }, { id: "event-2" }], "more")
  }), { range: "all", maxEvents: 2, limit: 2 });
  assert.equal(capped.events.length, 2);
  assert.equal(capped.truncated, true);
});

test("Map adapter 只接受 canonical finite 座標與 alpha-2 country code", () => {
  const zeroPoint = eventToMapPoint({
    id: "zero",
    title: "Prime meridian",
    primary_domain: "politics",
    event_severity: "medium",
    location: { latitude: 0, longitude: 0, country_code: "gb" }
  });
  assert.equal(zeroPoint.location.lat, 0);
  assert.equal(zeroPoint.location.lon, 0);
  assert.equal(zeroPoint.location.country_code, "GB");

  const locationOnly = eventToMapRecord({
    id: "location-only",
    title: "Taiwan appears in title but is not geo evidence",
    primary_domain: "technology",
    event_severity: "low",
    location: { latitude: null, longitude: null, country_code: null }
  });
  assert.equal(locationOnly.has_coordinates, false);
  assert.equal(locationOnly.location.country_code, "");
  assert.equal(eventToMapPoint({ ...locationOnly, location: { latitude: null, longitude: null } }), null);
  assert.equal(buildCountryEventMap([locationOnly]).size, 0, "title text must not infer a country");

  assert.equal(getFeatureAlpha2({ properties: { "ISO3166-1-Alpha-2": "TW", "ISO3166-1-Alpha-3": "TWN" } }), "TW");
  assert.equal(getFeatureAlpha2({ properties: { "ISO3166-1-Alpha-3": "TWN" } }), "");
});

test("正式 Full Map 只載入 canonical atlas module", () => {
  const html = readFileSync(new URL("../public/atlas.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/atlas.js", import.meta.url), "utf8");
  assert.match(html, /src="\/atlas\.js"/);
  assert.doesNotMatch(html, /\/app\.js|category-filter|geopolitics|infrastructure/);
  assert.doesNotMatch(script, /\/api\/dashboard|COUNTRY_HINTS|inferCountryCode/);
});

function page(data, nextCursor) {
  return {
    data,
    pagination: { count: data.length, next_cursor: nextCursor },
    coverage: { status: "full" },
    freshness: { status: "current" }
  };
}
