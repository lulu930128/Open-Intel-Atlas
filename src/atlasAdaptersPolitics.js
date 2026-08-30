import { sourceFetchResult } from "./atlasContracts.js";
import { parseFeedItems, parseGdeltTimestamp } from "./atlasParsers.js";
import { cleanText, toIsoTimestamp } from "./core/utils.js";
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
  },
  {
    id: "jp-mod-news",
    name: "Japan Ministry of Defense News RSS",
    providerType: "rss",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "official_statement",
    domains: ["politics"],
    languages: ["ja"],
    countries: ["JP"],
    homepage: "https://www.mod.go.jp/",
    docsUrl: "https://www.mod.go.jp/j/rss/index.html",
    attribution: "防衛省・自衛隊",
    policyNote: "Official publisher evidence. Preserve the original release URL and Japanese wording; routine notices are Document-only until canonical promotion policy says otherwise.",
    cadenceMs: 30 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchJapanModNews
  },
  {
    id: "jp-ndl-diet-minutes",
    name: "National Diet Library Meeting Records API",
    providerType: "json_api",
    sourceClass: "primary_legislative_evidence",
    authorityClass: "official",
    documentType: "government_notice",
    domains: ["politics"],
    languages: ["ja"],
    countries: ["JP"],
    homepage: "https://kokkai.ndl.go.jp/",
    docsUrl: "https://kokkai.ndl.go.jp/api.html",
    attribution: "国立国会図書館 国会会議録検索システム",
    policyNote: "Primary legislative evidence. Atlas fetches one bounded meeting-list page and stores meeting metadata only; it does not copy speech transcripts or promote every meeting to an Event.",
    cadenceMs: 6 * 60 * 60 * 1000,
    catchupMode: "window",
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchJapanNdlDietMeetings
  },
  {
    id: "jp-meti-latest",
    name: "Japan METI Latest Information Atom",
    providerType: "atom",
    sourceClass: "official_feed",
    authorityClass: "official",
    documentType: "official_statement",
    domains: ["politics", "technology", "finance"],
    languages: ["en"],
    countries: ["JP"],
    homepage: "https://www.meti.go.jp/english/",
    docsUrl: "https://www.meti.go.jp/english/rss/index.html",
    attribution: "Ministry of Economy, Trade and Industry, Japan",
    policyNote: "Official English policy-release metadata and bounded excerpts. Routine releases remain Document-only; market-price interpretation stays with OMI. Registered but default-disabled because compliant Atlas Node requests returned HTTP 403 on 2026-08-30.",
    cadenceMs: 60 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: false,
    requiredConfig: [],
    run: fetchJapanMetiLatest
  },
  {
    id: "tw-president-office-news",
    name: "Office of the President Taiwan News API",
    providerType: "json_api",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "official_statement",
    domains: ["politics"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.president.gov.tw/News",
    docsUrl: "https://www.president.gov.tw/Page/20",
    attribution: "中華民國總統府",
    policyNote: "Official publisher evidence. Store metadata, bounded excerpts, and original links; routine releases are not independently verified Events.",
    cadenceMs: 15 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTaiwanPresidentOffice
  },
  {
    id: "tw-executive-yuan-news",
    name: "Executive Yuan Taiwan News RSS",
    providerType: "rss",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "official_statement",
    domains: ["politics"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.ey.gov.tw/Page/6485009ABEC1CB9C",
    docsUrl: "https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3",
    attribution: "行政院",
    policyNote: "Official publisher evidence. Preserve the original release link; publication does not by itself establish independent verification.",
    cadenceMs: 15 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTaiwanExecutiveYuan
  },
  {
    id: "tw-mofa-press-releases",
    name: "Taiwan Ministry of Foreign Affairs Press Releases",
    providerType: "html_list",
    sourceClass: "government_api",
    authorityClass: "official",
    documentType: "official_statement",
    domains: ["politics"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.mofa.gov.tw/News.aspx?n=FAEEE2F9798A98FD",
    docsUrl: "https://www.mofa.gov.tw/News.aspx?n=FAEEE2F9798A98FD",
    attribution: "中華民國外交部",
    policyNote: "Official diplomatic release evidence from the bounded first news-list page. Retain source wording and original links; do not promote every release to an Event. The full-history OpenData feeds are intentionally not persisted because each response is currently 2.5-3.5 MB and has no HTTP validator.",
    cadenceMs: 30 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTaiwanMofa
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

async function fetchTaiwanPresidentOffice({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.president.gov.tw/Handler/GetNews.ashx", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const items = Array.isArray(fetch.data) ? fetch.data : [];
  const documents = items.slice(0, 30).map((item) => {
    const images = Array.isArray(item.Images) ? item.Images : [];
    return createIntelDocument(
      source,
      {
        externalId: item.URL || null,
        canonicalUrl: item.URL,
        title: removeInlineSpanMarkup(item.Title),
        summary: item.Description,
        publishedAt: parseTaiwanGovernmentTimestamp(item.PublishDate),
        fetchedAt,
        publisher: "中華民國總統府",
        publisherKey: "tw-president-office",
        language: "zh-TW",
        domains: [{ domain: "politics", confidence: 0.95 }],
        tags: ["taiwan", "president-office", "official-release"],
        media: images.map((image) => ({
          url: image.FileUrl,
          origin: "official",
          role: "supporting",
          altText: cleanText(image.FileTitle, 1000),
          attribution: "中華民國總統府"
        })),
        rawMetadata: {
          event_eligible: false,
          evidence_support: true,
          source_scope: "TW",
          image_count: images.length,
          video_count: Array.isArray(item.Videos) ? item.Videos.length : 0
        }
      },
      fetchedAt
    );
  });

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchJapanModNews({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getText("https://www.mod.go.jp/j/rss/news.xml", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data)
    .slice(0, 40)
    .map((item) => {
      const canonicalUrl = resolveOfficialUrl(item.link, "https://www.mod.go.jp/");
      const externalId = resolveOfficialUrl(item.id, "https://www.mod.go.jp/") || canonicalUrl;
      return createIntelDocument(
        source,
        {
          externalId,
          canonicalUrl,
          title: item.title,
          summary: item.description,
          publishedAt: item.publishedAt,
          fetchedAt,
          author: item.author,
          publisher: "防衛省・自衛隊",
          publisherKey: "jp-mod",
          language: "ja",
          domains: [{ domain: "politics", confidence: 0.95 }],
          tags: ["japan", "mod", "official-release", ...item.categories],
          rawMetadata: {
            event_eligible: false,
            evidence_support: true,
            source_scope: "JP",
            categories: item.categories
          }
        },
        fetchedAt
      );
    });

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchJapanNdlDietMeetings({ source, http, catchup, now }) {
  const startedAt = now();
  const range = boundedMeetingDateRange(catchup, startedAt);
  const url = new URL("https://kokkai.ndl.go.jp/api/meeting_list");
  url.searchParams.set("from", range.from);
  url.searchParams.set("until", range.until);
  url.searchParams.set("maximumRecords", "30");
  url.searchParams.set("recordPacking", "json");
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, retries: 0 });
  const fetchedAt = now();
  const meetings = Array.isArray(fetch.data?.meetingRecord) ? fetch.data.meetingRecord.slice(0, 30) : [];
  const resultTotal = finiteInteger(fetch.data?.numberOfRecords);
  const nextRecordPosition = finiteInteger(fetch.data?.nextRecordPosition);
  const documents = meetings.map((meeting) => {
    const speeches = Array.isArray(meeting.speechRecord) ? meeting.speechRecord : [];
    const speakerCount = new Set(
      speeches
        .map((speech) => cleanText(speech?.speaker, 300))
        .filter((speaker) => speaker && speaker !== "会議録情報")
    ).size;
    const title = [
      meeting.session ? `第${meeting.session}回` : null,
      cleanText(meeting.nameOfHouse, 100),
      cleanText(meeting.nameOfMeeting, 300),
      cleanText(meeting.issue, 100)
    ].filter(Boolean).join(" ");

    return createIntelDocument(
      source,
      {
        externalId: meeting.issueID,
        canonicalUrl: meeting.meetingURL,
        title,
        summary: `${meeting.date || "開催日不明"}開催。会議単位の書誌情報のみを保存し、発言本文は保存していません。`,
        publishedAt: meeting.date,
        observedAt: meeting.date,
        fetchedAt,
        publisher: "国立国会図書館 国会会議録検索システム",
        publisherKey: "jp-ndl-diet",
        language: "ja",
        domains: [{ domain: "politics", confidence: 1 }],
        tags: ["japan", "national-diet", "meeting-record", meeting.nameOfHouse, meeting.nameOfMeeting],
        rawMetadata: {
          event_eligible: false,
          evidence_support: true,
          source_scope: "JP",
          issue_id: meeting.issueID || null,
          session: meeting.session ?? null,
          house: meeting.nameOfHouse || null,
          meeting_name: meeting.nameOfMeeting || null,
          issue: meeting.issue || null,
          closing: meeting.closing ?? null,
          speaker_count: speakerCount,
          result_total: resultTotal,
          result_next_record: nextRecordPosition,
          query_from: range.from,
          query_until: range.until,
          transcript_stored: false
        }
      },
      fetchedAt
    );
  });

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchJapanMetiLatest({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getText("https://www.meti.go.jp/ml_index_en_atom.xml", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data)
    .slice(0, 40)
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
          author: item.author,
          publisher: "Ministry of Economy, Trade and Industry, Japan",
          publisherKey: "jp-meti",
          language: "en",
          domains: classifyMetiDomains(`${item.title || ""} ${item.description || ""}`),
          tags: ["japan", "meti", "official-release", ...item.categories],
          rawMetadata: {
            event_eligible: false,
            evidence_support: true,
            source_scope: "JP",
            categories: item.categories
          }
        },
        fetchedAt
      )
    );

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchTaiwanExecutiveYuan({ source, http, now }) {
  return fetchTaiwanOfficialFeed({
    source,
    http,
    now,
    url: "https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3",
    publisher: "行政院",
    publisherKey: "tw-executive-yuan",
    sourceTag: "executive-yuan"
  });
}

async function fetchTaiwanMofa({ source, http, now }) {
  const startedAt = now();
  const url = "https://www.mofa.gov.tw/News.aspx?PageSize=30&n=96&sms=74";
  const fetch = await http.getText(url, { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const items = parseTaiwanMofaNewsList(fetch.data);
  if (items.length === 0) {
    throw new Error("MOFA news list yielded no parseable press-release rows");
  }

  const documents = items.slice(0, 30).map((item) =>
    createIntelDocument(
      source,
      {
        externalId: item.url,
        canonicalUrl: item.url,
        title: item.title,
        publishedAt: `${item.publishedDate}T00:00:00+08:00`,
        fetchedAt,
        publisher: "中華民國外交部",
        publisherKey: "tw-mofa",
        language: "zh-TW",
        domains: [{ domain: "politics", confidence: 0.95 }],
        tags: ["taiwan", "mofa", "official-release"],
        rawMetadata: {
          event_eligible: false,
          evidence_support: true,
          source_scope: "TW",
          timestamp_precision: "date",
          listing_page: true
        }
      },
      fetchedAt
    )
  );

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchTaiwanOfficialFeed({ source, http, now, url, publisher, publisherKey, sourceTag }) {
  const startedAt = now();
  const fetch = await http.getText(url, { timeoutMs: source.timeoutMs });
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
          author: item.author,
          publisher,
          publisherKey,
          language: "zh-TW",
          domains: [{ domain: "politics", confidence: 0.95 }],
          tags: ["taiwan", sourceTag, "official-release", ...item.categories],
          media: item.media,
          rawMetadata: {
            event_eligible: false,
            evidence_support: true,
            source_scope: "TW",
            categories: item.categories
          }
        },
        fetchedAt
      )
    );

  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function parseTaiwanGovernmentTimestamp(value) {
  const text = cleanText(value, 100);
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)\s*(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return toIsoTimestamp(text);
  }

  const [, year, month, day, meridiem, hourText, minute, second] = match;
  let hour = Number(hourText) % 12;
  if (meridiem === "下午") hour += 12;
  const localTimestamp = `${year}-${padTime(month)}-${padTime(day)}T${padTime(hour)}:${minute}:${second}+08:00`;
  return toIsoTimestamp(localTimestamp);
}

function parseTaiwanMofaNewsList(value) {
  const html = String(value || "");
  const rowPattern = /<td\b[^>]*data-title=["']發布時間["'][^>]*>[\s\S]*?<span\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>[\s\S]*?<td\b[^>]*data-title=["']主旨["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']*News_Content\.aspx\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const items = [];

  for (const match of html.matchAll(rowPattern)) {
    const publishedDate = match[1];
    const url = resolveOfficialUrl(match[2].replace(/&amp;/gi, "&"), "https://www.mofa.gov.tw/");
    const title = cleanText(match[3], 1000);
    if (!publishedDate || !url || !title) continue;
    items.push({ publishedDate, url, title });
  }

  return items;
}

function removeInlineSpanMarkup(value) {
  return String(value || "").replace(/<\/?span\b[^>]*>/gi, "");
}

function resolveOfficialUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(String(value), baseUrl).toString();
  } catch {
    return null;
  }
}

function boundedMeetingDateRange(catchup, referenceTimestamp) {
  const reference = Number.isFinite(Date.parse(referenceTimestamp)) ? new Date(referenceTimestamp) : new Date();
  const until = isoDate(catchup?.to) || reference.toISOString().slice(0, 10);
  const fallbackFrom = new Date(reference.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = isoDate(catchup?.from) || fallbackFrom;
  return from <= until ? { from, until } : { from: until, until: from };
}

function isoDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function classifyMetiDomains(value) {
  const text = String(value || "").toLowerCase();
  const domains = [{ domain: "politics", confidence: 0.8 }];
  if (/\b(ai|artificial intelligence|semiconductor|cyber|digital|patent|intellectual property|robot|quantum|software|telecom)/i.test(text)) {
    domains.push({ domain: "technology", confidence: 0.9 });
  }
  if (/\b(trade|tariff|anti-dumping|investment|corporate|economy|economic|finance|financial|energy|supply chain|export control)/i.test(text)) {
    domains.push({ domain: "finance", confidence: 0.85 });
  }
  return domains;
}

function padTime(value) {
  return String(value).padStart(2, "0");
}
