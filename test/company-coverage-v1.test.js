import assert from "node:assert/strict";
import test from "node:test";

import { buildCompanyCoverage } from "../src/entities/coverage.js";

const now = "2026-09-06T10:00:00.000Z";

test("company coverage is entity-specific and preserves unrelated finance state separately", () => {
  const context = fixtureContext({
    sources: [
      source("twse-company-master", ["company.master"], "TWSE", "healthy", "current"),
      source("twse-material-info", ["company.disclosures"], "TWSE", "healthy", "current"),
      source("unrelated-finance", ["documents.macro"], null, "failed", "missing")
    ],
    evidence: {
      markets: ["TWSE"],
      master_matches: { "twse-company-master": now },
      document_matches: {}
    }
  });
  const result = buildCompanyCoverage(context, "company:2330");
  assert.equal(result.coverage.company_master.status, "current");
  assert.equal(result.coverage.official_disclosure.status, "missing");
  assert.equal(result.coverage.general_news.status, "unknown");
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.coverage.official_disclosure.relevant_source_ids, ["twse-material-info"]);
  assert.equal(result.warnings.some((warning) => warning.code === "COMPANY_NO_ENTITY_MATCH"), true);
});

test("source health without a company match never becomes current or full", () => {
  const context = fixtureContext({
    sources: [source("twse-company-master", ["company.master"], "TWSE", "healthy", "current")],
    evidence: { markets: ["TWSE"], master_matches: {}, document_matches: {} }
  });
  const result = buildCompanyCoverage(context, "company:2330");
  assert.equal(result.coverage.company_master.status, "missing");
  assert.equal(result.coverage.company_master.last_match_at, null);
  assert.notEqual(result.coverage.status, "full");
});

test("company source freshness is evaluated with the injected clock", () => {
  const staleAt = "2026-09-06T07:00:00.000Z";
  const context = fixtureContext({
    sources: [source("twse-company-master", ["company.master"], "TWSE", "healthy", "current", staleAt, 60_000)],
    evidence: { markets: ["TWSE"], master_matches: { "twse-company-master": staleAt }, document_matches: {} }
  });
  const result = buildCompanyCoverage(context, "company:2330");
  assert.equal(result.coverage.company_master.status, "stale");
  assert.equal(result.freshness.status, "stale");
});

test("general news uses company target success, including a successful empty fetch", () => {
  const context = fixtureContext({
    sources: [source("yahoo-tw-stock-news", ["company.news"], "TWSE", "healthy", "current")],
    evidence: {
      markets: ["TWSE"],
      master_matches: {},
      document_matches: {},
      document_counts: { "yahoo-tw-stock-news": 0 },
      target_states: {
        "yahoo-tw-stock-news": [{
          id: "yahoo-tw-stock-news:TWSE:2330",
          enabled: true,
          cadence_ms: 30 * 60 * 1000,
          last_success_at: now,
          last_match_at: null,
          last_outcome: "success"
        }]
      }
    }
  });
  const result = buildCompanyCoverage(context, "company:2330");
  assert.equal(result.coverage.general_news.status, "current");
  assert.equal(result.coverage.general_news.last_match_at, null);
  assert.equal(result.coverage.general_news.document_count, 0);
  assert.equal(result.coverage.general_news.target_count, 1);
});

test("healthy provider source never makes an unrun company target current", () => {
  const context = fixtureContext({
    sources: [source("yahoo-tw-stock-news", ["company.news"], "TWSE", "healthy", "current")],
    evidence: {
      markets: ["TWSE"],
      master_matches: {},
      document_matches: {},
      target_states: {
        "yahoo-tw-stock-news": [{
          id: "yahoo-tw-stock-news:TWSE:2330",
          enabled: true,
          cadence_ms: 30 * 60 * 1000,
          last_success_at: null,
          last_match_at: null,
          last_outcome: null
        }]
      }
    }
  });
  assert.equal(buildCompanyCoverage(context, "company:2330").coverage.general_news.status, "missing");
});

function fixtureContext({ sources, evidence }) {
  return {
    clock: () => new Date(now),
    store: {
      listSources: () => sources,
      getEntityCoverageEvidence: () => evidence
    }
  };
}

function source(id, capabilities, market, status, freshness, lastSuccess = now, cadenceMs = 3_600_000) {
  return {
    id,
    enabled: true,
    domains: ["finance"],
    cadence_ms: cadenceMs,
    coverage: {
      capabilities,
      markets: market ? [market] : [],
      guarantee: capabilities.includes("company.master") ? "complete_snapshot" : "bounded_window",
      recoverability: "latest_only"
    },
    health: {
      status,
      freshness_status: freshness,
      last_success_at: lastSuccess
    }
  };
}
