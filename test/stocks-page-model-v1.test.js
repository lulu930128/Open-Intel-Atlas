import assert from "node:assert/strict";
import test from "node:test";

import { companyPageState, parseStockLocator, primaryListing } from "../public/stocksPageModel.js";

test("stock locator validates exchange and symbol without guessing", () => {
  assert.deepEqual(parseStockLocator("?exchange=twse&symbol=2330"), { exchange: "TWSE", symbol: "2330" });
  assert.deepEqual(parseStockLocator("?exchange=%2F&symbol="), { exchange: null, symbol: null });
});

test("company state keeps incomplete master visibly partial", () => {
  assert.equal(companyPageState({ data: { entity: {}, master_snapshot: null } }).status, "partial");
  assert.equal(companyPageState({ data: { entity: {}, master_snapshot: { status: "partial", snapshot_complete: false, truncated: true } } }).reason, "master_truncated");
  assert.equal(companyPageState({ data: { entity: {}, master_snapshot: { status: "complete", snapshot_complete: true, truncated: false } }, freshness: { status: "current" } }).status, "current");
});

test("primary listing uses exact market security before fallback", () => {
  const snapshot = { relations: [
    { relation_type: "listed_as", to: { id: "security:tpex:2330" } },
    { relation_type: "listed_as", to: { id: "security:twse:2330" } }
  ] };
  assert.equal(primaryListing(snapshot, "TWSE", "2330").to.id, "security:twse:2330");
});
