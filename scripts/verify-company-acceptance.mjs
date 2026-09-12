import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.argv[2] || "data/runtime/company-acceptance-v2/atlas.sqlite");
const database = new DatabaseSync(databasePath, { readOnly: true });

try {
  const count = (sql) => Number(database.prepare(sql).get().count || 0);
  const result = {
    database: databasePath,
    entities: count("SELECT COUNT(*) count FROM entities"),
    identifiers: count("SELECT COUNT(*) count FROM entity_identifiers"),
    relations: count("SELECT COUNT(*) count FROM entity_relations"),
    snapshots: count("SELECT COUNT(*) count FROM entity_master_snapshots"),
    mentions: count("SELECT COUNT(*) count FROM document_entity_mentions"),
    story_links: count("SELECT COUNT(*) count FROM story_entity_links"),
    orphan_identifiers: count("SELECT COUNT(*) count FROM entity_identifiers i LEFT JOIN entities e ON e.id = i.entity_id WHERE e.id IS NULL"),
    orphan_relations: count("SELECT COUNT(*) count FROM entity_relations r LEFT JOIN entities f ON f.id = r.from_entity_id LEFT JOIN entities t ON t.id = r.to_entity_id WHERE f.id IS NULL OR t.id IS NULL"),
    orphan_mentions: count("SELECT COUNT(*) count FROM document_entity_mentions m LEFT JOIN entities e ON e.id = m.entity_id LEFT JOIN documents d ON d.id = m.document_id WHERE e.id IS NULL OR d.id IS NULL"),
    orphan_story_entity_links: count("SELECT COUNT(*) count FROM story_entity_links l LEFT JOIN stories s ON s.id = l.story_id LEFT JOIN entities e ON e.id = l.entity_id WHERE s.id IS NULL OR e.id IS NULL"),
    orphan_snapshot_members: count("SELECT COUNT(*) count FROM entity_master_snapshot_members m LEFT JOIN entity_master_snapshots s ON s.id = m.snapshot_id LEFT JOIN entities e ON e.id = m.entity_id WHERE s.id IS NULL OR e.id IS NULL"),
    invalid_complete_snapshots: count(`
      SELECT COUNT(*) count FROM entity_master_snapshots snapshot
      JOIN source_runs run ON run.id = snapshot.source_run_id
      WHERE snapshot.snapshot_complete = 1 AND (
        snapshot.status <> 'complete' OR snapshot.truncated <> 0 OR snapshot.member_count = 0
        OR snapshot.member_count <> (SELECT COUNT(*) FROM entity_master_snapshot_members member WHERE member.snapshot_id = snapshot.id)
        OR run.status <> 'success' OR run.failed_count <> 0 OR run.truncated <> 0
      )
    `),
    duplicate_active_identifiers: count("SELECT COUNT(*) count FROM (SELECT namespace, authority, scope, normalized_value FROM entity_identifiers WHERE status = 'active' GROUP BY namespace, authority, scope, normalized_value HAVING COUNT(*) > 1)")
  };
  const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
  result.sqlite_integrity = integrity;
  result.ok = integrity === "ok" && [
    result.orphan_identifiers,
    result.orphan_relations,
    result.orphan_mentions,
    result.orphan_story_entity_links,
    result.orphan_snapshot_members,
    result.invalid_complete_snapshots,
    result.duplicate_active_identifiers
  ].every((value) => value === 0);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  database.close();
}
