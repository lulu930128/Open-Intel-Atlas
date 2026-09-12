import { createSourceResult } from "../../atlasContracts.js";
import { createIntelDocument } from "../../documents/normalize.js";
import { parseBlsCalendar, parseBlsRelease } from "./blsParser.js";

const definition = {
  providerType: "official_html", sourceClass: "official_release", authorityClass: "official",
  documentType: "market_observation", domains: ["finance"], languages: ["en"], countries: ["US"],
  homepage: "https://www.bls.gov/", docsUrl: "https://www.bls.gov/bls/linksite.htm",
  attribution: "U.S. Bureau of Labor Statistics", timeoutMs: 15000, cadenceMs: 6 * 60 * 60 * 1000,
  catchupMode: "latest_only", defaultEnabled: false,
  policyNote: "Official BLS public statistical tables; preserve attribution, series definitions and revision lineage. Release latency is not guaranteed. No media or third-party forecast redistribution.",
  coverage: { capabilities: ["macro.observations", "macro.calendar"], markets: ["US"], guarantee: "best_effort", recoverability: "latest_only" }
};
const options = { retries: 0, timeoutMs: 15000, conditional: false, accept: "text/html" };

export const macroSources = [
  { ...definition, id: "bls-macro-calendar", name: "BLS CPI / PPI release calendar", run: fetchCalendar },
  ...["cpi", "ppi"].map((group) => ({ ...definition, id: `bls-${group}-release`,
    name: `BLS ${group.toUpperCase()} official release tables`, macroGroup: group,
    run: (context) => fetchRelease(context, group) }))
];

async function fetchCalendar({ source, http, now }) {
  const startedAt = now(), fetches = [], releases = [], warnings = [];
  for (const group of ["cpi", "ppi"]) {
    try {
      const fetch = await http.getText(`https://www.bls.gov/schedule/news_release/${group}.htm`, options);
      const rawIndex = fetches.push(fetch) - 1;
      releases.push(...parseBlsCalendar(fetch.data, group).map((release) => ({ ...release, raw_fetch_index: rawIndex })));
    } catch (error) { warnings.push(`calendar_failed:${group}:${String(error.message).slice(0, 200)}`); }
  }
  if (!releases.length) throw new Error(`BLS calendar unavailable: ${warnings.join("; ")}`);
  return createSourceResult({ source, startedAt, finishedAt: now(), fetches, macroBatch: { kind: "calendar", releases },
    counts: { processed_item_count: releases.length }, warnings, completeness: { status: warnings.length ? "partial" : "complete" } });
}

async function fetchRelease({ source, http, now }, group) {
  const startedAt = now(), fetches = [], warnings = [];
  // Read summary first, then tables; period mismatch fails closed during an upstream rollout.
  for (const suffix of ["nr0", "t01", ...(group === "ppi" ? ["t03"] : [])]) {
    try { fetches.push(await http.getText(`https://www.bls.gov/news.release/${group}.${suffix}.htm`, options)); }
    catch (error) {
      if (suffix !== "t03") throw error;
      warnings.push(`index_table_unavailable:${String(error.message).slice(0, 200)}`);
    }
  }
  const batch = parseBlsRelease({ group, summaryHtml: fetches[0].data, tableHtml: fetches[1].data, indexHtml: fetches[2]?.data });
  const finishedAt = now();
  const document = createIntelDocument(source, {
    externalId: batch.release.id, canonicalUrl: batch.release.release_url,
    title: `BLS ${group.toUpperCase()} release — ${batch.release.reference_period}`,
    summary: "Official release evidence. Exact values, units and observed revisions belong to the Macro capability.",
    observedAt: batch.release.source_published_at, fetchedAt: finishedAt,
    publisher: "U.S. Bureau of Labor Statistics", publisherKey: "bls", language: "en",
    domains: [{ domain: "finance", confidence: 1 }], tags: ["macro", group],
    rawMetadata: { event_eligible: false, macro_release_id: batch.release.id, timestamp_semantics: batch.release.timestamp_semantics, raw_fetch_index: 0 }
  }, finishedAt);
  // The latest-release URL rolls forward monthly; it must not deduplicate distinct releases.
  document.dedupe_key = `macro_release:${batch.release.id}`;
  return createSourceResult({ source, startedAt, finishedAt, fetches, documents: [document],
    macroBatch: { ...batch, kind: "release" }, counts: { processed_item_count: batch.observations.length },
    warnings: [...warnings, ...batch.warnings], completeness: { status: warnings.length || batch.warnings.length ? "partial" : "complete" } });
}
