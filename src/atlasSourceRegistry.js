import { financeSources } from "./atlasAdaptersFinance.js";
import { macroSources } from "./macro/sources/usBls.js";
import { beaSources } from "./macro/sources/usBea.js";
import { expandedMacroSources } from "./macro/sources/expandedSources.js";
import { hazardSources } from "./atlasAdaptersHazards.js";
import { politicsSources } from "./atlasAdaptersPolitics.js";
import { technologySources } from "./atlasAdaptersTechnology.js";
import { isDomain } from "./atlasDomains.js";
import { normalizeSourceMediaPolicy } from "./documents/media.js";
import { taiwanCompanySources } from "./sources/finance/taiwanCompanies.js";
import { taiwanCompanyNewsSources } from "./sources/finance/taiwanCompanyNews.js";

const DEFINITIONS = [...politicsSources, ...technologySources, ...financeSources, ...taiwanCompanySources, ...taiwanCompanyNewsSources, ...hazardSources, ...macroSources, ...beaSources, ...expandedMacroSources];
const CATCHUP_MODES = new Set(["latest_only", "window", "provider_history"]);

export function buildSourceRegistry(config) {
  const ids = new Set();
  const sources = DEFINITIONS.map((definition) => {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate source id: ${definition.id}`);
    }
    if (!Array.isArray(definition.domains) || definition.domains.length === 0 || definition.domains.some((domain) => !isDomain(domain))) {
      throw new Error(`Invalid domains for source: ${definition.id}`);
    }
    const catchupMode = definition.catchupMode || "latest_only";
    if (!CATCHUP_MODES.has(catchupMode)) {
      throw new Error(`Invalid catch-up mode for source: ${definition.id}`);
    }
    ids.add(definition.id);

    const flagName = `SOURCE_${definition.id.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_ENABLED`;
    const override = config.sourceFlags[flagName];
    const requestedEnabled = override === undefined ? definition.defaultEnabled !== false : override;
    const missingConfig = (definition.requiredConfig || []).filter((key) => !config.providers[key]);
    const allowedUsageContexts = Array.isArray(definition.allowedContentUsageContexts) ? definition.allowedContentUsageContexts : [];
    const usageContextBlocked = allowedUsageContexts.length > 0 && !allowedUsageContexts.includes(config.contentUsageContext);
    const enabled = requestedEnabled && missingConfig.length === 0 && !usageContextBlocked;
    const disabledReason = enabled
      ? null
      : missingConfig.length > 0
        ? `Missing configuration: ${missingConfig.join(", ")}`
        : usageContextBlocked
          ? `Content usage context ${config.contentUsageContext || "unreviewed"} is not allowed; expected one of: ${allowedUsageContexts.join(", ")}`
        : `Disabled by ${flagName}`;

    return {
      ...definition,
      coverage: normalizeCoverage(definition),
      mediaPolicy: normalizeSourceMediaPolicy(
        typeof definition.mediaPolicy === "function"
          ? definition.mediaPolicy(config)
          : definition.mediaPolicy
      ),
      catchupMode,
      enabled,
      disabledReason,
      flagName,
      cadence: formatCadence(definition.cadenceMs)
    };
  });

  return {
    all: sources,
    enabled: sources.filter((source) => source.enabled),
    get(sourceId) {
      return sources.find((source) => source.id === sourceId) || null;
    }
  };
}

export function publicSourceDefinition(source) {
  return {
    id: source.id,
    name: source.name,
    provider_type: source.providerType,
    source_class: source.sourceClass,
    authority_class: source.authorityClass,
    document_type: source.documentType,
    domains: source.domains,
    languages: source.languages,
    countries: source.countries,
    homepage: source.homepage,
    docs_url: source.docsUrl,
    attribution: source.attribution,
    policy_note: source.policyNote,
    cadence: source.cadence,
    cadence_ms: source.cadenceMs,
    catchup_mode: source.catchupMode || "latest_only",
    timeout_ms: source.timeoutMs,
    enabled: source.enabled,
    disabled_reason: source.disabledReason,
    media_policy: source.mediaPolicy,
    coverage: source.coverage || normalizeCoverage(source)
  };
}

function normalizeCoverage(source) {
  const coverage = source.coverage || {};
  return {
    capabilities: Array.isArray(coverage.capabilities) && coverage.capabilities.length > 0
      ? [...new Set(coverage.capabilities.map(String))]
      : [`documents.${source.documentType || source.document_type || "unknown"}`],
    markets: Array.isArray(coverage.markets) ? [...new Set(coverage.markets.map(String))] : [],
    guarantee: ["complete_snapshot", "bounded_window", "best_effort"].includes(coverage.guarantee)
      ? coverage.guarantee
      : "best_effort",
    recoverability: coverage.recoverability || source.catchupMode || source.catchup_mode || "latest_only",
    notes: coverage.notes || null
  };
}

function formatCadence(milliseconds) {
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
