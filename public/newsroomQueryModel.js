import { normalizePresentation, presentationFromSearch, PRESENTATION_DEFINITIONS } from "./newsroomPresentationModel.js";
export { normalizePresentation, presentationFromSearch, PRESENTATION_DEFINITIONS };

export function withPresentation(path, presentation) {
  const url = new URL(path, "http://atlas.local");
  const value = normalizePresentation(presentation);
  if (value === "global") url.searchParams.delete("presentation");
  else url.searchParams.set("presentation", value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildEventsPath({ domain, presentation, cursor, limit = 20 } = {}) {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 20))) });
  if (domain) params.set("domain", domain);
  if (cursor) params.set("cursor", cursor);
  return withPresentation(`/api/v1/events?${params}`, presentation);
}

export function buildStoriesPath(presentation, limit = 8) {
  const bounded = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 8));
  return withPresentation(`/api/v1/stories?limit=${bounded}`, presentation);
}

export function buildDomainUrl(domain, presentation) {
  return withPresentation(`/domain.html?domain=${encodeURIComponent(domain)}`, presentation);
}

export function preserveNavigation(presentation, root = document) {
  for (const link of root.querySelectorAll('a[href]')) {
    if (link.closest(".region-links")) continue;
    const href = link.getAttribute("href");
    if (href === "/" || href.startsWith("/?") || href.startsWith("/domain.html?")) {
      link.setAttribute("href", withPresentation(href, presentation));
    }
  }
}

export function companyStockUrl(company) {
  const security = (company?.securities || []).find((item) => item.exchange && item.ticker);
  return security ? `/stocks.html?exchange=${encodeURIComponent(security.exchange)}&symbol=${encodeURIComponent(security.ticker)}` : null;
}

export function regionLinks(path, presentation) {
  return Object.entries(PRESENTATION_DEFINITIONS).map(([value, definition]) =>
    `<a href="${withPresentation(path, value).replaceAll("&", "&amp;")}"${value === presentation ? ' aria-current="page"' : ""}>${definition.label}</a>`).join("");
}

export function assertRegionalResponse(path, envelope) {
  const url = new URL(path, "http://atlas.local");
  if (!["/api/v1/events", "/api/v1/stories"].includes(url.pathname)) return;
  const presentation = presentationFromSearch(url.search);
  if (presentation !== "global" && envelope?.query?.presentation !== presentation) {
    throw new Error("服務尚未提供此地區查詢契約，請先更新服務；未以全域內容代替。");
  }
}
