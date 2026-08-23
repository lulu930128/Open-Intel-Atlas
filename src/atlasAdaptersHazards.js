import { asArray, cleanText, safeNumber } from "./core/utils.js";
import { sourceFetchResult } from "./atlasContracts.js";
import { walkObjects } from "./atlasParsers.js";
import { createIntelDocument, dedupeDocuments } from "./documents/normalize.js";

export const hazardSources = [
  {
    id: "usgs-earthquake",
    name: "USGS Earthquake Hazards",
    providerType: "geojson",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "hazard_observation",
    domains: ["hazards"],
    languages: ["en"],
    countries: [],
    homepage: "https://earthquake.usgs.gov/",
    docsUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    attribution: "U.S. Geological Survey",
    policyNote: "Official structured observation. Magnitude is raw evidence; Atlas severity is derived separately.",
    cadenceMs: 5 * 60 * 1000,
    catchupMode: "window",
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchUsgs
  },
  {
    id: "nasa-eonet",
    name: "NASA EONET",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "hazard_observation",
    domains: ["hazards"],
    languages: ["en"],
    countries: [],
    homepage: "https://eonet.gsfc.nasa.gov/",
    docsUrl: "https://eonet.gsfc.nasa.gov/docs/v3",
    attribution: "NASA EONET",
    policyNote: "Preserve upstream event and source links. Geometry is used only when explicitly provided.",
    cadenceMs: 20 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchEonet
  },
  {
    id: "gdacs-events",
    name: "GDACS Global Disaster Events",
    providerType: "geojson",
    sourceClass: "official_aggregator",
    authorityClass: "aggregator",
    documentType: "hazard_observation",
    domains: ["hazards"],
    languages: ["en"],
    countries: [],
    homepage: "https://www.gdacs.org/",
    docsUrl: "https://www.gdacs.org/gdacsapi/swagger/index.html",
    attribution: "Global Disaster Alert and Coordination System",
    policyNote: "Global disaster alert aggregation. Keep originating source and alert-level lineage.",
    cadenceMs: 10 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchGdacs
  },
  {
    id: "reliefweb-disasters",
    name: "ReliefWeb Disasters and Reports",
    providerType: "json_api",
    sourceClass: "curated_aggregator",
    authorityClass: "aggregator",
    documentType: "official_statement",
    domains: ["hazards", "politics"],
    languages: ["mul"],
    countries: [],
    homepage: "https://reliefweb.int/",
    docsUrl: "https://apidoc.reliefweb.int/",
    attribution: "ReliefWeb / OCHA and originating information partners",
    policyNote: "Pre-approved appname required. Respect original-source copyright and the documented daily quota.",
    cadenceMs: 30 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: ["reliefWebAppName"],
    run: fetchReliefWeb
  },
  {
    id: "cwa-weather-warnings",
    name: "Taiwan CWA Weather Warnings",
    providerType: "json_api",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "hazard_observation",
    domains: ["hazards"],
    languages: ["zh-TW"],
    countries: ["TW"],
    homepage: "https://opendata.cwa.gov.tw/",
    docsUrl: "https://opendata.cwa.gov.tw/dataset/warning/W-C0033-002",
    attribution: "中央氣象署",
    policyNote: "Authorization code required. This adapter ingests warnings, not routine forecasts.",
    cadenceMs: 5 * 60 * 1000,
    timeoutMs: 12000,
    defaultEnabled: true,
    requiredConfig: ["cwaApiKey"],
    run: fetchCwaWarnings
  },
  {
    id: "nws-alerts",
    name: "U.S. National Weather Service Alerts",
    providerType: "geojson",
    sourceClass: "official_api",
    authorityClass: "official",
    documentType: "hazard_observation",
    domains: ["hazards"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://www.weather.gov/",
    docsUrl: "https://www.weather.gov/documentation/services-web-api",
    attribution: "U.S. National Weather Service",
    policyNote: "United States coverage only. Preserve alert lifecycle, effective/expiry times and official geometry.",
    cadenceMs: 5 * 60 * 1000,
    timeoutMs: 15000,
    defaultEnabled: true,
    requiredConfig: [],
    run: fetchNwsAlerts
  }
];

async function fetchUsgs({ source, http, catchup, now }) {
  const startedAt = now();
  const url = catchup?.from && catchup?.to
    ? usgsCatchupUrl(catchup.from, catchup.to)
    : "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
  const fetch = await http.getJson(url, {
    timeoutMs: source.timeoutMs
  });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.features) ? fetch.data.features : []).slice(0, 100).map((feature) => {
    const properties = feature.properties || {};
    const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const magnitude = safeNumber(properties.mag);
    return createIntelDocument(
      source,
      {
        externalId: feature.id || properties.code,
        canonicalUrl: properties.url,
        title: `M${magnitude === null ? "?" : magnitude.toFixed(1)} earthquake — ${properties.place || "unknown location"}`,
        summary: properties.title || `USGS earthquake observation at ${properties.place || "unknown location"}.`,
        observedAt: properties.time ? new Date(properties.time).toISOString() : fetchedAt,
        fetchedAt,
        publisher: "USGS Earthquake Hazards Program",
        publisherKey: "usgs",
        language: "en",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: "hazards.earthquake",
        eventKey: feature.id ? `usgs-earthquake:${feature.id}` : null,
        rawSeverity: magnitude === null ? null : magnitude >= 7 ? "critical" : magnitude >= 6 ? "high" : magnitude >= 5 ? "medium" : "low",
        tags: ["usgs", "earthquake", magnitude === null ? null : `magnitude-${Math.floor(magnitude)}`],
        location:
          Number.isFinite(Number(coordinates[1])) && Number.isFinite(Number(coordinates[0]))
            ? {
                label: properties.place || "USGS earthquake",
                latitude: Number(coordinates[1]),
                longitude: Number(coordinates[0]),
                precision: "source",
                confidence: 1
              }
            : { label: properties.place || null, precision: "source-label", confidence: 0.8 },
        rawMetadata: {
          event_eligible: true,
          magnitude,
          significance: properties.sig ?? null,
          tsunami: properties.tsunami ?? null,
          alert: properties.alert || null,
          depth_km: safeNumber(coordinates[2])
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function usgsCatchupUrl(from, to) {
  const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", from);
  url.searchParams.set("endtime", to);
  url.searchParams.set("minmagnitude", "4.5");
  url.searchParams.set("orderby", "time");
  url.searchParams.set("limit", "200");
  return url;
}

async function fetchEonet({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50", { timeoutMs: source.timeoutMs });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.events) ? fetch.data.events : []).map((event) => {
    const geometry = Array.isArray(event.geometry) ? event.geometry.at(-1) : null;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
    const category = event.categories?.[0]?.title || "Natural event";
    const sources = Array.isArray(event.sources) ? event.sources : [];
    const link = sources.find((entry) => /^https?:/i.test(entry.url || ""))?.url || event.link || source.homepage;
    return createIntelDocument(
      source,
      {
        externalId: event.id,
        canonicalUrl: link,
        title: `${category}: ${event.title || "Open EONET event"}`,
        summary: event.description || `NASA EONET open ${category.toLowerCase()} event.`,
        observedAt: geometry?.date,
        fetchedAt,
        publisher: "NASA EONET",
        publisherKey: "nasa-eonet",
        language: "en",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: hazardTypeFromText(category),
        eventKey: event.id ? `eonet:${event.id}` : null,
        tags: ["nasa", "eonet", category],
        location:
          coordinates.length >= 2 && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))
            ? { label: event.title || category, longitude: Number(coordinates[0]), latitude: Number(coordinates[1]), precision: "source", confidence: 1 }
            : { label: event.title || category, precision: "event-label", confidence: 0.6 },
        rawMetadata: { event_eligible: true, category, sources, geometry_date: geometry?.date || null }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchGdacs({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP", {
    timeoutMs: source.timeoutMs
  });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.features) ? fetch.data.features : []).slice(0, 100).map((feature) => {
    const item = feature.properties || {};
    const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const eventId = `${item.eventtype || "event"}:${item.eventid || ""}`;
    const affected = Array.isArray(item.affectedcountries) ? item.affectedcountries : [];
    return createIntelDocument(
      source,
      {
        externalId: eventId,
        canonicalUrl: item.url?.report || item.url?.details || source.homepage,
        title: item.name || item.eventname || item.description,
        summary: cleanText(item.htmldescription || item.description || item.severitydata?.severitytext, 1200),
        publishedAt: item.fromdate,
        observedAt: item.datemodified || item.todate || item.fromdate,
        fetchedAt,
        publisher: item.source || "GDACS",
        publisherKey: item.source ? `gdacs-origin:${String(item.source).toLowerCase()}` : "gdacs",
        language: "en",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: gdacsType(item.eventtype),
        eventKey: `gdacs:${eventId}`,
        rawSeverity: gdacsSeverity(item.alertlevel),
        tags: ["gdacs", item.eventtype, item.alertlevel, item.iso3, ...affected],
        location:
          coordinates.length >= 2 && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))
            ? {
                label: item.country || item.countryonland || item.polygonlabel || item.name,
                countryCode: iso3ToIso2(item.iso3),
                longitude: Number(coordinates[0]),
                latitude: Number(coordinates[1]),
                precision: "gdacs-centroid",
                confidence: 0.9
              }
            : { label: item.country || item.name, countryCode: iso3ToIso2(item.iso3), precision: "country", confidence: 0.8 },
        rawMetadata: {
          event_eligible: true,
          event_type: item.eventtype,
          alert_level: item.alertlevel,
          alert_score: item.alertscore,
          source: item.source,
          affected_countries: affected,
          severity_data: item.severitydata || null
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchReliefWeb({ source, http, config, now }) {
  const startedAt = now();
  const url = new URL("https://api.reliefweb.int/v2/disasters");
  url.searchParams.set("appname", config.providers.reliefWebAppName);
  url.searchParams.set("preset", "latest");
  url.searchParams.set("profile", "list");
  url.searchParams.set("limit", "40");
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, retries: 0 });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.data) ? fetch.data.data : []).map((wrapper) => {
    const fields = wrapper.fields || {};
    const country = fields.primary_country || asArray(fields.country)[0] || {};
    const typeNames = asArray(fields.type).map((entry) => entry?.name || entry).filter(Boolean);
    return createIntelDocument(
      source,
      {
        externalId: wrapper.id,
        canonicalUrl: fields.url || fields.url_alias || wrapper.href,
        title: fields.name || fields.title || `ReliefWeb disaster ${wrapper.id}`,
        summary: fields.description || fields.description_html || typeNames.join(", "),
        publishedAt: fields.date?.created || fields.date?.event,
        observedAt: fields.date?.changed || fields.date?.event,
        fetchedAt,
        publisher: "ReliefWeb",
        publisherKey: "reliefweb",
        language: fields.language?.[0]?.code || "und",
        domains: [{ domain: "hazards", confidence: 0.9 }],
        eventTypeCandidate: hazardTypeFromText(typeNames.join(" ") || fields.name),
        eventKey: `reliefweb-disaster:${wrapper.id}`,
        tags: ["reliefweb", ...typeNames, fields.status],
        location: {
          label: country.name || fields.name,
          countryCode: country.iso3 ? iso3ToIso2(country.iso3) : country.iso || null,
          precision: "country",
          confidence: 0.9
        },
        rawMetadata: { event_eligible: true, status: fields.status || null, glide: fields.glide || null, types: typeNames }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchCwaWarnings({ source, http, config, now }) {
  const startedAt = now();
  const url = new URL("https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-002");
  url.searchParams.set("Authorization", config.providers.cwaApiKey);
  url.searchParams.set("format", "JSON");
  const fetch = await http.getJson(url, { timeoutMs: source.timeoutMs, retries: 0 });
  const fetchedAt = now();
  const candidates = walkObjects(fetch.data?.records || fetch.data, (value) =>
    Boolean(value.headline || value.phenomena || value.contentText || value.datasetDescription)
  );
  const documents = candidates.slice(0, 100).map((item, index) => {
    const title = item.headline || item.phenomena || item.datasetDescription;
    const description = item.description || item.contentText || item.instruction || item.significance;
    const locations = walkObjects(item, (value) => Boolean(value.locationName)).map((value) => value.locationName);
    const identity = item.identifier || `${item.issueTime || item.startTime || fetchedAt}:${title}:${index}`;
    return createIntelDocument(
      source,
      {
        externalId: identity,
        canonicalUrl: item.web || source.homepage,
        title,
        summary: description,
        publishedAt: item.issueTime || item.sent,
        observedAt: item.startTime || item.effective || item.onset,
        fetchedAt,
        publisher: "中央氣象署",
        publisherKey: "taiwan-cwa",
        language: item.language || item.contentLanguage || "zh-TW",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: hazardTypeFromText(`${title} ${item.phenomena || ""}`),
        eventKey: `cwa-warning:${identity}`,
        rawSeverity: cwaSeverity(item.severity || item.significance),
        tags: ["cwa", "weather-warning", item.phenomena, item.significance, ...locations],
        location: { label: locations.join("、") || "Taiwan", countryCode: "TW", precision: "warning-area", confidence: 0.9 },
        rawMetadata: {
          event_eligible: true,
          severity: item.severity || item.significance || null,
          urgency: item.urgency || null,
          certainty: item.certainty || null,
          expires: item.endTime || item.expires || null,
          locations
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

async function fetchNwsAlerts({ source, http, now }) {
  const startedAt = now();
  const fetch = await http.getJson("https://api.weather.gov/alerts/active?status=actual&message_type=alert", {
    timeoutMs: source.timeoutMs,
    accept: "application/geo+json"
  });
  const fetchedAt = now();
  const documents = (Array.isArray(fetch.data?.features) ? fetch.data.features : []).slice(0, 150).map((feature) => {
    const item = feature.properties || {};
    return createIntelDocument(
      source,
      {
        externalId: item.id || feature.id,
        canonicalUrl: item.web || item["@id"] || feature.id,
        title: item.headline || item.event,
        summary: [item.description, item.instruction].filter(Boolean).join(" "),
        publishedAt: item.sent,
        observedAt: item.onset || item.effective,
        fetchedAt,
        publisher: item.senderName || "National Weather Service",
        publisherKey: item.sender ? `nws:${item.sender.toLowerCase()}` : "nws",
        language: item.language || "en-US",
        domains: [{ domain: "hazards", confidence: 1 }],
        eventTypeCandidate: hazardTypeFromText(item.event),
        eventKey: `nws-alert:${item.id || feature.id}`,
        rawSeverity: nwsSeverity(item.severity),
        tags: ["nws", "weather-alert", item.event, item.severity, item.urgency, item.certainty],
        location: { label: item.areaDesc || "United States", countryCode: "US", precision: "warning-area", confidence: 1 },
        rawMetadata: {
          event_eligible: true,
          severity: item.severity,
          certainty: item.certainty,
          urgency: item.urgency,
          status: item.status,
          message_type: item.messageType,
          expires: item.expires,
          ends: item.ends,
          affected_zones: item.affectedZones,
          geometry: feature.geometry || null
        }
      },
      fetchedAt
    );
  });
  return sourceFetchResult(source, fetch, dedupeDocuments(documents), startedAt, fetchedAt);
}

function gdacsType(value) {
  return {
    EQ: "hazards.earthquake",
    TC: "hazards.typhoon",
    FL: "hazards.flood",
    VO: "hazards.volcano",
    WF: "hazards.wildfire",
    DR: "hazards.drought"
  }[String(value || "").toUpperCase()] || "hazards.storm";
}

function gdacsSeverity(value) {
  const level = String(value || "").toLowerCase();
  if (level === "red") return "critical";
  if (level === "orange") return "high";
  if (level === "green") return "low";
  return "medium";
}

function nwsSeverity(value) {
  const level = String(value || "").toLowerCase();
  if (level === "extreme") return "critical";
  if (level === "severe") return "high";
  if (level === "moderate") return "medium";
  return "low";
}

function cwaSeverity(value) {
  const text = String(value || "").toLowerCase();
  if (/extreme|紅色|海上陸上颱風/.test(text)) return "critical";
  if (/severe|橙色|豪雨|颱風/.test(text)) return "high";
  if (/moderate|黃色|大雨/.test(text)) return "medium";
  return "low";
}

function hazardTypeFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/earthquake|地震/.test(text)) return "hazards.earthquake";
  if (/tsunami|海嘯/.test(text)) return "hazards.tsunami";
  if (/typhoon|tropical cyclone|hurricane|颱風|熱帶氣旋/.test(text)) return "hazards.typhoon";
  if (/flood|rainfall|heavy rain|洪水|淹水|豪雨|大雨|降雨/.test(text)) return "hazards.flood";
  if (/wildfire|forest fire|野火|森林火災/.test(text)) return "hazards.wildfire";
  if (/volcano|火山/.test(text)) return "hazards.volcano";
  if (/landslide|土石流|山崩/.test(text)) return "hazards.landslide";
  if (/drought|乾旱/.test(text)) return "hazards.drought";
  if (/heat|high temperature|高溫|熱浪/.test(text)) return "hazards.heatwave";
  if (/cold|low temperature|低溫|寒流/.test(text)) return "hazards.coldwave";
  return "hazards.storm";
}

function iso3ToIso2(value) {
  return {
    USA: "US",
    TWN: "TW",
    CHN: "CN",
    JPN: "JP",
    KOR: "KR",
    GBR: "GB",
    DEU: "DE",
    FRA: "FR",
    ITA: "IT",
    IND: "IN",
    IDN: "ID",
    PHL: "PH",
    AUS: "AU",
    CAN: "CA",
    MEX: "MX",
    BRA: "BR"
  }[String(value || "").toUpperCase()] || null;
}
