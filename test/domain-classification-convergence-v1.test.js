import assert from "node:assert/strict";
import test from "node:test";
import { withDocumentClassification } from "../src/atlasClassification.js";
import { evaluateDocumentPromotion } from "../src/atlasPromotion.js";
import { normalizeDomains } from "../src/documents/normalize.js";

test("content classification is source-independent and preserves multiple domains", () => {
  const classify = (domain) => withDocumentClassification({ title: "NVIDIA semiconductor export control regulation and investment", document_type: "news", domains: [{ domain, confidence: 1 }] });
  const first = classify("politics");
  assert.deepEqual(first.domains, classify("finance").domains);
  assert.deepEqual(new Set(first.domains.map((d) => d.domain)), new Set(["politics", "technology", "finance"]));
  assert.ok(first.classification.domains.every((d) => d.reason_codes.length));
  assert.deepEqual(withDocumentClassification(first), first);
});

test("invalid domain remains unknown and cannot promote even with provider opt-in", () => {
  assert.deepEqual(normalizeDomains(["bogus"]), []);
  const document = withDocumentClassification({ title: "Unclassified update", document_type: "news", domains: [], raw_metadata: { event_eligible: true } });
  assert.equal(document.classification.primary_domain, null);
  assert.equal(evaluateDocumentPromotion(document).status, "held");
});

test("company materiality overrides legacy adapter flags without promoting bare keywords", () => {
  for (const source_id of ["twse-material-info", "tpex-material-info"]) {
    for (const flag of [true, undefined]) {
      const decision = (title) => evaluateDocumentPromotion({ source_id, document_type: "financial_release", title, raw_metadata: { event_eligible: flag } });
      assert.equal(decision("本公司受邀參加凱基證券舉辦之法人說明會").status, "held");
      assert.equal(decision("本公司投資業務例行公告").status, "held");
      assert.equal(decision("公告本公司115年8月份合併自結損益").status, "held");
      assert.equal(decision("董事會通過合併財務報告").status, "held");
      assert.equal(decision("董事會通過合併案").status, "promoted");
      assert.equal(decision("澄清媒體報導本公司宣布重大投資").status, "held");
      assert.equal(decision("本公司董事會通過重大投資案").status, "promoted");
      assert.equal(decision("本公司宣布收購子公司").status, "promoted");
    }
  }
  assert.equal(evaluateDocumentPromotion({ source_id: "twse-material-info", document_type: "financial_release", title: "本公司宣布收購", raw_metadata: { provider_status: "cancelled" } }).status, "cancelled");
  const incident = { source_id: "twse-material-info", document_type: "financial_release", title: "本公司針對工安意外之說明", summary: "員工執行作業遭台車碰撞不治身亡。勞檢處依法立即課以部分停工處分。" };
  assert.equal(evaluateDocumentPromotion(incident).status, "promoted");
  assert.equal(evaluateDocumentPromotion({ ...incident, summary: "目前無人死亡，配合調查。" }).status, "held");
});

test("structured evidence remains classified; oversized raw metadata is not overwritten", () => {
  const raw_metadata = { truncated: true, preview: "x".repeat(40000) };
  const document = withDocumentClassification({ document_type: "security_advisory", title: "Security update", raw_metadata, domains: ["technology"] });
  assert.equal(document.classification.primary_domain, "technology");
  assert.equal(document.raw_metadata, raw_metadata);
});
