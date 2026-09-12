import { companyPageState, parseStockLocator, primaryListing, buildStockNewsPath, stockTab, COMPANY_TABS } from "./stocksPageModel.js";
import { companyStockUrl } from "./newsroomQueryModel.js";
import { appendUniqueEvents } from "./domainPageModel.js";
import { mountStocksLanding } from "./stocksLanding.js";
import { mountDocumentLane } from "./companyLane.js";

const locator = parseStockLocator(window.location.search);
const newsState = { items: [], cursor: null, seen: new Set(), loading: false, envelope: null };
const elements = {
  plate: document.querySelector("#company-plate"),
  dossier: document.querySelector("#dossier"),
  error: document.querySelector("#page-error"),
  events: document.querySelector("#company-events"),
  documents: document.querySelector("#company-documents"),
  facts: document.querySelector("#identity-facts"),
  identifiers: document.querySelector("#identifier-list"),
  aliases: document.querySelector("#alias-list"),
  relations: document.querySelector("#relation-list")
};

if (locator.exchange) document.querySelector('[name="exchange"]').value = locator.exchange;
if (locator.symbol) document.querySelector('[name="symbol"]').value = locator.symbol;

document.querySelector("#ticker-search").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const exchange = String(data.get("exchange") || "").trim().toUpperCase();
  const symbol = String(data.get("symbol") || "").trim().toUpperCase();
  window.location.assign(`/stocks.html?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}`);
});

if (locator.exchange && locator.symbol) load();
else if (!new URLSearchParams(window.location.search).has("exchange") && !new URLSearchParams(window.location.search).has("symbol")) mountStocksLanding();
else renderError("公司代號格式不完整", "請提供市場與代號，例如 TWSE / 2330。");

async function load() {
  mountDocumentLane(document.querySelector("#stock-disclosures"), { path: `/api/v1/company-disclosures?exchange=${encodeURIComponent(locator.exchange)}&symbol=${encodeURIComponent(locator.symbol)}&limit=12`, profile: "company_disclosures_v1" });
  // Settle independently so a slow/failed news request cannot hide identity.
  await Promise.allSettled([
    readJson(`/api/v1/stocks/${encodeURIComponent(locator.exchange)}/${encodeURIComponent(locator.symbol)}`)
      .then(render).catch((error) => renderError("目前無法開啟公司檔案", String(error?.message || error))),
    loadNews()
  ]);
}

async function readJson(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error?.message || `${response.status} ${response.statusText}`);
  return payload;
}

function selectTab(tab, push = false) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    document.querySelector(`#panel-${button.dataset.tab}`).hidden = !active;
  }
  if (push) {
    const url = new URL(window.location.href);
    if (tab === "news") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
  }
}

document.querySelector(".company-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) selectTab(button.dataset.tab, true);
});
document.querySelector(".company-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
  const index = COMPANY_TABS.indexOf(event.target.dataset.tab);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
  selectTab(COMPANY_TABS[next], true);
  document.querySelector(`#tab-${COMPANY_TABS[next]}`).focus();
});
window.addEventListener("popstate", () => selectTab(stockTab(window.location.search)));
selectTab(stockTab(window.location.search));
document.querySelector("#news-more").addEventListener("click", () => void loadNews());

async function loadNews() {
  if (newsState.loading) return;
  const cursor = newsState.cursor;
  if (cursor && newsState.seen.has(cursor)) return;
  newsState.loading = true;
  const list = document.querySelector("#company-news");
  const more = document.querySelector("#news-more");
  const error = document.querySelector("#news-error");
  list.setAttribute("aria-busy", "true");
  more.disabled = true;
  error.textContent = "";
  try {
    const envelope = await readJson(buildStockNewsPath(locator, cursor));
    if (envelope.profile !== "company_news_stock_v1" || !Array.isArray(envelope.data)
        || envelope.stock?.exchange !== locator.exchange || envelope.stock?.symbol !== locator.symbol) {
      throw new Error("新聞回應與目前市場代號不一致，未顯示其他公司的內容。");
    }
    newsState.items = appendUniqueEvents(newsState.items, envelope.data, 200);
    newsState.envelope = envelope;
    if (cursor) newsState.seen.add(cursor);
    newsState.cursor = envelope.pagination?.next_cursor || null;
    if (newsState.cursor && newsState.seen.has(newsState.cursor)) {
      newsState.cursor = null;
      error.textContent = "後端回傳重複分頁位置，已停止載入；現有新聞仍可閱讀。";
    }
    renderNews();
    more.hidden = !newsState.cursor || newsState.items.length >= 200;
    more.textContent = "載入較早新聞";
    if (newsState.items.length >= 200 && newsState.cursor) error.textContent = "目前已顯示前 200 則新聞。";
  } catch (failure) {
    error.textContent = `新聞目前無法讀取：${failure.message}`;
    if (!newsState.envelope) {
      list.innerHTML = empty("公司資料、事件與證據仍可使用。可按下方按鈕重試新聞。");
      document.querySelector("#news-coverage").textContent = "新聞 coverage 無法確認";
    }
    more.hidden = false;
    more.textContent = "重試新聞";
  } finally {
    newsState.loading = false;
    more.disabled = false;
    list.setAttribute("aria-busy", "false");
  }
}

function renderNews() {
  const envelope = newsState.envelope;
  const coverage = envelope.coverage || {};
  const status = coverage.status || envelope.freshness?.status || "unknown";
  document.querySelector("#news-count").textContent = `已載入 ${newsState.items.length} 則`;
  document.querySelector("#news-coverage").innerHTML = `<strong>${escapeHtml(status === "current" ? "目前最新" : stateLabel(status))}</strong><span>${escapeHtml(locator.exchange)} ${escapeHtml(locator.symbol)} · 資料截至 ${escapeHtml(formatDate(envelope.freshness?.data_as_of))}</span><p>來源採集為盡力覆蓋；未觀測到新聞不代表公司沒有新聞。</p>${(envelope.warnings || []).map((warning) => `<p>${escapeHtml(warning.message || warning.code)}</p>`).join("")}`;
  document.querySelector("#company-news").innerHTML = newsState.items.length ? newsState.items.map((item) => {
    const url = item.canonical_url ? safeUrl(item.canonical_url) : null;
    const title = escapeHtml(item.title || "未命名新聞");
    const attribution = item.source_attribution || item.source_name || "來源 attribution 未提供";
    const companies = item.companies || [];
    const tags = companies.map((company) => {
      const href = companyStockUrl(company);
      const security = company.securities?.[0];
      const label = `${company.canonical_name}${security ? ` · ${security.exchange} ${security.ticker}` : ""}`;
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : `<span>${escapeHtml(label)}</span>`;
    }).join("");
    const reasons = companies.map((company) => {
      const context = company.entity_context || {};
      return `<p><strong>${escapeHtml(company.canonical_name)}</strong> · ${escapeHtml(context.method === "content_identity_match" ? "文章內容公司身分比對" : context.method || "方法未提供")}${Number.isFinite(context.confidence) ? ` · 關聯信心 ${Math.round(context.confidence * 100)}%` : ""}</p>`;
    }).join("");
    return `<article class="stock-news-card" data-news-id="${escapeHtml(item.id)}">
      <div class="stock-news-meta"><time datetime="${escapeHtml(item.published_at || item.observed_at || "")}">${escapeHtml(formatDate(item.published_at || item.observed_at))}</time><span>${escapeHtml(attribution)}</span></div>
      <h3>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>` : title}</h3>
      <div class="company-tags">${tags}</div>
      <details><summary>公司關聯依據</summary>${reasons}<p>來源：${escapeHtml(item.source_name || attribution)}。原始出版者：${escapeHtml(item.publisher_key === "unknown" ? "未辨識" : item.publisher || "未辨識")}。</p>${item.rights?.requires_unmodified_display ? "<p>依來源規範保留原始標題與連結。</p>" : ""}</details>
    </article>`;
  }).join("") : empty("此標的目前沒有已觀測到、可顯示的新聞；這不表示公司沒有新聞。請一併查看來源狀態。");
}

function render(envelope) {
  const snapshot = envelope.data;
  const entity = snapshot.entity;
  const state = companyPageState(envelope);
  const listing = primaryListing(snapshot, locator.exchange, locator.symbol);
  const aliases = entity.aliases || [];
  document.body.dataset.state = state.status;
  document.title = `${entity.canonical_name} (${locator.symbol})｜Open Intel Atlas`;
  document.querySelector("#data-state").innerHTML = `<span class="state-lamp" aria-hidden="true"></span>${escapeHtml(stateLabel(state.status))} · ${escapeHtml(locator.exchange)} ${escapeHtml(locator.symbol)}`;
  document.querySelector("#generated-at").textContent = `產生於 ${formatDate(envelope.generated_at)}`;
  document.querySelector("#event-count").textContent = `${snapshot.summary.event_count} EVENTS`;
  document.querySelector("#document-count").textContent = `${snapshot.summary.document_count} DOCUMENTS`;
  const aliasSummary = aliases.slice(0, 3).map((item) => item.alias).filter((value) => value !== entity.canonical_name).join(" · ") || "尚無其他正式別名";
  elements.plate.innerHTML = `
    <div class="company-plate__grid">
      <div class="ticker-monogram"><strong>${escapeHtml(locator.symbol)}</strong><span>${escapeHtml(locator.exchange)}</span></div>
      <div class="company-heading"><p class="kicker">CANONICAL COMPANY / ${escapeHtml(entity.country_code || "—")}</p><h1 id="company-name">${escapeHtml(entity.canonical_name)}</h1><p class="company-heading__aliases">${escapeHtml(aliasSummary)}</p></div>
      <div class="master-stamp" data-state="${escapeHtml(state.status)}"><span>公司資料狀態</span><strong>${escapeHtml(stateLabel(state.status))}</strong><p>基本資料：${escapeHtml(stateLabel(envelope.coverage?.company_master?.status || "unknown"))}。公告與新聞各有來源範圍，詳見「公司資料」。</p></div>
    </div>`;
  elements.plate.setAttribute("aria-busy", "false");
  renderEvents(snapshot.latest_events || []);
  renderDocuments(snapshot.latest_documents || []);
  renderFacts(entity, listing, snapshot.master_snapshot, envelope.coverage);
  renderIdentifiers(entity.identifiers || []);
  renderAliases(aliases);
  renderRelations(snapshot.relations || []);
  elements.dossier.hidden = false;
}

function renderEvents(events) {
  elements.events.innerHTML = events.length ? events.map((event) => `
    <article class="event-row">
      <time datetime="${escapeHtml(event.occurred_at || "")}">${escapeHtml(formatDate(event.occurred_at))}</time>
      <div><h3>${escapeHtml(event.title || "未命名事件")}</h3><p>${escapeHtml(event.summary || "目前只有事件標題與 evidence link。")}</p></div>
      <p class="event-row__status"><strong>${escapeHtml(verificationLabel(event.verification_status))}</strong>${Number(event.evidence_count || 0)} 份證據</p>
    </article>`).join("") : empty("目前沒有通過 Event promotion gate 的公司事件。這不代表沒有公司資料。");
}

function renderDocuments(documents) {
  elements.documents.innerHTML = documents.length ? documents.map((document) => {
    const url = safeUrl(document.canonical_url);
    const title = escapeHtml(document.title || "未命名文件");
    const attribution = document.source_attribution || document.source_name || "來源 attribution 未提供";
    const summary = document.rights?.requires_unmodified_display
      ? "此來源依使用規範僅顯示原始標題與連結。"
      : document.summary || "此來源未提供可用摘要。";
    return `<article class="document-row">
      <p class="document-row__mark">${escapeHtml(String(document.authority_class || "source").toUpperCase())}</p>
      <div><p class="document-row__source">${escapeHtml(attribution)}</p><h3>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${title}</a>` : title}</h3><p>${escapeHtml(summary)}</p></div>
      <time datetime="${escapeHtml(document.published_at || document.observed_at || "")}">${escapeHtml(formatDate(document.published_at || document.observed_at))}<br />${escapeHtml(document.entity_context?.role || "mentioned")}</time>
    </article>`;
  }).join("") : empty("尚無解析到這家公司的來源文件；不以 0 代表沒有發生事項。");
}

function renderFacts(entity, listing, master, coverage = {}) {
  const metadata = entity.metadata || {};
  const facts = [
    ["市場代號", `${locator.exchange} ${locator.symbol}`],
    ["實體類型", entity.entity_type],
    ["國別", entity.country_code || "未提供"],
    ["產業代碼", metadata.industry_code || "未提供"],
    ["上市日期", metadata.listing_date || "未提供"],
    ["Master 來源", master?.source_id || "未建立"],
    ["Master snapshot", stateExplanation({ status: coverage.company_master?.status }, master)],
    ["Master coverage", coverage.company_master?.status || "unknown"],
    ["重大訊息 coverage", coverage.official_disclosure?.status || "unknown"],
    ["一般新聞 coverage", coverage.general_news?.status || "unknown"],
    ["Security", listing?.to?.id || "尚未連結"]
  ];
  elements.facts.innerHTML = facts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderIdentifiers(items) {
  elements.identifiers.innerHTML = items.length ? items.map((item) => `<div class="ledger-line"><strong>${escapeHtml(item.authority)} / ${escapeHtml(item.namespace)}</strong><span>${escapeHtml(item.value)} · ${escapeHtml(item.status)} · ${escapeHtml(item.method)}</span></div>`).join("") : empty("沒有正式 identifier。", "ledger-line");
}

function renderAliases(items) {
  elements.aliases.innerHTML = items.length ? items.map((item) => `<div class="ledger-line"><strong>${escapeHtml(item.alias)}</strong><span>${escapeHtml(item.language || "und")} · ${escapeHtml(item.method || "legacy")}</span></div>`).join("") : empty("沒有已驗證別名。", "ledger-line");
}

function renderRelations(items) {
  elements.relations.innerHTML = items.length ? items.map((item) => `<div class="ledger-line"><strong>${escapeHtml(item.relation_type)}</strong><span>${escapeHtml(item.from.canonical_name)} → ${escapeHtml(item.to.canonical_name)}<br />${escapeHtml(item.method)} · ${Math.round(Number(item.confidence || 0) * 100)}%</span></div>`).join("") : empty("沒有 canonical 關係。", "ledger-line");
}

function renderError(title, detail) {
  document.body.dataset.state = "error";
  elements.plate.hidden = true;
  elements.dossier.hidden = true;
  elements.error.hidden = false;
  elements.error.innerHTML = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><p>可使用上方查詢輸入另一個市場代號。</p>`;
  document.querySelector("#data-state").innerHTML = `<span class="state-lamp" aria-hidden="true"></span>公司資料不可用`;
}

function empty(message, className = "empty-register") { return `<p class="${className}">${escapeHtml(message)}</p>`; }
function safeUrl(value) { try { const url = new URL(value, location.origin); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function formatDate(value) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "時間未提供"; }
function stateLabel(value) { return ({ current: "完整且可用", partial: "部分資料", stale: "事件資料已逾期", missing: "資料缺少", unknown: "狀態未知" })[value] || value; }
function stateExplanation(state, master) { if (!master) return "找不到正式 company master snapshot；以下內容可能不完整。"; if (master.truncated) return "來源內容被截斷，不能用缺席判斷公司狀態。"; if (!master.snapshot_complete || master.status !== "complete") return "Master snapshot 未通過 complete gate；不會自動把缺席公司標成 inactive。"; if (state.status === "stale") return `Company master 完整（${master.member_count} 個實體）；事件與文件層已逾 freshness 門檻。`; if (state.status === "missing" || state.status === "unknown") return `Company master 完整（${master.member_count} 個實體）；事件與文件層目前沒有足夠 freshness 證據。`; return `Master ${master.member_count} 個實體，無截斷；absence 才可被解讀。`; }
function verificationLabel(value) { return ({ official_confirmed: "官方確認", primary_source_confirmed: "一手來源", multi_source: "多源交叉", single_source: "單一來源", unverified: "尚未驗證", retracted: "已撤回" })[value] || value || "狀態未知"; }
