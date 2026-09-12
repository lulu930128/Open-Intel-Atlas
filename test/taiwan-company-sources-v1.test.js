import assert from "node:assert/strict";
import test from "node:test";

import { companyMasterResult, fetchTpexMaterialInfo, taiwanCompanySources } from "../src/sources/finance/taiwanCompanies.js";
import { fetchTwseMaterialInfo } from "../src/atlasAdaptersFinance.js";
import { normalizeEntityMaster } from "../src/entities/normalize.js";

const now = "2026-09-06T02:00:00.000Z";

test("TWSE official master maps one upstream company to company + security + listed_as", () => {
  const source = taiwanCompanySources.find((item) => item.id === "twse-company-master");
  const result = companyMasterResult(source, fixtureFetch([{
    "出表日期": "1150905",
    "公司代號": "2330",
    "公司名稱": "台灣積體電路製造股份有限公司",
    "公司簡稱": "台積電",
    "英文簡稱": "TSMC",
    "營利事業統一編號": "22099131",
    "產業別": "24",
    "上市日期": "19940905",
    "網址": "https://www.tsmc.com/"
  }]), "TWSE", now, now);
  assert.equal(result.counts.upstream_item_count, 1);
  assert.equal(result.counts.processed_item_count, 1);
  assert.equal(result.counts.entity_count, 2);
  assert.equal(result.counts.relation_count, 1);
  assert.equal(result.completeness.snapshot_complete, true);
  assert.equal(result.entities[0].id, "company:tw:22099131");
  assert.equal(result.entities[1].identifiers[0].value, "2330");
  assert.equal(result.relations[0].relation_type, "listed_as");
});

test("malformed master row is classified failed and makes snapshot partial", () => {
  const source = taiwanCompanySources.find((item) => item.id === "tpex-company-master");
  const result = companyMasterResult(source, fixtureFetch([{ CompanyName: "Missing code" }]), "TPEx", now, now);
  assert.equal(result.status, "partial");
  assert.equal(result.counts.intentionally_skipped_count, 0);
  assert.equal(result.counts.failed_count, 1);
  assert.equal(result.completeness.snapshot_complete, false);
  assert.equal(result.warnings[0], "invalid_required_fields:1");
});

test("unsupported master payload shape fails closed and an empty snapshot is not authoritative", () => {
  const source = taiwanCompanySources.find((item) => item.id === "twse-company-master");
  assert.throws(
    () => companyMasterResult(source, fixtureFetch({ rows: [] }), "TWSE", now, now),
    /unsupported_shape/
  );
  const empty = companyMasterResult(source, fixtureFetch([]), "TWSE", now, now);
  assert.equal(empty.status, "partial");
  assert.equal(empty.completeness.snapshot_complete, false);
  assert.deepEqual(empty.warnings, ["empty_master_snapshot"]);
});

test("one legal company with multiple securities is projected once in snapshot membership", () => {
  const source = taiwanCompanySources.find((item) => item.id === "twse-company-master");
  const base = { "公司名稱": "雙重上市股份有限公司", "公司簡稱": "雙重上市", "營利事業統一編號": "12345678" };
  const result = companyMasterResult(source, fixtureFetch([
    { ...base, "公司代號": "1111" },
    { ...base, "公司代號": "1112" }
  ]), "TWSE", now, now);
  assert.equal(result.entities.filter((item) => item.entity_type === "company").length, 1);
  assert.equal(result.entities.filter((item) => item.entity_type === "security").length, 2);
  assert.equal(result.relations.length, 2);
});

test("304 never claims a new empty complete master snapshot", () => {
  const source = taiwanCompanySources.find((item) => item.id === "twse-company-master");
  const result = companyMasterResult(source, { ...fixtureFetch(null), status: 304, data: null }, "TWSE", now, now);
  assert.equal(result.counts.upstream_item_count, null);
  assert.equal(result.completeness.status, "unknown");
  assert.equal(result.completeness.snapshot_complete, false);
  assert.deepEqual(result.warnings, ["not_modified_reuses_prior_master_snapshot"]);
});

test("TPEx ticker authority normalizes to stable uppercase scope", () => {
  const source = taiwanCompanySources.find((item) => item.id === "tpex-company-master");
  const result = companyMasterResult(source, fixtureFetch([{
    SecuritiesCompanyCode: "6488",
    CompanyName: "環球晶圓股份有限公司",
    CompanyAbbreviation: "環球晶",
    "UnifiedBusinessNo.": "28113286"
  }]), "TPEx", now, now);
  const security = normalizeEntityMaster(result.entities.find((item) => item.entity_type === "security"), source.id);
  assert.equal(security.identifiers[0].authority, "TPEX");
  assert.equal(security.identifiers[0].scope, "TPEX");
});

test("official TPEx emerging master maps to the ESB identifier scope", () => {
  const source = taiwanCompanySources.find((item) => item.id === "tpex-emerging-company-master");
  assert.ok(source);
  const result = companyMasterResult(source, fixtureFetch([{
    SecuritiesCompanyCode: "7777",
    CompanyName: "興櫃測試股份有限公司",
    CompanyAbbreviation: "興櫃測試",
    "UnifiedBusinessNo.": "12345678"
  }]), "ESB", now, now);
  const security = normalizeEntityMaster(result.entities.find((item) => item.entity_type === "security"), source.id);
  assert.equal(security.identifiers[0].authority, "ESB");
  assert.equal(security.identifiers[0].scope, "ESB");
  assert.equal(result.master_items.length, 1);
});

test("TPEx material adapter emits structured issuer hint without arbitrary slicing", async () => {
  const source = taiwanCompanySources.find((item) => item.id === "tpex-material-info");
  const result = await fetchTpexMaterialInfo({
    source,
    now: () => now,
    http: { async getJson() {
      return fixtureFetch(Array.from({ length: 101 }, (_, index) => ({
        Date: "1150906",
        "發言日期": "1150905",
        "發言時間": String(100000 + index),
        SecuritiesCompanyCode: String(6000 + index),
        CompanyName: `公司 ${index}`,
        "主旨": `重大訊息 ${index}`,
        "事實發生日": "1150905",
        "說明": "fixture"
      })));
    } }
  });
  assert.equal(result.documents.length, 101);
  assert.equal(result.counts.upstream_item_count, 101);
  assert.equal(result.documents[0].raw_metadata.exchange, "TPEx");
  assert.equal(result.documents[0].raw_metadata.entity_hints[0].identifier.authority, "TPEx");
});

test("malformed disclosure rows are failed rather than intentionally skipped", async () => {
  const source = taiwanCompanySources.find((item) => item.id === "tpex-material-info");
  const result = await fetchTpexMaterialInfo({
    source,
    now: () => now,
    http: { async getJson() {
      return fixtureFetch([
        { SecuritiesCompanyCode: "6617", CompanyName: "共信-KY", "主旨": "有效公告" },
        { SecuritiesCompanyCode: "", CompanyName: "缺代號", "主旨": "壞資料" }
      ]);
    } }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.counts.processed_item_count, 1);
  assert.equal(result.counts.failed_count, 1);
  assert.equal(result.counts.intentionally_skipped_count, 0);
  assert.deepEqual(result.warnings, ["invalid_required_fields:1"]);
});

test("TWSE disclosure rejects a provider object instead of claiming an empty complete result", async () => {
  const source = { ...taiwanCompanySources.find((item) => item.id === "tpex-material-info"), id: "twse-material-info" };
  await assert.rejects(
    () => fetchTwseMaterialInfo({ source, now: () => now, http: { getJson: async () => fixtureFetch({ rows: [] }) } }),
    /unsupported_shape/
  );
});

function fixtureFetch(data) {
  return {
    url: "https://official.example.test/data",
    status: 200,
    contentType: "application/json",
    etag: null,
    lastModified: null,
    rawPayload: JSON.stringify(data),
    payloadTruncated: false,
    data
  };
}
