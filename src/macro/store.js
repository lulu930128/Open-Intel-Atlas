import { stableId, contentHash } from "../core/utils.js";
import { MACRO_GROUP_METADATA } from "./indicators.js";
import { buildReleaseId, period, shiftReference, dateOnly } from "./period.js";
import { releasePeriod, buildRequirements } from "./coverage.js";
import { displaySemantics } from "./semantics.js";

function validateRelease(release, metadata) {
  if(!metadata)throw new TypeError("Unknown macro release group");
  const p=releasePeriod(release,metadata);
  if(release.reference_period!==p.period_key || release.id!==buildReleaseId(metadata.country_code||"US",release.release_group,p.period_kind,p.period_key,release.release_stage,release.occurrence_key||null))throw new TypeError("Macro release identity mismatch");
  return p;
}
function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError("Macro timestamp must be UTC ISO-8601");
  return value;
}
function officialUrl(value, metadata) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== metadata?.host || url.username || url.password) throw new TypeError("Invalid macro evidence URL");
  return value;
}

// Called only through AtlasStore, inside the ingestion transaction.
export function saveMacroBatch(store, batch, { sourceId, runId, rawFetchIds, fetchedAt, evidenceDocumentId = null, persistedAt = fetchedAt }) {
  timestamp(fetchedAt);
  timestamp(persistedAt);
  if(persistedAt<fetchedAt)throw new TypeError("Persistence precedes acquisition");
  const db = store.db;
  const catalog=store.macroCatalog || {groups:MACRO_GROUP_METADATA,indicators:[]};
  const metadataFor=r=>catalog.groups[r.release_group];
  function prepareRelease(r) {
    const metadata=metadataFor(r),p=validateRelease(r,metadata);
    const old=db.prepare("SELECT * FROM macro_releases WHERE id=?").get(r.id);
    if(old && (old.period_kind!==p.period_kind||old.period_key!==p.period_key||old.period_start!==p.period_start||old.period_end!==p.period_end))throw new TypeError("Release period changed");
    const requirements=old?.requirements_json||JSON.stringify(buildRequirements(r,catalog.indicators,metadata));
    db.prepare(`INSERT INTO macro_releases(id,release_group,reference_period,period_kind,period_key,period_start,period_end,week_convention,release_stage,occurrence_key,requirements_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(r.id,r.release_group,r.reference_period,p.period_kind,p.period_key,p.period_start,p.period_end,p.week_convention,r.release_stage||"not_applicable",r.occurrence_key||"",requirements);
    return p;
  }
  let insertedCount = 0;
  if (batch.kind === "calendar") {
    if (!Array.isArray(batch.releases) || batch.releases.length > 72) throw new TypeError("Invalid macro calendar batch");
    for (const release of batch.releases) {
      const metadata=metadataFor(release);
      if (sourceId !== metadata?.calendar_source_id) throw new TypeError("Macro calendar ownership mismatch");
      prepareRelease(release);
      timestamp(release.scheduled_at);
      officialUrl(release.calendar_source_url, metadata);
      const before = db.prepare("SELECT scheduled_at FROM macro_releases WHERE id=?").get(release.id);
      db.prepare("UPDATE macro_releases SET scheduled_at=?,calendar_checked_at=? WHERE id=?").run(release.scheduled_at,fetchedAt,release.id);
      if(![undefined,"official_calendar","regular_meeting_1400_eastern_policy"].includes(release.scheduled_semantics))throw new TypeError("Unknown schedule semantics");
      db.prepare("UPDATE macro_releases SET scheduled_semantics=? WHERE id=?").run(release.scheduled_semantics||"official_calendar",release.id);
      if (before?.scheduled_at !== release.scheduled_at) {
        db.prepare(`INSERT INTO macro_calendar_versions(release_id,scheduled_at,observed_at,source_run_id,raw_fetch_id,source_url) VALUES(?,?,?,?,?,?)`)
          .run(release.id, release.scheduled_at, fetchedAt, runId, rawFetchIds[release.raw_fetch_index] || null, release.calendar_source_url);
        insertedCount++;
      }
    }
    return { insertedCount, updatedCount: 0 };
  }
  if (batch.kind !== "release" || !Array.isArray(batch.observations) || batch.observations.length > 100) throw new TypeError("Invalid macro release batch");
  const release = batch.release;
  if(release.release_group==="fomc"&&!batch.decision)throw new TypeError("FOMC release requires typed decision");
  const metadata=metadataFor(release);
  if (sourceId !== metadata?.source_id) throw new TypeError("Macro source ownership mismatch");
  const releaseP=prepareRelease(release);
  timestamp(release.source_published_at);
  if (release.source_published_at > fetchedAt) throw new TypeError("BLS release is still embargoed");
  officialUrl(release.release_url, metadata);
  if (!["official_embargo_time","official_publication_time"].includes(release.timestamp_semantics)) throw new TypeError("Unknown release timestamp semantics");
  const existingRelease = db.prepare("SELECT * FROM macro_releases WHERE id=?").get(release.id);
  if (existingRelease?.source_published_at && release.source_published_at !== existingRelease.source_published_at) throw new TypeError("BLS release timestamp changed; requires reconciliation");
  if(release.effective_at)timestamp(release.effective_at);
  if(release.provider_published_at){timestamp(release.provider_published_at);if(release.provider_published_at>fetchedAt)throw new TypeError("Future provider publication");}
  for(const field of ["effective_at","provider_published_at"])if(existingRelease[field]&&release[field]&&existingRelease[field]!==release[field])throw new TypeError("Release timestamp changed; requires reconciliation");
  db.prepare(`UPDATE macro_releases SET source_published_at=?,first_observed_at=COALESCE(first_observed_at,?),release_url=?,timestamp_semantics=?,last_checked_at=?,
    effective_at=COALESCE(?,effective_at),provider_published_at=COALESCE(?,provider_published_at),persisted_at=COALESCE(persisted_at,?) WHERE id=?`)
    .run(release.source_published_at,fetchedAt,release.release_url,release.timestamp_semantics,fetchedAt,release.effective_at||null,release.provider_published_at||null,persistedAt,release.id);
  if (evidenceDocumentId) db.prepare("UPDATE macro_releases SET evidence_document_id=? WHERE id=?").run(evidenceDocumentId,release.id);
  if(release.effective_date){dateOnly(release.effective_date);if(existingRelease.effective_date&&existingRelease.effective_date!==release.effective_date)throw new TypeError("Effective date changed; requires reconciliation");db.prepare("UPDATE macro_releases SET effective_date=? WHERE id=?").run(release.effective_date,release.id);}
  const baseline = new Map();
  for (const item of batch.observations) {
    const indicator = catalog.indicators.find(i=>i.id===item.indicator_id);
    if (!indicator || indicator.source_id !== sourceId || indicator.release_group!==release.release_group
      || typeof item.actual !== "number" || !Number.isFinite(item.actual)
      || typeof item.preliminary !== "boolean" || typeof item.source_column !== "string" || item.source_column.length > 100) throw new TypeError("Invalid macro observation");
    const p=period(indicator.period_kind||releaseP.period_kind,item.reference_period,{...metadata,week_convention:releaseP.week_convention,...(releaseP.period_kind==="event"?releaseP:{}),...item});
    if(p.period_end>releaseP.period_end)throw new TypeError("Observation is after release reference period");
    displaySemantics(indicator);
    if (indicator.transformation === "index" && (typeof item.index_base !== "string" || !item.index_base || item.index_base.length > 100)) throw new TypeError("Missing macro index base");
    officialUrl(item.source_url, metadata);
    if (!Number.isInteger(item.raw_fetch_index) || !rawFetchIds[item.raw_fetch_index]) throw new TypeError("Missing macro raw lineage");
    const key = `${item.indicator_id}|${item.reference_period}`;
    if (baseline.has(key)) throw new TypeError("Duplicate macro observation in batch");
    // Only values actually known before this release may be called the previous vintage.
    baseline.set(key, db.prepare(`SELECT id FROM macro_observations WHERE indicator_id=? AND reference_period=? AND fetched_at<? ORDER BY sequence DESC LIMIT 1`)
      .get(item.indicator_id, shiftReference(p.period_kind,item.reference_period,-1,p), release.source_published_at)?.id || null);
  }
  for (const item of batch.observations) {
    const prior = db.prepare("SELECT * FROM macro_observations WHERE indicator_id=? AND reference_period=? ORDER BY sequence DESC LIMIT 1")
      .get(item.indicator_id, item.reference_period);
    if(prior?.metadata_json){
      const previousDefinition=JSON.parse(prior.metadata_json),definition=catalog.indicators.find(i=>i.id===item.indicator_id);
      if(["unit","transformation","seasonal_adjustment"].some(key=>previousDefinition[key]!==definition[key]))throw new TypeError("Indicator semantics changed; requires a distinct indicator identity");
    }
    // An older report cannot supersede a newer official vintage during backfill or stale CDN reads.
    if (prior && prior.source_published_at > release.source_published_at) continue;
    let observationId = prior?.id;
    if (!prior || prior.release_id !== release.id || prior.actual !== item.actual || prior.index_base !== (item.index_base || null) || prior.preliminary !== Number(item.preliminary)) {
      const revision = (prior?.revision_number ?? -1) + 1;
      observationId = stableId("macro", `${item.indicator_id}|${item.reference_period}|${revision}|${release.id}`);
      const previous = prior?.release_id === release.id ? prior.previous_observation_id : baseline.get(`${item.indicator_id}|${item.reference_period}`);
      db.prepare(`INSERT INTO macro_observations(id,indicator_id,reference_period,release_id,actual,index_base,preliminary,revision_number,
        source_published_at,fetched_at,previous_observation_id,source_run_id,raw_fetch_id,source_url,source_column) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(observationId,item.indicator_id,item.reference_period,release.id,item.actual,item.index_base || null,Number(item.preliminary),revision,
          release.source_published_at,fetchedAt,previous,runId,rawFetchIds[item.raw_fetch_index],item.source_url,item.source_column);
      const indicator=catalog.indicators.find(i=>i.id===item.indicator_id);
      const p=period(indicator.period_kind||releaseP.period_kind,item.reference_period,{...metadata,week_convention:releaseP.week_convention,...(releaseP.period_kind==="event"?releaseP:{}),...item});
      const reason=item.revision_reason||"unknown";
      if(!["unknown","routine_revision","benchmark_revision","annual_revision","correction"].includes(reason))throw new TypeError("Invalid revision reason");
      db.prepare(`UPDATE macro_observations SET period_kind=?,period_key=?,period_start=?,period_end=?,week_convention=?,estimate_stage=?,revision_reason=?,metadata_json=?,persisted_at=? WHERE id=?`)
        .run(p.period_kind,p.period_key,p.period_start,p.period_end,p.week_convention,release.release_stage||"not_applicable",reason,
          JSON.stringify({...indicator,display_semantics:displaySemantics({...indicator,index_base:item.index_base})}),persistedAt,observationId);
      insertedCount++;
    }
    db.prepare("INSERT OR IGNORE INTO macro_release_observations(release_id,observation_id) VALUES(?,?)").run(release.id,observationId);
  }
  if(batch.artifacts!==undefined) {
    if(!Array.isArray(batch.artifacts)||batch.artifacts.length>20)throw new TypeError("Invalid macro artifacts");
    for(const artifact of batch.artifacts) {
      if(!["statement","implementation_note","sep","dot_plot","press_conference","minutes"].includes(artifact.artifact_type))throw new TypeError("Invalid macro artifact type");
      officialUrl(artifact.source_url,metadata);
      if(artifact.published_at){timestamp(artifact.published_at);if(artifact.published_at>fetchedAt)throw new TypeError("Future artifact publication");}
      const rawId=rawFetchIds[artifact.raw_fetch_index];
      const raw=db.prepare("SELECT * FROM raw_fetches WHERE id=? AND source_run_id=? AND source_id=?").get(rawId||null,runId,sourceId);
      if(!raw?.content_hash||raw.request_url!==artifact.source_url)throw new TypeError("Missing artifact raw lineage");
      const id=stableId("macro_artifact",`${release.id}|${artifact.artifact_type}|${raw.content_hash}`);
      const details=artifact.metadata||{};
      if(typeof details!=="object"||Array.isArray(details)||JSON.stringify(details).length>8192)throw new TypeError("Invalid artifact metadata");
      const documentId=evidenceDocumentId&&db.prepare("SELECT id FROM documents WHERE id=? AND raw_fetch_id=?").get(evidenceDocumentId,rawId)?.id||null;
      insertedCount+=Number(db.prepare("INSERT OR IGNORE INTO macro_artifacts(id,release_id,artifact_type,published_at,fetched_at,source_url,content_hash,raw_fetch_id,document_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id,release.id,artifact.artifact_type,artifact.published_at||null,fetchedAt,artifact.source_url,raw.content_hash,rawId,documentId,JSON.stringify(details)).changes);
    }
  }
  if(batch.decision){
    const d=batch.decision;
    if(release.release_group!=="fomc"||!["hold","hike","cut"].includes(d.decision_type)||!Number.isFinite(d.target_lower)||!Number.isFinite(d.target_upper)||d.target_lower<0||d.target_upper<d.target_lower||d.target_upper>30)throw new TypeError("Invalid FOMC decision");
    if(d.announced_change_bps!==null&&(!Number.isFinite(d.announced_change_bps)||(d.decision_type==="hold"?d.announced_change_bps!==0:d.decision_type==="hike"?d.announced_change_bps<=0:d.announced_change_bps>=0)))throw new TypeError("Invalid FOMC announced change");
    for(const [id,value] of [["US_FED_FUNDS_TARGET_LOWER",d.target_lower],["US_FED_FUNDS_TARGET_UPPER",d.target_upper]])if(!batch.observations.some(o=>o.indicator_id===id&&o.reference_period===release.reference_period&&o.actual===value))throw new TypeError("FOMC decision/observation mismatch");
    if(d.effective_date)dateOnly(d.effective_date);
    if((d.effective_date||null)!==(release.effective_date||null)||!["date_only","unknown"].includes(d.effective_time_status))throw new TypeError("FOMC effective date mismatch");
    const raw=rawFetchIds[d.raw_fetch_index],implementation=d.implementation_raw_fetch_index===null?null:rawFetchIds[d.implementation_raw_fetch_index];
    if(!raw||!db.prepare("SELECT 1 FROM raw_fetches WHERE id=? AND source_run_id=? AND source_id=? AND request_url=?").get(raw,runId,sourceId,d.source_url))throw new TypeError("Missing decision raw lineage");
    if(d.effective_date&&(!implementation||!db.prepare("SELECT 1 FROM raw_fetches WHERE id=? AND source_run_id=? AND source_id=?").get(implementation,runId,sourceId)))throw new TypeError("Missing implementation lineage");
    const payload=JSON.stringify({decision_type:d.decision_type,target_lower:d.target_lower,target_upper:d.target_upper,announced_change_bps:d.announced_change_bps,effective_date:d.effective_date||null,effective_time_status:d.effective_time_status,source_url:d.source_url});
    insertedCount+=Number(db.prepare("INSERT OR IGNORE INTO macro_policy_decisions(release_id,decision_json,content_hash,observed_at,raw_fetch_id,implementation_raw_fetch_id) VALUES(?,?,?,?,?,?)").run(release.id,payload,contentHash(payload),fetchedAt,raw,implementation||null).changes);
  }
  return { insertedCount, updatedCount: 0 };
}

export function listMacroReleases(db, { from, to, group, after = "", limit = 50 }) {
  return db.prepare(`SELECT * FROM macro_releases WHERE COALESCE(scheduled_at,source_published_at)>=? AND COALESCE(scheduled_at,source_published_at)<?
    AND (? IS NULL OR release_group=?) AND COALESCE(scheduled_at,source_published_at)||'|'||id>?
    ORDER BY COALESCE(scheduled_at,source_published_at),id LIMIT ?`).all(from,to,group,group,after,limit);
}

export function releaseObservations(db, id, asOf = "9999-12-31T23:59:59.999Z") {
  return db.prepare(`SELECT o.*, f.payload_truncated AS raw_payload_truncated, f.content_hash AS raw_content_hash
    FROM macro_observations o JOIN raw_fetches f ON f.id=o.raw_fetch_id JOIN macro_release_observations r ON r.observation_id=o.id
    WHERE r.release_id=? AND o.fetched_at<=? AND NOT EXISTS(SELECT 1 FROM macro_observations n JOIN macro_release_observations m ON m.observation_id=n.id
      WHERE m.release_id=r.release_id AND n.indicator_id=o.indicator_id AND n.reference_period=o.reference_period AND n.sequence>o.sequence AND n.fetched_at<=?)
    ORDER BY o.indicator_id,o.reference_period`).all(id,asOf,asOf);
}

export function createMacroReader(db) {
  return {
    maxSequence: () => db.prepare("SELECT COALESCE(MAX(sequence),0) n FROM macro_observations").get().n,
    observation: (id) => id ? db.prepare("SELECT * FROM macro_observations WHERE id=?").get(id) || null : null,
    calendarVersions: (id) => db.prepare("SELECT * FROM macro_calendar_versions WHERE release_id=? ORDER BY sequence DESC LIMIT 100").all(id),
    evidenceDocument: (id) => db.prepare("SELECT evidence_document_id FROM macro_releases WHERE id=?").get(id)?.evidence_document_id || null,
    latestDue: (group, now) => db.prepare("SELECT * FROM macro_releases WHERE release_group=? AND COALESCE(scheduled_at,source_published_at)<=? ORDER BY COALESCE(scheduled_at,source_published_at) DESC,id DESC LIMIT 1").get(group,now) || null,
    observations({ indicator, period, group, asOf, history, snapshot, before, limit }) {
      return db.prepare(`SELECT o.*, f.payload_truncated AS raw_payload_truncated, f.content_hash AS raw_content_hash
        FROM macro_observations o JOIN raw_fetches f ON f.id=o.raw_fetch_id JOIN macro_indicators i ON i.id=o.indicator_id
        WHERE (? IS NULL OR o.indicator_id=?) AND (? IS NULL OR o.reference_period=?) AND (? IS NULL OR i.release_group=?)
        AND o.fetched_at<=? AND o.sequence<=? AND o.sequence<?
        AND (?=1 OR NOT EXISTS(SELECT 1 FROM macro_observations n WHERE n.indicator_id=o.indicator_id AND n.reference_period=o.reference_period
          AND n.sequence>o.sequence AND n.sequence<=? AND n.fetched_at<=?)) ORDER BY o.sequence DESC LIMIT ?`)
        .all(indicator,indicator,period,period,group,group,asOf,snapshot,before,history?1:0,snapshot,asOf,limit);
    }
  };
}
