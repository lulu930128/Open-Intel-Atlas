import { bounded,release,observation,number } from "./officialParsing.js";
import { easternTimestamp,monthNumber } from "../time.js";
import { period,shiftReference } from "../period.js";
export const CLAIMS_URL="https://www.dol.gov/ui/data.pdf";
function week(text,published){
  const m=text.match(/^([A-Za-z]+) (\d{1,2})$/);if(!m)throw new TypeError("Invalid claims week");
  const year=Number(published.slice(0,4));
  const dates=[year,year-1].map(y=>`${y}-${String(monthNumber(m[1])).padStart(2,"0")}-${m[2].padStart(2,"0")}`).filter(d=>d<=published.slice(0,10));
  const key=dates[0];if(!key||Date.parse(published)-Date.parse(key)>14*86400000)throw new TypeError("Claims reference week out of range");
  period("week",key,{week_convention:"ending_saturday"});return key;
}
export function parseClaims(value){
  const all=bounded(value).replace(/\s+/g," ");
  if(!all.includes("UNEMPLOYMENT INSURANCE WEEKLY CLAIMS")||!all.includes("SEASONALLY ADJUSTED DATA"))throw new TypeError("Not a DOL weekly claims release");
  const stamp=all.match(/EMBARGOED UNTIL (\d{1,2}:\d{2} A\.M\.) \(Eastern\) [A-Za-z]+, ([A-Za-z]+ \d{1,2}, 20\d{2})/i);if(!stamp)throw new TypeError("Missing DOL embargo");
  const published=easternTimestamp(stamp[2],stamp[1]);
  const initial=all.match(/In the week ending ([A-Za-z]+ \d{1,2}), the advance figure for seasonally adjusted initial claims was ([\d,]+)/);
  const continued=all.match(/advance number for seasonally adjusted insured unemployment during the week ending ([A-Za-z]+ \d{1,2}) was ([\d,]+)/);
  if(!initial||!continued)throw new TypeError("Missing DOL initial or continuing claims");
  const key=week(initial[1],published),continuedKey=week(continued[1],published);
  if(shiftReference("week",key,-1,{week_convention:"ending_saturday"})!==continuedKey)throw new TypeError("Unexpected continuing claims reference week");
  const observations=[observation("INITIAL_CLAIMS",key,number(initial[2]),CLAIMS_URL,"initial claims SA advance",0,{preliminary:true}),observation("CONTINUING_CLAIMS",continuedKey,number(continued[2]),CLAIMS_URL,"insured unemployment SA advance",0,{preliminary:true})],warnings=[];
  const average=all.match(/The 4-week moving average was ([\d,]+)/),rate=all.match(/advance seasonally adjusted insured unemployment rate was (\d+(?:\.\d+)?) percent for the week ending ([A-Za-z]+ \d{1,2})/);
  if(average)observations.push(observation("INITIAL_CLAIMS_4W_AVERAGE",key,number(average[1]),CLAIMS_URL,"initial claims SA four-week mean",0,{preliminary:true}));else warnings.push("missing_four_week_average");
  if(rate&&week(rate[2],published)===continuedKey)observations.push(observation("INSURED_UNEMPLOYMENT_RATE",continuedKey,number(rate[1]),CLAIMS_URL,"insured unemployment rate SA",0,{preliminary:true}));else warnings.push("missing_insured_unemployment_rate");
  for(const [id,ref,pattern,current] of [["INITIAL_CLAIMS",key,/Initial Claims \(SA\) ([\d,]+) ([\d,]+)/,number(initial[2])],["CONTINUING_CLAIMS",continuedKey,/Insured Unemployment \(SA\) ([\d,]+) ([\d,]+)/,number(continued[2])]]){
    const row=all.match(pattern);if(row&&number(row[1])===current)observations.push(observation(id,shiftReference("week",ref,-1,{week_convention:"ending_saturday"}),number(row[2]),CLAIMS_URL,"prior week as reported in SA table",0,{preliminary:true,revision_reason:"routine_revision"}));
  }
  const r=release("claims","week",key,published,CLAIMS_URL,{week_convention:"ending_saturday"});
  // Only the published official timestamp is a calendar fact; holidays are never guessed.
  return {release:r,observations,warnings,calendars:[{...r,scheduled_at:published,calendar_source_url:CLAIMS_URL,raw_fetch_index:0}]};
}
