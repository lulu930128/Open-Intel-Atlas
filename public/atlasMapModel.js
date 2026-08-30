export const MAP_PAGE_LIMIT = 200;
export const MAP_EVENT_LIMIT = 1000;
export const MAP_DOMAINS = new Set(["politics", "technology", "finance", "hazards"]);

const RANGE_MS = {
  live: 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

export async function fetchCanonicalEvents(fetchImpl, options = {}) {
  const limit = clampInteger(options.limit, 1, MAP_PAGE_LIMIT, MAP_PAGE_LIMIT);
  const maxEvents = clampInteger(options.maxEvents, 1, MAP_EVENT_LIMIT, MAP_EVENT_LIMIT);
  const events = [];
  const seenEventIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let pageCount = 0;
  let lastEnvelope = null;

  do {
    const remaining = maxEvents - events.length;
    if (remaining <= 0) break;
    const pageLimit = Math.min(limit, remaining);
    const url = `/api/v1/events?${buildEventQuery({ ...options, cursor, limit: pageLimit })}`;
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Events API returned ${response.status}`);
    const envelope = await response.json();
    if (!Array.isArray(envelope?.data) || !envelope?.pagination) {
      throw new Error("Events API returned an invalid v1 page");
    }

    lastEnvelope = envelope;
    pageCount += 1;
    for (const event of envelope.data) {
      if (!event?.id || seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      events.push(event);
      if (events.length >= maxEvents) break;
    }

    const nextCursor = cleanText(envelope.pagination.next_cursor);
    if (!nextCursor) {
      cursor = null;
      break;
    }
    if (seenCursors.has(nextCursor)) throw new Error("Events API returned a repeated cursor");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (events.length < maxEvents);

  return {
    events,
    pageCount,
    truncated: Boolean(cursor),
    coverage: lastEnvelope?.coverage || null,
    freshness: lastEnvelope?.freshness || null,
    generatedAt: lastEnvelope?.generated_at || null
  };
}

export function buildEventQuery(options = {}) {
  const params = new URLSearchParams();
  const domain = MAP_DOMAINS.has(options.domain) ? options.domain : null;
  if (domain) params.set("domain", domain);

  const range = RANGE_MS[options.range] ? options.range : options.range === "all" ? "all" : "live";
  if (range !== "all") {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (!Number.isFinite(now.getTime())) throw new Error("Map query requires a valid current time");
    params.set("from", new Date(now.getTime() - RANGE_MS[range]).toISOString());
  }

  if (options.cursor) params.set("cursor", options.cursor);
  params.set("limit", String(clampInteger(options.limit, 1, MAP_PAGE_LIMIT, MAP_PAGE_LIMIT)));
  return params.toString();
}

export function eventToMapRecord(event) {
  if (!event?.id) return null;
  const latitude = finiteCoordinate(event.location?.latitude, -90, 90);
  const longitude = finiteCoordinate(event.location?.longitude, -180, 180);
  const countryCode = normalizeAlpha2(event.location?.country_code);
  return {
    id: String(event.id),
    title: cleanText(event.title) || "Untitled event",
    summary: cleanText(event.summary),
    domain: MAP_DOMAINS.has(event.primary_domain) ? event.primary_domain : "",
    severity: ["low", "medium", "high", "critical"].includes(event.event_severity) ? event.event_severity : "low",
    source: cleanText(event.representative_source || event.representative_publisher) || "Observed source",
    observed_at: event.last_updated_at || event.occurred_at || null,
    location: {
      label: cleanText(event.location?.label),
      country_code: countryCode,
      lat: latitude,
      lon: longitude
    },
    has_coordinates: latitude !== null && longitude !== null
  };
}

export function eventToMapPoint(event) {
  const record = eventToMapRecord(event);
  return record?.has_coordinates ? record : null;
}

export function getFeatureAlpha2(feature) {
  const props = feature?.properties || {};
  return normalizeAlpha2(props["ISO3166-1-Alpha-2"] || props.ISO_A2 || props.iso_a2);
}

export function buildCountryEventMap(records) {
  const result = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const code = normalizeAlpha2(record?.location?.country_code);
    if (!code) continue;
    const entries = result.get(code) || [];
    entries.push(record);
    result.set(code, entries);
  }
  return result;
}

export function rangeLabel(range) {
  return { live: "LIVE 6H", "24h": "24H", "7d": "7D", "30d": "30D", all: "ALL" }[range] || "LIVE 6H";
}

function finiteCoordinate(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function normalizeAlpha2(value) {
  const text = cleanText(value).toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : "";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
