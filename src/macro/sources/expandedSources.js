import { createSourceResult } from "../../atlasContracts.js";
import { createIntelDocument } from "../../documents/normalize.js";
import { parseEmployment,parseEmploymentCalendar } from "./employmentParser.js";
import { GDP_INDEX,discoverGdp,parseGdp } from "./gdpParser.js";
import { CLAIMS_URL,parseClaims } from "./claimsParser.js";
import { FOMC_CALENDAR,parseFomcCalendar,parseFomc,validateFomcArtifact } from "./fomcParser.js";
import { extractPdfText } from "./pdfText.js";
const options={retries:0,timeoutMs:15000,conditional:false,accept:"text/html"};
const base={providerType:"official_html",sourceClass:"official_release",authorityClass:"official",documentType:"market_observation",domains:["finance"],languages:["en"],countries:["US"],timeoutMs:15000,cadenceMs:21600000,catchupMode:"latest_only",defaultEnabled:false,
  policyNote:"Official public release evidence. Preserve publication, period, units and observed versions. No forecast, trading inference or guaranteed latency.",coverage:{capabilities:["macro.observations","macro.calendar"],markets:["US"],guarantee:"best_effort",recoverability:"latest_only"}};
const definitions=[
  {group:"employment",prefix:"bls-employment",name:"BLS Employment Situation",homepage:"https://www.bls.gov/",docsUrl:"https://www.bls.gov/news.release/empsit.nr0.htm",attribution:"U.S. Bureau of Labor Statistics"},
  {group:"gdp",prefix:"bea-gdp",name:"BEA Gross Domestic Product",homepage:"https://www.bea.gov/",docsUrl:GDP_INDEX,attribution:"U.S. Bureau of Economic Analysis"},
  {group:"claims",prefix:"dol-claims",name:"DOL Unemployment Insurance Weekly Claims",homepage:"https://www.dol.gov/",docsUrl:CLAIMS_URL,attribution:"U.S. Department of Labor",providerType:"official_pdf",requiredConfig:["macroPdfToTextPath"]},
  {group:"fomc",prefix:"fed-fomc",name:"Federal Reserve FOMC",homepage:"https://www.federalreserve.gov/",docsUrl:FOMC_CALENDAR,attribution:"Board of Governors of the Federal Reserve System"}
];
export const expandedMacroSources=definitions.flatMap(d=>[true,false].map(calendar=>({...base,...d,id:`${d.prefix}-${calendar?"calendar":"release"}`,name:`${d.name} ${calendar?"calendar":"release"}`,macroGroup:calendar?undefined:d.group,run:context=>collect(context,d.group,calendar)})));
async function collect(context,group,calendar){
  const {source,http,now,config}=context,startedAt=now(),fetches=[];
  const get=async url=>{const f=await http.getText(url,options);fetches.push(f);return f.data;};
  let batch;
  if(group==="employment"){
    if(calendar)batch={calendars:parseEmploymentCalendar(await get("https://www.bls.gov/schedule/news_release/empsit.htm")),warnings:[]};
    else batch=parseEmployment(await get(source.docsUrl));
  }else if(group==="gdp")batch=parseGdp(await get(discoverGdp(await get(GDP_INDEX))),fetches[1].url);
  else if(group==="claims"){
    const f=await http.getBytes(CLAIMS_URL,{...options,accept:"application/pdf"});fetches.push(f);
    batch=parseClaims(await extractPdfText(f.data,config.providers.macroPdfToTextPath));
  }else{
    const meetings=parseFomcCalendar(await get(FOMC_CALENDAR),now());
    if(calendar)batch={calendars:meetings,warnings:[]};
    else{
      const meeting=meetings.filter(m=>m.statement_url&&m.scheduled_at<=now()).at(-1);if(!meeting)throw new TypeError("No released FOMC statement in official calendar");
      const statement=await get(meeting.statement_url);
      // Implementation note must agree on the meeting date; optional absence stays visible.
      const note=meeting.implementation_url?await get(meeting.implementation_url):null;
      batch=parseFomc(statement,note,meeting);
      batch.artifacts=[{artifact_type:"statement",source_url:meeting.statement_url,raw_fetch_index:1,published_at:batch.release.source_published_at}];
      if(note)batch.artifacts.push({artifact_type:"implementation_note",source_url:meeting.implementation_url,raw_fetch_index:2});
      for(const item of meeting.artifact_links.slice(0,4)){
        try{const index=fetches.length;validateFomcArtifact(await get(item.source_url),item,meeting);batch.artifacts.push({...item,raw_fetch_index:index,metadata:{meeting_date:meeting.reference_period}});}
        catch(error){batch.warnings.push(`artifact_unavailable:${item.artifact_type}:${String(error.message).slice(0,120)}`);}
      }
    }
  }
  const finishedAt=now();
  if(calendar)return createSourceResult({source,startedAt,finishedAt,fetches,macroBatch:{kind:"calendar",releases:batch.calendars.map(r=>({...r,raw_fetch_index:r.raw_fetch_index??0}))},counts:{processed_item_count:batch.calendars.length},warnings:batch.warnings});
  const r=batch.release,rawIndex=group==="gdp"||group==="fomc"?1:0;
  const document=createIntelDocument(source,{externalId:r.id,canonicalUrl:r.release_url,title:`${source.name} — ${r.reference_period}${r.release_stage?` (${r.release_stage})`:""}`,summary:"Official macroeconomic release evidence; numeric definitions and policy decisions belong to Macro capabilities.",observedAt:r.source_published_at,fetchedAt:finishedAt,publisher:source.attribution,language:"en",domains:[{domain:"finance",confidence:1}],tags:["macro",group],rawMetadata:{event_eligible:false,macro_release_id:r.id,raw_fetch_index:rawIndex,timestamp_semantics:r.timestamp_semantics}},finishedAt);
  document.dedupe_key=`macro_release:${r.id}`;
  return createSourceResult({source,startedAt,finishedAt,fetches,documents:[document],macroBatch:{...batch,kind:"release"},counts:{processed_item_count:batch.observations.length},warnings:batch.warnings,completeness:{status:batch.warnings.length?"partial":"complete"}});
}
