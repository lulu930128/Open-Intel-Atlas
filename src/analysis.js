const CATEGORY_LABELS = {
  geopolitics: "Geopolitics",
  infrastructure: "Infrastructure",
  finance: "Finance",
  ai: "AI Updates"
};

const SEVERITY_WEIGHT = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function buildDispatch(events, options = {}) {
  const generatedAt = new Date().toISOString();
  const limit = Number.isFinite(options.limit) ? options.limit : 12;
  const sortedEvents = [...events].sort(compareEvents);
  const highlighted = sortedEvents.slice(0, limit);
  const byCategory = summarizeByCategory(events);
  const watchlist = buildWatchlist(events);

  return {
    generated_at: generatedAt,
    horizon: "latest-observed",
    summary: buildSummary(highlighted, byCategory),
    categories: byCategory,
    watchlist,
    highlights: highlighted,
    api_contract: {
      description: "Stable JSON for downstream programs and agent callers.",
      event_fields: [
        "id",
        "category",
        "title",
        "summary",
        "severity",
        "confidence",
        "source",
        "url",
        "observed_at",
        "location",
        "tags"
      ]
    }
  };
}

function compareEvents(a, b) {
  const severityDelta = severityScore(b) - severityScore(a);
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return Date.parse(b.observed_at || 0) - Date.parse(a.observed_at || 0);
}

function summarizeByCategory(events) {
  return Object.keys(CATEGORY_LABELS).map((category) => {
    const categoryEvents = events.filter((event) => event.category === category);
    const highOrAbove = categoryEvents.filter((event) => severityScore(event) >= SEVERITY_WEIGHT.high);

    return {
      id: category,
      label: CATEGORY_LABELS[category],
      count: categoryEvents.length,
      high_or_above: highOrAbove.length,
      latest_observed_at: latestTimestamp(categoryEvents),
      top_sources: topSources(categoryEvents)
    };
  });
}

function buildWatchlist(events) {
  return events
    .filter((event) => severityScore(event) >= SEVERITY_WEIGHT.high)
    .sort(compareEvents)
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      severity: event.severity,
      source: event.source,
      observed_at: event.observed_at,
      reason: event.rationale || "High-priority signal from an observed source."
    }));
}

function buildSummary(highlighted, byCategory) {
  if (highlighted.length === 0) {
    return "No live signals were collected. Check source availability or network access.";
  }

  const activeCategories = byCategory
    .filter((category) => category.count > 0)
    .map((category) => `${category.label}: ${category.count}`)
    .join(", ");
  const lead = highlighted[0];

  return `Latest brief covers ${activeCategories}. Lead signal: ${lead.title} (${lead.source}).`;
}

function latestTimestamp(events) {
  const timestamps = events
    .map((event) => Date.parse(event.observed_at || ""))
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function topSources(events) {
  const counts = new Map();

  for (const event of events) {
    counts.set(event.source, (counts.get(event.source) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([source, count]) => ({ source, count }));
}

function severityScore(event) {
  return SEVERITY_WEIGHT[event.severity] || 0;
}
