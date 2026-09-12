import { normalizeEntityText, normalizeIdentifierAuthority, normalizeIdentifierValue } from "./normalize.js";

export const ENTITY_RESOLUTION_VERSION = "1.0.0";

export function resolveDocumentEntities(store, document, lineage, now = new Date().toISOString()) {
  const resolutionRunId = store.beginEntityResolutionRun(document.id, now);
  const mentions = [];
  const unresolved = [];
  const hints = documentEntityHints(document);
  let ambiguousCount = 0;

  for (const hint of hints) {
    let entity = null;
    let method = "structured_identifier";
    if (hint.identifier?.namespace && hint.identifier?.authority && hint.identifier?.value) {
      entity = store.findEntityByIdentifier({
        namespace: String(hint.identifier.namespace).toLowerCase(),
        authority: normalizeIdentifierAuthority(hint.identifier.namespace, hint.identifier.authority),
        scope: normalizeIdentifierAuthority(hint.identifier.namespace, hint.identifier.scope || hint.identifier.authority),
        normalizedValue: normalizeIdentifierValue(hint.identifier.namespace, hint.identifier.value)
      });
      if (entity?.entity_type === "security") entity = store.findCompanyForSecurity(entity.id) || entity;
    }
    if (!entity && hint.name) {
      method = "exact_canonical_or_alias";
      const candidates = store.findEntitiesByExactName(normalizeEntityText(hint.name));
      if (candidates.length === 1) entity = candidates[0];
      else if (candidates.length > 1) {
        ambiguousCount += 1;
        unresolved.push({ mention_text: hint.name, normalized_text: normalizeEntityText(hint.name), reason: "ambiguous_exact_name", candidates: candidates.map(({ id, canonical_name }) => ({ id, canonical_name })) });
        continue;
      }
    }
    if (entity) {
      mentions.push({
        entity_id: entity.id,
        role: hint.role || "mentioned",
        method: hint.provenance?.validator === "yahoo-content-identity-v1" ? "content_identity_match" : method,
        confidence: hint.confidence ?? (method === "structured_identifier" ? 1 : 0.9),
        matched_text: hint.matched_text || hint.name || hint.identifier?.value || null,
        metadata: { resolution_version: ENTITY_RESOLUTION_VERSION, ...(hint.provenance ? { provenance: hint.provenance } : {}) }
      });
    } else {
      const mentionText = hint.name || hint.identifier?.value;
      if (mentionText) unresolved.push({ mention_text: mentionText, normalized_text: normalizeEntityText(mentionText), reason: "no_canonical_match", candidates: [] });
    }
  }

  const uniqueMentions = mentions.filter((mention, index, values) => values.findIndex((candidate) => candidate.entity_id === mention.entity_id && candidate.role === mention.role) === index);
  store.replaceDocumentEntityMentions(document.id, uniqueMentions, unresolved, lineage, resolutionRunId, now);
  store.finishEntityResolutionRun(resolutionRunId, {
    resolvedCount: uniqueMentions.length,
    unresolvedCount: unresolved.length,
    ambiguousCount,
    errorCount: 0
  }, now);
  return { resolutionRunId, mentions: uniqueMentions, unresolved, ambiguousCount };
}

function documentEntityHints(document) {
  const raw = document.raw_metadata || {};
  const hints = Array.isArray(raw.entity_hints) ? [...raw.entity_hints] : [];
  if (raw.company_code || raw.company_name) {
    hints.push({
      name: raw.company_name || null,
      role: "issuer",
      confidence: 1,
      identifier: raw.company_code
        ? { namespace: "ticker", authority: raw.exchange || "TWSE", scope: raw.exchange || "TWSE", value: raw.company_code }
        : null
    });
  }
  return hints.filter((hint) => hint && typeof hint === "object");
}
