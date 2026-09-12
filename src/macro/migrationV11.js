export function migrateMacroV11(db,now){
  if(db.prepare("SELECT 1 FROM schema_migrations WHERE version=11").get())return;
  db.exec("BEGIN IMMEDIATE");
  try{
    db.exec(`ALTER TABLE macro_releases ADD COLUMN effective_date TEXT;
      ALTER TABLE macro_releases ADD COLUMN scheduled_semantics TEXT NOT NULL DEFAULT 'official_calendar';
      CREATE TABLE macro_policy_decisions (
        sequence INTEGER PRIMARY KEY,release_id TEXT NOT NULL REFERENCES macro_releases(id),
        decision_json TEXT NOT NULL,content_hash TEXT NOT NULL,observed_at TEXT NOT NULL,
        raw_fetch_id TEXT NOT NULL REFERENCES raw_fetches(id),implementation_raw_fetch_id TEXT REFERENCES raw_fetches(id),
        UNIQUE(release_id,content_hash)
      );`);
    db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(11,?)").run(now);db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}
