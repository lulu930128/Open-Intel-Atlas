export const PROMOTION_METHOD = "deterministic-document-promotion";
export const PROMOTION_VERSION = "1.0.0";
export const REGIONAL_RELEVANCE_METHOD = "deterministic-structured-relevance";
export const REGIONAL_RELEVANCE_VERSION = "1.0.0";

const DEFAULT_INELIGIBLE_TYPES = new Set(["research", "market_observation"]);
const SUPPORTED_REGIONS = ["TW", "JP"];

export function evaluateDocumentPromotion(document, evaluatedAt = new Date().toISOString()) {
  const metadata = document?.raw_metadata || {};
  const eventKey = document.event_key || metadata.event_key || null;
  const location = document.location || metadata.location || null;
  const reasons = [];
  let status;
  let eligible;

  if (isProviderCancellation(document)) {
    status = "cancelled";
    eligible = false;
    reasons.push("provider_cancelled");
  } else if (metadata.event_eligible === false) {
    status = "held";
    eligible = false;
    reasons.push("provider_explicit_ineligible");
  } else if (metadata.event_eligible === true) {
    status = "promoted";
    eligible = true;
    reasons.push("provider_structured_event");
  } else if (DEFAULT_INELIGIBLE_TYPES.has(document.document_type)) {
    status = "held";
    eligible = false;
    reasons.push("document_type_ineligible");
  } else {
    status = "promoted";
    eligible = true;
    reasons.push("document_type_policy");
  }

  if (!eventKey) reasons.push("event_key_missing");
  if (!location) reasons.push("location_missing");

  return {
    status,
    eligible,
    reason_codes: reasons,
    method: PROMOTION_METHOD,
    version: PROMOTION_VERSION,
    evaluated_at: evaluatedAt,
    details: {
      source_id: document.source_id,
      document_type: document.document_type,
      event_key: eventKey,
      provider_event_eligible: metadata.event_eligible ?? null,
      provider_evidence_support: metadata.evidence_support ?? null
    }
  };
}

export function promotionAllowsEventCreation(decision, document = {}) {
  if (decision?.status) return decision.status === "promoted";
  return Boolean(document.event_eligible);
}

export function promotionAllowsEvidenceAttachment(decision, document = {}) {
  if (decision?.status === "promoted" || decision?.status === "cancelled") return true;
  if (decision?.status === "held") return document.raw_metadata?.evidence_support === true;
  return Boolean(
    document.event_eligible
    || document.raw_metadata?.evidence_support === true
    || isProviderCancellation(document)
  );
}

export function promotionAllowsEvidenceSupport(decision, document = {}) {
  if (decision?.status === "cancelled") return false;
  if (decision?.status === "promoted") return true;
  const providerPolicy = document.raw_metadata?.evidence_support;
  if (typeof providerPolicy === "boolean") return providerPolicy;
  if (decision?.status) return false;
  return Boolean(document.event_eligible);
}

export function deriveRegionalRelevance(event, documents, evaluatedAt = new Date().toISOString()) {
  const byRegion = new Map(SUPPORTED_REGIONS.map((region) => [region, emptyRegion(region)]));

  for (const location of event.locations || []) {
    const region = normalizeRegion(location.country_code);
    if (!byRegion.has(region)) continue;
    addEvidence(byRegion.get(region), 1, "event_location_country", {
      type: "event_location",
      location_id: location.id || null,
      country_code: region
    });
  }

  for (const document of documents || []) {
    const scopes = new Set([
      ...(document.source_countries || []).map(normalizeRegion),
      normalizeRegion(document.raw_metadata?.source_scope)
    ].filter(Boolean));
    for (const region of scopes) {
      if (!byRegion.has(region) || document.authority_class !== "official") continue;
      addEvidence(byRegion.get(region), 0.75, "official_source_scope", {
        type: "official_source_scope",
        document_id: document.id,
        source_id: document.source_id,
        country_code: region
      });
    }
  }

  const regions = [...byRegion.values()].filter((entry) => entry.score > 0);
  const memberRegions = regions.map((entry) => entry.region_code);
  const eastAsiaScore = Math.max(0, ...regions.map((entry) => entry.score));
  if (eastAsiaScore > 0) {
    regions.push({
      region_code: "EAST_ASIA",
      score: eastAsiaScore,
      reason_codes: ["member_region_relevance"],
      evidence: [{ type: "member_regions", region_codes: memberRegions }]
    });
  }

  return regions.map((entry) => ({
    ...entry,
    method: REGIONAL_RELEVANCE_METHOD,
    version: REGIONAL_RELEVANCE_VERSION,
    evaluated_at: evaluatedAt
  }));
}

function isProviderCancellation(document) {
  const metadata = document?.raw_metadata || {};
  return metadata.info_type === "取消"
    || metadata.provider_status === "cancelled"
    || /(?:^|\s)(?:cancelled|canceled|withdrawn|retracted)(?:\s|$)/i.test((document.tags || []).join(" "));
}

function emptyRegion(regionCode) {
  return { region_code: regionCode, score: 0, reason_codes: [], evidence: [] };
}

function addEvidence(entry, score, reason, evidence) {
  entry.score = Math.max(entry.score, score);
  if (!entry.reason_codes.includes(reason)) entry.reason_codes.push(reason);
  if (!entry.evidence.some((item) => JSON.stringify(item) === JSON.stringify(evidence))) entry.evidence.push(evidence);
}

function normalizeRegion(value) {
  const region = String(value || "").trim().toUpperCase();
  return SUPPORTED_REGIONS.includes(region) ? region : null;
}
