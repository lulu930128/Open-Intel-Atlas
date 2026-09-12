import { rebuildEventForStory } from "./atlasEvents.js";
import { attachDocumentToStory } from "./atlasStories.js";
import { normalizeEntityMaster, normalizeEntityRelation } from "./entities/normalize.js";
import { resolveDocumentEntities } from "./entities/resolve.js";

export function processSourceResult(store, runId, result, now = new Date().toISOString()) {
  if (result.macro_batch) {
    return store.transaction(() => {
      const rawFetchIds = store.saveRawFetches(runId, result.source_id, result.fetches, result.finished_at || now);
      let evidenceDocumentId = null;
      for (const document of result.documents || []) {
        const rawIndex = document.raw_metadata?.raw_fetch_index ?? 0;
        const savedDocument = store.upsertDocument(document, runId, rawFetchIds[rawIndex] || null, now);
        evidenceDocumentId = savedDocument.document.id;
      }
      const saved = store.saveMacroBatch(result.macro_batch, {
        sourceId: result.source_id, runId, rawFetchIds, fetchedAt: result.finished_at || now, persistedAt: now, evidenceDocumentId
      });
      return { ...saved, itemCount: result.counts.processed_item_count, processedItemCount: result.counts.processed_item_count,
        failedItemCount: result.counts.failed_count, status: result.status, completeness: result.completeness,
        warnings: result.warnings, eventCount: 0, entityCount: 0, relationCount: 0, snapshotId: null,
        httpStatus: result.fetches.find((f) => f.http_status)?.http_status ?? null };
    });
  }
  const rawFetchIds = store.saveRawFetches(runId, result.source_id, result.fetches, result.finished_at || now);
  let insertedCount = 0;
  let updatedCount = 0;
  let eventCount = 0;
  let processedItemCount = result.counts?.processed_item_count ?? result.documents?.length ?? 0;
  let failedItemCount = result.counts?.failed_count ?? 0;
  let resultStatus = result.status;
  let completeness = { ...(result.completeness || {}) };
  const warnings = [...(result.warnings || [])];

  let structured = { entityIds: [], relationCount: 0, snapshotId: null };
  if (Array.isArray(result.master_items)) {
    const entityIds = new Set();
    const relationIds = new Set();
    const members = [];
    let persistenceFailures = 0;
    for (const [index, item] of result.master_items.entries()) {
      const entities = item.entities.map((entity) => normalizeEntityMaster(entity, result.source_id));
      const relations = item.relations.map(normalizeEntityRelation);
      try {
        store.ingestEntityMasterItem({
          entities,
          relations,
          sourceId: result.source_id,
          sourceRunId: runId,
          rawFetchIds
        }, result.finished_at || now);
        for (const entity of entities) {
          entityIds.add(entity.id);
          members.push({ entityId: entity.id, identifierId: entity.identifiers?.[0]?.id || null });
        }
        for (const relation of relations) relationIds.add(relation.id);
      } catch (error) {
        persistenceFailures += 1;
        warnings.push(`entity_master_item_persistence_failed:${String(item.key || index).slice(0, 120)}`);
      }
    }
    processedItemCount = Math.max(0, processedItemCount - persistenceFailures);
    failedItemCount += persistenceFailures;
    if (persistenceFailures > 0) {
      resultStatus = "partial";
      completeness = { ...completeness, status: "partial", snapshot_complete: false };
    }
    const snapshotId = store.finalizeEntityMasterSnapshot({
      sourceId: result.source_id,
      sourceRunId: runId,
      members,
      completeness: {
        ...completeness,
        upstream_item_count: result.counts?.upstream_item_count ?? null
      },
      warnings
    }, result.finished_at || now);
    structured = { entityIds: [...entityIds], relationCount: relationIds.size, snapshotId };
  } else {
    const entities = (result.entities || []).map((entity) => normalizeEntityMaster(entity, result.source_id));
    const relations = (result.relations || []).map(normalizeEntityRelation);
    if (entities.length > 0 || relations.length > 0) {
    structured = store.ingestEntityMaster({
      entities,
      relations,
      sourceId: result.source_id,
      sourceRunId: runId,
      rawFetchIds,
      completeness: {
        ...(result.completeness || {}),
        upstream_item_count: result.counts?.upstream_item_count ?? null
      },
      warnings: result.warnings || []
    }, result.finished_at || now);
    }
  }

  for (const document of result.documents || []) {
    const rawFetchIndex = Number(document.raw_metadata?.raw_fetch_index);
    const rawFetchId = Number.isInteger(rawFetchIndex) && rawFetchIndex >= 0 ? rawFetchIds[rawFetchIndex] : rawFetchIds[0];
    const saved = store.upsertDocument(document, runId, rawFetchId || null, now);
    if (saved.inserted) insertedCount += 1;
    else updatedCount += 1;

    store.saveDocumentObservation(saved.document.id, {
      sourceId: result.source_id,
      sourceRunId: runId,
      rawFetchId: rawFetchId || null,
      sourceTargetId: document.raw_metadata?.source_target_id || null,
      discoveredUrl: document.raw_metadata?.discovered_url || document.canonical_url || null,
      observedAt: document.observed_at || document.fetched_at || now,
      metadata: {
        discovery_provider: document.raw_metadata?.discovery_provider || null,
        provider_query_scope: document.raw_metadata?.provider_query_scope || null
      }
    }, now);

    if (saved.observationOnly) continue;

    resolveDocumentEntities(store, saved.document, {
      sourceId: result.source_id,
      sourceRunId: runId,
      rawFetchId: rawFetchId || null
    }, now);
    const story = attachDocumentToStory(store, saved.document, now);
    store.refreshStoryEntityLinks(story.storyId, now);
    const event = rebuildEventForStory(store, story.storyId, now);
    if (event) eventCount += 1;
  }

  return {
    itemCount: processedItemCount,
    processedItemCount,
    failedItemCount,
    status: resultStatus,
    completeness,
    warnings,
    insertedCount,
    updatedCount,
    eventCount,
    httpStatus: result.fetches?.find((fetch) => fetch.http_status)?.http_status ?? null,
    entityCount: structured.entityIds.length,
    relationCount: structured.relationCount,
    snapshotId: structured.snapshotId
  };
}
