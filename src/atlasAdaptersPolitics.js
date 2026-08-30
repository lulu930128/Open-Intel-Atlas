import { sourceFetchResult } from "./atlasContracts.js";
import { parseFeedItems, parseGdeltTimestamp } from "./atlasParsers.js";
import { createIntelDocument, dedupeDocuments } from "./documents/normalize.js";

export const politicsSources = [
  {
    id: "gdelt-doc",
    name: "GDELT DOC API",
    providerType: "json_api",
    sourceClass: "aggregator",
    authorityClass: "aggregator",
    documentType: "news",
    domains: ["politics"],
    languages: ["mul"],
    countries: [],
    homepage: "https://www.gdeltproject.org/",
    docsUrl: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/",
    attribution: "GDELT Project; article rights remain with the original publisher.",
    policyNote: "Discovery only. Preserve the original publisher and do not treat GDELT as verification.",
    cadenceMs: 10 * 60 * 1000,
    catchupMode: "window",
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchGdelt
  },
  {
    id: "bbc-world-rss",
    name: "BBC News World RSS",
    providerType: "rss",
    sourceClass: "publisher",
    authorityClass: "professional_media",
    documentType: "news",
    domains: ["politics"],
    languages: ["en"],
    countries: [],
    homepage: "https://www.bbc.com/news/world",
    docsUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    attribution: "BBC News",
    policyNote: "Store metadata and short excerpts only; link to the original article. Feed thumbnails are displayable only for the explicitly selected personal, non-commercial runtime context.",
    mediaPolicy: bbcNewsMediaPolicy,
    cadenceMs: 15 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchBbc
  },
  {
    id: "federal-register",
    name: "U.S. Federal Register API",
    providerType: "json_api",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "government_notice",
    domains: ["politics"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.federalregister.gov/",
    docsUrl: "https://www.federalregister.gov/developers/documentation/api/v1",
    attribution: "Office of the Federal Register / GPO",
    policyNote: "FederalRegister.gov is informational; preserve official PDF links for legal evidence.",
    cadenceMs: 30 * 60 * 1000,
    catchupMode: "window",
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchFederalRegister
  },
  {
    id: "congress-gov",
    name: "Congress.gov API",
    providerType: "json_api",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "government_notice",
    domains: ["politics"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.congress.gov/",
    docsUrl: "https://api.congress.gov/",
    attribution: "Library of Congress",
    policyNote: "API key required. Legislative activity is evidence, not an interpretation of legal effect.",
    cadenceMs: 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: ["congressApiKey"],
    run: fetchCongress
  }
];

function bbcNewsMediaPolicy(config) {
  const common = {
    version: "bbc-news-rss-personal-v1",
    rights_class: "licensed",
    display_authorization: "public_terms",
    allowed_hosts: ["ichef.bbci.co.uk"],
    terms_url: "https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use_31March2022english.pdf",
    reviewed_at: "2026-08-30T07:30:00.000Z"
  };

  if (config.mediaUsageContext !== "personal_noncommercial") {
    return {
      ...common,
      default_display_policy: "candidate",
      reason: "BBC News RSS thumbnails require an explicit personal, non-commercial runtime context; commercial or unreviewed use remains candidate-only."
    };
  }

  return {
    ...common,
    default_display_policy: "remote_embed",
    reason: "BBC News RSS thumbnail displayed unchanged from the feed on this local personal, non-commercial runtime, with BBC News attribution and an original-article link."
  };
}

async function fetchGdelt({ source, http, catchup, now }) {
  const startedAt = now();
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", "(conflict OR sanctions OR diplomacy OR military OR election OR protest OR regulation)");
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "40");
  url.searchParams.set("sort", "HybridRel");
  if (catchup?.from && catchup?.to) {
    url.searchParams.set("startdatetime", gdeltDate(catchup.from));
    url.searchParams.set("enddatetime", gdeltDate(catchup.to));
  }
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs });
  const articles = Array.isArray(fetch.data?.articles) ? fetch.data.articles : [];
  const fetchedAt = now();
  const documents = articles.map((article, index) =>
    createIntelDocument(
      source,
      {
        externalId: article.url || `${article.title || "untitled"}:${index}`,
        canonicalUrl: article.url,
        title: article.title,
        summary: article.seendate ? `Observed by GDELT at ${article.seendate}.` : "Discovered through the GDELT news index.",
        language: article.language || "und",
        publishedAt: parseGdeltTimestamp(article.seendate),
        fetchedAt,
        publisher: article.domain || "Unknown publisher",
        publisherKey: article.domain || null,
        domains: [{ domain: "politics", confidence: 0.65 }],
        tags: ["gdelt", "news", "discovery"],
        media: article.socialimage
          ? [{ url: article.socialimage, origin: "provider", role: "main", attribution: article.domain || null }]
          : [],
        rawMetadata: {
          sourcecountry: article.sourcecountry || null,
          socialimage: article.socialimage || null,
          tone: article.tone ?? null
        }
      },
      fetchedAt
    )
  );

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchBbc({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getText("https://feeds.bbci.co.uk/news/world/rss.xml", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data)
    .slice(0, 30)
    .map((item) =>
      createIntelDocument(
        source,
        {
          externalId: item.id || item.link,
          canonicalUrl: item.link,
          title: item.title,
          summary: item.description,
          publishedAt: item.publishedAt,
          fetchedAt,
          publisher: "BBC News",
          publisherKey: "bbc.co.uk",
          language: "en",
          domains: [{ domain: "politics", confidence: 0.7 }],
          tags: ["bbc", "rss", ...item.categories],
          media: item.media,
          rawMetadata: { categories: item.categories }
        },
        fetchedAt
      )
    );

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchFederalRegister({ source, http, catchup, now }) {
  const startedAt = now();
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("per_page", "40");
  url.searchParams.set("order", "newest");
  if (catchup?.from) url.searchParams.set("conditions[publication_date][gte]", catchup.from.slice(0, 10));
  if (catchup?.to) url.searchParams.set("conditions[publication_date][lte]", catchup.to.slice(0, 10));
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.results) ? fetch.data.results : []).map((item) => {
    const agencies = Array.isArray(item.agencies) ? item.agencies.map((agency) => agency.name).filter(Boolean) : [];
    const titleText = `${item.title || ""} ${item.abstract || ""}`.toLowerCase();
    const domains = [{ domain: "politics", confidence: 0.9 }];
    if (/technolog|cyber|semiconductor|artificial intelligence|telecom/.test(titleText)) {
      domains.push({ domain: "technology", confidence: 0.7 });
    }
    if (/bank|securit|financial|monetary|trade|tariff|treasury/.test(titleText)) {
      domains.push({ domain: "finance", confidence: 0.65 });
    }

    return createIntelDocument(
      source,
      {
        externalId: item.document_number,
        canonicalUrl: item.html_url || item.pdf_url,
        title: item.title,
        summary: item.abstract || item.excerpts,
        publishedAt: item.publication_date,
        fetchedAt,
        publisher: agencies.join(", ") || "Office of the Federal Register",
        publisherKey: agencies[0] ? `us-agency:${agencies[0].toLowerCase()}` : "federal-register",
        language: "en",
        domains,
        eventTypeCandidate: /rule/i.test(item.type || "") ? "politics.regulation" : "politics.government",
        eventKey: item.document_number ? `federal-register:${item.document_number}` : null,
        tags: ["federal-register", item.type, ...agencies],
        location: { label: "United States", countryCode: "US", precision: "country", confidence: 1 },
        rawMetadata: {
          document_number: item.document_number,
          document_type: item.type,
          agencies,
          official_pdf_url: item.pdf_url || null,
          public_inspection_pdf_url: item.public_inspection_pdf_url || null
        }
      },
      fetchedAt
    );
  });

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function gdeltDate(value) {
  return new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function fetchCongress({ source, http, config, now }) {
  const startedAt = now();
  const url = new URL("https://api.congress.gov/v3/bill");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "40");
  url.searchParams.set("sort", "updateDate+desc");
  url.searchParams.set("api_key", config.providers.congressApiKey);
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.bills) ? fetch.data.bills : []).map((bill) => {
    const billId = `${bill.congress || ""}-${bill.type || "bill"}-${bill.number || ""}`;
    return createIntelDocument(
      source,
      {
        externalId: billId,
        canonicalUrl: bill.url || `https://www.congress.gov/bill/${bill.congress}th-congress/${String(bill.type || "bill").toLowerCase()}/${bill.number}`,
        title: bill.title,
        summary: bill.latestAction?.text || "Congress.gov legislative record.",
        publishedAt: bill.updateDate || bill.updateDateIncludingText,
        observedAt: bill.latestAction?.actionDate,
        fetchedAt,
        publisher: "United States Congress",
        publisherKey: "us-congress",
        language: "en",
        domains: [{ domain: "politics", confidence: 0.95 }],
        eventTypeCandidate: "politics.legislation",
        eventKey: `congress:${billId}`,
        tags: ["congress", bill.type, "legislation"],
        location: { label: "United States", countryCode: "US", precision: "country", confidence: 1 },
        rawMetadata: {
          congress: bill.congress,
          bill_type: bill.type,
          bill_number: bill.number,
          latest_action: bill.latestAction || null
        }
      },
      fetchedAt
    );
  });

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}
