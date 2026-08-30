import { DOMAIN_DEFINITIONS, DOMAIN_IDS } from "./atlasDomains.js";
import { queryState } from "./atlasQueryState.js";

export const CONSUMER_CONTRACT_VERSION = "1.1";

export const PROFILE_DEFINITIONS = Object.freeze([
  profile("brief_compact_v1", "Compact source-backed brief for Kuro and general agents."),
  profile("change_feed_v1", "Ordered durable Story/Event state changes for background consumers."),
  profile("story_detail_v1", "Story timeline context with bounded normalized documents and canonical event."),
  profile("evidence_pack_v1", "Expanded event evidence for OMI and analysis consumers."),
  profile("source_status_v1", "Source registry health, freshness, catch-up gaps, and policy metadata."),
  profile("latest_events_v1", "Bounded compact canonical events ordered by latest update."),
  profile("search_results_v1", "Bounded mixed canonical search results."),
  profile("domain_registry_v1", "Backend-owned domain registry for consumer discovery.")
]);

const PROFILE_IDS = new Set(PROFILE_DEFINITIONS.map((entry) => entry.id));
const CHANGE_TYPES = new Set([
  "story_created",
  "story_updated",
  "evidence_added",
  "verification_changed",
  "severity_changed",
  "event_escalated",
  "event_resolved",
  "story_corrected",
  "story_disputed",
  "story_retracted"
]);

export class CapabilityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "CapabilityError";
    this.status = status;
    this.code = code;
  }
}

export function createAtlasCapabilities(context) {
  function envelope(profileId, data, scope = {}, extra = {}) {
    assertProfile(profileId);
    const state = queryState(context, scope);
    return {
      contract_version: CONSUMER_CONTRACT_VERSION,
      profile: profileId,
      generated_at: new Date().toISOString(),
      data,
      ...extra,
      freshness: state.freshness,
      coverage: state.coverage,
      warnings: state.warnings
    };
  }

  return Object.freeze({
    profiles() {
      return {
        contract_version: CONSUMER_CONTRACT_VERSION,
        generated_at: new Date().toISOString(),
        data: PROFILE_DEFINITIONS
      };
    },

    domains(input = {}) {
      if (input.profile && input.profile !== "domain_registry_v1") {
        throw new CapabilityError(400, "invalid_profile", "domains profile must be domain_registry_v1");
      }
      return envelope("domain_registry_v1", DOMAIN_DEFINITIONS);
    },

    latest(input = {}) {
      const domain = validateDomain(input.domain);
      if (input.profile && input.profile !== "latest_events_v1") {
        throw new CapabilityError(400, "invalid_profile", "latest profile must be latest_events_v1");
      }
      const limit = clampLimit(input.limit, 12);
      const result = context.store.listEvents({ ...input, domain, limit });
      const events = result.items.map((event) => context.store.getEvent(event.id) || event);
      return envelope(
        "latest_events_v1",
        events.map(projectCompactEvent),
        { domain },
        { pagination: { next_cursor: result.next_cursor, count: result.items.length } }
      );
    },

    search(input = {}) {
      const query = String(input.q || "").trim();
      if (query.length < 2) throw new CapabilityError(400, "invalid_query", "q must contain at least 2 characters");
      if (input.profile && input.profile !== "search_results_v1") {
        throw new CapabilityError(400, "invalid_profile", "search profile must be search_results_v1");
      }
      const result = context.store.search(query, clampLimit(input.limit, 30));
      return envelope("search_results_v1", {
        query,
        documents: result.documents.map(projectDocument),
        stories: result.stories,
        events: result.events.map(projectCompactEvent),
        entities: result.entities
      });
    },

    storyGet(input = {}) {
      const storyId = String(input.story_id || "").trim();
      if (!storyId) throw new CapabilityError(400, "invalid_story_id", "story_id is required");
      const story = context.store.getStory(storyId);
      if (!story) throw new CapabilityError(404, "story_not_found", "story not found");
      const event = context.store.getStoryEvent(storyId);
      const profileId = input.profile || "story_detail_v1";
      if (!["story_detail_v1", "evidence_pack_v1"].includes(profileId)) {
        throw new CapabilityError(400, "invalid_profile", "story profile must be story_detail_v1 or evidence_pack_v1");
      }
      const data =
        profileId === "evidence_pack_v1"
          ? { story: projectStory(story), event: event ? projectEvidenceEvent(event) : null }
          : { story: projectStory(story), event: event ? projectCompactEvent(event) : null };
      return envelope(profileId, data, { domain: event?.primary_domain });
    },

    brief(input = {}) {
      const domain = validateDomain(input.domain);
      const limit = clampLimit(input.limit, 12);
      const profileId = input.profile || "brief_compact_v1";
      if (!["brief_compact_v1", "evidence_pack_v1"].includes(profileId)) {
        throw new CapabilityError(400, "invalid_profile", "brief profile must be brief_compact_v1 or evidence_pack_v1");
      }
      const summaries = context.store.listEvents({ ...input, domain, limit }).items;
      const events = summaries.map((event) => context.store.getEvent(event.id) || event);
      const sources = context.store.listSources();
      const data =
        profileId === "evidence_pack_v1"
          ? { event_count: events.length, events: events.map(projectEvidenceEvent) }
          : buildCompactBrief(events, sources);
      return envelope(profileId, data, { domain });
    },

    changes(input = {}) {
      const domain = validateDomain(input.domain);
      const changeType = String(input.change_type || "").trim() || undefined;
      if (changeType && !CHANGE_TYPES.has(changeType)) {
        throw new CapabilityError(400, "invalid_change_type", `change_type must be one of: ${[...CHANGE_TYPES].join(", ")}`);
      }
      const profileId = input.profile || "change_feed_v1";
      if (profileId !== "change_feed_v1") {
        throw new CapabilityError(400, "invalid_profile", "changes profile must be change_feed_v1");
      }
      const headSequence = context.store.listStoryUpdates({ limit: 1 }).head_sequence;
      const cursorScope = { domain: domain || null, change_type: changeType || null };
      const afterSequence = decodeChangeCursor(input.cursor, headSequence, cursorScope);
      const result = context.store.listStoryUpdates({
        after_sequence: afterSequence,
        domain,
        change_type: changeType,
        limit: clampLimit(input.limit, 50)
      });
      if (result.min_sequence > 0 && afterSequence < result.min_sequence - 1) {
        throw new CapabilityError(410, "cursor_expired", "change cursor is older than the retained history");
      }
      return envelope(profileId, result.items, { domain }, {
        pagination: {
          count: result.items.length,
          has_more: result.has_more,
          next_cursor: encodeChangeCursor(result.next_sequence, cursorScope),
          head_cursor: encodeChangeCursor(result.head_sequence, cursorScope)
        }
      });
    },

    sourceStatus(input = {}) {
      const domain = validateDomain(input.domain);
      if (input.profile && input.profile !== "source_status_v1") {
        throw new CapabilityError(400, "invalid_profile", "source profile must be source_status_v1");
      }
      const sources = context.store.listSources();
      const selected = domain ? sources.filter((source) => source.domains.includes(domain)) : sources;
      return envelope("source_status_v1", selected.map(projectSource), { domain });
    }
  });
}

export function encodeChangeCursor(sequence, scope = {}) {
  const value = Math.max(0, Number(sequence) || 0);
  return Buffer.from(JSON.stringify({
    kind: "atlas_changes",
    sequence: value,
    domain: scope.domain || null,
    change_type: scope.change_type || null
  })).toString("base64url");
}

function decodeChangeCursor(value, headSequence, scope) {
  if (value === null || value === undefined || value === "") return 0;
  if (value === "now") return headSequence;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const sequence = Number(parsed?.sequence);
    if (parsed?.kind !== "atlas_changes" || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error("invalid");
    if ((parsed.domain || null) !== scope.domain || (parsed.change_type || null) !== scope.change_type) {
      throw new CapabilityError(400, "cursor_scope_mismatch", "change cursor was issued for different filters");
    }
    if (sequence > headSequence) throw new CapabilityError(400, "invalid_cursor", "change cursor is ahead of the current log");
    return sequence;
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    throw new CapabilityError(400, "invalid_cursor", "cursor is not a valid Atlas change cursor");
  }
}

function profile(id, description) {
  return { id, contract_version: CONSUMER_CONTRACT_VERSION, description };
}

function assertProfile(profileId) {
  if (!PROFILE_IDS.has(profileId)) throw new CapabilityError(500, "unknown_profile", `Unknown server profile: ${profileId}`);
}

function validateDomain(value) {
  const domain = String(value || "").trim() || undefined;
  if (domain && !DOMAIN_IDS.has(domain)) {
    throw new CapabilityError(400, "invalid_domain", `domain must be one of: ${[...DOMAIN_IDS].join(", ")}`);
  }
  return domain;
}

function clampLimit(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 200) {
    throw new CapabilityError(400, "invalid_limit", "limit must be an integer between 1 and 200");
  }
  return number;
}

function buildCompactBrief(events, sources) {
  const byDomain = Object.fromEntries([...DOMAIN_IDS].map((domain) => [domain, 0]));
  for (const event of events) byDomain[event.primary_domain] = (byDomain[event.primary_domain] || 0) + 1;
  const healthy = sources.filter((source) => ["healthy", "degraded"].includes(source.health.status)).length;
  return {
    generated_at: new Date().toISOString(),
    event_count: events.length,
    source_health: { usable: healthy, total: sources.length },
    domain_counts: byDomain,
    highlights: events.slice(0, 8).map(projectCompactEvent)
  };
}

function projectCompactEvent(event) {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    event_type: event.event_type,
    domain: event.primary_domain,
    primary_domain: event.primary_domain,
    lifecycle: event.lifecycle,
    severity: event.event_severity,
    confidence: event.confidence,
    verification_status: event.verification_status,
    occurred_at: event.occurred_at,
    last_updated_at: event.last_updated_at,
    evidence_count: event.evidence_count,
    independent_source_count: event.independent_source_count,
    evidence_ids: (event.evidence || []).map((entry) => entry.id || entry.document_id).filter(Boolean),
    representative_url: event.representative_url,
    location: event.location
  };
}

function projectEvidenceEvent(event) {
  return {
    ...projectCompactEvent(event),
    domains: event.domains,
    confidence: event.confidence,
    has_primary_source: event.has_primary_source,
    has_official_source: event.has_official_source,
    derivation: event.derivation,
    stories: event.stories || [],
    evidence: (event.evidence || []).map((document) => ({
      ...projectDocument(document),
      evidence_role: document.evidence_role,
      supports: document.supports,
      evidence_confidence: document.evidence_confidence
    })),
    entities: event.entities || [],
    locations: event.locations || []
  };
}

function projectStory(story) {
  const representative = (story.documents || []).find((document) => document.is_representative) || story.documents?.[0];
  return {
    id: story.id,
    version: story.version,
    canonical_title: story.canonical_title,
    summary: story.summary || representative?.summary || representative?.body_excerpt || null,
    status: story.status,
    first_seen_at: story.first_seen_at,
    last_seen_at: story.last_seen_at,
    document_count: story.document_count,
    independent_source_count: story.independent_source_count,
    cluster_method: story.cluster_method,
    cluster_version: story.cluster_version,
    representative_document_id: story.representative_document_id,
    merged_into_story_id: story.merged_into_story_id,
    documents: (story.documents || []).map(projectDocument)
  };
}

function projectDocument(document) {
  return {
    id: document.id,
    source_id: document.source_id,
    source_name: document.source_name,
    source_class: document.source_class,
    authority_class: document.authority_class,
    document_type: document.document_type,
    canonical_url: document.canonical_url,
    title: document.title,
    summary: document.summary,
    body_excerpt: document.body_excerpt,
    language: document.language,
    published_at: document.published_at,
    observed_at: document.observed_at,
    publisher: document.publisher,
    domains: document.domains,
    tags: document.tags,
    first_seen_at: document.first_seen_at,
    last_seen_at: document.last_seen_at
  };
}

function projectSource(source) {
  return {
    id: source.id,
    name: source.name,
    provider_type: source.provider_type,
    source_class: source.source_class,
    authority_class: source.authority_class,
    document_type: source.document_type,
    domains: source.domains,
    languages: source.languages,
    countries: source.countries,
    enabled: source.enabled,
    disabled_reason: source.disabled_reason,
    cadence_ms: source.cadence_ms,
    homepage: source.homepage,
    docs_url: source.docs_url,
    attribution: source.attribution,
    policy_note: source.policy_note,
    health: source.health
  };
}
