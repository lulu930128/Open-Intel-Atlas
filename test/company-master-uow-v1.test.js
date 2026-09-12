import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourceResult } from "../src/atlasContracts.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const now = "2026-09-06T10:00:00.000Z";

test("master persistence commits each upstream item and finalizes a non-authoritative partial snapshot", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-uow-"));
  const source = fixtureSource();
  const registry = { all: [source], enabled: [source], get: (id) => id === source.id ? source : null };
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(root, "atlas.sqlite"),
    HOST: "127.0.0.1",
    PORT: "1"
  });
  config.port = 0;
  const runtime = createAtlasRuntime({ config, registry, clock: () => new Date(now) });
  t.after(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });

  const result = await runtime.collector.runSource(source.id);
  assert.equal(result.status, "partial");
  assert.equal(result.processed_item_count, 1);
  assert.equal(result.failed_count, 1);
  assert.equal(result.entity_count, 2);
  assert.equal(result.relation_count, 1);
  assert.match(result.warnings[0], /^entity_master_item_persistence_failed:TWSE:0002$/);

  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) count FROM entities").get().count, 2);
  assert.equal(runtime.store.getEntity("company:good").canonical_name, "Good Company");
  assert.equal(runtime.store.getEntity("company:bad"), null);
  const snapshot = runtime.store.db.prepare("SELECT * FROM entity_master_snapshots").get();
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.snapshot_complete, 0);
  assert.equal(snapshot.member_count, 2);
  const persistedRun = runtime.store.db.prepare("SELECT processed_item_count, failed_count FROM source_runs WHERE id = ?").get(result.run_id);
  assert.equal(persistedRun.processed_item_count, 1);
  assert.equal(persistedRun.failed_count, 1);
});

function fixtureSource() {
  const source = {
    id: "company-uow-fixture",
    name: "Company UoW fixture",
    providerType: "official_json",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "company_master",
    domains: ["finance"],
    languages: ["en"],
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
    coverage: { capabilities: ["company.master"], markets: ["TWSE"], guarantee: "complete_snapshot", recoverability: "latest_only" }
  };
  const good = masterItem("good", "0001", "security:good");
  const bad = masterItem("bad", "0002", "security:missing");
  source.run = async () => createSourceResult({
    source,
    startedAt: now,
    finishedAt: now,
    fetches: { url: "https://example.test/master", status: 200, contentType: "application/json", rawPayload: "[]", payloadTruncated: false },
    masterItems: [good, bad],
    entities: [...good.entities, ...bad.entities],
    relations: [...good.relations, ...bad.relations],
    counts: { upstream_item_count: 2, processed_item_count: 2 },
    completeness: { status: "complete", snapshot_complete: true }
  });
  return source;
}

function masterItem(suffix, ticker, relationTarget) {
  return {
    key: `TWSE:${ticker}`,
    entities: [
      { id: `company:${suffix}`, entity_type: "company", canonical_name: `${capitalize(suffix)} Company`, master_authority: "official" },
      {
        id: `security:${suffix}`,
        entity_type: "security",
        canonical_name: `${ticker} Security`,
        master_authority: "official",
        identifiers: [{ namespace: "ticker", authority: "TWSE", scope: "TWSE", value: ticker }]
      }
    ],
    relations: [{ from_entity_id: `company:${suffix}`, to_entity_id: relationTarget, relation_type: "listed_as" }]
  };
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
