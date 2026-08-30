import {
  MAP_EVENT_LIMIT,
  buildCountryEventMap,
  eventToMapPoint,
  eventToMapRecord,
  fetchCanonicalEvents,
  getFeatureAlpha2,
  rangeLabel
} from "./atlasMapModel.js";

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 520;
let eventRequestId = 0;

const state = {
  domain: null,
  range: "live",
  loading: true,
  error: null,
  records: [],
  points: [],
  truncated: false,
  coverage: null,
  pageCount: 0,
  mapLoading: true,
  mapError: null,
  mapFeatures: []
};

const elements = {
  fullMap: document.querySelector("#full-map"),
  mapRecords: document.querySelector("#map-records"),
  statusText: document.querySelector("#status-text"),
  domainFilter: document.querySelector("#domain-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  timeButtons: [...document.querySelectorAll(".time-button")]
};

elements.domainFilter?.addEventListener("change", () => {
  state.domain = elements.domainFilter.value === "all" ? null : elements.domainFilter.value;
  void loadEvents();
});

elements.refreshButton?.addEventListener("click", () => void loadEvents());

for (const button of elements.timeButtons) {
  button.addEventListener("click", () => {
    state.range = button.dataset.range || "live";
    updateTimeControls();
    void loadEvents();
  });
}

await Promise.allSettled([loadWorldMap(), loadEvents()]);

async function loadWorldMap() {
  state.mapLoading = true;
  state.mapError = null;
  render();
  try {
    const response = await fetch("/atlas/world-countries-lite.geojson", { headers: { accept: "application/geo+json, application/json" } });
    if (!response.ok) throw new Error(`Map returned ${response.status}`);
    const data = await response.json();
    state.mapFeatures = (Array.isArray(data.features) ? data.features : [])
      .map((feature, index) => ({
        key: `${getFeatureAlpha2(feature) || getFeatureName(feature)}-${index}`,
        code: getFeatureAlpha2(feature),
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

async function loadEvents() {
  const requestId = ++eventRequestId;
  state.loading = true;
  state.error = null;
  setStatus("Loading canonical events");
  render();
  try {
    const result = await fetchCanonicalEvents(fetch, {
      domain: state.domain,
      range: state.range,
      maxEvents: MAP_EVENT_LIMIT,
      now: new Date()
    });
    if (requestId !== eventRequestId) return;
    state.records = result.events.map(eventToMapRecord).filter(Boolean);
    state.points = result.events.map(eventToMapPoint).filter(Boolean);
    state.truncated = result.truncated;
    state.coverage = result.coverage;
    state.pageCount = result.pageCount;
  } catch (error) {
    if (requestId !== eventRequestId) return;
    state.error = error.message;
    state.records = [];
    state.points = [];
    state.truncated = false;
    state.coverage = null;
    state.pageCount = 0;
  } finally {
    if (requestId !== eventRequestId) return;
    state.loading = false;
    updateStatus();
    render();
  }
}

function render() {
  renderMap();
  renderMapRecords();
}

function renderMap() {
  if (!elements.fullMap) return;
  if (state.mapLoading) {
    elements.fullMap.innerHTML = '<div class="map-state">Loading map boundaries...</div>';
    return;
  }
  if (state.mapError) {
    elements.fullMap.innerHTML = `<div class="map-state">Map unavailable: ${escapeHtml(state.mapError)}</div>`;
    return;
  }
  if (state.error) {
    elements.fullMap.innerHTML = `<div class="map-state">Events unavailable: ${escapeHtml(state.error)}</div>`;
    return;
  }
  if (state.mapFeatures.length === 0) {
    elements.fullMap.innerHTML = '<div class="map-state">No map boundaries available.</div>';
    return;
  }
  elements.fullMap.innerHTML = renderWorldSvg(state.points, state.records);
  bindEventJumpLinks(elements.fullMap);
}

function renderMapRecords() {
  if (!elements.mapRecords) return;
  if (state.loading) {
    renderEmpty(elements.mapRecords, "Loading canonical events...");
    return;
  }
  if (state.error) {
    renderEmpty(elements.mapRecords, `Events unavailable: ${state.error}`);
    return;
  }
  if (state.records.length === 0) {
    renderEmpty(elements.mapRecords, "No events for this filter.");
    return;
  }

  elements.mapRecords.innerHTML = state.records.map((record) => `
    <article class="map-record" id="${eventDomId(record.id)}" tabindex="-1">
      <div class="event-meta">
        <span class="pill">${escapeHtml(domainLabel(record.domain))}</span>
        <span class="pill ${escapeHtml(record.severity)}">${escapeHtml(record.severity)}</span>
        <span class="pill">${record.has_coordinates ? "mapped" : "location only"}</span>
      </div>
      <h3>${escapeHtml(record.title)}</h3>
      <p>${escapeHtml(record.source)} · ${escapeHtml(formatDate(record.observed_at))}</p>
      ${record.location.label ? `<p>${escapeHtml(record.location.label)}</p>` : ""}
    </article>
  `).join("");
}

function renderWorldSvg(points, records) {
  const countryEvents = buildCountryEventMap(records);
  const countryPaths = state.mapFeatures.map((feature) => {
    const matchedEvents = countryEvents.get(feature.code) || [];
    const domain = topDomain(matchedEvents);
    const className = ["country-path", matchedEvents.length > 0 ? "has-events" : "", domain].filter(Boolean).join(" ");
    return `
      <path class="${className}" d="${feature.path}" fill="${countryFill(matchedEvents)}"
        stroke="${countryStroke(matchedEvents)}" stroke-width="${matchedEvents.length > 0 ? "0.9" : "0.35"}"
        vector-effect="non-scaling-stroke" fill-rule="evenodd">
        <title>${escapeHtml(countryTitle(feature, matchedEvents))}</title>
      </path>`;
  }).join("");

  const markers = points.map((point) => {
    const position = project(point.location.lat, point.location.lon);
    const radius = markerRadius(point.severity);
    return `
      <a class="event-jump-link event-marker-link" href="#${eventDomId(point.id)}" data-event-id="${escapeHtml(point.id)}" aria-label="Signal: ${escapeHtml(point.title)}">
        <g class="event-marker ${escapeHtml(point.severity)} ${escapeHtml(point.domain)}">
          <circle cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius}" />
          <circle class="marker-ring" cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="${radius + 5}" />
          <title>${escapeHtml(point.title)} / ${escapeHtml(point.source)}</title>
        </g>
      </a>`;
  }).join("");

  const labels = points.slice(0, 8).map((point) => {
    const position = project(point.location.lat, point.location.lon);
    const labelX = clamp(position.x + 10, 12, MAP_WIDTH - 240);
    const labelY = clamp(position.y - 8, 18, MAP_HEIGHT - 18);
    return `
      <a class="event-jump-link map-label-link" href="#${eventDomId(point.id)}" data-event-id="${escapeHtml(point.id)}">
        <text class="map-event-label" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${escapeHtml(truncate(point.title, 36))}</text>
      </a>`;
  }).join("");

  const emptyState = points.length === 0 ? '<div class="map-state compact">No events with reliable coordinates for this filter.</div>' : "";
  return `
    <svg class="atlas-map-svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" role="img" aria-label="Open Intel Atlas world map">
      <defs><filter id="atlas-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <g class="country-layer">${countryPaths}</g>
      <g class="marker-layer">${markers}${labels}</g>
    </svg>
    <div class="map-legend">
      <span><i class="legend-dot politics"></i>Politics</span>
      <span><i class="legend-dot technology"></i>Technology</span>
      <span><i class="legend-dot finance"></i>Finance</span>
      <span><i class="legend-dot hazards"></i>Hazards</span>
    </div>
    ${emptyState}`;
}

function updateStatus() {
  if (state.error) return setStatus(`Unavailable · ${state.error}`);
  const coverage = state.coverage?.status && state.coverage.status !== "full" ? ` · ${state.coverage.status} coverage` : "";
  const truncation = state.truncated ? ` · showing first ${state.records.length}+` : ` · ${state.records.length} events`;
  setStatus(`${rangeLabel(state.range)}${truncation} · ${state.points.length} mapped · ${state.pageCount} page${state.pageCount === 1 ? "" : "s"}${coverage}`);
}

function updateTimeControls() {
  for (const button of elements.timeButtons) {
    const active = button.dataset.range === state.range;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function setStatus(text) {
  if (elements.statusText) elements.statusText.textContent = text;
}

function bindEventJumpLinks(container) {
  for (const link of container?.querySelectorAll?.(".event-jump-link") || []) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.getElementById(eventDomId(link.dataset.eventId));
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      target.classList.remove("selected");
      void target.offsetWidth;
      target.classList.add("selected");
    });
  }
}

function geometryToPath(geometry) {
  if (!geometry) return "";
  if (geometry.type === "Polygon") return geometry.coordinates.map(ringToPath).join(" ");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map(ringToPath)).join(" ");
  return "";
}

function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return "";
  const [firstX, firstY] = projectPosition(ring[0]);
  const rest = ring.slice(1).map((position) => {
    const [x, y] = projectPosition(position);
    return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return `M ${firstX.toFixed(2)} ${firstY.toFixed(2)} ${rest} Z`;
}

function projectPosition(position) {
  const [lon, lat] = Array.isArray(position) ? position : [0, 0];
  return [((Number(lon) + 180) / 360) * MAP_WIDTH, ((90 - Number(lat)) / 180) * MAP_HEIGHT];
}

function project(lat, lon) {
  return { x: ((lon + 180) / 360) * MAP_WIDTH, y: ((90 - clamp(lat, -85, 85)) / 180) * MAP_HEIGHT };
}

function getFeatureName(feature) {
  const props = feature?.properties || {};
  const found = [props.name, props.ADMIN, props.NAME, props.NAME_EN].find((value) => typeof value === "string" && value.trim());
  return found ? found.trim() : "Unknown Country";
}

function countryTitle(feature, events) {
  return events.length === 0 ? feature.name : `${feature.name}: ${events.length} events`;
}

function countryFill(events) {
  if (events.length === 0) return "rgba(39, 48, 59, 0.68)";
  const severity = topSeverity(events);
  if (severity === "critical" || severity === "high") return "rgba(239, 71, 111, 0.58)";
  return {
    hazards: "rgba(255, 209, 102, 0.48)",
    finance: "rgba(143, 214, 148, 0.48)",
    technology: "rgba(182, 146, 255, 0.48)",
    politics: "rgba(105, 210, 231, 0.5)"
  }[topDomain(events)] || "rgba(105, 210, 231, 0.5)";
}

function countryStroke(events) {
  return events.length === 0 ? "rgba(114, 128, 142, 0.28)" : "rgba(241, 243, 245, 0.66)";
}

function topDomain(events) {
  const counts = new Map();
  for (const event of events) counts.set(event.domain, (counts.get(event.domain) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "";
}

function topSeverity(events) {
  const weights = { low: 1, medium: 2, high: 3, critical: 4 };
  return events.map((event) => event.severity).sort((left, right) => (weights[right] || 0) - (weights[left] || 0))[0];
}

function markerRadius(severity) {
  return { critical: 5, high: 4.4, medium: 3.8, low: 3.2 }[severity] || 3.2;
}

function domainLabel(domain) {
  return { politics: "Politics", technology: "Technology", finance: "Finance", hazards: "Hazards" }[domain] || "Unknown";
}

function formatDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "No timestamp";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function eventDomId(eventId) {
  return `event-${String(eventId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
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
