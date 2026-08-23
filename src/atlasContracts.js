import { contentHash, redactUrl, stableId } from "./core/utils.js";

export function sourceFetchResult(source, fetches, documents, startedAt, finishedAt = new Date().toISOString()) {
  const normalizedFetches = (Array.isArray(fetches) ? fetches : [fetches]).filter(Boolean).map((fetch) => {
    const requestUrl = redactUrl(fetch.url);
    return {
    id: stableId("raw", `${source.id}|${requestUrl}|${finishedAt}|${contentHash(fetch.rawPayload)}`),
    request_url: requestUrl,
    http_status: fetch.status,
    content_type: fetch.contentType,
    etag: fetch.etag,
    last_modified: fetch.lastModified,
    content_hash: contentHash(fetch.rawPayload),
    payload_text: fetch.rawPayload,
    payload_truncated: fetch.payloadTruncated ? 1 : 0
  };
  });

  return {
    source_id: source.id,
    started_at: startedAt,
    finished_at: finishedAt,
    status: "success",
    fetches: normalizedFetches,
    documents
  };
}
