import { clamp, stableId, summarize } from "./core/utils.js";
import {
  deriveRegionalRelevance,
  promotionAllowsEventCreation,
  promotionAllowsEvidenceAttachment,
  promotionAllowsEvidenceSupport
} from "./atlasPromotion.js";

export const EVENT_DERIVATION_METHOD = "deterministic-story-fusion";
export const EVENT_DERIVATION_VERSION = "1.0.0";

const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };

export function rebuildEventForStory(store, storyId, now = new Date().toISOString()) {
  const event = deriveEventForStory(store, storyId, now);
  if (!event) return null;
  store.saveEvent(event);
  return event;
}

export function deriveEventForStory(store, storyId, now = new Date().toISOString(), options = {}) {
  const plannedDecisions = options.promotionDecisions || new Map();
  const storyDocuments = store.getStoryDocuments(storyId).map((document) => ({
    ...document,
    promotion_decision: plannedDecisions.get(document.id) || document.promotion_decision
  }));
  const triggers = storyDocuments.filter((document) => promotionAllowsEventCreation(document.promotion_decision, document));
  if (triggers.length === 0) return null;

  const documents = storyDocuments.filter((document) => (
    promotionAllowsEvidenceAttachment(document.promotion_decision, document)
  ));
  const evidence = documents.map((document) => ({
    document_id: document.id,
    evidence_role: evidenceRole(document),
    supports: promotionAllowsEvidenceSupport(document.promotion_decision, document) && !isContradiction(document),
    confidence: evidenceConfidence(document)
  }));
  const supportById = new Map(evidence.map((entry) => [entry.document_id, entry.supports]));
  const supportingDocuments = documents.filter((document) => supportById.get(document.id));
  const cancellations = documents.filter((document) => document.promotion_decision?.status === "cancelled");
  const cancelled = cancellations.length > 0;

  const representative = chooseRepresentative(cancelled ? cancellations : triggers);
  const domains = mergeDomains(triggers);
  const primaryDomain = domains[0]?.domain || "politics";
  const independentKeys = new Set(
    supportingDocuments
      .filter((document) => isIndependentEvidence(document))
      .map((document) => document.publisher_key)
      .filter(Boolean)
  );
  const hasOfficial = supportingDocuments.some((document) => document.authority_class === "official");
  const hasPrimary = supportingDocuments.some((document) => ["official", "primary_statement"].includes(document.authority_class));
  const verification = cancelled ? "retracted" : verificationStatus(supportingDocuments, independentKeys.size, hasOfficial, hasPrimary);
  const location = chooseLocation(triggers);
  const eventId = stableId("event", storyId);
  const eventType = representative.event_type_candidate || inferEventType(representative, primaryDomain);
  const severity = triggers.map(deriveSeverity).sort((left, right) => SEVERITY_ORDER[right] - SEVERITY_ORDER[left])[0] || "low";
  const confidence = confidenceScore(supportingDocuments, independentKeys.size, hasOfficial);
  const firstSeen = minTimestamp(triggers.map((document) => document.observed_at || document.published_at || document.fetched_at)) || now;
  const lastUpdated = maxTimestamp(documents.map((document) => document.observed_at || document.published_at || document.fetched_at)) || now;
  const entities = extractEntities(triggers);
  const locations = location
    ? [
        {
          id: stableId("location", `${eventId}:${location.label || "unknown"}:${location.latitude ?? ""}:${location.longitude ?? ""}`),
          ...location,
          is_primary: true
        }
      ]
    : [];

  const event = {
    id: eventId,
    event_type: eventType,
    title: representative.title,
    summary: summarize(representative.summary || representative.body_excerpt || representative.title, 1200),
    primary_domain: primaryDomain,
    domains,
    lifecycle: cancelled ? "cancelled" : lifecycleStatus(triggers, lastUpdated, now),
    verification_status: verification,
    event_severity: severity,
    confidence,
    occurred_at: representative.observed_at || representative.published_at || firstSeen,
    first_seen_at: firstSeen,
    last_updated_at: lastUpdated,
    geo_scope: location?.geometry_type === "point" ? "local" : location?.country_code ? "country" : "global",
    story_count: 1,
    evidence_count: evidence.length,
    independent_source_count: independentKeys.size,
    has_primary_source: hasPrimary,
    has_official_source: hasOfficial,
    representative_document_id: representative.id,
    derivation_method: EVENT_DERIVATION_METHOD,
    derivation_version: EVENT_DERIVATION_VERSION,
    stories: [{ story_id: storyId, relationship: "primary", confidence: 1 }],
    evidence,
    entities,
    locations,
    created_at: firstSeen,
    updated_at: now
  };
  event.regional_relevance = deriveRegionalRelevance(event, supportingDocuments, now);
  return event;
}

function chooseRepresentative(documents) {
  return [...documents].sort((left, right) => representativeScore(right) - representativeScore(left))[0];
}

function representativeScore(document) {
  const authority = {
    official: 6,
    primary_statement: 5,
    wire_service: 4,
    professional_media: 3,
    academic: 2,
    aggregator: 1
  }[document.authority_class] || 0;
  const completeness = Number(Boolean(document.summary)) + Number(Boolean(document.canonical_url));
  const recency = Date.parse(document.published_at || document.observed_at || 0) / 1e13;
  return authority * 10 + completeness + (Number.isFinite(recency) ? recency : 0);
}

function mergeDomains(documents) {
  const scores = new Map();
  for (const document of documents) {
    for (const domain of document.domains || []) {
      scores.set(domain.domain, Math.max(scores.get(domain.domain) || 0, Number(domain.confidence || 0)));
    }
  }
  return [...scores.entries()]
    .map(([domain, confidence]) => ({ domain, confidence: clamp(confidence, 0, 1, 0.5) }))
    .sort((left, right) => right.confidence - left.confidence);
}

function isIndependentEvidence(document) {
  if (document.source_id === "gdelt-doc") {
    return document.publisher_key && !document.publisher_key.includes("unknown");
  }
  return !String(document.source_class || "").includes("aggregator");
}

function verificationStatus(documents, independentCount, hasOfficial, hasPrimary) {
  if (documents.some((document) => /retract|withdrawn/i.test(`${document.title} ${document.raw_metadata?.withdrawn || ""}`))) {
    return "retracted";
  }
  if (hasOfficial) return "official_confirmed";
  if (hasPrimary) return "primary_source_confirmed";
  if (independentCount >= 2) return "multi_source";
  return documents.length > 0 ? "single_source" : "unverified";
}

function deriveSeverity(document) {
  const raw = String(document.raw_severity || "").toLowerCase();
  if (SEVERITY_ORDER[raw]) return raw;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return "critical";
    if (numeric >= 7) return "high";
    if (numeric >= 4) return "medium";
  }

  const text = `${document.title} ${document.summary || ""}`.toLowerCase();
  if (/catastroph|mass casualty|state of emergency|declaration of war|critical vulnerability|紅色警報/.test(text)) return "critical";
  if (/earthquake|hurricane|typhoon|known exploited|ransomware|sanction|military attack|severe|豪雨|颱風/.test(text)) return "high";
  if (/warning|advisory|regulation|protest|election|flood|wildfire|medium/.test(text)) return "medium";
  return "low";
}

function inferEventType(document, domain) {
  const text = `${document.title} ${document.summary || ""}`.toLowerCase();
  if (domain === "hazards") {
    if (/earthquake|地震/.test(text)) return "hazards.earthquake";
    if (/typhoon|hurricane|cyclone|颱風/.test(text)) return "hazards.typhoon";
    if (/flood|rain|豪雨|洪水/.test(text)) return "hazards.flood";
    if (/wildfire|野火/.test(text)) return "hazards.wildfire";
    return "hazards.storm";
  }
  if (domain === "technology") {
    if (/cve-|vulnerab|cyber/.test(text)) return "technology.cybersecurity";
    if (/semiconductor|chip/.test(text)) return "technology.semiconductor";
    if (/artificial intelligence|\bai\b|machine learning/.test(text)) return "technology.ai";
    return document.document_type === "research" ? "technology.research" : "technology.computing";
  }
  if (domain === "finance") {
    if (/interest rate|central bank|fed |ecb /.test(text)) return "finance.central_bank";
    if (/inflation|cpi/.test(text)) return "finance.inflation";
    if (/bank|credit/.test(text)) return "finance.banking";
    return "finance.corporate";
  }
  if (/election/.test(text)) return "politics.election";
  if (/sanction/.test(text)) return "politics.sanction";
  if (/military|war|attack|conflict/.test(text)) return "politics.conflict";
  if (/regulation|rule/.test(text)) return "politics.regulation";
  if (/bill|legislation|law/.test(text)) return "politics.legislation";
  return "politics.geopolitics";
}

function confidenceScore(documents, independentCount, hasOfficial) {
  const base = Math.max(
    ...documents.map((document) => ({ official: 0.92, primary_statement: 0.86, professional_media: 0.72, academic: 0.68, aggregator: 0.55 }[document.authority_class] || 0.5))
  );
  return Number(clamp(base + Math.min(0.06, independentCount * 0.02) + (hasOfficial ? 0.02 : 0), 0, 0.99, 0.5).toFixed(2));
}

function evidenceRole(document) {
  if (document.promotion_decision?.status === "cancelled") return "correction";
  if (document.authority_class === "official") return document.document_type === "hazard_observation" ? "observation" : "official";
  if (document.authority_class === "primary_statement") return "primary";
  if (document.document_type === "research") return "research";
  if (document.document_type === "hazard_observation" || document.document_type === "market_observation") return "observation";
  return "reporting";
}

function evidenceConfidence(document) {
  return { official: 0.98, primary_statement: 0.9, professional_media: 0.78, academic: 0.75, aggregator: 0.58 }[document.authority_class] || 0.55;
}

function isContradiction(document) {
  if (document.promotion_decision?.status === "cancelled") return true;
  return /correction|retraction|withdrawn|disputed/i.test(`${document.title} ${(document.tags || []).join(" ")}`);
}

function chooseLocation(documents) {
  const candidates = documents
    .map((document) => ({ ...document.location, authority: document.authority_class }))
    .filter((location) => {
      const hasLatitude = location.latitude !== null && location.latitude !== undefined && Number.isFinite(Number(location.latitude));
      const hasLongitude = location.longitude !== null && location.longitude !== undefined && Number.isFinite(Number(location.longitude));
      return Boolean(location.label || location.country_code || (hasLatitude && hasLongitude));
    })
    .sort((left, right) => locationScore(right) - locationScore(left));
  const location = candidates[0];
  if (!location) return null;
  return {
    label: location.label || null,
    country_code: location.country_code || null,
    geometry_type:
      location.geometry_type ||
      (location.latitude !== null && location.latitude !== undefined ? "point" : location.country_code ? "country" : "region"),
    latitude:
      location.latitude !== null && location.latitude !== undefined && Number.isFinite(Number(location.latitude))
        ? Number(location.latitude)
        : null,
    longitude:
      location.longitude !== null && location.longitude !== undefined && Number.isFinite(Number(location.longitude))
        ? Number(location.longitude)
        : null,
    precision: location.precision || "named",
    confidence: clamp(location.confidence, 0, 1, 0.6)
  };
}

function locationScore(location) {
  const point =
    location.latitude !== null &&
    location.latitude !== undefined &&
    location.longitude !== null &&
    location.longitude !== undefined &&
    Number.isFinite(Number(location.latitude)) &&
    Number.isFinite(Number(location.longitude))
      ? 5
      : 0;
  const official = location.authority === "official" ? 3 : 0;
  return point + official + Number(location.confidence || 0);
}

function extractEntities(documents) {
  const entities = new Map();
  for (const document of documents) {
    const location = document.location;
    if (location?.country_code) {
      const id = `country:${location.country_code.toLowerCase()}`;
      entities.set(id, {
        id,
        entity_type: "country",
        canonical_name: location.label || location.country_code,
        country_code: location.country_code,
        aliases: [location.country_code, location.label].filter(Boolean),
        role: "location",
        confidence: location.confidence || 0.8,
        metadata: {}
      });
    }

    const companyCode = document.raw_metadata?.company_code;
    const companyName = document.raw_metadata?.company_name;
    if (companyCode && companyName) {
      const id = `company:twse:${String(companyCode).toLowerCase()}`;
      entities.set(id, {
        id,
        entity_type: "company",
        canonical_name: companyName,
        country_code: "TW",
        aliases: [companyName, companyCode],
        role: "issuer",
        confidence: 1,
        metadata: { ticker: companyCode, exchange: "TWSE" }
      });
    }

    const text = `${document.title} ${document.summary || ""}`.toLowerCase();
    for (const known of KNOWN_ENTITIES) {
      if (known.aliases.some((alias) => text.includes(alias.toLowerCase()))) {
        entities.set(known.id, { ...known, role: known.role || "actor", confidence: 0.85, metadata: known.metadata || {} });
      }
    }
  }
  return [...entities.values()];
}

function lifecycleStatus(documents, lastUpdated, now) {
  if (documents.some((document) => /cancelled|canceled/i.test(`${document.title} ${document.raw_metadata?.status || ""}`))) return "cancelled";
  const referenceTime = Date.parse(now || "");
  const ageHours = ((Number.isFinite(referenceTime) ? referenceTime : Date.now()) - Date.parse(lastUpdated || 0)) / 3_600_000;
  return ageHours <= 24 ? "emerging" : "ongoing";
}

function minTimestamp(values) {
  const times = values.map(Date.parse).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function maxTimestamp(values) {
  const times = values.map(Date.parse).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

const KNOWN_ENTITIES = [
  { id: "company:nvidia", entity_type: "company", canonical_name: "NVIDIA", country_code: "US", aliases: ["nvidia", "nvda", "輝達"] },
  { id: "company:tsmc", entity_type: "company", canonical_name: "TSMC", country_code: "TW", aliases: ["tsmc", "taiwan semiconductor", "台積電"] },
  { id: "organization:eu", entity_type: "organization", canonical_name: "European Union", country_code: null, aliases: ["european union", "eu commission"] },
  { id: "organization:nato", entity_type: "organization", canonical_name: "NATO", country_code: null, aliases: ["nato", "north atlantic treaty organization"] },
  { id: "organization:un", entity_type: "organization", canonical_name: "United Nations", country_code: null, aliases: ["united nations", "聯合國"] }
];
