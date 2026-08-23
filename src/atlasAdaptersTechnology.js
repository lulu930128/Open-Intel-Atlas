import { parseCsv, safeNumber, summarize } from "./core/utils.js";
import { sourceFetchResult } from "./atlasContracts.js";
import { parseFeedItems } from "./atlasParsers.js";
import { createIntelDocument, dedupeDocuments } from "./documents/normalize.js";

export const technologySources = [
  {
    id: "arxiv-ai",
    name: "arXiv AI Search",
    providerType: "atom",
    sourceClass: "academic_repository",
    authorityClass: "academic",
    documentType: "research",
    domains: ["technology"],
    languages: ["en"],
    countries: [],
    homepage: "https://arxiv.org/",
    docsUrl: "https://info.arxiv.org/help/api/index.html",
    attribution: "arXiv",
    policyNote: "Store metadata and short abstracts; a paper is not automatically a real-world Event.",
    cadenceMs: 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchArxiv
  },
  {
    id: "cisa-kev",
    name: "CISA Known Exploited Vulnerabilities",
    providerType: "json_feed",
    sourceClass: "official_feed",
    authorityClass: "official",
    documentType: "security_advisory",
    domains: ["technology"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    docsUrl: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    attribution: "Cybersecurity and Infrastructure Security Agency",
    policyNote: "Official exploited-vulnerability evidence. Preserve required action and due date separately from derived severity.",
    cadenceMs: 45 * 60 * 1000,
    catchupMode: "provider_history",
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchCisaKev
  },
  {
    id: "cisa-advisories-rss",
    name: "CISA Cybersecurity Advisories",
    providerType: "rss",
    sourceClass: "official_feed",
    authorityClass: "official",
    documentType: "security_advisory",
    domains: ["technology"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.cisa.gov/news-events/cybersecurity-advisories",
    docsUrl: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    attribution: "Cybersecurity and Infrastructure Security Agency",
    policyNote: "Link to the official advisory; do not manufacture geographic coordinates.",
    cadenceMs: 30 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchCisaAdvisories
  },
  {
    id: "nvd-cve",
    name: "NVD CVE API",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "security_advisory",
    domains: ["technology"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://nvd.nist.gov/",
    docsUrl: "https://nvd.nist.gov/developers/vulnerabilities",
    attribution: "This product uses data from the NVD API but is not endorsed or certified by the NVD.",
    policyNote: "Use as vulnerability enrichment; NVD and CISA records for the same CVE are related evidence, not separate events.",
    cadenceMs: 2 * 60 * 60 * 1000,
    catchupMode: "provider_history",
    timeoutMs: 20000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchNvd
  },
  {
    id: "osv-dev",
    name: "OSV.dev Vulnerability Database",
    providerType: "json_feed",
    sourceClass: "aggregator",
    authorityClass: "aggregator",
    documentType: "security_advisory",
    domains: ["technology"],
    languages: ["en"],
    countries: [],
    homepage: "https://osv.dev/",
    docsUrl: "https://google.github.io/osv.dev/api/",
    attribution: "OSV.dev and originating advisory databases",
    policyNote: "Aggregator/enrichment source. Preserve database origin and withdrawn state; do not count as independent official confirmation.",
    cadenceMs: 2 * 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchOsv
  },
  {
    id: "semantic-scholar",
    name: "Semantic Scholar Academic Graph",
    providerType: "json_api",
    sourceClass: "academic_repository",
    authorityClass: "academic",
    documentType: "research",
    domains: ["technology"],
    languages: ["en"],
    countries: [],
    homepage: "https://www.semanticscholar.org/",
    docsUrl: "https://api.semanticscholar.org/api-docs",
    attribution: "Semantic Scholar",
    policyNote: "Optional enrichment. Disabled by default to avoid duplicating arXiv and consuming shared anonymous quota.",
    cadenceMs: 2 * 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: false,
    requiredConfig: [],
    run: fetchSemanticScholar
  }
];

async function fetchArxiv({ source, http, now }) {
  const startedAt = now();
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", "cat:cs.AI OR cat:cs.CL OR cat:cs.LG");
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "25");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  const fetch = await http.getText(url, { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data).map((item) =>
    createIntelDocument(
      source,
      {
        externalId: item.id || item.link,
        canonicalUrl: item.id || item.link,
        title: item.title,
        summary: item.description,
        publishedAt: item.publishedAt,
        fetchedAt,
        author: item.author,
        publisher: "arXiv",
        publisherKey: "arxiv",
        language: "en",
        domains: [{ domain: "technology", confidence: 0.85 }],
        eventTypeCandidate: "technology.research",
        tags: ["arxiv", "research", "ai", ...item.categories],
        rawMetadata: { categories: item.categories }
      },
      fetchedAt
    )
  );
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchCisaKev({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
    timeoutMs: source.timeoutMs
  });
  const fetchedAt = now();
  const vulnerabilities = Array.isArray(fetch.data?.vulnerabilities) ? fetch.data.vulnerabilities : [];
  const documents = vulnerabilities
    .toSorted((left, right) => Date.parse(right.dateAdded || 0) - Date.parse(left.dateAdded || 0))
    .slice(0, 40)
    .map((item) => {
      const cve = String(item.cveID || item.cveId || "").trim();
      const vendorProduct = [item.vendorProject, item.product].filter(Boolean).join(" ");
      const ransomware = String(item.knownRansomwareCampaignUse || "").toLowerCase() === "known";
      return createIntelDocument(
        source,
        {
          externalId: cve || `${vendorProduct}:${item.vulnerabilityName}`,
          canonicalUrl: cve ? `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(cve)}` : source.homepage,
          title: cve ? `${cve}: ${item.vulnerabilityName || vendorProduct}` : item.vulnerabilityName,
          summary: item.shortDescription || item.requiredAction,
          publishedAt: item.dateAdded,
          fetchedAt,
          publisher: "CISA",
          publisherKey: "cisa",
          language: "en",
          domains: [{ domain: "technology", confidence: 1 }],
          eventTypeCandidate: "technology.cybersecurity",
          eventKey: cve ? `cve:${cve.toUpperCase()}` : null,
          rawSeverity: ransomware ? "high" : "medium",
          tags: ["cisa", "kev", "cybersecurity", cve, item.vendorProject, item.product],
          location: { label: "United States", countryCode: "US", precision: "issuer", confidence: 0.5 },
          rawMetadata: {
            cve,
            vendor: item.vendorProject || null,
            product: item.product || null,
            required_action: item.requiredAction || null,
            due_date: item.dueDate || null,
            ransomware_campaign_use: item.knownRansomwareCampaignUse || null
          }
        },
        fetchedAt
      );
    });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchCisaAdvisories({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getText("https://www.cisa.gov/cybersecurity-advisories/all.xml", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data)
    .slice(0, 30)
    .map((item) =>
      createIntelDocument(
        source,
        {
          externalId: item.id || item.link,
          canonicalUrl: item.link || source.homepage,
          title: item.title,
          summary: item.description,
          publishedAt: item.publishedAt,
          fetchedAt,
          publisher: "CISA",
          publisherKey: "cisa",
          language: "en",
          domains: [{ domain: "technology", confidence: 1 }],
          eventTypeCandidate: "technology.cybersecurity",
          tags: ["cisa", "cybersecurity", ...item.categories],
          rawMetadata: { categories: item.categories }
        },
        fetchedAt
      )
    );
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchNvd({ source, http, config, now }) {
  const startedAt = now();
  const end = new Date();
  const start = new Date(end.getTime() - 119 * 24 * 60 * 60 * 1000);
  const url = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
  url.searchParams.set("hasKev", "");
  url.searchParams.set("kevStartDate", start.toISOString());
  url.searchParams.set("kevEndDate", end.toISOString());
  url.searchParams.set("noRejected", "");
  url.searchParams.set("resultsPerPage", "30");
  const headers = config.providers.nvdApiKey ? { apiKey: config.providers.nvdApiKey } : {};
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, headers, retries: 0 });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.vulnerabilities) ? fetch.data.vulnerabilities : []).map((wrapper) => {
    const cve = wrapper.cve || {};
    const cveId = String(cve.id || "").trim();
    const description = (Array.isArray(cve.descriptions) ? cve.descriptions : []).find((entry) => entry.lang === "en")?.value;
    const cvss = primaryCvss(cve.metrics);
    return createIntelDocument(
      source,
      {
        externalId: cveId,
        canonicalUrl: cveId ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}` : source.homepage,
        title: cveId ? `${cveId}: ${cve.cisaVulnerabilityName || firstSentence(description) || "NVD CVE record"}` : "NVD CVE record",
        summary: [cvss ? `CVSS ${cvss.score} ${cvss.severity}.` : null, description].filter(Boolean).join(" "),
        publishedAt: cve.published,
        observedAt: cve.lastModified,
        fetchedAt,
        publisher: "NIST NVD",
        publisherKey: "nvd",
        language: "en",
        domains: [{ domain: "technology", confidence: 1 }],
        eventTypeCandidate: "technology.cybersecurity",
        eventKey: cveId ? `cve:${cveId.toUpperCase()}` : null,
        rawSeverity: cvss?.severity?.toLowerCase() || null,
        tags: ["nvd", "cve", cveId, cvss?.severity],
        rawMetadata: {
          cve: cveId,
          cvss,
          cisa_required_action: cve.cisaRequiredAction || null,
          cisa_exploit_add: cve.cisaExploitAdd || null
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchOsv({ source, http, now }) {
  const startedAt = now();
  const indexFetch = await http.getText("https://storage.googleapis.com/osv-vulnerabilities/modified_id.csv", {
    timeoutMs: source.timeoutMs,
    retries: 0,
    headers: { Range: "bytes=0-1048575" }
  });
  const rows = parseCsv(`modified,path\n${indexFetch.data}`)
    .filter((row) => row.modified && row.path && !row.path.includes("[EMPTY]"))
    .slice(0, 8);
  const detailFetches = [];
  const documents = [];
  const fetchedAt = now();

  for (const row of rows) {
    const path = String(row.path).replace(/^\/+/, "").replace(/\.json$/i, "");
    const fetch = await http.getJson(`https://storage.googleapis.com/osv-vulnerabilities/${path}.json`, {
      timeoutMs: source.timeoutMs,
      retries: 0
    });
    detailFetches.push(fetch);
    const item = fetch.data || {};
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const cve = aliases.find((value) => /^CVE-/i.test(value));
    documents.push(
      createIntelDocument(
        source,
        {
          externalId: item.id || path,
          canonicalUrl: item.id ? `https://osv.dev/vulnerability/${encodeURIComponent(item.id)}` : source.homepage,
          title: `${item.id || "OSV advisory"}: ${item.summary || "Open source vulnerability"}`,
          summary: summarize(item.details, 1000),
          publishedAt: item.published,
          observedAt: item.modified || row.modified,
          fetchedAt,
          publisher: item.database_specific?.source || "OSV.dev",
          publisherKey: `osv:${String(item.database_specific?.source || path.split("/")[0]).toLowerCase()}`,
          language: "en",
          domains: [{ domain: "technology", confidence: 0.95 }],
          eventTypeCandidate: "technology.cybersecurity",
          eventKey: cve ? `cve:${cve.toUpperCase()}` : `osv:${item.id || path}`,
          rawSeverity: item.database_specific?.severity || null,
          tags: ["osv", "cybersecurity", item.id, ...aliases],
          rawMetadata: {
            raw_fetch_index: detailFetches.length,
            aliases,
            affected: Array.isArray(item.affected) ? item.affected.slice(0, 20) : [],
            withdrawn: item.withdrawn || null,
            database_specific: item.database_specific || null
          }
        },
        fetchedAt
      )
    );
  }

  return sourceFetchResult(source, [indexFetch, ...detailFetches], dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchSemanticScholar({ source, http, config, now }) {
  const startedAt = now();
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", "artificial intelligence semiconductor cybersecurity quantum computing");
  url.searchParams.set("limit", "20");
  url.searchParams.set("fields", "title,abstract,url,publicationDate,authors,externalIds,venue");
  const headers = config.providers.semanticScholarApiKey ? { "x-api-key": config.providers.semanticScholarApiKey } : {};
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, headers, retries: 0 });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.data) ? fetch.data.data : []).map((paper) =>
    createIntelDocument(
      source,
      {
        externalId: paper.paperId,
        canonicalUrl: paper.url,
        title: paper.title,
        summary: paper.abstract,
        publishedAt: paper.publicationDate,
        fetchedAt,
        author: Array.isArray(paper.authors) ? paper.authors.map((author) => author.name).filter(Boolean).join(", ") : null,
        publisher: paper.venue || "Semantic Scholar",
        publisherKey: "semantic-scholar",
        language: "en",
        domains: [{ domain: "technology", confidence: 0.8 }],
        eventTypeCandidate: "technology.research",
        tags: ["semantic-scholar", "research"],
        rawMetadata: { external_ids: paper.externalIds || null, venue: paper.venue || null }
      },
      fetchedAt
    )
  );
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function primaryCvss(metrics) {
  const groups = [metrics?.cvssMetricV40, metrics?.cvssMetricV31, metrics?.cvssMetricV30, metrics?.cvssMetricV2];
  for (const group of groups) {
    const metric = Array.isArray(group) ? group.find((entry) => entry.type === "Primary") || group[0] : null;
    const data = metric?.cvssData;
    const score = safeNumber(data?.baseScore);
    if (score !== null) {
      return { score, severity: String(data.baseSeverity || metric.baseSeverity || "UNKNOWN").toUpperCase() };
    }
  }
  return null;
}

function firstSentence(value) {
  return String(value || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) || "";
}
