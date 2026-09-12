import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBlsCalendar, parseBlsRelease } from "../src/macro/sources/blsParser.js";
import { easternTimestamp } from "../src/macro/time.js";
import { MACRO_INDICATORS } from "../src/macro/indicators.js";
import { macroNextDue, wakeMacroSchedules } from "../src/macro/scheduler.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { processSourceResult } from "../src/atlasPipeline.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { initializeAtlasSchema } from "../src/atlasSchema.js";
import { createIntelDocument } from "../src/documents/normalize.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/macro/${name}`, import.meta.url), "utf8");
const parse = (group, overrides={}) => parseBlsRelease({group,summaryHtml:fixture(`${group}.nr0.htm`),tableHtml:fixture(`${group}.t01.htm`),indexHtml:group==="ppi"?fixture("ppi.t03.htm"):null,...overrides});

test("BLS official table fixtures preserve precise units, periods, zero and distinct PPI definitions", () => {
  const cpi=parse("cpi"), ppi=parse("ppi");
  assert.equal(cpi.observations.length,14);
  assert.equal(ppi.observations.length,33);
  assert.deepEqual(cpi.warnings,[]);
  assert.deepEqual(ppi.warnings,[]);
  const current=ppi.observations.filter((o)=>o.reference_period==="2026-08");
  assert.equal(current.find(o=>o.indicator_id==="US_PPI_EX_FOOD_ENERGY_MOM").actual,0.2);
  assert.equal(current.find(o=>o.indicator_id==="US_PPI_EX_FOOD_ENERGY_TRADE_MOM").actual,0.3);
  assert.equal(current.find(o=>o.indicator_id==="US_PPI_EX_FOOD_ENERGY_INDEX").index_base,"04/10");
  assert.equal(cpi.observations.find(o=>o.indicator_id==="US_CPI_CORE_MOM"&&o.reference_period==="2026-06").actual,0);
  assert.equal(MACRO_INDICATORS.find(i=>i.id==="US_CPI_HEADLINE_YOY").seasonal_adjustment,"NSA");
  assert.equal(cpi.release.source_published_at,"2026-09-11T12:30:00.000Z");
  assert.equal(cpi.release.timestamp_semantics,"official_embargo_time");
});

test("BLS parsing rejects mismatched months, headers, empty documents and exposes missing values", () => {
  assert.throws(()=>parse("cpi",{tableHtml:fixture("cpi.t01.htm").replaceAll("August 2026","July 2026")}),/mismatch/);
  assert.throws(()=>parse("cpi",{tableHtml:fixture("cpi.t01.htm").replace("Unadjusted indexes","Seasonally adjusted indexes")}),/adjustment/);
  assert.throws(()=>parse("cpi",{summaryHtml:""}),/Invalid/);
  const missing=parse("cpi",{tableHtml:fixture("cpi.t01.htm").replaceAll('class="datavalue">0.4<','class="datavalue">—<')});
  assert.ok(missing.warnings.some(w=>w.startsWith("missing_value")));
  assert.ok(missing.observations.every(o=>Number.isFinite(o.actual)));
});

test("official calendar includes reference month and Eastern DST conversion", () => {
  const calendar=parseBlsCalendar(fixture("cpi-calendar.htm"),"cpi");
  assert.equal(calendar.find(r=>r.reference_period==="2025-12").scheduled_at,"2026-01-13T13:30:00.000Z");
  assert.equal(calendar.find(r=>r.reference_period==="2026-08").scheduled_at,"2026-09-11T12:30:00.000Z");
  assert.equal(easternTimestamp("March 9, 2026","08:30 AM"),"2026-03-09T12:30:00.000Z");
  assert.equal(easternTimestamp("November 2, 2026","08:30 AM"),"2026-11-02T13:30:00.000Z");
  assert.throws(()=>easternTimestamp("February 30, 2026","08:30 AM"),/Invalid/);
  assert.throws(()=>parseBlsCalendar("<h2>Consumer Price Index</h2>","cpi"),/Missing/);
});

async function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),"atlas-macro-"));
  const config=loadConfig({ATLAS_AUTO_COLLECT:"false",ATLAS_COLLECT_ON_START:"false",ATLAS_DB_PATH:join(dir,"atlas.sqlite"),HOST:"127.0.0.1",
    SOURCE_BLS_MACRO_CALENDAR_ENABLED:"true",SOURCE_BLS_CPI_RELEASE_ENABLED:"true",SOURCE_BLS_PPI_RELEASE_ENABLED:"true"});
  config.port=0;
  const all=buildSourceRegistry(config).all.filter(s=>s.id.startsWith("bls-"));
  const registry={all,enabled:all.filter(s=>s.enabled),get:id=>all.find(s=>s.id===id)};
  const files=new Map(), calls=[];
  for(const g of ["cpi","ppi"]){
    files.set(`https://www.bls.gov/schedule/news_release/${g}.htm`,fixture(`${g}-calendar.htm`));
    for(const suffix of ["nr0","t01",...(g==="ppi"?["t03"]:[])])files.set(`https://www.bls.gov/news.release/${g}.${suffix}.htm`,fixture(`${g}.${suffix}.htm`));
  }
  const clock={value:"2026-09-12T01:00:00.000Z"};
  const http={getText:async(url)=>{calls.push(String(url));const data=files.get(String(url));if(data instanceof Error)throw data;if(data===undefined)throw new Error(`Unexpected fetch ${url}`);return{url:String(url),status:200,contentType:"text/html",data,rawPayload:data};}};
  const runtime=createAtlasRuntime({config,registry,http,clock:()=>new Date(clock.value),endpointStatePath:join(dir,"endpoint.json")});
  t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  const address=await runtime.listen();
  return{runtime,clock,files,calls,registry,http,base:`http://127.0.0.1:${address.port}`};
}

test("production collector persists official evidence atomically, deduplicates, and REST/MCP reads are identical without writes or fetches", async(t)=>{
  const {runtime,base,calls,clock}=await setup(t);
  for(const source of ["bls-macro-calendar","bls-cpi-release","bls-ppi-release"]){const r=await runtime.collector.runSource(source);assert.equal(r.status,"success",JSON.stringify(r));}
  assert.equal(runtime.store.macro.maxSequence(),47);
  clock.value="2026-09-12T01:01:00.000Z";
  await runtime.collector.runSource("bls-cpi-release");
  assert.equal(runtime.store.macro.maxSequence(),47);
  const changes=runtime.store.db.prepare("SELECT total_changes() n").get().n, fetchCount=calls.length;
  for(const [path,name,input]of [
    ["calendar?from=2026-09-01&to=2026-10-01","calendar",{from:"2026-09-01",to:"2026-10-01"}],
    ["releases/US_CPI_2026-08","release",{release_id:"US_CPI_2026-08"}],
    ["indicators","indicator",{}],
    ["observations?indicator_id=US_CPI_HEADLINE_MOM","observations",{indicator_id:"US_CPI_HEADLINE_MOM"}]
  ]){
    const response=await fetch(`${base}/api/v1/macro/${path}`);
    assert.equal(response.status,200,await response.clone().text());
    const rest=await response.json(),mcp=await mcpCall(base,`atlas.macro.${name}`,input);
    assert.deepEqual(mcp.result.structuredContent,rest);
  }
  assert.equal(runtime.store.db.prepare("SELECT total_changes() n").get().n,changes);
  assert.equal(calls.length,fetchCount);
  const release=runtime.capabilities.macroRelease({release_id:"US_CPI_2026-08"});
  assert.equal(release.data.acquisition_status,"complete");
  assert.equal(release.data.released_at,null);
  assert.ok(release.data.evidence_document_id);
  assert.equal(release.freshness.status,"current");
  const mom=release.data.observations.find(o=>o.indicator_id==="US_CPI_HEADLINE_MOM");
  assert.equal(mom.previous,null);
  assert.equal(mom.revised_previous,0.1);
  assert.equal(mom.initial_release_value_verified,false);
  assert.equal(runtime.store.getStats().events,0);
  assert.deepEqual(runtime.store.db.prepare("PRAGMA foreign_key_check").all(),[]);
  for(const query of ["observations?limit=0","observations?history=1","observations?reference_period=2026-13","calendar?from=2026-02-30&to=2026-03-05","observations?cursor=bad","indicators?country=TW"])
    assert.equal((await fetch(`${base}/api/v1/macro/${query}`)).status,400,query);
});

test("observed revisions retain as-of history, immutable previous, zero values and snapshot pagination",async(t)=>{
  const {runtime,files,clock}=await setup(t);
  await runtime.collector.runSource("bls-cpi-release");
  const original=runtime.capabilities.macroObservations({indicator_id:"US_CPI_HEADLINE_MOM",reference_period:"2026-08"}).data[0];
  const first=runtime.capabilities.macroObservations({group:"cpi",limit:2});
  const url="https://www.bls.gov/news.release/cpi.t01.htm";
  files.set(url,files.get(url).replace('class="datavalue">0.4<','class="datavalue">0.0<'));
  clock.value="2026-09-12T02:00:00.000Z";
  assert.equal((await runtime.collector.runSource("bls-cpi-release")).status,"success");
  const latest=runtime.capabilities.macroObservations({indicator_id:"US_CPI_HEADLINE_MOM",reference_period:"2026-08"}).data[0];
  assert.equal(latest.actual,0);
  assert.equal(latest.revision_number,1);
  assert.notEqual(latest.id,original.id);
  const past=runtime.capabilities.macroObservations({indicator_id:"US_CPI_HEADLINE_MOM",reference_period:"2026-08",as_of:"2026-09-12T01:30:00Z"});
  assert.equal(past.data[0].id,original.id);
  assert.equal(runtime.capabilities.macroObservations({indicator_id:"US_CPI_HEADLINE_MOM",reference_period:"2026-08",history:true}).data.length,2);
  const next=runtime.capabilities.macroObservations({group:"cpi",limit:100,cursor:first.pagination.next_cursor});
  assert.ok(next.data.every(o=>o.sequence<=first.pagination.snapshot_sequence));
  assert.equal(new Set([...first.data,...next.data].map(o=>o.id)).size,14);
  assert.throws(()=>runtime.capabilities.macroObservations({group:"ppi",cursor:first.pagination.next_cursor}),/cursor/);
});

test("provider failures preserve last-good facts, partial calendar does not delete, and invalid batches roll back",async(t)=>{
  const {runtime,files,clock,registry,http}=await setup(t);
  await runtime.collector.runSource("bls-macro-calendar");
  await runtime.collector.runSource("bls-cpi-release");
  const before=runtime.store.macro.maxSequence();
  files.set("https://www.bls.gov/schedule/news_release/ppi.htm",new Error("timeout"));
  clock.value="2026-09-12T02:00:00.000Z";
  assert.equal((await runtime.collector.runSource("bls-macro-calendar")).status,"partial");
  assert.ok(runtime.store.getMacroRelease("US_PPI_2026-08"));
  const source=registry.get("bls-cpi-release");
  const result=await source.run({source,http,now:()=>clock.value});
  result.macro_batch.observations.at(-1).actual=NaN;
  const runId=runtime.store.beginSourceRun(source,clock.value,{});
  const rawCount=runtime.store.getStats().raw_fetches;
  assert.throws(()=>processSourceResult(runtime.store,runId,result,clock.value),/Invalid macro observation/);
  assert.equal(runtime.store.getStats().raw_fetches,rawCount);
  assert.equal(runtime.store.macro.maxSequence(),before);
  files.set("https://www.bls.gov/news.release/cpi.nr0.htm",new Error("timeout"));
  clock.value="2026-09-12T02:01:00.000Z";
  assert.equal((await runtime.collector.runSource("bls-cpi-release")).status,"failed");
  const projection=runtime.capabilities.macroObservations({group:"cpi"});
  assert.equal(projection.data.length,14);
  assert.notEqual(projection.freshness.status,"current");
  assert.ok(projection.coverage.sources.some(s=>s.source_id==="bls-cpi-release"&&s.status==="degraded"));
});

test("bounded release watch respects windows, completion and existing failure backoff",async(t)=>{
  const {runtime,registry}=await setup(t);
  await runtime.collector.runSource("bls-macro-calendar");
  const start="2026-09-11T12:15:00.000Z",normal="2026-09-11T18:15:00.000Z";
  assert.equal(macroNextDue(runtime.store,"cpi",start,normal),"2026-09-11T12:20:00.000Z");
  assert.equal(macroNextDue(runtime.store,"cpi","2026-09-11T12:30:00.000Z",normal),"2026-09-11T12:31:00.000Z");
  assert.equal(macroNextDue(runtime.store,"cpi","2026-09-11T13:01:00.000Z",normal),normal);
  runtime.store.db.prepare("UPDATE source_schedule_state SET consecutive_failures=1,next_due_at=?,backoff_until=? WHERE source_id='bls-cpi-release'").run(normal,normal);
  wakeMacroSchedules(runtime.store,registry,start);
  assert.equal(runtime.store.db.prepare("SELECT next_due_at FROM source_schedule_state WHERE source_id='bls-cpi-release'").get().next_due_at,normal);
  await runtime.collector.runSource("bls-cpi-release");
  assert.equal(macroNextDue(runtime.store,"cpi","2026-09-11T12:30:00.000Z",normal),normal);
});

test("calendar cursors retain their original default range as the clock advances and reschedules retain history",async(t)=>{
  const {runtime,clock,files}=await setup(t);
  await runtime.collector.runSource("bls-macro-calendar");
  const first=runtime.capabilities.macroCalendar({limit:1});
  assert.ok(first.pagination.next_cursor);
  clock.value="2026-09-13T02:00:00.000Z";
  const next=runtime.capabilities.macroCalendar({limit:1,cursor:first.pagination.next_cursor});
  assert.equal(next.pagination.from,first.pagination.from);
  assert.notEqual(next.data[0].id,first.data[0].id);
  const url="https://www.bls.gov/schedule/news_release/cpi.htm";
  files.set(url,files.get(url).replace("Oct. 14, 2026","Oct. 15, 2026"));
  await runtime.collector.runSource("bls-macro-calendar");
  const release=runtime.capabilities.macroRelease({release_id:"US_CPI_2026-09"});
  assert.equal(release.data.calendar_versions.length,2);
  assert.equal(release.data.scheduled_at,"2026-10-15T12:30:00.000Z");
  assert.equal(release.data.status,"scheduled");
  assert.equal(release.data.acquisition_status,"missing");
  clock.value="2026-10-15T12:31:00.000Z";
  assert.equal(runtime.capabilities.macroRelease({release_id:"US_CPI_2026-09"}).data.status,"due");
  assert.notEqual(runtime.capabilities.macroObservations({group:"cpi"}).freshness.status,"current");
});

test("a new release retains its own evidence and frozen previous vintage while adding revised previous",async(t)=>{
  const {runtime,clock,registry,http}=await setup(t);
  await runtime.collector.runSource("bls-cpi-release");
  const old=runtime.capabilities.macroRelease({release_id:"US_CPI_2026-08"}).data;
  const oldMom=old.observations.find(o=>o.indicator_id==="US_CPI_HEADLINE_MOM");
  clock.value="2026-10-14T12:31:00.000Z";
  const source=registry.get("bls-cpi-release");
  const batch=await source.run({source,http,now:()=>clock.value});
  batch.macro_batch.release={...batch.macro_batch.release,id:"US_CPI_2026-09",reference_period:"2026-09",source_published_at:"2026-10-14T12:30:00.000Z",release_url:"https://www.bls.gov/news.release/archives/cpi_10142026.htm"};
  batch.macro_batch.observations=[
    {...batch.macro_batch.observations.find(o=>o.indicator_id==="US_CPI_HEADLINE_MOM"&&o.reference_period==="2026-08"),actual:0.5},
    {...batch.macro_batch.observations.find(o=>o.indicator_id==="US_CPI_HEADLINE_MOM"&&o.reference_period==="2026-08"),reference_period:"2026-09",actual:0.2}
  ];
  batch.documents=[createIntelDocument(source,{externalId:"US_CPI_2026-09",canonicalUrl:batch.macro_batch.release.release_url,title:"CPI September fixture",publisher:"BLS",rawMetadata:{event_eligible:false,macro_release_id:"US_CPI_2026-09"}},clock.value)];
  batch.counts.processed_item_count=2;
  const run=runtime.store.beginSourceRun(source,clock.value,{});
  processSourceResult(runtime.store,run,batch,clock.value);
  const current=runtime.capabilities.macroRelease({release_id:"US_CPI_2026-09"}).data;
  assert.notEqual(current.evidence_document_id,old.evidence_document_id);
  assert.equal(runtime.store.getStats().documents,2);
  assert.equal(current.observations[0].previous,0.4);
  assert.equal(current.observations[0].previous_observation_id,oldMom.id);
  assert.equal(current.observations[0].revised_previous,0.5);
  assert.equal(runtime.capabilities.macroRelease({release_id:old.id}).data.observations.find(o=>o.indicator_id==="US_CPI_HEADLINE_MOM").actual,0.4);
  assert.equal(current.acquisition_status,"partial");
});

test("future embargo and cross-source ownership mismatches cannot persist observations",async(t)=>{
  const {runtime,clock,registry,http}=await setup(t);
  clock.value="2026-09-10T01:00:00.000Z";
  assert.equal((await runtime.collector.runSource("bls-cpi-release")).status,"failed");
  assert.equal(runtime.store.getStats().documents,0);
  assert.equal(runtime.store.macro.maxSequence(),0);
  clock.value="2026-09-12T01:00:00.000Z";
  const source=registry.get("bls-cpi-release"),result=await source.run({source,http,now:()=>clock.value});
  result.macro_batch.observations[0].indicator_id="US_PPI_FINAL_DEMAND_MOM";
  const run=runtime.store.beginSourceRun(source,clock.value,{});
  assert.throws(()=>processSourceResult(runtime.store,run,result,clock.value),/Invalid macro observation/);
  assert.equal(runtime.store.macro.maxSequence(),0);
});

test("additive macro schema migration is idempotent and preserves existing data",()=>{
  const store=openAtlasStore(":memory:");
  try{
    const count=store.db.prepare("SELECT COUNT(*) n FROM macro_indicators").get().n;
    initializeAtlasSchema(store.db);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM macro_indicators").get().n,count);
    assert.equal(count,39);
    assert.equal(store.getStats().schema_version,11);
  }finally{store.close();}
});

async function mcpCall(base,name,input){
  const response=await fetch(`${base}/mcp`,{method:"POST",headers:{Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":name},
    body:JSON.stringify({jsonrpc:"2.0",id:name,method:"tools/call",params:{name,arguments:input,_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"macro-test",version:"1.0"}}}})});
  assert.equal(response.status,200,await response.clone().text());
  return response.json();
}
