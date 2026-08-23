const DOMAIN_LABELS = Object.freeze({
  politics: "政治",
  technology: "科技發展",
  finance: "金融",
  hazards: "氣象與災害"
});

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
  disabled: "未啟用"
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

const SEVERITY_LABELS = Object.freeze({
  critical: "重大",
  high: "高",
  medium: "中",
  low: "低",
  unknown: "未分級"
});

const state = {
  briefEnvelope: null,
  freshnessEnvelope: null,
  eventsEnvelope: null,
  storiesEnvelope: null,
  domains: {},
  errors: []
};

const elements = {
  lead: document.querySelector("#lead-story"),
  liveEvents: document.querySelector("#live-events"),
  latestStories: document.querySelector("#latest-stories"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailKicker: document.querySelector("#detail-kicker"),
  detailContent: document.querySelector("#detail-content"),
  searchDialog: document.querySelector("#search-dialog"),
  searchInput: document.querySelector("#newsroom-search-input"),
  searchForm: document.querySelector("#search-form"),
  searchResults: document.querySelector("#search-results"),
  statusDialog: document.querySelector("#status-dialog"),
  statusContent: document.querySelector("#status-content")
};

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

function cleanText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function truncate(value, length = 180) {
  const text = cleanText(value);
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function formatClock(value) {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatMonthDay(value) {
  const date = parseDate(value);
  if (!date) return "日期未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function domainLabel(value) {
  return DOMAIN_LABELS[value] || cleanText(value, "其他");
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

async function api(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function recordError(scope, error) {
  state.errors.push({ scope, message: cleanText(error?.message, "未知錯誤") });
}

function envelopeFallback() {
  return state.freshnessEnvelope || state.briefEnvelope || state.eventsEnvelope || state.storiesEnvelope || {};
}

function setBusy(element, isBusy) {
  if (!element) return;
  element.setAttribute("aria-busy", String(isBusy));
}

function detailButton(type, id, label = "閱讀與查證") {
  if (!id) return "";
  return `<button class="primary-action" type="button" data-detail-type="${escapeHtml(type)}" data-detail-id="${escapeHtml(id)}">${escapeHtml(label)} <span aria-hidden="true">→</span></button>`;
}

function renderLead() {
  const highlights = state.briefEnvelope?.data?.highlights || [];
  const events = state.eventsEnvelope?.data || [];
  const highlight = highlights[0];
  const event = events.find((item) => item.id === highlight?.id) || highlight || events[0];

  if (!event) {
    elements.lead.innerHTML = `
      <div class="empty-state">
        <strong>目前沒有可顯示的頭條</strong>
        <span>採集器可能尚未完成第一輪，或目前沒有事件進入摘要。</span>
      </div>`;
    setBusy(elements.lead, false);
    return;
  }

  const domain = event.primary_domain || event.domain || event.domains?.[0]?.domain;
  const updatedAt = event.last_updated_at || event.occurred_at || event.last_seen_at;
  const sourceName = event.representative_publisher || event.representative_source || "來源詳情見證據頁";
  const evidenceCount = Number.isFinite(Number(event.evidence_count)) ? Number(event.evidence_count) : null;
  const sourceCount = Number.isFinite(Number(event.independent_source_count)) ? Number(event.independent_source_count) : null;
  const sourceUrl = safeUrl(event.representative_url);
  const title = cleanText(event.title, "未命名事件");

  elements.lead.classList.toggle("lead-story--long", title.length > 90);
  elements.lead.classList.toggle("lead-story--very-long", title.length > 140);

  elements.lead.innerHTML = `
    <div class="lead-story__topline">
      <span class="domain-flag">${escapeHtml(domainLabel(domain))}</span>
      <span class="verification-label">${escapeHtml(verificationLabel(event.verification_status))}</span>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead-story__summary">${escapeHtml(cleanText(event.summary, "此事件目前只有標題與來源紀錄，尚無可用摘要。"))}</p>
    <div class="evidence-ledger" aria-label="頭條查證摘要">
      <div class="ledger-item"><span>更新時間</span><strong title="${escapeHtml(formatDateTime(updatedAt))}">${escapeHtml(formatDateTime(updatedAt))}</strong></div>
      <div class="ledger-item"><span>事件等級</span><strong>${escapeHtml(severityLabel(event.event_severity || event.severity))}</strong></div>
      <div class="ledger-item"><span>證據文件</span><strong>${evidenceCount === null ? "詳情內確認" : `${evidenceCount} 份`}</strong></div>
      <div class="ledger-item"><span>獨立來源</span><strong>${sourceCount === null ? escapeHtml(sourceName) : `${sourceCount} 個`}</strong></div>
    </div>
    <div class="lead-actions">
      ${detailButton("event", event.id)}
      ${sourceUrl ? `<a class="secondary-action" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看代表來源 ↗</a>` : ""}
    </div>`;
  setBusy(elements.lead, false);
}

function renderLiveEvents() {
  const events = state.eventsEnvelope?.data || [];
  const leadId = state.briefEnvelope?.data?.highlights?.[0]?.id;
  const visible = events.filter((event) => event.id !== leadId).slice(0, 5);

  if (!visible.length) {
    elements.liveEvents.innerHTML = `<li class="empty-state"><strong>尚無後續事件</strong><span>完成下一輪採集後會自動更新。</span></li>`;
    setBusy(elements.liveEvents, false);
    return;
  }

  elements.liveEvents.innerHTML = visible
    .map((event) => {
      const updatedAt = event.last_updated_at || event.occurred_at;
      return `
        <li class="live-item">
          <time datetime="${escapeHtml(updatedAt || "")}" title="${escapeHtml(formatDateTime(updatedAt))}">${escapeHtml(formatClock(updatedAt))}</time>
          <button type="button" data-detail-type="event" data-detail-id="${escapeHtml(event.id)}">
            <h3>${escapeHtml(cleanText(event.title, "未命名事件"))}</h3>
            <p>${escapeHtml(domainLabel(event.primary_domain))} · ${escapeHtml(verificationLabel(event.verification_status))}</p>
          </button>
        </li>`;
    })
    .join("");
  setBusy(elements.liveEvents, false);
}

function storyFallbackSummary(story) {
  const documents = Number(story.document_count || 0);
  const sources = Number(story.independent_source_count || 0);
  if (!documents && !sources) return "開啟報導查看來源與聚類內容。";
  return `目前聚合 ${documents} 份文件、${sources} 個獨立來源；開啟可查看原始證據。`;
}

function renderLatestStories() {
  const stories = (state.storiesEnvelope?.data || []).slice(0, 9);
  if (!stories.length) {
    elements.latestStories.innerHTML = `<div class="empty-state"><strong>尚無最新報導</strong><span>這不是「沒有新聞」；可能是採集器尚未完成或目前沒有可聚類文件。</span></div>`;
    setBusy(elements.latestStories, false);
    return;
  }

  elements.latestStories.innerHTML = stories
    .map((story, index) => `
      <article class="story-row">
        <div class="story-row__folio">
          <strong>${String(index + 1).padStart(2, "0")}</strong>
          <time datetime="${escapeHtml(story.last_seen_at || "")}" title="${escapeHtml(formatDateTime(story.last_seen_at))}">${escapeHtml(formatMonthDay(story.last_seen_at))}</time>
        </div>
        <button type="button" data-detail-type="story" data-detail-id="${escapeHtml(story.id)}">
          <h3>${escapeHtml(cleanText(story.canonical_title, "未命名報導"))}</h3>
          <p class="story-row__summary">${escapeHtml(cleanText(story.summary, storyFallbackSummary(story)))}</p>
        </button>
        <div class="story-row__evidence">
          <strong>${escapeHtml(story.status === "active" ? "持續追蹤" : story.status === "emerging" ? "新出現" : cleanText(story.status, "狀態未提供"))}</strong>
          ${Number(story.document_count || 0)} 份文件<br />${Number(story.independent_source_count || 0)} 個獨立來源
        </div>
      </article>`)
    .join("");
  setBusy(elements.latestStories, false);
}

function renderDomains() {
  for (const domain of Object.keys(DOMAIN_LABELS)) {
    const target = document.querySelector(`[data-domain-list="${domain}"]`);
    const result = state.domains[domain];
    if (!target) continue;

    if (result?.error) {
      target.innerHTML = `<div class="error-state"><strong>這個版面暫時無法讀取</strong><span>${escapeHtml(result.error)}</span></div>`;
      continue;
    }

    const events = (result?.envelope?.data || []).slice(0, 4);
    if (!events.length) {
      target.innerHTML = `<div class="empty-state"><strong>本期尚無事件</strong><span>不代表此領域沒有新聞；只表示目前沒有資料進入事件層。</span></div>`;
      continue;
    }

    target.innerHTML = events
      .map((event) => {
        const time = event.last_updated_at || event.occurred_at;
        return `
          <article class="domain-story">
            <time datetime="${escapeHtml(time || "")}" title="${escapeHtml(formatDateTime(time))}">${escapeHtml(formatMonthDay(time))}</time>
            <button type="button" data-detail-type="event" data-detail-id="${escapeHtml(event.id)}">
              <h4>${escapeHtml(cleanText(event.title, "未命名事件"))}</h4>
              <p>${escapeHtml(verificationLabel(event.verification_status))} · ${Number(event.evidence_count || 0)} 份證據</p>
            </button>
          </article>`;
      })
      .join("");
  }
}

function domainFreshnessObject(domain) {
  const domains = state.freshnessEnvelope?.data?.domains || {};
  return domains[domain] || null;
}

function renderFreshness() {
  const envelope = envelopeFallback();
  const globalStatus = envelope.freshness?.status || "unknown";
  const coverage = envelope.coverage || {};
  const generatedAt = state.briefEnvelope?.data?.generated_at || envelope.generated_at;
  const coverageLabel = coverage.status === "partial" ? "覆蓋不完整" : statusLabel(coverage.status);

  document.querySelector("#edition-line").textContent = `本地情報版 · ${formatDateTime(generatedAt)}`;
  document.querySelector("#footer-updated").textContent = `資料產生時間 ${formatDateTime(generatedAt)}`;
  document.querySelector("#coverage-summary").textContent = coverage.expected_sources
    ? `${Number(coverage.successful_sources || 0)} / ${Number(coverage.expected_sources)} 個啟用來源成功；${coverageLabel}，整體資料${statusLabel(globalStatus)}。`
    : `資料${statusLabel(globalStatus)}；來源覆蓋數尚未提供。`;

  for (const mark of document.querySelectorAll("[data-state-mark]")) {
    mark.dataset.state = coverage.status === "partial" ? "partial" : globalStatus;
  }
  for (const label of document.querySelectorAll("[data-status-label]")) {
    label.textContent = coverage.status === "partial" ? "資料部分可用" : `資料${statusLabel(globalStatus)}`;
  }

  const rows = Object.keys(DOMAIN_LABELS).map((domain) => {
    const info = domainFreshnessObject(domain);
    const freshnessStatus = info?.freshness?.status || info?.status || "unknown";
    const coverageStatus = info?.coverage?.status;
    const combinedState = coverageStatus === "partial" ? "partial" : freshnessStatus;
    const text = coverageStatus === "partial"
      ? `${statusLabel(freshnessStatus)}／部分來源`
      : statusLabel(freshnessStatus);
    const inline = document.querySelector(`[data-domain-freshness="${domain}"]`);
    if (inline) {
      inline.textContent = text;
      inline.className = "status-word";
      inline.dataset.state = combinedState;
    }
    return `<div class="freshness-row"><span>${escapeHtml(domainLabel(domain))}</span><span class="status-word" data-state="${escapeHtml(combinedState)}">${escapeHtml(text)}</span></div>`;
  });

  document.querySelector("#freshness-matrix").innerHTML = rows.join("");
}

function renderBriefMeta() {
  const brief = state.briefEnvelope?.data;
  document.querySelector("#event-count").textContent = Number.isFinite(Number(brief?.event_count)) ? Number(brief.event_count) : "—";
  document.querySelector("#source-count").textContent = brief?.source_health
    ? `${Number(brief.source_health.usable || 0)} / ${Number(brief.source_health.total || 0)} 個已登錄來源可用`
    : "來源可用數尚未提供";
}

function renderStatusDialog() {
  const envelope = envelopeFallback();
  const freshness = envelope.freshness || {};
  const coverage = envelope.coverage || {};
  const warnings = envelope.warnings || [];
  const globalStatus = coverage.status === "partial" ? "partial" : freshness.status || "unknown";

  const domainRows = Object.keys(DOMAIN_LABELS)
    .map((domain) => {
      const info = domainFreshnessObject(domain);
      const freshState = info?.freshness?.status || info?.status || "unknown";
      const coverageState = info?.coverage?.status || "unknown";
      const dataAsOf = info?.freshness?.data_as_of || info?.data_as_of;
      return `
        <div class="status-domain-row">
          <strong>${escapeHtml(domainLabel(domain))}</strong>
          <span>新鮮度：${escapeHtml(statusLabel(freshState))} · 覆蓋：${escapeHtml(statusLabel(coverageState))}${dataAsOf ? ` · 資料時間 ${escapeHtml(formatDateTime(dataAsOf))}` : ""}</span>
        </div>`;
    })
    .join("");

  const warningRows = warnings.length
    ? warnings.map((warning) => `
        <div class="warning-row">
          <strong>${escapeHtml(cleanText(warning.source_id, warning.code || "來源警告"))}</strong>
          <code>${escapeHtml(truncate(warning.message, 300))}</code>
        </div>`).join("")
    : `<p class="muted">後端目前沒有回報來源警告。</p>`;

  const clientErrors = state.errors.length
    ? `<section class="status-section"><h3>本頁讀取問題</h3>${state.errors.map((item) => `<div class="warning-row"><strong>${escapeHtml(item.scope)}</strong><code>${escapeHtml(item.message)}</code></div>`).join("")}</section>`
    : "";

  elements.statusContent.innerHTML = `
    <div class="status-overview">
      <div><span>整體狀態</span><strong class="status-word" data-state="${escapeHtml(globalStatus)}">${escapeHtml(statusLabel(globalStatus))}</strong></div>
      <div><span>啟用來源成功</span><strong>${Number(coverage.successful_sources || 0)} / ${Number(coverage.expected_sources || 0)}</strong></div>
      <div><span>資料截至</span><strong>${escapeHtml(formatDateTime(freshness.data_as_of || freshness.as_of))}</strong></div>
    </div>
    <section class="status-section">
      <h3>領域狀態</h3>
      ${domainRows}
    </section>
    <section class="status-section">
      <h3>已知來源缺口</h3>
      ${warningRows}
    </section>
    ${clientErrors}
    <section class="status-section">
      <h3>閱讀原則</h3>
      <div class="status-domain-row"><strong>Partial 不等於完整</strong><span>部分來源可用時，頁面仍會呈現已有資料，但不會宣稱已覆蓋全貌。</span></div>
      <div class="status-domain-row"><strong>Stale 不等於即時</strong><span>超過領域更新門檻的資料會保留供閱讀，同時標示已逾更新門檻。</span></div>
      <div class="status-domain-row"><strong>來源數不是分數</strong><span>來源與證據數只描述可查證範圍，不代表事件一定更重要。</span></div>
    </section>`;
}

function detailFact(label, value) {
  return `<div class="detail-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(cleanText(value, "未提供"))}</strong></div>`;
}

function renderEvidenceRecord(document) {
  const url = safeUrl(document.canonical_url);
  const publisher = document.publisher || document.source_name || document.source_id;
  const authority = document.authority_class === "official" ? "官方來源" : cleanText(document.authority_class, "來源類型未提供");
  return `
    <li class="evidence-record">
      <div class="evidence-record__meta">
        <span>${escapeHtml(authority)}</span><span>${escapeHtml(cleanText(publisher, "來源未提供"))}</span>
        <span>${escapeHtml(formatDateTime(document.published_at || document.observed_at))}</span>
      </div>
      <h4>${escapeHtml(cleanText(document.title, "未命名來源文件"))}</h4>
      ${document.summary ? `<p>${escapeHtml(truncate(document.summary, 360))}</p>` : ""}
      ${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">開啟原始來源 ↗</a>` : ""}
    </li>`;
}

function renderEventDetail(data) {
  const domain = data.primary_domain || data.domains?.[0]?.domain;
  const evidence = data.evidence || [];
  const sourceUrl = safeUrl(data.representative_url);
  elements.detailKicker.textContent = "EVENT / EVIDENCE VIEW";
  elements.detailContent.innerHTML = `
    <div class="detail-domain">
      <span class="domain-flag">${escapeHtml(domainLabel(domain))}</span>
      <span class="verification-label">${escapeHtml(verificationLabel(data.verification_status))}</span>
    </div>
    <h2 id="detail-title">${escapeHtml(cleanText(data.title, "未命名事件"))}</h2>
    <p class="detail-summary">${escapeHtml(cleanText(data.summary, "此事件目前沒有可用摘要。"))}</p>
    <section class="detail-section" aria-labelledby="event-facts-heading">
      <h3 id="event-facts-heading">事件資訊</h3>
      <div class="detail-facts">
        ${detailFact("發生／資料時間", formatDateTime(data.occurred_at))}
        ${detailFact("最後更新", formatDateTime(data.last_updated_at))}
        ${detailFact("驗證狀態", verificationLabel(data.verification_status))}
        ${detailFact("事件等級", severityLabel(data.event_severity))}
        ${detailFact("地理範圍", data.location?.label || data.geo_scope)}
        ${detailFact("來源範圍", `${Number(data.independent_source_count || 0)} 個獨立來源／${Number(data.evidence_count || evidence.length)} 份證據`)}
      </div>
      ${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">開啟代表來源 ↗</a>` : ""}
    </section>
    <section class="detail-section" aria-labelledby="event-evidence-heading">
      <h3 id="event-evidence-heading">原始證據</h3>
      ${evidence.length ? `<ul class="evidence-list">${evidence.map(renderEvidenceRecord).join("")}</ul>` : `<div class="empty-state"><strong>沒有可顯示的來源文件</strong><span>事件紀錄存在，但此 response 未附證據內容。</span></div>`}
    </section>`;
}

function renderStoryDetail(data) {
  const documents = data.documents || [];
  const representative = documents.find((document) => document.is_representative) || documents[0];
  const domain = representative?.domains?.[0]?.domain;
  const summary = data.summary || representative?.summary;
  elements.detailKicker.textContent = "REPORT / SOURCE VIEW";
  elements.detailContent.innerHTML = `
    <div class="detail-domain">
      <span class="domain-flag">${escapeHtml(domainLabel(domain))}</span>
      <span class="verification-label">聚類報導 · ${escapeHtml(data.status === "active" ? "持續追蹤" : data.status === "emerging" ? "新出現" : cleanText(data.status, "狀態未提供"))}</span>
    </div>
    <h2 id="detail-title">${escapeHtml(cleanText(data.canonical_title, "未命名報導"))}</h2>
    <p class="detail-summary">${escapeHtml(cleanText(summary, storyFallbackSummary(data)))}</p>
    <section class="detail-section" aria-labelledby="story-facts-heading">
      <h3 id="story-facts-heading">報導資訊</h3>
      <div class="detail-facts">
        ${detailFact("首次出現", formatDateTime(data.first_seen_at))}
        ${detailFact("最後更新", formatDateTime(data.last_seen_at))}
        ${detailFact("來源文件", `${Number(data.document_count || documents.length)} 份`)}
        ${detailFact("獨立來源", `${Number(data.independent_source_count || 0)} 個`)}
        ${detailFact("聚類方法", data.cluster_method)}
        ${detailFact("聚類版本", data.cluster_version)}
      </div>
    </section>
    <section class="detail-section" aria-labelledby="story-evidence-heading">
      <h3 id="story-evidence-heading">此報導包含的來源</h3>
      ${documents.length ? `<ul class="evidence-list">${documents.map(renderEvidenceRecord).join("")}</ul>` : `<div class="empty-state"><strong>沒有可顯示的來源文件</strong><span>報導紀錄存在，但此 response 未附文件內容。</span></div>`}
    </section>`;
}

async function openDetail(type, id) {
  if (!id || !["event", "story"].includes(type)) return;
  if (elements.searchDialog.open) elements.searchDialog.close();
  elements.detailKicker.textContent = "EVIDENCE VIEW";
  elements.detailContent.innerHTML = `<h2 id="detail-title">正在載入詳情…</h2><div class="loading-block" style="min-height: 280px; margin-top: 25px"></div>`;
  if (!elements.detailDialog.open) elements.detailDialog.showModal();

  try {
    const endpoint = type === "event" ? "/api/v1/events/" : "/api/v1/stories/";
    const envelope = await api(`${endpoint}${encodeURIComponent(id)}`);
    if (type === "event") renderEventDetail(envelope.data);
    else renderStoryDetail(envelope.data);
  } catch (error) {
    elements.detailContent.innerHTML = `
      <div class="dialog-error">
        <h2 id="detail-title">目前無法讀取詳情</h2>
        <p>${escapeHtml(cleanText(error?.message, "未知錯誤"))}</p>
      </div>`;
  }
}

function renderSearchGroup(title, items, renderItem) {
  if (!items.length) return "";
  return `<section class="result-group"><h3>${escapeHtml(title)} · ${items.length}</h3>${items.map(renderItem).join("")}</section>`;
}

function renderSearchResults(data, query) {
  const events = data.events || [];
  const stories = data.stories || [];
  const documents = data.documents || [];
  const count = events.length + stories.length + documents.length;
  if (!count) {
    elements.searchResults.innerHTML = `<div class="empty-state"><strong>找不到「${escapeHtml(query)}」</strong><span>可嘗試較短的主題、組織或地區名稱。</span></div>`;
    return;
  }

  elements.searchResults.innerHTML = `
    <p>找到 ${count} 筆結果。事件、報導與來源文件分開呈現，避免把不同資料層混成一列。</p>
    ${renderSearchGroup("事件", events, (event) => `
      <article class="search-result">
        <span class="search-result__type">${escapeHtml(domainLabel(event.primary_domain))}</span>
        <button type="button" data-detail-type="event" data-detail-id="${escapeHtml(event.id)}">
          <h3>${escapeHtml(cleanText(event.title, "未命名事件"))}</h3>
          <p>${escapeHtml(verificationLabel(event.verification_status))} · ${escapeHtml(formatDateTime(event.last_updated_at))}</p>
        </button>
      </article>`)}
    ${renderSearchGroup("報導", stories, (story) => `
      <article class="search-result">
        <span class="search-result__type">REPORT</span>
        <button type="button" data-detail-type="story" data-detail-id="${escapeHtml(story.id)}">
          <h3>${escapeHtml(cleanText(story.canonical_title, "未命名報導"))}</h3>
          <p>${Number(story.document_count || 0)} 份文件 · ${escapeHtml(formatDateTime(story.last_seen_at))}</p>
        </button>
      </article>`)}
    ${renderSearchGroup("來源文件", documents, (document) => {
      const url = safeUrl(document.canonical_url);
      const content = `<h3>${escapeHtml(cleanText(document.title, "未命名來源文件"))}</h3><p>${escapeHtml(cleanText(document.publisher || document.source_name, "來源未提供"))} · ${escapeHtml(formatDateTime(document.published_at))}</p>`;
      return `<article class="search-result"><span class="search-result__type">SOURCE</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${content}</a>` : `<div>${content}</div>`}</article>`;
    })}`;
}

async function submitSearch(event) {
  event.preventDefault();
  const query = cleanText(elements.searchInput.value);
  if (query.length < 2) return;
  elements.searchResults.innerHTML = `<div class="loading-block" style="min-height: 180px"></div>`;
  try {
    const envelope = await api(`/api/v1/search?q=${encodeURIComponent(query)}&limit=20`);
    renderSearchResults(envelope.data || {}, query);
  } catch (error) {
    elements.searchResults.innerHTML = `<div class="error-state"><strong>搜尋暫時無法使用</strong><span>${escapeHtml(cleanText(error?.message, "未知錯誤"))}</span></div>`;
  }
}

function openSearch() {
  if (elements.statusDialog.open) elements.statusDialog.close();
  if (!elements.searchDialog.open) elements.searchDialog.showModal();
  window.setTimeout(() => elements.searchInput.focus(), 0);
}

function openStatus() {
  renderStatusDialog();
  if (elements.searchDialog.open) elements.searchDialog.close();
  if (!elements.statusDialog.open) elements.statusDialog.showModal();
}

function wireInteractions() {
  document.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-detail-type][data-detail-id]");
    if (detail) {
      openDetail(detail.dataset.detailType, detail.dataset.detailId);
      return;
    }

    if (event.target.closest("[data-open-search]")) {
      openSearch();
      return;
    }

    if (event.target.closest("[data-open-status]")) {
      openStatus();
      return;
    }

    const close = event.target.closest("[data-close-dialog]");
    if (close) close.closest("dialog")?.close();
  });

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openSearch();
    }
  });

  elements.searchForm.addEventListener("submit", submitSearch);
}

async function loadHome() {
  const requests = [
    ["本期摘要", "/api/v1/brief", (value) => { state.briefEnvelope = value; }],
    ["最新事件", "/api/v1/events?limit=12", (value) => { state.eventsEnvelope = value; }],
    ["最新報導", "/api/v1/stories?limit=12", (value) => { state.storiesEnvelope = value; }],
    ["資料狀態", "/api/v1/freshness", (value) => { state.freshnessEnvelope = value; }]
  ];

  const coreResults = await Promise.allSettled(requests.map(([, path]) => api(path)));
  coreResults.forEach((result, index) => {
    const [scope, , assign] = requests[index];
    if (result.status === "fulfilled") assign(result.value);
    else recordError(scope, result.reason);
  });

  const domainResults = await Promise.allSettled(
    Object.keys(DOMAIN_LABELS).map((domain) => api(`/api/v1/events?domain=${encodeURIComponent(domain)}&limit=4`))
  );
  Object.keys(DOMAIN_LABELS).forEach((domain, index) => {
    const result = domainResults[index];
    if (result.status === "fulfilled") state.domains[domain] = { envelope: result.value };
    else {
      state.domains[domain] = { error: cleanText(result.reason?.message, "未知錯誤") };
      recordError(`${domainLabel(domain)}版`, result.reason);
    }
  });

  renderFreshness();
  renderBriefMeta();
  renderLead();
  renderLiveEvents();
  renderLatestStories();
  renderDomains();
  renderStatusDialog();
}

wireInteractions();
loadHome().catch((error) => {
  recordError("首頁", error);
  elements.lead.innerHTML = `<div class="error-state"><strong>首頁資料目前無法讀取</strong><span>${escapeHtml(cleanText(error?.message, "未知錯誤"))}</span></div>`;
  setBusy(elements.lead, false);
  renderStatusDialog();
});
