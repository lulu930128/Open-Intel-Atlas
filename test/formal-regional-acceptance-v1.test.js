import assert from "node:assert/strict";
import test from "node:test";

import {
  ENABLED_REGIONAL_SOURCE_IDS,
  REGIONAL_PRESENTATIONS,
  evaluateFormalProduct,
  evaluateFormalRuntime
} from "../scripts/lib/formal-regional-acceptance.mjs";

test("formal runtime gate requires schema v5, contract 1.2, 33 sources and REST/MCP parity", () => {
  const sources = ENABLED_REGIONAL_SOURCE_IDS.map((id) => ({ id, enabled: true }));
  sources.push({ id: "jp-meti-latest", enabled: false });
  const presentations = Object.fromEntries(REGIONAL_PRESENTATIONS.map((presentation) => [presentation, {
    rest_contract: "1.2",
    mcp_contract: "1.2",
    rest_presentation: presentation,
    mcp_presentation: presentation,
    parity: true
  }]));
  const result = evaluateFormalRuntime({
    health: { ok: true, version: "1.3.0", contract_version: "1.2", storage: { schema_version: 5, sources: 33 }, scheduler: { enabled: true } },
    sources,
    presentations
  });
  assert.deepEqual(result, { passed: true, errors: [] });
});

test("formal runtime gate rejects the current legacy runtime shape", () => {
  const result = evaluateFormalRuntime({
    health: { ok: true, version: "1.3.0", contract_version: "1.1", storage: { schema_version: 4, sources: 26 }, scheduler: { enabled: true } },
    sources: [],
    presentations: {}
  });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("contract 1.2")));
  assert.ok(result.errors.some((error) => error.includes("schema 5")));
  assert.ok(result.errors.some((error) => error.includes("33 registered")));
});

test("formal product gate requires live health and at least one qualified Event per regional profile", () => {
  const sources = ENABLED_REGIONAL_SOURCE_IDS.map((id) => ({
    id,
    health: { status: "healthy", last_fetch_status: "success" }
  }));
  const passing = evaluateFormalProduct({
    sources,
    observations: Object.fromEntries(ENABLED_REGIONAL_SOURCE_IDS.map((id) => [id, {
      consecutive_usable_runs: 3,
      span_ms: 120_000,
      required_span_ms: 120_000
    }])),
    presentations: {
      east_asia: { selected_count: 8 },
      taiwan_focus: { selected_count: 8 },
      japan_focus: { selected_count: 2 }
    }
  });
  assert.deepEqual(passing, { passed: true, errors: [] });

  sources[0].health = { status: "unknown", last_fetch_status: null };
  const failing = evaluateFormalProduct({
    sources,
    observations: Object.fromEntries(ENABLED_REGIONAL_SOURCE_IDS.map((id) => [id, {
      consecutive_usable_runs: id === ENABLED_REGIONAL_SOURCE_IDS[0] ? 1 : 3,
      span_ms: 120_000,
      required_span_ms: 120_000
    }])),
    presentations: { east_asia: { selected_count: 8 }, taiwan_focus: { selected_count: 8 }, japan_focus: { selected_count: 0 } }
  });
  assert.equal(failing.passed, false);
  assert.ok(failing.errors.some((error) => error.includes("health is unknown")));
  assert.ok(failing.errors.some((error) => error.includes("fewer than three consecutive")));
  assert.ok(failing.errors.some((error) => error.includes("japan_focus selected no qualified")));
});

test("formal product gate rejects three runs that do not cross two cadence windows", () => {
  const sources = ENABLED_REGIONAL_SOURCE_IDS.map((id) => ({
    id,
    health: { status: "healthy", last_fetch_status: "success" }
  }));
  const observations = Object.fromEntries(ENABLED_REGIONAL_SOURCE_IDS.map((id) => [id, {
    consecutive_usable_runs: 3,
    span_ms: id === ENABLED_REGIONAL_SOURCE_IDS[0] ? 119_999 : 120_000,
    required_span_ms: 120_000
  }]));
  const result = evaluateFormalProduct({
    sources,
    observations,
    presentations: { east_asia: { selected_count: 8 }, taiwan_focus: { selected_count: 8 }, japan_focus: { selected_count: 2 } }
  });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("has not crossed two cadence windows")));
});
