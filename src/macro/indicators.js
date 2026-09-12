import { SOURCE_GROUPS, SOURCE_INDICATORS } from "./sourceIndicators.js";
export const MACRO_GROUP_METADATA = Object.freeze({
  ...SOURCE_GROUPS,
  cpi: { name: "CPI 消費者物價", source_id: "bls-cpi-release", calendar_source_id: "bls-macro-calendar", host: "www.bls.gov" },
  ppi: { name: "PPI 生產者物價", source_id: "bls-ppi-release", calendar_source_id: "bls-macro-calendar", host: "www.bls.gov" },
  pce: { name: "PCE・個人所得與消費", source_id: "bea-pce-release", calendar_source_id: "bea-pce-calendar", host: "www.bea.gov" }
});
export const MACRO_GROUPS = Object.freeze(Object.keys(MACRO_GROUP_METADATA));
const families = [
  ["CPI_HEADLINE", "cpi", "All items", "1982-84=100"],
  ["CPI_CORE", "cpi", "All items less food and energy", "1982-84=100"],
  ["PPI_FINAL_DEMAND", "ppi", "Final demand", "Nov. 2009=100"],
  ["PPI_EX_FOOD_ENERGY", "ppi", "Final demand less foods and energy", "Apr. 2010=100"],
  ["PPI_EX_FOOD_ENERGY_TRADE", "ppi", "Final demand less foods, energy, and trade services", "Aug. 2013=100"]
];
const blsIndicators = families.flatMap(([code, group, label, base]) =>
  ["index", "mom", "yoy"].map((transformation) => Object.freeze({
    id: `US_${code}_${transformation.toUpperCase()}`, country_code: "US", authority: "BLS",
    category: "inflation", frequency: "monthly", release_group: group, name: label, transformation,
    unit: transformation === "index" ? "index" : "percent",
    seasonal_adjustment: transformation === "mom" || (group === "ppi" && transformation === "index") ? "SA" : "NSA",
    index_base: transformation === "index" ? base : null, source_id: `bls-${group}-release`,
    official_url: `https://www.bls.gov/${group}/`
  })));
export const MACRO_INDICATORS = Object.freeze([...SOURCE_INDICATORS, ...blsIndicators, ...[
  ["PCE_HEADLINE", "PCE price index", "inflation", "mom"],
  ["PCE_HEADLINE", "PCE price index", "inflation", "yoy"],
  ["PCE_CORE", "PCE price index excluding food and energy", "inflation", "mom"],
  ["PCE_CORE", "PCE price index excluding food and energy", "inflation", "yoy"],
  ["PERSONAL_INCOME", "Current-dollar personal income", "income", "mom"],
  ["PERSONAL_CONSUMPTION", "Current-dollar PCE", "consumption", "mom"]
].map(([code,name,category,transformation]) => Object.freeze({
  id:`US_${code}_${transformation.toUpperCase()}`, country_code:"US", authority:"BEA", category,
  frequency:"monthly", release_group:"pce", name, transformation, unit:"percent", seasonal_adjustment:"SA",
  index_base:null, source_id:"bea-pce-release", official_url:"https://www.bea.gov/data/personal-consumption-expenditures-price-index"
}))]);
export function expectedIndicators(group) { return MACRO_INDICATORS.filter(i => i.release_group === group); }
export function indicatorById(id) { return MACRO_INDICATORS.find((item) => item.id === id) || null; }
export function releaseId(group, period) {
  if (!MACRO_GROUPS.includes(group) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new TypeError("Invalid macro release identity");
  return `US_${group.toUpperCase()}_${period}`;
}
