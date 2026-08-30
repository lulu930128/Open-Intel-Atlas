import { cleanText } from "./core/utils.js";

export function parseFeedItems(xml) {
  const text = String(xml || "");
  const itemBlocks = [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const entryBlocks = [...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = itemBlocks.length > 0 ? itemBlocks : entryBlocks;

  return blocks.map((block) => {
    const atomLink = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    const categories = [...block.matchAll(/<category\b[^>]*(?:term=["']([^"']+)["']|>([\s\S]*?)<\/category>)/gi)]
      .map((match) => cleanText(match[1] || match[2], 200))
      .filter(Boolean);
    const authors = [...block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)]
      .map((match) => cleanText(readTag(match[1], "name") || match[1], 200))
      .filter(Boolean);
    const media = parseFeedMedia(block);

    return {
      id: readTag(block, "guid") || readTag(block, "id") || null,
      title: cleanText(readTag(block, "title"), 1000),
      description: cleanText(readTag(block, "description") || readTag(block, "summary") || readTag(block, "content"), 5000),
      link: cleanText(readTag(block, "link") || atomLink, 2000),
      publishedAt: readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated") || null,
      author: authors.join(", ") || cleanText(readTag(block, "dc:creator") || readTag(block, "author"), 300),
      categories,
      media,
      raw: block
    };
  });
}

function parseFeedMedia(block) {
  const candidates = [];
  for (const match of block.matchAll(/<(media:content|media:thumbnail|enclosure)\b([^>]*)\/?\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    const mimeType = attributes.type || null;
    if (tag === "enclosure" && mimeType && !mimeType.toLowerCase().startsWith("image/")) continue;
    if (!attributes.url) continue;
    candidates.push({
      url: cleanText(attributes.url, 2048),
      origin: "feed",
      role: tag === "media:thumbnail" ? "thumbnail" : "main",
      mimeType,
      width: attributes.width || null,
      height: attributes.height || null
    });
  }
  return candidates.filter((candidate, index) => candidates.findIndex((item) => item.url === candidate.url) === index);
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

export function readTag(xml, tag) {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim() : "";
}

export function parseGdeltTimestamp(value) {
  const text = String(value || "").replace(/\D/g, "");
  if (text.length < 8) {
    return null;
  }

  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  const hour = text.slice(8, 10) || "00";
  const minute = text.slice(10, 12) || "00";
  const second = text.slice(12, 14) || "00";
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function walkObjects(value, predicate, results = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return results;
  }
  seen.add(value);

  if (!Array.isArray(value) && predicate(value)) {
    results.push(value);
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    walkObjects(child, predicate, results, seen);
  }

  return results;
}
