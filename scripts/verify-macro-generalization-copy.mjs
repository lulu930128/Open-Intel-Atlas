// Online backup and isolated migration proof; never opens the formal DB for writes.
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { SCHEMA_VERSION } from "../src/atlasSchema.js";
import { createMacroCapabilities } from "../src/macro/capabilities.js";
const config=loadConfig(),stamp=new Date().toISOString().replace(/[:.]/g,"-");
const directory=resolve("data/db/backups",`macro-generalization-${stamp}`);
mkdirSync(directory,{recursive:true});
const original=new DatabaseSync(config.dbPath,{readOnly:true});
try{await backup(original,join(directory,"atlas.sqlite"));}finally{original.close();}
copyFileSync(resolve(".env"),join(directory,"original.env"));
const old=new DatabaseSync(join(directory,"atlas.sqlite"),{readOnly:true});
const tables=["macro_indicators","macro_releases","macro_observations","macro_calendar_versions","macro_release_observations"];
const columns=Object.fromEntries(tables.map(table=>[table,old.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name)]));
const indicatorIds=new Set(old.prepare("SELECT id FROM macro_indicators").all().map(r=>r.id));
const digest=(db,table)=>createHash("sha256").update(JSON.stringify(db.prepare(`SELECT ${columns[table].join(",")} FROM ${table} ORDER BY ${columns[table][0]}`).all().filter(r=>table!=="macro_indicators"||indicatorIds.has(r.id)))).digest("hex");
const before=Object.fromEntries(tables.map(table=>[table,{count:old.prepare(`SELECT count(*) n FROM ${table}`).get().n,digest:digest(old,table)}]));
const oldVersion=old.prepare("SELECT max(version) n FROM schema_migrations").get().n;
assert.equal(old.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
assert.deepEqual(old.prepare("PRAGMA foreign_key_check").all(),[]);old.close();
const copyPath=join(directory,"migration-copy.sqlite");copyFileSync(join(directory,"atlas.sqlite"),copyPath);
const store=openAtlasStore(copyPath);
try {
  for(const table of tables)assert.equal(digest(store.db,table),before[table].digest,`${table} legacy values changed`);
  assert.equal(store.getStats().schema_version,SCHEMA_VERSION);
  assert.equal(store.db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(),[]);
  const caps=createMacroCapabilities({store},class extends Error{});
  const groups=["cpi","ppi","pce"].map(group=>{const r=store.macro.latestDue(group,new Date().toISOString());const data=caps.macroRelease({release_id:r.id}).data;return {group,release_id:r.id,acquisition_status:data.acquisition_status,count:data.observations.length};});
  assert.ok(groups.every(g=>g.acquisition_status==="complete"));
  const report={created_at:new Date().toISOString(),directory,copyPath,source_schema:oldVersion,target_schema:SCHEMA_VERSION,legacy_tables:before,legacy_values_preserved:true,integrity:"ok",foreign_key_violations:0,groups,
    runtime_before:JSON.parse(readFileSync("data/runtime/atlas-endpoint.json","utf8")),formal_adoption:false};
  writeFileSync(join(directory,"manifest.json"),JSON.stringify(report,null,2),{flag:"wx"});
  writeFileSync("data/runtime/macro-generalization-backup.json",JSON.stringify({directory},null,2));
  console.log(JSON.stringify(report,null,2));
}finally{store.close();}
