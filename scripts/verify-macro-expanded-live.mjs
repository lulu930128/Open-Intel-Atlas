// Explicit opt-in, bounded official-source check against a new isolated SQLite database.
import assert from "node:assert/strict";
import { mkdirSync,writeFileSync } from "node:fs";
import { resolve,join } from "node:path";
import { loadConfig } from "../src/config.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { verifyMacroParity } from "./lib/macro-parity.mjs";
if(!process.argv.includes("--live"))throw Error("Use --live for bounded official provider requests; set MACRO_PDFTOTEXT_PATH first.");
const env={...process.env,ATLAS_AUTO_COLLECT:"false",ATLAS_COLLECT_ON_START:"false"};
for(const prefix of ["BLS_EMPLOYMENT","BEA_GDP","DOL_CLAIMS","FED_FOMC"])for(const kind of ["CALENDAR","RELEASE"])env[`SOURCE_${prefix}_${kind}_ENABLED`]="true";
const config=loadConfig(env);
if(!config.providers.macroPdfToTextPath)throw Error("MACRO_PDFTOTEXT_PATH is required");
const directory=resolve("data/runtime",`macro-sources-live-${new Date().toISOString().replace(/[:.]/g,"-")}`);mkdirSync(directory,{recursive:true});
config.dbPath=join(directory,"atlas.sqlite");config.port=0;
const all=buildSourceRegistry(config).all.filter(s=>["employment","gdp","claims","fomc"].includes(s.group));
const runtime=createAtlasRuntime({config,registry:{all,enabled:all.filter(s=>s.enabled),get:id=>all.find(s=>s.id===id)},endpointStatePath:null});
const report={directory,formal_adoption:false,results:[],groups:[]};
try{
  for(const source of all){const r=await runtime.collector.runSource(source.id);report.results.push({source_id:source.id,status:r.status,error:r.error_message||null,warnings:r.warnings||[]});console.log(source.id,r.status);}
  assert.ok(report.results.every(r=>r.status==="success"),"An official source did not complete");
  const address=await runtime.listen(),base=`http://127.0.0.1:${address.port}`,before=runtime.store.db.prepare("SELECT total_changes() n FROM source_runs LIMIT 1").get().n;
  for(const group of ["employment","gdp","claims","fomc"]){
    const observations=runtime.capabilities.macroObservations({group}),id=observations.coverage.groups[0].expected_release_id;
    const rest=await(await fetch(`${base}/api/v1/macro/releases/${id}`)).json();
    const response=await fetch(`${base}/mcp`,{method:"POST",headers:{Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":"atlas.macro.release"},body:JSON.stringify({jsonrpc:"2.0",id:group,method:"tools/call",params:{name:"atlas.macro.release",arguments:{release_id:id},_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"live-validation",version:"1"}}}})});
    const mcp=(await response.json()).result.structuredContent;assert.deepEqual(rest.data,mcp.data);assert.deepEqual(rest.coverage,mcp.coverage);assert.equal(rest.data.acquisition_status,"complete");
    report.groups.push({group,release_id:id,observations:observations.data.length,current_count:rest.data.observations.length,parity:true,coverage:rest.data.acquisition_status,freshness:rest.freshness.status,policy_decision:rest.data.policy_decision,artifact_count:rest.data.artifacts.length});
    report.projections ||= [];
    const day = new Date().toISOString().slice(0,10);
    report.projections.push(...await verifyMacroParity(base,group,id,{from:day,to:new Date(Date.parse(day)+30*86400000).toISOString().slice(0,10)}));
  }
  assert.equal(runtime.store.db.prepare("SELECT total_changes() n").get().n,before);assert.deepEqual(runtime.store.db.prepare("PRAGMA foreign_key_check").all(),[]);
  report.read_only=true;report.foreign_key_violations=0;report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{report.finished_at=new Date().toISOString();writeFileSync(join(directory,"proof.json"),JSON.stringify(report,null,2));await runtime.close();console.log(JSON.stringify(report,null,2));}
