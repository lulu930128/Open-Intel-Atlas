import { bounded,text,officialUrl,release,observation } from "./officialParsing.js";
import { monthNumber,easternTimestamp } from "../time.js";
import { dateOnly } from "../period.js";
export const FOMC_CALENDAR="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const host="www.federalreserve.gov";
export function parseFomcCalendar(html,now){
  bounded(html);const currentYear=Number(now.slice(0,4)),meetings=[];
  const headings=[...html.matchAll(/<h4>\s*<a\b[^>]*>(20\d{2}) FOMC Meetings<\/a>\s*<\/h4>/gi)];
  for(let n=0;n<headings.length;n++){
    const y=Number(headings[n][1]);if(y<currentYear-1||y>currentYear+1)continue;
    const section=html.slice(headings[n].index,headings[n+1]?.index||html.length),starts=[...section.matchAll(/<div class="(?:fomc-meeting--shaded )?row fomc-meeting"[^>]*>/g)];
    for(let i=0;i<starts.length;i++){
      const row=section.slice(starts[i].index,starts[i+1]?.index||section.length);
      const month=text(row.match(/class="[^"]*fomc-meeting__month[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]||""),days=text(row.match(/class="[^"]*fomc-meeting__date[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]||"");
      if(!/^\d{1,2}(?:-\d{1,2})?\*?$/.test(days))continue; // Notation votes have no scheduled rate decision.
      const months=month.split("/"),range=days.replace("*","").split("-"),endDay=range.at(-1),startDay=range[0];
      const start=dateOnly(`${y}-${String(monthNumber(months[0])).padStart(2,"0")}-${startDay.padStart(2,"0")}`),key=dateOnly(`${y}-${String(monthNumber(months.at(-1))).padStart(2,"0")}-${endDay.padStart(2,"0")}`);
      const end=new Date(Date.parse(key)+86400000).toISOString().slice(0,10);
      const links=[...row.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(u=>/\/(?:monetarypolicy|newsevents\/pressreleases)\//.test(u)).map(u=>officialUrl(u,host));
      const statement=links.find(u=>/\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/.test(u));
      if(statement&&!statement.includes(key.replaceAll("-","")))throw new TypeError("FOMC calendar/statement identity mismatch");
      const scheduled=easternTimestamp(`${months.at(-1)} ${endDay}, ${y}`,"2:00 p.m.");
      meetings.push({...release("fomc","event",key,scheduled,statement||FOMC_CALENDAR,{period_start:start,period_end:end}),scheduled_at:scheduled,scheduled_semantics:"regular_meeting_1400_eastern_policy",calendar_source_url:FOMC_CALENDAR,raw_fetch_index:0,statement_url:statement||null,
        implementation_url:links.find(u=>/monetary\d{8}a1\.htm$/.test(u))||null,
        artifact_links:links.filter(u=>/\/monetarypolicy\/(?:fomcminutes|fomcprojtabl|fomcpresconf)\d{8}\.htm$/.test(u)).map(u=>({source_url:u,artifact_type:u.includes("fomcminutes")?"minutes":u.includes("fomcprojtabl")?"sep":"press_conference"})),projection_expected:days.includes("*")});
    }
  }
  if(!meetings.length||meetings.length>36||new Set(meetings.map(m=>m.id)).size!==meetings.length)throw new TypeError("FOMC calendar missing or ambiguous");
  return meetings.sort((a,b)=>a.reference_period.localeCompare(b.reference_period));
}
function rate(value){const s=value.replace(/[‑–]/g,"-");if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const f=s.match(/^(?:(\d+)-)?(\d+)\/(\d+)$/);if(!f||Number(f[3])===0)throw new TypeError("Invalid FOMC rate");return Number(f[1]||0)+Number(f[2])/Number(f[3]);}
export function validateFomcArtifact(html,item,meeting){
  const body=text(bounded(html));officialUrl(item.source_url,host);
  if(!item.source_url.includes(meeting.reference_period.replaceAll("-","")))throw new TypeError("Artifact meeting mismatch");
  const labels={minutes:/Minutes of the Federal Open Market Committee/i,sep:/Projection Materials|Summary of Economic Projections/i,press_conference:/Press Conference/i};
  if(!labels[item.artifact_type]?.test(body))throw new TypeError("Unknown FOMC artifact content");
}
export function parseFomc(statementHtml,noteHtml,meeting){
  const body=text(bounded(statementHtml)).replace(/[‑–]/g,"-");
  if(!body.includes("Federal Reserve issues FOMC statement"))throw new TypeError("Missing FOMC statement title");
  const date=body.match(/([A-Za-z]+ \d{1,2}, 20\d{2}) Federal Reserve issues FOMC statement/),clock=body.match(/For release at (\d{1,2}:\d{2}\s*[ap]\.m\.) E[DS]T/i);
  if(!date||!clock)throw new TypeError("Missing FOMC statement timestamp");
  const published=easternTimestamp(date[1],clock[1]);
  if(published.slice(0,10)!==meeting.reference_period)throw new TypeError("FOMC statement date mismatch");
  const range=body.match(/(?:Committee decided to|Committee has decided to) (maintain|raise|lower|reduce) the target range for the federal funds rate(?: by ([\d./-]+) percentage point)? (?:at|to) ([\d./-]+) to ([\d./-]+) percent/i);
  if(!range)throw new TypeError("Unknown FOMC target decision wording");
  const lower=rate(range[3]),upper=rate(range[4]);if(lower<0||lower>upper||upper>30)throw new TypeError("Invalid FOMC target range");
  let effectiveDate=null;
  if(noteHtml){const note=text(bounded(noteHtml)).replace(/[‑–]/g,"-");const effective=note.match(/Effective ([A-Za-z]+ \d{1,2}, 20\d{2}), the Federal Open Market Committee directs/i);if(!effective||!note.includes(`Implementation Note issued ${date[1]}`))throw new TypeError("Missing or mismatched FOMC implementation date");const d=effective[1].match(/([A-Za-z]+) (\d+), (\d+)/);effectiveDate=dateOnly(`${d[3]}-${String(monthNumber(d[1])).padStart(2,"0")}-${d[2].padStart(2,"0")}`);if(effectiveDate<meeting.reference_period)throw new TypeError("FOMC effective date precedes decision");const noteRange=note.match(/federal funds rate in a target range of ([\d./-]+) to ([\d./-]+) percent/i);if(!noteRange||rate(noteRange[1])!==lower||rate(noteRange[2])!==upper)throw new TypeError("FOMC statement and implementation range mismatch");}
  const action=range[1].toLowerCase(),decision={decision_type:action==="maintain"?"hold":action==="raise"?"hike":"cut",target_lower:lower,target_upper:upper,announced_change_bps:action==="maintain"?0:range[2]?rate(range[2])*100*(action==="raise"?1:-1):null,effective_date:effectiveDate,effective_time_status:effectiveDate?"date_only":"unknown",source_url:meeting.statement_url,raw_fetch_index:1,implementation_raw_fetch_index:noteHtml?2:null};
  return {release:{...meeting,source_published_at:published,timestamp_semantics:"official_publication_time",release_url:meeting.statement_url,effective_date:effectiveDate},decision,
    observations:[observation("FED_FUNDS_TARGET_LOWER",meeting.reference_period,lower,meeting.statement_url,"announced target lower",1),observation("FED_FUNDS_TARGET_UPPER",meeting.reference_period,upper,meeting.statement_url,"announced target upper",1)],warnings:noteHtml?[]:["implementation_note_unavailable"]};
}
