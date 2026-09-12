import assert from "node:assert/strict";
import test from "node:test";

import { createSourceResult, sourceFetchResult } from "../src/atlasContracts.js";

const source = { id: "fixture" };
const now = "2026-09-06T00:00:00.000Z";

test("legacy document adapter receives truthful Source Result v2 defaults", () => {
  const result = sourceFetchResult(source, [], [{ id: "doc:1" }], now, now);
  assert.equal(result.status, "success");
  assert.deepEqual(result.counts, {
    upstream_item_count: 1,
    processed_item_count: 1,
    document_count: 1,
    entity_count: 0,
    relation_count: 0,
    intentionally_skipped_count: 0,
    failed_count: 0
  });
  assert.deepEqual(result.entities, []);
  assert.equal(result.completeness.status, "complete");
});

test("entity-only result separates upstream outcomes from projections", () => {
  const result = createSourceResult({
    source,
    startedAt: now,
    finishedAt: now,
    entities: [{ id: "company:1" }, { id: "security:1" }],
    relations: [{ id: "relation:1" }],
    counts: { upstream_item_count: 3, processed_item_count: 2, intentionally_skipped_count: 1 },
    completeness: { status: "complete", snapshot_complete: true }
  });
  assert.equal(result.counts.entity_count, 2);
  assert.equal(result.counts.relation_count, 1);
  assert.equal(result.counts.document_count, 0);
  assert.equal(result.completeness.snapshot_complete, true);
});

test("truncation is visible and forces partial status", () => {
  const result = createSourceResult({
    source,
    startedAt: now,
    finishedAt: now,
    counts: { upstream_item_count: null, processed_item_count: 0 },
    completeness: { status: "unknown", truncated: true },
    warnings: ["provider_count_unknown"]
  });
  assert.equal(result.status, "partial");
  assert.equal(result.counts.upstream_item_count, null);
  assert.equal(result.completeness.status, "unknown");
  assert.deepEqual(result.warnings, ["provider_count_unknown"]);
});

test("raw archive truncation is warned but does not claim processed rows were truncated", () => {
  const result = createSourceResult({
    source,
    startedAt: now,
    fetches: { url: "https://example.test", status: 200, rawPayload: "partial archive", payloadTruncated: true },
    completeness: { status: "complete", truncated: false }
  });
  assert.equal(result.status, "success");
  assert.equal(result.completeness.truncated, false);
  assert.deepEqual(result.warnings, ["raw_payload_archival_truncated"]);
});

test("invalid partition or projection counts fail closed", () => {
  assert.throws(() => createSourceResult({ source, startedAt: now, counts: { upstream_item_count: 2, processed_item_count: 1 } }), /must equal/);
  assert.throws(() => createSourceResult({ source, startedAt: now, documents: [{}], counts: { document_count: 0 } }), /must match/);
  assert.throws(() => createSourceResult({ source, startedAt: now, counts: { processed_item_count: -1 } }), /non-negative/);
});
