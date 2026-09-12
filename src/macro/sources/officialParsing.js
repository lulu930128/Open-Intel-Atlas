import { cleanText } from "../../core/utils.js";
import { buildReleaseId } from "../period.js";
export function text(html){return cleanText(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," "),0).replace(/\s+/g," ").trim();}
export function bounded(value){if(typeof value!=="string"||!value.trim()||value.length>2*1024*1024)throw new TypeError("Invalid official release payload");return value;}
export function only(matches,label){if(matches.length!==1)throw new TypeError(`Missing or ambiguous ${label}`);return matches[0];}
export function officialUrl(url,host){const u=new URL(url,`https://${host}`);if(u.origin!==`https://${host}`||u.username||u.password)throw new TypeError("Official URL ownership mismatch");return u.href;}
export function release(group,kind,key,published,url,extra={}){return {id:buildReleaseId("US",group,kind,key,extra.release_stage),release_group:group,reference_period:key,period_kind:kind,source_published_at:published,release_url:url,timestamp_semantics:"official_embargo_time",...extra};}
export function observation(id,key,actual,url,column,rawIndex=0,extra={}){return {indicator_id:`US_${id}`,reference_period:key,actual,source_url:url,source_column:column,raw_fetch_index:rawIndex,preliminary:false,index_base:null,...extra};}
export function number(value){const s=String(value).replaceAll(",","").replaceAll("−","-");return /^[+-]?\d+(?:\.\d+)?$/.test(s)?Number(s):null;}
export function rows(html){return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>text(c[1])));}
