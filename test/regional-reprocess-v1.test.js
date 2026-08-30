import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sourceFetchResult } from "../src/atlasContracts.js";
import { applyRegionalReprocess, planRegionalReprocess } from "../src/atlasReprocess.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { attachDocumentToStory } from "../src/atlasStories.js";
import { loadConfig } from "../src/config.js";
import { createIntelDocument } from "../src/documents/normalize.js";

test("bounded regional reprocess 在 schema-only copy apply-twice 保持冪等且不改 event country", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-reprocess-test-"));
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const canonical = buildSourceRegistry(config).get("jp-jma-eqvol");
  const source = {
    ...canonical,
    async run({ source: activeSource, now }) {
      const timestamp = now();
      const document = createIntelDocument(activeSource, {
        externalId: "reprocess-jma-1",
        canonicalUrl: "https://www.data.jma.go.jp/developer/xml/data/reprocess-jma-1.xml",
        title: "石川県能登地方 地震情報",
        summary: "日本氣象廳發布地震觀測。",
        observedAt: "2026-08-30T09:58:00.000Z",
        fetchedAt: timestamp,
        publisher: "気象庁",
        publisherKey: "jp-jma",
        language: "ja",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: "hazards.earthquake",
        eventKey: "jma:reprocess-1",
        rawSeverity: "medium",
        location: {
          label: "石川県能登地方",
          country_code: "JP",
          latitude: 37.3,
          longitude: 136.8,
          precision: "jmaxml-coordinate",
          confidence: 1
        },
        rawMetadata: { event_eligible: true, info_type: "発表", source_scope: "JP" }
      }, timestamp);
      const payload = "<fixture/>";
      return sourceFetchResult(activeSource, {
        url: "https://fixture.example.test/jma.xml",
        status: 200,
        contentType: "application/xml",
        etag: null,
        lastModified: null,
        rawPayload: payload,
        payloadTruncated: false,
        data: payload,
        fetchedAt: timestamp
      }, [document], timestamp, timestamp);
    }
  };
  const registry = {
    all: [source],
    enabled: [source],
    get(id) { return id === source.id ? source : null; }
  };
  const runtime = createAtlasRuntime({ config, registry });
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  await runtime.collector.runSource(source.id);
  const eventId = runtime.store.listEvents({ limit: 5 }).items[0].id;
  const locationBefore = runtime.store.db.prepare("SELECT event_id, country_code, latitude, longitude FROM event_locations ORDER BY id").all();
  const storyUpdatesBefore = runtime.store.getStats().story_updates;
  runtime.store.db.exec("DELETE FROM document_promotion_decisions; DELETE FROM event_regional_relevance;");

  const firstPlan = planRegionalReprocess(runtime.store, {
    maxDocuments: 10,
    maxEvents: 10,
    evaluatedAt: "2026-08-30T10:00:00.000Z"
  });
  assert.equal(firstPlan.assessment.safe_for_bounded_apply, true);
  assert.equal(firstPlan.assessment.changed_eligibility_count, 0);
  assert.equal(firstPlan.assessment.stranded_event_count, 0);
  assert.equal(firstPlan.assessment.promotion_write_candidates, 1);
  assert.equal(firstPlan.assessment.relevance_event_write_candidates, 1);
  assert.deepEqual(applyRegionalReprocess(runtime.store, firstPlan), {
    promotion_writes: 1,
    event_rebuild_writes: 0,
    relevance_event_writes: 1
  });

  assert.equal(runtime.store.getStats().document_promotion_decisions, 1);
  assert.equal(runtime.store.getStats().event_regional_relevance, 2);
  assert.equal(runtime.store.getStats().story_updates, storyUpdatesBefore + 1);
  assert.deepEqual(
    runtime.store.db.prepare("SELECT event_id, country_code, latitude, longitude FROM event_locations ORDER BY id").all(),
    locationBefore
  );
  assert.equal(runtime.capabilities.brief({ presentation: "japan_focus", limit: 5 }).data.event_count, 1);

  const secondPlan = planRegionalReprocess(runtime.store, {
    maxDocuments: 10,
    maxEvents: 10,
    evaluatedAt: "2026-08-30T10:01:00.000Z"
  });
  assert.equal(secondPlan.assessment.promotion_write_candidates, 0);
  assert.equal(secondPlan.assessment.relevance_event_write_candidates, 0);
  assert.deepEqual(applyRegionalReprocess(runtime.store, secondPlan), {
    promotion_writes: 0,
    event_rebuild_writes: 0,
    relevance_event_writes: 0
  });
  assert.equal(runtime.store.getStats().story_updates, storyUpdatesBefore + 1);

  const heldDocument = createIntelDocument(source, {
    externalId: "jma-supporting-held",
    canonicalUrl: "https://www.data.jma.go.jp/developer/xml/data/supporting.xml",
    title: "官方補充資料",
    summary: "不自行建立事件，但可支持相同 Event。",
    observedAt: "2026-08-30T09:59:00.000Z",
    fetchedAt: "2026-08-30T10:00:00.000Z",
    publisher: "気象庁",
    publisherKey: "jp-jma-support",
    language: "ja",
    domains: [{ domain: "hazards", confidence: 1 }],
    eventTypeCandidate: "hazards.volcano",
    eventKey: "jma:reprocess-1",
    location: { label: "Taiwan", countryCode: "TW", precision: "source-claim", confidence: 0.6 },
    rawMetadata: {
      event_eligible: false,
      evidence_support: true,
      source_scope: "TW"
    }
  }, "2026-08-30T10:00:00.000Z");
  const savedHeld = runtime.store.upsertDocument(heldDocument, null, null, "2026-08-30T10:00:00.000Z").document;
  attachDocumentToStory(runtime.store, savedHeld, "2026-08-30T10:00:00.000Z");

  const evidencePlan = planRegionalReprocess(runtime.store, {
    maxDocuments: 10,
    maxEvents: 10,
    evaluatedAt: "2026-08-30T10:00:02.000Z"
  });
  assert.equal(evidencePlan.assessment.safe_for_bounded_apply, true);
  assert.equal(evidencePlan.assessment.event_rebuild_write_candidates, 1);
  assert.equal(evidencePlan.assessment.events_with_new_supporting_evidence, 1);
  assert.equal(evidencePlan.assessment.new_supporting_evidence_links, 1);
  assert.equal(evidencePlan.assessment.regional_relevance_change_candidates, 1);
  assert.equal(evidencePlan.assessment.event_location_change_candidates, 0);
  const originalTitle = runtime.store.getEvent(eventId).title;
  runtime.store.db.prepare("UPDATE events SET title = ? WHERE id = ?").run("concurrent update", eventId);
  assert.throws(
    () => applyRegionalReprocess(runtime.store, evidencePlan),
    /stale Event plan/
  );
  runtime.store.db.prepare("UPDATE events SET title = ? WHERE id = ?").run(originalTitle, eventId);
  assert.deepEqual(applyRegionalReprocess(runtime.store, evidencePlan), {
    promotion_writes: 0,
    event_rebuild_writes: 1,
    relevance_event_writes: 0
  });

  const rebuilt = runtime.store.getEvent(eventId);
  assert.equal(rebuilt.evidence.length, 2);
  assert.equal(rebuilt.evidence.find((document) => document.id === savedHeld.id).supports, true);
  assert.ok(rebuilt.regional_relevance.some((entry) => entry.region_code === "TW"));
  assert.deepEqual(
    runtime.store.db.prepare("SELECT event_id, country_code, latitude, longitude FROM event_locations ORDER BY id").all(),
    locationBefore
  );

  const evidenceSecondPlan = planRegionalReprocess(runtime.store, {
    maxDocuments: 10,
    maxEvents: 10,
    evaluatedAt: "2026-08-30T10:00:03.000Z"
  });
  assert.equal(evidenceSecondPlan.assessment.event_rebuild_write_candidates, 0);
  assert.equal(evidenceSecondPlan.assessment.relevance_event_write_candidates, 0);

  const ordinaryHeldDocument = createIntelDocument(source, {
    externalId: "jma-ordinary-held",
    canonicalUrl: "https://www.data.jma.go.jp/developer/xml/data/ordinary-held.xml",
    title: "一般例行資料",
    summary: "未明確 opt-in，不應保留在 Event evidence。",
    observedAt: "2026-08-30T10:00:04.000Z",
    fetchedAt: "2026-08-30T10:00:04.000Z",
    publisher: "気象庁",
    publisherKey: "jp-jma-routine",
    language: "ja",
    domains: [{ domain: "hazards", confidence: 1 }],
    eventTypeCandidate: "hazards.earthquake",
    eventKey: "jma:reprocess-1",
    rawMetadata: { event_eligible: false, source_scope: "JP" }
  }, "2026-08-30T10:00:04.000Z");
  const savedOrdinaryHeld = runtime.store.upsertDocument(
    ordinaryHeldDocument,
    null,
    null,
    "2026-08-30T10:00:04.000Z"
  ).document;
  attachDocumentToStory(runtime.store, savedOrdinaryHeld, "2026-08-30T10:00:04.000Z");
  runtime.store.db.prepare(`
    INSERT INTO event_evidence (event_id, document_id, evidence_role, supports, confidence)
    VALUES (?, ?, 'official', 0, 0.98)
  `).run(eventId, savedOrdinaryHeld.id);

  const removalPlan = planRegionalReprocess(runtime.store, {
    maxDocuments: 10,
    maxEvents: 10,
    evaluatedAt: "2026-08-30T10:00:05.000Z"
  });
  assert.equal(removalPlan.assessment.events_with_non_supporting_evidence_removals, 1);
  assert.equal(removalPlan.assessment.non_supporting_evidence_removal_candidates, 1);
  assert.equal(removalPlan.event_rebuilds[0].non_supporting_evidence_removals, 1);
  assert.deepEqual(applyRegionalReprocess(runtime.store, removalPlan), {
    promotion_writes: 0,
    event_rebuild_writes: 1,
    relevance_event_writes: 0
  });
  const afterRemoval = runtime.store.getEvent(eventId);
  assert.equal(afterRemoval.evidence.some((document) => document.id === savedOrdinaryHeld.id), false);
  assert.equal(afterRemoval.evidence.some((document) => document.id === savedHeld.id), true);
});
