import { createSourceResult } from "../../atlasContracts.js";
import { parseRocTimestamp } from "../../core/utils.js";
import { createIntelDocument, dedupeDocuments } from "../../documents/normalize.js";

export const taiwanCompanySources = [
  {
    id: "twse-company-master",
    name: "TWSE Listed Company Master",
    providerType: "official_json_api",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "company_master",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.twse.com.tw/",
    docsUrl: "https://openapi.twse.com.tw/",
    attribution: "臺灣證券交易所",
    policyNote: "Complete listed-company master snapshot. Absence only has lifecycle meaning after a complete, non-truncated snapshot.",
    coverage: { capabilities: ["company.master", "security.master"], markets: ["TWSE"], guarantee: "complete_snapshot", recoverability: "latest_only" },
    cadenceMs: 24 * 60 * 60 * 1000,
    timeoutMs: 20000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTwseCompanyMaster
  },
  {
    id: "tpex-company-master",
    name: "TPEx Listed Company Master",
    providerType: "official_json_api",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "company_master",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.tpex.org.tw/",
    docsUrl: "https://www.tpex.org.tw/openapi/",
    attribution: "證券櫃檯買賣中心",
    policyNote: "Complete TPEx listed-company master snapshot; emerging-market companies remain a separate future source.",
    coverage: { capabilities: ["company.master", "security.master"], markets: ["TPEx"], guarantee: "complete_snapshot", recoverability: "latest_only" },
    cadenceMs: 24 * 60 * 60 * 1000,
    timeoutMs: 20000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTpexCompanyMaster
  },
  {
    id: "tpex-emerging-company-master",
    name: "TPEx Emerging Stock Company Master",
    providerType: "official_json_api",
    sourceClass: "official_registry",
    authorityClass: "official",
    documentType: "company_master",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://www.tpex.org.tw/",
    docsUrl: "https://www.tpex.org.tw/openapi/",
    attribution: "證券櫃檯買賣中心",
    policyNote: "Complete emerging-stock company master snapshot. Official disclosure coverage remains a separately evidenced capability.",
    coverage: { capabilities: ["company.master", "security.master"], markets: ["ESB"], guarantee: "complete_snapshot", recoverability: "latest_only" },
    cadenceMs: 24 * 60 * 60 * 1000,
    timeoutMs: 20000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTpexEmergingCompanyMaster
  },
  {
    id: "tpex-material-info",
    name: "TPEx Company Material Information",
    providerType: "official_json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "financial_release",
    domains: ["finance"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://mops.twse.com.tw/mops/web/t05st01",
    docsUrl: "https://www.tpex.org.tw/openapi/",
    attribution: "證券櫃檯買賣中心",
    policyNote: "Official TPEx daily material information with structured issuer hints.",
    coverage: { capabilities: ["company.disclosures"], markets: ["TPEx"], guarantee: "bounded_window", recoverability: "provider_history" },
    cadenceMs: 10 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchTpexMaterialInfo
  }
];

export async function fetchTwseCompanyMaster({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", { timeoutMs: source.timeoutMs });
  return companyMasterResult(source, fetch, "TWSE", startedAt, now());
}

export async function fetchTpexCompanyMaster({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O", { timeoutMs: source.timeoutMs });
  return companyMasterResult(source, fetch, "TPEx", startedAt, now());
}

export async function fetchTpexEmergingCompanyMaster({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R", { timeoutMs: source.timeoutMs });
  return companyMasterResult(source, fetch, "ESB", startedAt, now());
}

export function companyMasterResult(source, fetch, exchange, startedAt, finishedAt) {
  if (Number(fetch.status) === 304) {
    return createSourceResult({
      source,
      fetches: fetch,
      startedAt,
      finishedAt,
      counts: { upstream_item_count: null, processed_item_count: 0 },
      completeness: { status: "unknown", snapshot_complete: false, truncated: false },
      warnings: ["not_modified_reuses_prior_master_snapshot"]
    });
  }
  const rows = requireArrayPayload(fetch, source.id);
  const mapped = rows.map((row) => masterEntities(row, exchange)).filter(Boolean);
  const entities = uniqueBy(mapped.flatMap((item) => item.entities), (item) => item.id);
  const relations = uniqueBy(mapped.map((item) => item.relation), (item) => `${item.from_entity_id}|${item.relation_type}|${item.to_entity_id}`);
  const failed = rows.length - mapped.length;
  const empty = rows.length === 0;
  const warnings = [
    ...(failed > 0 ? [`invalid_required_fields:${failed}`] : []),
    ...(empty ? ["empty_master_snapshot"] : [])
  ];
  return createSourceResult({
    source,
    fetches: fetch,
    entities,
    relations,
    masterItems: mapped.map((item) => ({
      key: `${exchange}:${item.key}`,
      entities: item.entities,
      relations: [item.relation]
    })),
    startedAt,
    finishedAt,
    counts: {
      upstream_item_count: rows.length,
      processed_item_count: mapped.length,
      failed_count: failed
    },
    completeness: {
      status: failed === 0 && !empty ? "complete" : "partial",
      snapshot_complete: failed === 0 && !empty,
      truncated: false
    },
    warnings
  });
}

export async function fetchTpexMaterialInfo({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  if (Number(fetch.status) === 304) return notModifiedResult(source, fetch, startedAt, fetchedAt, "disclosure");
  const rows = requireArrayPayload(fetch, source.id);
  const candidates = rows.map((row) => materialDocument(source, row, "TPEx", fetchedAt)).filter(Boolean);
  const failed = rows.length - candidates.length;
  const documents = dedupeDocuments(candidates);
  return createSourceResult({
    source,
    fetches: fetch,
    documents,
    startedAt,
    finishedAt: fetchedAt,
    counts: {
      upstream_item_count: rows.length,
      processed_item_count: candidates.length,
      failed_count: failed
    },
    completeness: { status: failed === 0 ? "complete" : "partial", truncated: false },
    warnings: failed > 0 ? [`invalid_required_fields:${failed}`] : []
  });
}

function notModifiedResult(source, fetch, startedAt, finishedAt, kind) {
  return createSourceResult({
    source,
    fetches: fetch,
    startedAt,
    finishedAt,
    counts: { upstream_item_count: null, processed_item_count: 0 },
    completeness: { status: "unknown", snapshot_complete: false, truncated: false },
    warnings: [`not_modified_reuses_prior_${kind}`]
  });
}

function requireArrayPayload(fetch, sourceId) {
  if (!Array.isArray(fetch?.data)) {
    throw new TypeError(`${sourceId} returned unsupported_shape: expected an array payload`);
  }
  return fetch.data;
}

function masterEntities(row, exchange) {
  const twse = exchange === "TWSE";
  const companyCode = text(twse ? row["公司代號"] : row.SecuritiesCompanyCode);
  const companyName = text(twse ? row["公司名稱"] : row.CompanyName);
  if (!companyCode || !companyName) return null;
  const abbreviation = text(twse ? row["公司簡稱"] : row.CompanyAbbreviation);
  const englishSymbol = text(twse ? row["英文簡稱"] : row.Symbol);
  const businessNumber = text(twse ? row["營利事業統一編號"] : row["UnifiedBusinessNo."]);
  const companyId = businessNumber ? `company:tw:${businessNumber}` : `company:${exchange.toLowerCase()}:${companyCode}`;
  const securityId = `security:${exchange.toLowerCase()}:${companyCode}`;
  const common = {
    industry_code: text(twse ? row["產業別"] : row.SecuritiesIndustryCode),
    address: text(twse ? row["住址"] : row.Address),
    incorporation_date: text(twse ? row["成立日期"] : row.DateOfIncorporation),
    listing_date: text(twse ? row["上市日期"] : row.DateOfListing),
    website: text(twse ? row["網址"] : row.WebAddress),
    paid_in_capital_twd: numberText(twse ? row["實收資本額"] : row["Paidin.Capital.NTDollars"]),
    issued_shares: numberText(twse ? row["已發行普通股數或TDR原股發行股數"] : row.IssueShares),
    exchange,
    ticker: companyCode,
    observed_date: text(twse ? row["出表日期"] : row.Date)
  };
  const companyIdentifiers = businessNumber
    ? [{ namespace: "business_registration", authority: "Taiwan MOEA", scope: "TW", value: businessNumber }]
    : [];
  return {
    key: companyCode,
    entities: [
      {
        id: companyId,
        entity_type: "company",
        canonical_name: companyName,
        country_code: "TW",
        master_authority: "official",
        aliases: [abbreviation, englishSymbol].filter(Boolean),
        identifiers: companyIdentifiers,
        metadata: common
      },
      {
        id: securityId,
        entity_type: "security",
        canonical_name: `${abbreviation || companyName} ${companyCode}`,
        country_code: "TW",
        master_authority: "official",
        aliases: [companyCode, abbreviation, englishSymbol].filter(Boolean),
        identifiers: [{ namespace: "ticker", authority: exchange, scope: exchange, value: companyCode }],
        metadata: { exchange, ticker: companyCode, security_type: "common_stock", issuer_entity_id: companyId }
      }
    ],
    relation: {
      from_entity_id: companyId,
      to_entity_id: securityId,
      relation_type: "listed_as",
      confidence: 1,
      method: "official_master"
    }
  };
}

function materialDocument(source, row, exchange, fetchedAt) {
  const tpex = exchange === "TPEx";
  const companyCode = text(tpex ? row.SecuritiesCompanyCode : row["公司代號"]);
  const companyName = text(tpex ? row.CompanyName : row["公司名稱"]);
  const title = text(row["主旨 "] ?? row["主旨"]);
  if (!companyCode || !title) return null;
  const observedAt = parseRocTimestamp(row["發言日期"] || row.Date || row["事實發生日"], row["發言時間"]);
  const factDate = parseRocTimestamp(row["事實發生日"]);
  const externalId = `${companyCode}:${row["發言日期"] || row.Date || ""}:${row["發言時間"] || ""}:${title}`;
  return createIntelDocument(source, {
    externalId,
    canonicalUrl: disclosureUrl(source.homepage, companyCode, row["發言日期"] || row.Date, row["發言時間"]),
    title: companyName ? `${companyName} (${companyCode})：${title}` : title,
    summary: row["說明"],
    publishedAt: observedAt,
    observedAt: factDate || observedAt,
    fetchedAt,
    publisher: companyName || `${exchange} company`,
    publisherKey: `${exchange.toLowerCase()}-company:${companyCode}`,
    language: "zh-TW",
    domains: [{ domain: "finance", confidence: 1 }],
    eventTypeCandidate: "finance.corporate",
    eventKey: `${exchange.toLowerCase()}-disclosure:${externalId}`,
    tags: [exchange.toLowerCase(), "重大訊息", companyCode, companyName, row["符合條款"]],
    location: { label: "Taiwan", countryCode: "TW", precision: "issuer", confidence: 0.8 },
    rawMetadata: {
      disclosure_type: "company_material_information",
      company_code: companyCode,
      company_name: companyName,
      exchange,
      entity_hints: [{
        name: companyName,
        role: "issuer",
        confidence: 1,
        identifier: { namespace: "ticker", authority: exchange, scope: exchange, value: companyCode }
      }],
      clause: row["符合條款"] || null,
      fact_date: factDate,
      statement_date: observedAt
    }
  }, fetchedAt);
}

function text(value) {
  return String(value ?? "").replace(/[\u3000\s]+/g, " ").trim();
}

function numberText(value) {
  const normalized = text(value).replace(/,/g, "");
  return /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function uniqueBy(values, keyOf) {
  const result = new Map();
  for (const value of values) result.set(keyOf(value), value);
  return [...result.values()];
}

function disclosureUrl(homepage, companyCode, date, time) {
  const url = new URL(homepage);
  url.searchParams.set("co_id", companyCode);
  if (date) url.searchParams.set("date", String(date));
  if (time) url.searchParams.set("time", String(time));
  return url.toString();
}
