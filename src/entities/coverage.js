const SLICE_DEFINITIONS = Object.freeze({
  company_master: { capability: "company.master", required: true },
  official_disclosure: { capability: "company.disclosures", required: true },
  general_news: { capability: "company.news", required: false }
});

export function buildCompanyCoverage(context, entityId) {
  const now = context.clock?.().getTime?.() ?? Date.now();
  const documentWindowDays = 30;
  const evidence = context.store.getEntityCoverageEvidence(entityId, {
    documentSince: new Date(now - documentWindowDays * 24 * 60 * 60 * 1000).toISOString()
  });
  const sources = context.store.listSources();
  const slices = {};
  const warnings = [];

  for (const [name, definition] of Object.entries(SLICE_DEFINITIONS)) {
    const relevant = sources.filter((source) => isRelevantSource(source, definition.capability, evidence.markets));
    const slice = name === "general_news"
      ? evaluateTargetSlice(name, definition, relevant, evidence, now, documentWindowDays)
      : evaluateSlice(name, definition, relevant, evidence, now, documentWindowDays);
    slices[name] = slice;
    warnings.push(...slice.warnings);
  }

  const statuses = Object.values(slices).map((slice) => slice.status);
  const status = statuses.every((value) => value === "current")
    ? "full"
    : statuses.every((value) => ["missing", "disabled", "unknown", "failed"].includes(value))
      ? "missing"
      : "partial";
  const matchTimes = Object.values(slices).map((slice) => Date.parse(slice.last_match_at || "")).filter(Number.isFinite);

  return {
    freshness: {
      status: statuses.some((value) => value === "current")
        ? "current"
        : statuses.some((value) => value === "stale")
          ? "stale"
          : statuses.some((value) => value === "missing")
            ? "missing"
            : "unknown",
      as_of: matchTimes.length ? new Date(Math.max(...matchTimes)).toISOString() : null,
      data_as_of: matchTimes.length ? new Date(Math.max(...matchTimes)).toISOString() : null
    },
    coverage: {
      status,
      entity_id: entityId,
      company_master: slices.company_master,
      official_disclosure: slices.official_disclosure,
      general_news: slices.general_news
    },
    warnings
  };
}

export function buildStockNewsCoverage(context, stock) {
  const now = context.clock?.().getTime?.() ?? Date.now();
  const evidence = context.store.getEntityCoverageEvidence(stock.company_id, {
    documentSince: new Date(now - 30 * 86400_000).toISOString()
  });
  evidence.target_states = Object.fromEntries(Object.entries(evidence.target_states).map(([id, targets]) => [
    id, targets.filter((target) => normalizeMarket(target.identifier.scope) === stock.exchange
      && target.identifier.value === stock.symbol)
  ]));
  const sources = context.store.listSources().filter((source) => isRelevantSource(source, "company.news", [stock.exchange]));
  const slice = evaluateTargetSlice("general_news", SLICE_DEFINITIONS.general_news, sources, evidence, now, 30);
  return {
    freshness: { status: slice.status, as_of: slice.latest_success_at, data_as_of: slice.last_match_at },
    coverage: { ...slice, scope: "stock", document_count_scope: "company", exchange: stock.exchange, symbol: stock.symbol,
      company_id: stock.company_id, security_id: stock.security_id, absence_interpretation: "unknown_not_observed" },
    warnings: slice.warnings
  };
}

function isRelevantSource(source, capability, markets) {
  const capabilities = source.coverage?.capabilities || [];
  if (!capabilities.includes(capability)) return false;
  const sourceMarkets = (source.coverage?.markets || []).map(normalizeMarket);
  return sourceMarkets.length === 0 || markets.length === 0 || sourceMarkets.some((market) => markets.includes(market));
}

function evaluateSlice(name, definition, sources, evidence, now, documentWindowDays) {
  const enabled = sources.filter((source) => source.enabled);
  const latestSuccessTimes = enabled.map((source) => Date.parse(source.health?.last_success_at || "")).filter(Number.isFinite);
  const matches = name === "company_master" ? evidence.master_matches : evidence.document_matches;
  const matchingSources = enabled.filter((source) => matches[source.id]);
  const matchTimes = matchingSources.map((source) => Date.parse(matches[source.id] || "")).filter(Number.isFinite);
  const warnings = [];
  let status;

  if (sources.length === 0) {
    status = definition.required ? "missing" : "unknown";
    warnings.push(companyWarning(name, "NO_RELEVANT_SOURCE", `No source declares ${definition.capability} for this company market.`));
  } else if (enabled.length === 0) {
    status = "disabled";
    warnings.push(companyWarning(name, "RELEVANT_SOURCES_DISABLED", "All relevant sources are disabled."));
  } else if (matchingSources.length === 0) {
    const failed = enabled.filter((source) => source.health?.status === "failed");
    const degraded = enabled.filter((source) => source.health?.status === "degraded");
    const unknown = enabled.filter((source) => source.health?.status === "unknown");
    status = failed.length === enabled.length ? "failed" : degraded.length > 0 ? "partial" : unknown.length === enabled.length ? "unknown" : "missing";
    warnings.push(companyWarning(name, "NO_ENTITY_MATCH", "Relevant sources have no persisted match for this company."));
  } else {
    const failed = enabled.some((source) => source.health?.status === "failed");
    const partial = enabled.some((source) => source.health?.status === "degraded") || (failed && !enabled.every((source) => source.health?.status === "failed"));
    const stale = matchingSources.every((source) => isStale(source, now));
    status = enabled.every((source) => source.health?.status === "failed") ? "failed" : partial ? "partial" : stale ? "stale" : "current";
    if (failed) warnings.push(companyWarning(name, "MATCH_SOURCE_FAILED", "A source with prior company evidence is currently failed."));
    if (partial) warnings.push(companyWarning(name, "MATCH_SOURCE_PARTIAL", "A source with company evidence reported a partial result."));
    if (stale) warnings.push(companyWarning(name, "MATCH_STALE", "The most recent company match is beyond the source freshness window."));
  }

  return {
    status,
    latest_success_at: latestSuccessTimes.length ? new Date(Math.max(...latestSuccessTimes)).toISOString() : null,
    last_match_at: matchTimes.length ? new Date(Math.max(...matchTimes)).toISOString() : null,
    guarantee: uniquePolicy(sources, "guarantee"),
    recoverability: uniquePolicy(sources, "recoverability"),
    source_count: sources.length,
    document_count: sources.reduce((total, source) => total + Number(evidence.document_counts?.[source.id] || 0), 0),
    document_count_window_days: documentWindowDays,
    relevant_source_ids: sources.map((source) => source.id).sort(),
    warnings
  };
}

function evaluateTargetSlice(name, definition, sources, evidence, now, documentWindowDays) {
  const enabled = sources.filter((source) => source.enabled);
  const targets = enabled.flatMap((source) => evidence.target_states?.[source.id] || []);
  const enabledTargets = targets.filter((target) => target.enabled);
  const warnings = [];
  let status;

  if (sources.length === 0) {
    status = definition.required ? "missing" : "unknown";
    warnings.push(companyWarning(name, "NO_RELEVANT_SOURCE", `No source declares ${definition.capability} for this company market.`));
  } else if (enabled.length === 0) {
    status = "disabled";
    warnings.push(companyWarning(name, "RELEVANT_SOURCES_DISABLED", "All relevant sources are disabled."));
  } else if (enabledTargets.length === 0) {
    status = "missing";
    warnings.push(companyWarning(name, "NO_REGISTERED_TARGET", "No enabled source target is registered for this company."));
  } else {
    const currentTargets = enabledTargets.filter((target) => targetIsCurrent(target, now));
    const failedTargets = enabledTargets.filter((target) => ["failed", "rate_limited"].includes(target.last_outcome));
    if (currentTargets.length === enabledTargets.length && failedTargets.length === 0) status = "current";
    else if (currentTargets.length > 0) status = "partial";
    else if (failedTargets.length === enabledTargets.length && enabledTargets.every((target) => !target.last_success_at)) status = "failed";
    else if (enabledTargets.some((target) => target.last_success_at)) status = "stale";
    else status = "missing";

    if (failedTargets.length > 0) warnings.push(companyWarning(name, "TARGET_FAILED", "At least one company-specific source target failed after isolation."));
    if (status === "stale") warnings.push(companyWarning(name, "TARGET_STALE", "The company-specific target has not succeeded within its freshness window."));
    if (!enabledTargets.some((target) => target.last_match_at)) {
      warnings.push(companyWarning(name, "NO_ENTITY_MATCH", "Target coverage is available but no matching document has been observed."));
    }
  }

  const successTimes = enabledTargets.map((target) => Date.parse(target.last_success_at || "")).filter(Number.isFinite);
  const matchTimes = enabledTargets.map((target) => Date.parse(target.last_match_at || "")).filter(Number.isFinite);
  return {
    status,
    latest_success_at: successTimes.length ? new Date(Math.max(...successTimes)).toISOString() : null,
    last_match_at: matchTimes.length ? new Date(Math.max(...matchTimes)).toISOString() : null,
    guarantee: uniquePolicy(sources, "guarantee"),
    recoverability: uniquePolicy(sources, "recoverability"),
    source_count: sources.length,
    target_count: enabledTargets.length,
    document_count: sources.reduce((total, source) => total + Number(evidence.document_counts?.[source.id] || 0), 0),
    document_count_window_days: documentWindowDays,
    relevant_source_ids: sources.map((source) => source.id).sort(),
    warnings
  };
}

function targetIsCurrent(target, now) {
  const lastSuccess = Date.parse(target.last_success_at || "");
  if (!Number.isFinite(lastSuccess)) return false;
  return Math.max(0, now - lastSuccess) <= Math.max(60_000, Number(target.cadence_ms || 0)) * 2;
}

function isStale(source, now) {
  const lastSuccess = Date.parse(source.health?.last_success_at || "");
  if (!Number.isFinite(lastSuccess)) return true;
  return Math.max(0, now - lastSuccess) > Math.max(60_000, Number(source.cadence_ms || 0)) * 2;
}

function uniquePolicy(sources, field) {
  const values = [...new Set(sources.map((source) => source.coverage?.[field]).filter(Boolean))];
  return values.length === 0 ? null : values.length === 1 ? values[0] : values;
}

function companyWarning(slice, code, message) {
  return { code: `COMPANY_${code}`, slice, message };
}

function normalizeMarket(value) {
  return String(value || "").trim().toUpperCase();
}
