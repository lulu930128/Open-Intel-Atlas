export const DOMAIN_PAGE_LIMIT = 18;
export const DOMAIN_PAGE_MAX_EVENTS = 100;

export function selectDomain(search, registry) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const requested = cleanText(params.get("domain"));
  const domains = Array.isArray(registry) ? registry : [];
  return domains.find((domain) => domain?.id === requested && domain.active !== false) || null;
}

export function buildDomainEventsPath(domainId, options = {}) {
  const domain = cleanText(domainId);
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(domain)) throw new Error("A canonical domain id is required");
  const limit = clampInteger(options.limit, 1, 200, DOMAIN_PAGE_LIMIT);
  const params = new URLSearchParams({ domain, limit: String(limit) });
  if (options.cursor) params.set("cursor", String(options.cursor));
  return `/api/v1/events?${params.toString()}`;
}

export function appendUniqueEvents(current, incoming, maxEvents = DOMAIN_PAGE_MAX_EVENTS) {
  const result = [];
  const ids = new Set();
  for (const event of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!event?.id || ids.has(event.id)) continue;
    ids.add(event.id);
    result.push(event);
    if (result.length >= maxEvents) break;
  }
  return result;
}

export function domainAvailability(freshnessEnvelope) {
  const payload = freshnessEnvelope?.data || freshnessEnvelope || {};
  const freshness = payload.freshness || freshnessEnvelope?.freshness || {};
  const coverage = payload.coverage || freshnessEnvelope?.coverage || {};
  const state = coverage.status === "partial" ? "partial" : freshness.status || coverage.status || "unknown";
  return {
    state,
    freshness,
    coverage,
    warnings: payload.warnings || freshnessEnvelope?.warnings || []
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
