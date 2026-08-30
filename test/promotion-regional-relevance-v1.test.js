import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sourceFetchResult } from "../src/atlasContracts.js";
import {
  deriveRegionalRelevance,
  evaluateDocumentPromotion,
  promotionAllowsEventCreation,
  promotionAllowsEvidenceAttachment,
  promotionAllowsEvidenceSupport
} from "../src/atlasPromotion.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";
import { createIntelDocument } from "../src/documents/normalize.js";

const NOW = "2026-08-30T10:00:00.000Z";

test("PromotionDecision 對 routine、structured event 與 provider cancellation 給出可稽核理由", () => {
  const routine = evaluateDocumentPromotion({
    source_id: "jp-mod-news",
    document_type: "official_statement",
    raw_metadata: { event_eligible: false }
  }, NOW);
  assert.equal(routine.status, "held");
  assert.equal(routine.eligible, false);
  assert.ok(routine.reason_codes.includes("provider_explicit_ineligible"));

  const observation = evaluateDocumentPromotion({
    source_id: "jp-jma-eqvol",
    document_type: "hazard_observation",
    raw_metadata: { event_eligible: true, event_key: "jma:event-1", location: { label: "桜島" } }
  }, NOW);
  assert.equal(observation.status, "promoted");
  assert.equal(observation.eligible, true);
  assert.ok(observation.reason_codes.includes("provider_structured_event"));

  const cancellation = evaluateDocumentPromotion({
    source_id: "jp-jma-eqvol",
    document_type: "hazard_observation",
    raw_metadata: { event_eligible: false, info_type: "取消", event_key: "jma:event-1" }
  }, NOW);
  assert.equal(cancellation.status, "cancelled");
  assert.equal(cancellation.eligible, false);
  assert.deepEqual(cancellation.reason_codes.slice(0, 1), ["provider_cancelled"]);
  assert.equal(promotionAllowsEventCreation(routine), false);
  assert.equal(promotionAllowsEvidenceAttachment(routine, { raw_metadata: {} }), false);
  assert.equal(promotionAllowsEvidenceAttachment(routine, { raw_metadata: { evidence_support: true } }), true);
  assert.equal(promotionAllowsEvidenceAttachment(cancellation, { raw_metadata: {} }), true);
  assert.equal(promotionAllowsEvidenceAttachment(null, { event_eligible: false, raw_metadata: {} }), false);
  assert.equal(promotionAllowsEvidenceSupport(routine, { raw_metadata: {} }), false);
  assert.equal(promotionAllowsEvidenceSupport(routine, { raw_metadata: { evidence_support: true } }), true);
  assert.equal(promotionAllowsEventCreation(cancellation), false);
  assert.equal(promotionAllowsEvidenceSupport(cancellation, { raw_metadata: { evidence_support: true } }), false);
});

test("RegionalRelevance 分開保存 event country 與 official source scope", () => {
  const relevance = deriveRegionalRelevance({
    locations: [{ id: "location:tw", country_code: "TW" }]
  }, [{
    id: "doc:jp",
    source_id: "jp-jma-eqvol",
    authority_class: "official",
    source_countries: ["JP"],
    raw_metadata: { source_scope: "JP" }
  }], NOW);

  const taiwan = relevance.find((entry) => entry.region_code === "TW");
  const japan = relevance.find((entry) => entry.region_code === "JP");
  assert.equal(taiwan.score, 1);
  assert.deepEqual(taiwan.reason_codes, ["event_location_country"]);
  assert.equal(japan.score, 0.75);
  assert.deepEqual(japan.reason_codes, ["official_source_scope"]);
});

test("只有明確 opt-in 的 held official evidence 可支持既有 Event，普通 held 不會附掛或推進 freshness", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-held-evidence-"));
  const held = fixtureEvidenceSource({
    id: "jp-jpcert-held-fixture",
    authorityClass: "official",
    countries: ["JP"],
    eventEligible: false,
    evidenceSupport: true,
    eventKey: "cve:CVE-2026-8452",
    title: "JPCERT advisory for CVE-2026-8452",
    publishedAt: "2026-08-30T09:55:00.000Z",
    sourceScope: "JP"
  });
  const trigger = fixtureEvidenceSource({
    id: "cisa-trigger-fixture",
    authorityClass: "official",
    countries: ["US"],
    eventEligible: true,
    eventKey: "cve:CVE-2026-8452",
    title: "CISA advisory for CVE-2026-8452",
    publishedAt: "2026-08-30T10:00:00.000Z",
    location: { label: "United States", countryCode: "US", precision: "country", confidence: 1 }
  });
  const ordinaryHeld = fixtureEvidenceSource({
    id: "ordinary-held-fixture",
    authorityClass: "official",
    countries: ["JP"],
    eventEligible: false,
    eventKey: "cve:CVE-2026-8452",
    title: "Routine release that must stay document-only",
    publishedAt: "2026-08-30T11:00:00.000Z",
    sourceScope: "JP"
  });
  const runtime = fixtureRuntime(tempRoot, [held, trigger, ordinaryHeld]);
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  await runtime.collector.runSource(held.id);
  assert.equal(runtime.store.getStats().stories, 1);
  assert.equal(runtime.store.getStats().events, 0, "held-only Story must not create an Event");

  await runtime.collector.runSource(trigger.id);
  const event = runtime.store.getEvent(runtime.store.listEvents({ limit: 5 }).items[0].id);
  assert.equal(event.evidence.length, 2);
  assert.equal(event.evidence.find((item) => item.source_id === held.id).supports, true);
  assert.equal(event.location.country_code, "US");
  assert.equal(event.regional_relevance.find((entry) => entry.region_code === "JP").score, 0.75);
  assert.equal(runtime.store.listEventsByRegionalRelevance({ regions: ["JP"], limit: 5 }).items[0].id, event.id);

  const lastUpdatedBeforeOrdinaryHeld = event.last_updated_at;
  await runtime.collector.runSource(ordinaryHeld.id);
  const afterOrdinaryHeld = runtime.store.getEvent(event.id);
  assert.equal(afterOrdinaryHeld.evidence.length, 2);
  assert.equal(afterOrdinaryHeld.evidence.some((item) => item.source_id === ordinaryHeld.id), false);
  assert.equal(afterOrdinaryHeld.last_updated_at, lastUpdatedBeforeOrdinaryHeld);
  assert.equal(afterOrdinaryHeld.representative_document_id, event.representative_document_id);
});

test("held + held 與 cancellation-only Story 都不建立 Event", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-no-trigger-"));
  const firstHeld = fixtureEvidenceSource({
    id: "held-one",
    authorityClass: "official",
    countries: ["JP"],
    eventEligible: false,
    evidenceSupport: true,
    eventKey: "shared-held-key",
    title: "Routine official release one",
    sourceScope: "JP"
  });
  const secondHeld = fixtureEvidenceSource({
    id: "held-two",
    authorityClass: "professional_media",
    countries: ["JP"],
    eventEligible: false,
    evidenceSupport: true,
    eventKey: "shared-held-key",
    title: "Routine official release two"
  });
  const cancellation = fixtureEvidenceSource({
    id: "cancel-only",
    authorityClass: "official",
    countries: ["JP"],
    eventEligible: false,
    eventKey: "cancel-without-trigger",
    title: "Provider cancellation",
    sourceScope: "JP",
    providerStatus: "cancelled"
  });
  const runtime = fixtureRuntime(tempRoot, [firstHeld, secondHeld, cancellation]);
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  await runtime.collector.runSource(firstHeld.id);
  await runtime.collector.runSource(secondHeld.id);
  await runtime.collector.runSource(cancellation.id);
  assert.equal(runtime.store.getStats().events, 0);
});

test("durable promotion/relevance 讓 JMA cancellation 收斂既有 Event lifecycle", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "open-intel-atlas-promotion-"));
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const canonical = buildSourceRegistry(config).get("jp-jma-eqvol");
  const observedBase = Date.now() - 5 * 60 * 1000;
  let runNumber = 0;
  const source = {
    ...canonical,
    async run({ source: activeSource, now }) {
      runNumber += 1;
      const timestamp = now();
      const cancelled = runNumber > 1;
      const document = createIntelDocument(activeSource, {
        externalId: cancelled ? "jma-report-cancel" : "jma-report-1",
        canonicalUrl: `https://www.data.jma.go.jp/developer/xml/data/${cancelled ? "cancel" : "event"}.xml`,
        title: cancelled ? "火山観測報 取消" : "桜島 噴火に関する火山観測報",
        summary: cancelled ? "先の情報を取り消します。" : "桜島で噴火を観測しました。",
        observedAt: new Date(observedBase + (cancelled ? 4 * 60 * 1000 : 0)).toISOString(),
        fetchedAt: timestamp,
        publisher: "気象庁",
        publisherKey: "jp-jma",
        language: "ja",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: "hazards.volcano",
        eventKey: "jma:event-1",
        rawSeverity: "medium",
        location: { label: "桜島", latitude: 31.5925, longitude: 130.6567, precision: "jmaxml-coordinate", confidence: 1 },
        rawMetadata: {
          event_eligible: !cancelled,
          info_type: cancelled ? "取消" : "発表",
          source_scope: "JP"
        }
      }, timestamp);
      return sourceFetchResult(activeSource, fixtureFetch(timestamp, runNumber), [document], timestamp, timestamp);
    }
  };
  const registry = {
    all: [source],
    enabled: [source],
    get(id) {
      return id === source.id ? source : null;
    }
  };
  const runtime = createAtlasRuntime({ config, registry });
  t.after(async () => {
    await runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const first = await runtime.collector.runSource(source.id);
  assert.equal(first.event_count, 1);
  const firstEvent = runtime.store.listEvents({ limit: 5 }).items[0];
  assert.notEqual(firstEvent.lifecycle, "cancelled");
  assert.equal(firstEvent.location.country_code, null);
  assert.equal(firstEvent.regional_relevance.find((entry) => entry.region_code === "JP").score, 0.75);
  const japanBrief = runtime.capabilities.brief({ presentation: "japan_focus", limit: 5 });
  assert.equal(japanBrief.data.event_count, 1);
  assert.equal(japanBrief.data.highlights[0].id, firstEvent.id);
  assert.equal(japanBrief.data.selection.presentation, "japan_focus");
  assert.equal(runtime.capabilities.brief({ presentation: "taiwan_focus", limit: 5 }).data.event_count, 0);

  const firstDocument = runtime.store.listDocuments({ source: source.id, limit: 5 }).items[0];
  assert.equal(firstDocument.promotion_decision.status, "promoted");
  assert.equal(firstDocument.promotion_decision.method, "deterministic-document-promotion");

  const second = await runtime.collector.runSource(source.id);
  assert.equal(second.event_count, 1);
  const cancelledEvent = runtime.store.listEvents({ limit: 5 }).items[0];
  assert.equal(cancelledEvent.lifecycle, "cancelled");
  assert.equal(cancelledEvent.verification_status, "retracted");
  assert.equal(cancelledEvent.evidence_count, 2);
  assert.equal(
    runtime.store.getEvent(cancelledEvent.id).evidence
      .find((document) => document.promotion_decision?.status === "cancelled").supports,
    false
  );
  const cancelledBrief = runtime.capabilities.brief({ presentation: "japan_focus", limit: 5 });
  assert.equal(cancelledBrief.data.event_count, 0);
  assert.ok(cancelledBrief.data.selection.coverage_gaps.includes("no_qualified_regional_events"));

  const documents = runtime.store.listDocuments({ source: source.id, limit: 5 }).items;
  assert.equal(documents.find((document) => document.external_id === "jma-report-cancel").promotion_decision.status, "cancelled");
  assert.equal(runtime.store.getStats().document_promotion_decisions, 2);
  assert.equal(runtime.store.getStats().event_regional_relevance, 2);
});

function fixtureFetch(timestamp, runNumber) {
  const body = `<fixture run="${runNumber}"/>`;
  return {
    url: `https://fixture.example.test/jma/${runNumber}.xml`,
    status: 200,
    contentType: "application/xml",
    etag: null,
    lastModified: null,
    rawPayload: body,
    payloadTruncated: false,
    data: body,
    fetchedAt: timestamp
  };
}

function fixtureEvidenceSource(options) {
  const source = {
    id: options.id,
    name: options.id,
    providerType: "fixture",
    sourceClass: options.authorityClass === "official" ? "official_feed" : "publisher",
    authorityClass: options.authorityClass,
    documentType: "security_advisory",
    domains: ["technology"],
    languages: ["en"],
    countries: options.countries,
    homepage: `https://${options.id}.example.test`,
    docsUrl: `https://${options.id}.example.test/docs`,
    attribution: options.id,
    policyNote: "Test fixture",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    defaultEnabled: true,
    requiredConfig: [],
    async run({ now }) {
      const timestamp = now();
      const document = createIntelDocument(source, {
        externalId: `${options.id}-document`,
        canonicalUrl: `https://${options.id}.example.test/document`,
        title: options.title,
        summary: options.title,
        publishedAt: options.publishedAt || NOW,
        fetchedAt: timestamp,
        publisher: options.id,
        publisherKey: options.id,
        language: "en",
        domains: [{ domain: "technology", confidence: 1 }],
        eventTypeCandidate: "technology.cybersecurity",
        eventKey: options.eventKey,
        location: options.location,
        rawMetadata: {
          event_eligible: options.eventEligible,
          evidence_support: options.evidenceSupport,
          source_scope: options.sourceScope,
          provider_status: options.providerStatus
        }
      }, timestamp);
      return sourceFetchResult(source, fixtureFetch(timestamp, 1), [document], timestamp, timestamp);
    }
  };
  return source;
}

function fixtureRuntime(tempRoot, sources) {
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(tempRoot, "atlas.sqlite")
  });
  const registry = {
    all: sources,
    enabled: sources,
    get(id) {
      return sources.find((source) => source.id === id) || null;
    }
  };
  return createAtlasRuntime({ config, registry });
}
