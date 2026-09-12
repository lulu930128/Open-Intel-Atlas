import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourceResult } from "../src/atlasContracts.js";
import { processSourceResult } from "../src/atlasPipeline.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { createIntelDocument } from "../src/documents/normalize.js";

const now = "2026-09-06T01:00:00.000Z";

test("official master -> identifier resolver -> story -> event uses one canonical company", () => {
  withStore((store) => {
    const source = fixtureSource();
    store.registerSources([source], now);
    const runId = store.beginSourceRun(source, now);
    const document = createIntelDocument(source, {
      externalId: "2330-material-1",
      title: "台積公司董事會決議",
      summary: "台積公司公告董事會決議。",
      url: "https://example.test/2330/1",
      publishedAt: now,
      eventKey: "2330-material-1",
      eventTypeCandidate: "finance.corporate",
      rawMetadata: {
        entity_hints: [{
          name: "台積公司",
          role: "issuer",
          identifier: { namespace: "ticker", authority: "TWSE", scope: "TWSE", value: "2330" }
        }]
      }
    }, now);
    const result = createSourceResult({
      source,
      startedAt: now,
      finishedAt: now,
      documents: [document],
      entities: [{
        id: "company:tw:2330",
        entity_type: "company",
        canonical_name: "台灣積體電路製造股份有限公司",
        country_code: "TW",
        master_authority: "official",
        aliases: ["台積公司", "台積電", "TSMC"],
        identifiers: [{ namespace: "ticker", authority: "TWSE", scope: "TWSE", value: "2330" }],
        metadata: { exchange: "TWSE", ticker: "2330" }
      }],
      counts: { upstream_item_count: 1, processed_item_count: 1 },
      completeness: { status: "complete", snapshot_complete: true }
    });

    const persisted = processSourceResult(store, runId, result, now);
    const entity = store.getEntity("company:tw:2330");
    const event = store.listEvents({ limit: 5 }).items[0];
    assert.equal(persisted.entityCount, 1);
    assert.ok(persisted.snapshotId);
    assert.equal(entity.canonical_name, "台灣積體電路製造股份有限公司");
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM document_entity_mentions").get().count, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM story_entity_links").get().count, 1);
    assert.deepEqual(store.getEvent(event.id).entities.map((item) => item.id), ["company:tw:2330"]);

    store.ingestEntityMaster({
      sourceId: source.id,
      sourceRunId: runId,
      entities: [{ ...result.entities[0], canonical_name: "新聞中的簡稱", allow_canonical_update: false, aliases: [], identifiers: [] }],
      completeness: {}
    }, now);
    assert.equal(store.getEntity("company:tw:2330").canonical_name, "台灣積體電路製造股份有限公司");
  });
});

function fixtureSource() {
  return {
    id: "company-fixture",
    name: "Company fixture",
    providerType: "official_json",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "corporate_disclosure",
    domains: ["finance"],
    languages: ["zh-Hant"],
    countries: ["TW"],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Fixture",
    policyNote: "Test only",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    catchupMode: "latest_only",
    cadence: "1m",
    mediaPolicy: {},
    coverage: { capabilities: ["company.master", "company.disclosures"], markets: ["TWSE"], guarantee: "complete_snapshot" }
  };
}

function withStore(run) {
  const root = mkdtempSync(join(tmpdir(), "atlas-entity-pipeline-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
