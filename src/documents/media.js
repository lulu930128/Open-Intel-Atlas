import { isIP } from "node:net";

import { canonicalizeUrl, cleanText, stableId } from "../core/utils.js";

const DISPLAY_POLICIES = new Set(["blocked", "candidate", "link_only", "remote_embed"]);
const RIGHTS_CLASSES = new Set(["unknown", "restricted", "licensed", "public_domain", "publisher_owned"]);
const DISPLAY_AUTHORIZATIONS = new Set(["not_reviewed", "public_terms", "explicit_license", "public_domain"]);
const MEDIA_ORIGINS = new Set(["provider", "publisher", "official", "feed"]);
const MEDIA_ROLES = new Set(["main", "thumbnail", "supporting"]);
const SAFE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const POLICY_RANK = new Map([
  ["blocked", 0],
  ["candidate", 1],
  ["link_only", 2],
  ["remote_embed", 3]
]);

export const DEFAULT_MEDIA_POLICY = Object.freeze({
  version: "media-policy-v1",
  default_display_policy: "candidate",
  rights_class: "unknown",
  display_authorization: "not_reviewed",
  allowed_hosts: [],
  terms_url: null,
  reviewed_at: null,
  reason: "No source-specific remote media policy is configured."
});

export function normalizeSourceMediaPolicy(value = {}) {
  const requested = value && typeof value === "object" ? value : {};
  const displayPolicy = DISPLAY_POLICIES.has(requested.defaultDisplayPolicy || requested.default_display_policy)
    ? requested.defaultDisplayPolicy || requested.default_display_policy
    : DEFAULT_MEDIA_POLICY.default_display_policy;
  const rightsClass = RIGHTS_CLASSES.has(requested.rightsClass || requested.rights_class)
    ? requested.rightsClass || requested.rights_class
    : DEFAULT_MEDIA_POLICY.rights_class;
  const displayAuthorization = DISPLAY_AUTHORIZATIONS.has(requested.displayAuthorization || requested.display_authorization)
    ? requested.displayAuthorization || requested.display_authorization
    : DEFAULT_MEDIA_POLICY.display_authorization;
  const allowedHosts = [...new Set((requested.allowedHosts || requested.allowed_hosts || [])
    .map(normalizeAllowedHost)
    .filter(Boolean))];
  const termsUrl = normalizePolicyUrl(requested.termsUrl || requested.terms_url);
  const reviewedAt = normalizeReviewedAt(requested.reviewedAt || requested.reviewed_at);

  if (displayPolicy === "remote_embed" && (
    !isEmbeddableRights(rightsClass)
    || !isDisplayAuthorized(displayAuthorization)
    || allowedHosts.length === 0
    || !termsUrl
    || !reviewedAt
  )) {
    throw new Error("remote_embed media policy requires embeddable rights, explicit display authorization, terms evidence, review time, and at least one allowed host");
  }

  return {
    version: cleanText(requested.version, 100) || DEFAULT_MEDIA_POLICY.version,
    default_display_policy: displayPolicy,
    rights_class: rightsClass,
    display_authorization: displayAuthorization,
    allowed_hosts: allowedHosts,
    terms_url: termsUrl,
    reviewed_at: reviewedAt,
    reason: cleanText(requested.reason, 500) || DEFAULT_MEDIA_POLICY.reason
  };
}

export function normalizeDocumentMedia(source, candidates, documentId, now = new Date().toISOString()) {
  const policy = source?.mediaPolicy || source?.media_policy || DEFAULT_MEDIA_POLICY;
  const normalizedPolicy = normalizeSourceMediaPolicy(policy);
  const deduped = new Map();

  for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 24) : []) {
    const media = normalizeMediaCandidate(candidate, source, normalizedPolicy, documentId, now);
    if (!media) continue;

    const existing = deduped.get(media.normalized_url);
    if (!existing || compareMedia(media, existing) < 0) {
      deduped.set(media.normalized_url, media);
    }
  }

  const result = [...deduped.values()].sort(compareMedia).slice(0, 8);
  const representative = result.find((media) => media.display_policy !== "blocked") || null;
  for (const media of result) {
    media.is_representative = media === representative;
  }
  return result;
}

export function applyEffectiveMediaPolicy(media, sourcePolicy) {
  if (!media || typeof media !== "object") return null;

  let policy;
  try {
    policy = normalizeSourceMediaPolicy(sourcePolicy);
  } catch {
    policy = DEFAULT_MEDIA_POLICY;
  }

  const persistedPolicy = DISPLAY_POLICIES.has(media.display_policy) ? media.display_policy : "blocked";
  let displayPolicy = lowerPolicy(persistedPolicy, policy.default_display_policy);
  if (displayPolicy === "remote_embed" && !isRemoteEmbedAllowed(media.url, policy, policy.rights_class)) {
    displayPolicy = "candidate";
  }

  return {
    ...media,
    rights_class: policy.rights_class,
    display_policy: displayPolicy,
    policy_version: policy.version,
    policy_reason: policy.reason
  };
}

export function selectRepresentativeMedia(candidates, options = {}) {
  const preferredDocumentId = options.preferredDocumentId || null;
  const effective = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => applyEffectiveMediaPolicy(candidate, candidate.current_source_policy))
    .filter((candidate) => candidate && candidate.display_policy !== "blocked");

  effective.sort((left, right) => compareRepresentativeMedia(left, right, preferredDocumentId));
  return effective[0] || null;
}

function normalizeMediaCandidate(candidate, source, policy, documentId, now) {
  if (!candidate || typeof candidate !== "object") return null;
  const normalizedUrl = normalizeMediaUrl(candidate.url || candidate.href || candidate.src);
  if (!normalizedUrl) return null;

  const requestedPolicy = DISPLAY_POLICIES.has(candidate.displayPolicy || candidate.display_policy)
    ? candidate.displayPolicy || candidate.display_policy
    : policy.default_display_policy;
  let displayPolicy = lowerPolicy(requestedPolicy, policy.default_display_policy);
  const rightsClass = policy.rights_class;

  if (displayPolicy === "remote_embed" && !isRemoteEmbedAllowed(normalizedUrl, policy, rightsClass)) {
    displayPolicy = "candidate";
  }

  const mimeType = normalizeMimeType(candidate.mimeType || candidate.mime_type);
  if (mimeType && !SAFE_IMAGE_MIME_TYPES.has(mimeType)) return null;

  return {
    id: stableId(`media:${documentId}`, normalizedUrl),
    document_id: documentId,
    kind: "image",
    role: MEDIA_ROLES.has(candidate.role) ? candidate.role : "main",
    url: normalizedUrl,
    normalized_url: normalizedUrl,
    thumbnail_url: normalizeMediaUrl(candidate.thumbnailUrl || candidate.thumbnail_url),
    origin: MEDIA_ORIGINS.has(candidate.origin) ? candidate.origin : "feed",
    source_id: source.id,
    mime_type: mimeType,
    width: positiveInteger(candidate.width),
    height: positiveInteger(candidate.height),
    alt_text: cleanText(candidate.altText || candidate.alt_text, 1000) || null,
    attribution: cleanText(candidate.attribution, 1000) || source.attribution || null,
    rights_class: rightsClass,
    display_policy: displayPolicy,
    policy_version: policy.version,
    policy_reason: policy.reason,
    is_representative: false,
    first_seen_at: now,
    last_seen_at: now
  };
}

function normalizeMediaUrl(value) {
  const normalized = canonicalizeUrl(value);
  if (!normalized || normalized.length > 2048) return null;
  try {
    const url = new URL(normalized);
    if (url.username || url.password || !isPublicHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isRemoteEmbedAllowed(value, policy, rightsClass) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && isEmbeddableRights(rightsClass)
      && policy.allowed_hosts.some((allowed) => hostMatches(url.hostname, allowed));
  } catch {
    return false;
  }
}

function isPublicHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  const address = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return isIP(address) === 0;
}

function normalizeAllowedHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const bare = host.startsWith("*.") ? host.slice(2) : host;
  if (!isPublicHostname(bare) || !/^[a-z0-9.-]+$/.test(bare)) return null;
  return host.startsWith("*.") ? `*.${bare}` : bare;
}

function normalizePolicyUrl(value) {
  const normalized = canonicalizeUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password || !isPublicHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeReviewedAt(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function hostMatches(hostname, allowed) {
  const host = String(hostname || "").toLowerCase();
  if (allowed.startsWith("*.")) {
    const suffix = allowed.slice(1);
    return host.endsWith(suffix) && host !== allowed.slice(2);
  }
  return host === allowed;
}

function normalizeMimeType(value) {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return mime || null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 20_000 ? number : null;
}

function lowerPolicy(requested, ceiling) {
  return POLICY_RANK.get(requested) <= POLICY_RANK.get(ceiling) ? requested : ceiling;
}

function isEmbeddableRights(value) {
  return value === "licensed" || value === "public_domain" || value === "publisher_owned";
}

function isDisplayAuthorized(value) {
  return value === "public_terms" || value === "explicit_license" || value === "public_domain";
}

function compareMedia(left, right) {
  const policy = POLICY_RANK.get(right.display_policy) - POLICY_RANK.get(left.display_policy);
  if (policy !== 0) return policy;
  const roleOrder = { main: 0, thumbnail: 1, supporting: 2 };
  const role = roleOrder[left.role] - roleOrder[right.role];
  if (role !== 0) return role;
  const leftArea = (left.width || 0) * (left.height || 0);
  const rightArea = (right.width || 0) * (right.height || 0);
  if (leftArea !== rightArea) return rightArea - leftArea;
  return left.normalized_url.localeCompare(right.normalized_url);
}

function compareRepresentativeMedia(left, right, preferredDocumentId) {
  const priority = representativePriority(left, preferredDocumentId) - representativePriority(right, preferredDocumentId);
  if (priority !== 0) return priority;

  const confidence = Number(right.evidence_confidence || 0) - Number(left.evidence_confidence || 0);
  if (confidence !== 0) return confidence;

  const roleOrder = { main: 0, thumbnail: 1, supporting: 2 };
  const role = (roleOrder[left.role] ?? 3) - (roleOrder[right.role] ?? 3);
  if (role !== 0) return role;

  const leftArea = (left.width || 0) * (left.height || 0);
  const rightArea = (right.width || 0) * (right.height || 0);
  if (leftArea !== rightArea) return rightArea - leftArea;
  return String(left.id || left.normalized_url || left.url).localeCompare(String(right.id || right.normalized_url || right.url));
}

function representativePriority(media, preferredDocumentId) {
  const preferred = Boolean(preferredDocumentId && media.document_id === preferredDocumentId);
  if (media.display_policy === "remote_embed") return preferred ? 0 : 1;
  if (preferred && media.display_policy === "link_only") return 2;
  if (preferred && media.display_policy === "candidate") return 3;
  if (media.display_policy === "link_only") return 4;
  return 5;
}
