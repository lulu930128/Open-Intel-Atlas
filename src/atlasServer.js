import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDispatch } from "./analysis.js";
import { handleApiError, handleV1Api, sendJson } from "./atlasApi.js";
import { createCollector, startCollectorScheduler } from "./atlasCollector.js";
import { createAtlasCapabilities } from "./atlasCapabilities.js";
import { createHttpClient } from "./atlasHttp.js";
import { createAtlasMcpEndpoint } from "./atlasMcp.js";
import { buildSourceRegistry } from "./atlasSourceRegistry.js";
import { openAtlasStore } from "./atlasStore.js";
import { APP_NAME, APP_VERSION, loadConfig } from "./config.js";
import { buildDashboardSnapshot } from "./dashboard.js";

export function createAtlasRuntime(options = {}) {
  const config = options.config || loadConfig();
  const registry = options.registry || buildSourceRegistry(config);
  const store = options.store || openAtlasStore(config.dbPath);
  store.registerSources(registry.all);
  const http = options.http || createHttpClient(config.http);
  const collector = options.collector || createCollector({ store, registry, http, config });
  const scheduler = options.scheduler || startCollectorScheduler({ collector, registry, store, config });
  const context = { config, registry, store, http, collector, scheduler };
  context.capabilities = options.capabilities || createAtlasCapabilities(context);
  context.mcp = options.mcp || createAtlasMcpEndpoint(context);

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (requestUrl.pathname === "/mcp") {
        await context.mcp.handle(request, response);
        return;
      }
      if (await handleV1Api(request, response, requestUrl, context)) return;
      if (await handleLegacyApi(request, response, requestUrl, context)) return;
      if (request.method === "GET") return serveStatic(requestUrl.pathname, response, config.publicDir);
      return sendJson(response, { error: { code: "method_not_allowed", message: "Method not allowed" } }, 405);
    } catch (error) {
      handleApiError(response, error);
    }
  });

  let closed = false;
  return {
    ...context,
    server,
    async listen() {
      await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolveListen();
        });
      });
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      await scheduler.stop();
      if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
      await context.mcp.close();
      store.close();
    }
  };
}

async function handleLegacyApi(request, response, requestUrl, context) {
  if (!requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/api/v1/")) return false;
  if (request.method !== "GET") {
    sendJson(response, { error: "Method not allowed" }, 405);
    return true;
  }

  if (requestUrl.pathname === "/api/health") {
    const stats = context.store.getStats();
    const { db_file: _dbFile, ...storage } = stats;
    sendJson(response, { ok: true, name: APP_NAME, version: APP_VERSION, now: new Date().toISOString(), storage });
    return true;
  }

  const supported = new Set([
    "/api/events",
    "/api/dashboard",
    "/api/dispatch",
    "/api/stories",
    "/api/topics",
    "/api/evidence",
    "/api/map-points",
    "/api/sources"
  ]);
  if (!supported.has(requestUrl.pathname)) return false;

  const query = parseLegacyQuery(requestUrl.searchParams);
  const payload = legacyPayload(context.store, query);
  if (requestUrl.pathname === "/api/sources") {
    sendJson(response, legacyEnvelope(payload, { database: payload.database, sources: payload.sources }));
    return true;
  }
  if (requestUrl.pathname === "/api/events") {
    sendJson(response, legacyEnvelope(payload, { database: payload.database, events: payload.events }));
    return true;
  }

  const dashboard = buildDashboardSnapshot(payload.events, payload.sources, {
    degraded: payload.degraded,
    filters: query
  });
  if (requestUrl.pathname === "/api/dashboard") {
    sendJson(response, legacyEnvelope(payload, { database: payload.database, dashboard }));
  } else if (requestUrl.pathname === "/api/dispatch") {
    sendJson(response, legacyEnvelope(payload, { dispatch: buildDispatch(payload.events, { limit: query.limit }) }));
  } else if (requestUrl.pathname === "/api/stories") {
    sendJson(response, legacyEnvelope(payload, { summary: dashboard.summary, stories: dashboard.stories, evidence_feed: dashboard.evidence_feed }));
  } else if (requestUrl.pathname === "/api/topics") {
    sendJson(response, legacyEnvelope(payload, { topics: dashboard.topics, sector_heat: dashboard.sector_heat }));
  } else if (requestUrl.pathname === "/api/evidence") {
    sendJson(response, legacyEnvelope(payload, { evidence_feed: dashboard.evidence_feed }));
  } else {
    sendJson(response, legacyEnvelope(payload, { mini_map_points: dashboard.mini_map_points }));
  }
  return true;
}

function legacyPayload(store, query) {
  const result = store.listEvents({ from: query.from, to: query.to, limit: 200 });
  let events = result.items.map(toLegacyEvent);
  if (query.category) events = events.filter((event) => event.category === query.category);
  events = events.slice(0, query.limit);
  const sources = store.listSources().map(toLegacySource);
  const stats = store.getStats();
  const { db_file: _dbFile, ...database } = stats;
  return {
    generated_at: new Date().toISOString(),
    degraded: sources.some((source) => source.enabled && source.ok !== true),
    filters: query,
    database,
    sources,
    events
  };
}

function legacyEnvelope(payload, fields) {
  return {
    generated_at: payload.generated_at,
    degraded: payload.degraded,
    filters: payload.filters,
    sources: payload.sources,
    ...fields
  };
}

function toLegacyEvent(event) {
  const domain = event.primary_domain;
  const category =
    domain === "politics"
      ? "geopolitics"
      : domain === "finance"
        ? "finance"
        : domain === "technology" && !event.event_type.includes("cybersecurity")
          ? "ai"
          : "infrastructure";
  const location = event.location
    ? {
        label: event.location.label || event.location.country_code || "Observed location",
        ...(event.location.latitude !== null &&
        event.location.latitude !== undefined &&
        event.location.longitude !== null &&
        event.location.longitude !== undefined
          ? { lat: event.location.latitude, lon: event.location.longitude }
          : {})
      }
    : null;
  return {
    id: event.id,
    category,
    title: event.title,
    summary: event.summary,
    severity: event.event_severity,
    confidence: event.confidence,
    source: event.representative_source || event.representative_publisher || "Observed source",
    url: event.representative_url,
    observed_at: event.last_updated_at || event.occurred_at,
    occurred_at: event.occurred_at,
    location,
    tags: [event.event_type, ...(event.domains || []).map((entry) => entry.domain)],
    rationale: `${event.verification_status}; ${event.independent_source_count} independent source(s)`,
    verification_status: event.verification_status
  };
}

function toLegacySource(source) {
  const health = source.health;
  const ok = ["healthy", "degraded"].includes(health.status) && health.freshness_status === "current";
  return {
    id: source.id,
    name: source.name,
    category: legacyCategory(source.domains?.[0], source.document_type),
    enabled: source.enabled,
    ok,
    count: health.last_item_count,
    checked_at: health.last_checked_at,
    last_success_at: health.last_success_at,
    error: source.disabled_reason || health.last_error || (health.freshness_status === "stale" ? "Source data is stale." : null),
    health_status: health.freshness_status === "stale" ? "stale" : health.status,
    homepage: source.homepage,
    attribution: source.attribution
  };
}

function legacyCategory(domain, documentType) {
  if (domain === "politics") return "geopolitics";
  if (domain === "finance") return "finance";
  if (domain === "technology" && !String(documentType).includes("cyber")) return "ai";
  return "infrastructure";
}

function parseLegacyQuery(searchParams) {
  const categoryText = String(searchParams.get("category") || "").toLowerCase();
  const category = ["geopolitics", "infrastructure", "finance", "ai"].includes(categoryText) ? categoryText : null;
  const rangeText = String(searchParams.get("range") || "live").toLowerCase();
  const range = ["live", "24h", "7d", "30d", "all"].includes(rangeText) ? rangeText : "live";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.get("date") || "")) ? searchParams.get("date") : null;
  const parsedLimit = Number(searchParams.get("limit") || 200);
  const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 200));
  let from;
  let to;
  if (date) {
    from = `${date}T00:00:00.000Z`;
    to = `${date}T23:59:59.999Z`;
  } else if (["24h", "7d", "30d"].includes(range)) {
    const milliseconds = { "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 }[range];
    from = new Date(Date.now() - milliseconds).toISOString();
  }
  return { category, range: date ? "date" : range, date, limit, from, to };
}

async function serveStatic(pathname, response, publicDir) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, { error: "Invalid path" }, 400);
  }
  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
  const filePath = resolve(publicDir, requestedPath);
  const publicRoot = resolve(publicDir);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    return sendJson(response, { error: "Invalid path" }, 400);
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(content);
    return true;
  } catch {
    return sendJson(response, { error: "Not found" }, 404);
  }
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".geojson":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

async function main() {
  const runtime = createAtlasRuntime();
  const shutdown = async (signal) => {
    console.log(`[atlas] received ${signal}; shutting down`);
    await runtime.close();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  const address = await runtime.listen();
  const host = typeof address === "object" && address ? address.address : runtime.config.host;
  const port = typeof address === "object" && address ? address.port : runtime.config.port;
  console.log(`${APP_NAME} ${APP_VERSION} listening on http://${host}:${port}`);
  console.log(`[atlas] sources enabled=${runtime.registry.enabled.length}/${runtime.registry.all.length}; scheduler=${runtime.scheduler.enabled}`);
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
