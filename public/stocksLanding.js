import { companyLink, escapeText, mountDocumentLane, readEnvelope } from "./companyLane.js";
import { landingState, landingUrl, LANDING_VIEWS } from "./stocksLandingModel.js";

export async function mountStocksLanding() {
  const initial = landingState(window.location.search);
  const { market, query } = initial;
  document.title = "股票情報｜Open Intel Atlas";
  document.querySelector("#ticker-search").hidden = true;
  document.querySelector("#company-plate").hidden = true;
  document.querySelector(".stock-breadcrumb").hidden = true;
  document.querySelector("#data-state").textContent = "台灣公司情報 · TWSE／TPEX";
  const root = document.querySelector("#stock-landing");
  root.hidden = false;
  const labels = ["總覽", "公司新聞", "官方公告", "公司目錄"];
  root.innerHTML = `<div class="landing-toolbar"><header class="landing-heading"><div><h1>股票情報</h1><p>查公司、讀新聞，追蹤官方公告。</p></div></header>
    <form class="company-search" role="search" action="/stocks.html"><input type="hidden" name="view" value="directory"><label>市場<select name="market"><option value="TWSE" ${market === "TWSE" ? "selected" : ""}>上市 TWSE</option><option value="TPEX" ${market === "TPEX" ? "selected" : ""}>上櫃 TPEX</option></select></label><label class="company-search__query">公司名稱或代號<input type="search" name="q" value="${escapeText(query)}" maxlength="200" placeholder="例如：台積電、2330" /></label><button type="submit">搜尋公司</button></form></div>
    <nav class="stocks-view-tabs" role="tablist" aria-label="股票情報檢視">${LANDING_VIEWS.map((view, index) => `<button type="button" role="tab" id="view-${view}" data-stock-view="${view}" aria-controls="stock-panel-${view}" aria-selected="false" tabindex="-1">${labels[index]}</button>`).join("")}</nav>
    <section id="stock-panel-directory" role="tabpanel" aria-labelledby="view-directory" tabindex="0" hidden><header class="section-title"><h2 id="directory-title">${query ? `搜尋結果：${escapeText(query)}` : "公司目錄"}</h2></header><p id="directory-state" role="status">正在讀取公司資料…</p><div id="company-directory"></div><button type="button" class="news-more" id="directory-more" hidden>更多公司</button></section>
    <section id="stock-panel-overview" class="landing-lanes" role="tabpanel" aria-labelledby="view-overview" tabindex="0" hidden><section><header class="section-title"><h2>最新公司新聞</h2><button type="button" class="lane-open" data-open-stock-view="news">查看全部新聞 →</button></header><div id="landing-news"></div></section><section><header class="section-title"><h2>官方公告</h2><button type="button" class="lane-open" data-open-stock-view="disclosures">查看全部公告 →</button></header><div id="landing-disclosures"></div></section></section>
    <section id="stock-panel-news" role="tabpanel" aria-labelledby="view-news" tabindex="0" hidden><header class="section-title"><h2>公司新聞</h2></header><div id="landing-news-full"></div></section>
    <section id="stock-panel-disclosures" role="tabpanel" aria-labelledby="view-disclosures" tabindex="0" hidden><header class="section-title"><h2>官方公告</h2></header><div id="landing-disclosures-full"></div></section>`;
  let cursor = null;
  let busy = false;
  const seen = new Set();
  const cursors = new Set();
  const more = root.querySelector("#directory-more");
  const directoryState = root.querySelector("#directory-state");
  async function directory() {
    if (busy) return;
    busy = true; more.disabled = true;
    try {
      const path = new URLSearchParams({ market, q: query, limit: "12" });
      if (cursor) path.set("cursor", cursor);
      const envelope = await readEnvelope(`/api/v1/companies?${path}`);
      if (envelope.profile !== "company_list_v1" || !Array.isArray(envelope.data)) throw new Error("公司資料格式不符");
      for (const company of envelope.data || []) {
        if (seen.has(company.id)) continue;
        seen.add(company.id);
        const scoped = { ...company, securities: company.securities?.filter((s) => s.exchange?.toUpperCase() === market) };
        const href = companyLink(scoped);
        const tickers = scoped.securities?.map((s) => s.ticker).join("、") || "代號未提供";
        root.querySelector("#company-directory").insertAdjacentHTML("beforeend", `<div class="directory-row">${href ? `<a href="${escapeText(href)}">${escapeText(company.canonical_name)}</a>` : escapeText(company.canonical_name)}<span>${escapeText(market)} ${escapeText(tickers)}</span></div>`);
      }
      directoryState.textContent = seen.size ? "公司身分來自已保存的正式公司資料。" : "找不到符合條件的公司；請確認市場或改用代號搜尋。";
      if (cursor) cursors.add(cursor);
      cursor = envelope.pagination?.next_cursor || null;
      if (cursor && cursors.has(cursor)) { cursor = null; directoryState.textContent += " 分頁位置重複，已停止載入。"; }
      more.hidden = !cursor; more.textContent = "更多公司";
    } catch (error) { directoryState.textContent = error.message; more.hidden = false; more.textContent = "重試讀取"; }
    finally { busy = false; more.disabled = false; }
  }
  more.addEventListener("click", directory);
  const loads = new Map();
  let activeView = initial.view;
  function loadView(view) {
    if (loads.has(view)) return loads.get(view);
    const task = Promise.resolve().then(() => {
      if (view === "directory") return directory();
      const lane = (kind, preview) => mountDocumentLane(root.querySelector(`#landing-${kind}${preview ? "" : "-full"}`), {
        path: `/api/v1/company-${kind}?market=${market}&limit=${preview ? 5 : 20}`,
        profile: kind === "news" ? "company_news_latest_v1" : "company_disclosures_v1", preview
      });
      return view === "overview" ? Promise.allSettled([lane("news", true), lane("disclosures", true)]) : lane(view, false);
    });
    loads.set(view, task);
    return task;
  }
  function select(view, push = false) {
    if (push && view !== activeView) window.history.pushState({}, "", landingUrl({ market, query, view }));
    activeView = view;
    for (const value of LANDING_VIEWS) {
      const button = root.querySelector(`#view-${value}`);
      button.setAttribute("aria-selected", String(value === view));
      button.tabIndex = value === view ? 0 : -1;
      root.querySelector(`#stock-panel-${value}`).hidden = value !== view;
    }
    return loadView(view);
  }
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-view], [data-open-stock-view]");
    if (!button) return;
    const view = button.dataset.stockView || button.dataset.openStockView;
    void select(view, true);
    root.querySelector(`#view-${view}`).focus();
  });
  root.addEventListener("keydown", (event) => {
    const index = LANDING_VIEWS.indexOf(event.target.dataset.stockView);
    if (index < 0 || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
    void select(LANDING_VIEWS[next], true);
    root.querySelector(`#view-${LANDING_VIEWS[next]}`).focus();
  });
  // Search is a normal GET navigation: browser history restores the entire scope.
  window.addEventListener("popstate", () => void select(landingState(window.location.search).view));
  await select(initial.view);
  document.querySelector("#generated-at").textContent = "依來源時間閱讀；資料狀態見各列表。";
}
