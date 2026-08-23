import { rebuildEventForStory } from "./atlasEvents.js";
import { attachDocumentToStory } from "./atlasStories.js";

export function processSourceResult(store, runId, result, now = new Date().toISOString()) {
  const rawFetchIds = store.saveRawFetches(runId, result.source_id, result.fetches, result.finished_at || now);
  let insertedCount = 0;
  let updatedCount = 0;
  let eventCount = 0;

  for (const document of result.documents || []) {
    const rawFetchIndex = Number(document.raw_metadata?.raw_fetch_index);
    const rawFetchId = Number.isInteger(rawFetchIndex) && rawFetchIndex >= 0 ? rawFetchIds[rawFetchIndex] : rawFetchIds[0];
    const saved = store.upsertDocument(document, runId, rawFetchId || null, now);
    if (saved.inserted) insertedCount += 1;
    else updatedCount += 1;

    const story = attachDocumentToStory(store, saved.document, now);
    const event = rebuildEventForStory(store, story.storyId, now);
    if (event) eventCount += 1;
  }

  return {
    itemCount: result.documents?.length || 0,
    insertedCount,
    updatedCount,
    eventCount,
    httpStatus: result.fetches?.find((fetch) => fetch.http_status)?.http_status ?? null
  };
}
