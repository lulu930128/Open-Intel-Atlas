import { randomUUID } from "node:crypto";
import { saveMacroBatch, listMacroReleases, releaseObservations, createMacroReader } from "./macro/store.js";
import { MACRO_GROUP_METADATA, MACRO_INDICATORS } from "./macro/indicators.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { boundedJson, parseJson, redactUrl, stableId } from "./core/utils.js";
import { initializeAtlasSchema, SCHEMA_VERSION } from "./atlasSchema.js";
import { publicSourceDefinition } from "./atlasSourceRegistry.js";
import { applyEffectiveMediaPolicy, selectRepresentativeMedia } from "./documents/media.js";
import { evaluateDocumentPromotion } from "./atlasPromotion.js";
import { withDocumentClassification } from "./atlasClassification.js";
import { isRetractableNewsHint, NEWS_SOURCE } from "./entities/companyNewsRelevance.js";

const REGIONAL_RELEVANCE_CODES = new Set(["TW", "JP", "EAST_ASIA"]);

export function openAtlasStore(dbPath, { readOnly = false, macroCatalog = null } = {}) {
  if (!readOnly) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { readOnly });
  if (!readOnly) initializeAtlasSchema(db);
  const store = new AtlasStore(db, dbPath);
  store.macroCatalog = macroCatalog || { groups: MACRO_GROUP_METADATA, indicators: MACRO_INDICATORS };
  return store;
}

class AtlasStore {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this.transactionDepth = 0;
    this.macro = createMacroReader(db);
  }

  close() {
    this.db.close();
  }

  saveMacroBatch(batch, lineage) {
    return this.transaction(() => saveMacroBatch(this, batch, lineage));
  }

  listMacroReleases(filters) { return listMacroReleases(this.db, filters); }

  getMacroRelease(id) { return this.db.prepare("SELECT * FROM macro_releases WHERE id=?").get(id) || null; }

  getMacroReleaseObservations(id, asOf) { return releaseObservations(this.db, id, asOf); }

  wakeMacroSchedule(sourceId, nextDueAt, now) {
    this.db.prepare("UPDATE source_schedule_state SET next_due_at=?,updated_at=? WHERE source_id=? AND lease_owner IS NULL AND consecutive_failures=0 AND next_due_at>?")
      .run(nextDueAt, now, sourceId, nextDueAt);
  }

  transaction(callback) {
    const nested = this.transactionDepth > 0;
    const savepoint = `atlas_nested_${this.transactionDepth}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const value = callback();
      this.db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return value;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
      if (nested) this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  registerSources(sources, now = new Date().toISOString()) {
    const statement = this.db.prepare(`
      INSERT INTO sources (
        id, name, provider_type, source_class, authority_class, document_type, catchup_mode,
        homepage, docs_url, attribution, policy_note, media_policy_json, enabled, disabled_reason,
        coverage_json, domains_json, languages_json, countries_json, cadence_ms, timeout_ms,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        provider_type = excluded.provider_type,
        source_class = excluded.source_class,
        authority_class = excluded.authority_class,
        document_type = excluded.document_type,
        catchup_mode = excluded.catchup_mode,
        homepage = excluded.homepage,
        docs_url = excluded.docs_url,
        attribution = excluded.attribution,
        policy_note = excluded.policy_note,
        media_policy_json = excluded.media_policy_json,
        coverage_json = excluded.coverage_json,
        enabled = excluded.enabled,
        disabled_reason = excluded.disabled_reason,
        domains_json = excluded.domains_json,
        languages_json = excluded.languages_json,
        countries_json = excluded.countries_json,
        cadence_ms = excluded.cadence_ms,
        timeout_ms = excluded.timeout_ms,
        updated_at = excluded.updated_at
    `);

    this.transaction(() => {
      for (const source of sources) {
        const value = publicSourceDefinition(source);
        statement.run(
          value.id,
          value.name,
          value.provider_type,
          value.source_class,
          value.authority_class,
          value.document_type,
          value.catchup_mode,
          value.homepage,
          value.docs_url,
          value.attribution,
          value.policy_note,
          JSON.stringify(value.media_policy || {}),
          value.enabled ? 1 : 0,
          value.disabled_reason,
          JSON.stringify(value.coverage || {}),
          JSON.stringify(value.domains || []),
          JSON.stringify(value.languages || []),
          JSON.stringify(value.countries || []),
          value.cadence_ms,
          value.timeout_ms,
          now,
          now
        );
      }
    });
  }

  registerSourceTargets(sources, now = new Date().toISOString()) {
    const statement = this.db.prepare(`
      INSERT INTO source_targets (
        id, source_id, entity_id, security_id, identifier_namespace, identifier_authority,
        identifier_scope, identifier_value, request_key, enabled, priority_tier, cadence_ms,
        next_due_at, policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        entity_id = COALESCE(excluded.entity_id, source_targets.entity_id),
        security_id = COALESCE(excluded.security_id, source_targets.security_id),
        identifier_namespace = excluded.identifier_namespace,
        identifier_authority = excluded.identifier_authority,
        identifier_scope = excluded.identifier_scope,
        identifier_value = excluded.identifier_value,
        request_key = excluded.request_key,
        enabled = excluded.enabled,
        priority_tier = excluded.priority_tier,
        cadence_ms = excluded.cadence_ms,
        next_due_at = CASE
          WHEN excluded.enabled = 0 THEN NULL
          WHEN source_targets.enabled = 0 AND excluded.enabled = 1 THEN excluded.next_due_at
          ELSE source_targets.next_due_at
        END,
        policy_json = excluded.policy_json,
        updated_at = excluded.updated_at
    `);
    this.transaction(() => {
      for (const source of sources) {
        if (!Array.isArray(source.targets)) continue;
        const declaredIds = [];
        for (const target of source.targets || []) {
          const identifier = target.identifier || {};
          const enabled = source.enabled && target.enabled !== false;
          declaredIds.push(target.id);
          const policy = { target_origin: "definition", ...(target.policy || {}) };
          statement.run(
            target.id,
            source.id,
            target.entityId || null,
            target.securityId || null,
            String(identifier.namespace || "ticker").toLowerCase(),
            String(identifier.authority || "").toUpperCase(),
            String(identifier.scope || identifier.authority || "").toUpperCase(),
            String(identifier.value || target.requestKey || "").trim(),
            String(target.requestKey || identifier.value || "").trim(),
            enabled ? 1 : 0,
            Number.isSafeInteger(target.priorityTier) ? target.priorityTier : 100,
            Math.max(60_000, Number(target.cadenceMs || source.cadenceMs || 0)),
            enabled ? now : null,
            boundedJson(policy, 8000),
            now,
            now
          );
        }
        const originClause = "COALESCE(json_extract(policy_json, '$.target_origin'), 'definition') = 'definition'";
        if (declaredIds.length > 0) {
          const placeholders = declaredIds.map(() => "?").join(", ");
          this.db.prepare(`UPDATE source_targets SET enabled = 0, next_due_at = NULL, updated_at = ? WHERE source_id = ? AND ${originClause} AND id NOT IN (${placeholders})`)
            .run(now, source.id, ...declaredIds);
        } else {
          this.db.prepare(`UPDATE source_targets SET enabled = 0, next_due_at = NULL, updated_at = ? WHERE source_id = ? AND ${originClause}`)
            .run(now, source.id);
        }
      }
    });
  }

  disableGeneratedSourceTargets(sourceId, now = new Date().toISOString()) {
    return Number(this.db.prepare(`
      UPDATE source_targets SET enabled = 0, next_due_at = NULL, updated_at = ?
      WHERE source_id = ? AND json_extract(policy_json, '$.target_origin') = 'canonical_master'
        AND (enabled <> 0 OR next_due_at IS NOT NULL)
    `).run(now, sourceId).changes || 0);
  }

  listCompanyNewsTargetCandidates(masterSources) {
    const snapshots = {};
    const incompleteMarkets = [];
    for (const [market, sourceId] of Object.entries(masterSources)) {
      const snapshot = this.db.prepare(`
        SELECT id, status, snapshot_complete, truncated, observed_at
        FROM entity_master_snapshots WHERE source_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1
      `).get(sourceId);
      if (!snapshot || snapshot.status !== "complete" || !snapshot.snapshot_complete || snapshot.truncated) {
        incompleteMarkets.push(market);
      } else {
        snapshots[market] = snapshot;
      }
    }
    if (incompleteMarkets.length > 0) {
      return { complete: false, incomplete_markets: incompleteMarkets, snapshot_ids: {}, candidates: [] };
    }

    const candidates = [];
    for (const [market, snapshot] of Object.entries(snapshots)) {
      const rows = this.db.prepare(`
        SELECT company.id AS entity_id, security.id AS security_id,
          identifier.namespace, identifier.authority, identifier.scope,
          identifier.normalized_value AS value
        FROM entity_master_snapshot_members member
        JOIN entities security ON security.id = member.entity_id AND security.entity_type = 'security'
        JOIN entity_identifiers identifier ON identifier.entity_id = security.id
          AND identifier.namespace = 'ticker' AND identifier.status = 'active'
        JOIN entity_relations relation ON relation.to_entity_id = security.id
          AND relation.relation_type = 'listed_as' AND relation.status = 'active'
        JOIN entities company ON company.id = relation.from_entity_id AND company.entity_type = 'company'
        WHERE member.snapshot_id = ? AND upper(identifier.scope) = ?
        ORDER BY identifier.normalized_value, security.id
      `).all(snapshot.id, market);
      for (const row of rows) {
        candidates.push({
          id: `yahoo-tw-stock-news:${market}:${row.value}`,
          entity_id: row.entity_id,
          security_id: row.security_id,
          identifier: {
            namespace: row.namespace,
            authority: String(row.authority).toUpperCase(),
            scope: String(row.scope).toUpperCase(),
            value: row.value
          },
          request_key: row.value,
          market,
          snapshot_id: snapshot.id
        });
      }
    }
    return {
      complete: true,
      incomplete_markets: [],
      snapshot_ids: Object.fromEntries(Object.entries(snapshots).map(([market, snapshot]) => [market, snapshot.id])),
      candidates
    };
  }

  linkSourceTargetsToCandidates(sourceId, candidates, now = new Date().toISOString()) {
    const statement = this.db.prepare(`
      UPDATE source_targets SET entity_id = ?, security_id = ?, updated_at = ?
      WHERE id = ? AND source_id = ?
        AND COALESCE(json_extract(policy_json, '$.target_origin'), 'definition') = 'definition'
    `);
    let linked = 0;
    this.transaction(() => {
      for (const candidate of candidates) {
        linked += statement.run(candidate.entity_id, candidate.security_id, now, candidate.id, sourceId).changes;
      }
    });
    return linked;
  }

  reconcileGeneratedSourceTargets(source, candidates, options = {}) {
    const now = options.now || new Date().toISOString();
    const enabledIds = options.enabledIds || new Set();
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const statement = this.db.prepare(`
      INSERT INTO source_targets (
        id, source_id, entity_id, security_id, identifier_namespace, identifier_authority,
        identifier_scope, identifier_value, request_key, enabled, priority_tier, cadence_ms,
        next_due_at, policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        entity_id = excluded.entity_id, security_id = excluded.security_id,
        identifier_namespace = excluded.identifier_namespace,
        identifier_authority = excluded.identifier_authority,
        identifier_scope = excluded.identifier_scope,
        identifier_value = excluded.identifier_value,
        request_key = excluded.request_key,
        enabled = excluded.enabled,
        priority_tier = excluded.priority_tier,
        cadence_ms = excluded.cadence_ms,
        next_due_at = CASE
          WHEN excluded.enabled = 0 THEN NULL
          WHEN source_targets.enabled = 0 THEN excluded.next_due_at
          ELSE source_targets.next_due_at
        END,
        policy_json = excluded.policy_json,
        updated_at = excluded.updated_at
    `);
    let enabled = 0;
    this.transaction(() => {
      for (const [index, candidate] of candidates.entries()) {
        const isEnabled = source.enabled && enabledIds.has(candidate.id);
        if (isEnabled) enabled += 1;
        statement.run(
          candidate.id,
          source.id,
          candidate.entity_id,
          candidate.security_id,
          candidate.identifier.namespace,
          candidate.identifier.authority,
          candidate.identifier.scope,
          candidate.identifier.value,
          candidate.request_key,
          isEnabled ? 1 : 0,
          1000 + index,
          Math.max(60_000, Number(options.cadenceMs || source.cadenceMs)),
          isEnabled ? now : null,
          boundedJson({
            target_origin: "canonical_master",
            selection_reason: "bounded_daily_rotation",
            usage_context: "personal_noncommercial",
            query_scope: `${candidate.identifier.authority}:${candidate.identifier.value}`,
            master_snapshot_id: candidate.snapshot_id,
            master_snapshot_ids: options.snapshotIds || {}
          }, 8000),
          now,
          now
        );
      }
      const existing = this.db.prepare(`
        SELECT id FROM source_targets
        WHERE source_id = ? AND json_extract(policy_json, '$.target_origin') = 'canonical_master'
      `).all(source.id);
      for (const row of existing) {
        if (candidateIds.has(row.id)) continue;
        this.db.prepare("UPDATE source_targets SET enabled = 0, next_due_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, row.id);
      }
    });
    return { generated_count: candidates.length, enabled_dynamic_count: enabled };
  }

  listDueSourceTargets(sourceId, now = new Date().toISOString(), limit = 10) {
    return this.db.prepare(`
      SELECT * FROM source_targets
      WHERE source_id = ? AND enabled = 1 AND next_due_at IS NOT NULL AND next_due_at <= ?
        AND (backoff_until IS NULL OR backoff_until <= ?)
      ORDER BY priority_tier ASC, next_due_at ASC, id ASC
      LIMIT ?
    `).all(sourceId, now, now, Math.max(1, Math.min(100, Number(limit) || 10))).map(sourceTargetRow);
  }

  listSourceTargets(sourceId) {
    return this.db.prepare("SELECT * FROM source_targets WHERE source_id = ? ORDER BY priority_tier, id")
      .all(sourceId).map(sourceTargetRow);
  }

  beginSourceTargetRun(sourceRunId, target, now = new Date().toISOString()) {
    const id = `source-target-run:${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO source_target_runs (id, source_target_id, source_run_id, started_at, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(id, target.id, sourceRunId, now);
    return id;
  }

  finishSourceTargetRun(runId, outcome) {
    const finishedAt = outcome.finishedAt || new Date().toISOString();
    this.transaction(() => {
      this.db.prepare(`
        UPDATE source_target_runs SET finished_at = ?, status = ?, http_status = ?, item_count = ?,
          error_type = ?, error_message = ?, duration_ms = ?, warnings_json = ? WHERE id = ?
      `).run(
        finishedAt,
        outcome.status,
        outcome.httpStatus ?? null,
        Math.max(0, Number(outcome.itemCount || 0)),
        outcome.errorType || null,
        outcome.errorMessage ? String(outcome.errorMessage).slice(0, 2000) : null,
        Number.isFinite(outcome.durationMs) ? Math.max(0, Math.round(outcome.durationMs)) : null,
        boundedJson(outcome.warnings || [], 8000),
        runId
      );
      this.db.prepare(`
        UPDATE source_targets SET next_due_at = ?, consecutive_failures = ?, backoff_until = ?,
          last_attempt_at = ?, last_success_at = COALESCE(?, last_success_at),
          last_match_at = COALESCE(?, last_match_at), last_outcome = ?, updated_at = ?
        WHERE id = (SELECT source_target_id FROM source_target_runs WHERE id = ?)
      `).run(
        outcome.nextDueAt,
        Math.max(0, Number(outcome.consecutiveFailures || 0)),
        outcome.backoffUntil || null,
        finishedAt,
        outcome.successAt || null,
        outcome.matchAt || null,
        outcome.status,
        finishedAt,
        runId
      );
    });
  }

  initializeScheduleState(sources, options = {}) {
    const now = options.now || new Date().toISOString();
    const collectOnStart = options.collectOnStart !== false;
    const selectState = this.db.prepare("SELECT * FROM source_schedule_state WHERE source_id = ?");
    const selectLastRun = this.db.prepare(`
      SELECT
        MAX(finished_at) AS last_attempt_at,
        MAX(CASE WHEN status IN ('success', 'partial') THEN finished_at END) AS last_success_at
      FROM source_runs WHERE source_id = ?
    `);
    const insertState = this.db.prepare(`
      INSERT INTO source_schedule_state (
        source_id, next_due_at, lease_owner, lease_expires_at, consecutive_failures,
        backoff_until, last_attempt_at, last_success_at, last_outcome,
        last_gap_status, last_catchup_from, last_catchup_to, updated_at
      ) VALUES (?, ?, NULL, NULL, 0, NULL, ?, ?, NULL, 'none', NULL, NULL, ?)
    `);
    const disableState = this.db.prepare(`
      UPDATE source_schedule_state SET next_due_at = NULL, lease_owner = NULL,
        lease_expires_at = NULL, backoff_until = NULL, updated_at = ? WHERE source_id = ?
    `);
    const enableState = this.db.prepare(`
      UPDATE source_schedule_state SET next_due_at = ?, updated_at = ?
      WHERE source_id = ? AND next_due_at IS NULL
    `);
    const seedState = this.db.prepare(`
      UPDATE source_schedule_state SET next_due_at = ?,
        last_attempt_at = COALESCE(last_attempt_at, ?),
        last_success_at = COALESCE(last_success_at, ?), updated_at = ?
      WHERE source_id = ? AND last_outcome IS NULL
    `);

    this.transaction(() => {
      for (const source of sources) {
        const existing = selectState.get(source.id);
        const history = selectLastRun.get(source.id);
        if (!existing) {
          const nextDueAt = source.enabled
            ? initialNextDue(now, history.last_success_at, source.cadenceMs, collectOnStart)
            : null;
          insertState.run(source.id, nextDueAt, history.last_attempt_at || null, history.last_success_at || null, now);
        } else if (!source.enabled) {
          disableState.run(now, source.id);
        } else {
          const shouldCollectImmediately = collectOnStart && !history.last_attempt_at;
          const nextDueAt = initialNextDue(
            now,
            existing.last_success_at || history.last_success_at,
            source.cadenceMs,
            shouldCollectImmediately
          );
          if (!existing.last_outcome) {
            seedState.run(nextDueAt, history.last_attempt_at || null, history.last_success_at || null, now, source.id);
          } else {
            enableState.run(nextDueAt, now, source.id);
          }
        }
      }
    });
  }

  listDueSchedules(now = new Date().toISOString(), limit = 20) {
    return this.db
      .prepare(`
        SELECT ss.*, s.cadence_ms
        FROM source_schedule_state ss JOIN sources s ON s.id = ss.source_id
        WHERE s.enabled = 1 AND ss.next_due_at IS NOT NULL AND ss.next_due_at <= ?
          AND (ss.lease_expires_at IS NULL OR ss.lease_expires_at <= ?)
        ORDER BY ss.next_due_at, ss.source_id LIMIT ?
      `)
      .all(now, now, Math.max(1, Math.min(100, Number(limit) || 20)))
      .map(scheduleRow);
  }

  getScheduleState(sourceId) {
    const row = this.db
      .prepare(`
        SELECT ss.*, s.cadence_ms FROM source_schedule_state ss
        JOIN sources s ON s.id = ss.source_id WHERE ss.source_id = ?
      `)
      .get(sourceId);
    return row ? scheduleRow(row) : null;
  }

  listScheduleStates() {
    return this.db
      .prepare(`
        SELECT ss.*, s.cadence_ms FROM source_schedule_state ss
        JOIN sources s ON s.id = ss.source_id ORDER BY ss.next_due_at, ss.source_id
      `)
      .all()
      .map(scheduleRow);
  }

  claimSchedule(sourceId, owner, now, leaseExpiresAt) {
    const result = this.db
      .prepare(`
        UPDATE source_schedule_state SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE source_id = ? AND next_due_at IS NOT NULL AND next_due_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      `)
      .run(owner, leaseExpiresAt, now, sourceId, now, now);
    return result.changes > 0 ? this.getScheduleState(sourceId) : null;
  }

  markSchedulesDue(sourceIds, now = new Date().toISOString()) {
    const ids = [...new Set(sourceIds)].filter(Boolean);
    if (ids.length === 0) return 0;
    const statement = this.db.prepare(`
      UPDATE source_schedule_state SET next_due_at = ?, backoff_until = NULL, updated_at = ?
      WHERE source_id = ?
    `);
    let changes = 0;
    this.transaction(() => {
      for (const sourceId of ids) changes += statement.run(now, now, sourceId).changes;
    });
    return changes;
  }

  completeSchedule(sourceId, owner, outcome) {
    const result = this.db
      .prepare(`
        UPDATE source_schedule_state SET
          next_due_at = ?, lease_owner = NULL, lease_expires_at = NULL,
          consecutive_failures = ?, backoff_until = ?, last_attempt_at = ?,
          last_success_at = COALESCE(?, last_success_at), last_outcome = ?,
          last_gap_status = ?, last_catchup_from = ?, last_catchup_to = ?, updated_at = ?
        WHERE source_id = ? AND lease_owner = ?
      `)
      .run(
        outcome.nextDueAt,
        outcome.consecutiveFailures,
        outcome.backoffUntil || null,
        outcome.attemptedAt,
        outcome.successAt || null,
        outcome.status,
        outcome.gapStatus || "none",
        outcome.catchupFrom || null,
        outcome.catchupTo || null,
        outcome.attemptedAt,
        sourceId,
        owner
      );
    return result.changes > 0;
  }

  recoverExpiredSchedules(now = new Date().toISOString()) {
    const expired = this.db
      .prepare(`
        SELECT ss.source_id, ss.lease_owner, ss.consecutive_failures, s.cadence_ms
        FROM source_schedule_state ss JOIN sources s ON s.id = ss.source_id
        WHERE ss.lease_owner IS NOT NULL AND ss.lease_expires_at <= ?
      `)
      .all(now);
    if (expired.length === 0) return [];

    this.transaction(() => {
      const failRun = this.db.prepare(`
        UPDATE source_runs SET finished_at = ?, status = 'failed', error_type = 'ProcessInterrupted',
          error_message = 'Scheduler lease expired before the source run completed.'
        WHERE source_id = ? AND scheduler_owner = ? AND status = 'running'
      `);
      const release = this.db.prepare(`
        UPDATE source_schedule_state SET lease_owner = NULL, lease_expires_at = NULL,
          consecutive_failures = ?, next_due_at = ?, backoff_until = ?,
          last_outcome = 'interrupted', updated_at = ? WHERE source_id = ? AND lease_owner = ?
      `);
      for (const entry of expired) {
        const failures = Number(entry.consecutive_failures || 0) + 1;
        const delayMs = Math.min(24 * 60 * 60 * 1000, Math.max(60_000, Number(entry.cadence_ms || 0)) * 2 ** Math.min(10, failures - 1));
        const nextDueAt = new Date(Date.parse(now) + delayMs).toISOString();
        failRun.run(now, entry.source_id, entry.lease_owner);
        release.run(failures, nextDueAt, nextDueAt, now, entry.source_id, entry.lease_owner);
      }
    });
    return expired.map((entry) => entry.source_id);
  }

  releaseScheduleLeases(owner, now = new Date().toISOString()) {
    return this.db
      .prepare(`
        UPDATE source_schedule_state SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE lease_owner = ?
      `)
      .run(now, owner).changes;
  }

  getHttpValidator(sourceId, requestUrl) {
    const row = this.db
      .prepare(`
        SELECT rf.etag, rf.last_modified FROM raw_fetches rf
        JOIN source_runs sr ON sr.id = rf.source_run_id
        WHERE rf.source_id = ? AND rf.request_url = ?
          AND sr.status IN ('success', 'partial')
          AND (rf.etag IS NOT NULL OR rf.last_modified IS NOT NULL)
        ORDER BY rf.fetched_at DESC LIMIT 1
      `)
      .get(sourceId, redactUrl(requestUrl));
    return row ? { etag: row.etag || null, lastModified: row.last_modified || null } : null;
  }

  beginSourceRun(source, now = new Date().toISOString(), metadata = {}) {
    const id = `run:${randomUUID()}`;
    const status = source.enabled ? "running" : "disabled";
    this.db
      .prepare(`
        INSERT INTO source_runs (
          id, source_id, started_at, finished_at, status, error_type, error_message,
          trigger_kind, scheduler_owner, scheduled_for_at, catchup_mode,
          catchup_from, catchup_to, gap_status, not_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `)
      .run(
        id,
        source.id,
        now,
        source.enabled ? null : now,
        status,
        source.enabled ? null : "ConfigurationDisabled",
        source.disabledReason,
        metadata.triggerKind || "manual",
        metadata.schedulerOwner || null,
        metadata.scheduledForAt || null,
        metadata.catchupMode || source.catchupMode || "latest_only",
        metadata.catchupFrom || null,
        metadata.catchupTo || null,
        metadata.gapStatus || "none"
      );
    return id;
  }

  finishSourceRun(runId, result) {
    const statement = this.db.prepare(`
      UPDATE source_runs
      SET finished_at = ?, status = ?, http_status = ?, item_count = ?, inserted_count = ?,
          updated_count = ?, error_type = ?, error_message = ?, duration_ms = ?
          , not_modified = ?, upstream_item_count = ?, processed_item_count = ?,
          document_count = ?, entity_count = ?, relation_count = ?,
          intentionally_skipped_count = ?, failed_count = ?, truncated = ?, warnings_json = ?
      WHERE id = ?
    `);
    statement.run(
      result.finishedAt,
      result.status,
      result.httpStatus ?? null,
      result.itemCount ?? 0,
      result.insertedCount ?? 0,
      result.updatedCount ?? 0,
      result.errorType ?? null,
      result.errorMessage ?? null,
      result.durationMs ?? null,
      result.notModified ? 1 : 0,
      result.upstreamItemCount ?? null,
      result.processedItemCount ?? null,
      result.documentCount ?? 0,
      result.entityCount ?? 0,
      result.relationCount ?? 0,
      result.intentionallySkippedCount ?? 0,
      result.failedCount ?? 0,
      result.truncated ? 1 : 0,
      boundedJson(result.warnings || [], 8000),
      runId
    );
  }

  saveRawFetches(runId, sourceId, fetches, fetchedAt = new Date().toISOString()) {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO raw_fetches (
        id, source_run_id, source_id, fetched_at, request_url, http_status,
        content_type, etag, last_modified, content_hash, payload_text, payload_truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ids = [];
    for (const fetch of fetches || []) {
      statement.run(
        fetch.id,
        runId,
        sourceId,
        fetchedAt,
        fetch.request_url,
        fetch.http_status,
        fetch.content_type,
        fetch.etag,
        fetch.last_modified,
        fetch.content_hash,
        fetch.payload_text,
        fetch.payload_truncated
      );
      ids.push(fetch.id);
    }
    return ids;
  }

  ingestEntityMaster({ entities = [], relations = [], sourceId, sourceRunId, rawFetchIds = [], completeness = {}, warnings = [] }, now) {
    const timestamp = now || new Date().toISOString();
    return this.transaction(() => {
      const entityIds = [];
      const identifierIds = [];
      for (const entity of entities) {
        const existing = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(entity.id);
        const metadata = { ...parseJson(existing?.metadata_json, {}), ...(entity.metadata || {}) };
        this.db.prepare(`
          INSERT INTO entities (id, entity_type, canonical_name, country_code, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            entity_type = CASE WHEN ? THEN excluded.entity_type ELSE entities.entity_type END,
            canonical_name = CASE WHEN ? THEN excluded.canonical_name ELSE entities.canonical_name END,
            country_code = COALESCE(excluded.country_code, entities.country_code),
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `).run(
          entity.id,
          entity.entity_type,
          entity.canonical_name,
          entity.country_code || null,
          boundedJson(metadata),
          existing?.created_at || timestamp,
          timestamp,
          entity.allow_canonical_update ? 1 : 0,
          entity.allow_canonical_update ? 1 : 0
        );
        entityIds.push(entity.id);

        const aliasStatement = this.db.prepare(`
          INSERT INTO entity_aliases (
            entity_id, alias, language, normalized_alias, alias_type, source_id, source_run_id,
            raw_fetch_id, method, confidence, valid_from, valid_to, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entity_id, alias) DO UPDATE SET
            language = COALESCE(excluded.language, entity_aliases.language),
            normalized_alias = excluded.normalized_alias, alias_type = excluded.alias_type,
            source_id = excluded.source_id, source_run_id = excluded.source_run_id,
            raw_fetch_id = excluded.raw_fetch_id, method = excluded.method,
            confidence = excluded.confidence, valid_from = excluded.valid_from,
            valid_to = excluded.valid_to, status = excluded.status, updated_at = excluded.updated_at
        `);
        for (const alias of entity.aliases || []) {
          aliasStatement.run(
            entity.id, alias.alias, alias.language || null, alias.normalized_alias, alias.alias_type || "name",
            sourceId || null, sourceRunId || null, rawFetchIds[alias.raw_fetch_index ?? entity.raw_fetch_index ?? 0] || null,
            alias.method || "official_master", alias.confidence ?? 1, alias.valid_from || null, alias.valid_to || null,
            alias.status || "active", timestamp, timestamp
          );
        }

        const identifierStatement = this.db.prepare(`
          INSERT INTO entity_identifiers (
            id, entity_id, namespace, authority, scope, normalized_value, display_value,
            status, valid_from, valid_to, source_id, source_run_id, raw_fetch_id,
            confidence, method, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            entity_id = excluded.entity_id, display_value = excluded.display_value, status = excluded.status,
            valid_from = excluded.valid_from, valid_to = excluded.valid_to, source_id = excluded.source_id,
            source_run_id = excluded.source_run_id, raw_fetch_id = excluded.raw_fetch_id,
            confidence = excluded.confidence, method = excluded.method,
            metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
        `);
        for (const identifier of entity.identifiers || []) {
          identifierStatement.run(
            identifier.id, entity.id, identifier.namespace, identifier.authority, identifier.scope || "",
            identifier.normalized_value, identifier.display_value, identifier.status || "active",
            identifier.valid_from || null, identifier.valid_to || null, sourceId || null, sourceRunId || null,
            rawFetchIds[identifier.raw_fetch_index ?? entity.raw_fetch_index ?? 0] || null,
            identifier.confidence ?? 1, identifier.method || "official_identifier",
            boundedJson(identifier.metadata || {}), timestamp, timestamp
          );
          identifierIds.push(identifier.id);
        }
      }

      const relationStatement = this.db.prepare(`
        INSERT INTO entity_relations (
          id, from_entity_id, to_entity_id, relation_type, source_id, source_run_id, raw_fetch_id,
          confidence, method, valid_from, valid_to, status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET confidence = excluded.confidence, method = excluded.method,
          valid_from = excluded.valid_from, valid_to = excluded.valid_to, status = excluded.status,
          metadata_json = excluded.metadata_json, source_run_id = excluded.source_run_id,
          raw_fetch_id = excluded.raw_fetch_id, updated_at = excluded.updated_at
      `);
      for (const relation of relations) {
        relationStatement.run(
          relation.id, relation.from_entity_id, relation.to_entity_id, relation.relation_type,
          sourceId || null, sourceRunId || null, rawFetchIds[relation.raw_fetch_index ?? 0] || null,
          relation.confidence ?? 1, relation.method || "official_relation", relation.valid_from || null,
          relation.valid_to || null, relation.status || "active", boundedJson(relation.metadata || {}), timestamp, timestamp
        );
      }

      let snapshotId = null;
      if (sourceId && sourceRunId && (completeness.snapshot_complete || completeness.status)) {
        snapshotId = stableId("entity-snapshot", `${sourceId}|${sourceRunId}`);
        this.db.prepare(`
          INSERT INTO entity_master_snapshots (
            id, source_id, source_run_id, status, snapshot_complete, truncated,
            upstream_item_count, member_count, content_hash, warnings_json, observed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snapshotId, sourceId, sourceRunId, completeness.status || "unknown",
          completeness.snapshot_complete ? 1 : 0, completeness.truncated ? 1 : 0,
          completeness.upstream_item_count ?? null, new Set(entityIds).size,
          stableId("snapshot-content", [...new Set(entityIds)].sort().join("|")), boundedJson(warnings, 8000), timestamp, timestamp
        );
        const memberStatement = this.db.prepare(`
          INSERT INTO entity_master_snapshot_members (snapshot_id, entity_id, identifier_id, observed_status, metadata_json)
          VALUES (?, ?, ?, 'active', '{}')
        `);
        const snapshotMembers = new Map();
        for (const entity of entities) {
          const current = snapshotMembers.get(entity.id);
          snapshotMembers.set(entity.id, current || entity.identifiers?.[0]?.id || null);
        }
        for (const [entityId, identifierId] of snapshotMembers) memberStatement.run(snapshotId, entityId, identifierId);
      }
      return { entityIds, identifierIds, relationCount: relations.length, snapshotId };
    });
  }

  ingestEntityMasterItem({ entities = [], relations = [], sourceId, sourceRunId, rawFetchIds = [] }, now) {
    return this.ingestEntityMaster({
      entities,
      relations,
      sourceId,
      sourceRunId,
      rawFetchIds,
      completeness: {},
      warnings: []
    }, now);
  }

  finalizeEntityMasterSnapshot({ sourceId, sourceRunId, members = [], completeness = {}, warnings = [] }, now) {
    if (!sourceId || !sourceRunId) throw new TypeError("Entity master snapshot requires sourceId and sourceRunId");
    const timestamp = now || new Date().toISOString();
    const uniqueMembers = new Map();
    for (const member of members) {
      if (!member?.entityId) continue;
      const current = uniqueMembers.get(member.entityId);
      uniqueMembers.set(member.entityId, current || member.identifierId || null);
    }
    return this.transaction(() => {
      const snapshotId = stableId("entity-snapshot", `${sourceId}|${sourceRunId}`);
      this.db.prepare(`
        INSERT INTO entity_master_snapshots (
          id, source_id, source_run_id, status, snapshot_complete, truncated,
          upstream_item_count, member_count, content_hash, warnings_json, observed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId,
        sourceId,
        sourceRunId,
        completeness.status || "unknown",
        completeness.snapshot_complete ? 1 : 0,
        completeness.truncated ? 1 : 0,
        completeness.upstream_item_count ?? null,
        uniqueMembers.size,
        stableId("snapshot-content", [...uniqueMembers.keys()].sort().join("|")),
        boundedJson(warnings, 8000),
        timestamp,
        timestamp
      );
      const statement = this.db.prepare(`
        INSERT INTO entity_master_snapshot_members (snapshot_id, entity_id, identifier_id, observed_status, metadata_json)
        VALUES (?, ?, ?, 'active', '{}')
      `);
      for (const [entityId, identifierId] of uniqueMembers) statement.run(snapshotId, entityId, identifierId);
      return snapshotId;
    });
  }

  beginEntityResolutionRun(documentId, now = new Date().toISOString()) {
    const id = `resolution:${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO entity_resolution_runs (id, method, version, input_scope, started_at)
      VALUES (?, 'structured-identifier-then-exact-name', '1.0.0', ?, ?)
    `).run(id, `document:${documentId}`, now);
    return id;
  }

  finishEntityResolutionRun(runId, result, now = new Date().toISOString()) {
    this.db.prepare(`
      UPDATE entity_resolution_runs SET finished_at = ?, resolved_count = ?, unresolved_count = ?,
        ambiguous_count = ?, error_count = ?, warnings_json = ? WHERE id = ?
    `).run(now, result.resolvedCount || 0, result.unresolvedCount || 0, result.ambiguousCount || 0, result.errorCount || 0, boundedJson(result.warnings || [], 8000), runId);
  }

  findEntityByIdentifier({ namespace, authority, scope = "", normalizedValue }) {
    const row = this.db.prepare(`
      SELECT en.*, ei.id AS identifier_id FROM entity_identifiers ei
      JOIN entities en ON en.id = ei.entity_id
      WHERE ei.namespace = ? AND ei.authority = ? AND ei.scope = ?
        AND ei.normalized_value = ? AND ei.status = 'active'
      LIMIT 2
    `).all(namespace, authority, scope, normalizedValue);
    return row.length === 1 ? entityRow(row[0]) : null;
  }

  findEntitiesByExactName(normalizedName) {
    return this.db.prepare(`
      SELECT DISTINCT en.* FROM entities en
      LEFT JOIN entity_aliases ea ON ea.entity_id = en.id AND ea.status = 'active'
      WHERE lower(trim(en.canonical_name)) = ? OR ea.normalized_alias = ?
      ORDER BY en.id LIMIT 3
    `).all(normalizedName, normalizedName).map(entityRow);
  }

  replaceDocumentEntityMentions(documentId, mentions, unresolved, lineage, resolutionRunId, now = new Date().toISOString()) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM document_entity_mentions WHERE document_id = ?").run(documentId);
      this.db.prepare("DELETE FROM unresolved_entity_mentions WHERE document_id = ? AND resolved_at IS NULL").run(documentId);
      const mentionStatement = this.db.prepare(`
        INSERT INTO document_entity_mentions (
          document_id, entity_id, role, method, confidence, matched_text, resolution_run_id,
          source_id, source_run_id, raw_fetch_id, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mention of mentions) mentionStatement.run(
        documentId, mention.entity_id, mention.role, mention.method, mention.confidence,
        mention.matched_text || null, resolutionRunId, lineage.sourceId || null, lineage.sourceRunId || null,
        lineage.rawFetchId || null, boundedJson(mention.metadata || {}), now, now
      );
      const unresolvedStatement = this.db.prepare(`
        INSERT INTO unresolved_entity_mentions (
          id, document_id, mention_text, normalized_text, reason, candidate_json, resolution_run_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of unresolved) unresolvedStatement.run(
        stableId("unresolved", `${documentId}|${item.normalized_text}|${resolutionRunId}`), documentId,
        item.mention_text, item.normalized_text, item.reason, boundedJson(item.candidates || []), resolutionRunId, now
      );
    });
  }

  refreshStoryEntityLinks(storyId, now = new Date().toISOString()) {
    const rows = this.db.prepare(`
      SELECT dem.entity_id, dem.role, MAX(dem.confidence) AS confidence,
        json_group_array(DISTINCT dem.document_id) AS evidence_ids
      FROM story_documents sd JOIN document_entity_mentions dem ON dem.document_id = sd.document_id
      WHERE sd.story_id = ? GROUP BY dem.entity_id, dem.role
    `).all(storyId);
    this.transaction(() => {
      this.db.prepare("DELETE FROM story_entity_links WHERE story_id = ?").run(storyId);
      const statement = this.db.prepare(`
        INSERT INTO story_entity_links (
          story_id, entity_id, relationship_type, relationship_confidence, relevance_score,
          entity_event_materiality, reason_codes_json, resolution_method, resolution_version,
          evidence_ids_json, first_detected_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'document-mention-fusion', '1.0.0', ?, ?, ?)
      `);
      for (const row of rows) {
        const direct = ["issuer", "subject", "regulator"].includes(row.role);
        statement.run(
          storyId, row.entity_id, row.role, Number(row.confidence), direct ? Number(row.confidence) : Number(row.confidence) * 0.7,
          direct ? "direct" : "contextual", boundedJson([`DOCUMENT_ROLE_${String(row.role).toUpperCase()}`]),
          row.evidence_ids || "[]", now, now
        );
      }
    });
    return rows.length;
  }

  getStoryEntities(storyId) {
    return this.db.prepare(`
      SELECT en.*, sel.relationship_type AS role, sel.relationship_confidence AS confidence,
        sel.relevance_score, sel.entity_event_materiality, sel.reason_codes_json
      FROM story_entity_links sel JOIN entities en ON en.id = sel.entity_id
      WHERE sel.story_id = ? ORDER BY sel.relevance_score DESC, en.canonical_name
    `).all(storyId).map((row) => ({
      ...entityRow(row),
      relevance_score: Number(row.relevance_score),
      materiality: row.entity_event_materiality,
      reason_codes: parseJson(row.reason_codes_json, [])
    }));
  }

  upsertDocument(document, runId, rawFetchId, now = new Date().toISOString()) {
    return this.transaction(() => this._upsertDocument(document, runId, rawFetchId, now));
  }

  _upsertDocument(document, runId, rawFetchId, now = new Date().toISOString()) {
    document = withDocumentClassification(document);
    const byId = this.db.prepare("SELECT id, source_id, raw_metadata_json FROM documents WHERE id = ?").get(document.id);
    const byDedupe = byId
      ? null
      : this.db.prepare("SELECT id, source_id, raw_metadata_json FROM documents WHERE source_id = ? AND dedupe_key = ? ORDER BY first_seen_at LIMIT 1").get(document.source_id, document.dedupe_key);
    const byCanonical = byId || byDedupe || !document.canonical_url
      ? null
      : this.db.prepare("SELECT id, source_id, raw_metadata_json FROM documents WHERE canonical_url = ? ORDER BY first_seen_at, id LIMIT 1").get(document.canonical_url);
    const existing = byId || byDedupe || byCanonical;
    const id = existing?.id || document.id;
    const inserted = !existing;
    if (byCanonical && byCanonical.source_id !== document.source_id) {
      return { inserted: false, observationOnly: true, document: this.getDocument(byCanonical.id, true) };
    }
    const metadata = mergeDocumentMetadata(parseJson(existing?.raw_metadata_json, {}), document.raw_metadata || {}, document.source_id);
    const location = metadata.location || null;
    const promotionDecision = evaluateDocumentPromotion(document, now);
    const statement = this.db.prepare(`
      INSERT INTO documents (
        id, source_id, source_run_id, raw_fetch_id, external_id, document_type,
        canonical_url, title, summary, body_excerpt, language, published_at,
        observed_at, fetched_at, author, publisher, publisher_key, title_hash,
        content_hash, dedupe_key, title_tokens_json, event_key, event_type_candidate,
        raw_severity, event_eligible, location_json, tags_json, raw_metadata_json,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_run_id = excluded.source_run_id,
        raw_fetch_id = excluded.raw_fetch_id,
        external_id = excluded.external_id,
        document_type = excluded.document_type,
        canonical_url = excluded.canonical_url,
        title = excluded.title,
        summary = excluded.summary,
        body_excerpt = excluded.body_excerpt,
        language = excluded.language,
        published_at = excluded.published_at,
        observed_at = excluded.observed_at,
        fetched_at = excluded.fetched_at,
        author = excluded.author,
        publisher = excluded.publisher,
        publisher_key = excluded.publisher_key,
        title_hash = excluded.title_hash,
        content_hash = excluded.content_hash,
        dedupe_key = excluded.dedupe_key,
        title_tokens_json = excluded.title_tokens_json,
        event_key = excluded.event_key,
        event_type_candidate = excluded.event_type_candidate,
        raw_severity = excluded.raw_severity,
        event_eligible = excluded.event_eligible,
        location_json = excluded.location_json,
        tags_json = excluded.tags_json,
        raw_metadata_json = excluded.raw_metadata_json,
        last_seen_at = excluded.last_seen_at
    `);
    statement.run(
      id,
      document.source_id,
      runId,
      rawFetchId || null,
      document.external_id,
      document.document_type,
      document.canonical_url,
      document.title,
      document.summary,
      document.body_excerpt,
      document.language,
      document.published_at,
      document.observed_at,
      document.fetched_at,
      document.author,
      document.publisher,
      document.publisher_key,
      document.title_hash,
      document.content_hash,
      document.dedupe_key,
      JSON.stringify(document.title_tokens || []),
      metadata.event_key,
      metadata.event_type_candidate,
      metadata.raw_severity === null || metadata.raw_severity === undefined ? null : String(metadata.raw_severity),
      promotionDecision.eligible ? 1 : 0,
      location ? boundedJson(location, 8000) : null,
      JSON.stringify(metadata.tags || []),
      boundedJson(metadata, 32_000),
      now,
      now
    );

    this.db.prepare("DELETE FROM document_domains WHERE document_id = ?").run(id);
    const domainStatement = this.db.prepare("INSERT INTO document_domains (document_id, domain, confidence) VALUES (?, ?, ?)");
    for (const domain of document.domains) {
      domainStatement.run(id, domain.domain, domain.confidence);
    }

    this.upsertDocumentMedia(id, document.source_id, document.media, now);

    this._saveDocumentPromotionDecision(id, promotionDecision);

    this.db.prepare("UPDATE documents SET classification_json = ? WHERE id = ?").run(JSON.stringify(document.classification), id);
    return {
      inserted,
      document: { ...document, id, raw_metadata: metadata, raw_metadata_json: boundedJson(metadata, 32_000), promotion_decision: promotionDecision }
    };
  }

  saveDocumentObservation(documentId, observation, now = new Date().toISOString()) {
    const sourceTargetId = observation.sourceTargetId || null;
    const discoveredUrl = observation.discoveredUrl || null;
    const id = stableId("document-observation", [
      documentId,
      observation.sourceId,
      sourceTargetId || "-",
      discoveredUrl || "-"
    ].join("|"));
    this.db.prepare(`
      INSERT INTO document_observations (
        id, document_id, source_id, source_run_id, raw_fetch_id, source_target_id,
        discovered_url, observed_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_run_id = excluded.source_run_id,
        raw_fetch_id = excluded.raw_fetch_id,
        observed_at = excluded.observed_at,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      documentId,
      observation.sourceId,
      observation.sourceRunId || null,
      observation.rawFetchId || null,
      sourceTargetId,
      discoveredUrl,
      observation.observedAt || now,
      boundedJson(observation.metadata || {}, 8000),
      now,
      now
    );
    return id;
  }

  saveDocumentPromotionDecision(documentId, promotionDecision) {
    return this.transaction(() => this._saveDocumentPromotionDecision(documentId, promotionDecision));
  }

  _saveDocumentPromotionDecision(documentId, promotionDecision) {
    const document = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(documentId);
    if (!document) throw new Error(`Document not found while saving promotion decision: ${documentId}`);
    this.db.prepare("UPDATE documents SET event_eligible = ? WHERE id = ?").run(promotionDecision.eligible ? 1 : 0, documentId);
    this.db.prepare(`
      INSERT INTO document_promotion_decisions (
        document_id, status, eligible, reason_codes_json, method, version, evaluated_at, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        status = excluded.status,
        eligible = excluded.eligible,
        reason_codes_json = excluded.reason_codes_json,
        method = excluded.method,
        version = excluded.version,
        evaluated_at = excluded.evaluated_at,
        details_json = excluded.details_json
    `).run(
      documentId,
      promotionDecision.status,
      promotionDecision.eligible ? 1 : 0,
      JSON.stringify(promotionDecision.reason_codes),
      promotionDecision.method,
      promotionDecision.version,
      promotionDecision.evaluated_at,
      boundedJson(promotionDecision.details, 8000)
    );
    return { document_id: documentId, promotion_decision: promotionDecision };
  }

  upsertDocumentMedia(documentId, sourceId, media, now = new Date().toISOString()) {
    if (!Array.isArray(media) || media.length === 0) return;
    this.db.prepare("UPDATE document_media SET is_representative = 0 WHERE document_id = ?").run(documentId);
    const statement = this.db.prepare(`
      INSERT INTO document_media (
        id, document_id, source_id, kind, role, url, normalized_url, thumbnail_url,
        origin, mime_type, width, height, alt_text, attribution, rights_class,
        display_policy, policy_version, policy_reason, is_representative,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, normalized_url) DO UPDATE SET
        role = excluded.role,
        url = excluded.url,
        thumbnail_url = excluded.thumbnail_url,
        origin = excluded.origin,
        mime_type = excluded.mime_type,
        width = excluded.width,
        height = excluded.height,
        alt_text = excluded.alt_text,
        attribution = excluded.attribution,
        rights_class = excluded.rights_class,
        display_policy = excluded.display_policy,
        policy_version = excluded.policy_version,
        policy_reason = excluded.policy_reason,
        is_representative = excluded.is_representative,
        last_seen_at = excluded.last_seen_at
    `);
    for (const item of media) {
      statement.run(
        stableId(`media:${documentId}`, item.normalized_url),
        documentId,
        sourceId,
        item.kind,
        item.role,
        item.url,
        item.normalized_url,
        item.thumbnail_url,
        item.origin,
        item.mime_type,
        item.width,
        item.height,
        item.alt_text,
        item.attribution,
        item.rights_class,
        item.display_policy,
        item.policy_version,
        item.policy_reason,
        item.is_representative ? 1 : 0,
        item.first_seen_at || now,
        now
      );
    }
  }

  getDocument(documentId, includeMetadata = true) {
    const row = this.db
      .prepare(`
        SELECT d.*, s.name AS source_name, s.attribution AS source_attribution, s.policy_note AS source_policy_note,
          s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
          (SELECT json_group_array(json_object('domain', dd.domain, 'confidence', dd.confidence))
           FROM document_domains dd WHERE dd.document_id = d.id) AS domains_json,
          (SELECT json_object(
            'id', dm.id, 'kind', dm.kind, 'role', dm.role, 'url', dm.url,
            'thumbnail_url', dm.thumbnail_url, 'origin', dm.origin, 'mime_type', dm.mime_type,
            'width', dm.width, 'height', dm.height, 'alt_text', dm.alt_text,
            'attribution', dm.attribution, 'rights_class', dm.rights_class,
            'display_policy', dm.display_policy, 'policy_version', dm.policy_version,
            'policy_reason', dm.policy_reason
          ) FROM document_media dm
          WHERE dm.document_id = d.id AND dm.is_representative = 1 LIMIT 1) AS representative_media_json,
          (SELECT json_object(
            'status', pd.status, 'eligible', pd.eligible, 'reason_codes', json(pd.reason_codes_json),
            'method', pd.method, 'version', pd.version, 'evaluated_at', pd.evaluated_at,
            'details', json(pd.details_json)
          ) FROM document_promotion_decisions pd WHERE pd.document_id = d.id) AS promotion_decision_json
        FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?
      `)
      .get(documentId);
    return row ? this.documentRow(row, includeMetadata) : null;
  }

  findStoryForEventKey(eventKey) {
    if (!eventKey) return null;
    return (
      this.db
        .prepare(`
          SELECT s.*, d.title AS representative_title, d.title_tokens_json
          FROM stories s
          JOIN story_documents sd ON sd.story_id = s.id
          JOIN documents source_document ON source_document.id = sd.document_id
          LEFT JOIN documents d ON d.id = s.representative_document_id
          WHERE source_document.event_key = ? AND s.status NOT IN ('merged', 'closed')
          ORDER BY s.updated_at DESC LIMIT 1
        `)
        .get(eventKey) || null
    );
  }

  findStoryForDedupeKey(dedupeKey) {
    if (!dedupeKey) return null;
    return (
      this.db
        .prepare(`
          SELECT s.*, d.title AS representative_title, d.title_tokens_json
          FROM stories s
          JOIN story_documents sd ON sd.story_id = s.id
          JOIN documents source_document ON source_document.id = sd.document_id
          LEFT JOIN documents d ON d.id = s.representative_document_id
          WHERE source_document.dedupe_key = ? AND s.status NOT IN ('merged', 'closed')
          ORDER BY s.updated_at DESC LIMIT 1
        `)
        .get(dedupeKey) || null
    );
  }

  listStoryCandidates(domain, since, limit = 100) {
    return this.db
      .prepare(`
        SELECT DISTINCT s.*, d.title AS representative_title, d.title_tokens_json
        FROM stories s
        JOIN documents d ON d.id = s.representative_document_id
        JOIN document_domains dd ON dd.document_id = d.id
        WHERE s.status IN ('emerging', 'active') AND s.last_seen_at >= ? AND dd.domain = ?
        ORDER BY s.last_seen_at DESC
        LIMIT ?
      `)
      .all(since, domain, limit);
  }

  createStory(document, method, version, now = new Date().toISOString()) {
    const identity = document.raw_metadata?.event_key || document.dedupe_key || document.id;
    let id = stableId("story", identity);
    const collision = this.db.prepare("SELECT representative_document_id FROM stories WHERE id = ?").get(id);
    if (collision && collision.representative_document_id !== document.id) {
      id = stableId("story", `${identity}:${document.id}`);
    }
    this.db
      .prepare(`
        INSERT OR IGNORE INTO stories (
          id, canonical_title, status, first_seen_at, last_seen_at, document_count,
          independent_source_count, cluster_method, cluster_version,
          representative_document_id, created_at, updated_at
        ) VALUES (?, ?, 'emerging', ?, ?, 0, 0, ?, ?, ?, ?, ?)
      `)
      .run(id, document.title, document.observed_at || now, document.observed_at || now, method, version, document.id, now, now);
    return id;
  }

  linkDocumentToStory(storyId, documentId, similarityScore, representative = false, now = new Date().toISOString()) {
    this.db
      .prepare(`
        INSERT INTO story_documents (story_id, document_id, similarity_score, is_representative, added_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(story_id, document_id) DO UPDATE SET
          similarity_score = MAX(story_documents.similarity_score, excluded.similarity_score)
      `)
      .run(storyId, documentId, similarityScore, representative ? 1 : 0, now);
    this.refreshStoryStats(storyId, now);
  }

  refreshStoryStats(storyId, now = new Date().toISOString()) {
    const stats = this.db
      .prepare(`
        SELECT COUNT(*) AS document_count,
               COUNT(DISTINCT d.publisher_key) AS independent_source_count,
               MIN(COALESCE(d.observed_at, d.published_at, d.fetched_at)) AS first_seen_at,
               MAX(COALESCE(d.observed_at, d.published_at, d.fetched_at)) AS last_seen_at
        FROM story_documents sd JOIN documents d ON d.id = sd.document_id
        WHERE sd.story_id = ?
      `)
      .get(storyId);
    this.db
      .prepare(`
        UPDATE stories SET document_count = ?, independent_source_count = ?, first_seen_at = ?, last_seen_at = ?,
          status = CASE WHEN ? > 1 THEN 'active' ELSE 'emerging' END, updated_at = ? WHERE id = ?
      `)
      .run(
        Number(stats.document_count || 0),
        Number(stats.independent_source_count || 0),
        stats.first_seen_at || now,
        stats.last_seen_at || now,
        Number(stats.document_count || 0),
        now,
        storyId
      );
  }

  getStoryDocuments(storyId) {
    const rows = this.db
      .prepare(`
        SELECT d.*, s.name AS source_name, s.attribution AS source_attribution, s.policy_note AS source_policy_note,
          s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
               sd.similarity_score, sd.is_representative,
               (SELECT json_group_array(json_object('domain', dd.domain, 'confidence', dd.confidence))
                FROM document_domains dd WHERE dd.document_id = d.id) AS domains_json,
               (SELECT json_object(
                 'id', dm.id, 'kind', dm.kind, 'role', dm.role, 'url', dm.url,
                 'thumbnail_url', dm.thumbnail_url, 'origin', dm.origin, 'mime_type', dm.mime_type,
                 'width', dm.width, 'height', dm.height, 'alt_text', dm.alt_text,
                 'attribution', dm.attribution, 'rights_class', dm.rights_class,
                 'display_policy', dm.display_policy, 'policy_version', dm.policy_version,
                 'policy_reason', dm.policy_reason
                ) FROM document_media dm
                 WHERE dm.document_id = d.id AND dm.is_representative = 1 LIMIT 1) AS representative_media_json,
                (SELECT json_object(
                  'status', pd.status, 'eligible', pd.eligible, 'reason_codes', json(pd.reason_codes_json),
                  'method', pd.method, 'version', pd.version, 'evaluated_at', pd.evaluated_at,
                  'details', json(pd.details_json)
                ) FROM document_promotion_decisions pd WHERE pd.document_id = d.id) AS promotion_decision_json
        FROM story_documents sd
        JOIN documents d ON d.id = sd.document_id
        JOIN sources s ON s.id = d.source_id
        WHERE sd.story_id = ?
        ORDER BY sd.is_representative DESC, COALESCE(d.published_at, d.observed_at, d.fetched_at) DESC
      `)
      .all(storyId);
    return rows.map((row) => ({ ...this.documentRow(row, true), similarity_score: row.similarity_score, is_representative: Boolean(row.is_representative) }));
  }

  holdEventForStory(storyId, now = new Date().toISOString()) {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT e.id FROM events e JOIN event_stories es ON es.event_id = e.id WHERE es.story_id = ? AND es.relationship = 'primary' AND e.publication_status <> 'held'").all(storyId);
      for (const row of rows) {
        const previous = this.getStoredEventState(row.id);
        this.db.prepare("UPDATE events SET publication_status = 'held', publication_reason = 'promotion:no_eligible_trigger:v1', updated_at = ? WHERE id = ?").run(now, row.id);
        this.recordStoryUpdate(storyId, previous, this.getStoredEventState(row.id), now);
      }
      return rows.length;
    });
  }

  saveEvent(event) {
    const storyId = event.stories?.find((story) => story.relationship === "primary")?.story_id || event.stories?.[0]?.story_id;
    if (!storyId) throw new Error(`Event ${event.id} is missing its owning Story`);
    this.transaction(() => {
      const previousState = this.getStoredEventState(event.id);
      this.db
        .prepare(`
          INSERT INTO events (
            id, event_type, title, summary, primary_domain, lifecycle, verification_status,
            event_severity, confidence, occurred_at, first_seen_at, last_updated_at,
            geo_scope, story_count, evidence_count, independent_source_count,
            has_primary_source, has_official_source, representative_document_id,
            derivation_method, derivation_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            event_type = excluded.event_type,
            title = excluded.title,
            summary = excluded.summary,
            primary_domain = excluded.primary_domain,
            lifecycle = excluded.lifecycle,
            verification_status = excluded.verification_status,
            event_severity = excluded.event_severity,
            confidence = excluded.confidence,
            occurred_at = excluded.occurred_at,
            first_seen_at = excluded.first_seen_at,
            last_updated_at = excluded.last_updated_at,
            geo_scope = excluded.geo_scope,
            story_count = excluded.story_count,
            evidence_count = excluded.evidence_count,
            independent_source_count = excluded.independent_source_count,
            has_primary_source = excluded.has_primary_source,
            has_official_source = excluded.has_official_source,
            representative_document_id = excluded.representative_document_id,
            derivation_method = excluded.derivation_method,
            derivation_version = excluded.derivation_version,
            updated_at = excluded.updated_at
        `)
        .run(
          event.id,
          event.event_type,
          event.title,
          event.summary,
          event.primary_domain,
          event.lifecycle,
          event.verification_status,
          event.event_severity,
          event.confidence,
          event.occurred_at,
          event.first_seen_at,
          event.last_updated_at,
          event.geo_scope,
          event.story_count,
          event.evidence_count,
          event.independent_source_count,
          event.has_primary_source ? 1 : 0,
          event.has_official_source ? 1 : 0,
          event.representative_document_id,
          event.derivation_method,
          event.derivation_version,
          event.created_at,
          event.updated_at
        );

      this.db.prepare("UPDATE events SET publication_status = 'published', publication_reason = NULL WHERE id = ?").run(event.id);
      this.db.prepare("DELETE FROM event_domains WHERE event_id = ?").run(event.id);
      this.db.prepare("DELETE FROM event_stories WHERE event_id = ?").run(event.id);
      this.db.prepare("DELETE FROM event_evidence WHERE event_id = ?").run(event.id);
      this.db.prepare("DELETE FROM event_entities WHERE event_id = ?").run(event.id);
      this.db.prepare("DELETE FROM event_locations WHERE event_id = ?").run(event.id);

      const domainStatement = this.db.prepare("INSERT INTO event_domains (event_id, domain, confidence) VALUES (?, ?, ?)");
      for (const domain of event.domains) domainStatement.run(event.id, domain.domain, domain.confidence);

      const storyStatement = this.db.prepare("INSERT INTO event_stories (event_id, story_id, relationship, confidence) VALUES (?, ?, ?, ?)");
      for (const story of event.stories) storyStatement.run(event.id, story.story_id, story.relationship, story.confidence);

      const evidenceStatement = this.db.prepare(
        "INSERT INTO event_evidence (event_id, document_id, evidence_role, supports, confidence) VALUES (?, ?, ?, ?, ?)"
      );
      for (const evidence of event.evidence) {
        evidenceStatement.run(event.id, evidence.document_id, evidence.evidence_role, evidence.supports ? 1 : 0, evidence.confidence);
      }

      const entityStatement = this.db.prepare(`
        INSERT INTO entities (id, entity_type, canonical_name, country_code, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET canonical_name = excluded.canonical_name, country_code = excluded.country_code,
          metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
      `);
      const aliasStatement = this.db.prepare("INSERT OR IGNORE INTO entity_aliases (entity_id, alias, language) VALUES (?, ?, ?)");
      const eventEntityStatement = this.db.prepare(
        "INSERT INTO event_entities (event_id, entity_id, role, confidence) VALUES (?, ?, ?, ?)"
      );
      for (const entity of event.entities || []) {
        entityStatement.run(
          entity.id,
          entity.entity_type,
          entity.canonical_name,
          entity.country_code,
          boundedJson(entity.metadata || {}),
          event.updated_at,
          event.updated_at
        );
        for (const alias of entity.aliases || []) aliasStatement.run(entity.id, alias, entity.language || null);
        eventEntityStatement.run(event.id, entity.id, entity.role, entity.confidence);
      }

      const locationStatement = this.db.prepare(`
        INSERT INTO event_locations (
          id, event_id, label, country_code, admin1, city, geometry_type, latitude,
          longitude, geometry_json, precision, confidence, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const location of event.locations || []) {
        locationStatement.run(
          location.id,
          event.id,
          location.label,
          location.country_code,
          location.admin1 || null,
          location.city || null,
          location.geometry_type,
          location.latitude,
          location.longitude,
          location.geometry_json ? boundedJson(location.geometry_json, 16000) : null,
          location.precision,
          location.confidence,
          location.is_primary ? 1 : 0
        );
      }

      this._replaceEventRegionalRelevance(event.id, event.regional_relevance || []);

      this.recordStoryUpdate(storyId, previousState, consumerEventState(event), event.updated_at);
    });
  }

  replaceEventRegionalRelevance(eventId, relevance, now = new Date().toISOString()) {
    return this.transaction(() => {
      const previousState = this.getStoredEventState(eventId);
      if (!previousState) throw new Error(`Event not found while saving regional relevance: ${eventId}`);
      const owner = this.db.prepare(`
        SELECT story_id FROM event_stories
        WHERE event_id = ? ORDER BY CASE relationship WHEN 'primary' THEN 0 ELSE 1 END, story_id LIMIT 1
      `).get(eventId);
      if (!owner?.story_id) throw new Error(`Event ${eventId} is missing its owning Story`);
      this._replaceEventRegionalRelevance(eventId, relevance);
      const currentState = this.getStoredEventState(eventId);
      const storyUpdate = this.recordStoryUpdate(owner.story_id, previousState, currentState, now);
      return { event_id: eventId, relevance_count: relevance.length, story_update: storyUpdate };
    });
  }

  _replaceEventRegionalRelevance(eventId, relevance) {
    this.db.prepare("DELETE FROM event_regional_relevance WHERE event_id = ?").run(eventId);
    const statement = this.db.prepare(`
      INSERT INTO event_regional_relevance (
        event_id, region_code, score, reason_codes_json, evidence_json, method, version, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of relevance || []) {
      statement.run(
        eventId,
        entry.region_code,
        entry.score,
        JSON.stringify(entry.reason_codes || []),
        boundedJson(entry.evidence || [], 16000),
        entry.method,
        entry.version,
        entry.evaluated_at
      );
    }
  }

  getStoredEventState(eventId) {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    if (!row) return null;
    return consumerEventState({
      ...row,
      domains: this.db.prepare("SELECT domain, confidence FROM event_domains WHERE event_id = ? ORDER BY confidence DESC, domain").all(eventId),
      stories: this.db.prepare("SELECT story_id, relationship, confidence FROM event_stories WHERE event_id = ? ORDER BY relationship, story_id").all(eventId),
      evidence: this.db.prepare("SELECT document_id, evidence_role, supports, confidence FROM event_evidence WHERE event_id = ? ORDER BY document_id").all(eventId),
      entities: this.db.prepare("SELECT entity_id AS id, role, confidence FROM event_entities WHERE event_id = ? ORDER BY entity_id, role").all(eventId),
      locations: this.db.prepare("SELECT * FROM event_locations WHERE event_id = ? ORDER BY is_primary DESC, id").all(eventId),
      regional_relevance: this.db.prepare("SELECT region_code, score, reason_codes_json, evidence_json, method, version, evaluated_at FROM event_regional_relevance WHERE event_id = ? ORDER BY region_code").all(eventId).map((entry) => ({
        region_code: entry.region_code,
        score: Number(entry.score),
        reason_codes: parseJson(entry.reason_codes_json, []),
        evidence: parseJson(entry.evidence_json, []),
        method: entry.method,
        version: entry.version,
        evaluated_at: entry.evaluated_at
      }))
    });
  }

  recordStoryUpdate(storyId, previousState, currentState, now = new Date().toISOString()) {
    const reasonCodes = changeReasonCodes(previousState, currentState);
    if (reasonCodes.length === 0) return null;

    const story = this.db.prepare("SELECT version FROM stories WHERE id = ?").get(storyId);
    if (!story) throw new Error(`Story not found while recording update: ${storyId}`);
    const storyVersion = Number(story.version || 0) + 1;
    const changeType = selectChangeType(previousState, currentState, reasonCodes);
    const id = stableId("change", `${storyId}:${storyVersion}:${changeType}`);
    this.db.prepare("UPDATE stories SET version = ?, updated_at = ? WHERE id = ?").run(storyVersion, now, storyId);
    this.db
      .prepare(`
        INSERT INTO story_updates (
          id, story_id, event_id, story_version, change_type, primary_domain,
          event_severity, verification_status, previous_state_json, current_state_json,
          reason_codes_json, evidence_ids_json, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        storyId,
        currentState.id,
        storyVersion,
        changeType,
        currentState.primary_domain,
        currentState.event_severity,
        currentState.verification_status,
        previousState ? boundedJson(previousState, 32000) : null,
        boundedJson(currentState, 32000),
        JSON.stringify(reasonCodes),
        JSON.stringify(currentState.evidence_ids),
        now,
        now
      );
    return id;
  }

  listSources() {
    const rows = this.db.prepare(`
      SELECT s.*,
        (SELECT sr.status FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_status,
        (SELECT sr.started_at FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_checked_at,
        (SELECT sr.finished_at FROM source_runs sr WHERE sr.source_id = s.id AND sr.status IN ('success', 'partial') ORDER BY sr.started_at DESC LIMIT 1) AS last_success_at,
        (SELECT sr.finished_at FROM source_runs sr WHERE sr.source_id = s.id AND sr.status IN ('failed', 'rate_limited') ORDER BY sr.started_at DESC LIMIT 1) AS last_failure_at,
        (SELECT sr.error_message FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_error,
        (SELECT sr.item_count FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_item_count,
        (SELECT sr.duration_ms FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS latency_ms,
        (SELECT sr.not_modified FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_not_modified,
        (SELECT COUNT(*) FROM source_targets target WHERE target.source_id = s.id) AS target_count,
        (SELECT COUNT(*) FROM source_targets target WHERE target.source_id = s.id AND target.enabled = 1) AS enabled_target_count,
        (SELECT COUNT(*) FROM source_targets target WHERE target.source_id = s.id AND target.last_outcome IN ('failed', 'rate_limited')) AS failed_target_count,
        (SELECT MAX(target.last_success_at) FROM source_targets target WHERE target.source_id = s.id) AS latest_target_success_at,
        ss.next_due_at, ss.lease_owner, ss.lease_expires_at, ss.consecutive_failures,
        ss.backoff_until, ss.last_outcome AS schedule_last_outcome,
        ss.last_gap_status, ss.last_catchup_from, ss.last_catchup_to
      FROM sources s LEFT JOIN source_schedule_state ss ON ss.source_id = s.id
      ORDER BY s.enabled DESC, s.name
    `).all();
    return rows.map(sourceRow);
  }

  listDocuments(filters = {}) {
    return this.paginatedDocuments(filters, false);
  }

  listStories(filters = {}) {
    const limit = clampLimit(filters.limit);
    const cursor = decodeCursor(filters.cursor);
    const clauses = ["1 = 1"];
    const values = [];
    const regions = Array.isArray(filters.relevance_regions) ? filters.relevance_regions : [];
    if (regions.length) {
      clauses.push(`EXISTS (SELECT 1 FROM event_stories es
        JOIN event_regional_relevance rr ON rr.event_id = es.event_id
        WHERE es.story_id = s.id AND rr.score > 0
          AND rr.region_code IN (${regions.map(() => "?").join(", ")})
          ${filters.domain ? "AND EXISTS (SELECT 1 FROM event_domains ed WHERE ed.event_id = es.event_id AND ed.domain = ?)" : ""})`);
      values.push(...regions);
      if (filters.domain) values.push(filters.domain);
    }
    if (filters.domain) {
      clauses.push("EXISTS (SELECT 1 FROM story_documents sd2 JOIN document_domains dd ON dd.document_id = sd2.document_id WHERE sd2.story_id = s.id AND dd.domain = ?)");
      values.push(filters.domain);
    }
    if (filters.status) {
      clauses.push("s.status = ?");
      values.push(filters.status);
    }
    if (filters.from) {
      clauses.push("s.last_seen_at >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push("s.last_seen_at <= ?");
      values.push(filters.to);
    }
    if (filters.q) {
      clauses.push("s.canonical_title LIKE ?");
      values.push(`%${filters.q}%`);
    }
    if (cursor) {
      clauses.push("(s.last_seen_at < ? OR (s.last_seen_at = ? AND s.id < ?))");
      values.push(cursor.time, cursor.time, cursor.id);
    }
    const rows = this.db
      .prepare(`
        SELECT s.*, d.summary AS representative_summary,
          (SELECT json_group_array(json_object('domain', dd3.domain, 'confidence', dd3.confidence))
           FROM story_documents sd3 JOIN document_domains dd3 ON dd3.document_id = sd3.document_id
           WHERE sd3.story_id = s.id) AS domains_json
        FROM stories s LEFT JOIN documents d ON d.id = s.representative_document_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY s.last_seen_at DESC, s.id DESC LIMIT ?
      `)
      .all(...values, limit + 1);
    const mediaByStory = this.representativeMediaForStories(rows.slice(0, limit).map((row) => row.id));
    return page(rows, limit, (row) => storyRow(row, mediaByStory.get(row.id) || null), "last_seen_at");
  }

  getStory(storyId) {
    const row = this.db.prepare(`
      SELECT s.*, d.summary AS representative_summary,
        (SELECT json_group_array(json_object('domain', dd3.domain, 'confidence', dd3.confidence))
         FROM story_documents sd3 JOIN document_domains dd3 ON dd3.document_id = sd3.document_id
         WHERE sd3.story_id = s.id) AS domains_json
      FROM stories s LEFT JOIN documents d ON d.id = s.representative_document_id
      WHERE s.id = ?
    `).get(storyId);
    if (!row) return null;
    const media = this.representativeMediaForStories([storyId]).get(storyId) || null;
    return { ...storyRow(row, media), documents: this.getStoryDocuments(storyId) };
  }

  getStoryEvent(storyId) {
    const row = this.db
      .prepare(`
        SELECT event_id FROM event_stories
        WHERE story_id = ?
        ORDER BY CASE relationship WHEN 'primary' THEN 0 ELSE 1 END, event_id
        LIMIT 1
      `)
      .get(storyId);
    return row ? this.getEvent(row.event_id) : null;
  }

  listStoryUpdates(filters = {}) {
    const limit = clampLimit(filters.limit);
    const afterSequence = Math.max(0, Number(filters.after_sequence) || 0);
    const clauses = ["sequence > ?"];
    const values = [afterSequence];
    if (filters.domain) {
      clauses.push("primary_domain = ?");
      values.push(filters.domain);
    }
    if (filters.change_type) {
      clauses.push("change_type = ?");
      values.push(filters.change_type);
    }
    const bounds = this.db.prepare("SELECT MIN(sequence) AS min_sequence, MAX(sequence) AS head_sequence FROM story_updates").get();
    const headSequence = Number(bounds.head_sequence || 0);
    const rows = this.db
      .prepare(`
        SELECT * FROM story_updates
        WHERE ${clauses.join(" AND ")}
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const nextSequence = hasMore ? Number(selected.at(-1)?.sequence || afterSequence) : headSequence;
    return {
      items: selected.map(storyUpdateRow),
      after_sequence: afterSequence,
      next_sequence: nextSequence,
      min_sequence: Number(bounds.min_sequence || 0),
      head_sequence: headSequence,
      has_more: hasMore
    };
  }

  listEventsByRegionalRelevance(filters = {}) {
    const regions = [...new Set((filters.regions || [])
      .map((region) => String(region || "").trim().toUpperCase())
      .filter((region) => REGIONAL_RELEVANCE_CODES.has(region)))];
    if (regions.length === 0) return { items: [], next_cursor: null };
    return this.listEvents({ ...filters, cursor: undefined, relevance_regions: regions });
  }

  listEvents(filters = {}) {
    const limit = clampLimit(filters.limit);
    const cursor = decodeCursor(filters.cursor);
    const clauses = ["e.publication_status = 'published'"];
    const values = [];
    const relevanceRegions = Array.isArray(filters.relevance_regions) ? filters.relevance_regions : [];
    if (filters.domain) {
      clauses.push("EXISTS (SELECT 1 FROM event_domains ed WHERE ed.event_id = e.id AND ed.domain = ?)");
      values.push(filters.domain);
    }
    for (const [field, column] of [
      ["event_type", "e.event_type"],
      ["severity", "e.event_severity"],
      ["verification", "e.verification_status"],
      ["lifecycle", "e.lifecycle"]
    ]) {
      if (filters[field]) {
        clauses.push(`${column} = ?`);
        values.push(filters[field]);
      }
    }
    for (const [field, column] of [
      ["exclude_lifecycles", "e.lifecycle"],
      ["exclude_verifications", "e.verification_status"]
    ]) {
      const excluded = [...new Set((Array.isArray(filters[field]) ? filters[field] : []).filter(Boolean))];
      if (excluded.length > 0) {
        clauses.push(`${column} NOT IN (${excluded.map(() => "?").join(", ")})`);
        values.push(...excluded);
      }
    }
    if (filters.country) {
      clauses.push("EXISTS (SELECT 1 FROM event_locations el2 WHERE el2.event_id = e.id AND el2.country_code = ?)");
      values.push(filters.country.toUpperCase());
    }
    if (filters.entity) {
      clauses.push("EXISTS (SELECT 1 FROM event_entities ee JOIN entities en ON en.id = ee.entity_id WHERE ee.event_id = e.id AND (en.id = ? OR en.canonical_name LIKE ?))");
      values.push(filters.entity, `%${filters.entity}%`);
    }
    if (filters.from) {
      clauses.push("e.last_updated_at >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push("e.last_updated_at <= ?");
      values.push(filters.to);
    }
    if (filters.q) {
      clauses.push("(e.title LIKE ? OR e.summary LIKE ?)");
      values.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (relevanceRegions.length > 0) {
      clauses.push(`EXISTS (
        SELECT 1 FROM event_regional_relevance rr_filter
        WHERE rr_filter.event_id = e.id
          AND rr_filter.region_code IN (${relevanceRegions.map(() => "?").join(", ")})
          AND rr_filter.score > 0
      )`);
      values.push(...relevanceRegions);
    }
    if (cursor) {
      clauses.push("(e.last_updated_at < ? OR (e.last_updated_at = ? AND e.id < ?))");
      values.push(cursor.time, cursor.time, cursor.id);
    }
    const relevanceRanked = relevanceRegions.length > 0 && filters.order !== "latest";
    const regionalOrder = relevanceRanked
      ? `(SELECT MAX(rr_order.score) FROM event_regional_relevance rr_order
          WHERE rr_order.event_id = e.id
            AND rr_order.region_code IN (${relevanceRegions.map(() => "?").join(", ")})) DESC,
         e.last_updated_at DESC, e.id DESC`
      : "e.last_updated_at DESC, e.id DESC";
    const rows = this.db
      .prepare(`
        SELECT e.*, d.publisher AS representative_publisher, d.canonical_url AS representative_url,
               s.name AS representative_source, el.label AS location_label, el.country_code,
               el.latitude, el.longitude, el.geometry_type, el.precision,
               (SELECT json_group_array(json_object('domain', ed2.domain, 'confidence', ed2.confidence))
                FROM event_domains ed2 WHERE ed2.event_id = e.id) AS domains_json,
                (SELECT json_group_array(ee2.document_id)
                 FROM event_evidence ee2 WHERE ee2.event_id = e.id) AS evidence_ids_json,
                (SELECT json_group_array(json_object(
                  'region_code', rr.region_code, 'score', rr.score,
                  'reason_codes', json(rr.reason_codes_json), 'evidence', json(rr.evidence_json),
                  'method', rr.method, 'version', rr.version, 'evaluated_at', rr.evaluated_at
                )) FROM event_regional_relevance rr WHERE rr.event_id = e.id) AS regional_relevance_json
        FROM events e
        LEFT JOIN documents d ON d.id = e.representative_document_id
        LEFT JOIN sources s ON s.id = d.source_id
         LEFT JOIN event_locations el ON el.event_id = e.id AND el.is_primary = 1
         WHERE ${clauses.join(" AND ")}
         ORDER BY ${regionalOrder} LIMIT ?
       `)
      .all(...values, ...(relevanceRanked ? relevanceRegions : []), limit + 1);
    const mediaByEvent = this.representativeMediaForEvents(rows.slice(0, limit).map((row) => row.id));
    return page(rows, limit, (row) => this.eventRow(row, mediaByEvent.get(row.id) || null), "last_updated_at");
  }

  getEvent(eventId) {
    const row = this.db
      .prepare(`
        SELECT e.*, d.publisher AS representative_publisher, d.canonical_url AS representative_url,
               s.name AS representative_source, el.label AS location_label, el.country_code,
               el.latitude, el.longitude, el.geometry_type, el.precision,
               (SELECT json_group_array(json_object('domain', ed2.domain, 'confidence', ed2.confidence))
                FROM event_domains ed2 WHERE ed2.event_id = e.id) AS domains_json,
                (SELECT json_group_array(ee2.document_id)
                 FROM event_evidence ee2 WHERE ee2.event_id = e.id) AS evidence_ids_json,
                (SELECT json_group_array(json_object(
                  'region_code', rr.region_code, 'score', rr.score,
                  'reason_codes', json(rr.reason_codes_json), 'evidence', json(rr.evidence_json),
                  'method', rr.method, 'version', rr.version, 'evaluated_at', rr.evaluated_at
                )) FROM event_regional_relevance rr WHERE rr.event_id = e.id) AS regional_relevance_json
        FROM events e
        LEFT JOIN documents d ON d.id = e.representative_document_id
        LEFT JOIN sources s ON s.id = d.source_id
        LEFT JOIN event_locations el ON el.event_id = e.id AND el.is_primary = 1
        WHERE e.id = ?
    `)
      .get(eventId);
    if (!row) return null;
    const eventMedia = this.representativeMediaForEvents([eventId]).get(eventId) || null;
    const event = this.eventRow(row, eventMedia);
    const storyRows = this.db
      .prepare(`
        SELECT s.*, es.relationship, es.confidence AS relationship_confidence,
          d.summary AS representative_summary
        FROM event_stories es JOIN stories s ON s.id = es.story_id
        LEFT JOIN documents d ON d.id = s.representative_document_id
        WHERE es.event_id = ?
      `)
      .all(eventId);
    const mediaByStory = this.representativeMediaForStories(storyRows.map((story) => story.id));
    const stories = storyRows.map((story) => ({
      ...storyRow(story, mediaByStory.get(story.id) || null),
      relationship: story.relationship,
      relationship_confidence: Number(story.relationship_confidence)
    }));
    const evidence = this.db
      .prepare(`
        SELECT d.*, s.name AS source_name, s.attribution AS source_attribution, s.policy_note AS source_policy_note,
          s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
               ee.evidence_role, ee.supports, ee.confidence AS evidence_confidence
               ,(SELECT json_group_array(json_object('domain', dd.domain, 'confidence', dd.confidence))
                 FROM document_domains dd WHERE dd.document_id = d.id) AS domains_json
               ,(SELECT json_object(
                 'id', dm.id, 'kind', dm.kind, 'role', dm.role, 'url', dm.url,
                 'thumbnail_url', dm.thumbnail_url, 'origin', dm.origin, 'mime_type', dm.mime_type,
                 'width', dm.width, 'height', dm.height, 'alt_text', dm.alt_text,
                 'attribution', dm.attribution, 'rights_class', dm.rights_class,
                 'display_policy', dm.display_policy, 'policy_version', dm.policy_version,
                 'policy_reason', dm.policy_reason
                ) FROM document_media dm
                 WHERE dm.document_id = d.id AND dm.is_representative = 1 LIMIT 1) AS representative_media_json,
                (SELECT json_object(
                  'status', pd.status, 'eligible', pd.eligible, 'reason_codes', json(pd.reason_codes_json),
                  'method', pd.method, 'version', pd.version, 'evaluated_at', pd.evaluated_at,
                  'details', json(pd.details_json)
                ) FROM document_promotion_decisions pd WHERE pd.document_id = d.id) AS promotion_decision_json
        FROM event_evidence ee JOIN documents d ON d.id = ee.document_id JOIN sources s ON s.id = d.source_id
        WHERE ee.event_id = ? ORDER BY ee.confidence DESC, d.published_at DESC
      `)
      .all(eventId)
      .map((document) => ({
        ...this.documentRow(document, false),
        evidence_role: document.evidence_role,
        supports: Boolean(document.supports),
        evidence_confidence: Number(document.evidence_confidence)
      }));
    const entities = this.db
      .prepare("SELECT en.*, ee.role, ee.confidence FROM event_entities ee JOIN entities en ON en.id = ee.entity_id WHERE ee.event_id = ?")
      .all(eventId)
      .map(entityRow);
    const locations = this.db.prepare("SELECT * FROM event_locations WHERE event_id = ? ORDER BY is_primary DESC").all(eventId).map(locationRow);
    return { ...event, stories, evidence, entities, locations };
  }

  listEntities(filters = {}) {
    const limit = clampLimit(filters.limit);
    const clauses = ["1 = 1"];
    const values = [];
    if (filters.market) {
      clauses.push("EXISTS (SELECT 1 FROM entity_relations rel JOIN entity_identifiers ticker ON ticker.entity_id = rel.to_entity_id WHERE rel.from_entity_id = entities.id AND rel.relation_type = 'listed_as' AND rel.status = 'active' AND ticker.namespace = 'ticker' AND ticker.status = 'active' AND upper(ticker.scope) = ?)");
      values.push(filters.market);
    }
    if (filters.type) {
      clauses.push("entity_type = ?");
      values.push(filters.type);
    }
    if (filters.q) {
      clauses.push(`(canonical_name LIKE ? OR EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.entity_id = entities.id AND ea.alias LIKE ?)
        OR EXISTS (SELECT 1 FROM entity_relations er JOIN entity_identifiers ei ON ei.entity_id = er.to_entity_id
          WHERE er.from_entity_id = entities.id AND er.relation_type = 'listed_as' AND er.status = 'active'
            AND ei.namespace = 'ticker' AND ei.status = 'active' AND ei.normalized_value = ?))`);
      values.push(`%${filters.q}%`, `%${filters.q}%`, String(filters.q).trim().toUpperCase());
    }
    if (filters.after_name && filters.after_id) {
      clauses.push("(canonical_name COLLATE NOCASE > ? OR (canonical_name COLLATE NOCASE = ? AND id > ?))");
      values.push(filters.after_name, filters.after_name, filters.after_id);
    }
    const rows = this.db.prepare(`
      SELECT * FROM entities WHERE ${clauses.join(" AND ")}
      ORDER BY canonical_name COLLATE NOCASE, id LIMIT ?
    `).all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    return {
      items: selected.map((row) => ({ ...entityRow(row), ...(filters.include_listings ? { securities: this.companyListings(row.id) } : {}) })),
      next_cursor: null,
      next_position: last ? { name: last.canonical_name, id: last.id } : null
    };
  }

  getEntity(entityId, filters = {}) {
    const entity = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    if (!entity) return null;
    const aliases = this.db
      .prepare(`SELECT alias, language, alias_type, method, confidence, status, source_id,
        source_run_id, raw_fetch_id, valid_from, valid_to FROM entity_aliases
        WHERE entity_id = ? ORDER BY alias`)
      .all(entityId);
    const identifiers = this.db.prepare(`
      SELECT id, namespace, authority, scope, normalized_value, display_value, status,
        valid_from, valid_to, source_id, source_run_id, raw_fetch_id, confidence, method, metadata_json
      FROM entity_identifiers WHERE entity_id = ? ORDER BY status, namespace, authority, display_value
    `).all(entityId).map(identifierRow);
    const related = this.getEntityEvents(entityId, filters);
    return { ...entityRow(entity), aliases: aliases.map(aliasRow), identifiers, events: related.events };
  }

  companyListings(entityId) {
    return this.db.prepare(`
      SELECT DISTINCT security.id, upper(identifier.scope) AS exchange, identifier.normalized_value AS ticker
      FROM entity_relations relation
      JOIN entities security ON security.id = relation.to_entity_id AND security.entity_type = 'security'
      JOIN entity_identifiers identifier ON identifier.entity_id = security.id
      WHERE relation.from_entity_id = ? AND relation.relation_type = 'listed_as' AND relation.status = 'active'
        AND identifier.namespace = 'ticker' AND identifier.status = 'active'
      ORDER BY exchange, ticker, security.id LIMIT 20
    `).all(entityId);
  }

  findCompanyByTicker(exchange, symbol) {
    const row = this.db.prepare(`
      SELECT COALESCE(company.id, security.id) AS id,
        COALESCE(company.entity_type, security.entity_type) AS entity_type,
        COALESCE(company.canonical_name, security.canonical_name) AS canonical_name,
        COALESCE(company.country_code, security.country_code) AS country_code,
        COALESCE(company.metadata_json, security.metadata_json) AS metadata_json
      FROM entity_identifiers ei JOIN entities security ON security.id = ei.entity_id
      LEFT JOIN entity_relations er ON er.to_entity_id = security.id AND er.relation_type = 'listed_as' AND er.status = 'active'
      LEFT JOIN entities company ON company.id = er.from_entity_id AND company.entity_type = 'company'
      WHERE security.entity_type = 'security' AND ei.namespace = 'ticker'
        AND ei.authority = ? AND ei.scope = ? AND ei.normalized_value = ? AND ei.status = 'active'
      LIMIT 1
    `).get(String(exchange).toUpperCase(), String(exchange).toUpperCase(), String(symbol).toUpperCase());
    return row ? entityRow(row) : null;
  }

  resolveStockNewsIdentity(exchange, symbol) {
    const rows = this.db.prepare(`
      SELECT DISTINCT security.id AS security_id, company.id AS company_id,
        company.canonical_name AS company_name
      FROM entity_identifiers ticker
      JOIN entities security ON security.id = ticker.entity_id AND security.entity_type = 'security'
      JOIN entity_relations relation ON relation.to_entity_id = security.id
        AND relation.relation_type = 'listed_as' AND relation.status = 'active'
      JOIN entities company ON company.id = relation.from_entity_id AND company.entity_type = 'company'
      WHERE ticker.namespace = 'ticker' AND ticker.status = 'active'
        AND ticker.authority = ? AND ticker.scope = ? AND ticker.normalized_value = ?
      LIMIT 2
    `).all(exchange, exchange, symbol);
    return { ambiguous: rows.length > 1, stock: rows.length === 1 ? { exchange, symbol, ...rows[0] } : null };
  }

  findCompanyForSecurity(securityId) {
    const row = this.db.prepare(`
      SELECT company.* FROM entity_relations er JOIN entities company ON company.id = er.from_entity_id
      WHERE er.to_entity_id = ? AND er.relation_type = 'listed_as' AND er.status = 'active'
        AND company.entity_type = 'company' ORDER BY er.confidence DESC LIMIT 2
    `).all(securityId);
    return row.length === 1 ? entityRow(row[0]) : null;
  }

  getEntityDocuments(entityId, filters = {}) {
    if (!this.db.prepare("SELECT 1 FROM entities WHERE id = ?").get(entityId)) return null;
    const limit = clampLimit(filters.limit);
    const clauses = ["dem.entity_id = ?"];
    const values = [entityId];
    if (filters.before_time && filters.before_id) {
      clauses.push("(COALESCE(d.published_at, d.observed_at, d.fetched_at) < ? OR (COALESCE(d.published_at, d.observed_at, d.fetched_at) = ? AND d.id < ?))");
      values.push(filters.before_time, filters.before_time, filters.before_id);
    }
    const rows = this.db.prepare(`
      SELECT dem.document_id, dem.role, dem.method, dem.confidence, dem.matched_text,
        COALESCE(d.published_at, d.observed_at, d.fetched_at) AS sort_time
      FROM document_entity_mentions dem JOIN documents d ON d.id = dem.document_id
      WHERE ${clauses.join(" AND ")} ORDER BY sort_time DESC, d.id DESC LIMIT ?
    `).all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    return {
      entity_id: entityId,
      documents: selected.map((row) => ({
        ...this.getDocument(row.document_id, false),
        entity_context: { role: row.role, method: row.method, confidence: Number(row.confidence), matched_text: row.matched_text }
      })),
      next_position: last ? { time: last.sort_time, id: last.document_id } : null
    };
  }

  listCompanyNews(filters = {}) {
    return this.listCompanyDocuments(filters, "news", "company.news");
  }

  listCompanyDisclosures(filters = {}) {
    return this.listCompanyDocuments(filters, "financial_release", "company.disclosures");
  }

  listCompanyDocuments(filters, documentType, capability) {
    const markets = [...new Set((filters.markets || []).map(normalizeMarket).filter(Boolean))];
    const selectedMarkets = markets.length > 0 ? markets : ["TWSE", "TPEX"];
    const limit = clampLimit(filters.limit);
    const clauses = [
      "d.document_type = ?",
      "EXISTS (SELECT 1 FROM json_each(s.coverage_json, '$.capabilities') capability WHERE capability.value = ?)"
    ];
    const values = [documentType, capability];
    const marketPlaceholders = selectedMarkets.map(() => "?").join(", ");
    clauses.push(documentType === "financial_release" ? `EXISTS (SELECT 1 FROM json_each(s.coverage_json, '$.markets') market WHERE upper(market.value) IN (${marketPlaceholders}))` : `EXISTS (
      SELECT 1
      FROM document_entity_mentions mention
      JOIN entities mentioned ON mentioned.id = mention.entity_id
      JOIN entity_relations relation ON relation.relation_type = 'listed_as' AND relation.status = 'active'
        AND ((mentioned.entity_type = 'company' AND relation.from_entity_id = mentioned.id)
          OR (mentioned.entity_type = 'security' AND relation.to_entity_id = mentioned.id))
      JOIN entity_identifiers ticker ON ticker.entity_id = relation.to_entity_id
        AND ticker.namespace = 'ticker' AND ticker.status = 'active'
      WHERE mention.document_id = d.id AND upper(ticker.scope) IN (${marketPlaceholders})
    )`);
    values.push(...selectedMarkets);
    if (filters.security_id && filters.company_id) {
      clauses.push(`EXISTS (SELECT 1 FROM document_entity_mentions exact_mention
        WHERE exact_mention.document_id = d.id AND exact_mention.entity_id IN (?, ?))`);
      values.push(filters.security_id, filters.company_id);
    }
    if (filters.before_time && filters.before_id) {
      clauses.push("(COALESCE(d.published_at, d.observed_at, d.fetched_at) < ? OR (COALESCE(d.published_at, d.observed_at, d.fetched_at) = ? AND d.id < ?))");
      values.push(filters.before_time, filters.before_time, filters.before_id);
    }
    const rows = this.db.prepare(`
      SELECT d.*, s.name AS source_name, s.attribution AS source_attribution,
        s.policy_note AS source_policy_note, s.authority_class, s.source_class,
        s.countries_json AS source_countries_json, s.media_policy_json,
        COALESCE(d.published_at, d.observed_at, d.fetched_at) AS sort_time,
        (SELECT json_group_array(json_object('domain', dd.domain, 'confidence', dd.confidence))
         FROM document_domains dd WHERE dd.document_id = d.id) AS domains_json,
        (SELECT json_object(
          'status', pd.status, 'eligible', pd.eligible, 'reason_codes', json(pd.reason_codes_json),
          'method', pd.method, 'version', pd.version, 'evaluated_at', pd.evaluated_at,
          'details', json(pd.details_json)
        ) FROM document_promotion_decisions pd WHERE pd.document_id = d.id) AS promotion_decision_json
      FROM documents d JOIN sources s ON s.id = d.source_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY sort_time DESC, d.id DESC LIMIT ?
    `).all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    return {
      items: selected.map((row) => ({
        ...this.documentRow(row, false),
        sort_time: row.sort_time,
        companies: this.getDocumentCompanyContexts(row.id, selectedMarkets)
      })),
      next_position: last ? { time: last.sort_time, id: last.id } : null
    };
  }

  getCompanyNewsCoverage(markets = ["TWSE", "TPEX"], now = new Date().toISOString()) {
    const selectedMarkets = [...new Set(markets.map(normalizeMarket).filter(Boolean))];
    const source = this.db.prepare("SELECT enabled, disabled_reason, coverage_json FROM sources WHERE id = 'yahoo-tw-stock-news'").get();
    const targets = source ? this.listSourceTargets("yahoo-tw-stock-news").filter((target) => selectedMarkets.includes(normalizeMarket(target.identifier.scope))) : [];
    const enabledTargets = targets.filter((target) => target.enabled);
    const currentTargets = enabledTargets.filter((target) => {
      const success = Date.parse(target.last_success_at || "");
      return Number.isFinite(success) && Math.max(0, Date.parse(now) - success) <= Math.max(60_000, target.cadence_ms) * 2;
    });
    const failedTargets = enabledTargets.filter((target) => ["failed", "rate_limited"].includes(target.last_outcome));
    const successTimes = enabledTargets.map((target) => Date.parse(target.last_success_at || "")).filter(Number.isFinite);
    const placeholders = selectedMarkets.map(() => "?").join(", ");
    const eligible = selectedMarkets.length > 0
      ? Number(this.db.prepare(`SELECT COUNT(DISTINCT ticker.entity_id) count
          FROM entity_identifiers ticker
          JOIN entities security ON security.id = ticker.entity_id AND security.entity_type = 'security'
          JOIN entity_relations relation ON relation.to_entity_id = security.id
            AND relation.relation_type = 'listed_as' AND relation.status = 'active'
          WHERE ticker.namespace = 'ticker' AND ticker.status = 'active'
            AND upper(ticker.scope) IN (${placeholders})`).get(...selectedMarkets).count || 0)
      : 0;
    let status;
    if (!source) status = "missing";
    else if (!source.enabled) status = "disabled";
    else if (enabledTargets.length === 0) status = "missing";
    else if (currentTargets.length === enabledTargets.length && failedTargets.length === 0) status = "current";
    else if (currentTargets.length > 0) status = "partial";
    else if (failedTargets.length === enabledTargets.length && successTimes.length === 0) status = "failed";
    else if (successTimes.length > 0) status = "stale";
    else status = "missing";
    const warnings = [];
    if (enabledTargets.length < eligible) {
      warnings.push({
        code: "COMPANY_NEWS_TARGET_COVERAGE_LIMITED",
        message: `Company News currently enables ${enabledTargets.length} of ${eligible} canonical securities in this market scope.`
      });
    }
    if (failedTargets.length > 0) {
      warnings.push({ code: "COMPANY_NEWS_TARGET_FAILURE", message: `${failedTargets.length} enabled Company News target(s) are failed or rate limited.` });
    }
    return {
      freshness: {
        status,
        as_of: successTimes.length ? new Date(Math.max(...successTimes)).toISOString() : null,
        data_as_of: successTimes.length ? new Date(Math.max(...successTimes)).toISOString() : null
      },
      coverage: {
        status,
        guarantee: parseJson(source?.coverage_json, {}).guarantee || "best_effort",
        markets: selectedMarkets,
        scope: enabledTargets.length < eligible ? "limited_targets" : "all_eligible_targets",
        eligible_targets: eligible,
        registered_targets: targets.length,
        enabled_targets: enabledTargets.length,
        current_targets: currentTargets.length,
        failed_targets: failedTargets.length,
        last_match_at: latestIso(enabledTargets.map((target) => target.last_match_at))
      },
      warnings
    };
  }

  getDocumentCompanyContexts(documentId, markets = ["TWSE", "TPEX"]) {
    const selectedMarkets = [...new Set(markets.map(normalizeMarket).filter(Boolean))];
    if (selectedMarkets.length === 0) return [];
    const placeholders = selectedMarkets.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT company.id AS company_id, company.canonical_name AS company_name,
        company.country_code, security.id AS security_id,
        ticker.authority, ticker.scope, ticker.normalized_value AS ticker,
        mention.role, mention.method, mention.confidence
      FROM document_entity_mentions mention
      JOIN entities mentioned ON mentioned.id = mention.entity_id
      JOIN entity_relations relation ON relation.relation_type = 'listed_as' AND relation.status = 'active'
        AND ((mentioned.entity_type = 'company' AND relation.from_entity_id = mentioned.id)
          OR (mentioned.entity_type = 'security' AND relation.to_entity_id = mentioned.id))
      JOIN entities company ON company.id = relation.from_entity_id AND company.entity_type = 'company'
      JOIN entities security ON security.id = relation.to_entity_id AND security.entity_type = 'security'
      JOIN entity_identifiers ticker ON ticker.entity_id = security.id
        AND ticker.namespace = 'ticker' AND ticker.status = 'active'
      WHERE mention.document_id = ? AND upper(ticker.scope) IN (${placeholders})
      ORDER BY company.canonical_name, company.id, ticker.scope, ticker.normalized_value
    `).all(documentId, ...selectedMarkets);
    const companies = new Map();
    for (const row of rows) {
      let company = companies.get(row.company_id);
      if (!company) {
        company = {
          id: row.company_id,
          canonical_name: row.company_name,
          country_code: row.country_code || null,
          entity_context: { role: row.role, method: row.method, confidence: Number(row.confidence) },
          securities: []
        };
        companies.set(row.company_id, company);
      } else if (Number(row.confidence) > company.entity_context.confidence) {
        company.entity_context = { role: row.role, method: row.method, confidence: Number(row.confidence) };
      }
      if (!company.securities.some((security) => security.id === row.security_id)) {
        company.securities.push({
          id: row.security_id,
          exchange: normalizeMarket(row.scope),
          ticker: row.ticker,
          identifier: { namespace: "ticker", authority: normalizeMarket(row.authority), scope: normalizeMarket(row.scope), value: row.ticker }
        });
      }
    }
    return [...companies.values()];
  }

  getEntityStories(entityId, filters = {}) {
    if (!this.db.prepare("SELECT 1 FROM entities WHERE id = ?").get(entityId)) return null;
    const limit = clampLimit(filters.limit);
    const clauses = ["sel.entity_id = ?"];
    const values = [entityId];
    if (filters.before_time && filters.before_id) {
      clauses.push("(st.last_seen_at < ? OR (st.last_seen_at = ? AND st.id < ?))");
      values.push(filters.before_time, filters.before_time, filters.before_id);
    }
    const rows = this.db.prepare(`
      SELECT sel.story_id, sel.relationship_type, sel.relationship_confidence,
        sel.relevance_score, sel.entity_event_materiality, sel.reason_codes_json, st.last_seen_at AS sort_time
      FROM story_entity_links sel JOIN stories st ON st.id = sel.story_id
      WHERE ${clauses.join(" AND ")} ORDER BY st.last_seen_at DESC, st.id DESC LIMIT ?
    `).all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    return {
      entity_id: entityId,
      stories: selected.map((row) => ({
        ...this.getStory(row.story_id),
        entity_context: {
          relationship_type: row.relationship_type,
          confidence: Number(row.relationship_confidence),
          relevance_score: Number(row.relevance_score),
          materiality: row.entity_event_materiality,
          reason_codes: parseJson(row.reason_codes_json, [])
        }
      })),
      next_position: last ? { time: last.sort_time, id: last.story_id } : null
    };
  }

  getEntityRelations(entityId, filters = {}) {
    if (!this.db.prepare("SELECT 1 FROM entities WHERE id = ?").get(entityId)) return null;
    const limit = clampLimit(filters.limit);
    const clauses = ["(er.from_entity_id = ? OR er.to_entity_id = ?)"];
    const values = [entityId, entityId];
    if (filters.after_type && filters.after_id) {
      clauses.push("(er.relation_type > ? OR (er.relation_type = ? AND er.id > ?))");
      values.push(filters.after_type, filters.after_type, filters.after_id);
    }
    const rows = this.db.prepare(`
      SELECT er.*, from_en.canonical_name AS from_name, from_en.entity_type AS from_type,
        to_en.canonical_name AS to_name, to_en.entity_type AS to_type
      FROM entity_relations er
      JOIN entities from_en ON from_en.id = er.from_entity_id
      JOIN entities to_en ON to_en.id = er.to_entity_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY er.relation_type, er.id LIMIT ?
    `).all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    return {
      entity_id: entityId,
      relations: selected.map(relationRow),
      next_position: last ? { type: last.relation_type, id: last.id } : null
    };
  }

  getEntityCoverageEvidence(entityId, options = {}) {
    const documentSince = options.documentSince || "0000-01-01T00:00:00.000Z";
    const masterRows = this.db.prepare(`
      SELECT ems.source_id, MAX(ems.observed_at) AS matched_at
      FROM entity_master_snapshot_members member
      JOIN entity_master_snapshots ems ON ems.id = member.snapshot_id
      WHERE member.entity_id = ?
      GROUP BY ems.source_id
    `).all(entityId);
    const documentRows = this.db.prepare(`
      SELECT d.source_id, MAX(COALESCE(d.published_at, d.observed_at, d.fetched_at)) AS matched_at
      FROM document_entity_mentions mention
      JOIN documents d ON d.id = mention.document_id
      WHERE mention.entity_id = ?
      GROUP BY d.source_id
    `).all(entityId);
    const observationRows = this.db.prepare(`
      SELECT observation.source_id,
        MAX(COALESCE(d.published_at, d.observed_at, observation.observed_at)) AS matched_at,
        COUNT(DISTINCT d.id) AS document_count
      FROM document_entity_mentions mention
      JOIN documents d ON d.id = mention.document_id
      JOIN document_observations observation ON observation.document_id = d.id
      WHERE mention.entity_id = ?
        AND COALESCE(d.published_at, d.observed_at, observation.observed_at) >= ?
      GROUP BY observation.source_id
    `).all(entityId, documentSince);
    const marketRows = this.db.prepare(`
      SELECT DISTINCT identifier.scope AS market
      FROM entity_relations relation
      JOIN entity_identifiers identifier ON identifier.entity_id = relation.to_entity_id
      WHERE relation.from_entity_id = ? AND relation.relation_type = 'listed_as'
        AND relation.status = 'active' AND identifier.namespace = 'ticker' AND identifier.status = 'active'
    `).all(entityId);
    const targetRows = this.db.prepare(`
      SELECT target.*
      FROM source_targets target
      JOIN entity_identifiers identifier
        ON identifier.namespace = target.identifier_namespace
       AND upper(identifier.authority) = upper(target.identifier_authority)
       AND upper(identifier.scope) = upper(target.identifier_scope)
       AND identifier.normalized_value = target.identifier_value
       AND identifier.status = 'active'
      JOIN entity_relations relation
        ON relation.to_entity_id = identifier.entity_id
       AND relation.from_entity_id = ?
       AND relation.relation_type = 'listed_as'
       AND relation.status = 'active'
      ORDER BY target.source_id, target.priority_tier, target.id
    `).all(entityId).map(sourceTargetRow);
    const targetStates = {};
    for (const target of targetRows) {
      (targetStates[target.source_id] ||= []).push(target);
    }
    const observationMatches = Object.fromEntries(observationRows.map((row) => [row.source_id, row.matched_at]));
    const legacyMatches = Object.fromEntries(documentRows.map((row) => [row.source_id, row.matched_at]));
    return {
      markets: marketRows.map((row) => String(row.market || "").toUpperCase()).filter(Boolean),
      master_matches: Object.fromEntries(masterRows.map((row) => [row.source_id, row.matched_at])),
      document_matches: { ...legacyMatches, ...observationMatches },
      document_counts: Object.fromEntries(observationRows.map((row) => [row.source_id, Number(row.document_count || 0)])),
      target_states: targetStates
    };
  }

  getEntitySnapshot(entityId, filters = {}) {
    const entity = this.getEntity(entityId, filters);
    if (!entity) return null;
    const documents = this.getEntityDocuments(entityId, filters)?.documents || [];
    const stories = this.getEntityStories(entityId, filters)?.stories || [];
    const relations = this.getEntityRelations(entityId, { limit: filters.limit })?.relations || [];
    const lastMaster = this.db.prepare(`
      SELECT ems.* FROM entity_master_snapshot_members member
      JOIN entity_master_snapshots ems ON ems.id = member.snapshot_id
      WHERE member.entity_id = ? ORDER BY ems.observed_at DESC LIMIT 1
    `).get(entityId);
    return {
      entity,
      summary: {
        event_count: entity.events.length,
        story_count: stories.length,
        document_count: documents.length,
        relation_count: relations.length
      },
      latest_events: entity.events,
      latest_stories: stories,
      latest_documents: documents,
      relations,
      master_snapshot: lastMaster ? snapshotRow(lastMaster) : null
    };
  }

  getEntityEvents(entityId, filters = {}) {
    const entity = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    if (!entity) return null;
    const limit = clampLimit(filters.limit);
    const clauses = ["ee.entity_id = ?", "e.publication_status = 'published'"];
    const values = [entityId];
    if (filters.before_time && filters.before_id) {
      clauses.push("(e.last_updated_at < ? OR (e.last_updated_at = ? AND e.id < ?))");
      values.push(filters.before_time, filters.before_time, filters.before_id);
    }
    const rows = this.db
      .prepare(`
        SELECT e.*,
          (SELECT json_group_array(json_object(
            'region_code', rr.region_code, 'score', rr.score,
            'reason_codes', json(rr.reason_codes_json), 'evidence', json(rr.evidence_json),
            'method', rr.method, 'version', rr.version, 'evaluated_at', rr.evaluated_at
          )) FROM event_regional_relevance rr WHERE rr.event_id = e.id) AS regional_relevance_json
        FROM event_entities ee JOIN events e ON e.id = ee.event_id
        WHERE ${clauses.join(" AND ")} ORDER BY e.last_updated_at DESC, e.id DESC LIMIT ?
      `)
      .all(...values, limit + 1);
    const selected = rows.slice(0, limit);
    const last = rows.length > limit ? selected.at(-1) : null;
    const mediaByEvent = this.representativeMediaForEvents(selected.map((row) => row.id));
    return {
      entity: entityRow(entity),
      events: selected.map((row) => this.eventRow(row, mediaByEvent.get(row.id) || null)),
      next_position: last ? { time: last.last_updated_at, id: last.id } : null
    };
  }

  search(query, limit = 30) {
    const boundedLimit = clampLimit(limit);
    const each = Math.max(1, Math.ceil(boundedLimit / 3));
    return {
      query,
      documents: this.listDocuments({ q: query, limit: each }).items,
      stories: this.listStories({ q: query, limit: each }).items,
      events: this.listEvents({ q: query, limit: each }).items,
      entities: this.listEntities({ q: query, limit: each }).items
    };
  }

  getStats() {
    const counts = {};
    for (const table of ["sources", "source_runs", "source_schedule_state", "source_targets", "source_target_runs", "raw_fetches", "documents", "document_observations", "document_promotion_decisions", "document_media", "stories", "story_updates", "events", "event_regional_relevance", "entities"]) {
      counts[table] = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
    }
    const lastRun = this.db.prepare("SELECT MAX(finished_at) AS value FROM source_runs").get().value || null;
    const latestDocument = this.db.prepare("SELECT MAX(last_seen_at) AS value FROM documents").get().value || null;
    return { db_file: this.dbPath, schema_version: SCHEMA_VERSION, ...counts, last_source_run_at: lastRun, latest_document_at: latestDocument };
  }

  getDataAsOf(domain = null) {
    if (!domain) {
      return this.db.prepare("SELECT MAX(last_seen_at) AS value FROM documents").get().value || null;
    }
    return (
      this.db
        .prepare(`
          SELECT MAX(d.last_seen_at) AS value FROM documents d
          JOIN document_domains dd ON dd.document_id = d.id WHERE dd.domain = ?
        `)
        .get(domain).value || null
    );
  }

  paginatedDocuments(filters = {}, includeMetadata = false) {
    const limit = clampLimit(filters.limit);
    const cursor = decodeCursor(filters.cursor);
    const clauses = ["1 = 1"];
    const values = [];
    if (filters.source) {
      clauses.push("d.source_id = ?");
      values.push(filters.source);
    }
    if (filters.domain) {
      clauses.push("EXISTS (SELECT 1 FROM document_domains dd WHERE dd.document_id = d.id AND dd.domain = ?)");
      values.push(filters.domain);
    }
    if (filters.document_type) {
      clauses.push("d.document_type = ?");
      values.push(filters.document_type);
    }
    if (filters.from) {
      clauses.push("COALESCE(d.published_at, d.observed_at, d.fetched_at) >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push("COALESCE(d.published_at, d.observed_at, d.fetched_at) <= ?");
      values.push(filters.to);
    }
    if (filters.q) {
      clauses.push("(d.title LIKE ? OR d.summary LIKE ?)");
      values.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (cursor) {
      clauses.push("(COALESCE(d.published_at, d.observed_at, d.fetched_at) < ? OR (COALESCE(d.published_at, d.observed_at, d.fetched_at) = ? AND d.id < ?))");
      values.push(cursor.time, cursor.time, cursor.id);
    }
    const rows = this.db
      .prepare(`
      SELECT d.*, s.name AS source_name, s.attribution AS source_attribution, s.policy_note AS source_policy_note,
        s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
          (SELECT json_group_array(json_object('domain', dd.domain, 'confidence', dd.confidence))
           FROM document_domains dd WHERE dd.document_id = d.id) AS domains_json,
          (SELECT json_object(
            'id', dm.id, 'kind', dm.kind, 'role', dm.role, 'url', dm.url,
            'thumbnail_url', dm.thumbnail_url, 'origin', dm.origin, 'mime_type', dm.mime_type,
            'width', dm.width, 'height', dm.height, 'alt_text', dm.alt_text,
            'attribution', dm.attribution, 'rights_class', dm.rights_class,
            'display_policy', dm.display_policy, 'policy_version', dm.policy_version,
            'policy_reason', dm.policy_reason
          ) FROM document_media dm
           WHERE dm.document_id = d.id AND dm.is_representative = 1 LIMIT 1) AS representative_media_json,
          (SELECT json_object(
            'status', pd.status, 'eligible', pd.eligible, 'reason_codes', json(pd.reason_codes_json),
            'method', pd.method, 'version', pd.version, 'evaluated_at', pd.evaluated_at,
            'details', json(pd.details_json)
          ) FROM document_promotion_decisions pd WHERE pd.document_id = d.id) AS promotion_decision_json
        FROM documents d JOIN sources s ON s.id = d.source_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY COALESCE(d.published_at, d.observed_at, d.fetched_at) DESC, d.id DESC LIMIT ?
      `)
      .all(...values, limit + 1);
    return page(rows, limit, (row) => this.documentRow(row, includeMetadata), (row) => row.published_at || row.observed_at || row.fetched_at);
  }

  representativeMediaForStories(storyIds) {
    const ids = [...new Set((storyIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT sd.story_id AS scope_id, story.representative_document_id AS preferred_document_id,
             sd.similarity_score AS evidence_confidence, dm.*, source.media_policy_json AS source_policy_json
      FROM story_documents sd
      JOIN stories story ON story.id = sd.story_id
      JOIN document_media dm ON dm.document_id = sd.document_id AND dm.is_representative = 1
      JOIN sources source ON source.id = dm.source_id
      WHERE sd.story_id IN (${placeholders})
    `).all(...ids);
    return selectScopedRepresentativeMedia(rows);
  }

  representativeMediaForEvents(eventIds) {
    const ids = [...new Set((eventIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT ee.event_id AS scope_id, event.representative_document_id AS preferred_document_id,
             ee.confidence AS evidence_confidence, dm.*, source.media_policy_json AS source_policy_json
      FROM event_evidence ee
      JOIN events event ON event.id = ee.event_id
      JOIN document_media dm ON dm.document_id = ee.document_id AND dm.is_representative = 1
      JOIN sources source ON source.id = dm.source_id
      WHERE ee.event_id IN (${placeholders})
    `).all(...ids);
    return selectScopedRepresentativeMedia(rows);
  }

  documentRow(row, includeMetadata) {
    const sourcePolicy = parseJson(row.media_policy_json, {});
    const persistedRepresentative = parseJson(row.representative_media_json);
    const representativeMedia = persistedRepresentative
      ? applyEffectiveMediaPolicy({
          ...persistedRepresentative,
          document_id: persistedRepresentative.document_id || row.id,
          source_id: persistedRepresentative.source_id || row.source_id
        }, sourcePolicy)
      : null;
    const rawMetadata = parseJson(row.raw_metadata_json, {});
    const document = {
      id: row.id,
      source_id: row.source_id,
      source_name: row.source_name,
      source_attribution: row.source_attribution || row.source_name,
      source_policy_note: row.source_policy_note || null,
      discovery_provider: rawMetadata.discovery_provider || row.source_name || null,
      source_class: row.source_class,
      authority_class: row.authority_class,
      source_countries: parseJson(row.source_countries_json, []),
      external_id: row.external_id,
      document_type: row.document_type,
      canonical_url: row.canonical_url,
      title: row.title,
      summary: row.summary,
      body_excerpt: row.body_excerpt,
      language: row.language,
      published_at: row.published_at,
      observed_at: row.observed_at,
      fetched_at: row.fetched_at,
      author: row.author,
      publisher: row.publisher,
      publisher_key: row.publisher_key,
      domains: row.domains_json
        ? parseJson(row.domains_json, []).map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) }))
        : this.db.prepare("SELECT domain, confidence FROM document_domains WHERE document_id = ? ORDER BY confidence DESC").all(row.id).map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) })),
      event_key: row.event_key,
      event_type_candidate: row.event_type_candidate,
      raw_severity: row.raw_severity,
      event_eligible: Boolean(row.event_eligible),
      promotion_decision: normalizePromotionDecision(parseJson(row.promotion_decision_json)),
      location: parseJson(row.location_json),
      tags: parseJson(row.tags_json, []),
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      representative_media: mediaRow(representativeMedia),
      rights: publicDocumentRights(rawMetadata.rights),
      classification: parseJson(row.classification_json, null)
    };
    if (includeMetadata) {
      document.raw_metadata = rawMetadata;
      document.media = this.db
        .prepare("SELECT * FROM document_media WHERE document_id = ? ORDER BY is_representative DESC, id")
        .all(row.id)
        .map((media) => mediaRow(applyEffectiveMediaPolicy(media, sourcePolicy)));
    }
    return document;
  }

  eventRow(row, representativeMedia) {
    return {
      publication_status: row.publication_status || "published",
      publication_reason: row.publication_reason || null,
      id: row.id,
      event_type: row.event_type,
      title: row.title,
      summary: row.summary,
      primary_domain: row.primary_domain,
      domains: row.domains_json
        ? parseJson(row.domains_json, []).map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) }))
        : this.db.prepare("SELECT domain, confidence FROM event_domains WHERE event_id = ? ORDER BY confidence DESC").all(row.id).map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) })),
      lifecycle: row.lifecycle,
      verification_status: row.verification_status,
      event_severity: row.event_severity,
      confidence: Number(row.confidence),
      occurred_at: row.occurred_at,
      first_seen_at: row.first_seen_at,
      last_updated_at: row.last_updated_at,
      geo_scope: row.geo_scope,
      story_count: Number(row.story_count || 0),
      evidence_count: Number(row.evidence_count || 0),
      independent_source_count: Number(row.independent_source_count || 0),
      has_primary_source: Boolean(row.has_primary_source),
      has_official_source: Boolean(row.has_official_source),
      representative_document_id: row.representative_document_id,
      derivation: { method: row.derivation_method, version: row.derivation_version },
      representative_source: row.representative_source || null,
      representative_publisher: row.representative_publisher || null,
      representative_url: row.representative_url || null,
      representative_media: mediaRow(representativeMedia === undefined ? parseJson(row.representative_media_json) : representativeMedia),
      evidence_ids: parseJson(row.evidence_ids_json, []),
      regional_relevance: parseJson(row.regional_relevance_json, []).map((entry) => ({
        region_code: entry.region_code,
        score: Number(entry.score),
        reason_codes: Array.isArray(entry.reason_codes) ? entry.reason_codes : [],
        evidence: Array.isArray(entry.evidence) ? entry.evidence : [],
        method: entry.method,
        version: entry.version,
        evaluated_at: entry.evaluated_at
      })),
      location: row.location_label
        ? {
            label: row.location_label,
            country_code: row.country_code,
            latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
            longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
            geometry_type: row.geometry_type,
            precision: row.precision
          }
        : null
    };
  }
}

function sourceRow(row) {
  const lastSuccess = Date.parse(row.last_success_at || "");
  const ageMs = Number.isFinite(lastSuccess) ? Math.max(0, Date.now() - lastSuccess) : null;
  const freshnessStatus = !Number.isFinite(lastSuccess)
    ? "missing"
    : ageMs > Math.max(60_000, Number(row.cadence_ms || 0)) * 2
      ? "stale"
      : "current";
  const status = !row.enabled
    ? "disabled"
    : row.last_status === "success"
      ? "healthy"
      : row.last_status === "partial"
        ? "degraded"
        : ["failed", "rate_limited"].includes(row.last_status)
          ? "failed"
          : "unknown";
  return {
    id: row.id,
    name: row.name,
    provider_type: row.provider_type,
    source_class: row.source_class,
    authority_class: row.authority_class,
    document_type: row.document_type,
    catchup_mode: row.catchup_mode || "latest_only",
    homepage: row.homepage,
    docs_url: row.docs_url,
    attribution: row.attribution,
    policy_note: row.policy_note,
    media_policy: parseJson(row.media_policy_json, {}),
    coverage: parseJson(row.coverage_json, {}),
    enabled: Boolean(row.enabled),
    disabled_reason: row.disabled_reason,
    domains: parseJson(row.domains_json, []),
    languages: parseJson(row.languages_json, []),
    countries: parseJson(row.countries_json, []),
    cadence_ms: Number(row.cadence_ms),
    timeout_ms: Number(row.timeout_ms),
    health: {
      status,
      freshness_status: freshnessStatus,
      age_ms: ageMs,
      last_fetch_status: row.last_status || null,
      last_checked_at: row.last_checked_at || null,
      last_success_at: row.last_success_at || null,
      expected_next_at: row.next_due_at || null,
      last_failure_at: row.last_failure_at || null,
      last_error: row.last_error || null,
      last_item_count: Number(row.last_item_count || 0),
      latency_ms: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
      not_modified: Boolean(row.last_not_modified),
      targets: {
        registered: Number(row.target_count || 0),
        enabled: Number(row.enabled_target_count || 0),
        failed: Number(row.failed_target_count || 0),
        latest_success_at: row.latest_target_success_at || null
      },
      running: Boolean(row.lease_owner && Date.parse(row.lease_expires_at || "") > Date.now()),
      consecutive_failures: Number(row.consecutive_failures || 0),
      backoff_until: row.backoff_until || null,
      last_gap_status: row.last_gap_status || "none",
      last_catchup_from: row.last_catchup_from || null,
      last_catchup_to: row.last_catchup_to || null
    }
  };
}

function normalizePromotionDecision(value) {
  if (!value) return null;
  return {
    status: value.status,
    eligible: Boolean(value.eligible),
    reason_codes: Array.isArray(value.reason_codes) ? value.reason_codes : [],
    method: value.method,
    version: value.version,
    evaluated_at: value.evaluated_at,
    details: value.details && typeof value.details === "object" ? value.details : {}
  };
}

function sourceTargetRow(row) {
  return {
    id: row.id,
    source_id: row.source_id,
    entity_id: row.entity_id || null,
    security_id: row.security_id || null,
    identifier: {
      namespace: row.identifier_namespace,
      authority: row.identifier_authority,
      scope: row.identifier_scope,
      value: row.identifier_value
    },
    request_key: row.request_key,
    enabled: Boolean(row.enabled),
    priority_tier: Number(row.priority_tier || 100),
    cadence_ms: Number(row.cadence_ms || 0),
    next_due_at: row.next_due_at || null,
    consecutive_failures: Number(row.consecutive_failures || 0),
    backoff_until: row.backoff_until || null,
    last_attempt_at: row.last_attempt_at || null,
    last_success_at: row.last_success_at || null,
    last_match_at: row.last_match_at || null,
    last_outcome: row.last_outcome || null,
    policy: parseJson(row.policy_json, {})
  };
}

export function mergeDocumentMetadata(previous, current, sourceId) {
  const merged = { ...(previous || {}), ...(current || {}) };
  const retractions = sourceId === NEWS_SOURCE && Array.isArray(current?.entity_hint_retractions) ? current.entity_hint_retractions : [];
  if (previous?.target_relevance || current?.target_relevance) {
    merged.target_relevance = { ...(previous?.target_relevance || {}), ...(current?.target_relevance || {}) };
  }
  for (const field of ["entity_hints", "discovery_targets", "tags"]) {
    const old = Array.isArray(previous?.[field]) ? previous[field] : [];
    const retained = field === "entity_hints" ? old.filter(hint => !retractions.some(retraction => isRetractableNewsHint(hint, retraction))) : old;
    const values = [...retained, ...(Array.isArray(current?.[field]) ? current[field] : [])];
    if (values.length > 0 || (field === "entity_hints" && retractions.length)) {
      merged[field] = values.filter((value, index) => values.findIndex((candidate) => boundedJson(candidate, 2000) === boundedJson(value, 2000)) === index);
    }
  }
  delete merged.entity_hint_retractions;
  return merged;
}

function scheduleRow(row) {
  return {
    source_id: row.source_id,
    cadence_ms: Number(row.cadence_ms || 0),
    next_due_at: row.next_due_at || null,
    lease_owner: row.lease_owner || null,
    lease_expires_at: row.lease_expires_at || null,
    consecutive_failures: Number(row.consecutive_failures || 0),
    backoff_until: row.backoff_until || null,
    last_attempt_at: row.last_attempt_at || null,
    last_success_at: row.last_success_at || null,
    last_outcome: row.last_outcome || null,
    last_gap_status: row.last_gap_status || "none",
    last_catchup_from: row.last_catchup_from || null,
    last_catchup_to: row.last_catchup_to || null,
    updated_at: row.updated_at
  };
}

function initialNextDue(now, lastSuccessAt, cadenceMs, collectOnStart) {
  const nowMs = Date.parse(now);
  if (collectOnStart) return now;
  const lastSuccessMs = Date.parse(lastSuccessAt || "");
  const cadence = Math.max(60_000, Number(cadenceMs || 0));
  if (Number.isFinite(lastSuccessMs)) return new Date(lastSuccessMs + cadence).toISOString();
  return new Date(nowMs + cadence).toISOString();
}

function storyRow(row, representativeMedia) {
  return {
    id: row.id,
    canonical_title: row.canonical_title,
    summary: row.representative_summary || null,
    status: row.status,
    version: Number(row.version || 0),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    document_count: Number(row.document_count || 0),
    independent_source_count: Number(row.independent_source_count || 0),
    domains: uniqueDomains(parseJson(row.domains_json, [])),
    cluster_method: row.cluster_method,
    cluster_version: row.cluster_version,
    representative_document_id: row.representative_document_id,
    merged_into_story_id: row.merged_into_story_id || null,
    representative_media: mediaRow(representativeMedia === undefined ? parseJson(row.representative_media_json) : representativeMedia)
  };
}

function mediaRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    document_id: row.document_id || null,
    source_id: row.source_id || null,
    kind: row.kind,
    role: row.role,
    url: row.url,
    thumbnail_url: row.thumbnail_url || null,
    origin: row.origin,
    mime_type: row.mime_type || null,
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    alt_text: row.alt_text || null,
    attribution: row.attribution || null,
    rights_class: row.rights_class,
    display_policy: row.display_policy,
    policy_version: row.policy_version,
    policy_reason: row.policy_reason,
    is_representative: row.is_representative === undefined ? true : Boolean(row.is_representative)
  };
}

function selectScopedRepresentativeMedia(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const candidates = grouped.get(row.scope_id) || [];
    candidates.push({
      ...row,
      current_source_policy: parseJson(row.source_policy_json, {})
    });
    grouped.set(row.scope_id, candidates);
  }

  const selected = new Map();
  for (const [scopeId, candidates] of grouped) {
    selected.set(scopeId, selectRepresentativeMedia(candidates, {
      preferredDocumentId: candidates[0]?.preferred_document_id || null
    }));
  }
  return selected;
}

function uniqueDomains(values) {
  const result = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (!value?.domain) continue;
    const confidence = Number(value.confidence || 0);
    result.set(value.domain, Math.max(result.get(value.domain) || 0, confidence));
  }
  return [...result.entries()]
    .map(([domain, confidence]) => ({ domain, confidence }))
    .sort((left, right) => right.confidence - left.confidence);
}

function storyUpdateRow(row) {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    story_id: row.story_id,
    event_id: row.event_id,
    story_version: Number(row.story_version),
    change_type: row.change_type,
    primary_domain: row.primary_domain,
    verification_status: row.verification_status,
    importance: {
      level: row.event_severity,
      reason_codes: parseJson(row.reason_codes_json, [])
    },
    previous_state: parseJson(row.previous_state_json),
    current_state: parseJson(row.current_state_json, {}),
    evidence_ids: parseJson(row.evidence_ids_json, []),
    occurred_at: row.occurred_at,
    created_at: row.created_at
  };
}

function consumerEventState(event) {
  const primaryLocation = (event.locations || []).find((location) => Boolean(location.is_primary)) || event.locations?.[0] || null;
  return {
    publication_status: event.publication_status || "published",
    publication_reason: event.publication_reason || null,
    id: event.id,
    event_type: event.event_type,
    title: event.title,
    summary: event.summary || null,
    primary_domain: event.primary_domain,
    domains: (event.domains || [])
      .map((entry) => ({ domain: entry.domain, confidence: Number(entry.confidence) }))
      .sort((left, right) => left.domain.localeCompare(right.domain)),
    lifecycle: event.lifecycle,
    verification_status: event.verification_status,
    event_severity: event.event_severity,
    occurred_at: event.occurred_at || null,
    first_seen_at: event.first_seen_at,
    last_updated_at: event.last_updated_at,
    evidence_count: Number(event.evidence_count || event.evidence?.length || 0),
    independent_source_count: Number(event.independent_source_count || 0),
    has_primary_source: Boolean(event.has_primary_source),
    has_official_source: Boolean(event.has_official_source),
    evidence_ids: (event.evidence || []).map((entry) => entry.document_id).filter(Boolean).sort(),
    entity_ids: (event.entities || []).map((entry) => entry.id).filter(Boolean).sort(),
    regional_relevance: (event.regional_relevance || [])
      .map((entry) => ({
        region_code: entry.region_code,
        score: Number(entry.score),
        reason_codes: [...(entry.reason_codes || [])].sort(),
        method: entry.method,
        version: entry.version
      }))
      .sort((left, right) => left.region_code.localeCompare(right.region_code)),
    location: primaryLocation
      ? {
          id: primaryLocation.id,
          label: primaryLocation.label || null,
          country_code: primaryLocation.country_code || null,
          latitude: primaryLocation.latitude === null || primaryLocation.latitude === undefined ? null : Number(primaryLocation.latitude),
          longitude: primaryLocation.longitude === null || primaryLocation.longitude === undefined ? null : Number(primaryLocation.longitude),
          precision: primaryLocation.precision || null
        }
      : null
  };
}

function changeReasonCodes(previous, current) {
  if (previous && previous.publication_status !== current.publication_status) return ["PUBLICATION_POLICY_CHANGED"];
  if (!previous) return ["STORY_CREATED"];
  const reasons = [];
  if (previous.verification_status !== current.verification_status) reasons.push("VERIFICATION_CHANGED");
  if (previous.event_severity !== current.event_severity) reasons.push("SEVERITY_CHANGED");
  if (previous.lifecycle !== current.lifecycle) reasons.push("LIFECYCLE_CHANGED");
  if (previous.event_type !== current.event_type) reasons.push("EVENT_TYPE_CHANGED");
  if (previous.title !== current.title) reasons.push("TITLE_CHANGED");
  if (previous.summary !== current.summary) reasons.push("SUMMARY_CHANGED");
  if (previous.occurred_at !== current.occurred_at) reasons.push("OCCURRED_AT_CHANGED");
  if (JSON.stringify(previous.domains) !== JSON.stringify(current.domains)) reasons.push("DOMAINS_CHANGED");
  if (JSON.stringify(previous.evidence_ids) !== JSON.stringify(current.evidence_ids)) reasons.push("EVIDENCE_CHANGED");
  if (JSON.stringify(previous.entity_ids) !== JSON.stringify(current.entity_ids)) reasons.push("ENTITIES_CHANGED");
  if (JSON.stringify(previous.location) !== JSON.stringify(current.location)) reasons.push("LOCATION_CHANGED");
  if (JSON.stringify(previous.regional_relevance) !== JSON.stringify(current.regional_relevance)) reasons.push("REGIONAL_RELEVANCE_CHANGED");
  if (previous.independent_source_count !== current.independent_source_count) reasons.push("SOURCE_INDEPENDENCE_CHANGED");
  if (previous.has_primary_source !== current.has_primary_source) reasons.push("PRIMARY_SOURCE_STATUS_CHANGED");
  if (previous.has_official_source !== current.has_official_source) reasons.push("OFFICIAL_SOURCE_STATUS_CHANGED");
  return reasons;
}

function selectChangeType(previous, current, reasonCodes) {
  if (!previous) return "story_created";
  if (previous.verification_status !== current.verification_status) {
    if (current.verification_status === "retracted") return "story_retracted";
    if (current.verification_status === "corrected") return "story_corrected";
    if (current.verification_status === "disputed") return "story_disputed";
  }
  if (previous.lifecycle !== current.lifecycle && current.lifecycle === "resolved") return "event_resolved";
  if (previous.event_severity !== current.event_severity && severityRank(current.event_severity) > severityRank(previous.event_severity)) {
    return "event_escalated";
  }
  if (reasonCodes.includes("VERIFICATION_CHANGED")) return "verification_changed";
  if (reasonCodes.includes("SEVERITY_CHANGED")) return "severity_changed";
  if (reasonCodes.includes("EVIDENCE_CHANGED") && current.evidence_ids.length > previous.evidence_ids.length) return "evidence_added";
  return "story_updated";
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value] || 0;
}

function entityRow(row) {
  return {
    id: row.id,
    entity_type: row.entity_type,
    canonical_name: row.canonical_name,
    country_code: row.country_code,
    metadata: parseJson(row.metadata_json, {}),
    role: row.role || undefined,
    confidence: row.confidence === undefined ? undefined : Number(row.confidence)
  };
}

function aliasRow(row) {
  return {
    alias: row.alias,
    language: row.language || null,
    alias_type: row.alias_type,
    method: row.method,
    confidence: Number(row.confidence),
    status: row.status,
    source_id: row.source_id || null,
    source_run_id: row.source_run_id || null,
    raw_fetch_id: row.raw_fetch_id || null,
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null
  };
}

function identifierRow(row) {
  return {
    id: row.id,
    namespace: row.namespace,
    authority: row.authority,
    scope: row.scope,
    value: row.display_value,
    normalized_value: row.normalized_value,
    status: row.status,
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
    source_id: row.source_id || null,
    source_run_id: row.source_run_id || null,
    raw_fetch_id: row.raw_fetch_id || null,
    confidence: Number(row.confidence),
    method: row.method,
    metadata: parseJson(row.metadata_json, {})
  };
}

function relationRow(row) {
  return {
    id: row.id,
    relation_type: row.relation_type,
    from: { id: row.from_entity_id, canonical_name: row.from_name, entity_type: row.from_type },
    to: { id: row.to_entity_id, canonical_name: row.to_name, entity_type: row.to_type },
    status: row.status,
    confidence: Number(row.confidence),
    method: row.method,
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
    source_id: row.source_id || null,
    source_run_id: row.source_run_id || null,
    raw_fetch_id: row.raw_fetch_id || null,
    metadata: parseJson(row.metadata_json, {})
  };
}

function snapshotRow(row) {
  return {
    id: row.id,
    source_id: row.source_id,
    source_run_id: row.source_run_id,
    status: row.status,
    snapshot_complete: Boolean(row.snapshot_complete),
    truncated: Boolean(row.truncated),
    upstream_item_count: row.upstream_item_count === null ? null : Number(row.upstream_item_count),
    member_count: Number(row.member_count),
    observed_at: row.observed_at,
    warnings: parseJson(row.warnings_json, [])
  };
}

function locationRow(row) {
  return {
    id: row.id,
    label: row.label,
    country_code: row.country_code,
    admin1: row.admin1,
    city: row.city,
    geometry_type: row.geometry_type,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    geometry: parseJson(row.geometry_json),
    precision: row.precision,
    confidence: Number(row.confidence),
    is_primary: Boolean(row.is_primary)
  };
}

function page(rows, limit, mapper, timeSelector) {
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const items = selected.map(mapper);
  const last = selected.at(-1);
  const time = last ? (typeof timeSelector === "function" ? timeSelector(last) : last[timeSelector]) : null;
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ time, id: last.id }) : null
  };
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed?.time && parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function clampLimit(value) {
  const number = Number(value || 50);
  return Math.max(1, Math.min(200, Number.isFinite(number) ? Math.floor(number) : 50));
}

function normalizeMarket(value) {
  const market = String(value || "").trim().toUpperCase();
  return ["TWSE", "TPEX"].includes(market) ? market : null;
}

function publicDocumentRights(value) {
  if (!value || typeof value !== "object") return null;
  return {
    usage_context: value.usage_context || null,
    full_text_stored: Boolean(value.full_text_stored),
    attribution_required: Boolean(value.attribution_required),
    advertising_allowed: value.advertising_allowed === true,
    source_link_required: Boolean(value.source_link_required),
    requires_unmodified_display: Boolean(value.requires_unmodified_display)
  };
}

function latestIso(values) {
  const times = values.map((value) => Date.parse(value || "")).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
