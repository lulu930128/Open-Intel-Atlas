import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CONSUMER_CONTRACT_VERSION } from "../src/atlasCapabilities.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { SCHEMA_VERSION } from "../src/atlasSchema.js";
import { loadConfig } from "../src/config.js";

const PRESENTATIONS = ["global", "east_asia", "taiwan_focus", "japan_focus"];
const LIVE_SOURCE_IDS = [
  "tw-mofa-press-releases",
  "tw-ncdr-active-cap-alerts",
  "jp-mod-news",
  "jp-jpcert-alerts",
  "jp-jma-eqvol",
  "jp-fdma-disaster-info",
  "jp-ndl-diet-minutes"
];
const sourcePath = resolve(parseSourcePath(process.argv.slice(2)));

if (!existsSync(sourcePath)) fail(`Atlas database does not exist: ${sourcePath}`);

const sourceBefore = databaseIdentity(sourcePath);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-intel-atlas-regional-live-copy-"));
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
  const beforeStats = runtime.store.getStats();
  const errors = [];
  const sourceResults = [];

  for (const sourceId of LIVE_SOURCE_IDS) {
    const source = runtime.registry.get(sourceId);
    if (!source) {
      errors.push(`Missing live regional source: ${sourceId}`);
      continue;
    }
    if (!source.enabled) {
      errors.push(`Live regional source is disabled: ${sourceId} (${source.disabledReason || "unknown reason"})`);
      continue;
    }

    const result = await runtime.collector.runSource(sourceId, { triggerKind: "regional_live_copy_rehearsal" });
    const fetchStats = result.run_id
      ? runtime.store.db.prepare(`
          SELECT COUNT(*) AS fetch_count,
                 COALESCE(SUM(payload_truncated), 0) AS truncated_count
          FROM raw_fetches
          WHERE source_run_id = ?
        `).get(result.run_id)
      : { fetch_count: 0, truncated_count: 0 };

    if (!['success', 'partial'].includes(result.status)) {
      errors.push(`${sourceId} live copy collection returned ${result.status}: ${result.error_message || result.reason || "unknown"}`);
    }
    if (Number(fetchStats.truncated_count) > 0) {
      errors.push(`${sourceId} stored one or more truncated live payloads`);
    }
    if (sourceId === "tw-ncdr-active-cap-alerts" && (Number(result.item_count) < 1 || Number(result.event_count) < 1)) {
      errors.push("NCDR live copy collection did not create at least one Document and Event");
    }

    sourceResults.push({
      source_id: sourceId,
      status: result.status,
      duration_ms: result.duration_ms ?? null,
      http_status: result.http_status ?? null,
      item_count: result.item_count ?? 0,
      inserted_count: result.inserted_count ?? 0,
      updated_count: result.updated_count ?? 0,
      event_count: result.event_count ?? 0,
      fetch_count: Number(fetchStats.fetch_count || 0),
      truncated_count: Number(fetchStats.truncated_count || 0),
      error_type: result.error_type || null,
      error_message: result.error_message || null
    });
  }

  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await getJson(`${baseUrl}/api/v1/health`);
  expectEqual(errors, "health contract", health.contract_version, CONSUMER_CONTRACT_VERSION);
  expectEqual(errors, "schema version", health.storage?.schema_version, SCHEMA_VERSION);
  expectEqual(errors, "registered source count", health.storage?.sources, 33);
  expectEqual(errors, "scheduler enabled", health.scheduler?.enabled, false);

  const presentations = {};
  for (const presentation of PRESENTATIONS) {
    const restBrief = await getJson(`${baseUrl}/api/v1/brief?presentation=${presentation}&limit=8`);
    const mcpResponse = await callMcpBrief(baseUrl, presentation);
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
    if (presentation !== "global" && restIds.length === 0) {
      errors.push(`${presentation} did not select any live regional Event`);
    }

    presentations[presentation] = {
      candidate_count: restBrief.data?.selection?.candidate_count ?? null,
      quality_qualified_count: restBrief.data?.selection?.quality_qualified_count ?? null,
      regional_qualified_count: restBrief.data?.selection?.regional_qualified_count ?? null,
      selected_count: restBrief.data?.selection?.selected_count ?? null,
      coverage_gaps: restGaps,
      ordered_event_ids: restIds,
      highlights: (restBrief.data?.highlights || []).map((event) => ({
        id: event.id,
        event_type: event.event_type,
        primary_domain: event.primary_domain,
        title: event.title,
        location: event.location || null
      }))
    };
  }

  const afterStats = runtime.store.getStats();
  const sourceAfter = databaseIdentity(sourcePath);
  expectJsonEqual(errors, "source database identity", sourceAfter, sourceBefore);

  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0 ? "passed" : "failed",
    mode: "copy-only-live-regional-adoption-rehearsal",
    source_database: sourcePath,
    source_database_identity_before: sourceBefore,
    source_database_identity_after: sourceAfter,
    copied_pages: copiedPages,
    copy_bytes_after_collection: statSync(copyPath).size,
    isolated_runtime: {
      host: "127.0.0.1",
      port: address.port,
      scheduler_enabled: health.scheduler?.enabled,
      contract_version: health.contract_version,
      schema_version: health.storage?.schema_version,
      registered_sources: health.storage?.sources,
      before: summarizeStats(beforeStats),
      after: summarizeStats(afterStats)
    },
    live_source_results: sourceResults,
    presentations,
    cleanup: "temporary runtime and copied database are removed in finally",
    errors
  }, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    mode: "copy-only-live-regional-adoption-rehearsal",
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

function summarizeStats(stats) {
  return {
    sources: stats.sources,
    source_runs: stats.source_runs,
    raw_fetches: stats.raw_fetches,
    documents: stats.documents,
    document_promotion_decisions: stats.document_promotion_decisions,
    stories: stats.stories,
    events: stats.events,
    event_regional_relevance: stats.event_regional_relevance
  };
}

function databaseIdentity(path) {
  return Object.fromEntries(
    [
      ["database", path],
      ["wal", `${path}-wal`],
      ["shm", `${path}-shm`],
      ["journal", `${path}-journal`]
    ].map(([label, candidate]) => [label, fileIdentity(candidate)])
  );
}

function fileIdentity(path) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return {
    size: stat.size,
    modified_at_ms: stat.mtimeMs
  };
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function callMcpBrief(baseUrl, presentation) {
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
      id: `${name}-${presentation}`,
      method,
      params: {
        name,
        arguments: { presentation, limit: 8 },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "atlas-regional-live-copy", version: "1.0.0" }
        }
      }
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${presentation} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(text);
  const data = text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .find(Boolean);
  if (!data) throw new Error(`MCP ${presentation} did not return JSON or SSE data`);
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
