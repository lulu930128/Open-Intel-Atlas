import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.argv[2] || "data/runtime/company-news-live-acceptance/atlas.sqlite");
const database = new DatabaseSync(databasePath, { readOnly: true });
const REQUIRED_CANARY_TARGETS = new Set([
  "yahoo-tw-stock-news:TWSE:2330",
  "yahoo-tw-stock-news:TWSE:2317",
  "yahoo-tw-stock-news:TWSE:2454",
  "yahoo-tw-stock-news:TWSE:3035",
  "yahoo-tw-stock-news:TPEX:6488"
]);

try {
  const scalar = (sql, ...values) => Number(database.prepare(sql).get(...values).count || 0);
  const targetRows = database.prepare(`
    SELECT target.id, target.identifier_authority, target.identifier_value,
      target.last_outcome, target.last_success_at, target.last_match_at,
      COUNT(DISTINCT observation.document_id) AS document_count
    FROM source_targets target
    LEFT JOIN document_observations observation ON observation.source_target_id = target.id
    WHERE target.source_id = 'yahoo-tw-stock-news'
    GROUP BY target.id ORDER BY target.priority_tier, target.id
  `).all().map((row) => ({ ...row, document_count: Number(row.document_count || 0) }));
  const result = {
    database: databasePath,
    schema_version: Number(database.prepare("SELECT MAX(version) version FROM schema_migrations").get().version),
    targets: targetRows,
    yahoo_documents: scalar("SELECT COUNT(*) count FROM documents WHERE source_id = 'yahoo-tw-stock-news'"),
    yahoo_observations: scalar("SELECT COUNT(*) count FROM document_observations WHERE source_id = 'yahoo-tw-stock-news'"),
    yahoo_company_mentions: scalar(`
      SELECT COUNT(DISTINCT mention.document_id || ':' || mention.entity_id) count
      FROM document_entity_mentions mention
      JOIN documents document ON document.id = mention.document_id
      JOIN entities entity ON entity.id = mention.entity_id
      WHERE document.source_id = 'yahoo-tw-stock-news' AND entity.entity_type = 'company'
    `),
    promoted_events: scalar(`
      SELECT COUNT(DISTINCT evidence.event_id) count
      FROM event_evidence evidence JOIN documents document ON document.id = evidence.document_id
      WHERE document.source_id = 'yahoo-tw-stock-news'
    `),
    non_unknown_publishers: scalar("SELECT COUNT(*) count FROM documents WHERE source_id = 'yahoo-tw-stock-news' AND publisher_key <> 'unknown'"),
    stored_body_excerpts: scalar("SELECT COUNT(*) count FROM documents WHERE source_id = 'yahoo-tw-stock-news' AND body_excerpt IS NOT NULL"),
    orphan_observations: scalar(`
      SELECT COUNT(*) count FROM document_observations observation
      LEFT JOIN documents document ON document.id = observation.document_id
      LEFT JOIN sources source ON source.id = observation.source_id
      WHERE document.id IS NULL OR source.id IS NULL
    `),
    sqlite_integrity: String(database.prepare("PRAGMA integrity_check").get().integrity_check)
  };
  result.canary_targets = result.targets.filter((target) => REQUIRED_CANARY_TARGETS.has(target.id));
  result.ok = result.schema_version === 11
    && result.canary_targets.length === REQUIRED_CANARY_TARGETS.size
    && result.canary_targets.every((target) => target.last_outcome === "success" && target.last_success_at && target.document_count > 0)
    && result.yahoo_documents > 0
    && result.yahoo_observations >= result.yahoo_documents
    && result.yahoo_company_mentions > 0
    && result.promoted_events === 0
    && result.non_unknown_publishers === 0
    && result.stored_body_excerpts === 0
    && result.orphan_observations === 0
    && result.sqlite_integrity === "ok";
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  database.close();
}
