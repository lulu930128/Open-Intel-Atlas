export const LANDING_VIEWS = ["overview", "news", "disclosures", "directory"];

export function landingState(search) {
  const params = new URLSearchParams(search);
  const market = params.get("market")?.toUpperCase() === "TPEX" ? "TPEX" : "TWSE";
  const query = (params.get("q") || "").trim().slice(0, 200);
  const requested = params.get("view");
  const view = LANDING_VIEWS.includes(requested) ? requested : query ? "directory" : "overview";
  return { market, query, view };
}

export function landingUrl({ market, query, view }) {
  const params = new URLSearchParams({ market });
  if (query) params.set("q", query);
  // Keep an explicit view so a retained search does not override back/forward.
  params.set("view", view);
  return `/stocks.html?${params}`;
}
