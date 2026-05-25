export const SOURCE_REGISTRY = [
  {
    id: "gdelt-doc",
    name: "GDELT DOC API",
    category: "geopolitics",
    access: "public",
    cadence: "near real-time",
    homepage: "https://www.gdeltproject.org/",
    docs_url: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/",
    policy_note: "Use as news discovery; verify upstream article rights before redistribution.",
    recommended_use: "Geopolitical news discovery and event lead generation."
  },
  {
    id: "bbc-world-rss",
    name: "BBC World RSS",
    category: "geopolitics",
    access: "public RSS",
    cadence: "publisher feed",
    homepage: "https://www.bbc.com/news/world",
    docs_url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    policy_note: "Store metadata and short summaries only; link users to the original article.",
    recommended_use: "Lightweight geopolitical fallback feed."
  },
  {
    id: "usgs-earthquake",
    name: "USGS Earthquake Hazards",
    category: "infrastructure",
    access: "public",
    cadence: "near real-time",
    homepage: "https://earthquake.usgs.gov/",
    docs_url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    policy_note: "Official hazard feed suitable for machine-readable seismic monitoring.",
    recommended_use: "Transport, port, energy, and regional continuity exposure signals."
  },
  {
    id: "nasa-eonet",
    name: "NASA EONET",
    category: "infrastructure",
    access: "public",
    cadence: "open event feed",
    homepage: "https://eonet.gsfc.nasa.gov/",
    docs_url: "https://eonet.gsfc.nasa.gov/docs/v3",
    policy_note: "Prefer human/source URLs over raw API event URLs in the dashboard.",
    recommended_use: "Wildfires, storms, volcanoes, and other natural event monitoring."
  },
  {
    id: "cisa-kev",
    name: "CISA KEV Catalog",
    category: "infrastructure",
    access: "public JSON",
    cadence: "catalog update",
    homepage: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    docs_url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    policy_note: "Official exploited-vulnerability catalog; keep attribution and link to CISA.",
    recommended_use: "High-confidence cyber exposure and patch-priority signals."
  },
  {
    id: "nvd-cve",
    name: "NVD CVE API",
    category: "infrastructure",
    access: "public API, optional key",
    cadence: "CVE enrichment",
    homepage: "https://nvd.nist.gov/",
    docs_url: "https://nvd.nist.gov/developers/vulnerabilities",
    policy_note: "This product uses data from the NVD API but is not endorsed or certified by the NVD.",
    recommended_use: "CVSS, CWE, CPE, and product-impact enrichment for exploited vulnerabilities."
  },
  {
    id: "cisa-advisories-rss",
    name: "CISA Advisories RSS",
    category: "infrastructure",
    access: "public RSS",
    cadence: "publisher feed",
    homepage: "https://www.cisa.gov/news-events/cybersecurity-advisories",
    docs_url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    policy_note: "Use for advisory awareness; link to CISA report pages.",
    recommended_use: "Operational cyber advisory monitoring."
  },
  {
    id: "coingecko-price",
    name: "CoinGecko Simple Price",
    category: "finance",
    access: "public API",
    cadence: "market snapshot",
    homepage: "https://www.coingecko.com/",
    docs_url: "https://docs.coingecko.com/reference/simple-price",
    policy_note: "Rate limits can apply; use as a lightweight market proxy, not a trading feed.",
    recommended_use: "Crypto liquidity and risk-sentiment movement."
  },
  {
    id: "frankfurter-fx",
    name: "Frankfurter FX",
    category: "finance",
    access: "public API",
    cadence: "daily reference",
    homepage: "https://www.frankfurter.app/",
    docs_url: "https://www.frankfurter.app/docs/",
    policy_note: "Reference FX data; not intended as high-frequency market data.",
    recommended_use: "Macro context and cross-border reference rates."
  },
  {
    id: "arxiv-ai",
    name: "arXiv AI Search",
    category: "ai",
    access: "public API",
    cadence: "new submissions",
    homepage: "https://arxiv.org/",
    docs_url: "https://info.arxiv.org/help/api/index.html",
    policy_note: "Use metadata and link to papers; respect arXiv API request guidance.",
    recommended_use: "AI research and model-method watch."
  }
];

const SOURCE_BY_ID = new Map(SOURCE_REGISTRY.map((source) => [source.id, source]));

export function mergeSourceResults(runners, results) {
  const checkedAt = new Date().toISOString();

  return runners.map((runner, index) => {
    const metadata = SOURCE_BY_ID.get(runner.id);

    if (!metadata) {
      throw new Error(`Missing source registry entry: ${runner.id}`);
    }

    const result = results[index];
    const ok = result?.status === "fulfilled";

    return {
      ...metadata,
      ok,
      count: ok ? result.value.length : 0,
      error: ok ? null : result?.reason?.message || "Unknown source error",
      checked_at: checkedAt
    };
  });
}

export function listRegisteredSources() {
  return SOURCE_REGISTRY.map((source) => ({
    ...source,
    ok: null,
    count: 0,
    error: null,
    checked_at: null,
    last_success_at: null,
    last_failure_at: null
  }));
}
