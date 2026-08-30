import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ENABLED_REGIONAL_SOURCE_IDS,
  REGIONAL_PRESENTATIONS,
  evaluateFormalProduct,
  evaluateFormalRuntime
} from "./lib/formal-regional-acceptance.mjs";

const COUNTRY_PRESENTATION_CASES = [
  { country: "JP", presentation: "global" },
  { country: "US", presentation: "japan_focus" }
];

const options = parseArguments(process.argv.slice(2));
const errors = [];

try {
  const health = await getJson(`${options.baseUrl}/api/v1/health`);
  const sourceEnvelope = await getJson(`${options.baseUrl}/api/v1/sources`);
  const sources = Array.isArray(sourceEnvelope.data) ? sourceEnvelope.data : [];
  const presentations = {};

  for (const presentation of REGIONAL_PRESENTATIONS) {
    const restBrief = await getJson(`${options.baseUrl}/api/v1/brief?presentation=${presentation}&limit=8`);
    const mcpEnvelope = await callMcpBrief(options.baseUrl, { presentation });
    const mcpBrief = mcpEnvelope.result?.structuredContent || null;
    const restIds = (restBrief.data?.highlights || []).map((event) => event.id);
    const mcpIds = (mcpBrief?.data?.highlights || []).map((event) => event.id);
    const restGaps = restBrief.data?.selection?.coverage_gaps || [];
    const mcpGaps = mcpBrief?.data?.selection?.coverage_gaps || [];
    presentations[presentation] = {
      rest_contract: restBrief.contract_version || null,
      mcp_contract: mcpBrief?.contract_version || null,
      rest_presentation: restBrief.data?.selection?.presentation || null,
      mcp_presentation: mcpBrief?.data?.selection?.presentation || null,
      selected_count: restBrief.data?.selection?.selected_count ?? null,
      coverage_gaps: restGaps,
      ordered_event_ids: restIds,
      parity: JSON.stringify(restIds) === JSON.stringify(mcpIds) && JSON.stringify(restGaps) === JSON.stringify(mcpGaps)
    };
  }

  const countryPresentationParity = {};
  for (const input of COUNTRY_PRESENTATION_CASES) {
    const key = `${input.country}:${input.presentation}`;
    const restBrief = await getJson(
      `${options.baseUrl}/api/v1/brief?country=${input.country}&presentation=${input.presentation}&limit=8`
    );
    const mcpEnvelope = await callMcpBrief(options.baseUrl, input);
    const mcpBrief = mcpEnvelope.result?.structuredContent || null;
    const restIds = (restBrief.data?.highlights || []).map((event) => event.id);
    const mcpIds = (mcpBrief?.data?.highlights || []).map((event) => event.id);
    const parity = Boolean(mcpBrief)
      && restBrief.data?.selection?.presentation === input.presentation
      && mcpBrief.data?.selection?.presentation === input.presentation
      && JSON.stringify(restIds) === JSON.stringify(mcpIds);
    if (!parity) errors.push(`REST/MCP country-presentation parity failed for ${key}`);
    countryPresentationParity[key] = { ordered_event_ids: restIds, parity };
  }

  const runtime = evaluateFormalRuntime({ health, sources, presentations });
  errors.push(...runtime.errors);
  let product = null;
  let observations = null;
  if (options.phase === "product") {
    observations = readSourceObservations(options.databasePath, sources);
    product = evaluateFormalProduct({ sources, presentations, observations });
    errors.push(...product.errors);
  }

  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0 ? "passed" : "failed",
    mode: "read-only-formal-regional-adoption-verification",
    phase: options.phase,
    base_url: options.baseUrl,
    checked_at: new Date().toISOString(),
    runtime: {
      version: health.version || null,
      contract_version: health.contract_version || null,
      schema_version: health.storage?.schema_version ?? null,
      registered_sources: health.storage?.sources ?? null,
      scheduler_enabled: health.scheduler?.enabled ?? null
    },
    regional_sources: Object.fromEntries(
      [...ENABLED_REGIONAL_SOURCE_IDS, "jp-meti-latest"].map((sourceId) => {
        const source = sources.find((entry) => entry.id === sourceId);
        return [sourceId, source ? {
          enabled: source.enabled,
          disabled_reason: source.disabled_reason,
          health_status: source.health?.status || null,
          last_fetch_status: source.health?.last_fetch_status || null,
          freshness_status: source.health?.freshness_status || null,
          last_success_at: source.health?.last_success_at || null
        } : null];
      })
    ),
    presentations,
    country_presentation_parity: countryPresentationParity,
    source_observations: observations,
    runtime_gate: runtime,
    product_gate: product,
    errors
  }, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "read-only-formal-regional-adoption-verification",
    phase: options.phase,
    base_url: options.baseUrl,
    error_type: error?.name || "Error",
    error_message: String(error?.message || error)
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function callMcpBrief(baseUrl, input) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "atlas.brief"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `atlas.brief-${input.country || "all"}-${input.presentation}`,
      method: "tools/call",
      params: {
        name: "atlas.brief",
        arguments: { ...input, limit: 8 },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "atlas-formal-adoption-verifier", version: "1.0.0" }
        }
      }
    }),
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${JSON.stringify(input)} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(text);
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find(Boolean);
  if (!data) throw new Error(`MCP ${JSON.stringify(input)} did not return JSON or SSE data`);
  return JSON.parse(data);
}

function parseArguments(args) {
  const options = {
    baseUrl: "http://127.0.0.1:8790",
    phase: "runtime",
    databasePath: resolve("data/db/atlas.sqlite")
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--base-url") options.baseUrl = required(value, args[index]).replace(/\/+$/, "");
    else if (args[index] === "--source-db") options.databasePath = resolve(required(value, args[index]));
    else if (args[index] === "--phase") {
      options.phase = required(value, args[index]);
      if (!['runtime', 'product'].includes(options.phase)) fail("--phase must be runtime or product");
    } else fail(`Unknown argument: ${args[index]}`);
    index += 1;
  }
  return options;
}

function readSourceObservations(databasePath, sources) {
  if (!existsSync(databasePath)) throw new Error(`Atlas database does not exist: ${databasePath}`);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const statement = database.prepare(`
      SELECT started_at, finished_at, status, not_modified
      FROM source_runs
      WHERE source_id = ?
      ORDER BY started_at DESC
      LIMIT 3
    `);
    return Object.fromEntries(ENABLED_REGIONAL_SOURCE_IDS.map((sourceId) => {
      const source = sources.find((entry) => entry.id === sourceId);
      const cadenceMs = Number(source?.cadence_ms || 0);
      const runs = statement.all(sourceId).map((run) => ({
        started_at: run.started_at,
        finished_at: run.finished_at,
        status: run.status,
        not_modified: Boolean(run.not_modified)
      }));
      let consecutiveUsableRuns = 0;
      for (const run of runs) {
        if (!['success', 'partial'].includes(run.status)) break;
        consecutiveUsableRuns += 1;
      }
      const usableWindow = runs.slice(0, consecutiveUsableRuns);
      const newest = Date.parse(usableWindow[0]?.started_at || "");
      const oldest = Date.parse(usableWindow.at(-1)?.started_at || "");
      const spanMs = Number.isFinite(newest) && Number.isFinite(oldest) ? Math.max(0, newest - oldest) : 0;
      return [sourceId, {
        cadence_ms: cadenceMs,
        required_span_ms: cadenceMs * 2,
        consecutive_usable_runs: consecutiveUsableRuns,
        span_ms: spanMs,
        runs
      }];
    }));
  } finally {
    database.close();
  }
}

function required(value, flag) {
  if (!value) fail(`${flag} requires a value`);
  return value;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
