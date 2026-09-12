import { bounded,text,only,officialUrl,release,observation,number,rows } from "./officialParsing.js";
import { easternTimestamp } from "../time.js";
import { shiftReference } from "../period.js";
export const GDP_INDEX="https://www.bea.gov/data/gdp/gross-domestic-product";
export function discoverGdp(html){
  const urls=[...new Set([...bounded(html).matchAll(/href="([^"]*\/news\/20\d{2}\/(?:gdp|gross-domestic-product)-[^"]+)"/gi)].map(m=>officialUrl(m[1],"www.bea.gov")))];
  return only(urls,"current GDP release");
}
function identity(title){const stage=title.match(/\((Advance|Second|Third) Estimate\)/i)?.[1]?.toLowerCase(),q=title.match(/([1-4])(?:st|nd|rd|th) Quarter(?: and Year)? (20\d{2})/i);if(!stage||!q)throw new TypeError("Unsupported GDP estimate identity");return {stage,key:`${q[2]}-Q${q[1]}`};}
export function parseGdp(html,url){
  officialUrl(url,"www.bea.gov");bounded(html);
  const heading=only([...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>text(m[1])).filter(v=>/GDP|Gross Domestic Product/i.test(v)),"GDP heading");
  const {stage,key}=identity(heading),all=text(html);
  const embargo=all.match(/EMBARGOED UNTIL RELEASE AT (\d{1,2}:\d{2}\s*[ap]\.m\.) E[DS]T, [A-Za-z]+, ([A-Za-z]+ \d{1,2}, 20\d{2})/i);if(!embargo)throw new TypeError("Missing GDP embargo");
  const published=easternTimestamp(embargo[2],embargo[1]);
  if(!new RegExp(`${key.at(-1)}${["st","nd","rd","th"][Number(key.at(-1))-1]}-quarter(?:-and-year)?-${key.slice(0,4)}`).test(url)||!url.includes(`${stage}-estimate`))throw new TypeError("GDP URL identity mismatch");
  const observations=[],warnings=[];
  const table=only([...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(m=>text(m[1]).includes("Real GDP")&&text(m[1]).includes("Estimate")),"GDP comparison table")[1];
  const tableRows=rows(table),header=tableRows.find(r=>r.some(c=>c===`${stage[0].toUpperCase()+stage.slice(1)} Estimate`));
  const tablePeriod=text(table).match(/Percent change \(SAAR\) from (20\d{2}):Q([1-4]) to (20\d{2}):Q([1-4])/i);
  if(!header||!tablePeriod||`${tablePeriod[3]}-Q${tablePeriod[4]}`!==key||`${tablePeriod[1]}-Q${tablePeriod[2]}`!==shiftReference("quarter",key,-1))throw new TypeError("GDP units or reference quarter changed");
  const column=header.indexOf(`${stage[0].toUpperCase()+stage.slice(1)} Estimate`);
  const mapping={"Real GDP":"REAL_GDP_QOQ_ANNUALIZED","Current-dollar GDP":"NOMINAL_GDP_QOQ_ANNUALIZED","Real final sales to private domestic purchasers":"REAL_FINAL_SALES_PRIVATE_QOQ_ANNUALIZED","PCE price index":"GDP_RELEASE_PCE_QOQ_ANNUALIZED","PCE price index excluding food and energy":"GDP_RELEASE_CORE_PCE_QOQ_ANNUALIZED"};
  for(const [label,id] of Object.entries(mapping)){
    const matched=tableRows.filter(r=>r[0]?.replace(", excluding"," excluding")===label);if(matched.length>1)throw new TypeError("Ambiguous GDP row");
    if(matched[0]&&matched[0].length!==header.length)throw new TypeError("GDP column count changed");
    const value=number(matched[0]?.[column]);if(value===null){warnings.push(`missing_value:US_${id}`);continue;}
    observations.push(observation(id,key,value,url,`${stage} estimate SAAR`,1,{revision_reason:stage==="advance"?"unknown":"routine_revision"}));
  }
  if(!observations.some(o=>o.indicator_id==="US_REAL_GDP_QOQ_ANNUALIZED"))throw new TypeError("Missing real GDP");
  const r=release("gdp","quarter",key,published,url,{release_stage:stage});
  const calendars=[{...r,scheduled_at:published,calendar_source_url:url,raw_fetch_index:1}];
  const next=all.match(/Next release: ([A-Za-z]+ \d{1,2}, 20\d{2}), at (\d{1,2}:\d{2}\s*[ap]\.m\.) E[DS]T (.{0,250}?Quarter(?: and Year)? 20\d{2})/i);
  if(next){const n=identity(next[3]);calendars.push({...release("gdp","quarter",n.key,easternTimestamp(next[1],next[2]),url,{release_stage:n.stage}),scheduled_at:easternTimestamp(next[1],next[2]),calendar_source_url:url,raw_fetch_index:1});}
  else warnings.push("next_gdp_calendar_unavailable");
  return {release:r,observations,warnings,calendars};
}
