import { bounded,text,release,observation,number } from "./officialParsing.js";
import { easternTimestamp,referencePeriod,monthNumber,shiftPeriod } from "../time.js";
import { parseBlsCalendar } from "./blsParser.js";
const URL="https://www.bls.gov/news.release/empsit.nr0.htm";
export function parseEmploymentCalendar(html){return parseBlsCalendar(html,"employment");}
export function parseEmployment(html){
  const body=text(bounded(html).match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1]||html);
  const key=referencePeriod(body.match(/THE EMPLOYMENT SITUATION\s*[-–]\s*([A-Z]+ 20\d{2})/i)?.[1]||"");
  const embargo=body.match(/embargoed until\s+(?:USDL[ -]+\d{2}-\d+\s+)?(\d{1,2}:\d{2}\s*[ap]\.m\.)\s*\(ET\)\s*[A-Za-z]+,\s*([A-Za-z]+ \d{1,2}, 20\d{2})/i);
  if(!embargo)throw new TypeError("Missing Employment Situation embargo");
  const published=easternTimestamp(embargo[2],embargo[1]),date=embargo[2].match(/([A-Za-z]+) (\d+), (\d+)/);
  const url=`https://www.bls.gov/news.release/archives/empsit_${String(monthNumber(date[1])).padStart(2,"0")}${date[2].padStart(2,"0")}${date[3]}.htm`;
  const observations=[],warnings=[];
  function add(id,value,column,ref=key,extra={}){const n=number(value);if(n===null){warnings.push(`missing_value:US_${id}:${ref}`);return;}observations.push(observation(id,ref,n,URL,column,0,extra));}
  const nfp=body.match(/Total nonfarm payroll employment (increased|decreased|rose|fell|declined) by ([\d,]+) in ([A-Za-z]+)/i);
  if(nfp&&monthNumber(nfp[3])===Number(key.slice(5)))add("NFP_CHANGE",String(number(nfp[2])*(/decreased|fell|declined/i.test(nfp[1])?-1:1)),"nonfarm payroll change",key,{preliminary:true});
  else if(/Total nonfarm payroll employment (?:was |remained )?unchanged in /i.test(body))add("NFP_CHANGE","0","nonfarm payroll unchanged",key,{preliminary:true});
  else warnings.push("missing_value:US_NFP_CHANGE");
  add("UNEMPLOYMENT_RATE",body.match(/(?:The |the )?unemployment rate (?:was |remained )?(?:unchanged|changed little|held steady|edged up|edged down|rose|fell|increased|decreased|declined)(?: at| to)? (\d+(?:\.\d+)?) percent/i)?.[1],"household unemployment rate");
  add("PARTICIPATION_RATE",body.match(/labor force participation rate [^.]*?(?:at|to) (\d+(?:\.\d+)?) percent/i)?.[1],"labor force participation rate");
  const earnings=body.match(/average hourly earnings for all employees on private nonfarm payrolls (rose|increased|fell|decreased|declined) by [\d.]+ cents, or (\d+(?:\.\d+)?) percent, to \$(\d+(?:\.\d+)?)[.] Over the year, average hourly earnings have (increased|decreased) by (\d+(?:\.\d+)?) percent/i);
  if(earnings){add("AHE_MOM",String(Number(earnings[2])*(/fell|decreased|declined/i.test(earnings[1])?-1:1)),"average hourly earnings monthly percent",key,{preliminary:true});add("AHE_LEVEL",earnings[3],"average hourly earnings dollars per hour",key,{preliminary:true});add("AHE_YOY",String(Number(earnings[5])*(earnings[4]==="decreased"?-1:1)),"average hourly earnings annual percent",key,{preliminary:true});}
  else warnings.push("missing_earnings_paragraph");
  add("AVERAGE_WEEKLY_HOURS",body.match(/average workweek for all employees on private nonfarm payrolls .{0,120}?(?:to|at) (\d+(?:\.\d+)?) hours/i)?.[1],"average weekly hours",key,{preliminary:true});
  for(const m of body.matchAll(/(?:change in total nonfarm payroll employment|change) for ([A-Za-z]+) was revised (?:up|down) by [\d,]+, from [+-]?[\d,]+ to ([+-]?[\d,]+)/gi)){
    const ref=[shiftPeriod(key,-1),shiftPeriod(key,-2)].find(p=>Number(p.slice(5))===monthNumber(m[1]));if(ref)add("NFP_CHANGE",m[2],"revised payroll monthly change",ref,{preliminary:true,revision_reason:"routine_revision"});
  }
  if(!observations.length)throw new TypeError("No Employment Situation observations");
  return {release:release("employment","month",key,published,url),observations,warnings};
}
