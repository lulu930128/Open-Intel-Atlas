import { createSourceResult } from "../../atlasContracts.js";
import { relevanceMetadata } from "../../entities/companyNewsRelevance.js";
import { parseFeedItems } from "../../atlasParsers.js";
import { createIntelDocument, dedupeDocuments } from "../../documents/normalize.js";

const INITIAL_TARGETS = [
  ["TWSE", "2330", 10],
  ["TWSE", "2317", 20],
  ["TWSE", "2454", 30],
  ["TWSE", "3035", 40],
  ["TPEX", "6488", 50]
];

export const taiwanCompanyNewsSources = [{
  id: "yahoo-tw-stock-news",
  name: "Yahoo Taiwan Stock News RSS",
  providerType: "targeted_rss",
  sourceClass: "news_aggregator",
  authorityClass: "aggregator",
  documentType: "news",
  domains: ["finance"],
  languages: ["zh-TW"],
  countries: ["TW"],
  homepage: "https://tw.stock.yahoo.com/",
  docsUrl: "https://tw.stock.yahoo.com/rss-help",
  attribution: "Yahoo股市",
  policyNote: "Ticker-scoped discovery feed. Personal, non-commercial use only. Store feed metadata and links, not article full text. Yahoo is the discovery provider; publisher remains unknown when the feed does not identify it.",
  cadenceMs: 5 * 60 * 1000,
  timeoutMs: 12000,
  catchupMode: "latest_only",
  defaultEnabled: true,
  requiredConfig: [],
  allowedContentUsageContexts: ["personal_noncommercial"],
  targetBatchSize: 5,
  targetConcurrency: 1,
  coverage: {
    capabilities: ["company.news"],
    markets: ["TWSE", "TPEX"],
    guarantee: "best_effort",
    recoverability: "latest_only",
    notes: "Target-scoped RSS discovery; successful empty fetch is current coverage and does not fabricate a match."
  },
  targets: INITIAL_TARGETS.map(([authority, ticker, priorityTier]) => ({
    id: `yahoo-tw-stock-news:${authority}:${ticker}`,
    requestKey: ticker,
    identifier: { namespace: "ticker", authority, scope: authority, value: ticker },
    priorityTier,
    cadenceMs: 30 * 60 * 1000,
    enabled: true,
    policy: {
      target_origin: "definition",
      selection_reason: "release_canary",
      usage_context: "personal_noncommercial",
      query_scope: `${authority}:${ticker}`
    }
  })),
  runTarget: fetchYahooTwStockNewsTarget
}];

export async function fetchYahooTwStockNewsTarget({ source, target, http, config, now, identityContext = null }) {
  if (config.contentUsageContext !== "personal_noncommercial") {
    throw new Error("Yahoo Taiwan Stock RSS requires ATLAS_CONTENT_USAGE_CONTEXT=personal_noncommercial");
  }
  const startedAt = now();
  const url = `https://tw.stock.yahoo.com/rss?s=${encodeURIComponent(target.request_key)}`;
  const fetch = await http.getText(url, { timeoutMs: source.timeoutMs, retries: 0 });
  const finishedAt = now();
  if (Number(fetch.status) === 304) {
    return createSourceResult({
      source,
      fetches: fetch,
      startedAt,
      finishedAt,
      counts: { upstream_item_count: null, processed_item_count: 0 },
      completeness: { status: "unknown" },
      warnings: ["not_modified_reuses_prior_target_feed"]
    });
  }
  const xml = String(fetch.data || "");
  if (!/<(?:rss|rdf:RDF|feed)\b/i.test(xml) || !/<(?:channel|item|entry)\b/i.test(xml)) {
    throw new TypeError(`${source.id} target ${target.id} returned malformed_feed`);
  }
  const items = parseFeedItems(xml);
  const candidates = items.map((item) => {
    if (!item.title || !isAllowedYahooArticleUrl(item.link)) return null;
    return createIntelDocument(source, {
    externalId: item.id || item.link,
    canonicalUrl: item.link,
    title: item.title,
    summary: item.description,
    publishedAt: item.publishedAt,
    fetchedAt: finishedAt,
    author: item.author,
    publisher: "Unknown publisher",
    publisherKey: "unknown",
    language: "zh-TW",
    domains: [{ domain: "finance", confidence: 0.9 }],
    tags: ["yahoo-tw-stock-news", target.identifier.authority, target.identifier.value, ...item.categories],
    rawMetadata: {
      event_eligible: false,
      evidence_support: false,
      discovery_provider: "Yahoo Taiwan Stock",
      discovery_source_id: source.id,
      source_target_id: target.id,
      discovered_url: item.link || null,
      provider_query_scope: `${target.identifier.authority}:${target.identifier.value}`,
      ticker: target.identifier.value,
      exchange: target.identifier.authority,
      discovery_targets: [`${target.identifier.authority}:${target.identifier.value}`],
      ...relevanceMetadata(item, target, identityContext),
      attribution: source.attribution,
      rights: {
        usage_context: "personal_noncommercial",
        full_text_stored: false,
        attribution_required: true,
        advertising_allowed: false,
        source_link_required: true,
        requires_unmodified_display: true
      }
    }
  }, finishedAt);
  }).filter(Boolean);
  const documents = dedupeDocuments(candidates);
  const invalidCount = items.length - candidates.length;
  const duplicateCount = candidates.length - documents.length;

  return createSourceResult({
    source,
    fetches: fetch,
    documents,
    startedAt,
    finishedAt,
    counts: {
      upstream_item_count: items.length,
      processed_item_count: documents.length,
      intentionally_skipped_count: duplicateCount,
      failed_count: invalidCount
    },
    completeness: { status: invalidCount > 0 ? "partial" : "complete", truncated: false },
    warnings: invalidCount > 0 ? [`invalid_feed_items:${invalidCount}`] : []
  });
}

function isAllowedYahooArticleUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ["tw.stock.yahoo.com", "tw.news.yahoo.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
