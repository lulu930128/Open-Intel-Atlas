import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { applyRegionalReprocess, planRegionalReprocess } from "../src/atlasReprocess.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { loadConfig } from "../src/config.js";

const sourcePath = resolve(parseSourcePath(process.argv.slice(2)));
if (!existsSync(sourcePath)) fail(`Atlas database does not exist: ${sourcePath}`);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-intel-atlas-reprocess-copy-"));
const copyPath = join(temporaryDirectory, "atlas.sqlite");
let sourceDatabase = null;
let store = null;

try {
  sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
  sourceDatabase.exec("PRAGMA query_only = ON");
  const copiedPages = await backup(sourceDatabase, copyPath);
  sourceDatabase.close();
  sourceDatabase = null;

  store = openAtlasStore(copyPath);
  const registry = buildSourceRegistry(loadConfig({ ...process.env, ATLAS_AUTO_COLLECT: "false" }));
  const firstEvaluatedAt = new Date().toISOString();
  store.registerSources(registry.all, firstEvaluatedAt);
  const before = inspect(store.db);

  const firstPlan = planRegionalReprocess(store, {
    maxDocuments: 2000,
    maxEvents: 2000,
    evaluatedAt: firstEvaluatedAt
  });
  const firstApply = applyRegionalReprocess(store, firstPlan);
  const afterFirst = inspect(store.db);

  const secondPlan = planRegionalReprocess(store, {
    maxDocuments: 2000,
    maxEvents: 2000,
    evaluatedAt: new Date(Date.parse(firstEvaluatedAt) + 1000).toISOString()
  });
  const secondApply = applyRegionalReprocess(store, secondPlan);
  const afterSecond = inspect(store.db);
  const errors = [];

  if (!firstPlan.assessment.safe_for_bounded_apply) errors.push(`First plan blocked: ${firstPlan.assessment.blockers.join(", ")}`);
  if (firstApply.promotion_writes !== firstPlan.assessment.promotion_write_candidates) errors.push("First promotion write count did not match plan");
  if (firstApply.event_rebuild_writes !== firstPlan.assessment.event_rebuild_write_candidates) errors.push("First Event rebuild write count did not match plan");
  if (firstApply.relevance_event_writes !== firstPlan.assessment.relevance_event_write_candidates) errors.push("First relevance write count did not match plan");
  if (!secondPlan.assessment.safe_for_bounded_apply) errors.push(`Second plan blocked: ${secondPlan.assessment.blockers.join(", ")}`);
  if (secondApply.promotion_writes !== 0 || secondApply.event_rebuild_writes !== 0 || secondApply.relevance_event_writes !== 0) {
    errors.push("Second apply was not idempotent");
  }
  if (before.event_location_hash !== afterFirst.event_location_hash || before.event_locations !== afterFirst.event_locations) {
    errors.push("Event locations changed during regional reprocess");
  }
  if (afterFirst.story_updates - before.story_updates !== firstApply.event_rebuild_writes + firstApply.relevance_event_writes) {
    errors.push("Story update count did not match changed Event or relevance writes");
  }
  if (JSON.stringify(afterFirst) !== JSON.stringify(afterSecond)) errors.push("Second apply changed copied database counts or location hash");
  if (afterSecond.integrity_check !== "ok" || afterSecond.foreign_key_violations !== 0) {
    errors.push("Copied database integrity failed after reprocess");
  }

  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0 ? "passed" : "failed",
    mode: "copy-only-apply-twice-regional-reprocess",
    source_database: sourcePath,
    copied_bytes: statSync(copyPath).size,
    copied_pages: copiedPages,
    first_plan: summarizePlan(firstPlan),
    first_apply: firstApply,
    second_plan: summarizePlan(secondPlan),
    second_apply: secondApply,
    before,
    after_first: afterFirst,
    after_second: afterSecond,
    errors
  }, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "copy-only-apply-twice-regional-reprocess",
    source_database: sourcePath,
    error_type: error?.name || "Error",
    error_message: String(error?.message || error)
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  store?.close();
  sourceDatabase?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function inspect(database) {
  const locationRows = database.prepare(`
    SELECT id, event_id, label, country_code, admin1, city, geometry_type, latitude,
           longitude, geometry_json, precision, confidence, is_primary
    FROM event_locations ORDER BY id
  `).all();
  const evidenceRows = database.prepare(`
    SELECT event_id, document_id, evidence_role, supports, confidence
    FROM event_evidence ORDER BY event_id, document_id
  `).all();
  return {
    documents: count(database, "documents"),
    document_promotion_decisions: count(database, "document_promotion_decisions"),
    events: count(database, "events"),
    event_evidence: evidenceRows.length,
    event_evidence_hash: createHash("sha256").update(JSON.stringify(evidenceRows)).digest("hex"),
    event_regional_relevance: count(database, "event_regional_relevance"),
    event_locations: locationRows.length,
    event_location_hash: createHash("sha256").update(JSON.stringify(locationRows)).digest("hex"),
    story_updates: count(database, "story_updates"),
    integrity_check: String(database.prepare("PRAGMA integrity_check").get().integrity_check),
    foreign_key_violations: database.prepare("PRAGMA foreign_key_check").all().length
  };
}

function summarizePlan(plan) {
  return { bounds: plan.bounds, assessment: plan.assessment };
}

function count(database, table) {
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
