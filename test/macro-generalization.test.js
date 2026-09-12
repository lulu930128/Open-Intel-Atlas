import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { period, shiftReference, buildReleaseId } from "../src/macro/period.js";
import { buildRequirements, releaseCoverage } from "../src/macro/coverage.js";
import { displaySemantics } from "../src/macro/semantics.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { loadConfig } from "../src/config.js";
import { createMacroCapabilities } from "../src/macro/capabilities.js";
import { wakeMacroSchedules } from "../src/macro/scheduler.js";
import { valueLabel, basisLabel } from "../public/macroModel.js";
import { DatabaseSync } from "node:sqlite";
import { migrateMacroV9 } from "../src/macro/schema.js";
import { migrateMacroV10 } from "../src/macro/migrationV10.js";

test("periods use exclusive date-only bounds and preserve weekly conventions across years",()=>{
  assert.equal(period("month","2024-02").period_end,"2024-03-01");
  assert.equal(period("quarter","2026-Q4").period_end,"2027-01-01");
  assert.equal(period("year","2026").period_end,"2027-01-01");
  assert.equal(period("week","2026-W01",{week_convention:"iso"}).period_start,"2025-12-29");
  assert.equal(shiftReference("week","2026-W01",-1,{week_convention:"iso"}),"2025-W52");
  assert.equal(shiftReference("week","2026-09-05",-1,{week_convention:"ending_saturday"}),"2026-08-29");
  assert.equal(period("week","2026-09-05",{week_convention:"ending_saturday"}).period_end,"2026-09-06");
  assert.throws(()=>period("week","2025-W53",{week_convention:"iso"}),/Invalid/);
  assert.throws(()=>period("week","2026-09-04",{week_convention:"ending_saturday"}),/Saturday/);
  assert.throws(()=>period("week","2026-W01"),/convention/);
  assert.throws(()=>period("event","meeting",{period_start:"2026-02-30",period_end:"2026-03-01"}),/date/);
  assert.throws(()=>buildReleaseId("US","gdp","quarter","2026-Q2","annual_revision"),/occurrence/);
});

function setup(t,kind="quarter",ids=["GDP"]) {
  const source=buildSourceRegistry(loadConfig({})).all.find(s=>s.id==="bls-cpi-release");
  const group="fixture",meta={source_id:source.id,calendar_source_id:source.id,host:"www.bls.gov",period_kind:kind,...(kind==="week"?{week_convention:"ending_saturday"}:{})};
  const indicators=ids.map((id,n)=>({id,release_group:group,source_id:source.id,name:id,unit:"percent",transformation:"qoq_annualized",seasonal_adjustment:"SA",period_kind:kind,release_period_offset:kind==="week"?-n:0}));
  const store=openAtlasStore(":memory:",{macroCatalog:{groups:{[group]:meta},indicators}});t.after(()=>store.close());store.registerSources([source]);
  for(const i of indicators)store.db.prepare("INSERT INTO macro_indicators VALUES(?,?,?)").run(i.id,group,JSON.stringify(i));
  const caps=createMacroCapabilities({store,clock:()=>new Date("2026-12-01T00:00:00.000Z")},class extends Error {constructor(status,code,message){super(message);this.status=status;}});
  function ingest({key="2026-Q2",stage="advance",at="2026-07-30T12:30:00.000Z",observations,extra={},artifacts}={}) {
    const release={id:buildReleaseId("US",group,kind,key,stage),release_group:group,reference_period:key,period_kind:kind,release_stage:stage,source_published_at:at,release_url:"https://www.bls.gov/fixture",timestamp_semantics:"official_publication_time",...extra};
    const runId=store.beginSourceRun(source,at,{}),rawId=randomUUID();
    const rawFetchIds=store.saveRawFetches(runId,source.id,[{id:rawId,request_url:release.release_url,http_status:200,content_type:"text/html",etag:null,last_modified:null,content_hash:"fixture-hash",payload_text:"fixture",payload_truncated:0}],at);
    const batch={kind:"release",release,observations:(observations||[{indicator_id:ids[0],reference_period:key,actual:3}]).map(o=>({preliminary:false,source_column:"fixture",raw_fetch_index:0,source_url:release.release_url,...o})),...(artifacts?{artifacts}: {})};
    store.saveMacroBatch(batch,{sourceId:source.id,runId,rawFetchIds,fetchedAt:at,persistedAt:new Date(Date.parse(at)+1000).toISOString()});return release;
  }
  return {store,caps,ingest,meta,indicators,source};
}

test("equal GDP estimates remain distinct vintages, third is not final, reads do not write",t=>{
  const {store,caps,ingest}=setup(t);
  const first=ingest(),second=ingest({stage:"second",at:"2026-08-27T12:30:00.000Z"});
  const third=ingest({stage:"third",at:"2026-09-24T12:30:00.000Z"});
  ingest({stage:"third",at:"2026-09-24T12:30:00.000Z"});
  assert.equal(store.macro.maxSequence(),3);
  const changes=store.db.prepare("SELECT total_changes() n").get().n;
  const history=caps.macroObservations({group:"fixture",reference_period:"2026-Q2",history:true}).data;
  assert.deepEqual(history.map(o=>o.estimate_stage),["third","second","advance"]);
  assert.equal(history[0].finality,"unspecified");assert.equal(history[0].persisted_at,"2026-09-24T12:30:01.000Z");
  assert.equal(caps.macroRelease({release_id:first.id}).data.observations[0].release_id,first.id);
  assert.equal(caps.macroRelease({release_id:second.id}).data.acquisition_status,"complete");
  assert.equal(store.macro.latestDue("fixture","2026-12-01T00:00:00.000Z").id,third.id);
  assert.equal(store.db.prepare("SELECT total_changes() n").get().n,changes);
  assert.equal(caps.macroObservations({group:"fixture",as_of:"2026-08-01"}).data[0].estimate_stage,"advance");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("weekly release completeness binds separate initial and continuing periods, freezes required list",t=>{
  const {store,caps,ingest,indicators}=setup(t,"week",["INITIAL","CONTINUING","OPTIONAL"]);
  indicators[2].required_for_release_complete=false;
  const r=ingest({key:"2026-09-05",stage:"not_applicable",at:"2026-09-10T12:30:00.000Z",observations:[{indicator_id:"INITIAL",reference_period:"2026-09-05",actual:0}]});
  assert.equal(caps.macroRelease({release_id:r.id}).data.acquisition_status,"partial");
  indicators.push({...indicators[0],id:"FUTURE_REQUIRED"});
  ingest({key:"2026-09-05",stage:"not_applicable",at:"2026-09-10T12:30:00.000Z",observations:[{indicator_id:"CONTINUING",reference_period:"2026-08-29",actual:100}]});
  const result=caps.macroRelease({release_id:r.id}).data;
  assert.equal(result.acquisition_status,"complete");assert.equal(result.expected_indicator_count,2);
  assert.deepEqual(result.optional_missing,["OPTIONAL"]);
  assert.deepEqual(result.observations.map(o=>o.reference_period).sort(),["2026-08-29","2026-09-05"]);
  assert.equal(caps.macroObservations({group:"fixture",reference_period:"2026-08-29"}).data.length,1);
});

test("event keys, effective time and linked artifacts are distinct from release publication",t=>{
  const {store,caps,ingest}=setup(t,"event",["RATE"]);
  const options={key:"meeting-september",stage:"not_applicable",at:"2026-09-16T18:00:00.000Z",extra:{period_start:"2026-09-15",period_end:"2026-09-17",effective_at:"2026-09-17T00:00:00.000Z",provider_published_at:"2026-09-16T18:00:00.000Z"},artifacts:[{artifact_type:"statement",source_url:"https://www.bls.gov/fixture",raw_fetch_index:0}]};
  const r=ingest(options);ingest(options);
  const result=caps.macroRelease({release_id:r.id}).data;
  assert.equal(result.artifacts.length,1);assert.notEqual(result.effective_at,result.released_at);
  assert.equal(caps.macroObservations({group:"fixture",reference_period:"meeting-september"}).data[0].previous,null);
  assert.throws(()=>ingest({...options,artifacts:[{artifact_type:"minutes",source_url:"https://www.bls.gov/other",raw_fetch_index:0}]}),/lineage/);
  assert.equal(store.db.prepare("SELECT count(*) n FROM macro_artifacts").get().n,1);
});

test("watch entry is durable and does not bypass failure backoff",t=>{
  const {store,source,meta,indicators}=setup(t);
  meta.watch={before_ms:300000,after_ms:900000,poll_ms:30000};
  const r={id:"US_FIXTURE_2026-Q3_ADVANCE",release_group:"fixture",reference_period:"2026-Q3",period_kind:"quarter",release_stage:"advance"};
  const p=period("quarter","2026-Q3"),scheduled="2026-10-29T12:30:00.000Z";
  store.db.prepare("INSERT INTO macro_releases(id,release_group,reference_period,period_kind,period_key,period_start,period_end,release_stage,scheduled_at,requirements_json) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(r.id,r.release_group,r.reference_period,p.period_kind,p.period_key,p.period_start,p.period_end,r.release_stage,scheduled,JSON.stringify(buildRequirements(r,indicators,meta)));
  const normal="2026-10-29T18:00:00.000Z";
  store.initializeScheduleState([{...source,enabled:true}],{now:"2026-10-29T12:00:00.000Z"});
  store.db.prepare("UPDATE source_schedule_state SET consecutive_failures=1,next_due_at=?,backoff_until=? WHERE source_id=?").run(normal,normal,source.id);
  const registry={enabled:[{...source,macroGroup:"fixture"}]};
  wakeMacroSchedules(store,registry,"2026-10-29T12:24:00.000Z");assert.equal(store.db.prepare("SELECT count(*) n FROM macro_watch_windows").get().n,0);
  wakeMacroSchedules(store,registry,"2026-10-29T12:25:00.000Z");wakeMacroSchedules(store,registry,"2026-10-29T12:26:00.000Z");
  const rows=store.db.prepare("SELECT * FROM macro_watch_windows").all();assert.equal(rows.length,1);assert.equal(rows[0].watch_started_at,"2026-10-29T12:25:00.000Z");
  assert.equal(JSON.parse(rows[0].schedule_before_json).consecutive_failures,1);assert.equal(store.getScheduleState(source.id).next_due_at,normal);
});

test("backend display semantics retain native units and zero",()=>{
  const definition={name:"Claims",unit:"thousands_persons",transformation:"level",seasonal_adjustment:"SA"},semantics=displaySemantics(definition);
  assert.equal(valueLabel(0,definition.unit,semantics),"0 千人");assert.equal(valueLabel(null,definition.unit,semantics),"未取得");
  assert.equal(basisLabel({...definition,display_semantics:semantics}),"水準 · 季調");
  assert.equal(releaseCoverage({requirements_json:'{"version":1,"indicators":[]}'},[]).status,"unknown");
});

test("migration preserves populated legacy identities, restores FK enforcement and rolls back failure",()=>{
  for(const invalid of [false,true]) {
    const db=new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON; CREATE TABLE sources(id TEXT PRIMARY KEY); CREATE TABLE documents(id TEXT PRIMARY KEY); CREATE TABLE source_runs(id TEXT PRIMARY KEY); CREATE TABLE raw_fetches(id TEXT PRIMARY KEY); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT);");
      migrateMacroV9(db,"2026-09-12T00:00:00.000Z");
      db.prepare("INSERT INTO macro_releases(id,release_group,reference_period) VALUES(?,?,?)").run("US_CPI_2026-08",invalid?"unknown":"cpi","2026-08");
      if(invalid) {
        assert.throws(()=>migrateMacroV10(db,"2026-09-12T01:00:00.000Z"),/Unknown legacy/);
        assert.equal(db.prepare("SELECT max(version) n FROM schema_migrations").get().n,9);
        assert.ok(!db.prepare("PRAGMA table_info(macro_releases)").all().some(c=>c.name==="period_kind"));
      }else {
        migrateMacroV10(db,"2026-09-12T01:00:00.000Z");migrateMacroV10(db,"2026-09-12T02:00:00.000Z");
        const row=db.prepare("SELECT * FROM macro_releases").get();assert.equal(row.id,"US_CPI_2026-08");assert.equal(row.period_end,"2026-09-01");assert.equal(row.persisted_at,null);
      }
      assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys,1);
      assert.equal(db.isTransaction,false);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    }finally{db.close();}
  }
});
