import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openAtlasStore } from "../src/atlasStore.js";
import { createAtlasCapabilities } from "../src/atlasCapabilities.js";
import { buildDomainUrl, buildEventsPath, withPresentation, companyStockUrl } from "../public/newsroomQueryModel.js";
import { buildStockNewsPath, stockTab } from "../public/stocksPageModel.js";

test("regional collections filter before LIMIT and paginate by time/id independently of relevance rank", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-regional-page-test-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const insert = store.db.prepare(`INSERT INTO events (id,event_type,title,summary,primary_domain,lifecycle,verification_status,event_severity,
    confidence,occurred_at,first_seen_at,last_updated_at,geo_scope,story_count,evidence_count,independent_source_count,
    has_primary_source,has_official_source,derivation_method,derivation_version,created_at,updated_at)
    VALUES (?,'finance.company',?,'summary','finance','ongoing','single_source','medium',0.8,?,?,?,'country',1,1,1,0,0,'fixture','1',?,?)`);
  const relevance = store.db.prepare(`INSERT INTO event_regional_relevance (event_id,region_code,score,reason_codes_json,evidence_json,method,version,evaluated_at)
    VALUES (?,?,?,'[]','[]','fixture','1',?)`);
  const story = store.db.prepare(`INSERT INTO stories (id,canonical_title,status,first_seen_at,last_seen_at,document_count,independent_source_count,cluster_method,cluster_version,created_at,updated_at)
    VALUES (?,?,'active',?,?,0,0,'fixture','1',?,?)`);
  for (let i = 0; i < 7; i++) {
    const id = `event-${i}`;
    const time = `2026-09-07T${String(10 + Math.floor(i / 2)).padStart(2, "0")}:00:00.000Z`;
    insert.run(id, id, time, time, time, time, time);
    store.db.prepare("INSERT INTO event_domains (event_id,domain,confidence) VALUES (?,'finance',0.9)").run(id);
    relevance.run(id, i === 6 ? "JP" : "TW", i % 2 ? 0.1 : 1, time);
    relevance.run(id, "EAST_ASIA", 1, time);
    story.run(`story-${i}`, `story-${i}`, time, time, time, time);
    store.db.prepare("INSERT INTO event_stories (event_id,story_id,relationship,confidence) VALUES (?,?,'primary',1)").run(id, `story-${i}`);
  }
  // A Story belongs to multiple matching Events: EXISTS must not duplicate it.
  store.db.prepare("INSERT INTO event_stories (event_id,story_id,relationship,confidence) VALUES ('event-1','story-0','supporting',1)").run();
  const api = createAtlasCapabilities({ store });
  for (const kind of ["eventsPage", "storiesPage"]) {
    let cursor;
    const ids = [];
    do {
      const page = api[kind]({ presentation: "taiwan_focus", limit: 2, cursor });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      assert.equal(page.query.presentation, "taiwan_focus");
      assert.ok(ids.length <= 6, "cursor must make progress");
    } while (cursor);
    assert.deepEqual(ids, [5,4,3,2,1,0].map((i) => `${kind === "eventsPage" ? "event" : "story"}-${i}`));
    const first = api[kind]({ presentation: "taiwan_focus", limit: 1 });
    for (const changed of [{ presentation: "japan_focus" }, { presentation: "global" }, { domain: "technology" }]) {
      assert.throws(() => api[kind]({ presentation: "taiwan_focus", cursor: first.next_cursor, ...changed }), /cursor/i);
    }
    assert.throws(() => api[kind]({ presentation: "invalid" }), /presentation/i);
    assert.throws(() => api[kind]({ presentation: "taiwan_focus", cursor: "not-a-cursor" }), /cursor/i);
  }
  assert.equal(api.eventsPage({ presentation: "east_asia" }).items.length, 7);
  assert.equal(api.eventsPage({ presentation: "japan_focus", domain: "politics" }).items.length, 0);
  assert.equal(api.eventsPage({}).items.length, 7);
});

test("URL scope and exact company routes survive navigation without guessing identity", () => {
  assert.equal(buildDomainUrl("finance", "taiwan_focus"), "/domain.html?domain=finance&presentation=taiwan_focus");
  assert.equal(withPresentation("/?presentation=taiwan_focus#latest", "global"), "/#latest");
  assert.match(buildEventsPath({ presentation: "japan_focus", cursor: "next", limit: 300 }), /limit=200/);
  assert.equal(companyStockUrl({ canonical_name: "2330" }), null);
  assert.equal(companyStockUrl({ securities: [{ exchange: "TWSE", ticker: "2330" }] }), "/stocks.html?exchange=TWSE&symbol=2330");
  assert.equal(stockTab("?tab=invalid"), "news");
  assert.equal(stockTab("?tab=evidence"), "evidence");
  assert.match(buildStockNewsPath({ exchange: "TPEX", symbol: "6488" }, "next page"), /cursor=next\+page/);
});
