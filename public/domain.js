import { collapseFailedVisual, markVisualLoaded, renderVisual } from "./newsroomMedia.js";
import {
  DOMAIN_PAGE_LIMIT,
  DOMAIN_PAGE_MAX_EVENTS,
  appendUniqueEvents,
  buildDomainEventsPath,
  domainAvailability,
  selectDomain
} from "./domainPageModel.js";

const STATUS_LABELS = Object.freeze({
  current: "目前最新",
  fresh: "目前最新",
  full: "完整",
  stale: "已逾更新門檻",
  partial: "部分來源可用",
  degraded: "品質下降",
  failed: "來源失敗",
  missing: "尚無資料",
  unknown: "狀態未知",
  disabled: "未啟用",
  healthy: "正常"
});

const VERIFICATION_LABELS = Object.freeze({
  official_confirmed: "官方來源確認",
  multi_source_confirmed: "多來源交叉確認",
  multi_source_supported: "多來源支持",
  source_reported: "來源已報導",
  single_source: "單一來源報導",
  unverified: "尚待驗證",
  disputed: "來源有爭議",
  unknown: "驗證狀態未知"
});

const SEVERITY_LABELS = Object.freeze({ critical: "重大", high: "高", medium: "中", low: "低", unknown: "未分級" });

const state = {
  registry: [],
  domain: null,
  events: [],
  nextCursor: null,
  seenCursors: new Set(),
  freshnessEnvelope: null,
  sourcesEnvelope: null,
  loadingMore: false
};

const elements = {
  mast: document.querySelector("#domain-mast"),
  lead: document.querySelector("#domain-lead"),
  events: document.querySelector("#domain-events"),
  loadMore: document.querySelector("#domain-load-more"),
  coverage: document.querySelector("#domain-coverage"),
  sources: document.querySelector("#domain-sources"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailContent: document.querySelector("#detail-content")
};

async function api(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "時間未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(date);
}

function formatMonthDay(value) {
  const date = parseDate(value);
  if (!date) return "日期未提供";
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit" }).format(date);
}

function truncate(value, limit = 220) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function statusLabel(value) {
  return STATUS_LABELS[value] || cleanText(value, "狀態未知");
}

function verificationLabel(value) {
  return VERIFICATION_LABELS[value] || cleanText(value, "驗證狀態未知");
}

function severityLabel(value) {
  return SEVERITY_LABELS[value] || cleanText(value, "未分級");
}

function setBusy(element, value) {
  element?.setAttribute("aria-busy", String(value));
}

function renderInvalidDomain() {
  document.title = "找不到領域｜Open Intel Atlas";
  document.querySelector("#domain-edition-line").textContent = "領域網址無法辨識";
  document.querySelector("#domain-status-label").textContent = "請重新選擇觀察領域";
  document.querySelector("[data-domain-state]").dataset.state = "unknown";
  elements.mast.innerHTML = `
    <div class="domain-invalid">
      <p class="section-index">DOMAIN NOT FOUND</p>
      <h1 id="domain-page-title">找不到這個觀察領域</h1>
      <p>這個網址沒有對應到目前啟用的 backend domain。請由下方入口重新選擇。</p>
      <div class="domain-invalid__links">${state.registry.filter((item) => item.active !== false).map((item) => `<a href="/domain.html?domain=${encodeURIComponent(item.id)}">${escapeHtml(item.label_zh_hant || item.label_en || item.id)} <span aria-hidden="true">↗</span></a>`).join("")}</div>
    </div>`;
  document.querySelector("#domain-workspace")?.setAttribute("hidden", "");
  setBusy(elements.mast, false);
}

function renderMast() {
  const domain = state.domain;
  const availability = domainAvailability(state.freshnessEnvelope);
  const coverage = availability.coverage;
  const asOf = availability.freshness.data_as_of || availability.freshness.as_of || state.freshnessEnvelope?.generated_at;
  document.body.dataset.domain = domain.id;
  document.title = `${domain.label_zh_hant || domain.label_en}｜Open Intel Atlas`;
  for (const link of document.querySelectorAll("[data-domain-nav]")) {
    const active = link.dataset.domainNav === domain.id;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.querySelector("#domain-edition-line").textContent = `${domain.label_zh_hant || domain.label_en}版 · ${formatDateTime(asOf)}`;
  document.querySelector("#domain-footer-updated").textContent = `資料截至 ${formatDateTime(asOf)}`;
  document.querySelector("#domain-status-label").textContent = `${statusLabel(availability.state)} · ${Number(coverage.successful_sources || 0)} / ${Number(coverage.expected_sources || 0)} 來源成功`;
  document.querySelector("[data-domain-state]").dataset.state = availability.state;
  elements.mast.innerHTML = `
    <div class="domain-mast__bearing"><span>${escapeHtml(cleanText(domain.label_en, domain.id))}</span><i aria-hidden="true"></i></div>
    <div class="domain-mast__grid">
      <div>
        <p class="domain-breadcrumb"><a href="/">本期摘要</a><span aria-hidden="true">/</span>領域觀察</p>
        <h1 id="domain-page-title">${escapeHtml(domain.label_zh_hant || domain.label_en || domain.id)}</h1>
        <p class="domain-mast__description">${escapeHtml(cleanText(domain.description, "查看本領域的事件、來源與資料限制。"))}</p>
      </div>
      <dl class="domain-mast__facts">
        <div><dt>資料新鮮度</dt><dd class="status-word" data-state="${escapeHtml(availability.state)}">${escapeHtml(statusLabel(availability.freshness.status))}</dd></div>
        <div><dt>來源覆蓋</dt><dd>${escapeHtml(statusLabel(coverage.status))}</dd></div>
        <div><dt>成功來源</dt><dd>${Number(coverage.successful_sources || 0)} / ${Number(coverage.expected_sources || 0)}</dd></div>
        <div><dt>來源失敗</dt><dd>${Number(coverage.failed_sources || 0)}</dd></div>
      </dl>
    </div>`;
  setBusy(elements.mast, false);
}

function renderLead() {
  const event = state.events[0];
  if (!event) {
    elements.lead.innerHTML = `<div class="empty-state"><strong>目前沒有事件進入本領域</strong><span>這不代表沒有相關新聞；可能是採集器尚未完成，或內容尚未進入 Event 層。</span></div>`;
    setBusy(elements.lead, false);
    return;
  }

  const updatedAt = event.last_updated_at || event.occurred_at;
  const location = event.location?.label;
  elements.lead.removeAttribute("data-media-state");
  elements.lead.innerHTML = `
    <div class="domain-lead__kicker"><span>LEAD SIGNAL</span><span>${escapeHtml(verificationLabel(event.verification_status))}</span></div>
    ${renderVisual(event.representative_media, { domain: state.domain.id, title: event.title, variant: "lead", priority: true })}
    <h2>${escapeHtml(cleanText(event.title, "未命名事件"))}</h2>
    <p class="domain-lead__summary">${escapeHtml(cleanText(event.summary, "此事件目前只有標題與來源紀錄，尚無可用摘要。"))}</p>
    <div class="evidence-ledger">
      <div class="ledger-item"><span>最後更新</span><strong>${escapeHtml(formatDateTime(updatedAt))}</strong></div>
      <div class="ledger-item"><span>驗證狀態</span><strong>${escapeHtml(verificationLabel(event.verification_status))}</strong></div>
      <div class="ledger-item"><span>事件等級</span><strong>${escapeHtml(severityLabel(event.event_severity))}</strong></div>
      <div class="ledger-item"><span>位置</span><strong>${escapeHtml(cleanText(location, "未提供可靠位置"))}</strong></div>
    </div>
    <button class="primary-action" type="button" data-detail-id="${escapeHtml(event.id)}">閱讀事件與證據 <span aria-hidden="true">→</span></button>`;
  setBusy(elements.lead, false);
}

function renderEvents() {
  const events = state.events.slice(1);
  if (!events.length) {
    elements.events.innerHTML = `<div class="empty-state"><strong>沒有其他事件</strong><span>完成下一輪採集後，本頁會沿相同 domain contract 更新。</span></div>`;
  } else {
    elements.events.innerHTML = events.map((event) => {
      const updatedAt = event.last_updated_at || event.occurred_at;
      return `
        <article class="domain-event-row">
          <div class="domain-event-row__time"><time datetime="${escapeHtml(updatedAt || "")}" title="${escapeHtml(formatDateTime(updatedAt))}">${escapeHtml(formatMonthDay(updatedAt))}</time><span>${escapeHtml(severityLabel(event.event_severity))}</span></div>
          <button type="button" data-detail-id="${escapeHtml(event.id)}">
            <h3>${escapeHtml(cleanText(event.title, "未命名事件"))}</h3>
            <p>${escapeHtml(truncate(event.summary || event.representative_source || "開啟事件查看來源與證據。", 190))}</p>
          </button>
          <div class="domain-event-row__evidence"><strong>${escapeHtml(verificationLabel(event.verification_status))}</strong><span>${Number(event.evidence_count || 0)} 份證據</span><span>${Number(event.independent_source_count || 0)} 個獨立來源</span></div>
        </article>`;
    }).join("");
  }
  const capped = state.events.length >= DOMAIN_PAGE_MAX_EVENTS;
  elements.loadMore.hidden = !state.nextCursor || capped;
  elements.loadMore.textContent = capped ? `已顯示前 ${DOMAIN_PAGE_MAX_EVENTS} 筆` : "載入較早事件 ↓";
  elements.loadMore.disabled = state.loadingMore || capped;
  setBusy(elements.events, false);
}

function renderCoverageAndSources() {
  const availability = domainAvailability(state.freshnessEnvelope);
  const coverage = availability.coverage;
  const sources = state.sourcesEnvelope?.data || [];
  elements.coverage.innerHTML = state.freshnessEnvelope ? `
    <div class="domain-coverage__score"><strong>${Number(coverage.successful_sources || 0)}</strong><span>/ ${Number(coverage.expected_sources || 0)} 個啟用來源成功</span></div>
    <dl>
      <div><dt>目前狀態</dt><dd class="status-word" data-state="${escapeHtml(availability.state)}">${escapeHtml(statusLabel(availability.state))}</dd></div>
      <div><dt>資料截至</dt><dd>${escapeHtml(formatDateTime(availability.freshness.data_as_of || availability.freshness.as_of))}</dd></div>
      <div><dt>失敗來源</dt><dd>${Number(coverage.failed_sources || 0)}</dd></div>
      <div><dt>未啟用</dt><dd>${Number(coverage.disabled_sources || 0)}</dd></div>
    </dl>
    ${availability.warnings.length ? `<div class="domain-warning"><strong>已知缺口</strong>${availability.warnings.slice(0, 3).map((warning) => `<p><span>${escapeHtml(cleanText(warning.source_id, warning.code || "來源警告"))}</span>${escapeHtml(truncate(warning.message, 170))}</p>`).join("")}</div>` : `<p class="domain-no-warning">後端目前沒有回報此領域的來源警告。</p>`}`
    : `<div class="error-state"><strong>資料狀態無法讀取</strong><span>事件仍可閱讀，但 freshness 與 coverage 暫時未知。</span></div>`;

  elements.sources.innerHTML = !state.sourcesEnvelope
    ? `<div class="error-state"><strong>來源清單無法讀取</strong><span>事件仍可閱讀，但本次無法確認 source health。</span></div>`
    : sources.length ? sources.map((source) => {
    const health = source.health || {};
    const sourceUrl = safeUrl(source.homepage);
    return `
      <article class="domain-source-item">
        <div><span class="source-class">${escapeHtml(cleanText(source.authority_class, source.source_class || "source"))}</span><span class="status-word" data-state="${escapeHtml(health.status || "unknown")}">${escapeHtml(statusLabel(health.status))}</span></div>
        <h3>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanText(source.name, source.id))} ↗</a>` : escapeHtml(cleanText(source.name, source.id))}</h3>
        <p>${escapeHtml(cleanText(source.attribution, "來源 attribution 未提供"))}</p>
        <time datetime="${escapeHtml(health.last_success_at || "")}">最近成功：${escapeHtml(formatDateTime(health.last_success_at))}</time>
      </article>`;
  }).join("") : `<div class="empty-state"><strong>沒有可顯示的來源</strong><span>此領域目前沒有 registry source。</span></div>`;
}

async function loadMore() {
  if (!state.nextCursor || state.loadingMore) return;
  if (state.seenCursors.has(state.nextCursor)) {
    elements.loadMore.hidden = true;
    return;
  }
  state.loadingMore = true;
  state.seenCursors.add(state.nextCursor);
  elements.loadMore.disabled = true;
  elements.loadMore.textContent = "載入中…";
  try {
    const envelope = await api(buildDomainEventsPath(state.domain.id, { cursor: state.nextCursor, limit: DOMAIN_PAGE_LIMIT }));
    state.events = appendUniqueEvents(state.events, envelope.data, DOMAIN_PAGE_MAX_EVENTS);
    state.nextCursor = envelope.pagination?.next_cursor || null;
    renderEvents();
  } catch (error) {
    elements.loadMore.textContent = `載入失敗：${cleanText(error.message, "未知錯誤")}`;
  } finally {
    state.loadingMore = false;
    if (!elements.loadMore.hidden) elements.loadMore.disabled = false;
  }
}

function detailFact(label, value) {
  return `<div class="detail-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(cleanText(value, "未提供"))}</strong></div>`;
}

function renderEvidenceRecord(document) {
  const url = safeUrl(document.canonical_url);
  return `
    <li class="evidence-record">
      <div class="evidence-record__meta"><span>${escapeHtml(cleanText(document.authority_class, "來源類型未提供"))}</span><span>${escapeHtml(cleanText(document.publisher || document.source_name, "來源未提供"))}</span><span>${escapeHtml(formatDateTime(document.published_at || document.observed_at))}</span></div>
      <h4>${escapeHtml(cleanText(document.title, "未命名來源文件"))}</h4>
      ${document.summary ? `<p>${escapeHtml(truncate(document.summary, 360))}</p>` : ""}
      ${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">開啟原始來源 ↗</a>` : ""}
    </li>`;
}

async function openDetail(eventId) {
  if (!eventId) return;
  elements.detailContent.innerHTML = `<h2 id="detail-title">正在載入詳情…</h2><div class="loading-block detail-loading"></div>`;
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
  try {
    const envelope = await api(`/api/v1/events/${encodeURIComponent(eventId)}`);
    const event = envelope.data;
    const evidence = event.evidence || [];
    const sourceUrl = safeUrl(event.representative_url);
    elements.detailContent.removeAttribute("data-media-state");
    elements.detailContent.innerHTML = `
      <div class="detail-domain"><span class="domain-flag">${escapeHtml(state.domain.label_zh_hant || state.domain.label_en)}</span><span class="verification-label">${escapeHtml(verificationLabel(event.verification_status))}</span></div>
      ${renderVisual(event.representative_media, { domain: state.domain.id, title: event.title, variant: "detail" })}
      <h2 id="detail-title">${escapeHtml(cleanText(event.title, "未命名事件"))}</h2>
      <p class="detail-summary">${escapeHtml(cleanText(event.summary, "此事件目前沒有可用摘要。"))}</p>
      <section class="detail-section"><h3>事件資訊</h3><div class="detail-facts">
        ${detailFact("發生／資料時間", formatDateTime(event.occurred_at))}
        ${detailFact("最後更新", formatDateTime(event.last_updated_at))}
        ${detailFact("驗證狀態", verificationLabel(event.verification_status))}
        ${detailFact("事件等級", severityLabel(event.event_severity))}
        ${detailFact("地理範圍", event.location?.label || event.geo_scope)}
        ${detailFact("來源範圍", `${Number(event.independent_source_count || 0)} 個獨立來源／${Number(event.evidence_count || evidence.length)} 份證據`)}
      </div>${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">開啟代表來源 ↗</a>` : ""}</section>
      <section class="detail-section"><h3>原始證據</h3>${evidence.length ? `<ul class="evidence-list">${evidence.map(renderEvidenceRecord).join("")}</ul>` : `<div class="empty-state"><strong>沒有可顯示的來源文件</strong><span>事件存在，但此 response 未附證據內容。</span></div>`}</section>`;
  } catch (error) {
    elements.detailContent.innerHTML = `<div class="dialog-error"><h2 id="detail-title">目前無法讀取詳情</h2><p>${escapeHtml(cleanText(error.message, "未知錯誤"))}</p></div>`;
  }
}

function wireInteractions() {
  elements.loadMore.addEventListener("click", () => void loadMore());
  document.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-detail-id]");
    if (detail) void openDetail(detail.dataset.detailId);
    const close = event.target.closest("[data-close-dialog]");
    if (close) close.closest("dialog")?.close();
  });
  elements.detailDialog.addEventListener("click", (event) => {
    if (event.target === elements.detailDialog) elements.detailDialog.close();
  });
  document.addEventListener("error", (event) => collapseFailedVisual(event.target), true);
  document.addEventListener("load", (event) => markVisualLoaded(event.target), true);
}

async function loadDomain() {
  const registryEnvelope = await api("/api/v1/domains");
  state.registry = Array.isArray(registryEnvelope.data) ? registryEnvelope.data : [];
  state.domain = selectDomain(window.location.search, state.registry);
  if (!state.domain) return renderInvalidDomain();

  const [eventsResult, freshnessResult, sourcesResult] = await Promise.allSettled([
    api(buildDomainEventsPath(state.domain.id, { limit: DOMAIN_PAGE_LIMIT })),
    api(`/api/v1/freshness?domain=${encodeURIComponent(state.domain.id)}`),
    api(`/api/v1/sources?domain=${encodeURIComponent(state.domain.id)}`)
  ]);

  if (eventsResult.status === "fulfilled") {
    state.events = appendUniqueEvents([], eventsResult.value.data, DOMAIN_PAGE_MAX_EVENTS);
    state.nextCursor = eventsResult.value.pagination?.next_cursor || null;
  }
  if (freshnessResult.status === "fulfilled") state.freshnessEnvelope = freshnessResult.value;
  if (sourcesResult.status === "fulfilled") state.sourcesEnvelope = sourcesResult.value;

  renderMast();
  if (eventsResult.status === "rejected") {
    const message = cleanText(eventsResult.reason?.message, "未知錯誤");
    elements.lead.innerHTML = `<div class="error-state"><strong>此領域事件目前無法讀取</strong><span>${escapeHtml(message)}</span></div>`;
    elements.events.innerHTML = `<div class="error-state"><strong>事件流不可用</strong><span>${escapeHtml(message)}</span></div>`;
    setBusy(elements.lead, false);
    setBusy(elements.events, false);
  } else {
    renderLead();
    renderEvents();
  }

  renderCoverageAndSources();
}

wireInteractions();
loadDomain().catch((error) => {
  document.querySelector("#domain-edition-line").textContent = "領域資料讀取失敗";
  document.querySelector("#domain-status-label").textContent = "目前無法載入";
  document.querySelector("[data-domain-state]").dataset.state = "unavailable";
  elements.mast.innerHTML = `<div class="error-state domain-fatal"><strong>領域版目前無法載入</strong><span>${escapeHtml(cleanText(error.message, "未知錯誤"))}</span><a class="source-link" href="/">回到本期摘要</a></div>`;
  document.querySelector("#domain-workspace")?.setAttribute("hidden", "");
  setBusy(elements.mast, false);
});
