import { MACRO_INDICATORS } from "./indicators.js";

export function migrateMacroV9(db, now) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS macro_indicators (
        id TEXT PRIMARY KEY, release_group TEXT NOT NULL, metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS macro_releases (
        id TEXT PRIMARY KEY, release_group TEXT NOT NULL, reference_period TEXT NOT NULL,
        scheduled_at TEXT, source_published_at TEXT, first_observed_at TEXT,
        release_url TEXT, timestamp_semantics TEXT, last_checked_at TEXT,
        calendar_checked_at TEXT, evidence_document_id TEXT REFERENCES documents(id), UNIQUE(release_group, reference_period)
      );
      CREATE TABLE IF NOT EXISTS macro_calendar_versions (
        sequence INTEGER PRIMARY KEY, release_id TEXT NOT NULL REFERENCES macro_releases(id),
        scheduled_at TEXT NOT NULL, observed_at TEXT NOT NULL,
        source_run_id TEXT NOT NULL REFERENCES source_runs(id), raw_fetch_id TEXT REFERENCES raw_fetches(id),
        source_url TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS macro_observations (
        sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        indicator_id TEXT NOT NULL REFERENCES macro_indicators(id), reference_period TEXT NOT NULL,
        release_id TEXT NOT NULL REFERENCES macro_releases(id), actual REAL NOT NULL,
        index_base TEXT, preliminary INTEGER NOT NULL CHECK(preliminary IN (0,1)),
        revision_number INTEGER NOT NULL, source_published_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
        previous_observation_id TEXT REFERENCES macro_observations(id),
        source_run_id TEXT NOT NULL REFERENCES source_runs(id), raw_fetch_id TEXT NOT NULL REFERENCES raw_fetches(id),
        source_url TEXT NOT NULL, source_column TEXT NOT NULL,
        UNIQUE(indicator_id, reference_period, revision_number)
      );
      CREATE TABLE IF NOT EXISTS macro_release_observations (
        release_id TEXT NOT NULL REFERENCES macro_releases(id),
        observation_id TEXT NOT NULL REFERENCES macro_observations(id),
        PRIMARY KEY(release_id, observation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_macro_calendar_date ON macro_releases(scheduled_at, id);
      CREATE INDEX IF NOT EXISTS idx_macro_period ON macro_observations(indicator_id, reference_period, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_macro_release_group ON macro_releases(release_group, reference_period);
      CREATE INDEX IF NOT EXISTS idx_macro_observation_release ON macro_observations(release_id);
    `);
    const insert = db.prepare("INSERT INTO macro_indicators(id, release_group, metadata_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json");
    for (const indicator of MACRO_INDICATORS) insert.run(indicator.id, indicator.release_group, JSON.stringify(indicator));
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(9,?)").run(now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
