import { cleanText } from "../../core/utils.js";
import { releaseId, expectedIndicators } from "../indicators.js";
import { easternTimestamp, monthNumber, referencePeriod, shiftPeriod } from "../time.js";

const text = html => cleanText(html, 0).replace(/\s+([.,])/g,"$1");
function bounded(html) {
  if (typeof html !== "string" || !html.trim() || html.length > 2 * 1024 * 1024) throw new TypeError("Invalid BEA HTML");
  return html;
}
export function discoverBeaRelease(html) {
  const links = [...bounded(html).matchAll(/href="([^"]*\/news\/20\d{2}\/personal-income-and-outlays-[a-z]+-20\d{2})"/g)]
    .map(m => new URL(m[1], "https://www.bea.gov"))
    .filter(u => u.origin === "https://www.bea.gov");
  const unique = [...new Set(links.map(u => u.href))];
  // The indicator landing page must identify one current release, not a search archive.
  if (unique.length !== 1) throw new TypeError("BEA current release missing or ambiguous");
  return unique[0];
}
export function parseBeaRelease(html, url) {
  bounded(html);
  const origin = new URL(url);
  if (origin.origin !== "https://www.bea.gov" || !/^\/news\/20\d{2}\/personal-income-and-outlays-[a-z]+-20\d{2}$/.test(origin.pathname)) throw new TypeError("Invalid BEA release URL");
  const heading = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(m[1])).find(s => /^Personal Income and Outlays, /.test(s));
  if (!heading) throw new TypeError("Missing BEA release title");
  const period = referencePeriod(heading);
  const slugPeriod = referencePeriod(origin.pathname.split("personal-income-and-outlays-")[1].replaceAll("-", " "));
  if (slugPeriod !== period) throw new TypeError("BEA URL period mismatch");
  const allText = text(html);
  const embargo = allText.match(/EMBARGOED UNTIL RELEASE AT (\d{1,2}:\d{2}\s*[ap]\.m\.) E[DS]T, [A-Za-z]+, ([A-Za-z]+ \d{1,2}, 20\d{2})/);
  if (!embargo) throw new TypeError("Missing BEA embargo time");
  const published = easternTimestamp(embargo[2], embargo[1]);
  const release = { id:releaseId("pce",period), release_group:"pce", reference_period:period,
    source_published_at:published, release_url:url, timestamp_semantics:"official_embargo_time" };
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(m => text(m[1]).includes("Personal Income and Related Measures"));
  if (tables.length !== 1 || !text(tables[0][1]).includes("[Percent change from preceding month]")) throw new TypeError("BEA monthly table missing or units changed");
  const rows = [...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => text(c[1])));
  const header = rows.find(r => r.length === 3 && r[0] === "");
  if (!header || monthNumber(header[2]) !== Number(period.slice(5)) || monthNumber(header[1]) !== Number(shiftPeriod(period,-1).slice(5))) throw new TypeError("BEA table period mismatch");
  const observations = [], warnings = [];
  const add = (id, value, ref, column) => {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) { warnings.push(`missing_value:${id}:${ref}`); return; }
    observations.push({indicator_id:id,reference_period:ref,actual:Number(value),preliminary:false,index_base:null,
      source_url:url,source_column:column,raw_fetch_index:1});
  };
  for (const indicator of expectedIndicators("pce").filter(i => i.transformation === "mom")) {
    const matches = rows.filter(r => r[0] === indicator.name);
    if (matches.length !== 1 || matches[0].length !== 3) throw new TypeError(`BEA row missing or ambiguous: ${indicator.name}`);
    add(indicator.id,matches[0][1],shiftPeriod(period,-1),header[1]);
    add(indicator.id,matches[0][2],period,header[2]);
  }
  // Official release body, bounded to its year-over-year paragraph, never headlines or third-party text.
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => text(m[1]));
  const yearly = paragraphs.filter(p => p.startsWith("From the same month one year ago, the PCE price index"));
  if (yearly.length !== 1) throw new TypeError("Missing BEA annual comparison paragraph");
  const annual = yearly[0].match(/^From the same month one year ago, the PCE price index for ([A-Za-z]+) (increased|decreased) (\d+(?:\.\d+)?) percent\. Excluding food and energy, the PCE price index (increased|decreased) (\d+(?:\.\d+)?) percent from one year ago\.$/);
  if (!annual || monthNumber(annual[1]) !== Number(period.slice(5))) throw new TypeError("BEA annual comparison format or period changed");
  add("US_PCE_HEADLINE_YOY",String(Number(annual[3])*(annual[2]==="decreased"?-1:1)),period,"same month one year ago");
  add("US_PCE_CORE_YOY",String(Number(annual[5])*(annual[4]==="decreased"?-1:1)),period,"same month one year ago");
  const next = allText.match(/Next release: ([A-Za-z]+ \d{1,2}, 20\d{2}), at (\d{1,2}:\d{2}\s*[ap]\.m\.) E[DS]T Personal Income and Outlays, ([A-Za-z]+ 20\d{2})/);
  if (!next) throw new TypeError("BEA next release calendar missing");
  const nextPeriod = referencePeriod(next[3]);
  if (nextPeriod !== shiftPeriod(period,1)) throw new TypeError("BEA next release period mismatch");
  const calendars = [
    {id:release.id,release_group:"pce",reference_period:period,scheduled_at:published},
    {id:releaseId("pce",nextPeriod),release_group:"pce",reference_period:nextPeriod,scheduled_at:easternTimestamp(next[1],next[2])}
  ].map(r => ({...r,calendar_source_url:url,raw_fetch_index:1}));
  return {release,observations,warnings,calendars};
}
