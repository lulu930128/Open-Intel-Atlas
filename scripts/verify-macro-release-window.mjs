// Read-only evidence capture. Invoke during a real release window; this does not schedule or fetch providers.
import {DatabaseSync} from "node:sqlite";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {MACRO_GROUP_METADATA} from "../src/macro/indicators.js";
import {releaseCoverage} from "../src/macro/coverage.js";
import {releaseObservations} from "../src/macro/store.js";
import {watchPolicy} from "../src/macro/scheduler.js";
import {macroProjection} from "./lib/macro-parity.mjs";
const id=process.argv[2];
if(!/^[A-Z]{2}_[A-Z0-9_]+_[A-Za-z0-9_.-]+$/.test(id||"")||id.length>180)throw Error("Usage: node scripts/verify-macro-release-window.mjs RELEASE_ID");
const endpoint=JSON.parse(readFileSync("data/runtime/atlas-endpoint.json","utf8"));
const base=new URL(endpoint.base_url);
if(!["127.0.0.1","localhost","[::1]"].includes(base.hostname))throw Error("Expected loopback endpoint");
const config=(await import("../src/config.js")).loadConfig();
const db=new DatabaseSync(config.dbPath,{readOnly:true});
try{
  const release=db.prepare("SELECT * FROM macro_releases WHERE id=?").get(id);if(!release?.scheduled_at)throw Error("Release requires a known official schedule");
  const source=MACRO_GROUP_METADATA[release.release_group].source_id;
  const watch=db.prepare("SELECT * FROM macro_watch_windows WHERE release_id=? AND scheduled_at=?").get(id,release.scheduled_at);
  const watchState=watch?JSON.parse(watch.schedule_before_json):null;
  const policy=watchState?.policy||watchPolicy({macroCatalog:{groups:MACRO_GROUP_METADATA}},release.release_group);
  const start=new Date(Date.parse(release.scheduled_at)-policy.before_ms).toISOString(),end=new Date(Date.parse(release.scheduled_at)+policy.after_ms).toISOString();
  const attempts=db.prepare(`SELECT id,started_at,finished_at,status,http_status,error_type,error_message FROM source_runs
    WHERE source_id=? AND started_at>=? AND started_at<=? ORDER BY started_at,id`).all(source,start,end)
    .map(run=>({...run,raw_fetches:db.prepare("SELECT id,request_url,http_status FROM raw_fetches WHERE source_run_id=? ORDER BY id").all(run.id)}));
  const get=async path=>{const r=await fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const rest=await get(`/api/v1/macro/releases/${id}`);
  const response=await fetch(new URL("/mcp",base),{method:"POST",signal:AbortSignal.timeout(10000),headers:{Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":"atlas.macro.release"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"atlas.macro.release",arguments:{release_id:id},_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"macro-window-proof",version:"1"}}}})});
  if(!response.ok)throw Error(`MCP HTTP ${response.status}`);
  const mcp=(await response.json()).result?.structuredContent;if(!mcp)throw Error("Missing MCP structured content");
  const digest=p=>createHash("sha256").update(JSON.stringify(macroProjection(p))).digest("hex");
  const now=new Date().toISOString(),restDigest=digest(rest),mcpDigest=digest(mcp);
  // A generic successful HTTP run can still contain the previous release. Bind success to observation lineage.
  const accepted=db.prepare(`SELECT DISTINCT sr.id,sr.started_at,sr.finished_at FROM source_runs sr
    JOIN macro_observations o ON o.source_run_id=sr.id
    WHERE o.release_id=? ORDER BY sr.finished_at`).all(id);
  const first=accepted[0]||null;
  const observedTimes=db.prepare("SELECT DISTINCT fetched_at FROM macro_observations WHERE release_id=? ORDER BY fetched_at LIMIT 1000").all(id);
  const completeAt=observedTimes.find(row=>releaseCoverage(release,releaseObservations(db,id,row.fetched_at)).status==="complete")?.fetched_at||null;
  const report={captured_at:now,endpoint,release_id:id,scheduled_at:release.scheduled_at,window_start:start,window_end:end,
    watch_started_at:watch?.watch_started_at||null,watch_status:watch?"recorded":"not_observed",watch_semantics:watchState?.semantics||null,watch_policy:policy,attempts,first_attempt_at:attempts[0]?.started_at||null,
    first_success_at:first?.finished_at||null,first_observed_at:release.first_observed_at,source_published_at:release.source_published_at,
    timestamp_semantics:release.timestamp_semantics,source_run_id:first?.id||null,
    observation_count:rest.data.observed_indicator_count,acquisition_status:rest.data.acquisition_status,
    first_complete_observed_at:completeAt,first_success_semantics:"first_run_with_release_observations_not_necessarily_complete",
    source_health_after:rest.coverage.sources,source_health_before:watch?JSON.parse(watch.health_before_json):null,rest_digest:restDigest,mcp_digest:mcpDigest,parity:restDigest===mcpDigest,
    scheduled_to_first_attempt_ms:attempts[0]?Date.parse(attempts[0].started_at)-Date.parse(release.scheduled_at):null,
    scheduled_to_first_success_ms:first?Date.parse(first.finished_at)-Date.parse(release.scheduled_at):null,
    provider_publish_to_first_observed_ms:release.provider_published_at&&release.first_observed_at?Date.parse(release.first_observed_at)-Date.parse(release.provider_published_at):null,
    capture_window_status:now<start?"before_window":now>end?"after_window":"in_window",
    rest_projection:macroProjection(rest),mcp_projection:macroProjection(mcp),
    release_window_latency_verified:false,
    limitations:["Watch entry records scheduler evaluation, not lease acquisition; attempts provide separate evidence.","Missing historic watch records remain unknown.","Official embargo timestamp is not independently observed provider publication.","Human review of complete real-window evidence is required before acceptance."]};
  const dir=resolve("data/runtime/macro-release-windows");mkdirSync(dir,{recursive:true});const output=join(dir,`${id}-${now.replace(/[:.]/g,"-")}.json`);writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({output,parity:report.parity,capture_window_status:report.capture_window_status,verified:false}));if(!report.parity)process.exitCode=1;
}finally{db.close();}
