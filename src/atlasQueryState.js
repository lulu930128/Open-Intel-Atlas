import { DOMAIN_IDS } from "./atlasDomains.js";

export function queryState(context, scope = {}) {
  const allSources = context.store.listSources();
  const sources = scope.domain ? allSources.filter((source) => source.domains.includes(scope.domain)) : allSources;
  const enabled = sources.filter((source) => source.enabled);
  const counts = {
    healthy: enabled.filter((source) => source.health.status === "healthy").length,
    degraded: enabled.filter((source) => source.health.status === "degraded").length,
    failed: enabled.filter((source) => source.health.status === "failed").length,
    unknown: enabled.filter((source) => source.health.status === "unknown").length,
    disabled: sources.filter((source) => !source.enabled).length,
    current: enabled.filter((source) => source.health.freshness_status === "current").length,
    stale: enabled.filter((source) => source.health.freshness_status === "stale").length,
    missing: enabled.filter((source) => source.health.freshness_status === "missing").length
  };
  const successful = enabled.filter((source) => Boolean(source.health.last_success_at)).length;
  const coverageStatus =
    enabled.length === 0 || successful === 0
      ? "missing"
      : counts.failed + counts.stale + counts.unknown + counts.missing > 0
        ? "partial"
        : "full";
  const sourceSuccessTimes = enabled.map((source) => Date.parse(source.health.last_success_at || "")).filter(Number.isFinite);
  const warnings = [];
  for (const source of enabled) {
    if (["failed", "unknown"].includes(source.health.status)) {
      warnings.push({
        code: `SOURCE_${source.health.status.toUpperCase()}`,
        source_id: source.id,
        message: source.health.last_error || "No successful collection is available."
      });
    }
    if (source.health.freshness_status === "stale") {
      warnings.push({
        code: "SOURCE_STALE",
        source_id: source.id,
        message: `Last success is older than twice the ${source.cadence_ms} ms cadence.`
      });
    }
    if (["recoverable_partial", "unrecoverable"].includes(source.health.last_gap_status)) {
      warnings.push({
        code: source.health.last_gap_status === "unrecoverable" ? "SOURCE_GAP_UNRECOVERABLE" : "SOURCE_CATCHUP_TRUNCATED",
        source_id: source.id,
        message:
          source.health.last_gap_status === "unrecoverable"
            ? "The provider only exposes latest data; part of the offline gap may be unavailable."
            : "Catch-up was bounded by the configured maximum window."
      });
    }
  }
  const domainCoverage = scope.domain
    ? undefined
    : Object.fromEntries(
        [...DOMAIN_IDS].map((domain) => {
          const state = queryState(context, { domain });
          return [domain, { freshness: state.freshness, coverage: state.coverage }];
        })
      );
  return {
    freshness: {
      status: successful === 0 ? "missing" : counts.stale + counts.missing > 0 ? "stale" : "current",
      as_of: sourceSuccessTimes.length ? new Date(Math.max(...sourceSuccessTimes)).toISOString() : null,
      data_as_of: context.store.getDataAsOf(scope.domain || null)
    },
    coverage: {
      status: coverageStatus,
      expected_sources: enabled.length,
      successful_sources: successful,
      current_sources: counts.current,
      degraded_sources: counts.degraded,
      stale_sources: counts.stale,
      failed_sources: counts.failed,
      unknown_sources: counts.unknown,
      disabled_sources: counts.disabled
    },
    warnings,
    ...(domainCoverage ? { domains: domainCoverage } : {})
  };
}
