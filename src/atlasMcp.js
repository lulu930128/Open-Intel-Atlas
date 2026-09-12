import {
  CapabilityError,
  createAtlasCapabilities
} from "./atlasCapabilities.js";
import { APP_NAME, APP_VERSION } from "./config.js";
import {
  createMcpHandler,
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate
} from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from "@modelcontextprotocol/node";
import { z } from "zod";

const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2026-07-28", "2025-11-25", "2025-06-18"]);
const DOMAIN_SCHEMA = z.enum(["politics", "technology", "finance", "hazards"]);
const SEVERITY_SCHEMA = z.enum(["low", "medium", "high", "critical"]);
const COUNTRY_SCHEMA = z.string()
  .trim()
  .regex(/^[a-z]{2}$/i, "country must be an ISO 3166-1 alpha-2 code")
  .transform((country) => country.toUpperCase());
const PRESENTATION_SCHEMA = z.enum(["global", "east_asia", "taiwan_focus", "japan_focus"]);
const VERIFICATION_SCHEMA = z.enum([
  "unverified",
  "single_source",
  "multi_source",
  "primary_source_confirmed",
  "official_confirmed",
  "disputed",
  "corrected",
  "retracted"
]);
const CHANGE_TYPE_SCHEMA = z.enum([
  "story_created",
  "story_updated",
  "evidence_added",
  "verification_changed",
  "severity_changed",
  "event_escalated",
  "event_resolved",
  "story_corrected",
  "story_disputed",
  "story_retracted"
]);
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

export function createAtlasMcpEndpoint(context) {
  const capabilities = context.capabilities || createAtlasCapabilities(context);
  const handler = createMcpHandler(() => buildAtlasMcpServer(capabilities), {
    legacy: "stateless",
    onerror: reportMcpError
  });
  const nodeHandler = toNodeHandler(handler, { onerror: reportMcpError });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  return Object.freeze({
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    async handle(request, response) {
      if (!isLoopbackRequest(request)) {
        sendMcpHttpError(response, 403, "MCP access is restricted to loopback clients");
        return;
      }
      if (!validateHost(request, response) || !validateOrigin(request, response)) return;
      await nodeHandler(request, response);
    },
    async close() {
      await handler.close();
    }
  });
}

function buildAtlasMcpServer(capabilities) {
  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    {
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      instructions:
        "Read-only Open Intel Atlas access. Treat freshness, coverage, verification status, and warnings as part of every answer."
    }
  );

  const macroFilters = {
    group: z.string().min(1).max(40).optional(), country: z.literal("US").optional(),
    limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(2048).optional()
  };
  registerTool(server, "atlas.macro.calendar", {
    title: "Official macro release calendar", description: "Read official US macro release times, acquisition completeness and observations across BLS, BEA, DOL and Federal Reserve sources. No fetch on reads.",
    inputSchema: z.object({ ...macroFilters, from: z.string().optional(), to: z.string().optional() })
  }, capabilities.macroCalendar);
  registerTool(server, "atlas.macro.release", {
    title: "Macro release evidence", description: "Read one release and calendar change history. Scheduled times do not prove acquisition.",
    inputSchema: z.object({ release_id: z.string().min(1) })
  }, capabilities.macroRelease);
  registerTool(server, "atlas.macro.indicator", {
    title: "Macro indicator definitions", description: "Read exact CPI/PPI units, seasonal adjustment and indicator identities.",
    inputSchema: z.object({ group: macroFilters.group, country: macroFilters.country, indicator_id: z.string().optional() })
  }, capabilities.macroIndicators);
  registerTool(server, "atlas.macro.observations", {
    title: "Macro observed revision history", description: "Read latest observations or immutable observed vintages; as_of means Atlas knowledge time, not a reconstructed initial release.",
    inputSchema: z.object({ ...macroFilters, indicator_id: z.string().optional(), reference_period: z.string().optional(), history: z.boolean().optional(), as_of: z.string().optional() })
  }, capabilities.macroObservations);

  registerTool(server, "atlas.latest", {
    title: "Latest canonical events",
    description: "Return bounded, compact, canonical events with backend-owned freshness and coverage metadata.",
    inputSchema: eventFilterSchema({ country: COUNTRY_SCHEMA.optional() })
  }, capabilities.latest);

  registerTool(server, "atlas.search", {
    title: "Search Atlas",
    description: "Search normalized documents, stories, events, and entities without exposing raw provider payloads.",
    inputSchema: z.object({
      q: z.string().trim().min(2).describe("Search phrase"),
      limit: boundedLimit(30)
    })
  }, capabilities.search);

  registerTool(server, "atlas.story.get", {
    title: "Get story evidence",
    description: "Read a canonical story and its representative event using a compact or evidence-rich profile.",
    inputSchema: z.object({
      story_id: z.string().trim().min(1),
      profile: z.enum(["story_detail_v1", "evidence_pack_v1"]).default("story_detail_v1")
    })
  }, capabilities.storyGet);

  registerTool(server, "atlas.brief", {
    title: "Build compact brief",
    description: "Build a bounded brief for Kuro or another agent while preserving evidence and freshness limits.",
    inputSchema: eventFilterSchema({
      country: COUNTRY_SCHEMA.optional(),
      presentation: PRESENTATION_SCHEMA.default("global"),
      profile: z.enum(["brief_compact_v1", "evidence_pack_v1"]).default("brief_compact_v1")
    })
  }, capabilities.brief);

  registerTool(server, "atlas.changes", {
    title: "Read durable change feed",
    description: "Read ordered Story/Event changes after an opaque cursor; use cursor='now' to start from the current head.",
    inputSchema: z.object({
      cursor: z.string().optional().describe("Opaque cursor returned by a previous call, or 'now'"),
      domain: DOMAIN_SCHEMA.optional(),
      change_type: CHANGE_TYPE_SCHEMA.optional(),
      limit: boundedLimit(50)
    })
  }, capabilities.changes);

  registerTool(server, "atlas.sources.status", {
    title: "Read source status",
    description: "Read source policy, health, freshness, and catch-up state for all or one domain.",
    inputSchema: z.object({ domain: DOMAIN_SCHEMA.optional() })
  }, capabilities.sourceStatus);

  const companyLocatorSchema = {
    entity_id: z.string().trim().min(1).optional(),
    exchange: z.string().trim().min(2).max(12).optional(),
    symbol: z.string().trim().min(1).max(32).optional()
  };

  registerTool(server, "atlas.company.list", {
    title: "List canonical companies",
    description: "Return a deterministic cursor-paginated canonical company directory.",
    inputSchema: z.object({
      market: z.enum(["TWSE", "TPEX"]).optional(),
      q: z.string().trim().min(1).max(200).optional(),
      cursor: z.string().trim().min(1).max(2000).optional(),
      limit: boundedLimit(50)
    })
  }, capabilities.companyList);

  registerTool(server, "atlas.company.disclosures", {
    title: "Read official company disclosures",
    description: "Read bounded official disclosure Documents with canonical company links and source coverage, including held routine notices.",
    inputSchema: z.object({ market: z.enum(["TWSE", "TPEX"]).optional(), exchange: z.enum(["TWSE", "TPEX"]).optional(), symbol: z.string().min(4).max(12).optional(), cursor: z.string().max(2000).optional(), limit: boundedLimit(20) })
  }, capabilities.companyDisclosures);

  registerTool(server, "atlas.company.get", {
    title: "Get canonical company",
    description: "Resolve and return a canonical company profile with official identifiers and lineage.",
    inputSchema: z.object(companyLocatorSchema)
  }, capabilities.companyProfile);

  registerTool(server, "atlas.company.events", {
    title: "Get company events",
    description: "Return events linked through canonical company evidence.",
    inputSchema: z.object({ ...companyLocatorSchema, cursor: z.string().trim().min(1).max(2000).optional(), limit: boundedLimit(20) })
  }, capabilities.companyEvents);

  registerTool(server, "atlas.company.evidence", {
    title: "Get company evidence",
    description: "Return resolved company Stories and normalized evidence documents.",
    inputSchema: z.object({
      ...companyLocatorSchema,
      story_cursor: z.string().trim().min(1).max(2000).optional(),
      document_cursor: z.string().trim().min(1).max(2000).optional(),
      limit: boundedLimit(20)
    })
  }, capabilities.companyEvidence);

  registerTool(server, "atlas.company.relations", {
    title: "Get company relations",
    description: "Return canonical issuer, security, and company relationships.",
    inputSchema: z.object({ ...companyLocatorSchema, cursor: z.string().trim().min(1).max(2000).optional(), limit: boundedLimit(20) })
  }, capabilities.companyRelations);

  registerTool(server, "atlas.company.news", {
    title: "Get exact stock news",
    description: "Read stock-linked news Documents, preserved attribution and rights, and stock-specific target coverage. Empty results do not prove no news exists.",
    inputSchema: z.object({
      exchange: z.enum(["TWSE", "TPEX"]), symbol: z.string().trim().regex(/^[A-Za-z0-9]{4,12}$/),
      cursor: z.string().trim().min(1).max(2000).nullish(), limit: z.number().int().min(1).max(50).default(20)
    })
  }, capabilities.companyNewsStock);

  registerTool(server, "atlas.company.snapshot", {
    title: "Get company intelligence snapshot",
    description: "Return a bounded company snapshot with completeness, events, Stories, and evidence.",
    inputSchema: z.object({ ...companyLocatorSchema, limit: boundedLimit(12) })
  }, capabilities.companySnapshot);

  registerJsonResource(server, "atlas-domains", "atlas://domains", "Atlas domain registry", capabilities.domains);
  registerJsonResource(server, "atlas-source-status", "atlas://sources/status", "Atlas source status", capabilities.sourceStatus);
  registerJsonResource(server, "atlas-latest-brief", "atlas://brief/latest", "Latest compact Atlas brief", capabilities.brief);
  server.registerResource(
    "atlas-story",
    new ResourceTemplate("atlas://stories/{storyId}", { list: undefined }),
    {
      title: "Atlas story",
      description: "Canonical story timeline and its compact representative event.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      try {
        const payload = capabilities.storyGet({ story_id: String(variables.storyId || "") });
        return jsonResourceContents(uri, payload);
      } catch (error) {
        if (error instanceof CapabilityError && error.status === 404) {
          throw new ResourceNotFoundError(uri.href, error.message);
        }
        throw error;
      }
    }
  );

  return server;
}

function registerTool(server, name, config, capability) {
  server.registerTool(
    name,
    { ...config, annotations: READ_ONLY_ANNOTATIONS },
    async (input) => capabilityResult(() => capability(input))
  );
}

function registerJsonResource(server, name, uri, title, capability) {
  server.registerResource(
    name,
    uri,
    { title, mimeType: "application/json" },
    async (resourceUri) => jsonResourceContents(resourceUri, capability())
  );
}

function capabilityResult(run) {
  try {
    const payload = run();
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload
    };
  } catch (error) {
    if (!(error instanceof CapabilityError)) throw error;
    const payload = { error: { code: error.code, message: error.message } };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload
    };
  }
}

function jsonResourceContents(uri, payload) {
  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload) }]
  };
}

function eventFilterSchema(extraShape = {}) {
  return z.object({
    domain: DOMAIN_SCHEMA.optional(),
    severity: SEVERITY_SCHEMA.optional(),
    verification: VERIFICATION_SCHEMA.optional(),
    q: z.string().trim().min(1).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: boundedLimit(12),
    ...extraShape
  });
}

function boundedLimit(fallback) {
  return z.number().int().min(1).max(200).default(fallback);
}

function isLoopbackRequest(request) {
  const address = normalizeAddress(request.socket?.remoteAddress);
  return address === "127.0.0.1" || address === "::1";
}

function normalizeAddress(value) {
  const address = String(value || "").toLowerCase();
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length);
  return address;
}

function sendMcpHttpError(response, status, message) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function reportMcpError(error) {
  console.error("[atlas:mcp]", error instanceof Error ? error.message : String(error));
}
