import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { openAtlasStore } from "../src/atlasStore.js";
import { SCHEMA_VERSION } from "../src/atlasSchema.js";

const sourcePath = resolve(parseSourcePath(process.argv.slice(2)));

if (!existsSync(sourcePath)) {
  fail(`Atlas database does not exist: ${sourcePath}`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-intel-atlas-migration-"));
const copyPath = join(temporaryDirectory, "atlas.sqlite");
let sourceDatabase = null;
let snapshotDatabase = null;
let migratedStore = null;

try {
  sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
  sourceDatabase.exec("PRAGMA query_only = ON");
  const copiedPages = await backup(sourceDatabase, copyPath);
  sourceDatabase.close();
  sourceDatabase = null;

  snapshotDatabase = new DatabaseSync(copyPath, { readOnly: true });
  snapshotDatabase.exec("PRAGMA query_only = ON");
  const before = inspectDatabase(snapshotDatabase);
  snapshotDatabase.close();
  snapshotDatabase = null;

  migratedStore = openAtlasStore(copyPath);
  const after = inspectDatabase(migratedStore.db);
  const comparison = compareSnapshots(before, after);

  if (after.schema_version !== SCHEMA_VERSION) {
    comparison.errors.push(`Expected schema ${SCHEMA_VERSION}, received ${after.schema_version}`);
  }
  if (after.integrity_check !== "ok") {
    comparison.errors.push(`Integrity check failed: ${after.integrity_check}`);
  }
  if (after.foreign_key_violations.length > 0) {
    comparison.errors.push(`${after.foreign_key_violations.length} foreign-key violation(s) found`);
  }

  const result = {
    status: comparison.errors.length === 0 ? "passed" : "failed",
    mode: "read-only-source-copy-replay",
    source_database: sourcePath,
    copied_bytes: statSync(copyPath).size,
    copied_pages: copiedPages,
    expected_schema_version: SCHEMA_VERSION,
    before,
    after,
    comparison
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (comparison.errors.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "read-only-source-copy-replay",
    source_database: sourcePath,
    error_type: error?.name || "Error",
    error_message: String(error?.message || error)
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  migratedStore?.close();
  snapshotDatabase?.close();
  sourceDatabase?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function inspectDatabase(database) {
  const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  const counts = Object.fromEntries(tables.map((table) => [table, countRows(database, table)]));
  const migrationRows = tables.includes("schema_migrations")
    ? database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
    : [];

  return {
    schema_version: migrationRows.length > 0 ? Number(migrationRows.at(-1).version) : 0,
    migration_versions: migrationRows.map((row) => Number(row.version)),
    integrity_check: String(database.prepare("PRAGMA integrity_check").get().integrity_check),
    foreign_key_violations: database.prepare("PRAGMA foreign_key_check").all(),
    table_counts: counts
  };
}

function compareSnapshots(before, after) {
  const ignoredTables = new Set(["schema_migrations"]);
  const preservedTables = Object.keys(before.table_counts).filter((table) => !ignoredTables.has(table));
  const count_mismatches = [];

  for (const table of preservedTables) {
    const beforeCount = before.table_counts[table];
    const afterCount = after.table_counts[table];
    if (afterCount !== beforeCount) {
      count_mismatches.push({ table, before: beforeCount, after: afterCount ?? null });
    }
  }

  const added_tables = Object.keys(after.table_counts).filter((table) => !(table in before.table_counts));
  const nonempty_added_tables = added_tables
    .filter((table) => after.table_counts[table] !== 0)
    .map((table) => ({ table, count: after.table_counts[table] }));
  const errors = [];
  if (count_mismatches.length > 0) errors.push("Existing table counts changed during migration replay");
  if (nonempty_added_tables.length > 0) errors.push("New migration tables were not empty after schema-only replay");

  return {
    preserved_table_count: preservedTables.length,
    count_mismatches,
    added_tables,
    nonempty_added_tables,
    errors
  };
}

function countRows(database, table) {
  const quotedTable = `"${String(table).replaceAll('"', '""')}"`;
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quotedTable}`).get().count);
}

function parseSourcePath(args) {
  let source = "data/db/atlas.sqlite";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source-db") {
      source = args[index + 1] || "";
      index += 1;
    } else {
      fail(`Unknown argument: ${args[index]}`);
    }
  }
  if (!source) fail("--source-db requires a path");
  return source;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
