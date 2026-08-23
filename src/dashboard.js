const CATEGORY_LABELS = {
  geopolitics: "International Situation",
  infrastructure: "Infrastructure Risk",
  finance: "Financial Radar",
  ai: "Technology Watch"
};

const SEVERITY_WEIGHT = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const TOPIC_DEFINITIONS = [
  {
    id: "ai-supply-chain",
    label: "AI Supply Chain",
    category: "ai",
    keywords: ["ai", "gpu", "hbm", "nvidia", "nvda", "semiconductor", "chip", "inference", "model", "agent"]
  },
  {
    id: "cyber-exploitation",
    label: "Cyber Exploitation",
    category: "infrastructure",
    keywords: ["cve", "cisa", "nvd", "kev", "vulnerability", "exploit", "ransomware", "patch", "cyber"]
  },
  {
    id: "geopolitical-pressure",
    label: "Geopolitical Pressure",
    category: "geopolitics",
    keywords: ["war", "missile", "attack", "sanction", "military", "iran", "ukraine", "russia", "china", "red sea"]
  },
  {
    id: "market-stress",
    label: "Market Stress",
    category: "finance",
    keywords: ["market", "fx", "usd", "bitcoin", "ethereum", "crypto", "rate", "oil", "liquidity"]
  },
  {
    id: "natural-hazards",
    label: "Natural Hazards",
    category: "infrastructure",
    keywords: ["earthquake", "wildfire", "storm", "volcano", "flood", "eonet", "usgs", "nasa"]
  },
  {
    id: "research-frontier",
    label: "Research Frontier",
    category: "ai",
    keywords: ["arxiv", "research", "benchmark", "reasoning", "alignment", "llm", "vision", "language"]
  }
];

export function buildDashboardSnapshot(events, sources, options = {}) {
  const generatedAt = new Date().toISOString();
  const normalizedEvents = [...events].sort(compareEventPriority);
  const topics = buildTopics(normalizedEvents);
  const stories = buildStories(normalizedEvents, topics);

  return {
    generated_at: generatedAt,
    horizon: options.filters?.date ? "selected-date" : options.filters?.range || "live",
    degraded: Boolean(options.degraded),
    filters: options.filters || {},
    coverage: buildCoverage(normalizedEvents, sources),
    summary: buildDashboardSummary(stories, topics, normalizedEvents),
    brief_cards: buildBriefCards(stories, topics),
    top_signals: normalizedEvents.slice(0, 8).map(eventToSignal),
    watchlist_impacts: buildWatchlistImpacts(normalizedEvents),
    sector_heat: topics.slice(0, 8).map(topicToHeat),
    mini_map_points: buildMiniMapPoints(normalizedEvents),
    data_status: buildDataStatus(sources),
    evidence_feed: buildEvidenceFeed(normalizedEvents, stories),
    stories,
    topics,
    api_contract: {
      description: "Aggregated dashboard payload for compact intelligence UI and downstream AI callers.",
      fields: [
        "brief_cards",
        "top_signals",
        "watchlist_impacts",
        "sector_heat",
        "mini_map_points",
        "data_status",
        "evidence_feed",
        "stories",
        "topics"
      ]
    }
  };
}

function buildTopics(events) {
  const topics = TOPIC_DEFINITIONS.map((definition) => {
    const matchedEvents = events.filter((event) => matchesTopic(event, definition));
    const highCount = matchedEvents.filter((event) => severityScore(event) >= SEVERITY_WEIGHT.high).length;
    const score = Math.round(matchedEvents.reduce((total, event) => total + eventScore(event), 0));
    const trend = trendFromEvents(matchedEvents);

    return {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      score,
      event_count: matchedEvents.length,
      high_or_above: highCount,
      direction: trend.direction,
      velocity: trend.velocity,
      latest_observed_at: latestTimestamp(matchedEvents),
      top_sources: topSources(matchedEvents),
      evidence_event_ids: matchedEvents.slice(0, 6).map((event) => event.id)
    };
  });

  return topics
    .filter((topic) => topic.event_count > 0)
    .sort((a, b) => b.score - a.score || b.event_count - a.event_count);
}

function buildStories(events, topics) {
  const stories = [];

  for (const topic of topics) {
    const topicEvents = events.filter((event) => topic.evidence_event_ids.includes(event.id)).sort(compareEventPriority);

    if (topicEvents.length === 0) {
      continue;
    }

    const lead = topicEvents[0];
    const highCount = topicEvents.filter((event) => severityScore(event) >= SEVERITY_WEIGHT.high).length;
    const sourceNames = topSources(topicEvents).map((source) => source.source).join(", ");

    stories.push({
      id: stableId("story", `${topic.id}:${lead.id}`),
      topic_id: topic.id,
      topic: topic.label,
      category: lead.category || topic.category,
      title: storyTitle(topic, lead),
      summary: `${topic.label} has ${topic.event_count} related signal${topic.event_count === 1 ? "" : "s"} from ${sourceNames || "observed sources"}. Lead: ${lead.title}.`,
      severity: highCount > 0 ? "high" : lead.severity || "medium",
      score: topic.score,
      confidence: averageConfidence(topicEvents),
      direction: topic.direction,
      velocity: topic.velocity,
      event_count: topic.event_count,
      high_or_above: highCount,
      latest_observed_at: topic.latest_observed_at,
      evidence: topicEvents.slice(0, 5).map(eventToEvidence)
    });
  }

  return stories.sort((a, b) => b.score - a.score || Date.parse(b.latest_observed_at || 0) - Date.parse(a.latest_observed_at || 0));
}

function buildBriefCards(stories, topics) {
  const cards = stories.slice(0, 3).map((story, index) => ({
    id: story.id,
    rank: index + 1,
    title: story.title,
    label: story.topic,
    summary: summarizeText(story.summary, 150),
    trend: {
      direction: story.direction,
      velocity: story.velocity,
      label: trendLabel(story.direction)
    },
    confidence: story.confidence,
    score: story.score,
    category: story.category,
    severity: story.severity,
    evidence_count: story.evidence.length
  }));

  if (cards.length > 0) {
    return cards;
  }

  return topics.slice(0, 3).map((topic, index) => ({
    id: topic.id,
    rank: index + 1,
    title: topic.label,
    label: CATEGORY_LABELS[topic.category] || topic.category,
    summary: `${topic.event_count} observed signals in this topic.`,
    trend: {
      direction: topic.direction,
      velocity: topic.velocity,
      label: trendLabel(topic.direction)
    },
    confidence: 0.5,
    score: topic.score,
    category: topic.category,
    severity: topic.high_or_above > 0 ? "high" : "medium",
    evidence_count: topic.evidence_event_ids.length
  }));
}

function buildWatchlistImpacts(events) {
  const groups = new Map();

  for (const event of events) {
    const key = watchTarget(event);
    const group = groups.get(key) || { target: key, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = group.events.sort(compareEventPriority);
      const lead = sorted[0];
      const score = Math.round(sorted.reduce((total, event) => total + eventScore(event), 0));

      return {
        id: stableId("impact", group.target),
        target: group.target,
        score,
        direction: trendFromEvents(sorted).direction,
        severity: lead?.severity || "low",
        category: lead?.category || "geopolitics",
        latest_observed_at: latestTimestamp(sorted),
        impact: impactText(group.target, lead),
        evidence_count: sorted.length,
        evidence_event_ids: sorted.slice(0, 4).map((event) => event.id)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function buildMiniMapPoints(events) {
  return events
    .filter((event) => Number.isFinite(Number(event.location?.lat)) && Number.isFinite(Number(event.location?.lon)))
    .sort(compareEventPriority)
    .slice(0, 30)
    .map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      severity: event.severity,
      score: Math.round(eventScore(event)),
      source: event.source,
      observed_at: event.observed_at,
      location: event.location
    }));
}

function buildDataStatus(sources) {
  const total = sources.length;
  const online = sources.filter((source) => source.ok === true).length;
  const degraded = sources.filter((source) => source.ok !== true);

  return {
    total_sources: total,
    online_sources: online,
    degraded_sources: degraded.length,
    status: degraded.length > 0 ? "partial" : "online",
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      category: source.category,
      ok: source.ok,
      count: Number(source.count || 0),
      checked_at: source.checked_at || null,
      last_success_at: source.last_success_at || null,
      error: source.error || null
    }))
  };
}

function buildEvidenceFeed(events, stories) {
  const storyByEventId = new Map();

  for (const story of stories) {
    for (const evidence of story.evidence) {
      storyByEventId.set(evidence.event_id, story.id);
    }
  }

  return events
    .slice(0, 18)
    .map((event) => ({
      event_id: event.id,
      story_id: storyByEventId.get(event.id) || null,
      source: event.source,
      type: event.category,
      title: event.title,
      summary: summarizeText(event.summary, 180),
      severity: event.severity,
      confidence: Number(event.confidence || 0),
      observed_at: event.observed_at,
      url: event.url || null
    }));
}

function buildCoverage(events, sources) {
  return {
    event_count: events.length,
    source_count: sources.length,
    active_source_count: sources.filter((source) => source.ok === true && Number(source.count || 0) > 0).length,
    category_counts: Object.entries(CATEGORY_LABELS).map(([category, label]) => ({
      category,
      label,
      count: events.filter((event) => event.category === category).length
    }))
  };
}

function buildDashboardSummary(stories, topics, events) {
  if (events.length === 0) {
    return "No signals are available for this dashboard window.";
  }

  const leadStory = stories[0];
  const leadTopic = topics[0];

  if (leadStory) {
    return `${leadStory.title}. ${leadStory.event_count} related signals are grouped under ${leadStory.topic}.`;
  }

  if (leadTopic) {
    return `${leadTopic.label} leads this window with ${leadTopic.event_count} observed signals.`;
  }

  return `${events.length} signals are available, but no dominant topic cluster was detected.`;
}

function eventToSignal(event, index) {
  return {
    id: event.id,
    rank: index + 1,
    title: event.title,
    summary: summarizeText(event.summary, 160),
    category: event.category,
    severity: event.severity,
    confidence: Number(event.confidence || 0),
    score: Math.round(eventScore(event)),
    source: event.source,
    observed_at: event.observed_at,
    tags: event.tags || [],
    location: event.location || null,
    url: event.url || null
  };
}

function eventToEvidence(event) {
  return {
    event_id: event.id,
    title: event.title,
    source: event.source,
    observed_at: event.observed_at,
    url: event.url || null,
    summary: summarizeText(event.summary, 140)
  };
}

function topicToHeat(topic) {
  return {
    id: topic.id,
    label: topic.label,
    category: topic.category,
    score: topic.score,
    heat: Math.min(100, Math.round(topic.score)),
    level: heatLevel(topic.score),
    direction: topic.direction,
    velocity: topic.velocity,
    event_count: topic.event_count,
    high_or_above: topic.high_or_above
  };
}

function matchesTopic(event, definition) {
  const text = eventText(event);

  if (event.category === definition.category) {
    return definition.keywords.some((keyword) => keywordMatches(text, keyword));
  }

  return definition.keywords.some((keyword) => keywordMatches(text, keyword));
}

function eventText(event) {
  return `${event.title || ""} ${event.summary || ""} ${event.source || ""} ${(event.tags || []).join(" ")} ${event.location?.label || ""}`.toLowerCase();
}

function keywordMatches(text, keyword) {
  const value = String(keyword || "").toLowerCase();

  if (value.length <= 3 && /^[a-z0-9]+$/.test(value)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(value)}([^a-z0-9]|$)`).test(text);
  }

  return text.includes(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareEventPriority(a, b) {
  const scoreDelta = eventScore(b) - eventScore(a);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return Date.parse(b.observed_at || 0) - Date.parse(a.observed_at || 0);
}

function eventScore(event) {
  const severity = severityScore(event) * 18;
  const confidence = Number(event.confidence || 0) * 24;
  const recency = recencyScore(event.observed_at) * 10;
  return severity + confidence + recency;
}

function severityScore(event) {
  return SEVERITY_WEIGHT[event.severity] || 0;
}

function recencyScore(value) {
  const timestamp = Date.parse(value || "");

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
  return Math.max(0, 1 - ageHours / (7 * 24));
}

function trendFromEvents(events) {
  if (events.length === 0) {
    return { direction: "flat", velocity: 0 };
  }

  const now = Date.now();
  const recent = events.filter((event) => now - Date.parse(event.observed_at || 0) <= 24 * 60 * 60 * 1000).length;
  const baseline = Math.max(1, events.length - recent);
  const velocity = Number((recent / baseline).toFixed(2));

  if (recent >= baseline * 1.25) {
    return { direction: "up", velocity };
  }

  if (recent * 1.25 < baseline) {
    return { direction: "down", velocity };
  }

  return { direction: "flat", velocity };
}

function trendLabel(direction) {
  switch (direction) {
    case "up":
      return "rising";
    case "down":
      return "cooling";
    default:
      return "steady";
  }
}

function heatLevel(score) {
  if (score >= 240) {
    return "high";
  }

  if (score >= 120) {
    return "medium";
  }

  return "low";
}

function storyTitle(topic, lead) {
  const prefix = CATEGORY_LABELS[topic.category] || topic.label;
  return `${prefix}: ${lead.title}`;
}

function watchTarget(event) {
  const text = eventText(event);
  const tags = event.tags || [];

  if (text.includes("nvidia") || text.includes("nvda") || tags.includes("nvidia")) {
    return "NVDA / AI compute";
  }

  if (text.includes("cve") || text.includes("cisa") || text.includes("nvd")) {
    return "Cyber infrastructure";
  }

  if (text.includes("bitcoin") || text.includes("ethereum") || text.includes("crypto")) {
    return "Crypto liquidity";
  }

  if (text.includes("fx") || text.includes("usd")) {
    return "USD / FX";
  }

  if (text.includes("oil") || text.includes("energy")) {
    return "Energy risk";
  }

  if (event.category === "ai") {
    return "AI research";
  }

  if (event.category === "geopolitics") {
    return event.location?.label || "Global geopolitics";
  }

  return event.location?.label || CATEGORY_LABELS[event.category] || event.category || "Observed signal";
}

function impactText(target, lead) {
  if (!lead) {
    return `${target} has no current lead signal.`;
  }

  return `${target} is affected by ${lead.severity} signal: ${summarizeText(lead.title, 90)}`;
}

function averageConfidence(events) {
  if (events.length === 0) {
    return 0;
  }

  const total = events.reduce((sum, event) => sum + Number(event.confidence || 0), 0);
  return Number((total / events.length).toFixed(2));
}

function latestTimestamp(events) {
  const timestamps = events.map((event) => Date.parse(event.observed_at || "")).filter((timestamp) => Number.isFinite(timestamp));

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
    .slice(0, 4)
    .map(([source, count]) => ({ source, count }));
}

function stableId(prefix, value) {
  const input = String(value || "unknown");
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function summarizeText(value, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1).trim()}...`;
}
