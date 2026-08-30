import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { boundedJson, parseJson, redactUrl, stableId } from "./core/utils.js";
import { initializeAtlasSchema, SCHEMA_VERSION } from "./atlasSchema.js";
import { publicSourceDefinition } from "./atlasSourceRegistry.js";
import { applyEffectiveMediaPolicy, selectRepresentativeMedia } from "./documents/media.js";
import { evaluateDocumentPromotion } from "./atlasPromotion.js";

const REGIONAL_RELEVANCE_CODES = new Set(["TW", "JP", "EAST_ASIA"]);

export function openAtlasStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initializeAtlasSchema(db);
  return new AtlasStore(db, dbPath);
}

class AtlasStore {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  registerSources(sources, now = new Date().toISOString()) {
    const statement = this.db.prepare(`
      INSERT INTO sources (
        id, name, provider_type, source_class, authority_class, document_type, catchup_mode,
        homepage, docs_url, attribution, policy_note, media_policy_json, enabled, disabled_reason,
        domains_json, languages_json, countries_json, cadence_ms, timeout_ms,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        SELECT etag, last_modified FROM raw_fetches
        WHERE source_id = ? AND request_url = ? AND (etag IS NOT NULL OR last_modified IS NOT NULL)
        ORDER BY fetched_at DESC LIMIT 1
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
          , not_modified = ?
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

  upsertDocument(document, runId, rawFetchId, now = new Date().toISOString()) {
    return this.transaction(() => this._upsertDocument(document, runId, rawFetchId, now));
  }

  _upsertDocument(document, runId, rawFetchId, now = new Date().toISOString()) {
    const byId = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(document.id);
    const byDedupe = byId
      ? null
      : this.db.prepare("SELECT id FROM documents WHERE source_id = ? AND dedupe_key = ? ORDER BY first_seen_at LIMIT 1").get(document.source_id, document.dedupe_key);
    const id = byId?.id || byDedupe?.id || document.id;
    const inserted = !byId && !byDedupe;
    const metadata = document.raw_metadata || {};
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
      document.raw_metadata_json,
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

    return { inserted, document: { ...document, id, promotion_decision: promotionDecision } };
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
        SELECT d.*, s.name AS source_name, s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
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
        SELECT d.*, s.name AS source_name, s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
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
    const clauses = ["1 = 1"];
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
    const regionalOrder = relevanceRegions.length > 0
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
      .all(...values, ...relevanceRegions, limit + 1);
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
        SELECT d.*, s.name AS source_name, s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
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
    if (filters.type) {
      clauses.push("entity_type = ?");
      values.push(filters.type);
    }
    if (filters.q) {
      clauses.push("(canonical_name LIKE ? OR EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.entity_id = entities.id AND ea.alias LIKE ?))");
      values.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const rows = this.db.prepare(`SELECT * FROM entities WHERE ${clauses.join(" AND ")} ORDER BY canonical_name LIMIT ?`).all(...values, limit);
    return { items: rows.map(entityRow), next_cursor: null };
  }

  getEntity(entityId, filters = {}) {
    const entity = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    if (!entity) return null;
    const aliases = this.db
      .prepare("SELECT alias, language FROM entity_aliases WHERE entity_id = ? ORDER BY alias")
      .all(entityId);
    const related = this.getEntityEvents(entityId, filters);
    return { ...entityRow(entity), aliases, events: related.events };
  }

  getEntityEvents(entityId, filters = {}) {
    const entity = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    if (!entity) return null;
    const rows = this.db
      .prepare(`
        SELECT e.*,
          (SELECT json_group_array(json_object(
            'region_code', rr.region_code, 'score', rr.score,
            'reason_codes', json(rr.reason_codes_json), 'evidence', json(rr.evidence_json),
            'method', rr.method, 'version', rr.version, 'evaluated_at', rr.evaluated_at
          )) FROM event_regional_relevance rr WHERE rr.event_id = e.id) AS regional_relevance_json
        FROM event_entities ee JOIN events e ON e.id = ee.event_id
        WHERE ee.entity_id = ? ORDER BY e.last_updated_at DESC LIMIT ?
      `)
      .all(entityId, clampLimit(filters.limit));
    const mediaByEvent = this.representativeMediaForEvents(rows.map((row) => row.id));
    return { entity: entityRow(entity), events: rows.map((row) => this.eventRow(row, mediaByEvent.get(row.id) || null)) };
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
    for (const table of ["sources", "source_runs", "source_schedule_state", "raw_fetches", "documents", "document_promotion_decisions", "document_media", "stories", "story_updates", "events", "event_regional_relevance", "entities"]) {
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
        SELECT d.*, s.name AS source_name, s.authority_class, s.source_class, s.countries_json AS source_countries_json, s.media_policy_json,
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
    const document = {
      id: row.id,
      source_id: row.source_id,
      source_name: row.source_name,
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
      representative_media: mediaRow(representativeMedia)
    };
    if (includeMetadata) {
      document.raw_metadata = parseJson(row.raw_metadata_json, {});
      document.media = this.db
        .prepare("SELECT * FROM document_media WHERE document_id = ? ORDER BY is_representative DESC, id")
        .all(row.id)
        .map((media) => mediaRow(applyEffectiveMediaPolicy(media, sourcePolicy)));
    }
    return document;
  }

  eventRow(row, representativeMedia) {
    return {
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
