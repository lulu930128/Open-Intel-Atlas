import { period, shiftReference } from "./period.js";
export function releasePeriod(release, metadata) {
  return period(release.period_kind||metadata.period_kind||"month",release.period_key||release.reference_period,{...metadata,...release});
}
export function buildRequirements(release, indicators, metadata) {
  const p=releasePeriod(release,metadata);
  return {version:metadata.coverage_version||1,indicators:indicators.filter(i=>i.release_group===release.release_group).map(i=>({
    indicator_id:i.id,required:i.required_for_release_complete!==false,
    reference_period:shiftReference(i.period_kind||p.period_kind,p.period_key,i.release_period_offset||0,{...metadata,...p}),
    period_kind:i.period_kind||p.period_kind
  }))};
}
export function releaseCoverage(release,observations) {
  const rules=JSON.parse(release.requirements_json||'{"version":0,"indicators":[]}');
  const required=rules.indicators.filter(i=>i.required),matched=rules.indicators.filter(i=>observations.some(o=>o.indicator_id===i.indicator_id&&o.reference_period===i.reference_period));
  const missing=required.filter(i=>!matched.includes(i));
  return {status:!required.length?"unknown":!matched.length?"missing":missing.length?"partial":"complete",
    rule_version:rules.version,expected_indicator_count:required.length,observed_indicator_count:matched.filter(i=>i.required).length,
    missing_indicators:missing.map(i=>i.indicator_id),optional_missing:rules.indicators.filter(i=>!i.required&&!matched.includes(i)).map(i=>i.indicator_id),
    observations:observations.filter(o=>matched.some(i=>i.indicator_id===o.indicator_id&&i.reference_period===o.reference_period))};
}
