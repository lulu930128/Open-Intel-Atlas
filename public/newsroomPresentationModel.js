export const PRESENTATION_DEFINITIONS = Object.freeze({
  global: Object.freeze({ label: "全球", description: "依全域品質、時效與查證狀態選出摘要。" }),
  east_asia: Object.freeze({ label: "東亞", description: "只顯示具備台灣、日本或東亞關聯證據的合格事件。" }),
  taiwan_focus: Object.freeze({ label: "台灣", description: "只顯示具備台灣關聯證據的合格事件。" }),
  japan_focus: Object.freeze({ label: "日本", description: "只顯示具備日本關聯證據的合格事件。" })
});

export const PRESENTATION_VALUES = Object.freeze(Object.keys(PRESENTATION_DEFINITIONS));

export function normalizePresentation(value) {
  const presentation = String(value || "global").trim().toLowerCase();
  return PRESENTATION_VALUES.includes(presentation) ? presentation : "global";
}

export function presentationFromSearch(search) {
  return normalizePresentation(new URLSearchParams(String(search || "")).get("presentation"));
}

export function buildBriefPath(presentation, limit = 12) {
  const boundedLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit), 10) || 12));
  const params = new URLSearchParams({
    presentation: normalizePresentation(presentation),
    limit: String(boundedLimit)
  });
  return `/api/v1/brief?${params.toString()}`;
}

export function briefHighlights(envelope) {
  return Array.isArray(envelope?.data?.highlights) ? envelope.data.highlights : [];
}

export function coverageGapMessages(selection, presentation) {
  const definition = PRESENTATION_DEFINITIONS[normalizePresentation(presentation)];
  const gaps = Array.isArray(selection?.coverage_gaps) ? selection.coverage_gaps : [];
  return gaps.map((gap) => {
    if (gap === "no_qualified_regional_events") {
      return `${definition.label}視角目前沒有通過品質、時效與關聯門檻的事件。`;
    }
    if (gap === "qualified_event_shortfall") {
      return "合格事件少於摘要要求數量；Atlas 沒有用其他地區或低品質內容補滿。";
    }
    return "後端回報一項尚未識別的摘要覆蓋缺口。";
  });
}
