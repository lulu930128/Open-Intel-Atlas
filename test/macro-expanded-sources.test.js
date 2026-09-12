import test from "node:test";
import assert from "node:assert/strict";
import { verifyMacroParity } from "../scripts/lib/macro-parity.mjs";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { createSourceResult } from "../src/atlasContracts.js";
import { processSourceResult } from "../src/atlasPipeline.js";
import { parseEmployment } from "../src/macro/sources/employmentParser.js";
import { parseGdp,discoverGdp } from "../src/macro/sources/gdpParser.js";
import { parseClaims,CLAIMS_URL } from "../src/macro/sources/claimsParser.js";
import { parseFomc,parseFomcCalendar,validateFomcArtifact,FOMC_CALENDAR } from "../src/macro/sources/fomcParser.js";
const fixture=name=>readFileSync(new URL(`./fixtures/macro-expanded/${name}`,import.meta.url),"utf8");
const at="2026-09-12T05:00:00.000Z";
const gdpUrl=discoverGdp(fixture("gdpIndex.html"));
const meetings=()=>parseFomcCalendar(fixture("fedCalendar.html"),at);
const meeting=()=>meetings().filter(m=>m.statement_url).at(-1);

test("official labor summary retains persons, wage units, negative revisions and missingness",()=>{
  const r=parseEmployment(fixture("labor.html"));assert.equal(r.observations.length,9);assert.deepEqual(r.warnings,[]);
  assert.equal(r.observations.find(o=>o.indicator_id==="US_NFP_CHANGE").actual,162000);
  assert.equal(r.observations.find(o=>o.indicator_id==="US_AVERAGE_WEEKLY_HOURS").actual,34.4);
  const negative=parseEmployment(fixture("labor.html").replace("employment increased by 162,000","employment decreased by 162,000").replace("to +21,000","to -21,000"));
  assert.equal(negative.observations.find(o=>o.indicator_id==="US_NFP_CHANGE").actual,-162000);
  assert.equal(negative.observations.find(o=>o.indicator_id==="US_NFP_CHANGE"&&o.reference_period==="2026-07").actual,-21000);
  const missing=parseEmployment(fixture("labor.html").replace("or 0.3 percent, to $37.75","or — percent, to $37.75"));
  assert.ok(!missing.observations.some(o=>o.indicator_id==="US_AHE_MOM"));assert.ok(missing.warnings.length);
  assert.throws(()=>parseEmployment("<html>Access denied</html>"),/period/);
});

test("GDP official advance and second use their own column, SAAR and estimate identities",()=>{
  const second=parseGdp(fixture("gdp.html"),gdpUrl),advance=parseGdp(fixture("gdpAdvance.html"),"https://www.bea.gov/news/2026/gdp-advance-estimate-2nd-quarter-2026");
  assert.equal(second.observations[0].actual,advance.observations[0].actual);assert.notEqual(second.release.id,advance.release.id);
  assert.equal(advance.observations.length,5);assert.deepEqual(advance.warnings,[]);
  assert.equal(second.observations.find(o=>o.indicator_id==="US_NOMINAL_GDP_QOQ_ANNUALIZED").actual,8);
  assert.equal(second.calendars[1].release_stage,"third");assert.equal(second.calendars[1].reference_period,"2026-Q2");
  assert.throws(()=>parseGdp(fixture("gdp.html").replaceAll("SAAR","not seasonally adjusted"),gdpUrl),/units/);
  assert.throws(()=>parseGdp(fixture("gdp.html"),gdpUrl.replace("2nd-quarter","3rd-quarter")),/identity/);
  assert.throws(()=>discoverGdp('<a href="https://evil.example/news/2026/gdp-advance-estimate-2nd-quarter-2026">Current</a>'),/ownership/);
});

test("DOL reference weeks and prior revisions remain separate without guessing future holidays",()=>{
  const r=parseClaims(fixture("claims.txt"));assert.equal(r.observations.length,6);
  assert.equal(r.observations[0].reference_period,"2026-09-05");assert.equal(r.observations[1].reference_period,"2026-08-29");
  assert.equal(r.observations.find(o=>o.indicator_id==="US_INITIAL_CLAIMS"&&o.reference_period==="2026-08-29").actual,207000);
  assert.equal(r.calendars.length,1);
  assert.throws(()=>parseClaims(fixture("claims.txt").replaceAll("September 5","September 4")),/Saturday/);
  assert.throws(()=>parseClaims(fixture("claims.txt").replaceAll("August 29","August 22")),/reference week|range/);
});

test("FOMC typed decision preserves date-only effectiveness and rejects contradictory implementation",()=>{
  const m=meeting(),r=parseFomc(fixture("fed.html"),fixture("fedNote.html"),m);
  assert.equal(r.decision.decision_type,"hold");assert.equal(r.decision.target_lower,3.5);assert.equal(r.decision.target_upper,3.75);
  assert.equal(r.decision.effective_date,"2026-07-30");assert.equal(r.release.effective_at,undefined);
  assert.equal(r.decision.announced_change_bps,0);
  assert.ok(meetings().some(m=>m.reference_period==="2026-09-16"&&!m.statement_url));
  assert.throws(()=>parseFomc(fixture("fed.html"),fixture("fedNote.html").replace("3-1/2","4-1/2"),m),/range mismatch/);
  assert.throws(()=>parseFomc(fixture("fed.html").replace("July 29, 2026","July 30, 2026"),fixture("fedNote.html"),m),/date mismatch/);
  assert.throws(()=>validateFomcArtifact("Access denied",m.artifact_links[0],m),/content/);
});

test("eight sources share atomic ingestion and read-only REST/MCP; failures retain last-good facts",async t=>{
  const env={ATLAS_AUTO_COLLECT:"false",ATLAS_COLLECT_ON_START:"false",ATLAS_DB_PATH:":memory:",MACRO_PDFTOTEXT_PATH:"fixture-only"};
  for(const prefix of ["BLS_EMPLOYMENT","BEA_GDP","DOL_CLAIMS","FED_FOMC"])for(const kind of ["CALENDAR","RELEASE"])env[`SOURCE_${prefix}_${kind}_ENABLED`]="true";
  const config=loadConfig(env);config.dbPath=":memory:";config.port=0;
  const all=buildSourceRegistry(config).all.filter(s=>["employment","gdp","claims","fomc"].includes(s.group));assert.equal(all.length,8);
  const m=meeting(),map=new Map([["https://www.bls.gov/news.release/empsit.nr0.htm","labor.html"],["https://www.bls.gov/schedule/news_release/empsit.htm","laborCalendar.html"],["https://www.bea.gov/data/gdp/gross-domestic-product","gdpIndex.html"],[gdpUrl,"gdp.html"],[FOMC_CALENDAR,"fedCalendar.html"],[m.statement_url,"fed.html"],[m.implementation_url,"fedNote.html"],...m.artifact_links.map(a=>[a.source_url,a.artifact_type==="minutes"?"fedMinutes.html":"fedPressConference.html"])]);
  let calls=0,failedUrl=null,clock=at;
  const http={async getText(url){calls++;if(url===failedUrl)throw Error("fixture timeout");assert.ok(map.has(url),url);const data=fixture(map.get(url));return {url,status:200,contentType:"text/html",data,rawPayload:data};}};
  const runtime=createAtlasRuntime({config,registry:{all,enabled:all,get:id=>all.find(s=>s.id===id)},http,clock:()=>new Date(clock),endpointStatePath:null});t.after(()=>runtime.close());
  for(const source of all.filter(s=>s.group!=="claims"))assert.equal((await runtime.collector.runSource(source.id)).status,"success",source.id);
  // Test DOL's canonical boundary using an explicitly identified extracted-text fixture.
  // The native PDF process is exercised separately by the bounded live verification tool.
  for(const source of all.filter(s=>s.group==="claims")){
    const batch=parseClaims(fixture("claims.txt")),calendar=source.id.endsWith("calendar");
    const result=createSourceResult({source,startedAt:at,finishedAt:at,fetches:[{url:CLAIMS_URL,status:200,contentType:"text/plain; fixture=pdf-extracted",rawPayload:fixture("claims.txt")}],macroBatch:calendar?{kind:"calendar",releases:batch.calendars}:{...batch,kind:"release"},counts:{processed_item_count:calendar?batch.calendars.length:batch.observations.length}});
    processSourceResult(runtime.store,runtime.store.beginSourceRun(source,at,{}),result,at);
  }
  const firstCount=runtime.store.macro.maxSequence();assert.equal(firstCount,22);
  for(const source of all.filter(s=>s.group!=="claims"))assert.equal((await runtime.collector.runSource(source.id)).status,"success");
  assert.equal(runtime.store.macro.maxSequence(),firstCount);assert.equal(runtime.store.db.prepare("SELECT count(*) n FROM macro_policy_decisions").get().n,1);
  const address=await runtime.listen(),base=`http://127.0.0.1:${address.port}`,changes=runtime.store.db.prepare("SELECT total_changes() n").get().n,fetchCount=calls;
  for(const group of ["employment","gdp","claims","fomc"]){
    const results=await verifyMacroParity(base,group,runtime.store.macro.latestDue(group,at).id,{from:"2026-09-01",to:"2026-10-01"});
    assert.equal(results.length,4);
    const due=runtime.store.macro.latestDue(group,at),response=await fetch(`${base}/api/v1/macro/releases/${due.id}`),rest=await response.json();assert.equal(response.status,200);assert.equal(rest.data.acquisition_status,"complete");
    const mcpResponse=await fetch(`${base}/mcp`,{method:"POST",headers:{Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":"atlas.macro.release"},body:JSON.stringify({jsonrpc:"2.0",id:group,method:"tools/call",params:{name:"atlas.macro.release",arguments:{release_id:due.id},_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"test",version:"1"}}}})});
    assert.deepEqual((await mcpResponse.json()).result.structuredContent,rest);
    if(group==="claims")assert.ok(rest.data.observations.some(o=>o.reference_period!==due.reference_period));
    if(group==="fomc"){assert.equal(rest.data.policy_decision.decision_type,"hold");assert.equal(rest.data.artifacts.length,4);assert.equal(rest.data.effective_at,null);}
  }
  assert.equal(calls,fetchCount);assert.equal(runtime.store.db.prepare("SELECT total_changes() n").get().n,changes);
  clock="2026-09-12T05:01:00.000Z";failedUrl=m.statement_url;assert.equal((await runtime.collector.runSource("fed-fomc-release")).status,"failed");assert.equal(runtime.store.macro.maxSequence(),firstCount);
  assert.equal(runtime.capabilities.macroObservations({group:"fomc"}).freshness.status,"stale");assert.deepEqual(runtime.store.db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("DOL source fails closed when the PDF executable is not configured",()=>{
  const registry=buildSourceRegistry(loadConfig({SOURCE_DOL_CLAIMS_RELEASE_ENABLED:"true"}));const source=registry.get("dol-claims-release");assert.equal(source.enabled,false);assert.match(source.disabledReason,/macroPdfToTextPath/);
});
