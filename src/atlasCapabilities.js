import { DOMAIN_DEFINITIONS, DOMAIN_IDS } from "./atlasDomains.js";
import { createMacroCapabilities } from "./macro/capabilities.js";
import { queryState } from "./atlasQueryState.js";
import { buildCompanyCoverage, buildStockNewsCoverage } from "./entities/coverage.js";
import {
  PRESENTATION_PROFILES,
  briefCandidatePolicy,
  regionsForPresentation,
  selectBriefEvents,
  validatePresentation
} from "./atlasBriefSelector.js";

export const CONSUMER_CONTRACT_VERSION = "1.2";
const COMPANY_LIST_BYTE_BUDGET = 128 * 1024;
const COMPANY_COLLECTION_BYTE_BUDGET = 512 * 1024;
const COMPANY_NEWS_BYTE_BUDGET = 512 * 1024;

export const PROFILE_DEFINITIONS = Object.freeze([
  profile("macro_v1", "Official macro indicators, release calendar and observed revision history; no provider I/O on reads."),
  profile("brief_compact_v1", "Quality-gated source-backed brief with optional regional presentation for Kuro and general agents."),
  profile("change_feed_v1", "Ordered durable Story/Event state changes for background consumers."),
  profile("story_detail_v1", "Story timeline context with bounded normalized documents and canonical event."),
  profile("evidence_pack_v1", "Expanded event evidence for OMI and analysis consumers."),
  profile("source_status_v1", "Source registry health, freshness, catch-up gaps, and policy metadata."),
  profile("latest_events_v1", "Bounded compact canonical events ordered by latest update."),
  profile("search_results_v1", "Bounded mixed canonical search results."),
  profile("domain_registry_v1", "Backend-owned domain registry for consumer discovery."),
  profile("company_list_v1", "Deterministic cursor-paginated canonical company directory."),
  profile("company_profile_v1", "Canonical company identity, official identifiers, aliases, and lineage."),
  profile("company_events_v1", "Events linked to a canonical company through resolved Story evidence."),
  profile("company_evidence_v1", "Resolved company documents and Stories with relationship evidence."),
  profile("company_relations_v1", "Canonical company, security, and issuer relationships."),
  profile("company_snapshot_v1", "Bounded company intelligence snapshot with visible master completeness."),
  profile("company_news_latest_v1", "Canonical company-related Documents with aggregated Company and Security context."),
  profile("company_disclosures_v1", "Official company disclosure Documents, independent of Event promotion."),
  profile("company_news_stock_v1", "Exact stock news Documents with stock-scoped target coverage and preserved rights.")
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
  const nowIso = () => context.clock?.().toISOString() || new Date().toISOString();

  function envelope(profileId, data, scope = {}, extra = {}) {
    assertProfile(profileId);
    const state = queryState(context, scope);
    return {
      contract_version: CONSUMER_CONTRACT_VERSION,
      profile: profileId,
      generated_at: nowIso(),
      data,
      ...extra,
      freshness: state.freshness,
      coverage: state.coverage,
      warnings: state.warnings
    };
  }

  function companyId(input) {
    const direct = String(input.entity_id || input.company_id || "").trim();
    if (direct) {
      const entity = context.store.getEntity(direct);
      if (!entity) throw new CapabilityError(404, "company_not_found", "company not found");
      if (entity.entity_type === "security") {
        const company = context.store.findCompanyForSecurity(entity.id);
        if (!company) throw new CapabilityError(404, "company_not_found", "security has no unique active company relation");
        return company.id;
      }
      return direct;
    }
    const exchange = String(input.exchange || "").trim().toUpperCase();
    const symbol = String(input.symbol || "").trim().toUpperCase();
    if (!exchange || !symbol) throw new CapabilityError(400, "invalid_company_locator", "entity_id or exchange + symbol is required");
    const entity = context.store.findCompanyByTicker(exchange, symbol);
    if (!entity) throw new CapabilityError(404, "company_not_found", "company not found");
    return entity.id;
  }

  function requireCompany(entityId) {
    const entity = context.store.getEntity(entityId);
    if (!entity || entity.entity_type !== "company") {
      throw new CapabilityError(404, "company_not_found", "company not found");
    }
    return entity;
  }

  function companyEnvelope(profileId, data, entityId, extra = {}) {
    assertProfile(profileId);
    const companyState = buildCompanyCoverage(context, entityId);
    const domainState = queryState(context, { domain: "finance" });
    return {
      contract_version: CONSUMER_CONTRACT_VERSION,
      profile: profileId,
      generated_at: nowIso(),
      data,
      ...extra,
      freshness: companyState.freshness,
      coverage: companyState.coverage,
      warnings: [...companyState.warnings, ...domainState.warnings],
      domain_state: domainState
    };
  }

  function companyNewsEnvelope(data, markets, extra = {}) {
    const profileId = "company_news_latest_v1";
    assertProfile(profileId);
    const companyNewsState = context.store.getCompanyNewsCoverage(markets, nowIso());
    const domainState = queryState(context, { domain: "finance" });
    return {
      contract_version: CONSUMER_CONTRACT_VERSION,
      profile: profileId,
      generated_at: nowIso(),
      data,
      ...extra,
      freshness: companyNewsState.freshness,
      coverage: {
        ...companyNewsState.coverage,
        target_mode: context.config.companyNewsTargets?.mode || "canary"
      },
      warnings: [...companyNewsState.warnings, ...domainState.warnings],
      domain_state: domainState
    };
  }

  // Brief candidates retain relevance ranking. Browsable collections use time/id
  // ordering and bind their cursor to the complete query scope.
  function regionalPage(kind, input = {}) {
    const presentation = validatePresentation(input.presentation);
    if (!presentation) throw new CapabilityError(400, "invalid_presentation", "Unknown regional presentation");
    const filters = { ...input, domain: validateDomain(input.domain), limit: clampLimit(input.limit, 50) };
    const query = { presentation, ordering: "latest", coverage_scope: filters.domain ? "domain" : "global",
      relationship: kind === "stories" && presentation !== "global" ? "regional_event_stories" : kind };
    const read = (options) => kind === "events" ? context.store.listEvents(options) : context.store.listStories(options);
    if (presentation === "global") {
      // Preserve legacy unscoped pagination, but never accept a regional cursor.
      if (input.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString("utf8"));
          if (parsed.kind?.startsWith("regional_")) throw new Error("regional cursor");
        } catch {
          throw new CapabilityError(400, "invalid_cursor", "Invalid cursor for global query");
        }
      }
      return { ...read(filters), query };
    }
    const scope = { kind: `regional_${kind}_v1`, presentation };
    for (const key of ["domain", "country", "entity", "event_type", "severity", "lifecycle", "verification", "status", "q", "from", "to"]) {
      scope[key] = filters[key] || null;
    }
    if (input.cursor && (typeof input.cursor !== "string" || input.cursor.length > 4000)) {
      throw new CapabilityError(400, "invalid_cursor", "Cursor must be a bounded string");
    }
    const position = decodeScopedCursor(input.cursor, scope, ["time", "id"]);
    if (position && !Number.isFinite(Date.parse(position.time))) throw new CapabilityError(400, "invalid_cursor", "Invalid cursor time");
    const result = read({ ...filters, relevance_regions: regionsForPresentation(presentation), order: "latest",
      cursor: position ? Buffer.from(JSON.stringify(position)).toString("base64url") : undefined });
    const next = result.next_cursor ? JSON.parse(Buffer.from(result.next_cursor, "base64url").toString("utf8")) : null;
    return { ...result, next_cursor: encodeScopedCursor(scope, next), query };
  }

  return Object.freeze({
    ...createMacroCapabilities(context, CapabilityError),
    eventsPage(input = {}) { return regionalPage("events", input); },
    storiesPage(input = {}) { return regionalPage("stories", input); },
    profiles() {
      return {
        contract_version: CONSUMER_CONTRACT_VERSION,
        generated_at: nowIso(),
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
      const country = validateCountry(input.country);
      if (input.profile && input.profile !== "latest_events_v1") {
        throw new CapabilityError(400, "invalid_profile", "latest profile must be latest_events_v1");
      }
      const limit = clampLimit(input.limit, 12);
      const result = regionalPage("events", { ...input, domain, country, limit });
      return envelope(
        "latest_events_v1",
        result.items.map(projectCompactEvent),
        { domain },
        { query: result.query, pagination: { next_cursor: result.next_cursor, count: result.items.length } }
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
      const country = validateCountry(input.country);
      const limit = clampLimit(input.limit, 12);
      const presentation = validatePresentation(input.presentation);
      if (!presentation) {
        throw new CapabilityError(400, "invalid_presentation", `presentation must be one of: ${PRESENTATION_PROFILES.join(", ")}`);
      }
      const profileId = input.profile || "brief_compact_v1";
      if (!["brief_compact_v1", "evidence_pack_v1"].includes(profileId)) {
        throw new CapabilityError(400, "invalid_profile", "brief profile must be brief_compact_v1 or evidence_pack_v1");
      }
      const candidateLimit = Math.min(200, Math.max(40, limit * 8));
      const now = nowIso();
      const policy = briefCandidatePolicy(domain, now);
      const candidateFilters = {
        ...input,
        ...policy,
        domain,
        country,
        from: laterTimestamp(input.from, policy.from),
        cursor: undefined,
        limit: candidateLimit
      };
      const candidates = presentation === "global"
        ? context.store.listEvents(candidateFilters).items
        : context.store.listEventsByRegionalRelevance({
            ...candidateFilters,
            regions: regionsForPresentation(presentation)
          }).items;
      const selected = selectBriefEvents(candidates, { presentation, limit, now });
      const summaries = selected.events;
      const events = profileId === "evidence_pack_v1"
        ? summaries.map((event) => context.store.getEvent(event.id) || event)
        : summaries;
      const sources = context.store.listSources();
      const data =
        profileId === "evidence_pack_v1"
          ? { event_count: events.length, selection: selected.selection, events: events.map(projectEvidenceEvent) }
          : buildCompactBrief(events, sources, selected.selection, now);
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
    },

    companyDisclosures(input = {}) {
      if (input.profile && input.profile !== "company_disclosures_v1") throw new CapabilityError(400, "invalid_profile", "invalid disclosure profile");
      let markets = validateCompanyNewsMarkets(input.markets ?? input.market);
      let stock = null;
      if (input.exchange || input.symbol) {
        const exchange = String(input.exchange || "").trim().toUpperCase();
        const symbol = String(input.symbol || "").trim().toUpperCase();
        if (!["TWSE", "TPEX"].includes(exchange) || !/^[A-Z0-9]{4,12}$/.test(symbol)) throw new CapabilityError(400, "invalid_stock_locator", "disclosures require a supported exchange and symbol");
        const resolved = context.store.resolveStockNewsIdentity(exchange, symbol);
        if (resolved.ambiguous) throw new CapabilityError(409, "ambiguous_stock_identity", "stock identity is not unique");
        if (!resolved.stock) throw new CapabilityError(404, "stock_not_found", "stock identity not found");
        stock = resolved.stock;
        markets = [exchange];
      }
      const scope = { kind: "company_disclosures_v1", markets: markets.join(","), ...(stock ? { security_id: stock.security_id, company_id: stock.company_id } : {}) };
      const cursor = decodeScopedCursor(input.cursor, scope, ["time", "id"]);
      if (cursor && !Number.isFinite(Date.parse(cursor.time))) throw new CapabilityError(400, "invalid_cursor", "invalid disclosure cursor time");
      const result = context.store.listCompanyDisclosures({ markets, ...stock, limit: companyNewsLimit(input.limit), before_time: cursor?.time, before_id: cursor?.id });
      const page = boundJsonItems(result.items.map((item) => ({ ...projectDocument(item), companies: item.companies || [] })), COMPANY_NEWS_BYTE_BUDGET);
      const last = result.items[page.items.length - 1];
      const next = page.truncated ? { time: last.sort_time, id: last.id } : result.next_position;
      const sources = context.store.listSources().filter((source) => source.coverage?.capabilities?.includes("company.disclosures")
        && source.coverage.markets?.some((market) => markets.includes(String(market).toUpperCase())));
      const sourceStates = sources.map((source) => {
        const age = Date.parse(nowIso()) - Date.parse(source.health.last_success_at || "");
        const status = !source.enabled ? "disabled" : source.health.last_fetch_status === "failed" || source.health.last_fetch_status === "rate_limited" ? "failed"
          : !Number.isFinite(age) ? "missing" : age > source.cadence_ms * 2 ? "stale" : source.health.last_fetch_status === "partial" ? "partial" : "current";
        return { source_id: source.id, status, last_success_at: source.health.last_success_at, guarantee: source.coverage.guarantee };
      });
      const status = sourceStates.length === 0 ? "missing" : sourceStates.every((s) => s.status === "current") ? "current"
        : sourceStates.every((s) => s.status === sourceStates[0].status) ? sourceStates[0].status : "partial";
      return { contract_version: CONSUMER_CONTRACT_VERSION, profile: "company_disclosures_v1", generated_at: nowIso(), data: page.items,
        pagination: collectionPagination(page, encodeScopedCursor(scope, next)),
        freshness: { status, data_as_of: page.items[0]?.published_at || page.items[0]?.observed_at || null },
        coverage: { status, markets, scope: stock ? "stock" : "market", ...(stock ? { stock } : {}), guarantee: "bounded_window", sources: sourceStates },
        warnings: [{ code: "DISCLOSURE_BOUNDED_WINDOW", message: "Official disclosures cover a bounded provider window; absence does not prove no disclosure." }] };
    },

    companyNewsLatest(input = {}) {
      if (input.profile && input.profile !== "company_news_latest_v1") {
        throw new CapabilityError(400, "invalid_profile", "company news profile must be company_news_latest_v1");
      }
      const markets = validateCompanyNewsMarkets(input.markets ?? input.market);
      const scope = { kind: "company_news", markets: markets.join(",") };
      const cursor = decodeScopedCursor(input.cursor, scope, ["time", "id"]);
      const result = context.store.listCompanyNews({
        markets,
        limit: companyNewsLimit(input.limit),
        before_time: cursor?.time,
        before_id: cursor?.id
      });
      const items = result.items.map((item) => ({ ...projectDocument(item), companies: item.companies || [] }));
      const page = boundJsonItems(items, COMPANY_NEWS_BYTE_BUDGET);
      const last = page.items.at(-1);
      const nextPosition = page.truncated
        ? { time: last.published_at || last.observed_at || last.fetched_at, id: last.id }
        : result.next_position;
      return companyNewsEnvelope(page.items, markets, {
        pagination: {
          count: page.items.length,
          next_cursor: encodeScopedCursor(scope, nextPosition),
          byte_budget: COMPANY_NEWS_BYTE_BUDGET,
          serialized_bytes: page.serializedBytes,
          truncated_by_byte_budget: page.truncated
        }
      });
    },

    companyNewsStock(input = {}) {
      const profile = "company_news_stock_v1";
      if (input.profile && input.profile !== profile) throw new CapabilityError(400, "invalid_profile", "invalid stock news profile");
      const exchange = String(input.exchange || "").trim().toUpperCase();
      const symbol = String(input.symbol || "").trim().toUpperCase();
      if (!["TWSE", "TPEX"].includes(exchange)) throw new CapabilityError(400, "unsupported_exchange", "stock news supports TWSE and TPEX");
      if (!/^[A-Z0-9]{4,12}$/.test(symbol)) throw new CapabilityError(400, "invalid_symbol", "invalid stock symbol");
      const resolved = context.store.resolveStockNewsIdentity(exchange, symbol);
      if (resolved.ambiguous) throw new CapabilityError(409, "ambiguous_stock_identity", "stock identity is not unique");
      if (!resolved.stock) throw new CapabilityError(404, "stock_not_found", "stock identity not found");
      const stock = resolved.stock;
      const scope = { kind: profile, exchange, symbol, security_id: stock.security_id, company_id: stock.company_id };
      if (input.cursor != null && (typeof input.cursor !== "string" || input.cursor.length > 2000)) {
        throw new CapabilityError(400, "invalid_cursor", "stock news cursor must be a bounded string");
      }
      const cursor = decodeScopedCursor(input.cursor, scope, ["time", "id"]);
      if (cursor && !Number.isFinite(Date.parse(cursor.time))) {
        throw new CapabilityError(400, "invalid_cursor", "stock news cursor time is invalid");
      }
      const result = context.store.listCompanyNews({ markets: [exchange], ...stock,
        limit: companyNewsLimit(input.limit), before_time: cursor?.time, before_id: cursor?.id });
      if (result.items.some((item) => !item.rights?.usage_context
          || item.rights.usage_context !== context.config.contentUsageContext)) {
        throw new CapabilityError(403, "content_usage_not_allowed", "Stored news rights do not permit the configured usage context");
      }
      const items = result.items.map((item) => ({ ...projectDocument(item), companies: item.companies || [] }));
      const page = boundJsonItems(items, COMPANY_NEWS_BYTE_BUDGET);
      const last = result.items[page.items.length - 1];
      const next = page.truncated ? { time: last.sort_time, id: last.id } : result.next_position;
      return { contract_version: CONSUMER_CONTRACT_VERSION, profile, generated_at: nowIso(), stock,
        data: page.items, ...buildStockNewsCoverage(context, stock),
        pagination: collectionPagination(page, encodeScopedCursor(scope, next)) };
    },

    companyList(input = {}) {
      if (input.profile && input.profile !== "company_list_v1") throw new CapabilityError(400, "invalid_profile", "company list profile must be company_list_v1");
      const query = String(input.q || "").trim();
      const market = input.market ? validateCompanyNewsMarkets(input.market)[0] : null;
      const scope = { kind: "company_list", q: query || null, ...(market ? { market } : {}) };
      const cursor = decodeScopedCursor(input.cursor, scope, ["name", "id"]);
      const result = context.store.listEntities({
        type: "company",
        include_listings: true,
        market,
        q: query || undefined,
        limit: clampLimit(input.limit, 50),
        after_name: cursor?.name,
        after_id: cursor?.id
      });
      const page = boundJsonItems(result.items, COMPANY_LIST_BYTE_BUDGET);
      const nextPosition = page.truncated
        ? { name: page.items.at(-1).canonical_name, id: page.items.at(-1).id }
        : result.next_position;
      return envelope("company_list_v1", page.items, { domain: "finance" }, {
        pagination: {
          count: page.items.length,
          next_cursor: encodeScopedCursor(scope, nextPosition),
          byte_budget: COMPANY_LIST_BYTE_BUDGET,
          serialized_bytes: page.serializedBytes,
          truncated_by_byte_budget: page.truncated
        }
      });
    },

    companyProfile(input = {}) {
      if (input.profile && input.profile !== "company_profile_v1") throw new CapabilityError(400, "invalid_profile", "company profile must be company_profile_v1");
      const id = companyId(input);
      return companyEnvelope("company_profile_v1", requireCompany(id), id);
    },

    companyEvents(input = {}) {
      if (input.profile && input.profile !== "company_events_v1") throw new CapabilityError(400, "invalid_profile", "company events profile must be company_events_v1");
      const id = companyId(input);
      requireCompany(id);
      const scope = { kind: "company_events", entity_id: id };
      const cursor = decodeScopedCursor(input.cursor, scope, ["time", "id"]);
      const result = context.store.getEntityEvents(id, { limit: clampLimit(input.limit, 20), before_time: cursor?.time, before_id: cursor?.id });
      const page = boundJsonItems(result.events, COMPANY_COLLECTION_BYTE_BUDGET);
      const nextPosition = page.truncated
        ? { time: page.items.at(-1).last_updated_at, id: page.items.at(-1).id }
        : result.next_position;
      return companyEnvelope("company_events_v1", { ...result, events: page.items, next_position: undefined }, id, {
        pagination: {
          count: page.items.length,
          next_cursor: encodeScopedCursor(scope, nextPosition),
          byte_budget: COMPANY_COLLECTION_BYTE_BUDGET,
          serialized_bytes: page.serializedBytes,
          truncated_by_byte_budget: page.truncated
        }
      });
    },

    companyEvidence(input = {}) {
      if (input.profile && input.profile !== "company_evidence_v1") throw new CapabilityError(400, "invalid_profile", "company evidence profile must be company_evidence_v1");
      const id = companyId(input);
      requireCompany(id);
      const storyScope = { kind: "company_stories", entity_id: id };
      const documentScope = { kind: "company_documents", entity_id: id };
      const storyCursor = decodeScopedCursor(input.story_cursor, storyScope, ["time", "id"]);
      const documentCursor = decodeScopedCursor(input.document_cursor, documentScope, ["time", "id"]);
      const stories = context.store.getEntityStories(id, { limit: clampLimit(input.limit, 20), before_time: storyCursor?.time, before_id: storyCursor?.id });
      const documents = context.store.getEntityDocuments(id, { limit: clampLimit(input.limit, 20), before_time: documentCursor?.time, before_id: documentCursor?.id });
      const storyPage = boundJsonItems(stories.stories, COMPANY_COLLECTION_BYTE_BUDGET);
      const documentPage = boundJsonItems(documents.documents, COMPANY_COLLECTION_BYTE_BUDGET);
      const storyNextPosition = storyPage.truncated
        ? { time: storyPage.items.at(-1).last_seen_at, id: storyPage.items.at(-1).id }
        : stories.next_position;
      const documentLast = documentPage.items.at(-1);
      const documentNextPosition = documentPage.truncated
        ? { time: documentLast.published_at || documentLast.observed_at || documentLast.fetched_at, id: documentLast.id }
        : documents.next_position;
      return companyEnvelope("company_evidence_v1", {
        entity_id: id,
        stories: storyPage.items,
        documents: documentPage.items
      }, id, {
        pagination: {
          stories: collectionPagination(storyPage, encodeScopedCursor(storyScope, storyNextPosition)),
          documents: collectionPagination(documentPage, encodeScopedCursor(documentScope, documentNextPosition))
        }
      });
    },

    companyRelations(input = {}) {
      if (input.profile && input.profile !== "company_relations_v1") throw new CapabilityError(400, "invalid_profile", "company relations profile must be company_relations_v1");
      const id = companyId(input);
      requireCompany(id);
      const scope = { kind: "company_relations", entity_id: id };
      const cursor = decodeScopedCursor(input.cursor, scope, ["type", "id"]);
      const result = context.store.getEntityRelations(id, {
        limit: clampLimit(input.limit, 20),
        after_type: cursor?.type,
        after_id: cursor?.id
      });
      const page = boundJsonItems(result.relations, COMPANY_COLLECTION_BYTE_BUDGET);
      const nextPosition = page.truncated
        ? { type: page.items.at(-1).relation_type, id: page.items.at(-1).id }
        : result.next_position;
      return companyEnvelope("company_relations_v1", { ...result, relations: page.items, next_position: undefined }, id, {
        pagination: collectionPagination(page, encodeScopedCursor(scope, nextPosition))
      });
    },

    companySnapshot(input = {}) {
      if (input.profile && input.profile !== "company_snapshot_v1") throw new CapabilityError(400, "invalid_profile", "company snapshot profile must be company_snapshot_v1");
      const id = companyId(input);
      requireCompany(id);
      return companyEnvelope("company_snapshot_v1", context.store.getEntitySnapshot(id, { limit: clampLimit(input.limit, 12) }), id);
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

function encodeScopedCursor(scope, position) {
  if (!position) return null;
  return Buffer.from(JSON.stringify({ ...scope, ...position })).toString("base64url");
}

function boundJsonItems(items, byteBudget) {
  const selected = [];
  let serializedBytes = 2;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    const nextBytes = serializedBytes + itemBytes + (selected.length > 0 ? 1 : 0);
    if (nextBytes > byteBudget) break;
    selected.push(item);
    serializedBytes = nextBytes;
  }
  if (items.length > 0 && selected.length === 0) {
    throw new CapabilityError(500, "company_item_too_large", "one company result item exceeds the serialized response budget");
  }
  return { items: selected, serializedBytes, truncated: selected.length < items.length };
}

function collectionPagination(page, nextCursor) {
  return {
    count: page.items.length,
    next_cursor: nextCursor,
    byte_budget: COMPANY_COLLECTION_BYTE_BUDGET,
    serialized_bytes: page.serializedBytes,
    truncated_by_byte_budget: page.truncated
  };
}

function decodeScopedCursor(value, scope, positionFields) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    for (const [key, expected] of Object.entries(scope)) {
      if ((parsed?.[key] ?? null) !== (expected ?? null)) throw new Error("scope mismatch");
    }
    if (positionFields.some((field) => typeof parsed?.[field] !== "string" || !parsed[field])) throw new Error("position missing");
    return Object.fromEntries(positionFields.map((field) => [field, parsed[field]]));
  } catch {
    throw new CapabilityError(400, "invalid_cursor", "cursor is invalid or belongs to a different company query");
  }
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

export function validateCountry(value) {
  const country = String(value || "").trim();
  if (!country) return undefined;
  if (!/^[a-z]{2}$/i.test(country)) {
    throw new CapabilityError(400, "invalid_country", "country must be an ISO 3166-1 alpha-2 code");
  }
  return country.toUpperCase();
}

function clampLimit(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 200) {
    throw new CapabilityError(400, "invalid_limit", "limit must be an integer between 1 and 200");
  }
  return number;
}

function companyNewsLimit(value) {
  const limit = clampLimit(value, 20);
  if (limit > 50) {
    throw new CapabilityError(400, "invalid_limit", "company news limit must be an integer between 1 and 50");
  }
  return limit;
}

function validateCompanyNewsMarkets(value) {
  const requested = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  const markets = requested.length > 0 ? requested : ["TWSE", "TPEX"];
  const normalized = [...new Set(markets.map((market) => String(market).trim().toUpperCase()))].sort();
  const invalid = normalized.filter((market) => !["TWSE", "TPEX"].includes(market));
  if (invalid.length > 0) {
    throw new CapabilityError(400, "invalid_market", "company news market must be TWSE or TPEX");
  }
  return normalized;
}

function laterTimestamp(left, right) {
  if (!left) return right;
  return Date.parse(left) > Date.parse(right) ? left : right;
}

function buildCompactBrief(events, sources, selection, generatedAt) {
  const byDomain = Object.fromEntries([...DOMAIN_IDS].map((domain) => [domain, 0]));
  for (const event of events) byDomain[event.primary_domain] = (byDomain[event.primary_domain] || 0) + 1;
  const healthy = sources.filter((source) => ["healthy", "degraded"].includes(source.health.status)).length;
  return {
    generated_at: generatedAt,
    event_count: events.length,
    selection,
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
    publication_status: event.publication_status || "published",
    publication_reason: event.publication_reason || null,
    lifecycle: event.lifecycle,
    severity: event.event_severity,
    confidence: event.confidence,
    verification_status: event.verification_status,
    occurred_at: event.occurred_at,
    last_updated_at: event.last_updated_at,
    evidence_count: event.evidence_count,
    independent_source_count: event.independent_source_count,
    evidence_ids: event.evidence_ids || (event.evidence || []).map((entry) => entry.id || entry.document_id).filter(Boolean),
    representative_url: event.representative_url,
    representative_media: projectMedia(event.representative_media),
    location: event.location,
    regional_relevance: event.regional_relevance || []
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
    domains: story.domains,
    cluster_method: story.cluster_method,
    cluster_version: story.cluster_version,
    representative_document_id: story.representative_document_id,
    merged_into_story_id: story.merged_into_story_id,
    representative_media: projectMedia(story.representative_media || representative?.representative_media),
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
    source_attribution: document.source_attribution || null,
    source_policy_note: document.source_policy_note || null,
    discovery_provider: document.discovery_provider || document.source_name || null,
    source_countries: document.source_countries || [],
    document_type: document.document_type,
    canonical_url: document.canonical_url,
    title: document.title,
    summary: document.summary,
    body_excerpt: document.body_excerpt,
    language: document.language,
    published_at: document.published_at,
    observed_at: document.observed_at,
    publisher: document.publisher,
    publisher_key: document.publisher_key || null,
    event_eligible: document.event_eligible,
    promotion_decision: document.promotion_decision || null,
    classification: document.classification || null,
    domains: document.domains,
    tags: document.tags,
    first_seen_at: document.first_seen_at,
    last_seen_at: document.last_seen_at,
    representative_media: projectMedia(document.representative_media),
    rights: document.rights || null
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
    media_policy: source.media_policy,
    coverage: source.coverage,
    health: source.health
  };
}

function projectMedia(media) {
  if (!media) return null;
  return {
    id: media.id,
    document_id: media.document_id,
    source_id: media.source_id,
    kind: media.kind,
    role: media.role,
    url: media.url,
    thumbnail_url: media.thumbnail_url,
    origin: media.origin,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    alt_text: media.alt_text,
    attribution: media.attribution,
    rights_class: media.rights_class,
    display_policy: media.display_policy,
    policy_version: media.policy_version,
    policy_reason: media.policy_reason
  };
}
