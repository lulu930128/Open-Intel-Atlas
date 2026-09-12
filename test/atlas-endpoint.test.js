import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

test("readiness publication, isolated opt-in, restart and old shutdown cannot overwrite successor", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-endpoint-"));
  const statePath = join(root, "runtime", "endpoint.json");
  const runtimes = [];
  const start = async (publish) => {
    const config = loadConfig({ ATLAS_DB_PATH: ":memory:", ATLAS_AUTO_COLLECT: "false", ATLAS_COLLECT_ON_START: "false" });
    config.dbPath = ":memory:";
    config.port = 0;
    const runtime = createAtlasRuntime({ config, registry: { all: [], enabled: [], get: () => null },
      endpointStatePath: publish ? statePath : undefined });
    runtimes.push(runtime);
    await runtime.listen();
    return runtime;
  };
  try {
    const first = await start(true);
    const before = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(before.status, "running");
    assert.equal(before.pid, process.pid);
    assert.match(before.source_fingerprint.digest, /^[a-f0-9]{64}$/);
    assert.equal(before.source_fingerprint.scope, "atlas-backend-and-macro-ui-v1");
    const live = await (await fetch(before.base_url + "/api/v1/runtime")).json();
    assert.deepEqual(live, before);
    await start(false);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), before);
    await start(true);
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.notEqual(after.instance_id, before.instance_id);
    assert.notEqual(after.base_url, before.base_url);
    assert.equal(after.installation_id, before.installation_id);
    await first.close();
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), after);
  } finally {
    await Promise.all(runtimes.map(runtime => runtime.close()));
    await rm(root, { recursive: true, force: true });
  }
});

test("custom databases do not implicitly publish formal discovery", () => {
  assert.equal(loadConfig({ ATLAS_DB_PATH: "test.sqlite" }).endpointStatePath, null);
  assert.ok(loadConfig({}).endpointStatePath.endsWith("atlas-endpoint.json"));
});
