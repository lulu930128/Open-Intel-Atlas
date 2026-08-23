import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Open Intel Atlas";
export const APP_VERSION = "1.1.0";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

export function loadConfig(env = process.env) {
  const schedulerEnabled = readBoolean(env.ATLAS_AUTO_COLLECT, true);
  const configuredDbPath = optional(env.ATLAS_DB_PATH);

  return {
    rootDir: ROOT_DIR,
    publicDir: join(ROOT_DIR, "public"),
    dataDir: join(ROOT_DIR, "data"),
    dbPath: configuredDbPath
      ? isAbsolute(configuredDbPath)
        ? configuredDbPath
        : resolve(ROOT_DIR, configuredDbPath)
      : join(ROOT_DIR, "data", "db", "atlas.sqlite"),
    host: String(env.HOST || "127.0.0.1").trim(),
    port: readInteger(env.PORT, 8790, { min: 1, max: 65535 }),
    http: {
      timeoutMs: readInteger(env.HTTP_TIMEOUT_MS, 12000, { min: 1000, max: 60000 }),
      maxResponseBytes: readInteger(env.HTTP_MAX_RESPONSE_BYTES, 5 * 1024 * 1024, {
        min: 64 * 1024,
        max: 32 * 1024 * 1024
      }),
      rawPayloadBytes: readInteger(env.RAW_PAYLOAD_MAX_BYTES, 256 * 1024, {
        min: 4096,
        max: 2 * 1024 * 1024
      }),
      userAgent: String(env.HTTP_USER_AGENT || "OpenIntelAtlas/1.0 local-research").trim()
    },
    collector: {
      schedulerEnabled,
      collectOnStart: schedulerEnabled && readBoolean(env.ATLAS_COLLECT_ON_START, true),
      concurrency: readInteger(env.COLLECTOR_CONCURRENCY, 3, { min: 1, max: 8 }),
      pollMs: readInteger(env.SCHEDULER_POLL_MS, 5000, { min: 1000, max: 60000 }),
      leaseMs: readInteger(env.SCHEDULER_LEASE_MS, 5 * 60 * 1000, { min: 30000, max: 30 * 60 * 1000 }),
      maxBackoffMs: readInteger(env.SCHEDULER_MAX_BACKOFF_MS, 24 * 60 * 60 * 1000, {
        min: 5 * 60 * 1000,
        max: 7 * 24 * 60 * 60 * 1000
      }),
      maxCatchupMs: readInteger(env.SCHEDULER_MAX_CATCHUP_MS, 24 * 60 * 60 * 1000, {
        min: 60 * 60 * 1000,
        max: 7 * 24 * 60 * 60 * 1000
      }),
      jitterRatio: readNumber(env.SCHEDULER_JITTER_RATIO, 0.05, { min: 0, max: 0.25 })
    },
    providers: {
      nvdApiKey: optional(env.NVD_API_KEY),
      cwaApiKey: optional(env.CWA_API_KEY),
      congressApiKey: optional(env.CONGRESS_API_KEY),
      fredApiKey: optional(env.FRED_API_KEY),
      reliefWebAppName: optional(env.RELIEFWEB_APP_NAME),
      secUserAgent: optional(env.SEC_USER_AGENT),
      semanticScholarApiKey: optional(env.SEMANTIC_SCHOLAR_API_KEY)
    },
    sourceFlags: Object.fromEntries(
      Object.entries(env)
        .filter(([key]) => key.startsWith("SOURCE_") && key.endsWith("_ENABLED"))
        .map(([key, value]) => [key, readBoolean(value, true)])
    )
  };
}

function optional(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readInteger(value, fallback, bounds) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(bounds.min, Math.min(bounds.max, number));
}

function readNumber(value, fallback, bounds) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(bounds.min, Math.min(bounds.max, number));
}
