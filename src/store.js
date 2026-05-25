import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const CATEGORIES = ["geopolitics", "infrastructure", "finance", "ai"];

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_DIR = join(ROOT_DIR, "data", "db");
const DB_BY_CATEGORY = new Map();
let sourceDb = null;

export function saveEventsByCategory(events) {
  const now = new Date().toISOString();
  const saved = {};

  for (const category of CATEGORIES) {
    const categoryEvents = events.filter((event) => event.category === category);
    saved[category] = categoryEvents.length;

    if (categoryEvents.length === 0) {
      continue;
    }

    const db = getCategoryDb(category);
    const insert = db.prepare(`
      INSERT INTO events (
        id,
        category,
        title,
        summary,
        severity,
        confidence,
        source,
        url,
        observed_at,
        location_label,
        location_lat,
        location_lon,
        tags_json,
        rationale,
        raw_json,
        first_seen_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        severity = excluded.severity,
        confidence = excluded.confidence,
        source = excluded.source,
        url = excluded.url,
        observed_at = excluded.observed_at,
        location_label = excluded.location_label,
        location_lat = excluded.location_lat,
        location_lon = excluded.location_lon,
        tags_json = excluded.tags_json,
        rationale = excluded.rationale,
        raw_json = excluded.raw_json,
        last_seen_at = excluded.last_seen_at
    `);
    db.exec("BEGIN");
    try {
      for (const event of categoryEvents) {
        insert.run(
          event.id,
          event.category,
          event.title,
          event.summary,
          event.severity,
          Number(event.confidence || 0),
          event.source,
          event.url,
          event.observed_at,
          event.location?.label || null,
          Number(event.location?.lat || 0),
          Number(event.location?.lon || 0),
          JSON.stringify(event.tags || []),
          event.rationale || null,
          JSON.stringify(event),
          now,
          now
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return saved;
}

export function listStoredEvents(options = {}) {
  const categories = normalizeCategories(options.category);
  const { from, to } = resolveTimeWindow(options);
  const limit = clampLimit(options.limit);
  const events = [];

  for (const category of categories) {
    const db = getCategoryDb(category);
    const rows = queryCategoryEvents(db, { from, to, limit });
    events.push(...rows.map(rowToEvent));
  }

  return events
    .sort((a, b) => Date.parse(b.observed_at || 0) - Date.parse(a.observed_at || 0))
    .slice(0, limit);
}

export function getStoreStats() {
  return CATEGORIES.map((category) => {
    const db = getCategoryDb(category);
    const row = db.prepare("SELECT COUNT(*) AS count, MAX(observed_at) AS latest_observed_at FROM events").get();

    return {
      category,
      db_file: join(DB_DIR, `${category}.sqlite`),
      count: Number(row.count || 0),
      latest_observed_at: row.latest_observed_at || null
    };
  });
}

export function saveSourceStatuses(sources) {
  const db = getSourceDb();
  const insert = db.prepare(`
    INSERT INTO source_status (
      id,
      name,
      category,
      access,
      cadence,
      homepage,
      docs_url,
      policy_note,
      recommended_use,
      ok,
      count,
      error,
      checked_at,
      last_success_at,
      last_failure_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      access = excluded.access,
      cadence = excluded.cadence,
      homepage = excluded.homepage,
      docs_url = excluded.docs_url,
      policy_note = excluded.policy_note,
      recommended_use = excluded.recommended_use,
      ok = excluded.ok,
      count = excluded.count,
      error = excluded.error,
      checked_at = excluded.checked_at,
      last_success_at = CASE
        WHEN excluded.ok = 1 THEN excluded.checked_at
        ELSE source_status.last_success_at
      END,
      last_failure_at = CASE
        WHEN excluded.ok = 0 THEN excluded.checked_at
        ELSE source_status.last_failure_at
      END
  `);

  db.exec("BEGIN");
  try {
    for (const source of sources) {
      const ok = source.ok === true ? 1 : 0;
      insert.run(
        source.id,
        source.name,
        source.category,
        source.access,
        source.cadence,
        source.homepage,
        source.docs_url,
        source.policy_note,
        source.recommended_use,
        ok,
        Number(source.count || 0),
        source.error || null,
        source.checked_at || new Date().toISOString(),
        ok ? source.checked_at : null,
        ok ? null : source.checked_at
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listSourceStatuses(sources);
}

export function listSourceStatuses(sourceOrder = []) {
  const db = getSourceDb();
  const rows = db.prepare("SELECT * FROM source_status").all();
  const rowsById = new Map(rows.map((row) => [row.id, sourceRowToStatus(row)]));

  if (sourceOrder.length > 0) {
    return sourceOrder.map((source) => ({
      ...source,
      ...rowsById.get(source.id)
    }));
  }

  return rows.map(sourceRowToStatus).sort((a, b) => `${a.category}:${a.name}`.localeCompare(`${b.category}:${b.name}`));
}

export function resolveTimeWindow(options = {}) {
  const now = Date.now();

  if (options.date) {
    const date = parseIsoDate(options.date);

    if (date) {
      const from = `${date}T00:00:00.000Z`;
      const to = `${date}T23:59:59.999Z`;
      return { mode: "date", from, to };
    }
  }

  switch (options.range) {
    case "24h":
      return { mode: "24h", from: new Date(now - 24 * 60 * 60 * 1000).toISOString(), to: null };
    case "7d":
      return { mode: "7d", from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), to: null };
    case "30d":
      return { mode: "30d", from: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), to: null };
    case "all":
      return { mode: "all", from: null, to: null };
    case "live":
    default:
      return { mode: "live", from: null, to: null };
  }
}

function getCategoryDb(category) {
  const normalized = normalizeCategory(category);

  if (!normalized) {
    throw new Error(`Unsupported category DB: ${category}`);
  }

  if (DB_BY_CATEGORY.has(normalized)) {
    return DB_BY_CATEGORY.get(normalized);
  }

  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(join(DB_DIR, `${normalized}.sqlite`));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      observed_at TEXT NOT NULL,
      location_label TEXT,
      location_lat REAL,
      location_lon REAL,
      tags_json TEXT NOT NULL,
      rationale TEXT,
      raw_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_observed_at ON events(observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
  `);

  DB_BY_CATEGORY.set(normalized, db);
  return db;
}

function getSourceDb() {
  if (sourceDb) {
    return sourceDb;
  }

  mkdirSync(DB_DIR, { recursive: true });

  sourceDb = new DatabaseSync(join(DB_DIR, "sources.sqlite"));
  sourceDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS source_status (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      access TEXT NOT NULL,
      cadence TEXT NOT NULL,
      homepage TEXT,
      docs_url TEXT,
      policy_note TEXT,
      recommended_use TEXT,
      ok INTEGER NOT NULL,
      count INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_source_status_category ON source_status(category);
    CREATE INDEX IF NOT EXISTS idx_source_status_checked_at ON source_status(checked_at DESC);
  `);

  return sourceDb;
}

function queryCategoryEvents(db, options) {
  const clauses = [];
  const values = [];

  if (options.from) {
    clauses.push("observed_at >= ?");
    values.push(options.from);
  }

  if (options.to) {
    clauses.push("observed_at <= ?");
    values.push(options.to);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const statement = db.prepare(`
    SELECT *
    FROM events
    ${where}
    ORDER BY observed_at DESC
    LIMIT ?
  `);

  return statement.all(...values, options.limit);
}

function rowToEvent(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    confidence: Number(row.confidence),
    source: row.source,
    url: normalizeStoredUrl(row.source, row.url),
    observed_at: row.observed_at,
    location: {
      label: row.location_label || "Unknown",
      lat: Number(row.location_lat || 0),
      lon: Number(row.location_lon || 0)
    },
    tags: parseJsonArray(row.tags_json),
    rationale: row.rationale || undefined
  };
}

function sourceRowToStatus(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    access: row.access,
    cadence: row.cadence,
    homepage: row.homepage || null,
    docs_url: row.docs_url || null,
    policy_note: row.policy_note || "",
    recommended_use: row.recommended_use || "",
    ok: row.ok === null ? null : Boolean(row.ok),
    count: Number(row.count || 0),
    error: row.error || null,
    checked_at: row.checked_at || null,
    last_success_at: row.last_success_at || null,
    last_failure_at: row.last_failure_at || null
  };
}

function normalizeStoredUrl(source, url) {
  const text = String(url || "");

  if (/NASA EONET/i.test(String(source || "")) && /^https?:\/\/eonet\.gsfc\.nasa\.gov\/api\//i.test(text)) {
    return "https://eonet.gsfc.nasa.gov/";
  }

  return text || null;
}

function normalizeCategories(category) {
  const normalized = normalizeCategory(category);
  return normalized ? [normalized] : CATEGORIES;
}

function normalizeCategory(category) {
  const text = String(category || "").trim().toLowerCase();
  return CATEGORIES.includes(text) ? text : "";
}

function clampLimit(value) {
  const limit = Number(value || 200);

  if (!Number.isFinite(limit)) {
    return 200;
  }

  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
