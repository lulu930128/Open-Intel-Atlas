import { MACRO_INDICATORS, MACRO_GROUP_METADATA } from "./indicators.js";
import { releasePeriod, buildRequirements } from "./coverage.js";
import { displaySemantics } from "./semantics.js";

export function migrateMacroV10(db,now) {
  if(db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get())return;
  // SQLite cannot remove a table-level UNIQUE constraint with ADD COLUMN.
  // Rebuild only the parent table with FKs temporarily disabled outside the transaction.
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`CREATE TABLE macro_releases_v10 (
      id TEXT PRIMARY KEY, release_group TEXT NOT NULL, reference_period TEXT NOT NULL,
      scheduled_at TEXT, source_published_at TEXT, first_observed_at TEXT,
      release_url TEXT, timestamp_semantics TEXT, last_checked_at TEXT,calendar_checked_at TEXT,
      evidence_document_id TEXT REFERENCES documents(id),
      period_kind TEXT NOT NULL,period_key TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,
      week_convention TEXT,release_stage TEXT NOT NULL DEFAULT 'not_applicable',occurrence_key TEXT NOT NULL DEFAULT '',
      requirements_json TEXT NOT NULL, effective_at TEXT, provider_published_at TEXT, persisted_at TEXT,
      UNIQUE(release_group,period_kind,period_key,release_stage,occurrence_key)
    )`);
    const old=db.prepare("SELECT * FROM macro_releases").all();
    const insert=db.prepare(`INSERT INTO macro_releases_v10
      (id,release_group,reference_period,scheduled_at,source_published_at,first_observed_at,release_url,timestamp_semantics,last_checked_at,calendar_checked_at,evidence_document_id,
      period_kind,period_key,period_start,period_end,week_convention,requirements_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for(const r of old) {
      const meta=MACRO_GROUP_METADATA[r.release_group];if(!meta)throw Error("Unknown legacy macro group");
      const p=releasePeriod(r,meta);
      insert.run(r.id,r.release_group,r.reference_period,r.scheduled_at,r.source_published_at,r.first_observed_at,r.release_url,r.timestamp_semantics,r.last_checked_at,r.calendar_checked_at,r.evidence_document_id,
        p.period_kind,p.period_key,p.period_start,p.period_end,p.week_convention,JSON.stringify(buildRequirements(r,MACRO_INDICATORS,meta)));
    }
    db.exec(`DROP TABLE macro_releases; ALTER TABLE macro_releases_v10 RENAME TO macro_releases;
      CREATE INDEX idx_macro_calendar_date ON macro_releases(scheduled_at,id);
      CREATE INDEX idx_macro_release_group ON macro_releases(release_group,reference_period);
      ALTER TABLE macro_observations ADD COLUMN period_kind TEXT NOT NULL DEFAULT 'month';
      ALTER TABLE macro_observations ADD COLUMN period_key TEXT;
      ALTER TABLE macro_observations ADD COLUMN period_start TEXT;
      ALTER TABLE macro_observations ADD COLUMN period_end TEXT;
      ALTER TABLE macro_observations ADD COLUMN week_convention TEXT;
      ALTER TABLE macro_observations ADD COLUMN estimate_stage TEXT NOT NULL DEFAULT 'not_applicable';
      ALTER TABLE macro_observations ADD COLUMN revision_reason TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE macro_observations ADD COLUMN metadata_json TEXT;
      ALTER TABLE macro_observations ADD COLUMN persisted_at TEXT;
      CREATE TABLE macro_watch_windows (
        release_id TEXT NOT NULL REFERENCES macro_releases(id),scheduled_at TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES sources(id),
        watch_started_at TEXT NOT NULL,health_before_json TEXT NOT NULL,schedule_before_json TEXT NOT NULL,
        PRIMARY KEY(release_id,scheduled_at)
      );
      CREATE TABLE macro_artifacts (
        id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES macro_releases(id),artifact_type TEXT NOT NULL,
        published_at TEXT,fetched_at TEXT NOT NULL,source_url TEXT NOT NULL,content_hash TEXT NOT NULL,
        raw_fetch_id TEXT NOT NULL REFERENCES raw_fetches(id),document_id TEXT REFERENCES documents(id),metadata_json TEXT NOT NULL,
        UNIQUE(release_id,artifact_type,content_hash)
      );`);
    const update=db.prepare("UPDATE macro_observations SET period_key=?,period_start=?,period_end=?,metadata_json=? WHERE id=?");
    for(const o of db.prepare("SELECT * FROM macro_observations").all()) {
      const i=MACRO_INDICATORS.find(i=>i.id===o.indicator_id);if(!i)throw Error("Unknown legacy macro indicator");
      const p=releasePeriod({reference_period:o.reference_period},{});
      update.run(p.period_key,p.period_start,p.period_end,JSON.stringify({...i,display_semantics:displaySemantics({...i,index_base:o.index_base})}),o.id);
    }
    if(db.prepare("PRAGMA foreign_key_check").all().length)throw Error("Macro migration foreign key violation");
    db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(10,?)").run(now);
    db.exec("COMMIT");
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
  finally{db.exec("PRAGMA foreign_keys=ON");}
}
