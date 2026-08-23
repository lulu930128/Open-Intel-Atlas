const PAGE = document.body.dataset.page || "dashboard";

const state = {
  dashboard: null,
  category: "all",
  range: "live",
  date: "",
  search: "",
  mapLoading: true,
  mapError: null,
  mapFeatures: []
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 520;

const COUNTRY_HINTS = [
  ["taiwan", "TWN"],
  ["china", "CHN"],
  ["hong kong", "HKG"],
  ["japan", "JPN"],
  ["philippines", "PHL"],
  ["indonesia", "IDN"],
  ["india", "IND"],
  ["ukraine", "UKR"],
  ["russia", "RUS"],
  ["israel", "ISR"],
  ["iran", "IRN"],
  ["chile", "CHL"],
  ["red sea", "EGY"],
  ["south china sea", "PHL"],
  ["united states", "USA"],
  ["america", "USA"],
  ["mexico", "MEX"],
  ["brazil", "BRA"],
  ["argentina", "ARG"],
  ["united kingdom", "GBR"],
  ["france", "FRA"],
  ["germany", "DEU"],
  ["italy", "ITA"],
  ["spain", "ESP"],
  ["poland", "POL"],
  ["turkey", "TUR"],
  ["egypt", "EGY"],
  ["south africa", "ZAF"],
  ["australia", "AUS"],
  ["new zealand", "NZL"],
  ["canada", "CAN"]
];

const elements = {
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  summary: document.querySelector("#brief-summary"),
  briefCards: document.querySelector("#brief-cards"),
  topSignals: document.querySelector("#top-signals"),
  watchlistImpacts: document.querySelector("#watchlist-impacts"),
  sectorHeat: document.querySelector("#sector-heat"),
  miniMap: document.querySelector("#mini-map"),
  fullMap: document.querySelector("#full-map"),
  dataStatus: document.querySelector("#data-status"),
  evidenceFeed: document.querySelector("#evidence-feed"),
  mapRecords: document.querySelector("#map-records"),
  searchInput: document.querySelector("#search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  dateFilter: document.querySelector("#date-filter"),
  timeButtons: [...document.querySelectorAll(".time-button")]
};

elements.categoryFilter?.addEventListener("change", () => {
  state.category = elements.categoryFilter.value;
  loadDashboard();
});

elements.refreshButton?.addEventListener("click", () => {
  loadDashboard();
});

elements.dateFilter?.addEventListener("change", () => {
  state.date = elements.dateFilter.value;
  state.range = state.date ? "date" : "live";
  updateTimeControls();
  loadDashboard();
});

elements.searchInput?.addEventListener("input", () => {
  state.search = elements.searchInput.value.trim().toLowerCase();
  render();
});

for (const button of elements.timeButtons) {
  button.addEventListener("click", () => {
    state.range = button.dataset.range || "live";
    state.date = "";

    if (elements.dateFilter) {
      elements.dateFilter.value = "";
    }

    updateTimeControls();
    loadDashboard();
  });
}

await Promise.allSettled([loadWorldMap(), loadDashboard()]);

async function loadWorldMap() {
  state.mapLoading = true;
  state.mapError = null;
  render();

  try {
    const response = await fetch("/atlas/world-countries-lite.geojson");

    if (!response.ok) {
      throw new Error(`Map returned ${response.status}`);
    }

    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features : [];

    state.mapFeatures = features
      .map((feature, index) => ({
        key: `${getFeatureCode(feature) || getFeatureName(feature)}-${index}`,
        code: getFeatureCode(feature),
        name: getFeatureName(feature),
        path: geometryToPath(feature.geometry)
      }))
      .filter((feature) => feature.path);
  } catch (error) {
    state.mapError = error.message;
  } finally {
    state.mapLoading = false;
    render();
  }
}

async function loadDashboard() {
  setStatus("Collecting sources", "warn");

  try {
    const response = await fetch(`/api/dashboard?${buildQueryParams()}`);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const payload = await response.json();
    state.dashboard = payload.dashboard;
    setStatus(statusText(payload), payload.degraded ? "warn" : "ok");
    render();
  } catch (error) {
    setStatus(error.message, "warn");
    if (elements.summary) {
      elements.summary.textContent = "Unable to load dashboard snapshot.";
    }
  }
}

function buildQueryParams() {
  const params = new URLSearchParams();

  if (state.category !== "all") {
    params.set("category", state.category);
  }

  if (state.date) {
    params.set("date", state.date);
  } else {
    params.set("range", state.range);
  }

  params.set("limit", PAGE === "atlas" ? "300" : "200");
  return params.toString();
}

function render() {
  if (PAGE === "atlas") {
    renderAtlas();
    return;
  }

  renderDashboard();
}

function renderDashboard() {
  const dashboard = state.dashboard;

  if (!dashboard) {
    renderLoading();
    return;
  }

  if (elements.summary) {
    elements.summary.textContent = dashboard.summary || "No briefing summary for this window.";
  }

  renderBriefCards(dashboard.brief_cards || []);
  renderTopSignals(filterBySearch(dashboard.top_signals || []));
  renderWatchlist(dashboard.watchlist_impacts || []);
  renderHeat(dashboard.sector_heat || []);
  renderMap(dashboard.mini_map_points || [], elements.miniMap, { labels: false, compact: true });
  renderDataStatus(dashboard.data_status);
  renderEvidence(filterBySearch(dashboard.evidence_feed || []));
}

function renderAtlas() {
  const points = state.dashboard?.mini_map_points || [];
  renderMap(points, elements.fullMap, { labels: true, compact: false });
  renderMapRecords(points);
}

function renderLoading() {
  renderEmpty(elements.briefCards, "Loading briefing cards.");
  renderEmpty(elements.topSignals, "Loading top signals.");
  renderEmpty(elements.watchlistImpacts, "Loading watchlist impacts.");
  renderEmpty(elements.sectorHeat, "Loading sector heat.");
  renderMap([], elements.miniMap, { labels: false, compact: true });
  renderEmpty(elements.dataStatus, "Loading source status.");
  renderEmpty(elements.evidenceFeed, "Loading evidence feed.");
}

function renderBriefCards(cards) {
  if (!elements.briefCards) {
    return;
  }

  if (cards.length === 0) {
    renderEmpty(elements.briefCards, "No briefing cards for this window.");
    return;
  }

  elements.briefCards.innerHTML = cards
    .slice(0, 3)
    .map(
      (card) => `
        <article class="brief-card ${escapeHtml(card.category)}">
          <div class="brief-icon" aria-hidden="true">${categoryIcon(card.category)}</div>
          <div class="brief-copy">
            <span>${escapeHtml(card.label || "Signal")}</span>
            <h2>${escapeHtml(card.title)}</h2>
            <p>${escapeHtml(card.summary || "No summary available.")}</p>
          </div>
          <div class="brief-footer">
            <span>Trend: ${escapeHtml(card.trend?.label || "steady")}</span>
            <strong>${Math.round(Number(card.confidence || 0) * 100)}%</strong>
          </div>
          <div class="sparkline" aria-hidden="true"></div>
        </article>
      `
    )
    .join("");
}

function renderTopSignals(signals) {
  if (!elements.topSignals) {
    return;
  }

  if (signals.length === 0) {
    renderEmpty(elements.topSignals, "No ranked signals for this window.");
    return;
  }

  elements.topSignals.innerHTML = signals
    .slice(0, 6)
    .map(
      (signal) => `
        <article class="signal-row">
          <span class="rank">${Number(signal.rank || 0)}</span>
          <div class="signal-icon ${escapeHtml(signal.category)}" aria-hidden="true">${categoryIcon(signal.category)}</div>
          <div class="signal-main">
            <h3>${escapeHtml(signal.title)}</h3>
            <p>${escapeHtml(signal.summary || "No summary available.")}</p>
            <small>${escapeHtml(signal.source || "Unknown source")} · ${formatDate(signal.observed_at)}</small>
          </div>
          <div class="score-cell">
            <strong>${Math.round(Number(signal.score || 0))}</strong>
            <span>${escapeHtml(signal.severity || "low")}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderWatchlist(items) {
  if (!elements.watchlistImpacts) {
    return;
  }

  if (items.length === 0) {
    renderEmpty(elements.watchlistImpacts, "No watchlist impacts for this window.");
    return;
  }

  elements.watchlistImpacts.innerHTML = items
    .slice(0, 7)
    .map(
      (item) => `
        <article class="impact-row">
          <div>
            <h3>${escapeHtml(item.target)}</h3>
            <p>${escapeHtml(item.impact || "No impact summary.")}</p>
          </div>
          <div class="impact-score ${escapeHtml(item.direction)}">
            <strong>${Math.round(Number(item.score || 0))}</strong>
            <span>${escapeHtml(item.direction || "flat")}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderHeat(items) {
  if (!elements.sectorHeat) {
    return;
  }

  if (items.length === 0) {
    renderEmpty(elements.sectorHeat, "No sector heat for this window.");
    return;
  }

  elements.sectorHeat.innerHTML = items
    .slice(0, 8)
    .map((item) => {
      const heat = clamp(Number(item.heat || 0), 0, 100);

      return `
        <article class="heat-row">
          <div class="heat-label">
            <span>${escapeHtml(item.label)}</span>
            <strong>${Math.round(heat)}</strong>
          </div>
          <div class="heat-track" aria-hidden="true">
            <span style="width: ${heat}%"></span>
          </div>
          <small>${escapeHtml(item.level || "low")} · ${Number(item.event_count || 0)} signals</small>
        </article>
      `;
    })
    .join("");
}

function renderDataStatus(status) {
  if (!elements.dataStatus) {
    return;
  }

  if (!status?.sources?.length) {
    renderEmpty(elements.dataStatus, "No source status yet.");
    return;
  }

  elements.dataStatus.innerHTML = `
    <div class="status-summary">
      <strong>${Number(status.online_sources || 0)} / ${Number(status.total_sources || 0)}</strong>
      <span>${escapeHtml(status.status || "unknown")} coverage</span>
    </div>
    ${status.sources
      .slice(0, 8)
      .map(
        (source) => `
          <article class="source-status-row">
            <div>
              <strong>${escapeHtml(source.name)}</strong>
              <span>${escapeHtml(source.category)} · ${formatDate(source.last_success_at)}</span>
            </div>
            <span class="source-light ${source.ok ? "ok" : "warn"}">${source.ok ? "ok" : "partial"}</span>
          </article>
        `
      )
      .join("")}
  `;
}

function renderEvidence(items) {
  if (!elements.evidenceFeed) {
    return;
  }

  if (items.length === 0) {
    renderEmpty(elements.evidenceFeed, "No evidence records for this filter.");
    return;
  }

  elements.evidenceFeed.innerHTML = items
    .slice(0, 18)
    .map(
      (item) => `
        <article class="evidence-row">
          <span class="source-name">${escapeHtml(item.source || "Unknown")}</span>
          <span class="pill">${escapeHtml(item.type || "signal")}</span>
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.summary || "No evidence summary.")}</p>
          </div>
          <time>${formatDate(item.observed_at)}</time>
          ${item.url ? `<a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">Open</a>` : "<span></span>"}
        </article>
      `
    )
    .join("");
}

function renderMapRecords(points) {
  if (!elements.mapRecords) {
    return;
  }

  if (points.length === 0) {
    renderEmpty(elements.mapRecords, "No mapped points for this filter.");
    return;
  }

  elements.mapRecords.innerHTML = points
    .slice(0, 24)
    .map(
      (point) => `
        <article class="map-record" id="${eventDomId(point.id)}" tabindex="-1">
          <div class="event-meta">
            <span class="pill">${escapeHtml(point.category)}</span>
            <span class="pill ${escapeHtml(point.severity)}">${escapeHtml(point.severity)}</span>
          </div>
          <h3>${escapeHtml(point.title)}</h3>
          <p>${escapeHtml(point.source)} · ${formatDate(point.observed_at)}</p>
        </article>
      `
    )
    .join("");

  bindEventJumpLinks(elements.fullMap);
}

function renderMap(points, target, options = {}) {
  if (!target) {
    return;
  }

  if (state.mapLoading) {
    target.innerHTML = '<div class="map-state">Loading map boundaries...</div>';
    return;
  }

  if (state.mapError) {
    target.innerHTML = `<div class="map-state">Map unavailable: ${escapeHtml(state.mapError)}</div>`;
    return;
  }

  if (state.mapFeatures.length === 0) {
    target.innerHTML = '<div class="map-state">No map boundaries available.</div>';
    return;
  }

  target.innerHTML = renderWorldSvg(points, options);
  bindEventJumpLinks(target);
}

function renderWorldSvg(points, options = {}) {
  const countryEvents = buildCountryEventMap(points);
  const countryPaths = state.mapFeatures
    .map((feature) => {
      const matchedEvents = countryEvents.get(feature.code) || [];
      const className = ["country-path", matchedEvents.length > 0 ? "has-events" : "", topCategory(matchedEvents)]
        .filter(Boolean)
        .join(" ");

      return `
        <path
          class="${className}"
          d="${feature.path}"
          fill="${countryFill(matchedEvents)}"
          stroke="${countryStroke(matchedEvents)}"
          stroke-width="${matchedEvents.length > 0 ? "0.9" : "0.35"}"
          vector-effect="non-scaling-stroke"
          fill-rule="evenodd"
        >
          <title>${escapeHtml(countryTitle(feature, matchedEvents))}</title>
        </path>
      `;
    })
    .join("");

  const markers = points
    .map((point) => {
      const location = point.location || { lat: 0, lon: 0 };
      const position = project(location.lat, location.lon);
      const radius = markerRadius(point.severity, options.compact);

      return `
        <a class="event-jump-link event-marker-link" href="#${eventDomId(point.id)}" data-event-id="${escapeHtml(point.id)}" aria-label="Signal: ${escapeHtml(point.title)}">
          <g class="event-marker ${escapeHtml(point.severity)} ${escapeHtml(point.category)}">
            <circle cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius}" />
            <circle class="marker-ring" cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius + (options.compact ? 3 : 5)}" />
            <title>${escapeHtml(point.title)} / ${escapeHtml(point.source)}</title>
          </g>
        </a>
      `;
    })
    .join("");

  const labels = options.labels
    ? points
        .slice(0, 8)
        .map((point) => {
          const location = point.location || { lat: 0, lon: 0 };
          const position = project(location.lat, location.lon);
          const labelX = clamp(position.x + 10, 12, MAP_WIDTH - 240);
          const labelY = clamp(position.y - 8, 18, MAP_HEIGHT - 18);

          return `
            <a class="event-jump-link map-label-link" href="#${eventDomId(point.id)}" data-event-id="${escapeHtml(point.id)}">
              <text class="map-event-label" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${escapeSvgText(truncate(point.title, 36))}</text>
            </a>
          `;
        })
        .join("")
    : "";

  const emptyState = points.length === 0 ? '<div class="map-state compact">No mapped signals for this filter.</div>' : "";

  return `
    <svg class="atlas-map-svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" role="img" aria-label="Open Intel Atlas world map">
      <defs>
        <filter id="atlas-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g class="country-layer">${countryPaths}</g>
      <g class="marker-layer">${markers}${labels}</g>
    </svg>
    <div class="map-legend">
      <span><i class="legend-dot geopolitics"></i>International</span>
      <span><i class="legend-dot infrastructure"></i>Infrastructure</span>
      <span><i class="legend-dot finance"></i>Finance</span>
      <span><i class="legend-dot ai"></i>Technology</span>
    </div>
    ${emptyState}
  `;
}

function bindEventJumpLinks(container) {
  const links = container?.querySelectorAll?.(".event-jump-link") || [];

  for (const link of links) {
    link.addEventListener("click", (event) => {
      if (PAGE !== "atlas") {
        return;
      }

      event.preventDefault();
      focusEventCard(link.dataset.eventId);
    });
  }
}

function focusEventCard(eventId) {
  const target = document.getElementById(eventDomId(eventId));

  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
  target.classList.remove("selected");
  void target.offsetWidth;
  target.classList.add("selected");
}

function filterBySearch(items) {
  if (!state.search) {
    return items;
  }

  return items.filter((item) => `${item.title || ""} ${item.summary || ""} ${item.source || ""} ${item.category || ""}`.toLowerCase().includes(state.search));
}

function updateTimeControls() {
  for (const button of elements.timeButtons) {
    const active = !state.date && button.dataset.range === state.range;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function statusText(payload) {
  const prefix = state.date ? `Date ${state.date}` : state.range === "live" ? "Live" : state.range.toUpperCase();
  return `${prefix} / ${payload.degraded ? "partial coverage" : "sources online"}`;
}

function setStatus(text, status) {
  if (elements.statusText) {
    elements.statusText.textContent = text;
  }

  if (elements.statusDot) {
    elements.statusDot.className = `status-dot ${status || ""}`.trim();
  }
}

function renderEmpty(target, message) {
  if (!target) {
    return;
  }

  target.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function project(lat, lon) {
  const safeLat = clamp(Number(lat) || 0, -85, 85);
  const safeLon = clamp(Number(lon) || 0, -180, 180);

  return {
    x: ((safeLon + 180) / 360) * MAP_WIDTH,
    y: ((90 - safeLat) / 180) * MAP_HEIGHT
  };
}

function geometryToPath(geometry) {
  if (!geometry) {
    return "";
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates.map(ringToPath).join(" ");
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.map(ringToPath)).join(" ");
  }

  return "";
}

function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length === 0) {
    return "";
  }

  const [firstX, firstY] = projectPosition(ring[0]);
  const rest = ring
    .slice(1)
    .map((position) => {
      const [x, y] = projectPosition(position);
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return `M ${firstX.toFixed(2)} ${firstY.toFixed(2)} ${rest} Z`;
}

function projectPosition(position) {
  const [lon, lat] = Array.isArray(position) ? position : [0, 0];
  return [((Number(lon) + 180) / 360) * MAP_WIDTH, ((90 - Number(lat)) / 180) * MAP_HEIGHT];
}

function getFeatureCode(feature) {
  const props = feature?.properties || {};

  return normalizeCode(
    props["ISO3166-1-Alpha-3"] ||
      props.ISO_A3 ||
      props.ADM0_A3 ||
      props.SU_A3 ||
      props.SOV_A3 ||
      props.iso_a3 ||
      props.id
  );
}

function getFeatureName(feature) {
  const props = feature?.properties || {};
  const candidates = [props.name, props.ADMIN, props.NAME, props.NAME_EN, props.NAME_LONG, props.SOVEREIGNT];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found ? found.trim() : "Unknown Country";
}

function normalizeCode(value) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return !text || text === "-99" ? "" : text;
}

function buildCountryEventMap(points) {
  const map = new Map();

  for (const point of points) {
    const code = inferCountryCode(point);

    if (!code) {
      continue;
    }

    const entries = map.get(code) || [];
    entries.push(point);
    map.set(code, entries);
  }

  return map;
}

function inferCountryCode(point) {
  const text = `${point.title || ""} ${point.summary || ""} ${point.location?.label || ""}`.toLowerCase();

  for (const [keyword, code] of COUNTRY_HINTS) {
    if (text.includes(keyword)) {
      return code;
    }
  }

  return "";
}

function countryTitle(feature, events) {
  return events.length === 0 ? feature.name : `${feature.name}: ${events.length} signals`;
}

function countryFill(events) {
  if (events.length === 0) {
    return "rgba(39, 48, 59, 0.68)";
  }

  const category = topCategory(events);
  const severity = topSeverity(events);

  if (severity === "critical" || severity === "high") {
    return "rgba(239, 71, 111, 0.58)";
  }

  if (category === "infrastructure") {
    return "rgba(255, 209, 102, 0.48)";
  }

  if (category === "finance") {
    return "rgba(143, 214, 148, 0.48)";
  }

  if (category === "ai") {
    return "rgba(182, 146, 255, 0.48)";
  }

  return "rgba(105, 210, 231, 0.5)";
}

function countryStroke(events) {
  return events.length === 0 ? "rgba(114, 128, 142, 0.28)" : "rgba(241, 243, 245, 0.66)";
}

function topCategory(events) {
  if (events.length === 0) {
    return "";
  }

  const counts = new Map();

  for (const event of events) {
    counts.set(event.category, (counts.get(event.category) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function topSeverity(events) {
  const weights = { low: 1, medium: 2, high: 3, critical: 4 };
  return events.map((event) => event.severity).sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
}

function markerRadius(severity, compact) {
  const scale = compact ? 0.78 : 1;

  if (severity === "critical") {
    return 5 * scale;
  }

  if (severity === "high") {
    return 4.4 * scale;
  }

  if (severity === "medium") {
    return 3.8 * scale;
  }

  return 3.2 * scale;
}

function categoryIcon(category) {
  switch (category) {
    case "finance":
      return "%";
    case "infrastructure":
      return "!";
    case "ai":
      return "*";
    case "geopolitics":
    default:
      return "#";
  }
}

function formatDate(value) {
  if (!value) {
    return "No timestamp";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid timestamp";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeSvgText(value) {
  return escapeHtml(value);
}

function truncate(value, limit) {
  const text = String(value || "");

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1).trim()}...`;
}

function eventDomId(eventId) {
  return `event-${String(eventId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function escapeAttribute(value) {
  const text = String(value ?? "");
  return /^https?:\/\//i.test(text) ? escapeHtml(text) : "#";
}
