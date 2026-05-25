import { mergeSourceResults } from "./sourceRegistry.js";

const DEFAULT_TIMEOUT_MS = 8000;

const SOURCE_RUNNERS = [
  { id: "gdelt-doc", fetcher: fetchGdeltGeopolitics },
  { id: "bbc-world-rss", fetcher: fetchBbcWorldGeopolitics },
  { id: "usgs-earthquake", fetcher: fetchUsgsInfrastructure },
  { id: "nasa-eonet", fetcher: fetchNasaEonetInfrastructure },
  { id: "cisa-kev", fetcher: fetchCisaKevInfrastructure },
  { id: "nvd-cve", fetcher: fetchNvdCveInfrastructure },
  { id: "cisa-advisories-rss", fetcher: fetchCisaInfrastructure },
  { id: "coingecko-price", fetcher: fetchCoinGeckoFinance },
  { id: "frankfurter-fx", fetcher: fetchFrankfurterFinance },
  { id: "arxiv-ai", fetcher: fetchAiUpdates }
];

const FALLBACK_EVENTS = [
  {
    id: "sample-geopolitics-gdelt",
    category: "geopolitics",
    title: "Sample diplomatic and security signal",
    summary: "Fallback sample used when live public data cannot be fetched.",
    severity: "medium",
    confidence: 0.5,
    source: "Open Intel Atlas sample",
    url: null,
    observed_at: new Date().toISOString(),
    location: { label: "Global", lat: 20, lon: 0 },
    tags: ["sample", "geopolitics"],
    rationale: "Network or upstream source unavailable."
  },
  {
    id: "sample-infrastructure-earthquake",
    category: "infrastructure",
    title: "Sample infrastructure disruption watch",
    summary: "Fallback sample representing seismic or operational disruption monitoring.",
    severity: "medium",
    confidence: 0.5,
    source: "Open Intel Atlas sample",
    url: null,
    observed_at: new Date().toISOString(),
    location: { label: "Pacific Rim", lat: 35, lon: 140 },
    tags: ["sample", "infrastructure"],
    rationale: "Network or upstream source unavailable."
  },
  {
    id: "sample-finance-market",
    category: "finance",
    title: "Sample market radar signal",
    summary: "Fallback sample representing cross-asset monitoring.",
    severity: "low",
    confidence: 0.5,
    source: "Open Intel Atlas sample",
    url: null,
    observed_at: new Date().toISOString(),
    location: { label: "Market", lat: 40.7, lon: -74 },
    tags: ["sample", "finance"],
    rationale: "Network or upstream source unavailable."
  },
  {
    id: "sample-ai-arxiv",
    category: "ai",
    title: "Sample AI research update",
    summary: "Fallback sample representing latest AI research monitoring.",
    severity: "low",
    confidence: 0.5,
    source: "Open Intel Atlas sample",
    url: null,
    observed_at: new Date().toISOString(),
    location: { label: "Research", lat: 37.4, lon: -122.1 },
    tags: ["sample", "ai"],
    rationale: "Network or upstream source unavailable."
  }
];

export async function collectIntel() {
  const sourceResults = await Promise.allSettled(SOURCE_RUNNERS.map((source) => source.fetcher()));
  const events = sourceResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  if (events.length === 0) {
    return {
      events: FALLBACK_EVENTS,
      sources: buildSourceStatus(sourceResults),
      degraded: true
    };
  }

  return {
    events: dedupeEvents(events),
    sources: buildSourceStatus(sourceResults),
    degraded: sourceResults.some((result) => result.status === "rejected")
  };
}

async function fetchGdeltGeopolitics() {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", "(conflict OR sanctions OR diplomacy OR military OR protest)");
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "12");
  url.searchParams.set("sort", "HybridRel");

  const data = await fetchJson(url);
  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles.map((article, index) => ({
    id: stableId("gdelt", article.url || `${article.title}-${index}`),
    category: "geopolitics",
    title: sanitizeText(article.title) || "Untitled geopolitical signal",
    summary: summarizeText(article.seendate ? `Published ${article.seendate}.` : "Public news signal from GDELT."),
    severity: inferTextSeverity(`${article.title || ""} ${article.domain || ""}`),
    confidence: 0.68,
    source: article.domain || "GDELT",
    url: article.url || null,
    observed_at: parseGdeltDate(article.seendate) || new Date().toISOString(),
    location: estimateLocationFromText(article.title || ""),
    tags: ["gdelt", "news", "geopolitics"],
    rationale: "Matched geopolitical monitoring query in GDELT."
  }));
}

async function fetchBbcWorldGeopolitics() {
  const xml = await fetchText("https://feeds.bbci.co.uk/news/world/rss.xml");
  const items = readRssItems(xml).slice(0, 10);

  return items.map((item) => {
    const text = `${item.title} ${item.description}`;

    return {
      id: stableId("bbc-world", item.link || item.title),
      category: "geopolitics",
      title: item.title || "Untitled world news signal",
      summary: summarizeText(item.description || "Public world news signal from BBC RSS."),
      severity: inferTextSeverity(text),
      confidence: 0.62,
      source: "BBC News World RSS",
      url: item.link || "https://www.bbc.com/news/world",
      observed_at: parseRssDate(item.pubDate),
      location: estimateLocationFromText(text),
      tags: ["rss", "news", "geopolitics"],
      rationale: "World news RSS item used as a lightweight geopolitical signal."
    };
  });
}

async function fetchUsgsInfrastructure() {
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
  const data = await fetchJson(url);
  const features = Array.isArray(data.features) ? data.features : [];

  return features.slice(0, 16).map((feature) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const magnitude = Number(properties.mag);

    return {
      id: stableId("usgs", String(feature.id || properties.url || properties.time)),
      category: "infrastructure",
      title: `M${Number.isFinite(magnitude) ? magnitude.toFixed(1) : "?"} earthquake - ${properties.place || "unknown location"}`,
      summary: "Earthquake above M4.5 can affect transport, ports, energy systems, or regional operations.",
      severity: magnitude >= 6.5 ? "high" : magnitude >= 5.5 ? "medium" : "low",
      confidence: 0.9,
      source: "USGS Earthquake Hazards Program",
      url: properties.url || null,
      observed_at: properties.time ? new Date(properties.time).toISOString() : new Date().toISOString(),
      location: {
        label: properties.place || "USGS event",
        lat: Number(coordinates[1]) || 0,
        lon: Number(coordinates[0]) || 0
      },
      tags: ["earthquake", "infrastructure", "resilience"],
      rationale: "Magnitude and location indicate possible infrastructure exposure."
    };
  });
}

async function fetchNasaEonetInfrastructure() {
  const url = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=12";
  const data = await fetchJson(url);
  const events = Array.isArray(data.events) ? data.events : [];

  return events.map((event) => {
    const geometry = Array.isArray(event.geometry) ? event.geometry.at(-1) : null;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
    const categoryTitle = event.categories?.[0]?.title || "Natural event";
    const sourceLink = getEonetHumanUrl(event);

    return {
      id: stableId("eonet", event.id || event.link || event.title),
      category: "infrastructure",
      title: `${categoryTitle}: ${event.title || "Open EONET event"}`,
      summary: "Open natural event that may affect infrastructure, logistics, or regional continuity.",
      severity: categoryTitle.toLowerCase().includes("wildfire") ? "medium" : "low",
      confidence: 0.76,
      source: "NASA EONET",
      url: sourceLink,
      observed_at: geometry?.date || new Date().toISOString(),
      location: {
        label: event.title || categoryTitle,
        lat: Number(coordinates[1]) || 0,
        lon: Number(coordinates[0]) || 0
      },
      tags: ["nasa-eonet", "infrastructure", categoryTitle.toLowerCase().replaceAll(" ", "-")],
      rationale: "Open NASA EONET event relevant to infrastructure continuity."
    };
  });
}

function getEonetHumanUrl(event) {
  const sourceUrl = Array.isArray(event.sources)
    ? event.sources.map((source) => source?.url).find((url) => isHttpUrl(url) && !isEonetApiUrl(url))
    : null;

  if (sourceUrl) {
    return sourceUrl;
  }

  if (isHttpUrl(event.link) && !isEonetApiUrl(event.link)) {
    return event.link;
  }

  return "https://eonet.gsfc.nasa.gov/";
}

async function fetchCisaInfrastructure() {
  const xml = await fetchText("https://www.cisa.gov/cybersecurity-advisories/all.xml");
  const items = readRssItems(xml).slice(0, 8);

  return items.map((item) => ({
    id: stableId("cisa", item.link || item.title),
    category: "infrastructure",
    title: item.title || "CISA advisory",
    summary: summarizeText(item.description || "CISA cybersecurity advisory relevant to critical systems."),
    severity: inferCyberSeverity(`${item.title} ${item.description}`),
    confidence: 0.78,
    source: "CISA Cybersecurity Advisories",
    url: item.link || "https://www.cisa.gov/news-events/cybersecurity-advisories",
    observed_at: parseRssDate(item.pubDate),
    location: { label: "Cyber infrastructure", lat: 38.9, lon: -77 },
    tags: ["cybersecurity", "infrastructure", "cisa"],
    rationale: "Cyber advisory may affect critical infrastructure operations or enterprise exposure."
  }));
}

async function fetchCisaKevInfrastructure() {
  const data = await fetchJson("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json");
  const vulnerabilities = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];

  return vulnerabilities
    .toSorted((a, b) => Date.parse(b.dateAdded || 0) - Date.parse(a.dateAdded || 0))
    .slice(0, 12)
    .map((item) => {
      const cveId = String(item.cveID || item.cveId || "").trim();
      const vendor = sanitizeText(item.vendorProject);
      const product = sanitizeText(item.product);
      const name = sanitizeText(item.vulnerabilityName);
      const description = summarizeText(item.shortDescription || item.requiredAction || name, 220);
      const ransomwareUse = String(item.knownRansomwareCampaignUse || "").toLowerCase() === "known";
      const dueDate = parseIsoDate(item.dueDate);
      const addedDate = parseIsoDate(item.dateAdded);

      return {
        id: stableId("cisa-kev", cveId || `${vendor}-${product}-${name}`),
        category: "infrastructure",
        title: cveId ? `${cveId}: ${name || `${vendor} ${product} vulnerability`}` : name || "CISA KEV vulnerability",
        summary: description || "Known exploited vulnerability listed in the CISA KEV catalog.",
        severity: ransomwareUse || isDueSoon(dueDate) ? "high" : "medium",
        confidence: 0.92,
        source: "CISA KEV Catalog",
        url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        observed_at: addedDate || new Date().toISOString(),
        location: { label: "Cyber infrastructure", lat: 38.9, lon: -77 },
        tags: [
          "cybersecurity",
          "infrastructure",
          "cisa-kev",
          cveId.toLowerCase(),
          vendor.toLowerCase().replaceAll(" ", "-"),
          product.toLowerCase().replaceAll(" ", "-")
        ].filter(Boolean),
        rationale: ransomwareUse
          ? "CISA lists this vulnerability as known exploited with known ransomware campaign use."
          : "CISA lists this vulnerability as known exploited in the wild."
      };
    });
}

async function fetchNvdCveInfrastructure() {
  const now = new Date();
  const start = new Date(now.getTime() - 119 * 24 * 60 * 60 * 1000);
  const url = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
  url.searchParams.set("hasKev", "");
  url.searchParams.set("kevStartDate", toNvdDate(start));
  url.searchParams.set("kevEndDate", toNvdDate(now));
  url.searchParams.set("noRejected", "");
  url.searchParams.set("resultsPerPage", "12");
  url.searchParams.set("startIndex", "0");

  const data = await fetchNvdJson(url);
  const vulnerabilities = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];

  return vulnerabilities
    .toSorted((a, b) => Date.parse(getNvdObservedAt(b)) - Date.parse(getNvdObservedAt(a)))
    .map((item) => {
      const cve = item.cve || {};
      const cveId = sanitizeText(cve.id);
      const cvss = getPrimaryCvss(cve.metrics);
      const cwes = getPrimaryCwes(cve.weaknesses);
      const products = getAffectedProducts(cve.configurations);
      const description = summarizeText(getEnglishDescription(cve.descriptions), 220);
      const cisaName = sanitizeText(cve.cisaVulnerabilityName);
      const cisaAction = sanitizeText(cve.cisaRequiredAction);
      const productText = products.length > 0 ? `Affected products: ${products.join(", ")}.` : "";
      const cweText = cwes.length > 0 ? `Weakness: ${cwes.join(", ")}.` : "";
      const cvssText = cvss ? `CVSS ${cvss.score.toFixed(1)} ${cvss.severity}.` : "CVSS unavailable.";
      const summary = summarizeText([cvssText, cweText, productText, description].filter(Boolean).join(" "), 260);

      return {
        id: stableId("nvd-cve", cveId || `${cisaName}-${description}`),
        category: "infrastructure",
        title: cveId ? `${cveId}: ${cisaName || firstSentence(description) || "NVD CVE record"}` : "NVD CVE record",
        summary,
        severity: mapCvssSeverity(cvss?.severity),
        confidence: cvss ? 0.9 : 0.82,
        source: "NVD CVE API",
        url: cveId ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}` : "https://nvd.nist.gov/",
        observed_at: getNvdObservedAt(item),
        location: { label: "Cyber infrastructure", lat: 38.9, lon: -77 },
        tags: [
          "cybersecurity",
          "infrastructure",
          "nvd",
          "cve",
          cveId.toLowerCase(),
          cvss?.severity.toLowerCase(),
          ...cwes.map((cwe) => cwe.toLowerCase()),
          ...products.map((product) => product.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
        ].filter(Boolean),
        rationale: cisaAction
          ? `NVD enriched CISA KEV record. Required action: ${summarizeText(cisaAction, 120)}`
          : "NVD enriched CVE record linked to CISA KEV."
      };
    });
}

async function fetchCoinGeckoFinance() {
  const crypto = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true"
  );
  const now = new Date().toISOString();
  const events = [];

  for (const [asset, payload] of Object.entries(crypto || {})) {
    const change = Number(payload.usd_24h_change);
    events.push({
      id: stableId("coingecko", `${asset}-${payload.usd}-${Math.round(change * 100)}`),
      category: "finance",
      title: `${capitalize(asset)} at ${formatUsd(payload.usd)} (${formatPercent(change)} 24h)`,
      summary: "Crypto asset movement used as a high-frequency liquidity and risk sentiment proxy.",
      severity: Math.abs(change) >= 8 ? "high" : Math.abs(change) >= 4 ? "medium" : "low",
      confidence: 0.72,
      source: "CoinGecko",
      url: "https://www.coingecko.com/",
      observed_at: now,
      location: { label: "Global crypto market", lat: 40.7, lon: -74 },
      tags: ["crypto", "market", asset],
      rationale: "Large 24h move can indicate broader liquidity or risk sentiment shifts."
    });
  }

  return events;
}

async function fetchFrankfurterFinance() {
  const fx = await fetchJson("https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,TWD");
  const now = new Date().toISOString();

  if (fx?.rates) {
    const rates = Object.entries(fx.rates)
      .map(([currency, value]) => `${currency} ${Number(value).toFixed(3)}`)
      .join(", ");

    return [
      {
      id: stableId("frankfurter", `${fx.date}-${rates}`),
      category: "finance",
      title: `USD FX snapshot: ${rates}`,
      summary: "Reference FX rates for macro and cross-border monitoring.",
      severity: "low",
      confidence: 0.8,
      source: "Frankfurter",
      url: "https://www.frankfurter.app/",
      observed_at: fx.date ? `${fx.date}T16:00:00.000Z` : now,
      location: { label: "FX market", lat: 51.5, lon: -0.1 },
      tags: ["fx", "macro", "usd"],
      rationale: "FX snapshot supports downstream macro context."
      }
    ];
  }

  return [];
}

async function fetchAiUpdates() {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", "cat:cs.AI OR cat:cs.CL OR cat:cs.LG");
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "10");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const xml = await fetchText(url);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);

  return entries.map((entry) => {
    const title = decodeXml(readXmlTag(entry, "title")).replace(/\s+/g, " ").trim();
    const summary = decodeXml(readXmlTag(entry, "summary")).replace(/\s+/g, " ").trim();
    const id = readXmlTag(entry, "id");
    const published = readXmlTag(entry, "published");

    return {
      id: stableId("arxiv", id || title),
      category: "ai",
      title: title || "Untitled AI research update",
      summary: summarizeText(summary, 220),
      severity: inferAiSeverity(title, summary),
      confidence: 0.7,
      source: "arXiv",
      url: id || "https://arxiv.org/",
      observed_at: published || new Date().toISOString(),
      location: { label: "AI research", lat: 37.4, lon: -122.1 },
      tags: ["ai", "research", "arxiv"],
      rationale: "Latest AI-category arXiv submission for technology watch."
    };
  });
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OpenIntelAtlas/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${response.url}`);
  }

  return response.json();
}

async function fetchNvdJson(url) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "OpenIntelAtlas/0.1"
  };

  if (process.env.NVD_API_KEY) {
    headers.apiKey = process.env.NVD_API_KEY;
  }

  const response = await fetchWithTimeout(url, { headers, timeoutMs: 18000 });

  if (!response.ok) {
    const detail = response.headers.get("message");
    throw new Error(`Fetch failed ${response.status}: ${response.url}${detail ? ` (${detail})` : ""}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain",
      "User-Agent": "OpenIntelAtlas/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${response.url}`);
  }

  return response.text();
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildSourceStatus(results) {
  return mergeSourceResults(SOURCE_RUNNERS, results);
}

function dedupeEvents(events) {
  const seen = new Set();

  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }

    seen.add(event.id);
    return true;
  });
}

function stableId(prefix, value) {
  const input = String(value || "unknown");
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function parseGdeltDate(value) {
  if (!value || !/^\d{14}$/.test(value)) {
    return null;
  }

  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

function estimateLocationFromText(text) {
  const normalized = text.toLowerCase();
  const hints = [
    ["taiwan", { label: "Taiwan", lat: 23.7, lon: 121 }],
    ["china", { label: "China", lat: 35.9, lon: 104.2 }],
    ["ukraine", { label: "Ukraine", lat: 49, lon: 31 }],
    ["russia", { label: "Russia", lat: 55.7, lon: 37.6 }],
    ["israel", { label: "Israel", lat: 31.5, lon: 34.8 }],
    ["iran", { label: "Iran", lat: 32, lon: 53 }],
    ["red sea", { label: "Red Sea", lat: 19, lon: 39 }],
    ["south china sea", { label: "South China Sea", lat: 13, lon: 114 }],
    ["united states", { label: "United States", lat: 39.8, lon: -98.6 }],
    ["europe", { label: "Europe", lat: 50, lon: 10 }]
  ];

  for (const [keyword, location] of hints) {
    if (normalized.includes(keyword)) {
      return location;
    }
  }

  return { label: "Global", lat: 20, lon: 0 };
}

function inferTextSeverity(text) {
  const normalized = text.toLowerCase();

  if (/(war|missile|invasion|attack|nuclear|coup|blockade)/.test(normalized)) {
    return "high";
  }

  if (/(sanction|military|protest|strike|election|diplomacy)/.test(normalized)) {
    return "medium";
  }

  return "low";
}

function inferAiSeverity(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();

  if (/(agent|autonomous|reasoning|frontier|security|benchmark|alignment)/.test(text)) {
    return "medium";
  }

  return "low";
}

function inferCyberSeverity(text) {
  const normalized = text.toLowerCase();

  if (/(known exploited|emergency|actively exploited|critical)/.test(normalized)) {
    return "high";
  }

  if (/(vulnerability|malware|ransomware|advisory)/.test(normalized)) {
    return "medium";
  }

  return "low";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isEonetApiUrl(value) {
  return /^https?:\/\/eonet\.gsfc\.nasa\.gov\/api\//i.test(String(value || ""));
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function summarizeText(value, limit = 180) {
  const text = sanitizeText(value);

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1).trim()}...`;
}

function readXmlTag(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function readRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];

    return {
      title: cleanXmlText(readXmlTag(item, "title")),
      link: decodeXml(stripCdata(readXmlTag(item, "link"))).trim(),
      description: cleanXmlText(readXmlTag(item, "description")),
      pubDate: decodeXml(stripCdata(readXmlTag(item, "pubDate"))).trim()
    };
  });
}

function cleanXmlText(value) {
  const decoded = decodeXmlRepeated(stripCdata(value));
  return sanitizeText(stripHtml(decoded));
}

function stripCdata(value) {
  return String(value || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function decodeXmlRepeated(value) {
  let text = String(value || "");

  for (let index = 0; index < 3; index += 1) {
    const decoded = decodeXml(text);

    if (decoded === text) {
      return decoded;
    }

    text = decoded;
  }

  return text;
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseRssDate(value) {
  const timestamp = Date.parse(value || "");

  if (!Number.isFinite(timestamp)) {
    return new Date().toISOString();
  }

  return new Date(timestamp).toISOString();
}

function parseIsoDate(value) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00:00.000Z`;
  }

  const timestamp = Date.parse(text);

  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  return null;
}

function toNvdDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function getNvdObservedAt(item) {
  const cve = item?.cve || {};
  return parseIsoDate(cve.cisaExploitAdd) || parseIsoDate(cve.published) || parseIsoDate(cve.lastModified) || new Date().toISOString();
}

function getEnglishDescription(descriptions) {
  if (!Array.isArray(descriptions)) {
    return "";
  }

  return descriptions.find((description) => description.lang === "en")?.value || descriptions[0]?.value || "";
}

function getPrimaryCvss(metrics = {}) {
  const metricGroups = [
    metrics.cvssMetricV40,
    metrics.cvssMetricV31,
    metrics.cvssMetricV30,
    metrics.cvssMetricV2
  ];

  for (const group of metricGroups) {
    if (!Array.isArray(group) || group.length === 0) {
      continue;
    }

    const primary = group.find((metric) => metric.type === "Primary") || group[0];
    const score = Number(primary.cvssData?.baseScore);
    const severity = sanitizeText(primary.cvssData?.baseSeverity || primary.baseSeverity);

    if (Number.isFinite(score) && severity) {
      return { score, severity };
    }
  }

  return null;
}

function getPrimaryCwes(weaknesses) {
  if (!Array.isArray(weaknesses)) {
    return [];
  }

  return [
    ...new Set(
      weaknesses
        .flatMap((weakness) => weakness.description || [])
        .filter((description) => description.lang === "en")
        .map((description) => sanitizeText(description.value))
        .filter((value) => /^CWE-\d+$/i.test(value))
    )
  ].slice(0, 4);
}

function getAffectedProducts(configurations) {
  if (!Array.isArray(configurations)) {
    return [];
  }

  const criteria = configurations
    .flatMap((configuration) => configuration.nodes || [])
    .flatMap((node) => node.cpeMatch || [])
    .filter((match) => match.vulnerable !== false)
    .map((match) => parseCpeProduct(match.criteria))
    .filter(Boolean);

  return [...new Set(criteria)].slice(0, 5);
}

function parseCpeProduct(value) {
  const parts = String(value || "").split(":");

  if (parts.length < 6 || parts[0] !== "cpe" || parts[1] !== "2.3") {
    return "";
  }

  const vendor = cleanCpeToken(parts[3]);
  const product = cleanCpeToken(parts[4]);

  if (!vendor && !product) {
    return "";
  }

  return [vendor, product].filter(Boolean).join(" ");
}

function cleanCpeToken(value) {
  return String(value || "")
    .replace(/\\([\\:])/g, "$1")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(value) {
  const text = sanitizeText(value);
  const match = text.match(/^(.{1,120}?[.!?])\s/);
  return match ? match[1] : summarizeText(text, 100);
}

function mapCvssSeverity(value) {
  switch (String(value || "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "medium";
  }
}

function isDueSoon(value) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp <= Date.now() + 14 * 24 * 60 * 60 * 1000;
}

function formatUsd(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: number >= 100 ? 0 : 2
  }).format(number);
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "n/a";
  }

  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function capitalize(value) {
  const text = String(value || "");
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}
