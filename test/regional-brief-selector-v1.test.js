import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAtlasCapabilities } from "../src/atlasCapabilities.js";
import { selectBriefEvents, validatePresentation } from "../src/atlasBriefSelector.js";
import { openAtlasStore } from "../src/atlasStore.js";

const NOW = "2026-08-30T12:00:00.000Z";

test("regional brief 只選 qualified regional events，不用 global filler 補比例", () => {
  const events = [
    fixtureEvent("tw-politics", "politics", "TW", 1, "2026-08-30T11:00:00Z"),
    fixtureEvent("jp-hazard", "hazards", "JP", 0.75, "2026-08-30T11:30:00Z"),
    fixtureEvent("us-hazard", "hazards", null, 0, "2026-08-30T11:50:00Z")
  ];

  const result = selectBriefEvents(events, { presentation: "east_asia", limit: 8, now: NOW });
  assert.deepEqual(result.events.map((event) => event.id).sort(), ["jp-hazard", "tw-politics"]);
  assert.equal(result.selection.regional_qualified_count, 2);
  assert.equal(result.selection.selected_count, 2);
  assert.ok(result.selection.coverage_gaps.includes("qualified_event_shortfall"));
});

test("regional brief 沒有合格區域事件時回傳空集合與 gap", () => {
  const result = selectBriefEvents([
    fixtureEvent("global", "technology", null, 0, "2026-08-30T11:55:00Z")
  ], { presentation: "japan_focus", limit: 4, now: NOW });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.selection.coverage_gaps, ["no_qualified_regional_events", "qualified_event_shortfall"]);
});

test("quality gate 先排除 stale、cancelled 與 retracted，再做 soft diversity", () => {
  const events = [
    fixtureEvent("hazard-1", "hazards", "JP", 0.75, "2026-08-30T11:50:00Z"),
    fixtureEvent("hazard-2", "hazards", "JP", 0.75, "2026-08-30T11:40:00Z"),
    fixtureEvent("politics-1", "politics", "JP", 0.75, "2026-08-30T11:30:00Z"),
    { ...fixtureEvent("cancelled", "hazards", "JP", 1, "2026-08-30T11:59:00Z"), lifecycle: "cancelled" },
    { ...fixtureEvent("retracted", "politics", "JP", 1, "2026-08-30T11:59:00Z"), verification_status: "retracted" },
    fixtureEvent("stale", "hazards", "JP", 1, "2026-08-20T11:59:00Z")
  ];
  const result = selectBriefEvents(events, { presentation: "japan_focus", limit: 2, now: NOW });
  assert.deepEqual(result.events.map((event) => event.id), ["hazard-1", "politics-1"]);
  assert.equal(result.selection.quality_qualified_count, 3);
});

test("presentation profile validation fail closed", () => {
  assert.equal(validatePresentation("east_asia"), "east_asia");
  assert.equal(validatePresentation("unknown"), null);
});

test("regional brief 將 country 與 quality candidate policy 一起交給 Store，不混淆 presentation", () => {
  const japanEvent = fixtureEvent("jp-ranked-250", "technology", "JP", 1, "2026-08-30T11:00:00Z");
  const calls = [];
  const store = {
    listEvents(filters) {
      calls.push({ method: "global", filters });
      return { items: Array.from({ length: 200 }, (_, index) => fixtureEvent(`global-${index}`, "technology", null, 0, NOW)) };
    },
    listEventsByRegionalRelevance(filters) {
      calls.push({ method: "regional", filters });
      return { items: [japanEvent] };
    },
    listSources() {
      return [];
    },
    getDataAsOf() {
      return NOW;
    }
  };
  const result = createAtlasCapabilities({ store }).brief({ country: "US", presentation: "japan_focus", limit: 8 });

  assert.deepEqual(result.data.highlights.map((event) => event.id), [japanEvent.id]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "regional");
  assert.deepEqual(calls[0].filters.regions, ["JP"]);
  assert.equal(calls[0].filters.country, "US");
  assert.deepEqual(calls[0].filters.exclude_lifecycles, ["cancelled", "superseded"]);
  assert.deepEqual(calls[0].filters.exclude_verifications, ["retracted", "disputed", "unverified"]);
  assert.match(calls[0].filters.from, /^\d{4}-\d{2}-\d{2}T/);
});

test("Store 在 regional LIMIT 前排除 stale 與不合格狀態，低 relevance 的新事件不會被 250 筆舊資料餓死", (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-brief-prefilter-"));
  const store = openAtlasStore(join(tempRoot, "atlas.sqlite"));
  t.after(() => {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const now = new Date();
  const freshAt = now.toISOString();
  const staleAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const insertEvent = store.db.prepare(`
    INSERT INTO events (
      id, event_type, title, summary, primary_domain, lifecycle, verification_status,
      event_severity, confidence, occurred_at, first_seen_at, last_updated_at,
      geo_scope, story_count, evidence_count, independent_source_count,
      has_primary_source, has_official_source, representative_document_id,
      derivation_method, derivation_version, created_at, updated_at
    ) VALUES (?, 'technology.cybersecurity', ?, ?, 'technology', ?, ?,
      'medium', 0.8, ?, ?, ?, 'country', 1, 1, 1, 0, 1, NULL,
      'fixture', '1.0.0', ?, ?)
  `);
  const insertRelevance = store.db.prepare(`
    INSERT INTO event_regional_relevance (
      event_id, region_code, score, reason_codes_json, evidence_json, method, version, evaluated_at
    ) VALUES (?, 'JP', ?, '["official_source_scope"]', '[]', 'fixture', '1.0.0', ?)
  `);
  const add = (id, updatedAt, score, lifecycle = "emerging", verification = "official_confirmed") => {
    insertEvent.run(id, id, id, lifecycle, verification, updatedAt, updatedAt, updatedAt, updatedAt, updatedAt);
    insertRelevance.run(id, score, updatedAt);
  };

  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 250; index += 1) add(`stale-${String(index).padStart(3, "0")}`, staleAt, 1);
    add("fresh-qualified", freshAt, 0.75);
    add("fresh-cancelled", freshAt, 1, "cancelled");
    add("fresh-retracted", freshAt, 1, "emerging", "retracted");
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }

  const result = createAtlasCapabilities({ store }).brief({ presentation: "japan_focus", limit: 8 });
  assert.deepEqual(result.data.highlights.map((event) => event.id), ["fresh-qualified"]);
  assert.equal(result.data.selection.quality_qualified_count, 1);
  assert.ok(result.data.selection.coverage_gaps.includes("qualified_event_shortfall"));
});

function fixtureEvent(id, domain, region, relevance, updatedAt) {
  return {
    id,
    primary_domain: domain,
    lifecycle: "emerging",
    verification_status: "official_confirmed",
    event_severity: domain === "hazards" ? "high" : "medium",
    last_updated_at: updatedAt,
    regional_relevance: region
      ? [
          { region_code: region, score: relevance },
          { region_code: "EAST_ASIA", score: relevance }
        ]
      : []
  };
}
