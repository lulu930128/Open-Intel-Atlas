// Date-only statistical periods use [start, end), independent of display timezone.
const DAY = 86400000;
export function dateOnly(value) {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new TypeError("Invalid macro date");
  return value;
}
const day = (value, n) => new Date(Date.parse(value)+n*DAY).toISOString().slice(0,10);
export function period(kind, key, options = {}) {
  let start, end;
  if (kind === "month" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(key)) {
    start=`${key}-01`; const d=new Date(start); d.setUTCMonth(d.getUTCMonth()+1); end=d.toISOString().slice(0,10);
  } else if (kind === "quarter" && /^20\d{2}-Q[1-4]$/.test(key)) {
    start=`${key.slice(0,4)}-${String((Number(key.at(-1))-1)*3+1).padStart(2,"0")}-01`;
    const d=new Date(start);d.setUTCMonth(d.getUTCMonth()+3);end=d.toISOString().slice(0,10);
  } else if (kind === "year" && /^20\d{2}$/.test(key)) { start=`${key}-01-01`;end=`${Number(key)+1}-01-01`;
  } else if (kind === "week") {
    if(options.week_convention === "iso" && /^20\d{2}-W\d{2}$/.test(key)) {
      const y=Number(key.slice(0,4)),w=Number(key.slice(-2));
      const jan4=`${y}-01-04`,weekday=new Date(jan4).getUTCDay()||7;
      start=day(jan4,1-weekday+(w-1)*7);end=day(start,7);
      if(w<1||w>53||new Date(day(start,3)).getUTCFullYear()!==y)throw new TypeError("Invalid ISO week");
    } else if(options.week_convention === "ending_saturday") {
      const ending=dateOnly(key);if(new Date(ending).getUTCDay()!==6)throw new TypeError("Expected Saturday week ending");
      start=day(ending,-6);end=day(ending,1);
    } else throw new TypeError("Explicit supported week convention required");
  } else if (kind === "event" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(key)) {
    start=dateOnly(options.period_start);end=dateOnly(options.period_end);
    if(end<=start)throw new TypeError("Event period requires start < exclusive end");
  } else throw new TypeError("Invalid macro period");
  if(options.period_start && options.period_start!==start || options.period_end && options.period_end!==end)throw new TypeError("Macro period bounds mismatch");
  return {period_kind:kind,period_key:key,period_start:start,period_end:end,period_end_exclusive:true,week_convention:kind==="week"?options.week_convention:null};
}
export function shiftReference(kind,key,offset,options={}) {
  if(!Number.isSafeInteger(offset))throw new TypeError("Invalid period offset");
  if(kind==="event") { if(offset===0)return key;return null; }
  const p=period(kind,key,options),d=new Date(p.period_start);
  if(kind==="month"||kind==="quarter") { d.setUTCMonth(d.getUTCMonth()+offset*(kind==="quarter"?3:1));return kind==="month"?d.toISOString().slice(0,7):`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`; }
  if(kind==="year")return String(Number(key)+offset);
  if(options.week_convention==="ending_saturday")return day(key,offset*7);
  const thursday=new Date(day(p.period_start,3+offset*7)),year=thursday.getUTCFullYear();
  const jan4=new Date(`${year}-01-04`),first=day(jan4.toISOString().slice(0,10),1-(jan4.getUTCDay()||7));
  return `${year}-W${String(Math.floor((Date.parse(day(p.period_start,offset*7))-Date.parse(first))/(7*DAY))+1).padStart(2,"0")}`;
}
export const RELEASE_STAGES=Object.freeze(["not_applicable","advance","second","third","annual_revision","benchmark_revision","correction"]);
export function buildReleaseId(country,family,kind,key,stage="not_applicable",occurrence=null) {
  if(!["month","quarter","week","year","event"].includes(kind))throw new TypeError("Invalid release period kind");
  if(!/^[A-Z]{2}$/.test(country)||! /^[a-z][a-z0-9_]{0,39}$/.test(family)||!RELEASE_STAGES.includes(stage)||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(key))throw new TypeError("Invalid release identity");
  if(["annual_revision","benchmark_revision","correction"].includes(stage)&&!occurrence)throw new TypeError("Repeated revision stages require occurrence identity");
  if(occurrence&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(occurrence))throw new TypeError("Invalid occurrence identity");
  return `${country}_${family.toUpperCase()}_${key}${stage!=="not_applicable"?`_${stage.toUpperCase()}`:""}${occurrence?`_${occurrence}`:""}`;
}
