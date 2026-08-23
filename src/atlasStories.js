import { jaccardSimilarity, parseJson } from "./core/utils.js";

export const CLUSTER_METHOD = "deterministic-title-event-key";
export const CLUSTER_VERSION = "1.0.0";

export function attachDocumentToStory(store, document, now = new Date().toISOString()) {
  const eventKey = document.raw_metadata?.event_key || null;
  const exact = store.findStoryForEventKey(eventKey) || store.findStoryForDedupeKey(document.dedupe_key);
  if (exact) {
    store.linkDocumentToStory(exact.id, document.id, 1, false, now);
    return { storyId: exact.id, method: eventKey ? "event-key" : "dedupe-key", similarity: 1 };
  }

  const primaryDomain = [...document.domains].sort((left, right) => right.confidence - left.confidence)[0]?.domain || "politics";
  const observed = Date.parse(document.observed_at || document.published_at || document.fetched_at || now);
  const windowMs = document.document_type === "hazard_observation" ? 14 * 24 * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;
  const since = new Date((Number.isFinite(observed) ? observed : Date.now()) - windowMs).toISOString();
  const candidates = store.listStoryCandidates(primaryDomain, since, 120);
  let best = null;

  for (const candidate of candidates) {
    const tokens = parseJson(candidate.title_tokens_json, []);
    const similarity = jaccardSimilarity(document.title_tokens, tokens);
    if (!best || similarity > best.similarity) {
      best = { candidate, similarity };
    }
  }

  const threshold = document.title_tokens.length <= 4 ? 0.75 : 0.58;
  if (best && best.similarity >= threshold) {
    store.linkDocumentToStory(best.candidate.id, document.id, best.similarity, false, now);
    return { storyId: best.candidate.id, method: "title-jaccard", similarity: best.similarity };
  }

  const storyId = store.createStory(document, CLUSTER_METHOD, CLUSTER_VERSION, now);
  store.linkDocumentToStory(storyId, document.id, 1, true, now);
  return { storyId, method: "new-story", similarity: 1 };
}
