import { parseCsv, parseRocTimestamp, safeNumber } from "./core/utils.js";
import { sourceFetchResult } from "./atlasContracts.js";
import { parseFeedItems } from "./atlasParsers.js";
import { createIntelDocument, dedupeDocuments } from "./documents/normalize.js";

export const financeSources = [
  {
    id: "twse-material-info",
    name: "TWSE Listed Company Material Information",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "financial_release",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://mops.twse.com.tw/mops/web/t05st01",
    docsUrl: "https://openapi.twse.com.tw/",
    attribution: "臺灣證券交易所",
    policyNote: "Official listed-company material information. Preserve company code, fact date and original disclosure context.",
    cadenceMs: 10 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTwseMaterialInfo
  },
  {
    id: "sec-current-filings",
    name: "SEC EDGAR Current Filings",
    providerType: "atom",
    sourceClass: "official_feed",
    authorityClass: "official",
    documentType: "financial_release",
    domains: ["finance"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.sec.gov/edgar/search/",
    docsUrl: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    attribution: "U.S. Securities and Exchange Commission",
    policyNote: "A descriptive SEC_USER_AGENT with contact information is required; comply with SEC fair-access policy.",
    cadenceMs: 10 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: ["secUserAgent"],
    run: fetchSecFilings
  },
  {
    id: "coingecko-price",
    name: "CoinGecko Simple Price",
    providerType: "json_api",
    sourceClass: "market_data",
    authorityClass: "aggregator",
    documentType: "market_observation",
    domains: ["finance"],
    languages: ["en"],
    countries: [],
    homepage: "https://www.coingecko.com/",
    docsUrl: "https://docs.coingecko.com/reference/simple-price",
    attribution: "CoinGecko",
    policyNote: "Context only; a price snapshot is not automatically a news Event.",
    cadenceMs: 10 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchCoinGecko
  },
  {
    id: "frankfurter-fx",
    name: "Frankfurter FX Reference",
    providerType: "json_api",
    sourceClass: "market_data",
    authorityClass: "aggregator",
    documentType: "market_observation",
    domains: ["finance"],
    languages: ["en"],
    countries: [],
    homepage: "https://www.frankfurter.app/",
    docsUrl: "https://www.frankfurter.app/docs/",
    attribution: "Frankfurter",
    policyNote: "Reference-rate context, not a trading feed or an Event by itself.",
    cadenceMs: 12 * 60 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchFrankfurter
  },
  {
    id: "fred-macro",
    name: "FRED Macroeconomic Series",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "market_observation",
    domains: ["finance"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://fred.stlouisfed.org/",
    docsUrl: "https://fred.stlouisfed.org/docs/api/fred/",
    attribution: "Federal Reserve Bank of St. Louis",
    policyNote: "API key required. Preserve observation date and revision/vintage semantics; values are context unless a separate rule promotes them.",
    cadenceMs: 6 * 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: ["fredApiKey"],
    run: fetchFred
  },
  {
    id: "ecb-exchange-rates",
    name: "ECB Data Portal Exchange Rates",
    providerType: "csv_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "market_observation",
    domains: ["finance"],
    languages: ["en"],
    countries: ["EU"],
    homepage: "https://data.ecb.europa.eu/",
    docsUrl: "https://data.ecb.europa.eu/help/api/data",
    attribution: "European Central Bank",
    policyNote: "Official reference rates. Treat revisions and observation dates explicitly; do not turn each rate into an Event.",
    cadenceMs: 12 * 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchEcb
  },
  {
    id: "world-bank-indicators",
    name: "World Bank Indicators API",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "market_observation",
    domains: ["finance"],
    languages: ["en"],
    countries: [],
    homepage: "https://data.worldbank.org/",
    docsUrl: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
    attribution: "World Bank",
    policyNote: "Low-frequency macro context. Keep indicator definition, year and missing values explicit.",
    cadenceMs: 24 * 60 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchWorldBank
  }
];

async function fetchTwseMaterialInfo({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://openapi.twse.com.tw/v1/opendata/t187ap04_L", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const rows = Array.isArray(fetch.data) ? fetch.data : [];
  const documents = rows.slice(0, 100).map((row) => {
    const title = row["主旨 "] ?? row["主旨"];
    const observedAt = parseRocTimestamp(row["發言日期"] || row["事實發生日"], row["發言時間"]);
    const factDate = parseRocTimestamp(row["事實發生日"]);
    const companyCode = String(row["公司代號"] || "").trim();
    const companyName = String(row["公司名稱"] || "").trim();
    const externalId = `${companyCode}:${row["發言日期"] || ""}:${row["發言時間"] || ""}:${title || ""}`;
    return createIntelDocument(
      source,
      {
        externalId,
        canonicalUrl: source.homepage,
        title: companyName ? `${companyName} (${companyCode})：${title}` : title,
        summary: row["說明"],
        publishedAt: observedAt,
        observedAt: factDate || observedAt,
        fetchedAt,
        publisher: companyName || "TWSE listed company",
        publisherKey: companyCode ? `twse-company:${companyCode}` : "twse",
        language: "zh-TW",
        domains: [{ domain: "finance", confidence: 1 }],
        eventTypeCandidate: "finance.corporate",
        eventKey: `twse-disclosure:${externalId}`,
        tags: ["twse", "重大訊息", companyCode, companyName, row["符合條款"]],
        location: { label: "Taiwan", countryCode: "TW", precision: "issuer", confidence: 0.8 },
        rawMetadata: {
          event_eligible: true,
          company_code: companyCode,
          company_name: companyName,
          clause: row["符合條款"] || null,
          fact_date: factDate,
          statement_date: observedAt
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchSecFilings({ source, http, config, now }) {
  const startedAt = now();
  if (!/@/.test(config.providers.secUserAgent || "")) {
    throw new Error("SEC_USER_AGENT must include a contact email address");
  }
  const url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=40";
  const fetch = await http.getText(url, {
    timeoutMs: source.timeoutMs,
    userAgent: config.providers.secUserAgent,
    retries: 0
  });
  const fetchedAt = now();
  const documents = parseFeedItems(fetch.data).map((item) => {
    const form = item.categories[0] || item.title.match(/\(([A-Z0-9-]+)\)/)?.[1] || "filing";
    const eligible = /^(8-K|6-K|10-K|10-Q|20-F|40-F)$/i.test(form);
    return createIntelDocument(
      source,
      {
        externalId: item.id || item.link,
        canonicalUrl: item.link,
        title: item.title,
        summary: item.description,
        publishedAt: item.publishedAt,
        fetchedAt,
        author: item.author,
        publisher: item.author || "SEC filer",
        publisherKey: item.author ? `sec-filer:${item.author.toLowerCase()}` : "sec-edgar",
        language: "en",
        domains: [{ domain: "finance", confidence: 1 }],
        eventTypeCandidate: "finance.corporate",
        eventKey: item.id ? `sec-filing:${item.id}` : null,
        tags: ["sec", "edgar", form],
        media: item.media,
        location: { label: "United States", countryCode: "US", precision: "issuer", confidence: 0.6 },
        rawMetadata: { event_eligible: eligible, form, categories: item.categories }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchCoinGecko({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true",
    { timeoutMs: source.timeoutMs, retries: 0 }
  );
  const fetchedAt = now();
  const bucket = fetchedAt.slice(0, 16);
  const documents = Object.entries(fetch.data || {}).map(([asset, payload]) => {
    const change = safeNumber(payload.usd_24h_change, 0);
    const price = safeNumber(payload.usd);
    return createIntelDocument(
      source,
      {
        externalId: `${asset}:${bucket}`,
        canonicalUrl: `https://www.coingecko.com/en/coins/${asset}`,
        title: `${capitalize(asset)} ${formatUsd(price)} (${formatPercent(change)} 24h)`,
        summary: "Crypto market observation used as liquidity and risk-sentiment context.",
        observedAt: payload.last_updated_at ? new Date(payload.last_updated_at * 1000).toISOString() : fetchedAt,
        fetchedAt,
        publisher: "CoinGecko",
        publisherKey: "coingecko",
        language: "en",
        domains: [{ domain: "finance", confidence: 0.85 }],
        eventTypeCandidate: "finance.market_move",
        rawSeverity: Math.abs(change) >= 12 ? "high" : Math.abs(change) >= 8 ? "medium" : "low",
        tags: ["coingecko", "crypto", asset],
        rawMetadata: { event_eligible: Math.abs(change) >= 12, asset, price_usd: price, change_24h_percent: change }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchFrankfurter({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,TWD", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const rates = fetch.data?.rates || {};
  const rateText = Object.entries(rates)
    .map(([currency, value]) => `${currency} ${safeNumber(value, 0).toFixed(4)}`)
    .join(", ");
  const documents = rateText
    ? [
        createIntelDocument(
          source,
          {
            externalId: `USD:${fetch.data.date}`,
            canonicalUrl: source.homepage,
            title: `USD reference FX snapshot: ${rateText}`,
            summary: "Daily reference exchange-rate context.",
            observedAt: fetch.data.date,
            fetchedAt,
            publisher: "Frankfurter",
            publisherKey: "frankfurter",
            language: "en",
            domains: [{ domain: "finance", confidence: 0.8 }],
            eventTypeCandidate: "finance.currency",
            tags: ["fx", "usd", ...Object.keys(rates)],
            rawMetadata: { event_eligible: false, base: fetch.data.base || "USD", rates }
          },
          fetchedAt
        )
      ]
    : [];
  return sourceFetchResult(source, fetch, documents, startedAt, fetchedAt);
}

async function fetchFred({ source, http, config, now }) {
  const startedAt = now();
  const seriesIds = ["CPIAUCSL", "UNRATE", "FEDFUNDS", "DGS10"];
  const fetches = [];
  const documents = [];
  const fetchedAt = now();
  for (const seriesId of seriesIds) {
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", config.providers.fredApiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "2");
    const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, retries: 0 });
    fetches.push(fetch);
    const observation = Array.isArray(fetch.data?.observations) ? fetch.data.observations.find((item) => item.value !== ".") : null;
    if (!observation) {
      continue;
    }
    documents.push(
      createIntelDocument(
        source,
        {
          externalId: `${seriesId}:${observation.date}:${observation.realtime_start || ""}`,
          canonicalUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
          title: `${seriesId}: ${observation.value} (${observation.date})`,
          summary: "FRED macroeconomic observation; consult the series metadata for units and revision semantics.",
          observedAt: observation.date,
          fetchedAt,
          publisher: "Federal Reserve Bank of St. Louis",
          publisherKey: "fred",
          language: "en",
          domains: [{ domain: "finance", confidence: 1 }],
          eventTypeCandidate: fredEventType(seriesId),
          tags: ["fred", "macro", seriesId],
          location: { label: "United States", countryCode: "US", precision: "country", confidence: 1 },
          rawMetadata: { event_eligible: false, raw_fetch_index: fetches.length - 1, series_id: seriesId, observation }
        },
        fetchedAt
      )
    );
  }
  return sourceFetchResult(source, fetches, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchEcb({ source, http, now }) {
  const startedAt = now();
  const url = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+GBP+CHF.EUR.SP00.A?format=csvdata&lastNObservations=2";
  const fetch = await http.getText(url, { timeoutMs: source.timeoutMs, accept: "text/csv" });
  const fetchedAt = now();
  const documents = parseCsv(fetch.data).map((row) =>
    createIntelDocument(
      source,
      {
        externalId: `${row.KEY}:${row.TIME_PERIOD}`,
        canonicalUrl: source.homepage,
        title: `${row.CURRENCY}/${row.CURRENCY_DENOM} ECB reference rate ${row.OBS_VALUE}`,
        summary: row.TITLE_COMPL || row.TITLE,
        observedAt: row.TIME_PERIOD,
        fetchedAt,
        publisher: "European Central Bank",
        publisherKey: "ecb",
        language: "en",
        domains: [{ domain: "finance", confidence: 1 }],
        eventTypeCandidate: "finance.currency",
        tags: ["ecb", "fx", row.CURRENCY, row.CURRENCY_DENOM],
        location: { label: "European Union", countryCode: "EU", precision: "issuer", confidence: 1 },
        rawMetadata: { event_eligible: false, series_key: row.KEY, value: safeNumber(row.OBS_VALUE), status: row.OBS_STATUS }
      },
      fetchedAt
    )
  );
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchWorldBank({ source, http, now }) {
  const startedAt = now();
  const url = "https://api.worldbank.org/v2/country/USA;CHN;JPN;DEU/indicator/FP.CPI.TOTL.ZG?format=json&mrv=1&per_page=20";
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const rows = Array.isArray(fetch.data?.[1]) ? fetch.data[1] : [];
  const documents = rows
    .filter((row) => row?.value !== null && row?.value !== undefined)
    .map((row) =>
      createIntelDocument(
        source,
        {
          externalId: `${row.indicator?.id}:${row.countryiso3code}:${row.date}`,
          canonicalUrl: `https://data.worldbank.org/indicator/${row.indicator?.id}?locations=${row.countryiso3code}`,
          title: `${row.country?.value}: ${row.indicator?.value} ${safeNumber(row.value, 0).toFixed(2)} (${row.date})`,
          summary: "Most recent World Bank indicator observation; publication lag and later revisions may apply.",
          observedAt: `${row.date}-12-31`,
          fetchedAt,
          publisher: "World Bank",
          publisherKey: "world-bank",
          language: "en",
          domains: [{ domain: "finance", confidence: 0.9 }],
          eventTypeCandidate: "finance.inflation",
          tags: ["world-bank", "macro", row.indicator?.id, row.countryiso3code],
          location: { label: row.country?.value, countryCode: iso3ToIso2(row.countryiso3code), precision: "country", confidence: 1 },
          rawMetadata: { event_eligible: false, indicator: row.indicator, value: row.value, year: row.date, status: row.obs_status }
        },
        fetchedAt
      )
    );
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function fredEventType(seriesId) {
  if (seriesId === "CPIAUCSL") return "finance.inflation";
  if (seriesId === "UNRATE") return "finance.employment";
  if (seriesId === "FEDFUNDS") return "finance.interest_rate";
  return "finance.credit";
}

function iso3ToIso2(code) {
  return { USA: "US", CHN: "CN", JPN: "JP", DEU: "DE" }[String(code || "").toUpperCase()] || null;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "Asset";
}

function formatUsd(value) {
  const number = safeNumber(value);
  return number === null ? "USD n/a" : `USD ${number.toLocaleString("en-US", { maximumFractionDigits: number >= 100 ? 0 : 2 })}`;
}

function formatPercent(value) {
  const number = safeNumber(value, 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}
