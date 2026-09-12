import { buildTargetIdentityContext, relevanceMetadata, NEWS_SOURCE, NEWS_MATCH_VERSION } from "./companyNewsRelevance.js";
import { resolveDocumentEntities } from "./resolve.js";
import { mergeDocumentMetadata } from "../atlasStore.js";

export function planCompanyNewsRemediation(store, { limit = 1000 } = {}) {
  const rows = store.db.prepare("SELECT id, source_run_id, raw_fetch_id FROM documents WHERE source_id = ? ORDER BY id LIMIT ?").all(NEWS_SOURCE, limit + 1);
  if (rows.length > limit) throw new Error(`Remediation exceeds explicit document limit ${limit}`);
  const changes = [];
  const identities = new Map();
  for (const row of rows) {
    const document = store.getDocument(row.id, true);
    const before = document.raw_metadata || {};
    let after = before;
    const scopes = [...new Set(before.discovery_targets || [])];
    for (const scope of scopes) {
      if (!/^(TWSE|TPEX):[A-Z0-9]{4,12}$/.test(scope)) continue;
      const [authority, value] = scope.split(":");
      const target = { identifier: { namespace: "ticker", authority, scope: authority, value } };
      if (!identities.has(scope)) identities.set(scope, buildTargetIdentityContext(store, target));
      after = mergeDocumentMetadata(after, relevanceMetadata(document, target, identities.get(scope)), NEWS_SOURCE);
    }
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    changes.push({ document_id: document.id, title: document.title,
      before, after, before_mentions: store.db.prepare("SELECT entity_id, method, confidence FROM document_entity_mentions WHERE document_id = ?").all(document.id),
      lineage: { sourceId: document.source_id, sourceRunId: row.source_run_id, rawFetchId: row.raw_fetch_id } });
  }
  return { version: NEWS_MATCH_VERSION, scanned: rows.length, changes };
}

export function applyCompanyNewsRemediation(store, plan, now = new Date().toISOString()) {
  return store.transaction(() => {
    const stories = new Set();
    for (const change of plan.changes) {
      const document = store.getDocument(change.document_id, true);
      if (JSON.stringify(document.raw_metadata || {}) !== JSON.stringify(change.before)) throw new Error("Remediation plan is stale; rerun dry-run");
      store.db.prepare("UPDATE documents SET raw_metadata_json = ? WHERE id = ? AND source_id = ?")
        .run(JSON.stringify(change.after), change.document_id, NEWS_SOURCE);
      resolveDocumentEntities(store, { ...document, raw_metadata: change.after }, change.lineage, now);
      for (const row of store.db.prepare("SELECT story_id FROM story_documents WHERE document_id = ?").all(change.document_id)) stories.add(row.story_id);
    }
    for (const story of stories) store.refreshStoryEntityLinks(story, now);
    // Old feed-success timestamps are not entity matches. Recompute solely from
    // existing validated observations, never use remediation time as freshness.
    for (const target of store.listSourceTargets(NEWS_SOURCE)) {
      const scope = `${target.identifier.authority}:${target.identifier.value}`;
      const documents = store.db.prepare(`SELECT d.raw_metadata_json, MAX(r.finished_at) AS observed_at
        FROM document_observations o JOIN documents d ON d.id = o.document_id
        JOIN source_target_runs r ON r.source_run_id = o.source_run_id AND r.source_target_id = o.source_target_id
        WHERE o.source_target_id = ? AND d.source_id = ? GROUP BY d.id`).all(target.id, NEWS_SOURCE);
      const matches = documents.filter(row => JSON.parse(row.raw_metadata_json).target_relevance?.[scope]?.status === "matched");
      const last = matches.map(row => row.observed_at).filter(Boolean).sort().at(-1) || null;
      store.db.prepare("UPDATE source_targets SET last_match_at = ? WHERE id = ?").run(last, target.id);
    }
    return { updated: plan.changes.length, refreshed_stories: stories.size };
  });
}
