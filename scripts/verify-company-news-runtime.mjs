const baseUrl = String(process.argv[2] || "http://127.0.0.1:43220").replace(/\/$/, "");
const locators = [
  ["TWSE", "2330"],
  ["TWSE", "2317"],
  ["TWSE", "2454"],
  ["TWSE", "3035"],
  ["TPEX", "6488"]
];

const healthBefore = await getJson(`${baseUrl}/api/v1/health`);
const checks = [];
for (const [exchange, symbol] of locators) {
  const rest = await getJson(`${baseUrl}/api/v1/stocks/${exchange}/${symbol}?limit=20`);
  const mcp = await callMcp(`${baseUrl}/mcp`, "atlas.company.snapshot", { exchange, symbol, limit: 20 });
  const mcpPayload = mcp.result?.structuredContent;
  const restDocumentIds = (rest.data?.latest_documents || []).map((document) => document.id);
  const mcpDocumentIds = (mcpPayload?.data?.latest_documents || []).map((document) => document.id);
  const check = {
    exchange,
    symbol,
    entity_id: rest.data?.entity?.id || null,
    canonical_name: rest.data?.entity?.canonical_name || null,
    general_news_status: rest.coverage?.general_news?.status || null,
    general_news_documents_30d: Number(rest.coverage?.general_news?.document_count || 0),
    visible_document_count: restDocumentIds.length,
    yahoo_visible_count: (rest.data?.latest_documents || []).filter((document) => document.source_id === "yahoo-tw-stock-news").length,
    rest_mcp_entity_parity: rest.data?.entity?.id === mcpPayload?.data?.entity?.id,
    rest_mcp_document_parity: JSON.stringify(restDocumentIds) === JSON.stringify(mcpDocumentIds)
  };
  check.ok = Boolean(check.entity_id)
    && check.general_news_status === "current"
    && check.general_news_documents_30d > 0
    && check.yahoo_visible_count > 0
    && check.rest_mcp_entity_parity
    && check.rest_mcp_document_parity;
  checks.push(check);
}
const sources = await getJson(`${baseUrl}/api/v1/sources`);
const companyNews = await getJson(`${baseUrl}/api/v1/company-news?market=TWSE&market=TPEX&limit=20`);
const yahoo = sources.data?.find?.((source) => source.id === "yahoo-tw-stock-news")
  || sources.data?.items?.find((source) => source.id === "yahoo-tw-stock-news")
  || sources.items?.find((source) => source.id === "yahoo-tw-stock-news")
  || null;
const healthAfter = await getJson(`${baseUrl}/api/v1/health`);
const storageKeys = ["source_runs", "source_target_runs", "documents", "document_observations", "stories", "events"];
const readOnlyParity = storageKeys.every((key) => healthBefore.storage?.[key] === healthAfter.storage?.[key]);
const schedulerEnabled = healthBefore.scheduler?.enabled === true || healthAfter.scheduler?.enabled === true;
const readBoundary = schedulerEnabled
  ? { status: "covered_by_in_process_contract_test", cross_request_storage_parity: readOnlyParity }
  : { status: readOnlyParity ? "passed" : "failed", cross_request_storage_parity: readOnlyParity };
const companyNewsOk = companyNews.profile === "company_news_latest_v1"
  && companyNews.coverage?.guarantee === "best_effort"
  && Number(companyNews.coverage?.enabled_targets || 0) >= 5
  && (companyNews.data || []).some((document) => document.source_id === "yahoo-tw-stock-news"
    && document.source_attribution === "Yahoo股市"
    && document.rights?.attribution_required === true
    && (document.companies || []).length > 0);
const result = {
  ok: checks.every((check) => check.ok)
    && yahoo?.enabled === true
    && yahoo?.health?.targets?.registered >= 5
    && yahoo?.health?.targets?.failed === 0
    && companyNewsOk
    && (schedulerEnabled || readOnlyParity),
  base_url: baseUrl,
  checks,
  company_news: {
    ok: companyNewsOk,
    profile: companyNews.profile,
    document_count: companyNews.data?.length || 0,
    coverage: companyNews.coverage,
    freshness: companyNews.freshness
  },
  yahoo_source_health: yahoo?.health || null,
  get_read_boundary: readBoundary
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function callMcp(url, name, input) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-${input.exchange}-${input.symbol}`,
      method: "tools/call",
      params: {
        name,
        arguments: input,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "atlas-company-news-runtime", version: "1.0.0" }
        }
      }
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${name} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(text);
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find(Boolean);
  if (!data) throw new Error(`MCP ${name} returned neither JSON nor SSE data`);
  return JSON.parse(data);
}
