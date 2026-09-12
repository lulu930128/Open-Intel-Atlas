import { cleanText } from "../core/utils.js";
import { normalizeEntityText } from "./normalize.js";

export const NEWS_MATCH_VERSION = "yahoo-content-identity-v1";
export const NEWS_SOURCE = "yahoo-tw-stock-news";

export function buildTargetIdentityContext(store, target) {
  const id = target.identifier || {};
  const security = store.findEntityByIdentifier({ namespace: "ticker", authority: id.authority,
    scope: id.scope || id.authority, normalizedValue: id.value });
  const company = security && store.findCompanyForSecurity(security.id);
  if (!company || security.entity_type !== "security") return null;
  const names = [company.canonical_name, security.canonical_name];
  for (const entity of [company, security]) {
    for (const alias of store.db.prepare("SELECT alias FROM entity_aliases WHERE entity_id = ? AND status = 'active'").all(entity.id)) {
      const candidates = store.findEntitiesByExactName(normalizeEntityText(alias.alias));
      if (candidates.length && candidates.every(candidate => [company.id, security.id].includes(candidate.id))) names.push(alias.alias);
    }
  }
  return { identifier: { ...id }, company_id: company.id, security_id: security.id,
    names: [...new Set(names.map(name => cleanText(name, 500).normalize("NFKC")).filter(name =>
      (name.length >= 3 || /^\p{Script=Han}{2}$/u.test(name)) && !/^\d+$/.test(name)
      && !["台灣", "臺灣", "公司", "科技", "股份", "上市", "上櫃"].includes(name)))] };
}

export function classifyTargetRelevance(item, identity) {
  if (!identity) return { status: "identity_unavailable", method: NEWS_MATCH_VERSION, matches: [] };
  const fields = { title: item.title, summary: item.summary ?? item.description };
  const matches = [];
  for (const [field, value] of Object.entries(fields)) {
    const text = cleanText(value || "", 16000).normalize("NFKC");
    for (const name of identity.names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = /^[\x00-\x7f]+$/.test(name)
        ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu")
        : new RegExp(escaped, "iu");
      if (expression.test(text)) matches.push({ field, text: name, kind: "canonical_name_or_alias" });
    }
    // Bare numbers can be money, dates or quantities. Require ticker syntax.
    const ticker = String(identity.identifier.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:[（(]\\s*${ticker}\\s*[)）]|(?:股票代號|證券代號|代號|TWSE|TPEX)\\s*[:：]?\\s*${ticker}(?!\\d))`, "i").test(text)) {
      matches.push({ field, text: identity.identifier.value, kind: "explicit_ticker" });
    }
  }
  return { status: matches.length ? "matched" : "not_matched", method: NEWS_MATCH_VERSION, matches };
}

export function relevanceMetadata(item, target, identity) {
  const scope = `${target.identifier.authority}:${target.identifier.value}`;
  const result = classifyTargetRelevance(item, identity);
  return {
    entity_hint_retractions: [{ source_id: NEWS_SOURCE, target_scope: scope }],
    target_relevance: { [scope]: result },
    entity_hints: result.status === "matched" ? [{ role: "mentioned", confidence: 0.9,
      identifier: { ...target.identifier }, method: "content_identity_match",
      matched_text: result.matches.map(match => match.text).join("; "),
      provenance: { source_id: NEWS_SOURCE, target_scope: scope, validator: NEWS_MATCH_VERSION, matches: result.matches }
    }] : []
  };
}

export function isRetractableNewsHint(hint, retraction) {
  const id = hint?.identifier;
  if (retraction.source_id !== NEWS_SOURCE || `${id?.authority}:${id?.value}` !== retraction.target_scope) return false;
  if (hint.provenance) return hint.provenance.source_id === NEWS_SOURCE && hint.provenance.target_scope === retraction.target_scope;
  // Exact legacy adapter signature, not arbitrary official/structured hints.
  return hint.role === "mentioned" && hint.confidence === 1 && id?.namespace === "ticker"
    && Object.keys(hint).every(key => ["role", "confidence", "identifier"].includes(key));
}
