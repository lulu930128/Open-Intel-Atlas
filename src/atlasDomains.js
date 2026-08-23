export const DOMAIN_DEFINITIONS = Object.freeze([
  {
    id: "politics",
    label_zh_hant: "政治",
    label_en: "Politics",
    description: "政策、選舉、外交、衝突、制裁與地緣政治。",
    active: true
  },
  {
    id: "technology",
    label_zh_hant: "科技發展",
    label_en: "Technology",
    description: "AI、軟硬體、研究、資安、太空與重大技術進展。",
    active: true
  },
  {
    id: "finance",
    label_zh_hant: "金融",
    label_en: "Finance",
    description: "總體經濟、公司、產業與市場情境；不取代行情或交易系統。",
    active: true
  },
  {
    id: "hazards",
    label_zh_hant: "氣象與重大天災",
    label_en: "Weather and Hazards",
    description: "官方警報、地震、風暴、洪水、野火、火山與重大災害。",
    active: true
  }
]);

export const DOMAIN_IDS = new Set(DOMAIN_DEFINITIONS.map((domain) => domain.id));

export function isDomain(value) {
  return DOMAIN_IDS.has(value);
}
