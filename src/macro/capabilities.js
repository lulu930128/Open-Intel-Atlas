import { contentHash } from "../core/utils.js";
import { shiftReference, period as normalizePeriod } from "./period.js";
import { releaseCoverage } from "./coverage.js";
import { displaySemantics } from "./semantics.js";

export function createMacroCapabilities(context, CapabilityError) {
  const store = context.store;
  const MACRO_INDICATORS=store.macroCatalog.indicators;
  const MACRO_GROUP_METADATA=store.macroCatalog.groups;
  const MACRO_GROUPS=Object.keys(MACRO_GROUP_METADATA);
  const indicatorById=id=>MACRO_INDICATORS.find(i=>i.id===id)||null;
  const nowIso = () => context.clock?.().toISOString() || new Date().toISOString();
  const invalid = (message) => { throw new CapabilityError(400, "invalid_macro_query", message); };
  function limit(input) {
    const n = input.limit === undefined ? 30 : Number(input.limit);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100) invalid("limit must be an integer from 1 to 100");
    return n;
  }
  function group(input) {
    const value = input.group || null;
    if (value && !MACRO_GROUPS.includes(value)) invalid("unknown macro group");
    if (input.country && input.country !== "US") invalid("Macro v1 supports country US only");
    return value;
  }
  function time(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value) || !Number.isFinite(Date.parse(value))) invalid("date must be YYYY-MM-DD or a UTC ISO timestamp");
    const normalized = new Date(value).toISOString();
    if (normalized.slice(0,10) !== value.slice(0,10)) invalid("invalid calendar date");
    return normalized;
  }
  function cursor(input, scope) {
    if (!input.cursor) return null;
    try {
      if (typeof input.cursor !== "string" || input.cursor.length > 2048) throw new Error();
      const c = JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8"));
      if (c.scope !== contentHash(JSON.stringify(scope)) || !c.key) throw new Error();
      return c;
    } catch { invalid("cursor is invalid or belongs to another query"); }
  }
  const encode = (scope, key, snapshot) => Buffer.from(JSON.stringify({scope:contentHash(JSON.stringify(scope)),key,snapshot})).toString("base64url");
  function releaseProjection(release) {
    const values = store.getMacroReleaseObservations(release.id);
    const coverage=releaseCoverage(release,values);
    const current=coverage.observations;
    const decision=store.db.prepare("SELECT * FROM macro_policy_decisions WHERE release_id=? ORDER BY sequence DESC LIMIT 1").get(release.id);
    return { ...release, period_end_exclusive:true, country_code: "US", released_at: release.provider_published_at,
      release_stage_label:({advance:"初估",second:"第二次估計",third:"第三次估計",annual_revision:"年度修訂",benchmark_revision:"基準修訂",correction:"更正"})[release.release_stage]||null,
      policy_decision:decision?{...JSON.parse(decision.decision_json),observed_at:decision.observed_at,raw_fetch_id:decision.raw_fetch_id,implementation_raw_fetch_id:decision.implementation_raw_fetch_id}:null,
      status: release.first_observed_at ? "released" : release.scheduled_at && release.scheduled_at <= nowIso() ? "due" : "scheduled",
      acquisition_status: coverage.status,
      expected_indicator_count: coverage.expected_indicator_count, observed_indicator_count: coverage.observed_indicator_count,
      missing_indicators: coverage.missing_indicators, optional_missing:coverage.optional_missing, coverage_rule_version:coverage.rule_version,
      evidence_document_id: store.macro.evidenceDocument(release.id),
      observations: current.map((o) => observationProjection(o, values)),
      consensus: null, consensus_status: "not_configured" };
  }
  function observationProjection(o, values = null) {
    const indicator = o.metadata_json ? JSON.parse(o.metadata_json) : indicatorById(o.indicator_id);
    const previous = store.macro.observation(o.previous_observation_id);
    const release = store.getMacroRelease(o.release_id);
    const vintage = values || store.getMacroReleaseObservations(o.release_id, o.fetched_at);
    const priorPeriod=shiftReference(o.period_kind||"month",o.reference_period,-1,o);
    const revisedPrevious = vintage.find((p) => p.indicator_id === o.indicator_id && p.reference_period === priorPeriod);
    return { ...o, period_end_exclusive:true, display_semantics:indicator.display_semantics||displaySemantics(indicator), unit: indicator.unit, seasonal_adjustment: indicator.seasonal_adjustment,
      transformation: indicator.transformation, country_code: "US", source_id: indicator.source_id,
      vintage: { release_id: o.release_id, knowledge_at: o.fetched_at, semantics: "atlas_observed_version" },
      timestamp_semantics: release.timestamp_semantics,
      raw_capture: { truncated: Boolean(o.raw_payload_truncated), content_hash: o.raw_content_hash || null },
      initial_release_value_verified: false,
      finality: o.preliminary ? "preliminary" : "unspecified", preliminary: Boolean(o.preliminary),
      previous: previous?.actual ?? null, previous_status: previous ? "observed_before_release" : "unavailable_before_release",
      revised_previous: revisedPrevious?.actual ?? null, revised_previous_observation_id: revisedPrevious?.id || null,
      revised_previous_semantics: "previous_period_as_reported_in_this_vintage",
      evidence_document_id: store.macro.evidenceDocument(o.release_id) };
  }
  function envelope(data, selectedGroup, pagination = undefined) {
    const now = nowIso();
    const groups = selectedGroup ? [selectedGroup] : MACRO_GROUPS;
    const sourceIds = new Set(groups.flatMap(g => [MACRO_GROUP_METADATA[g].source_id, MACRO_GROUP_METADATA[g].calendar_source_id]));
    const sources = store.listSources().filter(s => sourceIds.has(s.id));
    const coverage = groups.map((g) => {
      const due = store.macro.latestDue(g, now);
      const complete = due ? releaseCoverage(due,store.getMacroReleaseObservations(due.id)) : null;
      const maxAge=MACRO_GROUP_METADATA[g].max_release_age_ms;
      return { group: g, expected_release_id: due?.id || null, expected_reference_period: due?.reference_period || null,
        release_age_status:maxAge&&due?.source_published_at&&Date.parse(now)-Date.parse(due.source_published_at)>maxAge?"stale":"within_policy",
        status: complete?.status||"unknown" };
    });
    const health = sources.map((s) => {
      const success = s.health?.last_success_at;
      const status = !s.enabled ? "disabled" : !success ? "missing" : ["failed","rate_limited","partial"].includes(s.health?.last_fetch_status) ? "degraded"
        : Date.parse(now)-Date.parse(success) > 7*3600000 ? "stale" : "current";
      return { source_id:s.id,status,last_success_at:success || null,last_status:s.health?.last_fetch_status || null,
        last_checked_at:s.health?.last_checked_at || null,last_error:s.health?.last_error || null };
    });
    const status = health.length !== sourceIds.size || coverage.some((c) => c.status !== "complete") ? "partial"
      : health.some((s) => s.status !== "current")||coverage.some(c=>c.release_age_status==="stale") ? "stale" : "current";
    const projected = Array.isArray(data) ? data : [data];
    const rawTruncated = projected.some((item) => item.raw_capture?.truncated || item.observations?.some((o) => o.raw_capture?.truncated));
    return { contract_version:"1.2", profile:"macro_v1", generated_at:now, data,
      ...(pagination ? {pagination} : {}), freshness:{status,semantics:"expected_release_and_collection_health"},
      coverage:{status,groups:coverage,sources:health},
      warnings:["release_latency_not_guaranteed","observed_history_is_not_initial_release_history",
        ...(rawTruncated ? ["raw_payload_archival_truncated"] : []), ...(status!=="current" ? ["macro_coverage_incomplete_or_stale"] : [])] };
  }
  function calendar(input={}) {
    const selected = group(input), count=limit(input), now=Date.parse(nowIso());
    const scope={kind:"calendar",group:selected,from:time(input.from,null),to:time(input.to,null)}, c=cursor(input,scope);
    if (c && (!c.key || typeof c.key.after!=="string" || c.key.after.length>160 || !c.key.from || !c.key.to)) invalid("invalid calendar cursor");
    const from=time(c?.key.from,scope.from || new Date(now-7*86400000).toISOString());
    const to=time(c?.key.to,scope.to || new Date(now+30*86400000).toISOString());
    if (to<=from || Date.parse(to)-Date.parse(from)>366*86400000) invalid("calendar requires from < to within 366 days; to is exclusive");
    if ((scope.from && scope.from!==from) || (scope.to && scope.to!==to)) invalid("calendar cursor range mismatch");
    const rows=store.listMacroReleases({from,to,group:selected,after:c?.key.after || "",limit:count+1});
    const page=rows.slice(0,count), last=page.at(-1);
    return envelope(page.map(releaseProjection),selected,{limit:count,next_cursor:rows.length>count?encode(scope,{after:`${last.scheduled_at || last.source_published_at}|${last.id}`,from,to}):null,
      from,to,consistency:"live_calendar"});
  }
  return Object.freeze({
    macroCalendar: calendar,
    macroReleases: calendar,
    macroRelease(input={}) {
      const id=String(input.release_id || "");
      if (!/^[A-Z]{2}_[A-Z0-9_]+_[A-Za-z0-9_.-]+$/.test(id)||id.length>180) invalid("valid release_id is required");
      const release=store.getMacroRelease(id);
      if (!release) throw new CapabilityError(404,"macro_release_not_found","macro release not found");
      return envelope({...releaseProjection(release),calendar_versions:store.macro.calendarVersions(id),
        decision_history:store.db.prepare("SELECT * FROM macro_policy_decisions WHERE release_id=? ORDER BY sequence DESC LIMIT 100").all(id).map(d=>({...d,decision:JSON.parse(d.decision_json)})),
        watch_windows:store.db.prepare("SELECT * FROM macro_watch_windows WHERE release_id=? ORDER BY scheduled_at DESC LIMIT 100").all(id),
        artifacts:store.db.prepare("SELECT * FROM macro_artifacts WHERE release_id=? ORDER BY fetched_at DESC LIMIT 100").all(id)},release.release_group);
    },
    macroIndicators(input={}) {
      const selected=group(input);
      if (input.indicator_id && !indicatorById(input.indicator_id)) invalid("unknown indicator_id");
      return envelope(MACRO_INDICATORS.filter((i)=>(!selected || i.release_group===selected)&&(!input.indicator_id || i.id===input.indicator_id)).map(i=>({...i,period_kind:i.period_kind||"month",required_for_release_complete:i.required_for_release_complete!==false,display_semantics:displaySemantics(i)})),selected);
    },
    macroObservations(input={}) {
      const selected=group(input), count=limit(input), indicator=input.indicator_id || null, period=input.reference_period || null;
      if (indicator && !indicatorById(indicator)) invalid("unknown indicator_id");
      if (indicator && selected && indicatorById(indicator).release_group!==selected) invalid("indicator/group mismatch");
      if (period && (typeof period!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(period))) invalid("invalid reference_period");
      if(period) {
        const definition=indicatorById(indicator),meta=MACRO_GROUP_METADATA[definition?.release_group||selected]||{};
        const kind=definition?.period_kind||meta.period_kind||(/^20\d{2}-Q/.test(period)?"quarter":/^20\d{2}-W/.test(period)?"week":period.length===4?"year":period.length===10?"week":"month");
        try { if(kind!=="event")normalizePeriod(kind,period,{...meta,week_convention:meta.week_convention||(/-W/.test(period)?"iso":"ending_saturday")}); }
        catch { invalid("invalid reference_period"); }
      }
      if (input.history!==undefined && ![true,false,"true","false"].includes(input.history)) invalid("history must be boolean");
      const history=input.history===true || input.history==="true", asOf=time(input.as_of,"9999-12-31T23:59:59.999Z");
      const scope={kind:"observations",group:selected,indicator,period,history,asOf}, c=cursor(input,scope);
      if (c && (!Number.isSafeInteger(c.snapshot) || c.snapshot<0 || !Number.isSafeInteger(c.key) || c.key<1 || c.key>c.snapshot)) invalid("invalid observation cursor");
      const snapshot=c?.snapshot ?? store.macro.maxSequence();
      const rows=store.macro.observations({indicator,period,group:selected,asOf,history,snapshot,before:c?.key ?? snapshot+1,limit:count+1});
      const page=rows.slice(0,count);
      return envelope(page.map((o)=>observationProjection(o)),selected || indicatorById(indicator)?.release_group || null,
        {limit:count,next_cursor:rows.length>count?encode(scope,page.at(-1).sequence,snapshot):null, snapshot_sequence:snapshot});
    }
  });
}
