// --copy uses an online backup and an isolated, provider-disabled runtime.
// --formal only reads the current runtime/database; it does not restart or collect.
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { sourceFingerprint } from "../src/atlasSourceFingerprint.js";
import { verifyMacroParity } from "./lib/macro-parity.mjs";

const mode = process.argv[2];
assert.ok(["--copy", "--formal"].includes(mode), "Usage: node --env-file-if-exists=.env scripts/verify-macro-closeout.mjs --copy|--formal [legacy-backup.sqlite]");
const config = loadConfig();
const output = resolve("data/runtime", `macro-closeout-${mode.slice(2)}-${new Date().toISOString().replace(/[:.]/g,"-")}`);
mkdirSync(output, { recursive: true });
const source = new DatabaseSync(config.dbPath, { readOnly: true });
const report = { mode, ok: false, source_fingerprint: sourceFingerprint(config.rootDir), projections: [], release_window_latency_verified: false };
let runtime, db = source;
try {
  let base;
  if (mode === "--copy") {
    const path = join(output, "atlas.sqlite");
    await backup(source, path);
    config.dbPath = path; config.port = 0;
    config.collector.schedulerEnabled = false; config.collector.collectOnStart = false;
    // Explicitly inject a scheduler and throwing HTTP surface: reads cannot hide I/O.
    runtime = createAtlasRuntime({ config, endpointStatePath: null,
      scheduler: { async stop() {} },
      http: { async getText() { throw Error("Provider I/O forbidden during closeout"); }, async getBytes() { throw Error("Provider I/O forbidden during closeout"); } }
    });
    db = runtime.store.db;
    base = `http://127.0.0.1:${(await runtime.listen()).port}`;
  } else {
    const endpoint = JSON.parse(readFileSync(config.endpointStatePath, "utf8"));
    const url = new URL(endpoint.base_url);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    base = endpoint.base_url;
    report.runtime = await (await fetch(`${base}/api/v1/runtime`)).json();
    assert.equal(report.runtime.pid, endpoint.pid);
    assert.deepEqual(report.runtime.source_fingerprint, report.source_fingerprint, "Runtime source differs from verification tree");
  }
  const stats = () => ({ runs: db.prepare("SELECT count(*) n FROM source_runs").get().n,
    observations: db.prepare("SELECT count(*) n FROM macro_observations").get().n,
    changes: mode === "--copy" ? db.prepare("SELECT total_changes() n").get().n : null });
  const before = stats();
  report.groups = [];
  const today = new Date().toISOString().slice(0,10);
  const range = { from: today, to: new Date(Date.parse(today)+30*86400000).toISOString().slice(0,10) };
  for (const group of ["cpi","ppi","pce","employment","gdp","claims","fomc"]) {
    const obs = await (await fetch(`${base}/api/v1/macro/observations?group=${group}`)).json();
    const id = obs.coverage.groups[0].expected_release_id;
    assert.ok(id, `${group} expected release`);
    const projections = await verifyMacroParity(base, group, id, range);
    const release = projections.find(p=>p.tool === "release").rest;
    assert.equal(release.data.acquisition_status, "complete", `${group} complete`);
    assert.equal(release.freshness.status, "current", `${group} current`);
    report.groups.push({ group, release_id: id, complete: true, current: true });
    report.projections.push(...projections);
  }
  const after = stats(); assert.deepEqual(after, before, "State changed during read validation; retry during an idle interval");
  report.read_only = { source_runs_unchanged: true, observations_unchanged: true,
    owning_connection_total_changes_unchanged: mode === "--copy" ? true : null,
    semantics: mode === "--copy" ? "isolated_owner_connection_provider_forbidden" : "formal_read_snapshot_not_owner_total_changes" };
  report.schema = db.prepare("SELECT max(version) n FROM schema_migrations").get().n;
  assert.equal(report.schema, 11);
  report.indicators = db.prepare("SELECT count(*) n FROM macro_indicators").get().n;
  assert.equal(report.indicators, 39);
  report.observations = after.observations;
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  report.foreign_key_violations = 0;
  if (process.argv[3]) {
    const old = new DatabaseSync(resolve(process.argv[3]), { readOnly: true });
    try {
      const rows = old.prepare("SELECT * FROM macro_observations").all();
      for (const row of rows) assert.deepEqual(db.prepare("SELECT * FROM macro_observations WHERE id=?").get(row.id), row);
      report.legacy_observations_preserved = rows.length;
    } finally { old.close(); }
  }
  report.ok = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  report.checked_at = new Date().toISOString();
  writeFileSync(join(output,"proof.json"), JSON.stringify(report,null,2));
  if (runtime) await runtime.close();
  source.close();
  console.log(JSON.stringify({ output, ok: report.ok, error: report.error, groups: report.groups, read_only: report.read_only }));
}
