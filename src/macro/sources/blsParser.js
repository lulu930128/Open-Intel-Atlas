import { cleanText } from "../../core/utils.js";
import { MACRO_INDICATORS, releaseId } from "../indicators.js";
import { easternTimestamp, monthNumber, referencePeriod, shiftPeriod } from "../time.js";

const MAX_HTML = 2 * 1024 * 1024;
const text = (html) => cleanText(String(html).replace(/<span\b[^>]*class="footnoteRefs"[^>]*>[\s\S]*?<\/span>/gi, "").replace(/<br\s*\/?\s*>/gi, " "), 0);

function bounded(html) {
  if (typeof html !== "string" || !html.trim() || html.length > MAX_HTML) throw new TypeError("Invalid or oversized BLS HTML");
  return html;
}
function rows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((cell) => ({
      tag: cell[1].toLowerCase(), value: text(cell[3]), raw: cell[3],
      id: cell[2].match(/\bid="([^"]+)"/i)?.[1] || "",
      headers: (cell[2].match(/\bheaders="([^"]+)"/i)?.[1] || "").split(/\s+/)
    })));
}
function table(html, id) {
  const found = [...bounded(html).matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].filter((m) => m[1].includes(`id="${id}"`));
  if (found.length !== 1) throw new TypeError(`BLS table missing or ambiguous: ${id}`);
  const body = found[0][2];
  const caption = text(body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
  return { rows: rows(body), period: referencePeriod(caption), caption };
}
function numeric(cell) {
  const value = text(cell?.raw?.match(/<span\b[^>]*class="datavalue"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? cell?.value ?? "");
  return /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function parseBlsCalendar(html, group) {
  const expected = group === "cpi" ? "Consumer Price Index" : group === "employment" ? "Employment Situation" : "Producer Price Index";
  if (!bounded(html).includes(expected)) throw new TypeError("BLS calendar group mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*class="release-list"[^>]*>([\s\S]*?)<\/table>/gi)];
  if (tables.length !== 1) throw new TypeError("Missing BLS release calendar table");
  const entries = rows(tables[0][1]);
  if (entries[0]?.map((c) => c.value).join("|") !== "Reference Month|Release Date|Release Time") throw new TypeError("BLS calendar headers changed");
  const releases = entries.slice(1).filter((r) => r.some((c) => c.tag === "td")).map((r) => {
    if (r.length !== 3) throw new TypeError("Malformed BLS calendar row");
    const period = referencePeriod(r[0].value);
    return { id: releaseId(group, period), release_group: group, reference_period: period,
      scheduled_at: easternTimestamp(r[1].value, r[2].value),
      calendar_source_url: `https://www.bls.gov/schedule/news_release/${group==="employment"?"empsit":group}.htm` };
  });
  if (!releases.length || releases.length > 36 || new Set(releases.map((r) => r.id)).size !== releases.length) throw new TypeError("Empty, oversized or duplicate BLS calendar");
  return releases;
}

export function parseBlsRelease({ group, summaryHtml, tableHtml, indexHtml = null }) {
  const summary = text(bounded(summaryHtml));
  const title = group === "cpi" ? /CONSUMER PRICE INDEX\s*-\s*([A-Z]+\s+20\d{2})/i : /PRODUCER PRICE INDEXES\s*-\s*([A-Z]+\s+20\d{2})/i;
  const period = referencePeriod(summary.match(title)?.[1] || "");
  const embargo = summary.match(/embargoed until\s+(?:USDL[ -]+\d{2}-\d+\s+)?(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*\(ET\)\s*[A-Za-z]+,\s*([A-Za-z]+\s+\d{1,2},\s*20\d{2})/i);
  if (!embargo) throw new TypeError("Missing official BLS embargo timestamp");
  const publishedAt = easternTimestamp(embargo[2], embargo[1]);
  const localDate = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(publishedAt)).map(p => [p.type,p.value]));
  const archiveUrl = `https://www.bls.gov/news.release/archives/${group}_${localDate.month}${localDate.day}${localDate.year}.htm`;
  const primary = table(tableHtml, group === "cpi" ? "cpipress1" : "ppi_nrtable1");
  const index = group === "ppi" && indexHtml ? table(indexHtml, "ppi_nrtable3") : null;
  if (primary.period !== period || (index && index.period !== period)) throw new TypeError("BLS release/table reference period mismatch");
  const observations = [], warnings = [];
  for (const indicator of MACRO_INDICATORS.filter((i) => i.release_group === group)) {
    const selected = group === "ppi" && indicator.transformation === "index" ? index : primary;
    if (!selected) { warnings.push(`missing_table:${indicator.id}`); continue; }
    const candidates = selected.rows.filter((r) => r[0]?.tag === "th" && r[0].value.toLowerCase() === indicator.name.toLowerCase() && r.some((c) => c.raw.includes('class="datavalue"')));
    if (candidates.length !== 1) { warnings.push(`missing_or_ambiguous_row:${indicator.id}`); continue; }
    const row = candidates[0];
    const prefix = group === "cpi" ? "cpipress1" : indicator.transformation === "index" ? "ppi_nrtable3" : "ppi_nrtable1";
    const columns = group === "cpi"
      ? indicator.transformation === "index" ? [[3, -12], [4, -1], [5, 0]] : indicator.transformation === "yoy" ? [[6, 0]] : [[8, -2], [9, -1], [10, 0]]
      : indicator.transformation === "yoy" ? [[5, 0]] : indicator.transformation === "index" ? [[5, -4], [6, -3], [7, -2], [8, -1], [9, 0]] : [[6, -4], [7, -3], [8, -2], [9, -1], [10, 0]];
    for (const [column, offset] of columns) {
      const headerId = `${prefix}.h.2.${column}`;
      const header = selected.rows.flat().find((c) => c.id === headerId);
      const valueCell = row.find((c) => c.headers.includes(headerId));
      const parent = header?.headers.map((id) => selected.rows.flat().find((c) => c.id === id)?.value || "").join(" ") || "";
      const expectedUnit = indicator.transformation === "index" ? /index|indexes/i : /percent.*change/i;
      const expectedAdjustment = indicator.seasonal_adjustment === "SA" ? /seasonally adjusted/i : /unadjusted/i;
      if (!expectedUnit.test(parent) || !expectedAdjustment.test(parent)) throw new TypeError(`BLS unit/adjustment header changed: ${indicator.id}`);
      const ref = shiftPeriod(period, offset);
      const months = [...(header?.value || "").matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\b/gi)];
      if (!months.length || monthNumber(months.at(-1)[1]) !== Number(ref.slice(5))) throw new TypeError(`BLS period column changed: ${headerId}`);
      const years = [...(header?.value || "").matchAll(/\b20\d{2}\b/g)];
      if (years.length && years.at(-1)[0] !== ref.slice(0, 4)) throw new TypeError(`BLS year column changed: ${headerId}`);
      if (indicator.transformation !== "index") {
        const previousPeriod = shiftPeriod(ref, indicator.transformation === "yoy" ? -12 : -1);
        if (months.length !== 2 || monthNumber(months[0][1]) !== Number(previousPeriod.slice(5))
          || (years.length && years[0][0] !== previousPeriod.slice(0,4))) throw new TypeError(`BLS change interval changed: ${headerId}`);
      }
      const actual = numeric(valueCell);
      if (actual === null) { warnings.push(`missing_value:${indicator.id}:${ref}`); continue; }
      const baseCell = group === "ppi" && indicator.transformation === "index" ? row.find((c) => c.headers.includes("ppi_nrtable3.h.1.2")) : null;
      observations.push({ indicator_id: indicator.id, reference_period: ref, actual,
        index_base: indicator.transformation === "index" ? baseCell?.value || indicator.index_base || "Nov. 2009=100" : null,
        preliminary: /title="Preliminary"/i.test(header.raw) || /title="Preliminary"/i.test(valueCell.raw),
        raw_fetch_index: group === "ppi" && indicator.transformation === "index" ? 2 : 1,
        source_url: `https://www.bls.gov/news.release/${group}.${group === "ppi" && indicator.transformation === "index" ? "t03" : "t01"}.htm`,
        source_column: headerId });
    }
  }
  if (!observations.some((o) => o.reference_period === period)) throw new TypeError("BLS release has no usable current observations");
  return { release: { id: releaseId(group, period), release_group: group, reference_period: period,
    source_published_at: publishedAt, timestamp_semantics: "official_embargo_time",
    release_url: archiveUrl }, observations, warnings };
}
