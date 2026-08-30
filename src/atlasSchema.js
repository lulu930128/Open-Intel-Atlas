export const SCHEMA_VERSION = 4;

export function initializeAtlasSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      source_class TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      document_type TEXT NOT NULL,
      catchup_mode TEXT NOT NULL DEFAULT 'latest_only',
      homepage TEXT,
      docs_url TEXT,
      attribution TEXT,
      policy_note TEXT,
      media_policy_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      disabled_reason TEXT,
      domains_json TEXT NOT NULL,
      languages_json TEXT NOT NULL,
      countries_json TEXT NOT NULL,
      cadence_ms INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'rate_limited', 'disabled')),
      http_status INTEGER,
      item_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      error_type TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS source_schedule_state (
      source_id TEXT PRIMARY KEY,
      next_due_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
      backoff_until TEXT,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_outcome TEXT,
      last_gap_status TEXT NOT NULL DEFAULT 'none'
        CHECK (last_gap_status IN ('none', 'bounded', 'recoverable_partial', 'unrecoverable')),
      last_catchup_from TEXT,
      last_catchup_to TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON UPDATE CASCADE ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS raw_fetches (
      id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      request_url TEXT,
      http_status INTEGER,
      content_type TEXT,
      etag TEXT,
      last_modified TEXT,
      content_hash TEXT,
      payload_text TEXT,
      payload_truncated INTEGER NOT NULL DEFAULT 0 CHECK (payload_truncated IN (0, 1)),
      FOREIGN KEY (source_run_id) REFERENCES source_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_run_id TEXT,
      raw_fetch_id TEXT,
      external_id TEXT,
      document_type TEXT NOT NULL,
      canonical_url TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      body_excerpt TEXT,
      language TEXT NOT NULL,
      published_at TEXT,
      observed_at TEXT,
      fetched_at TEXT NOT NULL,
      author TEXT,
      publisher TEXT NOT NULL,
      publisher_key TEXT NOT NULL,
      title_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      title_tokens_json TEXT NOT NULL,
      event_key TEXT,
      event_type_candidate TEXT,
      raw_severity TEXT,
      event_eligible INTEGER NOT NULL DEFAULT 1 CHECK (event_eligible IN (0, 1)),
      location_json TEXT,
      tags_json TEXT NOT NULL,
      raw_metadata_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (source_run_id) REFERENCES source_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (raw_fetch_id) REFERENCES raw_fetches(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS document_domains (
      document_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('politics', 'technology', 'finance', 'hazards')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      PRIMARY KEY (document_id, domain),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_media (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind = 'image'),
      role TEXT NOT NULL CHECK (role IN ('main', 'thumbnail', 'supporting')),
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      thumbnail_url TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('provider', 'publisher', 'official', 'feed')),
      mime_type TEXT,
      width INTEGER CHECK (width IS NULL OR (width > 0 AND width <= 20000)),
      height INTEGER CHECK (height IS NULL OR (height > 0 AND height <= 20000)),
      alt_text TEXT,
      attribution TEXT,
      rights_class TEXT NOT NULL CHECK (rights_class IN ('unknown', 'restricted', 'licensed', 'public_domain', 'publisher_owned')),
      display_policy TEXT NOT NULL CHECK (display_policy IN ('blocked', 'candidate', 'link_only', 'remote_embed')),
      policy_version TEXT NOT NULL,
      policy_reason TEXT NOT NULL,
      is_representative INTEGER NOT NULL DEFAULT 0 CHECK (is_representative IN (0, 1)),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (document_id, normalized_url),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      canonical_title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('emerging', 'active', 'stale', 'merged', 'closed')),
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      document_count INTEGER NOT NULL DEFAULT 0,
      independent_source_count INTEGER NOT NULL DEFAULT 0,
      cluster_method TEXT NOT NULL,
      cluster_version TEXT NOT NULL,
      representative_document_id TEXT,
      merged_into_story_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (representative_document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (merged_into_story_id) REFERENCES stories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS story_documents (
      story_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      similarity_score REAL,
      is_representative INTEGER NOT NULL DEFAULT 0 CHECK (is_representative IN (0, 1)),
      added_at TEXT NOT NULL,
      PRIMARY KEY (story_id, document_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      primary_domain TEXT NOT NULL CHECK (primary_domain IN ('politics', 'technology', 'finance', 'hazards')),
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('emerging', 'ongoing', 'resolved', 'superseded', 'cancelled')),
      verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'single_source', 'multi_source', 'primary_source_confirmed', 'official_confirmed', 'disputed', 'corrected', 'retracted')),
      event_severity TEXT NOT NULL CHECK (event_severity IN ('low', 'medium', 'high', 'critical')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      occurred_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      geo_scope TEXT NOT NULL,
      story_count INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      independent_source_count INTEGER NOT NULL DEFAULT 0,
      has_primary_source INTEGER NOT NULL DEFAULT 0 CHECK (has_primary_source IN (0, 1)),
      has_official_source INTEGER NOT NULL DEFAULT 0 CHECK (has_official_source IN (0, 1)),
      representative_document_id TEXT,
      derivation_method TEXT NOT NULL,
      derivation_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (representative_document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS event_domains (
      event_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('politics', 'technology', 'finance', 'hazards')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      PRIMARY KEY (event_id, domain),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_stories (
      event_id TEXT NOT NULL,
      story_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK (relationship IN ('primary', 'supporting', 'follow_up', 'correction', 'contradiction')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      PRIMARY KEY (event_id, story_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_evidence (
      event_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      evidence_role TEXT NOT NULL CHECK (evidence_role IN ('official', 'primary', 'reporting', 'analysis', 'research', 'observation', 'correction', 'contradiction')),
      supports INTEGER NOT NULL DEFAULT 1 CHECK (supports IN (0, 1)),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      PRIMARY KEY (event_id, document_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      country_code TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      language TEXT,
      PRIMARY KEY (entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_entities (
      event_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      role TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      PRIMARY KEY (event_id, entity_id, role),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_locations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      label TEXT,
      country_code TEXT,
      admin1 TEXT,
      city TEXT,
      geometry_type TEXT NOT NULL,
      latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
      longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
      geometry_json TEXT,
      precision TEXT,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_updates (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      story_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      story_version INTEGER NOT NULL CHECK (story_version >= 1),
      change_type TEXT NOT NULL CHECK (change_type IN (
        'story_created', 'story_updated', 'evidence_added', 'verification_changed',
        'severity_changed', 'event_escalated', 'event_resolved', 'story_corrected',
        'story_disputed', 'story_retracted'
      )),
      primary_domain TEXT NOT NULL CHECK (primary_domain IN ('politics', 'technology', 'finance', 'hazards')),
      event_severity TEXT NOT NULL CHECK (event_severity IN ('low', 'medium', 'high', 'critical')),
      verification_status TEXT NOT NULL CHECK (verification_status IN (
        'unverified', 'single_source', 'multi_source', 'primary_source_confirmed',
        'official_confirmed', 'disputed', 'corrected', 'retracted'
      )),
      previous_state_json TEXT,
      current_state_json TEXT NOT NULL,
      reason_codes_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (story_id, story_version),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_source_runs_source_started ON source_runs(source_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_runs_status ON source_runs(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_schedule_due ON source_schedule_state(next_due_at, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_raw_fetches_run ON raw_fetches(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_documents_source_time ON documents(source_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_published ON documents(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_event_key ON documents(event_key) WHERE event_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_documents_dedupe ON documents(source_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_document_domains_domain ON document_domains(domain, document_id);
    CREATE INDEX IF NOT EXISTS idx_document_media_document ON document_media(document_id, is_representative DESC);
    CREATE INDEX IF NOT EXISTS idx_document_media_source ON document_media(source_id, last_seen_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_media_one_representative
      ON document_media(document_id) WHERE is_representative = 1;
    CREATE INDEX IF NOT EXISTS idx_stories_last_seen ON stories(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_story_documents_document ON story_documents(document_id);
    CREATE INDEX IF NOT EXISTS idx_events_domain_time ON events(primary_domain, last_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, last_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_verification ON events(verification_status, last_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_domains_domain ON event_domains(domain, event_id);
    CREATE INDEX IF NOT EXISTS idx_event_evidence_document ON event_evidence(document_id);
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias ON entity_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_event_entities_entity ON event_entities(entity_id, event_id);
    CREATE INDEX IF NOT EXISTS idx_event_locations_country ON event_locations(country_code, event_id);
    CREATE INDEX IF NOT EXISTS idx_story_updates_story_version ON story_updates(story_id, story_version DESC);
    CREATE INDEX IF NOT EXISTS idx_story_updates_domain_sequence ON story_updates(primary_domain, sequence);
    CREATE INDEX IF NOT EXISTS idx_story_updates_type_sequence ON story_updates(change_type, sequence);
  `);

  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, now);
  migrateSourcesV2(db);
  migrateSourceRunsV2(db);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(2, now);
  migrateStoriesV3(db);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(3, now);
  migrateSourcesV4(db);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(4, now);
}

function migrateSourcesV2(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(sources)").all().map((column) => column.name));
  if (!columns.has("catchup_mode")) {
    db.exec("ALTER TABLE sources ADD COLUMN catchup_mode TEXT NOT NULL DEFAULT 'latest_only'");
  }
}

function migrateSourceRunsV2(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(source_runs)").all().map((column) => column.name));
  const additions = [
    ["trigger_kind", "TEXT NOT NULL DEFAULT 'manual'"],
    ["scheduler_owner", "TEXT"],
    ["scheduled_for_at", "TEXT"],
    ["catchup_mode", "TEXT"],
    ["catchup_from", "TEXT"],
    ["catchup_to", "TEXT"],
    ["gap_status", "TEXT NOT NULL DEFAULT 'none'"],
    ["not_modified", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE source_runs ADD COLUMN ${name} ${definition}`);
  }
}

function migrateStoriesV3(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(stories)").all().map((column) => column.name));
  if (!columns.has("version")) {
    db.exec("ALTER TABLE stories ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)");
  }
}

function migrateSourcesV4(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(sources)").all().map((column) => column.name));
  if (!columns.has("media_policy_json")) {
    db.exec("ALTER TABLE sources ADD COLUMN media_policy_json TEXT NOT NULL DEFAULT '{}'");
  }
}
