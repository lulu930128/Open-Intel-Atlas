import {
  boundedJson,
  canonicalizeUrl,
  cleanText,
  contentHash,
  stableId,
  summarize,
  titleTokens,
  toIsoTimestamp
} from "../core/utils.js";
import { isDomain } from "../atlasDomains.js";
import { normalizeDocumentMedia } from "./media.js";

const VALID_DOCUMENT_TYPES = new Set([
  "news",
  "official_statement",
  "government_notice",
  "research",
  "security_advisory",
  "hazard_observation",
  "financial_release",
  "market_observation"
]);

export function createIntelDocument(source, input, now = new Date().toISOString()) {
  const title = cleanText(input.title, 1000);
  if (!title) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(input.canonicalUrl || input.url);
  const externalId = cleanText(input.externalId, 500) || null;
  const publishedAt = toIsoTimestamp(input.publishedAt);
  const observedAt = toIsoTimestamp(input.observedAt, publishedAt || now);
  const fetchedAt = toIsoTimestamp(input.fetchedAt, now);
  const summary = summarize(input.summary, 1200);
  const bodyExcerpt = summarize(input.bodyExcerpt, 4000);
  const publisher = cleanText(input.publisher || source.name, 300) || source.name;
  const publisherKey = cleanText(input.publisherKey, 300) || normalizePublisherKey(publisher || source.id);
  const domains = normalizeDomains(input.domains, source.domains);
  const documentType = VALID_DOCUMENT_TYPES.has(input.documentType) ? input.documentType : source.documentType;
  const identity = externalId || canonicalUrl || `${title}|${publishedAt || observedAt || "unknown"}`;
  const id = stableId(`doc:${source.id}`, identity);
  const titleHash = contentHash(title.toLocaleLowerCase());
  const bodyHash = contentHash(`${title}\n${summary}\n${bodyExcerpt}`);
  const metadata = sanitizeMetadata({
    ...(input.rawMetadata || {}),
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => cleanText(tag, 100)).filter(Boolean) : [],
    event_key: cleanText(input.eventKey, 500) || null,
    event_type_candidate: cleanText(input.eventTypeCandidate, 200) || null,
    raw_severity: input.rawSeverity ?? null,
    location: sanitizeLocation(input.location)
  });
  const media = normalizeDocumentMedia(source, input.media, id, fetchedAt);

  return {
    id,
    source_id: source.id,
    external_id: externalId,
    document_type: documentType,
    canonical_url: canonicalUrl,
    title,
    summary: summary || null,
    body_excerpt: bodyExcerpt || null,
    language: cleanText(input.language, 30) || source.languages?.[0] || "und",
    published_at: publishedAt,
    observed_at: observedAt,
    fetched_at: fetchedAt,
    author: cleanText(input.author, 300) || null,
    publisher,
    publisher_key: publisherKey,
    title_hash: titleHash,
    content_hash: bodyHash,
    dedupe_key: canonicalUrl ? `url:${canonicalUrl}` : `content:${bodyHash}`,
    title_tokens: titleTokens(title),
    domains,
    media,
    raw_metadata: metadata,
    raw_metadata_json: boundedJson(metadata)
  };
}

export function dedupeDocuments(documents) {
  const seenIds = new Set();
  const seenKeys = new Set();
  const result = [];

  for (const document of documents.filter(Boolean)) {
    const keys = [document.dedupe_key, document.canonical_url && `canonical:${document.canonical_url}`].filter(Boolean);
    if (seenIds.has(document.id) || keys.some((key) => seenKeys.has(key))) {
      continue;
    }

    seenIds.add(document.id);
    keys.forEach((key) => seenKeys.add(key));
    result.push(document);
  }

  return result;
}

export function normalizeDomains(domains, fallback = []) {
  const values = Array.isArray(domains) && domains.length > 0 ? domains : fallback;
  const normalized = [];

  for (const value of values || []) {
    const domain = typeof value === "string" ? value : value?.domain;
    if (!isDomain(domain) || normalized.some((entry) => entry.domain === domain)) {
      continue;
    }
    const confidence = typeof value === "string" ? 0.7 : Number(value.confidence);
    normalized.push({ domain, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7 });
  }

  return normalized.length > 0 ? normalized : [{ domain: "politics", confidence: 0.3 }];
}

function sanitizeLocation(location) {
  if (!location || typeof location !== "object") {
    return null;
  }

  const latitude = Number(location.latitude ?? location.lat);
  const longitude = Number(location.longitude ?? location.lon);
  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const label = cleanText(location.label, 500) || null;
  const countryCode = cleanText(location.countryCode || location.country_code, 3)?.toUpperCase() || null;

  if (!hasPoint && !label && !countryCode) {
    return null;
  }

  return {
    label,
    country_code: countryCode,
    geometry_type: hasPoint ? "point" : countryCode ? "country" : "region",
    latitude: hasPoint ? latitude : null,
    longitude: hasPoint ? longitude : null,
    precision: cleanText(location.precision, 50) || (hasPoint ? "source" : "named"),
    confidence: Number.isFinite(Number(location.confidence)) ? Math.max(0, Math.min(1, Number(location.confidence))) : 0.8
  };
}

function sanitizeMetadata(value) {
  return JSON.parse(boundedJson(value, 32_000));
}

function normalizePublisherKey(value) {
  return String(value || "unknown")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}.:-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}
