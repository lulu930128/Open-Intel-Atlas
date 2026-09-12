const LABELS = { current: "目前最新", stale: "資料已逾更新門檻", partial: "部分資料", missing: "尚無資料", failed: "來源失敗", disabled: "來源未啟用", unknown: "狀態未知" };
export const escapeText = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function companyLink(company) {
  const security = company.securities?.[0];
  if (!security?.exchange || !security?.ticker) return null;
  return `/stocks.html?exchange=${encodeURIComponent(security.exchange)}&symbol=${encodeURIComponent(security.ticker)}`;
}
export async function readEnvelope(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`讀取失敗（HTTP ${response.status}）`);
  return response.json();
}
export function documentRow(document, variant = "news") {
  let url = null;
  try { const candidate = new URL(document.canonical_url); if (["https:", "http:"].includes(candidate.protocol)) url = candidate.href; } catch { /* Missing source URL remains plain text. */ }
  const date = new Date(document.published_at || document.observed_at || "");
  const time = Number.isFinite(date.getTime()) ? date.toLocaleString("zh-TW", { hour12: false }) : "來源時間未提供";
  const companies = (document.companies || []).map((company) => {
    const href = companyLink(company);
    return href ? `<a href="${escapeText(href)}">${escapeText(company.canonical_name)}</a>` : escapeText(company.canonical_name);
  }).join(" · ");
  return `<article class="company-news-card${variant === "disclosure" ? " company-disclosure-row" : ""}"><div class="company-news-card__meta">${escapeText(time)} · ${escapeText(document.source_attribution || document.source_name || document.source_id)}</div>
    <h3>${url ? `<a href="${escapeText(url)}" target="_blank" rel="noopener noreferrer">${escapeText(document.title)} ↗</a>` : escapeText(document.title)}</h3>
    <div class="company-news-card__companies">${companies || "公司關聯尚待確認"}</div></article>`;
}

export function mountDocumentLane(root, { path, profile, preview = false, variant = profile === "company_disclosures_v1" ? "disclosure" : "news" }) {
  let cursor = null;
  let busy = false;
  const seen = new Set();
  const seenCursors = new Set();
  root.innerHTML = `<p class="lane-state" role="status">正在讀取資料…</p><div class="lane-documents"></div><button type="button" class="news-more" hidden>載入較早資料</button>`;
  const state = root.querySelector(".lane-state");
  const list = root.querySelector(".lane-documents");
  const more = root.querySelector("button");
  async function load() {
    if (busy) return;
    busy = true;
    more.disabled = true;
    root.setAttribute("aria-busy", "true");
    try {
      const envelope = await readEnvelope(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (envelope.profile !== profile || !Array.isArray(envelope.data)) throw new Error("資料格式不符，請稍後重試");
      for (const item of (preview ? envelope.data.slice(0, 5) : envelope.data)) if (!seen.has(item.id)) { list.insertAdjacentHTML("beforeend", documentRow(item, variant)); seen.add(item.id); }
      state.textContent = `${LABELS[envelope.freshness?.status] || "狀態未知"} · ${profile === "company_disclosures_v1" ? "官方公告僅涵蓋來源提供的時間範圍。" : "新聞為盡力覆蓋，未出現不代表沒有新聞。"}${seen.size ? "" : " 目前沒有符合範圍的資料。"}`;
      if (cursor) seenCursors.add(cursor);
      cursor = envelope.pagination?.next_cursor || null;
      if (cursor && seenCursors.has(cursor)) throw new Error("分頁游標重複，已停止載入");
      more.hidden = preview || !cursor;
      more.textContent = "載入較早資料";
    } catch (error) {
      state.textContent = error.name === "TimeoutError" ? "讀取逾時，請重試。" : error.message;
      more.hidden = false;
      more.textContent = "重試讀取";
    } finally { busy = false; more.disabled = false; root.setAttribute("aria-busy", "false"); }
  }
  more.addEventListener("click", load);
  return load();
}
