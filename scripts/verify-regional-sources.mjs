import { createHttpClient } from "../src/atlasHttp.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { loadConfig } from "../src/config.js";

const options = parseArguments(process.argv.slice(2));

if (!options.sourceId || !options.noWrite) {
  fail("Usage: node scripts/verify-regional-sources.mjs --source <id> --no-write [--sample 3]");
}

const config = loadConfig({ ...process.env, ATLAS_AUTO_COLLECT: "false" });
const registry = buildSourceRegistry(config);
const source = registry.get(options.sourceId);

if (!source) {
  fail(`Unknown source: ${options.sourceId}`);
}

const http = createHttpClient(config.http);
const startedAt = Date.now();

try {
  const result = await source.run({
    source,
    http,
    config,
    catchup: null,
    now: () => new Date().toISOString()
  });
  const documents = Array.isArray(result.documents) ? result.documents : [];
  process.stdout.write(`${JSON.stringify({
    mode: "no-write",
    source: {
      id: source.id,
      enabled_by_config: source.enabled,
      disabled_reason: source.disabledReason,
      provider_type: source.providerType,
      authority_class: source.authorityClass,
      countries: source.countries,
      cadence_ms: source.cadenceMs,
      timeout_ms: source.timeoutMs
    },
    result: {
      status: result.status,
      duration_ms: Date.now() - startedAt,
      fetch_count: result.fetches?.length || 0,
      document_count: documents.length,
      fetches: (result.fetches || []).map((fetch) => ({
        request_url: fetch.request_url,
        http_status: fetch.http_status,
        content_type: fetch.content_type,
        payload_truncated: Boolean(fetch.payload_truncated)
      })),
      sample_documents: documents.slice(0, options.sample).map((document) => ({
        id: document.id,
        title: document.title,
        canonical_url: document.canonical_url,
        published_at: document.published_at,
        observed_at: document.observed_at,
        event_eligible: document.raw_metadata?.event_eligible === true,
        event_key: document.raw_metadata?.event_key || null,
        location: document.raw_metadata?.location || null
      }))
    }
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    mode: "no-write",
    source_id: source.id,
    status: "failed",
    duration_ms: Date.now() - startedAt,
    error_type: error?.name || "Error",
    error_message: String(error?.message || error),
    http_status: error?.status ?? null
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { sourceId: null, noWrite: false, sample: 3 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--source") {
      result.sourceId = args[index + 1] || null;
      index += 1;
    } else if (argument === "--no-write") {
      result.noWrite = true;
    } else if (argument === "--sample") {
      const sample = Number.parseInt(args[index + 1] || "", 10);
      if (!Number.isInteger(sample) || sample < 0 || sample > 20) fail("--sample must be an integer from 0 to 20");
      result.sample = sample;
      index += 1;
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
