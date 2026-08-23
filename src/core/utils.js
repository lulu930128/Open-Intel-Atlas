import { createHash } from "node:crypto";

const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source"]);

export function stableId(prefix, value) {
  const digest = createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

export function contentHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function cleanText(value, limit = 4000) {
  const decoded = decodeEntities(stripMarkup(String(value || "")))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!Number.isFinite(limit) || limit <= 0 || decoded.length <= limit) {
    return decoded;
  }

  return `${decoded.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

export function summarize(value, limit = 600) {
  return cleanText(value, limit);
}

export function canonicalizeUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function redactUrl(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(api[-_]?key|authorization|access[-_]?token|token|key)$/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return input.replace(/((?:api[-_]?key|authorization|access[-_]?token|token|key)=)[^&\s]+/gi, "$1[REDACTED]");
  }
}

export function toIsoTimestamp(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function parseUnixTimestamp(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  return new Date(milliseconds).toISOString();
}

export function parseRocTimestamp(dateValue, timeValue = "000000") {
  const date = String(dateValue || "").replace(/\D/g, "");
  const time = String(timeValue || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!/^\d{7}$/.test(date)) {
    return null;
  }

  const year = Number(date.slice(0, 3)) + 1911;
  const month = date.slice(3, 5);
  const day = date.slice(5, 7);
  const hour = time.slice(0, 2);
  const minute = time.slice(2, 4);
  const second = time.slice(4, 6);
  return toIsoTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
}

export function normalizeTitle(value) {
  return cleanText(value, 1000)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(value) {
  const normalized = normalizeTitle(value);
  if (!normalized) {
    return [];
  }

  const words = normalized.match(/[a-z0-9]{2,}|[\p{Script=Han}]{1,3}|[\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
}

export function jaccardSimilarity(left, right) {
  const a = new Set(Array.isArray(left) ? left : titleTokens(left));
  const b = new Set(Array.isArray(right) ? right : titleTokens(right));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }

  return intersection / (a.size + b.size - intersection);
}

export function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

export function boundedJson(value, maxLength = 32_000) {
  let json;
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }

  if (json.length <= maxLength) {
    return json;
  }

  return JSON.stringify({ truncated: true, preview: json.slice(0, maxLength - 64) });
}

export function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function stripMarkup(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }
    return named[key] ?? match;
  });
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with"
]);
