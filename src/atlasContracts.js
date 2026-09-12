import { contentHash, redactUrl, stableId } from "./core/utils.js";

export function sourceFetchResult(source, fetches, documents, startedAt, finishedAt = new Date().toISOString()) {
  return createSourceResult({ source, fetches, documents, startedAt, finishedAt });
}

export function createSourceResult({
  source,
  fetches = [],
  documents = [],
  entities = [],
  relations = [],
  masterItems,
  macroBatch,
  counts = {},
  completeness = {},
  warnings = [],
  status,
  startedAt,
  finishedAt = new Date().toISOString()
}) {
  if (!source?.id) throw new TypeError("Source Result requires source.id");
  if (!startedAt) throw new TypeError("Source Result requires startedAt");
  if (macroBatch !== undefined && (!macroBatch || !["calendar", "release"].includes(macroBatch.kind))) {
    throw new TypeError("Invalid Source Result macro batch");
  }
  for (const [label, value] of [["documents", documents], ["entities", entities], ["relations", relations]]) {
    if (!Array.isArray(value)) throw new TypeError(`Source Result ${label} must be an array`);
  }
  if (masterItems !== undefined && !Array.isArray(masterItems)) {
    throw new TypeError("Source Result masterItems must be an array when provided");
  }
  for (const [index, item] of (masterItems || []).entries()) {
    if (!item || typeof item !== "object" || !Array.isArray(item.entities) || !Array.isArray(item.relations)) {
      throw new TypeError(`Source Result masterItems[${index}] must contain entities and relations arrays`);
    }
  }
  const normalizedFetches = (Array.isArray(fetches) ? fetches : [fetches]).filter(Boolean).map((fetch) => {
    const requestUrl = redactUrl(fetch.url);
    return {
    id: stableId("raw", `${source.id}|${requestUrl}|${finishedAt}|${contentHash(fetch.rawPayload)}`),
    request_url: requestUrl,
    http_status: fetch.status ?? null,
    content_type: fetch.contentType ?? null,
    etag: fetch.etag ?? null,
    last_modified: fetch.lastModified ?? null,
    content_hash: contentHash(fetch.rawPayload),
    payload_text: fetch.rawPayload,
    payload_truncated: fetch.payloadTruncated ? 1 : 0
  };
  });

  const documentCount = countValue("document_count", counts.document_count, documents.length);
  const entityCount = countValue("entity_count", counts.entity_count, entities.length);
  const relationCount = countValue("relation_count", counts.relation_count, relations.length);
  const processedCount = countValue("processed_item_count", counts.processed_item_count, documents.length || entities.length || relations.length);
  const skippedCount = countValue("intentionally_skipped_count", counts.intentionally_skipped_count, 0);
  const failedCount = countValue("failed_count", counts.failed_count, 0);
  const upstreamCount = countValue("upstream_item_count", counts.upstream_item_count, processedCount + skippedCount + failedCount, true);
  if (upstreamCount !== null && upstreamCount !== processedCount + skippedCount + failedCount) {
    throw new RangeError("Source Result upstream_item_count must equal processed + intentionally_skipped + failed");
  }
  if (documentCount !== documents.length || entityCount !== entities.length || relationCount !== relations.length) {
    throw new RangeError("Source Result projection counts must match their arrays");
  }

  const truncated = Boolean(completeness.truncated);
  const rawPayloadTruncated = normalizedFetches.some((fetch) => fetch.payload_truncated);
  const completenessStatus = completeness.status || (truncated || failedCount > 0 ? "partial" : "complete");
  if (!["complete", "partial", "unknown", "failed"].includes(completenessStatus)) {
    throw new TypeError(`Invalid Source Result completeness status: ${completenessStatus}`);
  }
  const resultStatus = status || (completenessStatus === "partial" || truncated || failedCount > 0 ? "partial" : "success");
  if (!["success", "partial"].includes(resultStatus)) throw new TypeError(`Invalid Source Result status: ${resultStatus}`);

  return {
    source_id: source.id,
    started_at: startedAt,
    finished_at: finishedAt,
    status: resultStatus,
    fetches: normalizedFetches,
    documents,
    entities,
    relations,
    ...(masterItems !== undefined ? { master_items: masterItems } : {}),
    ...(macroBatch !== undefined ? { macro_batch: macroBatch } : {}),
    counts: {
      upstream_item_count: upstreamCount,
      processed_item_count: processedCount,
      document_count: documentCount,
      entity_count: entityCount,
      relation_count: relationCount,
      intentionally_skipped_count: skippedCount,
      failed_count: failedCount
    },
    completeness: {
      status: completenessStatus,
      truncated,
      snapshot_complete: completeness.snapshot_complete === true
    },
    warnings: [...new Set([
      ...(Array.isArray(warnings) ? warnings : [warnings]).filter(Boolean).map(String),
      ...(rawPayloadTruncated ? ["raw_payload_archival_truncated"] : [])
    ])]
  };
}

function countValue(name, value, fallback, nullable = false) {
  const candidate = value === undefined ? fallback : value;
  if (candidate === null && nullable) return null;
  const number = Number(candidate);
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`Source Result ${name} must be a non-negative integer${nullable ? " or null" : ""}`);
  return number;
}
