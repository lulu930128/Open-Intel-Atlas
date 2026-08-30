import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CONSUMER_CONTRACT_VERSION } from "../src/atlasCapabilities.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { SCHEMA_VERSION } from "../src/atlasSchema.js";
import { loadConfig } from "../src/config.js";

const PRESENTATIONS = ["global", "east_asia", "taiwan_focus", "japan_focus"];
const COUNTRY_PRESENTATION_CASES = [
  { country: "JP", presentation: "global" },
  { country: "US", presentation: "japan_focus" }
];
const REGIONAL_SOURCES = [
  { id: "tw-mofa-press-releases", expectedEnabled: true },
  { id: "tw-ncdr-active-cap-alerts", expectedEnabled: true },
  { id: "jp-mod-news", expectedEnabled: true },
  { id: "jp-jpcert-alerts", expectedEnabled: true },
  { id: "jp-jma-eqvol", expectedEnabled: true },
  { id: "jp-fdma-disaster-info", expectedEnabled: true },
  { id: "jp-ndl-diet-minutes", expectedEnabled: true },
  { id: "jp-meti-latest", expectedEnabled: false }
];
const sourcePath = resolve(parseSourcePath(process.argv.slice(2)));

if (!existsSync(sourcePath)) fail(`Atlas database does not exist: ${sourcePath}`);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-intel-atlas-isolated-adoption-"));
const copyPath = join(temporaryDirectory, "atlas.sqlite");
let sourceDatabase = null;
let runtime = null;

try {
  sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
  sourceDatabase.exec("PRAGMA query_only = ON");
  const copiedPages = await backup(sourceDatabase, copyPath);
  sourceDatabase.close();
  sourceDatabase = null;

  const config = {
    ...loadConfig({
      ...process.env,
      ATLAS_AUTO_COLLECT: "false",
      ATLAS_COLLECT_ON_START: "false",
      ATLAS_DB_PATH: copyPath
    }),
    host: "127.0.0.1",
    port: 0
  };
  runtime = createAtlasRuntime({ config });
  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await getJson(`${baseUrl}/api/v1/health`);
  const sourceEnvelope = await getJson(`${baseUrl}/api/v1/sources`);
  const profileEnvelope = await getJson(`${baseUrl}/api/v1/profiles`);
  const sources = sourceEnvelope.data || [];
  const errors = [];

  expectEqual(errors, "health contract", health.contract_version, CONSUMER_CONTRACT_VERSION);
  expectEqual(errors, "schema version", health.storage?.schema_version, SCHEMA_VERSION);
  expectEqual(errors, "registered source count", health.storage?.sources, 33);
  expectEqual(errors, "scheduler enabled", health.scheduler?.enabled, false);
  expectEqual(errors, "profile contract", profileEnvelope.contract_version, CONSUMER_CONTRACT_VERSION);

  const regionalSourceStates = Object.fromEntries(REGIONAL_SOURCES.map(({ id: sourceId, expectedEnabled }) => {
    const source = sources.find((entry) => entry.id === sourceId);
    if (!source) errors.push(`Missing regional source: ${sourceId}`);
    else if (source.enabled !== expectedEnabled) {
      errors.push(`Regional source enabled state mismatch for ${sourceId}: expected ${expectedEnabled}, received ${source.enabled}`);
    }
    return [sourceId, source ? { enabled: source.enabled, health: source.health?.status || "unknown" } : null];
  }));

  const presentations = {};
  for (const presentation of PRESENTATIONS) {
    const restBrief = await getJson(`${baseUrl}/api/v1/brief?presentation=${presentation}&limit=8`);
    const mcpResponse = await callMcpBrief(baseUrl, { presentation });
    const mcpBrief = mcpResponse.result?.structuredContent;
    if (!mcpBrief) {
      errors.push(`MCP ${presentation} response did not include structuredContent`);
      continue;
    }

    expectEqual(errors, `REST ${presentation} contract`, restBrief.contract_version, CONSUMER_CONTRACT_VERSION);
    expectEqual(errors, `MCP ${presentation} contract`, mcpBrief.contract_version, CONSUMER_CONTRACT_VERSION);
    expectEqual(errors, `REST ${presentation} selection`, restBrief.data?.selection?.presentation, presentation);
    expectEqual(errors, `MCP ${presentation} selection`, mcpBrief.data?.selection?.presentation, presentation);

    const restIds = (restBrief.data?.highlights || []).map((event) => event.id);
    const mcpIds = (mcpBrief.data?.highlights || []).map((event) => event.id);
    const restGaps = restBrief.data?.selection?.coverage_gaps || [];
    const mcpGaps = mcpBrief.data?.selection?.coverage_gaps || [];
    expectJsonEqual(errors, `REST/MCP ${presentation} ordered IDs`, restIds, mcpIds);
    expectJsonEqual(errors, `REST/MCP ${presentation} coverage gaps`, restGaps, mcpGaps);

    presentations[presentation] = {
      candidate_count: restBrief.data?.selection?.candidate_count ?? null,
      quality_qualified_count: restBrief.data?.selection?.quality_qualified_count ?? null,
      regional_qualified_count: restBrief.data?.selection?.regional_qualified_count ?? null,
      selected_count: restBrief.data?.selection?.selected_count ?? null,
      coverage_gaps: restGaps,
      ordered_event_ids: restIds
    };
  }

  const countryPresentationParity = {};
  for (const input of COUNTRY_PRESENTATION_CASES) {
    const key = `${input.country}:${input.presentation}`;
    const restBrief = await getJson(
      `${baseUrl}/api/v1/brief?country=${input.country}&presentation=${input.presentation}&limit=8`
    );
    const mcpResponse = await callMcpBrief(baseUrl, input);
    const mcpBrief = mcpResponse.result?.structuredContent;
    if (!mcpBrief) {
      errors.push(`MCP ${key} response did not include structuredContent`);
      continue;
    }
    const restIds = (restBrief.data?.highlights || []).map((event) => event.id);
    const mcpIds = (mcpBrief.data?.highlights || []).map((event) => event.id);
    expectJsonEqual(errors, `REST/MCP ${key} ordered IDs`, restIds, mcpIds);
    expectEqual(errors, `REST ${key} selection`, restBrief.data?.selection?.presentation, input.presentation);
    expectEqual(errors, `MCP ${key} selection`, mcpBrief.data?.selection?.presentation, input.presentation);
    countryPresentationParity[key] = { ordered_event_ids: restIds, parity: JSON.stringify(restIds) === JSON.stringify(mcpIds) };
  }

  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0 ? "passed" : "failed",
    mode: "isolated-runtime-copy-adoption",
    source_database: sourcePath,
    copied_bytes: statSync(copyPath).size,
    copied_pages: copiedPages,
    isolated_runtime: {
      host: "127.0.0.1",
      port: address.port,
      scheduler_enabled: health.scheduler?.enabled,
      contract_version: health.contract_version,
      schema_version: health.storage?.schema_version,
      registered_sources: health.storage?.sources,
      source_runs: health.storage?.source_runs,
      documents: health.storage?.documents,
      stories: health.storage?.stories,
      events: health.storage?.events,
      coverage_status: health.coverage?.status
    },
    regional_source_states: regionalSourceStates,
    presentations,
    country_presentation_parity: countryPresentationParity,
    errors
  }, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "isolated-runtime-copy-adoption",
    source_database: sourcePath,
    error_type: error?.name || "Error",
    error_message: String(error?.message || error)
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await runtime?.close();
  sourceDatabase?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function callMcpBrief(baseUrl, input) {
  const method = "tools/call";
  const name = "atlas.brief";
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      "Mcp-Name": name
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-${input.country || "all"}-${input.presentation}`,
      method,
      params: {
        name,
        arguments: { ...input, limit: 8 },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "atlas-isolated-adoption", version: "1.0.0" }
        }
      }
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${JSON.stringify(input)} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(text);
  const data = text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .find(Boolean);
  if (!data) throw new Error(`MCP ${JSON.stringify(input)} did not return JSON or SSE data`);
  return JSON.parse(data);
}

function expectEqual(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function expectJsonEqual(errors, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function parseSourcePath(args) {
  let source = "data/db/atlas.sqlite";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source-db") {
      source = args[index + 1] || "";
      index += 1;
    } else {
      fail(`Unknown argument: ${args[index]}`);
    }
  }
  if (!source) fail("--source-db requires a path");
  return source;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
