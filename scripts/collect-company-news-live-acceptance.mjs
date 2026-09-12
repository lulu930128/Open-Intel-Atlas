import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAtlasRuntime } from "../src/atlasServer.js";
import { loadConfig } from "../src/config.js";

const SOURCE_IDS = Object.freeze([
  "twse-company-master",
  "tpex-company-master",
  "tpex-emerging-company-master",
  "yahoo-tw-stock-news"
]);

const root = fileURLToPath(new URL("..", import.meta.url));
const databasePath = resolve(root, process.argv[2] || "data/runtime/company-news-live-acceptance/atlas.sqlite");
const relativePath = relative(root, databasePath);

if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath === "") {
  fail("Acceptance database must be a new file below the repository root.");
}
if (existsSync(databasePath)) fail(`Refusing to overwrite an existing acceptance database: ${databasePath}`);

const config = loadConfig({
  ...process.env,
  ATLAS_AUTO_COLLECT: "false",
  ATLAS_COLLECT_ON_START: "false",
  ATLAS_CONTENT_USAGE_CONTEXT: "personal_noncommercial",
  ATLAS_DB_PATH: databasePath
});
const runtime = createAtlasRuntime({ config });
const results = [];

try {
  for (const sourceId of SOURCE_IDS) {
    results.push(await runtime.collector.runSource(sourceId, { reason: "company_news_live_acceptance" }));
  }
  const targets = runtime.store.listSourceTargets("yahoo-tw-stock-news");
  const yahooDocuments = Number(runtime.store.db.prepare("SELECT COUNT(*) count FROM documents WHERE source_id = 'yahoo-tw-stock-news'").get().count);
  const yahooObservations = Number(runtime.store.db.prepare("SELECT COUNT(*) count FROM document_observations WHERE source_id = 'yahoo-tw-stock-news'").get().count);
  const yahooEvents = Number(runtime.store.db.prepare(`
    SELECT COUNT(DISTINCT evidence.event_id) count
    FROM event_evidence evidence JOIN documents document ON document.id = evidence.document_id
    WHERE document.source_id = 'yahoo-tw-stock-news'
  `).get().count);
  const failures = results.filter((result) => result.status !== "success");
  const targetFailures = targets.filter((target) => target.last_outcome !== "success");
  const output = {
    ok: failures.length === 0 && targetFailures.length === 0 && yahooDocuments > 0 && yahooObservations > 0 && yahooEvents === 0,
    database_path: databasePath,
    source_results: results,
    yahoo: {
      document_count: yahooDocuments,
      observation_count: yahooObservations,
      event_count: yahooEvents,
      targets: targets.map((target) => ({
        id: target.id,
        status: target.last_outcome,
        last_success_at: target.last_success_at,
        last_match_at: target.last_match_at
      }))
    },
    storage: runtime.store.getStats()
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
} finally {
  await runtime.close();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
