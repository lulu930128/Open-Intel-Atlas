export function parseStockLocator(search) {
  const params = new URLSearchParams(search);
  const exchange = String(params.get("exchange") || "").trim().toUpperCase();
  const symbol = String(params.get("symbol") || "").trim().toUpperCase();
  return {
    exchange: /^[A-Z][A-Z0-9]{1,11}$/.test(exchange) ? exchange : null,
    symbol: /^[A-Z0-9._-]{1,32}$/.test(symbol) ? symbol : null
  };
}

export function companyPageState(envelope) {
  const data = envelope?.data;
  if (!data?.entity) return { status: "missing", reason: "company_not_found" };
  const master = data.master_snapshot;
  const coverage = envelope.coverage || {};
  const masterCoverage = coverage.company_master || {};
  const freshness = envelope.freshness || {};
  if (!master) return { status: "partial", reason: "master_snapshot_missing" };
  if (!master.snapshot_complete || master.truncated || master.status !== "complete") {
    return { status: "partial", reason: master.truncated ? "master_truncated" : "master_incomplete" };
  }
  if (["missing", "failed", "disabled", "unknown"].includes(masterCoverage.status)) {
    return { status: masterCoverage.status === "failed" ? "partial" : masterCoverage.status, reason: `master_coverage_${masterCoverage.status}` };
  }
  if (masterCoverage.status === "stale") return { status: "stale", reason: "master_coverage_stale" };
  if (masterCoverage.status === "partial") return { status: "partial", reason: "master_coverage_partial" };
  if (coverage.status === "partial") return { status: "partial", reason: "company_coverage_partial" };
  if (["stale", "missing", "unknown"].includes(freshness.status)) {
    return { status: freshness.status, reason: `freshness_${freshness.status}` };
  }
  return { status: "current", reason: "complete_master" };
}

export function primaryListing(snapshot, exchange, symbol) {
  return (snapshot?.relations || []).find((relation) =>
    relation.relation_type === "listed_as" &&
    String(relation.to?.id || "").toLowerCase() === `security:${String(exchange).toLowerCase()}:${String(symbol).toLowerCase()}`
  ) || (snapshot?.relations || []).find((relation) => relation.relation_type === "listed_as") || null;
}

export const COMPANY_TABS = ["news", "events", "evidence", "company"];

export function stockTab(search) {
  const value = new URLSearchParams(search).get("tab");
  return COMPANY_TABS.includes(value) ? value : "news";
}

export function buildStockNewsPath(locator, cursor) {
  const params = new URLSearchParams({ limit: "10" });
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/stocks/${encodeURIComponent(locator.exchange)}/${encodeURIComponent(locator.symbol)}/news?${params}`;
}
