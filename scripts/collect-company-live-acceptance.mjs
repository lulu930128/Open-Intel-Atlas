import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const SOURCE_IDS = Object.freeze([
  "twse-company-master",
  "tpex-company-master",
  "tpex-emerging-company-master",
  "twse-material-info",
  "tpex-material-info"
]);

const root = fileURLToPath(new URL("..", import.meta.url));
const databasePath = resolve(root, process.argv[2] || "data/runtime/company-live-acceptance/atlas.sqlite");
const relativePath = relative(root, databasePath);

if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath === "") {
  fail("Acceptance database must be a new file below the repository root.");
}
if (existsSync(databasePath)) {
  fail(`Refusing to overwrite an existing acceptance database: ${databasePath}`);
}

const config = loadConfig({
  ...process.env,
  ATLAS_AUTO_COLLECT: "false",
  ATLAS_COLLECT_ON_START: "false",
  ATLAS_DB_PATH: databasePath
});
const runtime = createAtlasRuntime({ config });
const results = [];

try {
  for (const sourceId of SOURCE_IDS) {
    results.push(await runtime.collector.runSource(sourceId, { reason: "company_live_acceptance" }));
  }

  const failures = results.filter((result) => result.status !== "success");
  process.stdout.write(`${JSON.stringify({
    ok: failures.length === 0,
    database_path: databasePath,
    source_results: results,
    storage: runtime.store.getStats()
  }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await runtime.close();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
