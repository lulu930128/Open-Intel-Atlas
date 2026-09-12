import { cleanText, stableId } from "../core/utils.js";

const RELATION_TYPES = new Set(["issued_by", "listed_as", "represents", "same_issuer", "parent_of", "subsidiary_of"]);

export function normalizeEntityMaster(entity, sourceId) {
  if (!entity || typeof entity !== "object") throw new TypeError("Entity master item must be an object");
  const entityType = cleanText(entity.entity_type, 80).toLowerCase();
  const canonicalName = cleanText(entity.canonical_name, 500);
  if (!entityType || !canonicalName) throw new TypeError("Entity master item requires entity_type and canonical_name");
  const identifiers = (entity.identifiers || []).map((identifier) => normalizeIdentifier(identifier, sourceId));
  const id = entity.id || canonicalEntityId(entityType, identifiers, canonicalName, entity.country_code);
  const aliases = [canonicalName, ...(entity.aliases || [])]
    .map((alias) => normalizeAlias(alias))
    .filter((alias, index, values) => alias.alias && values.findIndex((candidate) => candidate.normalized_alias === alias.normalized_alias) === index);
  return {
    id,
    entity_type: entityType,
    canonical_name: canonicalName,
    country_code: cleanText(entity.country_code, 2).toUpperCase() || null,
    metadata: entity.metadata && typeof entity.metadata === "object" ? entity.metadata : {},
    aliases,
    identifiers,
    raw_fetch_index: integerOrZero(entity.raw_fetch_index),
    allow_canonical_update: entity.allow_canonical_update === true || entity.master_authority === "official"
  };
}

export function normalizeIdentifier(identifier, sourceId = "unknown") {
  if (!identifier || typeof identifier !== "object") throw new TypeError("Entity identifier must be an object");
  const namespace = cleanText(identifier.namespace, 80).toLowerCase();
  const authority = normalizeIdentifierAuthority(namespace, identifier.authority);
  const scope = normalizeIdentifierAuthority(namespace, identifier.scope || authority);
  const displayValue = cleanText(identifier.display_value ?? identifier.value, 200);
  if (!namespace || !authority || !displayValue) throw new TypeError("Entity identifier requires namespace, authority, and value");
  const normalizedValue = normalizeIdentifierValue(namespace, displayValue);
  return {
    id: identifier.id || stableId("identifier", `${namespace}|${authority}|${scope}|${normalizedValue}`),
    namespace,
    authority,
    scope,
    normalized_value: normalizedValue,
    display_value: displayValue,
    status: identifier.status || "active",
    valid_from: identifier.valid_from || null,
    valid_to: identifier.valid_to || null,
    confidence: boundedConfidence(identifier.confidence, 1),
    method: identifier.method || (sourceId === "unknown" ? "structured_identifier" : "official_identifier"),
    metadata: identifier.metadata && typeof identifier.metadata === "object" ? identifier.metadata : {},
    raw_fetch_index: integerOrZero(identifier.raw_fetch_index)
  };
}

export function normalizeEntityRelation(relation) {
  if (!relation?.from_entity_id || !relation?.to_entity_id || !RELATION_TYPES.has(relation.relation_type)) {
    throw new TypeError("Entity relation requires valid endpoints and relation_type");
  }
  return {
    id: relation.id || stableId("entity-relation", `${relation.from_entity_id}|${relation.relation_type}|${relation.to_entity_id}`),
    from_entity_id: relation.from_entity_id,
    to_entity_id: relation.to_entity_id,
    relation_type: relation.relation_type,
    confidence: boundedConfidence(relation.confidence, 1),
    method: relation.method || "official_relation",
    valid_from: relation.valid_from || null,
    valid_to: relation.valid_to || null,
    status: relation.status || "active",
    metadata: relation.metadata && typeof relation.metadata === "object" ? relation.metadata : {},
    raw_fetch_index: integerOrZero(relation.raw_fetch_index)
  };
}

export function normalizeAlias(value) {
  const alias = typeof value === "string" ? value : value?.alias;
  const cleaned = cleanText(alias, 500);
  return {
    alias: cleaned,
    normalized_alias: normalizeEntityText(cleaned),
    language: typeof value === "object" ? value.language || null : null,
    alias_type: typeof value === "object" ? value.alias_type || "name" : "name",
    method: typeof value === "object" ? value.method || "official_master" : "official_master",
    confidence: typeof value === "object" ? boundedConfidence(value.confidence, 1) : 1,
    status: typeof value === "object" ? value.status || "active" : "active",
    valid_from: typeof value === "object" ? value.valid_from || null : null,
    valid_to: typeof value === "object" ? value.valid_to || null : null,
    raw_fetch_index: typeof value === "object" ? integerOrZero(value.raw_fetch_index) : 0
  };
}

export function normalizeEntityText(value) {
  return cleanText(value, 500).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeIdentifierValue(namespace, value) {
  const normalized = cleanText(value, 200).normalize("NFKC").trim();
  if (["ticker", "lei", "isin", "cusip", "sedol", "company_code"].includes(String(namespace).toLowerCase())) {
    return normalized.replace(/\s+/g, "").toUpperCase();
  }
  return normalized.toLocaleLowerCase();
}

export function normalizeIdentifierAuthority(namespace, value) {
  const authority = cleanText(value, 100);
  return String(namespace).toLowerCase() === "ticker" ? authority.toUpperCase() : authority;
}

function canonicalEntityId(entityType, identifiers, canonicalName, countryCode) {
  const official = identifiers[0];
  if (official) return stableId(entityType, `${official.namespace}|${official.authority}|${official.scope}|${official.normalized_value}`);
  return stableId(entityType, `${countryCode || "global"}|${normalizeEntityText(canonicalName)}`);
}

function boundedConfidence(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function integerOrZero(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}
