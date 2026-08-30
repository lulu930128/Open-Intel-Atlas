import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { deriveRegionalRelevance, evaluateDocumentPromotion } from "../src/atlasPromotion.js";
import { planRegionalReprocess } from "../src/atlasReprocess.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { loadConfig } from "../src/config.js";

const options = parseArguments(process.argv.slice(2));
const sourcePath = resolve(options.sourceDb);
if (!existsSync(sourcePath)) fail(`Atlas database does not exist: ${sourcePath}`);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-intel-atlas-reprocess-audit-"));
const copyPath = join(temporaryDirectory, "atlas.sqlite");
const evaluatedAt = new Date().toISOString();
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
  store.registerSources(registry.all, evaluatedAt);

  const documentTotal = count(store.db, "documents");
  const eventTotal = count(store.db, "events");
  const documentIds = selectIds(store.db, "documents", options.maxDocuments);
  const eventIds = selectIds(store.db, "events", options.maxEvents);
  const documentTruncated = documentTotal > documentIds.length;
  const eventTruncated = eventTotal > eventIds.length;

  const promotion = auditPromotion(store, documentIds, eventIds, evaluatedAt);
  const relevance = auditRelevance(store, eventIds, evaluatedAt);
  const reprocessPlan = planRegionalReprocess(store, {
    maxDocuments: options.maxDocuments,
    maxEvents: options.maxEvents,
    evaluatedAt
  });
  const blockers = reprocessPlan.assessment.blockers;

  process.stdout.write(`${JSON.stringify({
    status: "completed",
    mode: "copy-only-no-apply-reprocess-audit",
    source_database: sourcePath,
    copied_bytes: statSync(copyPath).size,
    copied_pages: copiedPages,
    evaluated_at: evaluatedAt,
    bounds: {
      max_documents: options.maxDocuments,
      max_events: options.maxEvents,
      document_total: documentTotal,
      document_evaluated: documentIds.length,
      document_truncated: documentTruncated,
      event_total: eventTotal,
      event_evaluated: eventIds.length,
      event_truncated: eventTruncated
    },
    promotion,
    regional_relevance: relevance,
    evidence_impact: {
      event_rebuild_write_candidates: reprocessPlan.assessment.event_rebuild_write_candidates,
      evidence_link_change_candidates: reprocessPlan.assessment.evidence_link_change_candidates,
      events_with_new_supporting_evidence: reprocessPlan.assessment.events_with_new_supporting_evidence,
      new_supporting_evidence_links: reprocessPlan.assessment.new_supporting_evidence_links,
      events_with_non_supporting_evidence_removals: reprocessPlan.assessment.events_with_non_supporting_evidence_removals,
      non_supporting_evidence_removal_candidates: reprocessPlan.assessment.non_supporting_evidence_removal_candidates,
      verification_status_change_candidates: reprocessPlan.assessment.verification_status_change_candidates,
      regional_relevance_change_candidates: reprocessPlan.assessment.regional_relevance_change_candidates,
      event_location_change_candidates: reprocessPlan.assessment.event_location_change_candidates,
      event_rebuild_samples: reprocessPlan.event_rebuilds.slice(0, 20).map((entry) => ({
        event_id: entry.event_id,
        change_reasons: entry.change_reasons,
        evidence_changed: entry.evidence_changed,
        new_supporting_evidence_links: entry.new_supporting_evidence_links,
        non_supporting_evidence_removals: entry.non_supporting_evidence_removals,
        verification_changed: entry.verification_changed,
        regional_relevance_changed: entry.regional_relevance_changed,
        location_changed: entry.location_changed
      }))
    },
    apply_assessment: {
      structural_blockers_detected: blockers.length > 0,
      blockers,
      requires_explicit_write_authorization: true,
      note: "This audit never applies decisions, relevance, Event lifecycle changes, or backfill to the source database."
    }
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "copy-only-no-apply-reprocess-audit",
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

function auditPromotion(atlasStore, documentIds, eventIds, now) {
  const statusCounts = {};
  const reasonCounts = {};
  const bySource = {};
  const changedEligibility = [];
  const decisions = new Map();
  const affectedStoryIds = new Set();

  for (const documentId of documentIds) {
    const document = atlasStore.getDocument(documentId, true);
    if (!document) continue;
    const decision = evaluateDocumentPromotion(document, now);
    decisions.set(document.id, decision);
    increment(statusCounts, decision.status);
    for (const reason of decision.reason_codes) increment(reasonCounts, reason);
    const source = bySource[document.source_id] ||= { evaluated: 0, promoted: 0, held: 0, cancelled: 0, eligibility_changes: 0 };
    source.evaluated += 1;
    source[decision.status] += 1;

    const currentEligible = Boolean(document.event_eligible);
    if (currentEligible !== decision.eligible) {
      source.eligibility_changes += 1;
      if (changedEligibility.length < 20) {
        changedEligibility.push({
          document_id: document.id,
          source_id: document.source_id,
          from_eligible: currentEligible,
          to_status: decision.status,
          reason_codes: decision.reason_codes
        });
      }
    }
    for (const row of atlasStore.db.prepare("SELECT story_id FROM story_documents WHERE document_id = ?").all(document.id)) {
      affectedStoryIds.add(row.story_id);
    }
  }

  let strandedEvents = 0;
  const strandedEventIds = [];
  for (const eventId of eventIds) {
    const event = atlasStore.getEvent(eventId);
    const evidenceDecisions = (event?.evidence || []).map((document) => decisions.get(document.id) || evaluateDocumentPromotion(document, now));
    if (evidenceDecisions.length > 0 && !evidenceDecisions.some((decision) => ["promoted", "cancelled"].includes(decision.status))) {
      strandedEvents += 1;
      if (strandedEventIds.length < 20) strandedEventIds.push(eventId);
    }
  }

  return {
    status_counts: statusCounts,
    reason_counts: reasonCounts,
    by_source: bySource,
    changed_eligibility_count: Object.values(bySource).reduce((sum, source) => sum + source.eligibility_changes, 0),
    changed_eligibility_samples: changedEligibility,
    affected_story_count: affectedStoryIds.size,
    events_without_eligible_evidence_after_reprocess: strandedEvents,
    event_retirement_samples: strandedEventIds
  };
}

function auditRelevance(atlasStore, eventIds, now) {
  const regionCounts = { TW: 0, JP: 0, EAST_ASIA: 0 };
  const reasonCounts = {};
  let locationBacked = 0;
  let officialSourceScopeOnly = 0;
  let noRegionalRelevance = 0;
  const samples = [];

  for (const eventId of eventIds) {
    const event = atlasStore.getEvent(eventId);
    if (!event) continue;
    const relevance = deriveRegionalRelevance(event, event.evidence || [], now);
    if (relevance.length === 0) noRegionalRelevance += 1;
    for (const entry of relevance) {
      if (entry.region_code in regionCounts) regionCounts[entry.region_code] += 1;
      for (const reason of entry.reason_codes || []) increment(reasonCounts, reason);
    }
    const memberEntries = relevance.filter((entry) => ["TW", "JP"].includes(entry.region_code));
    const hasLocationReason = memberEntries.some((entry) => entry.reason_codes.includes("event_location_country"));
    const hasSourceScopeReason = memberEntries.some((entry) => entry.reason_codes.includes("official_source_scope"));
    if (hasLocationReason) locationBacked += 1;
    if (hasSourceScopeReason && !hasLocationReason) officialSourceScopeOnly += 1;
    if (memberEntries.length > 0 && samples.length < 20) {
      samples.push({
        event_id: event.id,
        event_country_codes: [...new Set((event.locations || []).map((location) => location.country_code).filter(Boolean))],
        regions: memberEntries.map((entry) => ({
          region_code: entry.region_code,
          score: entry.score,
          reason_codes: entry.reason_codes
        }))
      });
    }
  }

  return {
    region_event_counts: regionCounts,
    reason_counts: reasonCounts,
    location_backed_event_count: locationBacked,
    official_source_scope_only_event_count: officialSourceScopeOnly,
    no_regional_relevance_event_count: noRegionalRelevance,
    samples,
    invariant: "Regional relevance was derived without writing or replacing event_locations country_code."
  };
}

function selectIds(database, table, limit) {
  const quotedTable = `"${String(table).replaceAll('"', '""')}"`;
  return database.prepare(`SELECT id FROM ${quotedTable} ORDER BY id LIMIT ?`).all(limit).map((row) => row.id);
}

function count(database, table) {
  const quotedTable = `"${String(table).replaceAll('"', '""')}"`;
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quotedTable}`).get().count);
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function parseArguments(args) {
  const options = { sourceDb: "data/db/atlas.sqlite", maxDocuments: 2000, maxEvents: 2000 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--source-db") {
      options.sourceDb = args[index + 1] || "";
      index += 1;
    } else if (argument === "--max-documents") {
      options.maxDocuments = boundedInteger(args[index + 1], "--max-documents");
      index += 1;
    } else if (argument === "--max-events") {
      options.maxEvents = boundedInteger(args[index + 1], "--max-events");
      index += 1;
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  if (!options.sourceDb) fail("--source-db requires a path");
  return options;
}

function boundedInteger(value, name) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(number) || number < 1 || number > 10_000) {
    fail(`${name} must be an integer from 1 to 10000`);
  }
  return number;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
