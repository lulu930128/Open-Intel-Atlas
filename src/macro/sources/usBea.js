import { createSourceResult } from "../../atlasContracts.js";
import { createIntelDocument } from "../../documents/normalize.js";
import { discoverBeaRelease, parseBeaRelease } from "./beaParser.js";

const definition = {
  providerType:"official_html",sourceClass:"official_release",authorityClass:"official",documentType:"market_observation",
  domains:["finance"],languages:["en"],countries:["US"],homepage:"https://www.bea.gov/",
  docsUrl:"https://www.bea.gov/data/income-saving/personal-income",attribution:"U.S. Bureau of Economic Analysis",
  timeoutMs:15000,cadenceMs:21600000,catchupMode:"latest_only",defaultEnabled:false,
  policyNote:"Official BEA statistical release. Preserve units, observed vintage and attribution. No guaranteed release latency or forecasts.",
  coverage:{capabilities:["macro.observations","macro.calendar"],markets:["US"],guarantee:"best_effort",recoverability:"latest_only"}
};
export const beaSources = [
  {...definition,id:"bea-pce-calendar",name:"BEA personal income and outlays calendar",run:context=>collect(context,true)},
  {...definition,id:"bea-pce-release",name:"BEA PCE, personal income and consumption",macroGroup:"pce",run:context=>collect(context,false)}
];
async function collect({source,http,now}, calendar) {
  const startedAt=now(), options={retries:0,timeoutMs:15000,conditional:false,accept:"text/html"};
  const index=await http.getText(definition.docsUrl,options);
  const url=discoverBeaRelease(index.data);
  const fetched=await http.getText(url,options);
  const batch=parseBeaRelease(fetched.data,url),finishedAt=now(),fetches=[index,fetched];
  if(calendar) return createSourceResult({source,startedAt,finishedAt,fetches,
    macroBatch:{kind:"calendar",releases:batch.calendars},counts:{processed_item_count:batch.calendars.length}});
  const document=createIntelDocument(source,{externalId:batch.release.id,canonicalUrl:url,
    title:`BEA Personal Income and Outlays — ${batch.release.reference_period}`,
    summary:"Official release evidence. Values and observed revisions belong to the Macro capability.",
    observedAt:batch.release.source_published_at,fetchedAt:finishedAt,publisher:"U.S. Bureau of Economic Analysis",publisherKey:"bea",
    language:"en",domains:[{domain:"finance",confidence:1}],tags:["macro","pce"],
    rawMetadata:{event_eligible:false,macro_release_id:batch.release.id,raw_fetch_index:1,timestamp_semantics:batch.release.timestamp_semantics}},finishedAt);
  document.dedupe_key=`macro_release:${batch.release.id}`;
  return createSourceResult({source,startedAt,finishedAt,fetches,documents:[document],
    macroBatch:{kind:"release",release:batch.release,observations:batch.observations},warnings:batch.warnings,
    counts:{processed_item_count:batch.observations.length},completeness:{status:batch.warnings.length?"partial":"complete"}});
}
