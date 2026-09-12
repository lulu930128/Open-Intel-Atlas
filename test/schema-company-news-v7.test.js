import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { SCHEMA_VERSION } from "../src/atlasSchema.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { openAtlasStore } from "../src/atlasStore.js";

test("schema v7 creates target scheduling and document observation ledgers", () => {
  withStore((store) => {
    assert.equal(SCHEMA_VERSION, 11);
    const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ["source_targets", "source_target_runs", "document_observations"]) {
      assert.ok(tables.has(table), `${table} should exist`);
    }
    assert.equal(store.db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version, 11);
  });
});

test("Yahoo targets are one source with five independently scheduled targets", () => {
  withStore((store) => {
    const now = "2026-09-06T10:00:00.000Z";
    const registry = buildSourceRegistry(loadConfig({
      ATLAS_AUTO_COLLECT: "false",
      ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial"
    }));
    store.registerSources(registry.all, now);
    store.registerSourceTargets(registry.all, now);
    const targets = store.listSourceTargets("yahoo-tw-stock-news");
    assert.equal(targets.length, 5);
    assert.equal(store.listDueSourceTargets("yahoo-tw-stock-news", now, 10).length, 5);
    assert.deepEqual(targets.map((target) => target.identifier.value), ["2330", "2317", "2454", "3035", "6488"]);
  });
});

function withStore(run) {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-news-v7-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
