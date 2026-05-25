const state = {
  dispatch: null,
  events: [],
  sources: [],
  category: "all",
  range: "live",
  date: "",
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
  ["united states", "USA"],
  ["america", "USA"],
  ["mexico", "MEX"],
  ["brazil", "BRA"],
  ["argentina", "ARG"],
  ["chile", "CHL"],
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
  summary: document.querySelector("#brief-summary"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  metricsGrid: document.querySelector("#metrics-grid"),
  sourceList: document.querySelector("#source-list"),
  map: document.querySelector("#world-map"),
  watchlist: document.querySelector("#watchlist"),
  eventList: document.querySelector("#event-list"),
  categoryFilter: document.querySelector("#category-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  dateFilter: document.querySelector("#date-filter"),
  timeButtons: [...document.querySelectorAll(".time-button")]
};

elements.categoryFilter.addEventListener("change", () => {
  state.category = elements.categoryFilter.value;
  loadDispatch();
});

elements.refreshButton.addEventListener("click", () => {
  loadDispatch();
});

elements.dateFilter.addEventListener("change", () => {
  state.date = elements.dateFilter.value;
  state.range = state.date ? "date" : "live";
  updateTimeControls();
  loadDispatch();
});

for (const button of elements.timeButtons) {
  button.addEventListener("click", () => {
    state.range = button.dataset.range || "live";
    state.date = "";
    elements.dateFilter.value = "";
    updateTimeControls();
    loadDispatch();
  });
}

await Promise.allSettled([loadWorldMap(), loadDispatch()]);

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

async function loadDispatch() {
  setStatus("Collecting sources", "warn");

  try {
    const response = await fetch(`/api/dispatch?${buildQueryParams()}`);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const payload = await response.json();
    state.dispatch = payload.dispatch;
    state.events = payload.dispatch.highlights || [];
    state.sources = payload.sources || [];
    elements.summary.textContent = payload.dispatch.summary;
    setStatus(statusText(payload), payload.degraded ? "warn" : "ok");
    render();
  } catch (error) {
    elements.summary.textContent = "Unable to load dispatch. Check the local server logs.";
    setStatus(error.message, "warn");
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

  params.set("limit", "200");
  return params.toString();
}

function render() {
  if (!state.dispatch) {
    renderMap([]);
    return;
  }

  const events = filteredEvents();
  renderMetrics(state.dispatch.categories || []);
  renderSources(state.sources);
  renderMap(events);
  renderWatchlist(state.dispatch.watchlist || []);
  renderEvents(events);
  bindEventJumpLinks();
}

function filteredEvents() {
  return state.events;
}

function updateTimeControls() {
  for (const button of elements.timeButtons) {
    const active = !state.date && button.dataset.range === state.range;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function statusText(payload) {
  const prefix = state.date ? `Date ${state.date}` : state.range === "live" ? "Realtime" : state.range.toUpperCase();
  const coverage = payload.degraded ? "partial coverage" : "sources online";

  return `${prefix} / ${coverage}`;
}

function renderMetrics(categories) {
  elements.metricsGrid.innerHTML = categories
    .map(
      (category) => `
        <article class="metric-card">
          <p class="eyebrow">${escapeHtml(category.label)}</p>
          <strong>${category.count}</strong>
          <span>${category.high_or_above} high-priority signals</span>
          <small>${formatDate(category.latest_observed_at)}</small>
        </article>
      `
    )
    .join("");
}

function renderSources(sources) {
  if (!elements.sourceList) {
    return;
  }

  if (sources.length === 0) {
    elements.sourceList.innerHTML = '<div class="source-row"><p>No source registry data yet.</p></div>';
    return;
  }

  elements.sourceList.innerHTML = sources
    .map((source) => {
      const healthClass = source.ok ? "ok" : "warn";
      const healthText = source.ok ? `online / ${Number(source.count || 0)} records` : "degraded";

      return `
        <article class="source-row ${healthClass}">
          <div class="source-main">
            <strong>${escapeHtml(source.name)}</strong>
            <span>${escapeHtml(source.recommended_use || "Registered public source.")}</span>
          </div>
          <div class="source-badges">
            <span class="pill">${escapeHtml(source.category)}</span>
            <span class="source-health ${healthClass}">${escapeHtml(healthText)}</span>
          </div>
          <div class="source-detail">
            <span>Cadence</span>
            <strong>${escapeHtml(source.cadence || "unknown")}</strong>
          </div>
          <div class="source-detail">
            <span>Last success</span>
            <strong>${formatDate(source.last_success_at)}</strong>
          </div>
          <div class="source-detail source-policy">
            <span>Policy</span>
            <small>${escapeHtml(source.error || source.policy_note || "Review before production use.")}</small>
          </div>
          ${source.docs_url ? `<a href="${escapeAttribute(source.docs_url)}" target="_blank" rel="noreferrer">Docs</a>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderMap(events) {
  if (state.mapLoading) {
    elements.map.innerHTML = '<div class="map-state">Loading world boundaries...</div>';
    return;
  }

  if (state.mapError) {
    elements.map.innerHTML = `<div class="map-state">World map unavailable: ${escapeHtml(state.mapError)}</div>`;
    return;
  }

  if (state.mapFeatures.length === 0) {
    elements.map.innerHTML = '<div class="map-state">No country boundaries available.</div>';
    return;
  }

  if (events.length === 0) {
    elements.map.innerHTML = `${renderWorldSvg([])}<div class="map-state compact">No events in this category.</div>`;
    return;
  }

  elements.map.innerHTML = renderWorldSvg(events);
}

function renderWorldSvg(events) {
  const countryEvents = buildCountryEventMap(events);
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

  const markers = events
    .map((event) => {
      const location = event.location || { lat: 0, lon: 0 };
      const position = project(location.lat, location.lon);
      const radius = markerRadius(event.severity);
      const targetId = eventDomId(event.id);

      return `
        <a
          class="event-jump-link event-marker-link"
          href="#${targetId}"
          data-event-id="${escapeHtml(event.id)}"
          aria-label="Jump to event: ${escapeHtml(event.title)}"
        >
          <g class="event-marker ${escapeHtml(event.severity)} ${escapeHtml(event.category)}">
            <circle cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius}" />
            <circle class="marker-ring" cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius + 4}" />
            <title>${escapeHtml(event.title)} / ${escapeHtml(event.source)}</title>
          </g>
        </a>
      `;
    })
    .join("");

  const labels = events
    .slice(0, 5)
    .map((event) => {
      const location = event.location || { lat: 0, lon: 0 };
      const position = project(location.lat, location.lon);
      const labelX = clamp(position.x + 10, 12, MAP_WIDTH - 230);
      const labelY = clamp(position.y - 8, 18, MAP_HEIGHT - 18);
      const targetId = eventDomId(event.id);

      return `
        <a
          class="event-jump-link map-label-link"
          href="#${targetId}"
          data-event-id="${escapeHtml(event.id)}"
          aria-label="Jump to event: ${escapeHtml(event.title)}"
        >
          <text class="map-event-label" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">
            ${escapeSvgText(truncate(event.title, 30))}
          </text>
        </a>
      `;
    })
    .join("");

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
      <span><i class="legend-dot geopolitics"></i>Geopolitics</span>
      <span><i class="legend-dot infrastructure"></i>Infrastructure</span>
      <span><i class="legend-dot finance"></i>Finance</span>
      <span><i class="legend-dot ai"></i>AI</span>
    </div>
  `;
}

function renderWatchlist(items) {
  if (items.length === 0) {
    elements.watchlist.innerHTML = '<div class="watch-item"><p>No high-priority watch items right now.</p></div>';
    return;
  }

  elements.watchlist.innerHTML = items
    .map(
      (item) => `
        <article class="watch-item">
          <div class="event-meta">
            <span class="pill ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span>
            <span class="pill">${escapeHtml(item.category)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.reason)}</p>
          <small>${escapeHtml(item.source)} / ${formatDate(item.observed_at)}</small>
        </article>
      `
    )
    .join("");
}

function renderEvents(events) {
  if (events.length === 0) {
    elements.eventList.innerHTML = '<article class="event-item"><p>No normalized events for this filter.</p></article>';
    return;
  }

  elements.eventList.innerHTML = events
    .map(
      (event) => `
        <article class="event-item" id="${eventDomId(event.id)}" data-event-id="${escapeHtml(event.id)}" tabindex="-1">
          <div class="event-meta">
            <span class="pill">${escapeHtml(event.category)}</span>
            <span class="pill ${escapeHtml(event.severity)}">${escapeHtml(event.severity)}</span>
            <span class="pill">${Math.round(Number(event.confidence || 0) * 100)}%</span>
          </div>
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(event.summary)}</p>
          <p><small>${escapeHtml(event.source)} / ${formatDate(event.observed_at)}</small></p>
          ${event.url ? `<a href="${escapeAttribute(event.url)}" target="_blank" rel="noreferrer">${escapeHtml(linkLabel(event))}</a>` : ""}
        </article>
      `
    )
    .join("");
}

function bindEventJumpLinks() {
  const links = elements.map.querySelectorAll?.(".event-jump-link") || [];

  for (const link of links) {
    link.addEventListener("click", (event) => {
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
  target.classList.remove("event-item-selected");
  void target.offsetWidth;
  target.classList.add("event-item-selected");

  window.setTimeout(() => {
    target.classList.remove("event-item-selected");
  }, 2600);
}

function setStatus(text, status) {
  elements.statusText.textContent = text;
  elements.statusDot.className = `status-dot ${status || ""}`.trim();
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

  if (!text || text === "-99") {
    return "";
  }

  return text;
}

function buildCountryEventMap(events) {
  const map = new Map();

  for (const event of events) {
    const code = inferCountryCode(event);

    if (!code) {
      continue;
    }

    const entries = map.get(code) || [];
    entries.push(event);
    map.set(code, entries);
  }

  return map;
}

function inferCountryCode(event) {
  const text = `${event.title || ""} ${event.summary || ""} ${event.location?.label || ""}`.toLowerCase();

  for (const [keyword, code] of COUNTRY_HINTS) {
    if (text.includes(keyword)) {
      return code;
    }
  }

  return "";
}

function countryTitle(feature, events) {
  if (events.length === 0) {
    return feature.name;
  }

  return `${feature.name}: ${events.length} signal${events.length === 1 ? "" : "s"}`;
}

function countryFill(events) {
  if (events.length === 0) {
    return "rgba(39, 48, 59, 0.72)";
  }

  const category = topCategory(events);
  const severity = topSeverity(events);

  if (severity === "high" || severity === "critical") {
    return "rgba(239, 71, 111, 0.56)";
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
  if (events.length === 0) {
    return "rgba(114, 128, 142, 0.32)";
  }

  return "rgba(241, 243, 245, 0.66)";
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

  return events
    .map((event) => event.severity)
    .sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
}

function markerRadius(severity) {
  if (severity === "critical") {
    return 4.8;
  }

  if (severity === "high") {
    return 4.2;
  }

  if (severity === "medium") {
    return 3.6;
  }

  return 3;
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

function linkLabel(event) {
  const source = String(event.source || "").toLowerCase();

  if (source.includes("arxiv")) {
    return "Open paper";
  }

  if (source.includes("bbc") || event.category === "geopolitics") {
    return "Open article";
  }

  if (source.includes("cisa") || source.includes("usgs") || source.includes("nasa")) {
    return isLikelyRawApiUrl(event.url) ? "Open source data" : "Open report";
  }

  return "Open source";
}

function isLikelyRawApiUrl(value) {
  return /\/api\/|\.json($|\?)/i.test(String(value || ""));
}

function eventDomId(eventId) {
  return `event-${String(eventId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function escapeAttribute(value) {
  const text = String(value ?? "");

  if (!/^https?:\/\//i.test(text)) {
    return "#";
  }

  return escapeHtml(text);
}
