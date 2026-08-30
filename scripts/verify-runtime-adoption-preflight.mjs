import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  databaseFamilyIdentity,
  evaluateRuntimePreflight,
  identitiesEqual,
  parseTrayOwnership
} from "./lib/runtime-adoption-preflight.mjs";

const options = parseArguments(process.argv.slice(2));
const databasePath = resolve(options.databasePath);
const trayLogPath = resolve(options.trayLogPath);
if (!existsSync(databasePath)) fail(`Atlas database does not exist: ${databasePath}`);
if (!existsSync(trayLogPath)) fail(`Atlas tray log does not exist: ${trayLogPath}`);
const observedFrom = new Date().toISOString();
const identityBefore = databaseFamilyIdentity(databasePath);
const ownership = parseTrayOwnership(readFileSync(trayLogPath, "utf8"));
const processState = {
  tray_alive: processAlive(ownership.tray?.pid),
  backend_alive: processAlive(ownership.backend?.pid)
};
const listenerBefore = await probeTcp(options.host, options.port);
const healthBefore = await probeHealth(options.host, options.port);
const databaseBefore = readDatabaseState(databasePath);

await delay(options.observeMs);

const identityAfter = databaseFamilyIdentity(databasePath);
const listenerAfter = await probeTcp(options.host, options.port);
const healthAfter = await probeHealth(options.host, options.port);
const databaseAfter = readDatabaseState(databasePath);
const latestSchedulerStartedAt = databaseAfter.latest_scheduler_run?.started_at || null;
const schedulerRunDuringObservation = Boolean(
  latestSchedulerStartedAt && Date.parse(latestSchedulerStartedAt) >= Date.parse(observedFrom)
);
const evaluation = evaluateRuntimePreflight({
  listenerOpen: listenerBefore.open || listenerAfter.open,
  healthOk: healthBefore.ok || healthAfter.ok,
  ownership,
  backendProcessAlive: processState.backend_alive,
  databaseIdentityChanged: !identitiesEqual(identityBefore, identityAfter),
  schedulerRunDuringObservation
});

const output = {
  status: evaluation.safeForBackup ? "passed" : "failed",
  mode: "read-only-runtime-adoption-preflight",
  checked_at: new Date().toISOString(),
  observation: {
    from: observedFrom,
    duration_ms: options.observeMs
  },
  runtime: {
    host: options.host,
    port: options.port,
    ownership,
    process_state: processState,
    listener_before: listenerBefore,
    listener_after: listenerAfter,
    health_before: healthBefore,
    health_after: healthAfter
  },
  database: {
    path: databasePath,
    identity_before: identityBefore,
    identity_after: identityAfter,
    state_before: databaseBefore,
    state_after: databaseAfter,
    scheduler_run_during_observation: schedulerRunDuringObservation
  },
  safe_for_backup: evaluation.safeForBackup,
  errors: evaluation.errors
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!evaluation.safeForBackup) process.exitCode = 1;

function readDatabaseState(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    return {
      schema_version: Number(database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version),
      source_count: Number(database.prepare("SELECT COUNT(*) AS count FROM sources").get().count),
      source_run_count: Number(database.prepare("SELECT COUNT(*) AS count FROM source_runs").get().count),
      latest_scheduler_run: database.prepare(`
        SELECT source_id, started_at, finished_at, status, scheduler_owner
        FROM source_runs
        WHERE trigger_kind = 'scheduler'
        ORDER BY started_at DESC
        LIMIT 1
      `).get() || null
    };
  } finally {
    database.close();
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM" ? true : false;
  }
}

async function probeTcp(host, port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (open, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe({ open, error });
    };
    socket.setTimeout(750, () => finish(false, "timeout"));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(false, error.code || error.message));
  });
}

async function probeHealth(host, port) {
  const url = `http://${host}:${port}/api/v1/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    return {
      ok: response.ok && body?.ok === true,
      status: response.status,
      version: body?.version || null,
      schema_version: body?.storage?.schema_version ?? null,
      contract_version: body?.contract_version || null,
      error: null
    };
  } catch (error) {
    return { ok: false, status: null, version: null, schema_version: null, contract_version: null, error: error?.cause?.code || error?.code || error?.message || "request_failed" };
  }
}

function parseArguments(args) {
  const options = {
    databasePath: "data/db/atlas.sqlite",
    trayLogPath: "data/logs/atlas-tray.log",
    host: "127.0.0.1",
    port: 8790,
    observeMs: 10_000
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--source-db") options.databasePath = required(value, args[index]);
    else if (args[index] === "--tray-log") options.trayLogPath = required(value, args[index]);
    else if (args[index] === "--host") options.host = required(value, args[index]);
    else if (args[index] === "--port") options.port = boundedInteger(value, args[index], 1, 65535);
    else if (args[index] === "--observe-ms") options.observeMs = boundedInteger(value, args[index], 1000, 60_000);
    else fail(`Unknown argument: ${args[index]}`);
    index += 1;
  }
  return options;
}

function required(value, flag) {
  if (!value) fail(`${flag} requires a value`);
  return value;
}

function boundedInteger(value, flag, minimum, maximum) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    fail(`${flag} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
