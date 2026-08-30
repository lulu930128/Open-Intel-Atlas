import { APP_NAME, APP_VERSION } from "./config.js";
import { DOMAIN_DEFINITIONS, DOMAIN_IDS } from "./atlasDomains.js";
import { CapabilityError, CONSUMER_CONTRACT_VERSION } from "./atlasCapabilities.js";
import { queryState } from "./atlasQueryState.js";

export { queryState } from "./atlasQueryState.js";

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const LIFECYCLES = new Set(["emerging", "ongoing", "resolved", "superseded", "cancelled"]);
const VERIFICATION_STATES = new Set([
  "unverified",
  "single_source",
  "multi_source",
  "primary_source_confirmed",
  "official_confirmed",
  "disputed",
  "corrected",
  "retracted"
]);

export async function handleV1Api(request, response, requestUrl, context) {
  const { pathname } = requestUrl;
  if (!pathname.startsWith("/api/v1")) return false;

  if (request.method === "GET" && pathname === "/api/v1/health") {
    const stats = context.store.getStats();
    return sendV1Json(response, {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      now: new Date().toISOString(),
      storage: publicStats(stats),
      collector: context.collector.status(),
      scheduler: context.scheduler.status()
    }, context);
  }

  if (request.method === "GET" && pathname === "/api/v1/profiles") {
    return sendJson(response, context.capabilities.profiles());
  }

  if (request.method === "GET" && pathname === "/api/v1/domains") {
    if (requestUrl.searchParams.has("profile")) {
      return sendJson(response, context.capabilities.domains({ profile: optional(requestUrl.searchParams.get("profile")) }));
    }
    return sendV1Json(response, { data: DOMAIN_DEFINITIONS }, context);
  }

  if (request.method === "GET" && pathname === "/api/v1/sources") {
    const domain = parseDomain(requestUrl.searchParams.get("domain"));
    if (requestUrl.searchParams.has("profile")) {
      return sendJson(response, context.capabilities.sourceStatus({
        domain,
        profile: optional(requestUrl.searchParams.get("profile"))
      }));
    }
    const sources = context.store.listSources();
    return sendV1Json(response, {
      data: domain ? sources.filter((source) => source.domains.includes(domain)) : sources,
      collector: context.collector.status()
    }, context, 200, { domain });
  }

  if (request.method === "GET" && pathname === "/api/v1/freshness") {
    const domain = parseDomain(requestUrl.searchParams.get("domain"));
    const state = queryState(context, { domain });
    return sendV1Json(response, { data: state }, context, 200, { domain });
  }

  if (request.method === "GET" && pathname === "/api/v1/documents") {
    const filters = listFilters(requestUrl.searchParams, { document: true });
    return sendPage(response, context.store.listDocuments(filters), context, { domain: filters.domain });
  }

  const documentId = pathId(pathname, "/api/v1/documents/");
  if (request.method === "GET" && documentId !== null) {
    return sendResource(response, context.store.getDocument(documentId, true), "document", context);
  }

  if (request.method === "GET" && pathname === "/api/v1/stories") {
    const filters = listFilters(requestUrl.searchParams);
    filters.status = optional(requestUrl.searchParams.get("status"));
    return sendPage(response, context.store.listStories(filters), context, { domain: filters.domain });
  }

  const storyId = pathId(pathname, "/api/v1/stories/");
  if (request.method === "GET" && storyId !== null) {
    const profile = optional(requestUrl.searchParams.get("profile"));
    if (profile) return sendJson(response, context.capabilities.storyGet({ story_id: storyId, profile }));
    return sendResource(response, context.store.getStory(storyId), "story", context);
  }

  if (request.method === "GET" && pathname === "/api/v1/events") {
    const filters = eventFilters(requestUrl.searchParams);
    if (requestUrl.searchParams.has("profile")) {
      return sendJson(response, context.capabilities.latest({
        ...filters,
        profile: optional(requestUrl.searchParams.get("profile"))
      }));
    }
    return sendPage(response, context.store.listEvents(filters), context, { domain: filters.domain });
  }

  const eventId = pathId(pathname, "/api/v1/events/");
  if (request.method === "GET" && eventId !== null) {
    return sendResource(response, context.store.getEvent(eventId), "event", context);
  }

  if (request.method === "GET" && pathname === "/api/v1/entities") {
    return sendPage(
      response,
      context.store.listEntities({
        q: optional(requestUrl.searchParams.get("q")),
        type: optional(requestUrl.searchParams.get("type")),
        limit: parseLimit(requestUrl.searchParams.get("limit"))
      }),
      context
    );
  }

  const entityEventsMatch = pathname.match(/^\/api\/v1\/entities\/([^/]+)\/events$/);
  if (request.method === "GET" && entityEventsMatch) {
    const result = context.store.getEntityEvents(decodePathId(entityEventsMatch[1]), {
      limit: parseLimit(requestUrl.searchParams.get("limit"))
    });
    return sendResource(response, result, "entity", context);
  }

  const entityId = pathId(pathname, "/api/v1/entities/");
  if (request.method === "GET" && entityId !== null) {
    return sendResource(
      response,
      context.store.getEntity(entityId, { limit: parseLimit(requestUrl.searchParams.get("limit")) }),
      "entity",
      context
    );
  }

  if (request.method === "GET" && pathname === "/api/v1/search") {
    const query = optional(requestUrl.searchParams.get("q"));
    if (!query || query.length < 2) {
      throw new ApiError(400, "invalid_query", "q must contain at least 2 characters");
    }
    if (requestUrl.searchParams.has("profile")) {
      return sendJson(response, context.capabilities.search({
        q: query,
        limit: parseLimit(requestUrl.searchParams.get("limit"), 30),
        profile: optional(requestUrl.searchParams.get("profile"))
      }));
    }
    return sendV1Json(
      response,
      { data: context.store.search(query, parseLimit(requestUrl.searchParams.get("limit"), 30)) },
      context
    );
  }

  if (request.method === "GET" && pathname === "/api/v1/brief") {
    const filters = eventFilters(requestUrl.searchParams);
    return sendJson(response, context.capabilities.brief({
      ...filters,
      limit: requestUrl.searchParams.has("limit") ? filters.limit : 12,
      profile: optional(requestUrl.searchParams.get("profile")) || "brief_compact_v1"
    }));
  }

  if (request.method === "GET" && pathname === "/api/v1/changes") {
    return sendJson(response, context.capabilities.changes({
      domain: parseDomain(requestUrl.searchParams.get("domain")),
      change_type: optional(requestUrl.searchParams.get("change_type")),
      cursor: optional(requestUrl.searchParams.get("cursor")),
      limit: parseLimit(requestUrl.searchParams.get("limit")),
      profile: optional(requestUrl.searchParams.get("profile")) || "change_feed_v1"
    }));
  }

  if (request.method === "GET" && pathname === "/api/v1/collector") {
    return sendV1Json(response, {
      data: { collector: context.collector.status(), scheduler: context.scheduler.status() }
    }, context);
  }

  if (request.method === "POST" && pathname === "/api/v1/collect") {
    if (!isLoopbackRequest(request)) {
      throw new ApiError(403, "local_only", "Collector control is restricted to loopback clients");
    }
    const sourceId = optional(requestUrl.searchParams.get("source"));
    if (sourceId) {
      if (!context.registry.get(sourceId)) {
        throw new ApiError(404, "source_not_found", `Unknown source: ${sourceId}`);
      }
      if (context.scheduler.enabled) {
        return sendV1Json(response, { data: context.scheduler.requestRun([sourceId]) }, context, 202);
      }
      const result = await context.collector.runSource(sourceId);
      return sendV1Json(
        response,
        { data: result },
        context,
        result.status === "failed" || result.status === "rate_limited" ? 502 : 200
      );
    }

    if (context.scheduler.enabled) {
      return sendV1Json(response, { data: context.scheduler.requestRun() }, context, 202);
    }
    const result = await context.collector.runCycle();
    return sendV1Json(response, { data: result }, context, result.failed > 0 ? 207 : 200);
  }

  if (!["GET", "POST"].includes(request.method || "")) {
    throw new ApiError(405, "method_not_allowed", "Method not allowed");
  }
  throw new ApiError(404, "route_not_found", "API route not found");
}

export function handleApiError(response, error) {
  if (error instanceof ApiError || error instanceof CapabilityError) {
    sendJson(response, { contract_version: CONSUMER_CONTRACT_VERSION, error: { code: error.code, message: error.message } }, error.status);
    return;
  }
  console.error(error);
  sendJson(
    response,
    { contract_version: CONSUMER_CONTRACT_VERSION, error: { code: "internal_error", message: "Internal server error" } },
    500
  );
}

export function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload, null, 2));
  return true;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function listFilters(searchParams, options = {}) {
  const domain = parseDomain(searchParams.get("domain"));
  return {
    domain,
    source: options.document ? optional(searchParams.get("source")) : undefined,
    document_type: options.document ? optional(searchParams.get("document_type")) : undefined,
    q: optional(searchParams.get("q")),
    from: parseDate(searchParams.get("from"), "from"),
    to: parseDate(searchParams.get("to"), "to", true),
    cursor: optional(searchParams.get("cursor")),
    limit: parseLimit(searchParams.get("limit"))
  };
}

function eventFilters(searchParams) {
  const filters = listFilters(searchParams);
  filters.event_type = optional(searchParams.get("event_type"));
  filters.country = normalizeCountry(searchParams.get("country"));
  filters.entity = optional(searchParams.get("entity"));
  filters.severity = enumValue(searchParams.get("severity"), SEVERITIES, "severity");
  filters.lifecycle = enumValue(searchParams.get("lifecycle"), LIFECYCLES, "lifecycle");
  filters.verification = enumValue(searchParams.get("verification"), VERIFICATION_STATES, "verification");
  return filters;
}

function pathId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  return decodePathId(encoded);
}

function decodePathId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, "invalid_path", "Invalid path encoding");
  }
}

function sendResource(response, value, resourceName, context) {
  if (!value) {
    throw new ApiError(404, `${resourceName}_not_found`, `${resourceName} not found`);
  }
  return sendV1Json(response, { data: value }, context);
}

function sendPage(response, result, context, scope = {}) {
  return sendV1Json(response, {
    data: result.items,
    pagination: { next_cursor: result.next_cursor, count: result.items.length }
  }, context, 200, scope);
}

function parseLimit(value, fallback = 50) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new ApiError(400, "invalid_limit", "limit must be an integer between 1 and 200");
  }
  return Math.max(1, Math.min(200, Number(value)));
}

function parseDate(value, field, endOfDay = false) {
  const text = optional(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const dateOnly = new Date(`${text}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`);
    if (Number.isFinite(dateOnly.getTime()) && dateOnly.toISOString().startsWith(text)) return dateOnly.toISOString();
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiError(400, `invalid_${field}`, `${field} must be an ISO-8601 timestamp or YYYY-MM-DD`);
  }
  return parsed.toISOString();
}

function enumValue(value, allowed, field) {
  const text = optional(value);
  if (!text) return undefined;
  if (!allowed.has(text)) {
    throw new ApiError(400, `invalid_${field}`, `${field} must be one of: ${[...allowed].join(", ")}`);
  }
  return text;
}

function normalizeCountry(value) {
  const text = optional(value);
  if (!text) return undefined;
  if (!/^[a-z]{2}$/i.test(text)) {
    throw new ApiError(400, "invalid_country", "country must be an ISO 3166-1 alpha-2 code");
  }
  return text.toUpperCase();
}

function optional(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function publicStats(stats) {
  const { db_file: _dbFile, ...safeStats } = stats;
  return safeStats;
}

function sendV1Json(response, payload, context, statusCode = 200, scope = {}) {
  const state = queryState(context, scope);
  return sendJson(
    response,
    {
      contract_version: CONSUMER_CONTRACT_VERSION,
      generated_at: new Date().toISOString(),
      ...payload,
      freshness: state.freshness,
      coverage: state.coverage,
      warnings: state.warnings
    },
    statusCode
  );
}

function parseDomain(value) {
  const domain = optional(value);
  if (domain && !DOMAIN_IDS.has(domain)) {
    throw new ApiError(400, "invalid_domain", `domain must be one of: ${[...DOMAIN_IDS].join(", ")}`);
  }
  return domain;
}

function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
