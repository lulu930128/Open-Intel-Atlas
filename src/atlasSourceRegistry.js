import { financeSources } from "./atlasAdaptersFinance.js";
import { hazardSources } from "./atlasAdaptersHazards.js";
import { politicsSources } from "./atlasAdaptersPolitics.js";
import { technologySources } from "./atlasAdaptersTechnology.js";
import { isDomain } from "./atlasDomains.js";

const DEFINITIONS = [...politicsSources, ...technologySources, ...financeSources, ...hazardSources];
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
    const enabled = requestedEnabled && missingConfig.length === 0;
    const disabledReason = enabled
      ? null
      : missingConfig.length > 0
        ? `Missing configuration: ${missingConfig.join(", ")}`
        : `Disabled by ${flagName}`;

    return {
      ...definition,
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
    disabled_reason: source.disabledReason
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
