import { deriveEventForStory } from "./atlasEvents.js";
import { evaluateDocumentPromotion } from "./atlasPromotion.js";

const MAX_REPROCESS_ITEMS = 10_000;

export function planRegionalReprocess(store, options = {}) {
  const evaluatedAt = options.evaluatedAt || new Date().toISOString();
  const maxDocuments = boundedLimit(options.maxDocuments, 2000);
  const maxEvents = boundedLimit(options.maxEvents, 2000);
  const documentTotal = tableCount(store.db, "documents");
  const eventTotal = tableCount(store.db, "events");
  const documentIds = selectIds(store.db, "documents", maxDocuments);
  const eventIds = selectIds(store.db, "events", maxEvents);
  const documentTruncated = documentTotal > documentIds.length;
  const eventTruncated = eventTotal > eventIds.length;
  const documentDecisions = [];
  const decisionsByDocument = new Map();
  let changedEligibilityCount = 0;
  let promotionWriteCandidates = 0;

  for (const documentId of documentIds) {
    const document = store.getDocument(documentId, true);
    if (!document) continue;
    const decision = evaluateDocumentPromotion(document, evaluatedAt);
    decisionsByDocument.set(document.id, decision);
    const currentDecision = document.promotion_decision || null;
    const semanticChanged = decisionSignature(currentDecision) !== decisionSignature(decision);
    if (semanticChanged) promotionWriteCandidates += 1;
    if (Boolean(document.event_eligible) !== decision.eligible) changedEligibilityCount += 1;
    documentDecisions.push({ document_id: document.id, current: currentDecision, planned: decision, semantic_changed: semanticChanged });
  }

  const eventRebuilds = [];
  const eventRelevance = [];
  let eventRebuildWriteCandidates = 0;
  let relevanceWriteCandidates = 0;
  let strandedEventCount = 0;
  let evidenceLinkChangeCandidates = 0;
  let eventsWithNewSupportingEvidence = 0;
  let newSupportingEvidenceLinks = 0;
  let eventsWithNonSupportingEvidenceRemovals = 0;
  let nonSupportingEvidenceRemovalCandidates = 0;
  let verificationStatusChangeCandidates = 0;
  let regionalRelevanceChangeCandidates = 0;
  let eventLocationChangeCandidates = 0;
  for (const eventId of eventIds) {
    const current = store.getEvent(eventId);
    if (!current) continue;
    const storyId = current.stories?.find((story) => story.relationship === "primary")?.id || current.stories?.[0]?.id;
    const derived = storyId
      ? deriveEventForStory(store, storyId, evaluatedAt, { promotionDecisions: decisionsByDocument })
      : null;
    if (!derived) {
      strandedEventCount += 1;
      continue;
    }

    const currentEvidence = evidenceState(current);
    const plannedEvidence = evidenceState(derived);
    const evidenceChanged = JSON.stringify(currentEvidence) !== JSON.stringify(plannedEvidence);
    const planned = evidenceChanged
      ? eventWithReprocessedEvidence(current, derived, evaluatedAt)
      : current;
    const currentSupporting = new Set(currentEvidence.filter((entry) => entry.supports).map((entry) => entry.document_id));
    const plannedEvidenceIds = new Set(plannedEvidence.map((entry) => entry.document_id));
    const addedSupporting = plannedEvidence.filter((entry) => entry.supports && !currentSupporting.has(entry.document_id));
    const removedNonSupporting = currentEvidence.filter((entry) => !entry.supports && !plannedEvidenceIds.has(entry.document_id));
    if (evidenceChanged) evidenceLinkChangeCandidates += 1;
    if (addedSupporting.length > 0) {
      eventsWithNewSupportingEvidence += 1;
      newSupportingEvidenceLinks += addedSupporting.length;
    }
    if (removedNonSupporting.length > 0) {
      eventsWithNonSupportingEvidenceRemovals += 1;
      nonSupportingEvidenceRemovalCandidates += removedNonSupporting.length;
    }
    if (evidenceChanged && current.verification_status !== planned.verification_status) verificationStatusChangeCandidates += 1;

    const relevanceChanged = relevanceSignature(current.regional_relevance || []) !== relevanceSignature(derived.regional_relevance || []);
    if (relevanceChanged) regionalRelevanceChangeCandidates += 1;
    const locationChanged = locationSignature(current.locations || []) !== locationSignature(planned.locations || []);
    if (locationChanged) eventLocationChangeCandidates += 1;

    const coreChangeReasons = eventCoreChangeReasons(current, planned);
    const coreChanged = coreChangeReasons.length > 0;
    if (coreChanged) {
      eventRebuildWriteCandidates += 1;
      eventRebuilds.push({
        event_id: current.id,
        story_id: storyId,
        current,
        planned: { ...planned, regional_relevance: derived.regional_relevance || [] },
        evidence_changed: evidenceChanged,
        new_supporting_evidence_links: addedSupporting.length,
        non_supporting_evidence_removals: removedNonSupporting.length,
        verification_changed: current.verification_status !== planned.verification_status,
        regional_relevance_changed: relevanceChanged,
        location_changed: locationChanged,
        change_reasons: coreChangeReasons
      });
    } else {
      if (relevanceChanged) relevanceWriteCandidates += 1;
      eventRelevance.push({
        event_id: current.id,
        current: current.regional_relevance || [],
        planned: derived.regional_relevance || [],
        semantic_changed: relevanceChanged
      });
    }
  }

  const blockers = [];
  if (documentTruncated) blockers.push("document_plan_truncated");
  if (eventTruncated) blockers.push("event_plan_truncated");
  if (changedEligibilityCount > 0) blockers.push("document_eligibility_change_requires_event_rebuild");
  if (strandedEventCount > 0) blockers.push("event_retirement_policy_required");
  if (eventLocationChangeCandidates > 0) blockers.push("event_location_change_requires_review");

  return {
    evaluated_at: evaluatedAt,
    bounds: {
      max_documents: maxDocuments,
      max_events: maxEvents,
      document_total: documentTotal,
      document_planned: documentIds.length,
      document_truncated: documentTruncated,
      event_total: eventTotal,
      event_planned: eventIds.length,
      event_truncated: eventTruncated
    },
    assessment: {
      safe_for_bounded_apply: blockers.length === 0,
      blockers,
      changed_eligibility_count: changedEligibilityCount,
      stranded_event_count: strandedEventCount,
      promotion_write_candidates: promotionWriteCandidates,
      event_rebuild_write_candidates: eventRebuildWriteCandidates,
      relevance_event_write_candidates: relevanceWriteCandidates,
      evidence_link_change_candidates: evidenceLinkChangeCandidates,
      events_with_new_supporting_evidence: eventsWithNewSupportingEvidence,
      new_supporting_evidence_links: newSupportingEvidenceLinks,
      events_with_non_supporting_evidence_removals: eventsWithNonSupportingEvidenceRemovals,
      non_supporting_evidence_removal_candidates: nonSupportingEvidenceRemovalCandidates,
      verification_status_change_candidates: verificationStatusChangeCandidates,
      regional_relevance_change_candidates: regionalRelevanceChangeCandidates,
      event_location_change_candidates: eventLocationChangeCandidates
    },
    document_decisions: documentDecisions,
    event_rebuilds: eventRebuilds,
    event_relevance: eventRelevance
  };
}

export function applyRegionalReprocess(store, plan) {
  if (!plan?.assessment?.safe_for_bounded_apply) {
    const blockers = plan?.assessment?.blockers || ["missing_safe_plan"];
    throw new Error(`Regional reprocess apply refused: ${blockers.join(", ")}`);
  }
  assertPlanStillCurrent(store, plan);

  let promotionWrites = 0;
  let eventRebuildWrites = 0;
  let relevanceEventWrites = 0;
  for (const item of plan.document_decisions || []) {
    const current = store.getDocument(item.document_id, true)?.promotion_decision || null;
    if (decisionSignature(current) === decisionSignature(item.planned)) continue;
    store.saveDocumentPromotionDecision(item.document_id, item.planned);
    promotionWrites += 1;
  }
  for (const item of plan.event_rebuilds || []) {
    const current = store.getEvent(item.event_id);
    if (current
      && eventCoreSignature(current) === eventCoreSignature(item.planned)
      && relevanceSignature(current.regional_relevance || []) === relevanceSignature(item.planned.regional_relevance || [])) {
      continue;
    }
    store.saveEvent(item.planned);
    eventRebuildWrites += 1;
  }
  for (const item of plan.event_relevance || []) {
    const current = store.getEvent(item.event_id)?.regional_relevance || [];
    if (relevanceSignature(current) === relevanceSignature(item.planned)) continue;
    store.replaceEventRegionalRelevance(item.event_id, item.planned, plan.evaluated_at);
    relevanceEventWrites += 1;
  }

  return {
    promotion_writes: promotionWrites,
    event_rebuild_writes: eventRebuildWrites,
    relevance_event_writes: relevanceEventWrites
  };
}

function assertPlanStillCurrent(store, plan) {
  for (const item of plan.document_decisions || []) {
    const current = store.getDocument(item.document_id, true)?.promotion_decision || null;
    const signature = decisionSignature(current);
    if (signature !== decisionSignature(item.current) && signature !== decisionSignature(item.planned)) {
      throw new Error(`Regional reprocess apply refused: stale document plan for ${item.document_id}`);
    }
  }

  for (const item of plan.event_rebuilds || []) {
    const current = store.getEvent(item.event_id);
    if (!current) throw new Error(`Regional reprocess apply refused: missing Event ${item.event_id}`);
    const currentCore = eventCoreSignature(current);
    const currentRelevance = relevanceSignature(current.regional_relevance || []);
    const matchesBaseline = currentCore === eventCoreSignature(item.current)
      && currentRelevance === relevanceSignature(item.current.regional_relevance || []);
    const matchesPlanned = currentCore === eventCoreSignature(item.planned)
      && currentRelevance === relevanceSignature(item.planned.regional_relevance || []);
    if (!matchesBaseline && !matchesPlanned) {
      throw new Error(`Regional reprocess apply refused: stale Event plan for ${item.event_id}`);
    }
  }

  for (const item of plan.event_relevance || []) {
    const current = store.getEvent(item.event_id);
    if (!current) throw new Error(`Regional reprocess apply refused: missing Event ${item.event_id}`);
    const signature = relevanceSignature(current.regional_relevance || []);
    if (signature !== relevanceSignature(item.current) && signature !== relevanceSignature(item.planned)) {
      throw new Error(`Regional reprocess apply refused: stale relevance plan for ${item.event_id}`);
    }
  }
}

function decisionSignature(decision) {
  if (!decision) return "null";
  return JSON.stringify({
    status: decision.status,
    eligible: Boolean(decision.eligible),
    reason_codes: [...(decision.reason_codes || [])].sort(),
    method: decision.method,
    version: decision.version,
    details: decision.details || {}
  });
}

function relevanceSignature(relevance) {
  return JSON.stringify((relevance || []).map((entry) => ({
    region_code: entry.region_code,
    score: Number(entry.score),
    reason_codes: [...(entry.reason_codes || [])].sort(),
    evidence: entry.evidence || [],
    method: entry.method,
    version: entry.version
  })).sort((left, right) => left.region_code.localeCompare(right.region_code)));
}

function eventCoreSignature(event) {
  return JSON.stringify(eventCoreState(event));
}

function eventWithReprocessedEvidence(current, derived, evaluatedAt) {
  return {
    ...derived,
    event_type: current.event_type,
    title: current.title,
    summary: current.summary,
    primary_domain: current.primary_domain,
    domains: current.domains || [],
    lifecycle: current.lifecycle,
    event_severity: current.event_severity,
    occurred_at: current.occurred_at,
    first_seen_at: current.first_seen_at,
    last_updated_at: current.last_updated_at,
    geo_scope: current.geo_scope,
    story_count: current.story_count,
    representative_document_id: current.representative_document_id,
    derivation_method: current.derivation_method || current.derivation?.method,
    derivation_version: current.derivation_version || current.derivation?.version,
    stories: (current.stories || []).map((entry) => ({
      story_id: entry.story_id || entry.id,
      relationship: entry.relationship,
      confidence: Number(entry.confidence ?? entry.relationship_confidence)
    })),
    entities: current.entities || [],
    locations: (current.locations || []).map((entry) => ({
      ...entry,
      geometry_json: entry.geometry_json || entry.geometry || null
    })),
    updated_at: evaluatedAt
  };
}

function eventCoreChangeReasons(current, planned) {
  const currentState = eventCoreState(current);
  const plannedState = eventCoreState(planned);
  return Object.keys(plannedState).filter((key) => (
    JSON.stringify(currentState[key]) !== JSON.stringify(plannedState[key])
  ));
}

function eventCoreState(event) {
  return {
    id: event.id,
    event_type: event.event_type,
    title: event.title,
    summary: event.summary,
    primary_domain: event.primary_domain,
    lifecycle: event.lifecycle,
    verification_status: event.verification_status,
    event_severity: event.event_severity,
    confidence: Number(event.confidence),
    occurred_at: event.occurred_at,
    first_seen_at: event.first_seen_at,
    last_updated_at: event.last_updated_at,
    geo_scope: event.geo_scope,
    story_count: Number(event.story_count || 0),
    evidence_count: Number(event.evidence_count || 0),
    independent_source_count: Number(event.independent_source_count || 0),
    has_primary_source: Boolean(event.has_primary_source),
    has_official_source: Boolean(event.has_official_source),
    representative_document_id: event.representative_document_id,
    derivation_method: event.derivation_method || event.derivation?.method,
    derivation_version: event.derivation_version || event.derivation?.version,
    domains: (event.domains || [])
      .map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) }))
      .sort((left, right) => left.domain.localeCompare(right.domain)),
    stories: (event.stories || [])
      .map((entry) => ({
        story_id: entry.story_id || entry.id,
        relationship: entry.relationship,
        confidence: Number(entry.confidence ?? entry.relationship_confidence)
      }))
      .sort((left, right) => left.story_id.localeCompare(right.story_id)),
    evidence: evidenceState(event),
    entities: (event.entities || [])
      .map((entry) => ({ id: entry.id, role: entry.role, confidence: Number(entry.confidence) }))
      .sort((left, right) => `${left.id}:${left.role}`.localeCompare(`${right.id}:${right.role}`)),
    locations: normalizedLocations(event.locations || [])
  };
}

function evidenceState(event) {
  return (event.evidence || [])
    .map((entry) => ({
      document_id: entry.document_id || entry.id,
      evidence_role: entry.evidence_role,
      supports: Boolean(entry.supports),
      confidence: Number(entry.confidence ?? entry.evidence_confidence)
    }))
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
}

function locationSignature(locations) {
  return JSON.stringify(normalizedLocations(locations));
}

function normalizedLocations(locations) {
  return (locations || [])
    .map((entry) => ({
      id: entry.id,
      label: entry.label || null,
      country_code: entry.country_code || null,
      admin1: entry.admin1 || null,
      city: entry.city || null,
      geometry_type: entry.geometry_type,
      latitude: entry.latitude === null || entry.latitude === undefined ? null : Number(entry.latitude),
      longitude: entry.longitude === null || entry.longitude === undefined ? null : Number(entry.longitude),
      geometry: entry.geometry || entry.geometry_json || null,
      precision: entry.precision,
      confidence: Number(entry.confidence),
      is_primary: Boolean(entry.is_primary)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function selectIds(database, table, limit) {
  const quotedTable = quoteIdentifier(table);
  return database.prepare(`SELECT id FROM ${quotedTable} ORDER BY id LIMIT ?`).all(limit).map((row) => row.id);
}

function tableCount(database, table) {
  const quotedTable = quoteIdentifier(table);
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quotedTable}`).get().count);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function boundedLimit(value, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(number) || number < 1 || number > MAX_REPROCESS_ITEMS) {
    throw new RangeError(`reprocess limit must be an integer from 1 to ${MAX_REPROCESS_ITEMS}`);
  }
  return number;
}
