import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDispatch } from "./analysis.js";
import { buildDashboardSnapshot } from "./dashboard.js";
import { collectIntel } from "./sources.js";
import {
  getDashboardStats,
  getStoreStats,
  listStoredEvents,
  saveDashboardSnapshot,
  saveEventsByCategory,
  saveSourceStatuses
} from "./store.js";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, "public");
const PORT = Number(process.env.PORT || 8790);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 300);

let cache = null;

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      return sendJson(response, {
        ok: true,
        name: "Open Intel Atlas",
        version: "0.8.0",
        now: new Date().toISOString()
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const events = resolveEventsForQuery(payload, query);

      return sendJson(response, {
        generated_at: payload.generated_at,
        degraded: payload.degraded,
        filters: query,
        sources: payload.sources,
        database: getStoreStats(),
        events
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const dashboard = buildDashboardForQuery(payload, query);
      const snapshotStore = saveDashboardSnapshot(dashboard);

      return sendJson(response, {
        generated_at: dashboard.generated_at,
        degraded: payload.degraded,
        filters: query,
        sources: payload.sources,
        database: {
          events: getStoreStats(),
          dashboard: getDashboardStats()
        },
        snapshot_store: snapshotStore,
        dashboard
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/dispatch") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const events = resolveEventsForQuery(payload, query);

      return sendJson(response, {
        degraded: payload.degraded,
        filters: query,
        sources: payload.sources,
        database: getStoreStats(),
        dispatch: buildDispatch(events, { limit: query.limit })
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/stories") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const dashboard = buildDashboardForQuery(payload, query);

      return sendJson(response, {
        generated_at: dashboard.generated_at,
        degraded: payload.degraded,
        filters: query,
        summary: dashboard.summary,
        stories: dashboard.stories,
        evidence_feed: dashboard.evidence_feed
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/topics") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const dashboard = buildDashboardForQuery(payload, query);

      return sendJson(response, {
        generated_at: dashboard.generated_at,
        degraded: payload.degraded,
        filters: query,
        topics: dashboard.topics,
        sector_heat: dashboard.sector_heat
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/evidence") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const dashboard = buildDashboardForQuery(payload, query);

      return sendJson(response, {
        generated_at: dashboard.generated_at,
        degraded: payload.degraded,
        filters: query,
        evidence_feed: dashboard.evidence_feed
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/map-points") {
      const query = parseEventQuery(requestUrl.searchParams);
      const payload = await getIntelPayload();
      const dashboard = buildDashboardForQuery(payload, query);

      return sendJson(response, {
        generated_at: dashboard.generated_at,
        degraded: payload.degraded,
        filters: query,
        mini_map_points: dashboard.mini_map_points
      });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/sources") {
      const payload = await getIntelPayload();
      return sendJson(response, {
        generated_at: payload.generated_at,
        degraded: payload.degraded,
        database: getStoreStats(),
        sources: payload.sources
      });
    }

    if (request.method === "GET") {
      return serveStatic(requestUrl.pathname, response);
    }

    sendJson(response, { error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Internal server error", detail: error.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Open Intel Atlas listening on http://localhost:${PORT}`);
});

async function getIntelPayload() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.payload;
  }

  const collected = await collectIntel();
  const saved = saveEventsByCategory(collected.events);
  const sources = saveSourceStatuses(collected.sources);
  const payload = {
    ...collected,
    sources,
    saved,
    generated_at: new Date().toISOString()
  };

  cache = {
    payload,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000
  };

  return payload;
}

function resolveEventsForQuery(payload, query) {
  const useStoredEvents = query.range !== "live" || Boolean(query.date);
  const events = useStoredEvents
    ? listStoredEvents(query)
    : payload.events.filter((event) => !query.category || event.category === query.category);

  return events.slice(0, query.limit);
}

function buildDashboardForQuery(payload, query) {
  const events = resolveEventsForQuery(payload, query);

  return buildDashboardSnapshot(events, payload.sources, {
    degraded: payload.degraded,
    filters: query
  });
}

function parseEventQuery(searchParams) {
  const category = normalizeCategory(searchParams.get("category"));
  const range = normalizeRange(searchParams.get("range"));
  const date = normalizeDate(searchParams.get("date"));
  const limit = normalizeLimit(searchParams.get("limit"));

  return {
    category,
    range: date ? "date" : range,
    date,
    limit
  };
}

function normalizeCategory(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["geopolitics", "infrastructure", "finance", "ai"].includes(text) ? text : null;
}

function normalizeRange(value) {
  const text = String(value || "live").trim().toLowerCase();
  return ["live", "24h", "7d", "30d", "all"].includes(text) ? text : "live";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeLimit(value) {
  const limit = Number(value || 200);

  if (!Number.isFinite(limit)) {
    return 200;
  }

  return Math.max(1, Math.min(500, Math.floor(limit)));
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, { error: "Invalid path" }, 400);
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch {
    sendJson(response, { error: "Not found" }, 404);
  }
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function contentType(filePath) {
  const extension = extname(filePath);

  switch (extension) {
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
    default:
      return "application/octet-stream";
  }
}
