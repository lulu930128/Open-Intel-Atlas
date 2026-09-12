import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const now = "2026-09-06T10:00:00.000Z";

test("company directory cursor is deterministic, opaque, filter-scoped, and shared with MCP", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-company-pagination-"));
  const source = fixtureSource();
  const registry = { all: [source], enabled: [source], get: (id) => id === source.id ? source : null };
  const config = loadConfig({
    ...process.env,
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_COLLECT_ON_START: "false",
    ATLAS_DB_PATH: join(root, "atlas.sqlite"),
    HOST: "127.0.0.1",
    PORT: "1"
  });
  config.port = 0;
  const runtime = createAtlasRuntime({ config, registry, clock: () => new Date(now) });
  const runId = runtime.store.beginSourceRun(source, now);
  runtime.store.ingestEntityMaster({
    sourceId: source.id,
    sourceRunId: runId,
    entities: ["Alpha", "Beta", "Gamma"].map((name) => ({
      id: `company:${name.toLowerCase()}`,
      entity_type: "company",
      canonical_name: name,
      country_code: "TW",
      allow_canonical_update: true,
      aliases: [],
      identifiers: [],
      metadata: {}
    })),
    completeness: { status: "complete", snapshot_complete: true, upstream_item_count: 3 }
  }, now);
  runtime.store.finishSourceRun(runId, { finishedAt: now, status: "success", processedItemCount: 3, entityCount: 3 });
  const address = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });

  const first = await json(`${baseUrl}/api/v1/companies?limit=2`);
  assert.deepEqual(first.data.map((item) => item.canonical_name), ["Alpha", "Beta"]);
  assert.equal(first.pagination.byte_budget, 128 * 1024);
  assert.ok(first.pagination.serialized_bytes <= first.pagination.byte_budget);
  assert.equal(first.pagination.truncated_by_byte_budget, false);
  assert.ok(first.pagination.next_cursor);
  assert.doesNotMatch(first.pagination.next_cursor, /Beta/);
  const second = await json(`${baseUrl}/api/v1/companies?limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`);
  assert.deepEqual(second.data.map((item) => item.canonical_name), ["Gamma"]);
  assert.equal(second.pagination.next_cursor, null);
  assert.equal(new Set([...first.data, ...second.data].map((item) => item.id)).size, 3);

  const mismatch = await fetch(`${baseUrl}/api/v1/companies?q=Beta&limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`);
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, "invalid_cursor");

  const mcp = await mcpRequest(baseUrl, { limit: 2 });
  assert.deepEqual(mcp.result.structuredContent.data, first.data);
  assert.deepEqual(mcp.result.structuredContent.pagination, first.pagination);
});

function fixtureSource() {
  return {
    id: "company-pagination-fixture",
    name: "Company pagination fixture",
    providerType: "official_json",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "company_master",
    domains: ["finance"],
    languages: ["en"],
    countries: ["TW"],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Fixture",
    policyNote: "Test only",
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    enabled: true,
    disabledReason: null,
    catchupMode: "latest_only",
    cadence: "1m",
    mediaPolicy: {},
    coverage: { capabilities: ["company.master"], markets: ["TWSE"], guarantee: "complete_snapshot", recoverability: "latest_only" }
  };
}

async function json(url) {
  const response = await fetch(url);
  if (response.status !== 200) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function mcpRequest(baseUrl, input) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "atlas.company.list"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "atlas.company.list",
      method: "tools/call",
      params: {
        name: "atlas.company.list",
        arguments: input,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "company-pagination", version: "1.0.0" }
        }
      }
    })
  });
  if (response.status !== 200) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
