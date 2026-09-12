import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeAtlasSchema, SCHEMA_VERSION } from "../src/atlasSchema.js";
import { openAtlasStore } from "../src/atlasStore.js";

test("schema v7 保留完整 Entity Foundation 與 snapshot ledger", () => {
  withStore((store) => {
    assert.equal(SCHEMA_VERSION, 11);
    const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of [
      "entity_identifiers",
      "entity_relations",
      "entity_resolution_runs",
      "unresolved_entity_mentions",
      "document_entity_mentions",
      "story_entity_links",
      "entity_master_snapshots",
      "entity_master_snapshot_members"
    ]) {
      assert.ok(tables.has(table), `${table} should exist`);
    }

    const sourceRunColumns = columnNames(store, "source_runs");
    for (const column of [
      "upstream_item_count",
      "processed_item_count",
      "document_count",
      "entity_count",
      "relation_count",
      "intentionally_skipped_count",
      "failed_count",
      "truncated",
      "warnings_json"
    ]) {
      assert.ok(sourceRunColumns.has(column), `source_runs.${column} should exist`);
    }
    assert.ok(columnNames(store, "sources").has("coverage_json"));
  });
});

test("active official identifier 只在 authority + scope 內唯一", () => {
  withStore((store) => {
    const now = "2026-09-06T00:00:00.000Z";
    for (const id of ["security:twse:2330", "security:tpex:2330"]) {
      store.db.prepare(`
        INSERT INTO entities (id, entity_type, canonical_name, country_code, metadata_json, created_at, updated_at)
        VALUES (?, 'security', ?, 'TW', '{}', ?, ?)
      `).run(id, id, now, now);
    }
    const insert = store.db.prepare(`
      INSERT INTO entity_identifiers (
        id, entity_id, namespace, authority, scope, normalized_value, display_value,
        status, confidence, method, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'ticker', ?, ?, '2330', '2330', 'active', 1, 'official_identifier', '{}', ?, ?)
    `);
    insert.run("identifier:twse:2330", "security:twse:2330", "TWSE", "TWSE", now, now);
    insert.run("identifier:tpex:2330", "security:tpex:2330", "TPEx", "TPEx", now, now);
    assert.throws(
      () => insert.run("identifier:duplicate", "security:tpex:2330", "TWSE", "TWSE", now, now),
      /UNIQUE constraint failed/
    );
  });
});

test("v5-style aliases additive migration 保留資料並補 normalized provenance 欄位", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-entity-v6-migration-"));
  const path = join(root, "atlas.sqlite");
  let store = openAtlasStore(path);
  const now = "2026-08-30T00:00:00.000Z";
  store.db.prepare(`
    INSERT INTO entities (id, entity_type, canonical_name, country_code, metadata_json, created_at, updated_at)
    VALUES ('company:twse:2330', 'company', '台積電', 'TW', '{}', ?, ?)
  `).run(now, now);
  store.db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX IF EXISTS idx_entity_aliases_alias;
    DROP INDEX IF EXISTS idx_entity_aliases_normalized;
    ALTER TABLE entity_aliases RENAME TO entity_aliases_v6;
    CREATE TABLE entity_aliases (
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      language TEXT,
      PRIMARY KEY (entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
    INSERT INTO entity_aliases VALUES ('company:twse:2330', 'TSMC', 'en');
    DROP TABLE entity_aliases_v6;
    DELETE FROM schema_migrations WHERE version = 6;
    PRAGMA foreign_keys = ON;
  `);
  initializeAtlasSchema(store.db);
  const alias = store.db.prepare("SELECT * FROM entity_aliases WHERE entity_id = ?").get("company:twse:2330");
  assert.equal(alias.alias, "TSMC");
  assert.equal(alias.normalized_alias, "tsmc");
  assert.equal(alias.method, "legacy");
  assert.equal(store.db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version, 11);
  store.close();
  store = null;
  rmSync(root, { recursive: true, force: true });
});

function columnNames(store, table) {
  return new Set(store.db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function withStore(run) {
  const root = mkdtempSync(join(tmpdir(), "atlas-entity-v6-"));
  const store = openAtlasStore(join(root, "atlas.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
