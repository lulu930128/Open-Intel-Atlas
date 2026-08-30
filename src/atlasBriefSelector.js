export const BRIEF_SELECTOR_METHOD = "quality-gated-regional-brief";
export const BRIEF_SELECTOR_VERSION = "1.0.0";
export const PRESENTATION_PROFILES = Object.freeze(["global", "east_asia", "taiwan_focus", "japan_focus"]);

const MAX_AGE_MS = Object.freeze({
  hazards: 36 * 60 * 60 * 1000,
  politics: 7 * 24 * 60 * 60 * 1000,
  technology: 7 * 24 * 60 * 60 * 1000,
  finance: 7 * 24 * 60 * 60 * 1000
});
const EXCLUDED_LIFECYCLES = Object.freeze(["cancelled", "superseded"]);
const EXCLUDED_VERIFICATIONS = Object.freeze(["retracted", "disputed", "unverified"]);

export function briefCandidatePolicy(domain, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new RangeError("brief candidate policy requires a valid now timestamp");
  const maxAge = domain
    ? (MAX_AGE_MS[domain] || MAX_AGE_MS.politics)
    : Math.max(...Object.values(MAX_AGE_MS));
  return {
    from: new Date(nowMs - maxAge).toISOString(),
    exclude_lifecycles: [...EXCLUDED_LIFECYCLES],
    exclude_verifications: [...EXCLUDED_VERIFICATIONS]
  };
}

export function selectBriefEvents(events, options = {}) {
  const presentation = options.presentation || "global";
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 12));
  const nowMs = Date.parse(options.now || new Date().toISOString());
  const candidates = Array.isArray(events) ? events : [];
  const qualityQualified = candidates.filter((event) => passesQualityGate(event, nowMs));
  const regionalQualified = presentation === "global"
    ? qualityQualified
    : qualityQualified.filter((event) => relevanceScore(event, presentation) > 0);
  const ranked = regionalQualified
    .map((event) => ({ event, score: selectionScore(event, presentation, nowMs) }))
    .sort((left, right) => right.score - left.score || compareRecency(right.event, left.event));
  const selected = selectWithSoftDomainDiversity(ranked, limit);
  const gaps = [];

  if (presentation !== "global" && regionalQualified.length === 0) gaps.push("no_qualified_regional_events");
  if (selected.length < limit) gaps.push("qualified_event_shortfall");

  return {
    events: selected,
    selection: {
      presentation,
      method: BRIEF_SELECTOR_METHOD,
      version: BRIEF_SELECTOR_VERSION,
      requested_count: limit,
      candidate_count: candidates.length,
      quality_qualified_count: qualityQualified.length,
      regional_qualified_count: presentation === "global" ? null : regionalQualified.length,
      selected_count: selected.length,
      coverage_gaps: gaps
    }
  };
}

export function validatePresentation(value) {
  const presentation = String(value || "global").trim().toLowerCase();
  return PRESENTATION_PROFILES.includes(presentation) ? presentation : null;
}

export function regionsForPresentation(presentation) {
  if (presentation === "taiwan_focus") return ["TW"];
  if (presentation === "japan_focus") return ["JP"];
  if (presentation === "east_asia") return ["EAST_ASIA"];
  return [];
}

function passesQualityGate(event, nowMs) {
  if (EXCLUDED_LIFECYCLES.includes(event.lifecycle)) return false;
  if (EXCLUDED_VERIFICATIONS.includes(event.verification_status)) return false;
  const updatedMs = Date.parse(event.last_updated_at || event.occurred_at || "");
  if (!Number.isFinite(updatedMs) || !Number.isFinite(nowMs)) return false;
  const maxAge = MAX_AGE_MS[event.primary_domain] || MAX_AGE_MS.politics;
  return nowMs - updatedMs <= maxAge;
}

function relevanceScore(event, presentation) {
  if (presentation === "global") return 0;
  const targets = regionsForPresentation(presentation);
  return Math.max(0, ...(event.regional_relevance || [])
    .filter((entry) => targets.includes(entry.region_code))
    .map((entry) => Number(entry.score) || 0));
}

function selectionScore(event, presentation, nowMs) {
  const verification = {
    official_confirmed: 1,
    primary_source_confirmed: 0.9,
    multi_source: 0.8,
    corrected: 0.75,
    single_source: 0.55
  }[event.verification_status] || 0;
  const severity = { critical: 1, high: 0.75, medium: 0.5, low: 0.25 }[event.event_severity] || 0;
  const updatedMs = Date.parse(event.last_updated_at || event.occurred_at || "");
  const ageMs = Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : Number.POSITIVE_INFINITY;
  const freshness = Number.isFinite(ageMs) ? Math.max(0, 1 - ageMs / (MAX_AGE_MS[event.primary_domain] || MAX_AGE_MS.politics)) : 0;
  return relevanceScore(event, presentation) * 4 + verification * 1.5 + severity * 0.5 + freshness;
}

function selectWithSoftDomainDiversity(ranked, limit) {
  const remaining = [...ranked];
  const selected = [];
  const domainCounts = new Map();
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const repeatedDomainPenalty = (domainCounts.get(candidate.event.primary_domain) || 0) * 0.18;
      const adjusted = candidate.score - repeatedDomainPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    const [{ event }] = remaining.splice(bestIndex, 1);
    selected.push(event);
    domainCounts.set(event.primary_domain, (domainCounts.get(event.primary_domain) || 0) + 1);
  }
  return selected;
}

function compareRecency(left, right) {
  return Date.parse(left.last_updated_at || 0) - Date.parse(right.last_updated_at || 0);
}
