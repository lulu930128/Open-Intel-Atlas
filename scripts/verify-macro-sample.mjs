import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { createHttpClient } from "../src/atlasHttp.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { loadConfig } from "../src/config.js";

if (process.argv.length !== 3 || process.argv[2] !== "--live") {
  console.error("Usage: node scripts/verify-macro-sample.mjs --live (7 bounded BLS requests; temporary SQLite only)");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "atlas-macro-live-"));
const config = loadConfig({ ATLAS_AUTO_COLLECT: "false", ATLAS_COLLECT_ON_START: "false", ATLAS_DB_PATH: join(dir,"atlas.sqlite"), HOST:"127.0.0.1",
  SOURCE_BLS_MACRO_CALENDAR_ENABLED:"true", SOURCE_BLS_CPI_RELEASE_ENABLED:"true", SOURCE_BLS_PPI_RELEASE_ENABLED:"true" });
config.port = 0;
const all = buildSourceRegistry(config).all.filter((source) => source.id.startsWith("bls-"));
const registry = { all, enabled: all, get: (id) => all.find((s) => s.id === id) };
const upstream = createHttpClient(config.http), captured = new Map();
let replay = false, requestCount = 0;
const http = { async getText(url, options) {
  if (replay) { assert.ok(captured.has(String(url))); return captured.get(String(url)); }
  requestCount++;
  assert.ok(requestCount <= 7, "BLS request budget exceeded");
  const result = await upstream.getText(url, options);
  captured.set(String(url), result);
  return result;
} };
const runtime = createAtlasRuntime({ config, registry, http });
const report = { checked_at:new Date().toISOString(), proof_kind:"isolated_live_sample", production_adopted:false, release_window_latency_verified:false, runs:[] };
try {
  for (const source of all) {
    const result = await runtime.collector.runSource(source.id);
    report.runs.push(result);
    assert.equal(result.status, "success", JSON.stringify(result));
  }
  const before = runtime.store.macro.maxSequence();
  replay = true;
  for (const source of all) assert.equal((await runtime.collector.runSource(source.id)).status,"success");
  assert.equal(runtime.store.macro.maxSequence(), before, "Captured replay created duplicate observations");
  const address = await runtime.listen(), base = `http://127.0.0.1:${address.port}`;
  const changes = runtime.store.db.prepare("SELECT total_changes() n").get().n;
  const response = await fetch(`${base}/api/v1/macro/observations?limit=100`);
  assert.equal(response.status,200);
  const rest = await response.json();
  const mcpResponse = await fetch(`${base}/mcp`, { method:"POST", headers:{Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":"atlas.macro.observations"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"atlas.macro.observations",arguments:{limit:100},_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"macro-live-proof",version:"1.0"}}}}) });
  assert.equal(mcpResponse.status,200);
  const mcp = (await mcpResponse.json()).result.structuredContent;
  assert.deepEqual(mcp.data,rest.data);
  assert.deepEqual(mcp.coverage,rest.coverage);
  assert.equal(runtime.store.db.prepare("SELECT total_changes() n").get().n,changes);
  assert.deepEqual(runtime.store.db.prepare("PRAGMA foreign_key_check").all(),[]);
  report.request_count=requestCount;
  report.observation_count=rest.data.length;
  report.current_values=rest.data.filter(o=>o.reference_period===rest.coverage.groups.find(g=>g.group===o.source_id.split("-")[1])?.expected_reference_period);
  report.coverage=rest.coverage;
  report.rest_mcp_parity=true;
  report.read_only_verified=true;
  report.replay_idempotent=true;
  report.ok=true;
} catch (error) {
  report.ok=false;
  report.error=String(error.message);
  process.exitCode=1;
} finally {
  await runtime.close();
  // Only remove the exact directory returned by mkdtemp, after checking its parent.
  assert.equal(resolve(dir,".."),resolve(tmpdir()));
  rmSync(dir,{recursive:true,force:true});
  const output=resolve(".tmp/macro-v1-live-proof.json");
  mkdirSync(resolve(".tmp"),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ok:report.ok,requests:report.request_count,observations:report.observation_count,output,error:report.error},null,2));
}
