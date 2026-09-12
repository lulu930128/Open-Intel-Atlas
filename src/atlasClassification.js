import { isDomain } from "./atlasDomains.js";

export const CLASSIFICATION_METHOD = "deterministic-content-domains";
export const CLASSIFICATION_VERSION = "1.0.0";

// These are evidence categories, not confidence in the truth of an article.
const RULES = [
  ["politics", /\b(election|sanction|regulation|legislation|tariff|export control|diplomac|military|government|policy)\w*\b|選舉|制裁|法案|關稅|出口管制|外交|政策|規制|安全保障/iu],
  ["technology", /\b(ai|artificial intelligence|semiconductor|cyber|digital|patent|intellectual property|robot|quantum|software|telecom)\w*\b|人工智慧|人工知能|半導體|半導体|晶片|資安|先進製程|量子/iu],
  ["finance", /\b(trade|investment|corporate|economy|economic|finance|financial|inflation|interest rate|merger|acquisition|earnings|supply chain)\w*\b|投資|併購|合併|營收|財報|通膨|利率|金融|經濟|経済|決算/iu],
  ["hazards", /\b(earthquake|tsunami|typhoon|hurricane|wildfire|volcano|flood)\w*\b|地震|海嘯|津波|颱風|台風|洪水|火山|豪雨/iu]
];
const TYPE_DOMAIN = { financial_release: "finance", market_observation: "finance", research: "technology", security_advisory: "technology", hazard_observation: "hazards" };

export function normalizeDomainHints(values = []) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const domain = typeof value === "string" ? value : value?.domain;
    if (!isDomain(domain) || result.some((entry) => entry.domain === domain)) continue;
    const confidence = typeof value === "string" ? 0.7 : Number(value.confidence);
    result.push({ domain, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7 });
  }
  return result;
}

export function primaryDomain(domains = []) {
  return [...domains].sort((a, b) => b.confidence - a.confidence || a.domain.localeCompare(b.domain))[0]?.domain || null;
}

export function classifyDocument(document) {
  const metadata = document.raw_metadata || {};
  const hints = normalizeDomainHints(document.classification?.source_hints ?? metadata.domain_hints ?? document.domains);
  const text = [document.title, document.summary, document.body_excerpt, ...(Array.isArray(metadata.tags) ? metadata.tags : [])].filter(Boolean).join(" ");
  const scores = new Map();
  const add = (domain, confidence, reason) => {
    const previous = scores.get(domain);
    scores.set(domain, { domain, confidence: Math.max(previous?.confidence || 0, confidence), reason_codes: [...(previous?.reason_codes || []), reason] });
  };
  const structured = TYPE_DOMAIN[document.document_type];
  if (structured) add(structured, 0.95, `document_type:${document.document_type}`);
  for (const [domain, pattern] of RULES) if (pattern.test(text)) add(domain, 0.85, `content_rule:${domain}`);
  // General reporting is classified from content first; source scope is a fallback.
  if (scores.size === 0) for (const hint of hints) add(hint.domain, Math.min(0.6, hint.confidence), "source_hint_only");
  const domains = [...scores.values()].sort((a, b) => b.confidence - a.confidence || a.domain.localeCompare(b.domain));
  return { status: domains.length ? "classified" : "unknown", method: CLASSIFICATION_METHOD, version: CLASSIFICATION_VERSION,
    primary_domain: primaryDomain(domains), domains, source_hints: hints };
}

export function withDocumentClassification(document) {
  const classification = classifyDocument(document);
  return { ...document, classification, domains: classification.domains.map(({ domain, confidence }) => ({ domain, confidence })) };
}
