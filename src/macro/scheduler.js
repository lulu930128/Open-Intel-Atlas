// Release watcher lives within the existing source lease/concurrency/backoff owner.
import { releaseCoverage } from "./coverage.js";
export function watchPolicy(store,group) {
  const policy={before_ms:600000,after_ms:1800000,poll_ms:60000,...store.macroCatalog?.groups[group]?.watch};
  if(![policy.before_ms,policy.after_ms,policy.poll_ms].every(Number.isSafeInteger)||policy.before_ms<0||policy.before_ms>86400000||policy.after_ms<0||policy.after_ms>86400000||policy.poll_ms<10000||policy.poll_ms>21600000)throw new TypeError("Invalid macro watch policy");
  return policy;
}
export function macroNextDue(store, group, now, normalNextDue) {
  const time = Date.parse(now);
  const policy=watchPolicy(store,group);
  const releases = store.listMacroReleases({ from: new Date(time - policy.after_ms).toISOString(), to: new Date(time + 7 * 86400000).toISOString(), group, limit: 32 });
  let next = Date.parse(normalNextDue);
  for (const release of releases) {
    const scheduled = Date.parse(release.scheduled_at || "");
    if (!Number.isFinite(scheduled)) continue;
    if (releaseCoverage(release,store.getMacroReleaseObservations(release.id)).status==="complete") continue;
    const starts = scheduled - policy.before_ms, ends = scheduled + policy.after_ms;
    if (time > ends) continue;
    next = Math.min(next, time < starts ? starts : time + policy.poll_ms);
  }
  return new Date(next).toISOString();
}

export function wakeMacroSchedules(store, registry, now) {
  for (const source of registry.enabled.filter((s) => s.macroGroup)) {
    const state = store.getScheduleState(source.id);
    if(state) {
      const policy=watchPolicy(store,source.macroGroup),time=Date.parse(now);
      for(const release of store.listMacroReleases({from:new Date(time-policy.after_ms).toISOString(),to:new Date(time+policy.before_ms+1).toISOString(),group:source.macroGroup,limit:100})) {
        if(!release.scheduled_at||releaseCoverage(release,store.getMacroReleaseObservations(release.id)).status==="complete")continue;
        if(store.db.prepare("SELECT 1 FROM macro_watch_windows WHERE release_id=? AND scheduled_at=?").get(release.id,release.scheduled_at))continue;
        const health=store.listSources().find(s=>s.id===source.id)?.health||{};
        store.db.prepare("INSERT OR IGNORE INTO macro_watch_windows(release_id,scheduled_at,source_id,watch_started_at,health_before_json,schedule_before_json) VALUES(?,?,?,?,?,?)")
          .run(release.id,release.scheduled_at,source.id,now,JSON.stringify(health),JSON.stringify({...state,policy,semantics:"scheduler_watch_evaluated_not_lease_acquired"}));
      }
    }
    if (!state?.next_due_at || state.consecutive_failures > 0 || state.lease_owner) continue;
    const next = macroNextDue(store, source.macroGroup, now, state.next_due_at);
    if (next < state.next_due_at) store.wakeMacroSchedule(source.id, next, now);
  }
}
