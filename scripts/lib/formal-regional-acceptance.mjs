export const REGIONAL_PRESENTATIONS = ["global", "east_asia", "taiwan_focus", "japan_focus"];
export const ENABLED_REGIONAL_SOURCE_IDS = [
  "tw-mofa-press-releases",
  "tw-ncdr-active-cap-alerts",
  "jp-mod-news",
  "jp-jpcert-alerts",
  "jp-jma-eqvol",
  "jp-fdma-disaster-info",
  "jp-ndl-diet-minutes"
];
export const DISABLED_REGIONAL_SOURCE_IDS = ["jp-meti-latest"];

export function evaluateFormalRuntime({ health, sources, presentations }) {
  const errors = [];
  if (health?.ok !== true) errors.push("health did not report ok=true");
  if (health?.version !== "1.3.0") errors.push(`expected runtime version 1.3.0, received ${health?.version ?? "missing"}`);
  if (health?.contract_version !== "1.2") errors.push(`expected consumer contract 1.2, received ${health?.contract_version ?? "missing"}`);
  if (health?.storage?.schema_version !== 5) errors.push(`expected schema 5, received ${health?.storage?.schema_version ?? "missing"}`);
  if (health?.storage?.sources !== 33) errors.push(`expected 33 registered sources, received ${health?.storage?.sources ?? "missing"}`);
  if (health?.scheduler?.enabled !== true) errors.push("formal scheduler is not enabled");

  const byId = new Map((sources || []).map((source) => [source.id, source]));
  for (const sourceId of ENABLED_REGIONAL_SOURCE_IDS) {
    const source = byId.get(sourceId);
    if (!source) errors.push(`missing regional source ${sourceId}`);
    else if (source.enabled !== true) errors.push(`regional source ${sourceId} is not enabled`);
  }
  for (const sourceId of DISABLED_REGIONAL_SOURCE_IDS) {
    const source = byId.get(sourceId);
    if (!source) errors.push(`missing gated source ${sourceId}`);
    else if (source.enabled !== false) errors.push(`gated source ${sourceId} must remain disabled`);
  }

  for (const presentation of REGIONAL_PRESENTATIONS) {
    const result = presentations?.[presentation];
    if (!result) errors.push(`missing ${presentation} REST/MCP result`);
    else {
      if (result.rest_contract !== "1.2") errors.push(`${presentation} REST contract is not 1.2`);
      if (result.mcp_contract !== "1.2") errors.push(`${presentation} MCP contract is not 1.2`);
      if (result.rest_presentation !== presentation) errors.push(`${presentation} REST selection did not preserve presentation`);
      if (result.mcp_presentation !== presentation) errors.push(`${presentation} MCP selection did not preserve presentation`);
      if (result.parity !== true) errors.push(`${presentation} REST/MCP ordered IDs or coverage gaps differ`);
    }
  }

  return { passed: errors.length === 0, errors };
}

export function evaluateFormalProduct({ sources, presentations, observations = {} }) {
  const errors = [];
  const byId = new Map((sources || []).map((source) => [source.id, source]));
  for (const sourceId of ENABLED_REGIONAL_SOURCE_IDS) {
    const source = byId.get(sourceId);
    if (!source) {
      errors.push(`missing regional source ${sourceId}`);
      continue;
    }
    const status = source?.health?.status;
    const outcome = source?.health?.last_fetch_status;
    if (!['healthy', 'degraded'].includes(status)) errors.push(`${sourceId} health is ${status || "missing"}`);
    if (!['success', 'partial'].includes(outcome)) errors.push(`${sourceId} has no successful formal collection result`);
    const observation = observations[sourceId];
    if (!observation || observation.consecutive_usable_runs < 3) {
      errors.push(`${sourceId} has fewer than three consecutive usable formal runs`);
    } else if (observation.span_ms < observation.required_span_ms) {
      errors.push(`${sourceId} has not crossed two cadence windows`);
    }
  }

  for (const presentation of ["east_asia", "taiwan_focus", "japan_focus"]) {
    const result = presentations?.[presentation];
    if (result && Number(result.selected_count || 0) < 1) errors.push(`${presentation} selected no qualified regional Event`);
  }

  return { passed: errors.length === 0, errors };
}
