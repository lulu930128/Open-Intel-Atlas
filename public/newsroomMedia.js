const DISPLAYABLE_POLICY = "remote_embed";
const VISUAL_VARIANTS = new Set(["standard", "lead", "stream", "domain", "detail"]);

export function renderVisual(media, options = {}) {
  const url = safeMediaUrl(media);
  if (!url) return "";

  const variant = VISUAL_VARIANTS.has(options.variant) ? options.variant : "standard";
  const altText = cleanText(media.alt_text);
  const attribution = cleanText(media.attribution, "來源標示未提供");
  const rights = cleanText(media.rights_class, "rights unknown").replaceAll("_", " ");
  const loading = options.priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';

  return `
    <figure class="news-visual news-visual--${variant} news-visual--remote" data-news-visual data-media-state="loading">
      <div class="news-visual__stage">
        <img data-newsroom-media src="${escapeHtml(url)}" alt="${escapeHtml(altText)}" ${loading} decoding="async" referrerpolicy="no-referrer" />
        <span class="news-visual__stamp">SOURCE IMAGE</span>
      </div>
      <figcaption><span>${escapeHtml(attribution)}</span><span>${escapeHtml(rights)}</span></figcaption>
    </figure>`;
}

export function safeMediaUrl(media) {
  if (!media || media.display_policy !== DISPLAYABLE_POLICY || !media.url) return null;
  try {
    const url = new URL(media.url);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const looksLikeIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
    if (url.protocol !== "https:" || url.username || url.password || !host || looksLikeIp) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function markVisualLoaded(image) {
  if (!image?.matches?.("img[data-newsroom-media]")) return false;
  const visual = image.closest?.("[data-news-visual]");
  if (!visual) return false;
  visual.setAttribute("data-media-state", "loaded");
  visual.parentElement?.setAttribute?.("data-media-state", "loaded");
  return true;
}

export function collapseFailedVisual(image) {
  if (!image?.matches?.("img[data-newsroom-media]")) return false;
  const visual = image.closest?.("[data-news-visual]");
  if (!visual) return false;

  const container = visual.parentElement;
  container?.setAttribute?.("data-media-state", "failed");
  image.hidden = true;
  image.removeAttribute?.("src");
  visual.remove?.();
  return true;
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
