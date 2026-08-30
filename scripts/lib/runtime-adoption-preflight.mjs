import { existsSync, statSync } from "node:fs";

export function databaseFamilyIdentity(databasePath) {
  return Object.fromEntries(
    [
      ["database", databasePath],
      ["wal", `${databasePath}-wal`],
      ["shm", `${databasePath}-shm`],
      ["journal", `${databasePath}-journal`]
    ].map(([label, path]) => [label, fileIdentity(path)])
  );
}

export function parseTrayOwnership(logText) {
  const lines = String(logText || "").split(/\r?\n/);
  let tray = null;
  let backend = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trayStart = line.match(/Tray starting\. launcher_pid=(\d+)/);
    if (trayStart) {
      tray = { pid: Number(trayStart[1]), line: index + 1, started_line: line };
      backend = null;
      continue;
    }

    const backendStart = line.match(/Backend process started\. owner_pid=(\d+)/);
    if (backendStart && tray) {
      backend = {
        pid: Number(backendStart[1]),
        line: index + 1,
        started_line: line,
        claimed_running: true,
        terminal_line: null
      };
      continue;
    }

    const terminal = line.match(/(?:Backend process exited|Owned backend process tree stopped)\. owner_pid=(\d+)/i);
    if (terminal && backend?.pid === Number(terminal[1])) {
      backend.claimed_running = false;
      backend.terminal_line = line;
    }
  }

  return { tray, backend };
}

export function evaluateRuntimePreflight(input) {
  const errors = [];
  if (input.listenerOpen) errors.push("configured Atlas port still has a TCP listener");
  if (input.healthOk) errors.push("Atlas health endpoint is still reachable");
  if (!input.ownership?.tray) errors.push("tray ownership could not be resolved from the tray log");
  if (!input.ownership?.backend) errors.push("backend ownership could not be resolved from the latest tray lifecycle");
  if (input.backendProcessAlive) errors.push(`owned backend PID ${input.ownership?.backend?.pid ?? "unknown"} is still alive`);
  if (input.databaseIdentityChanged) errors.push("database/WAL/SHM/journal identity changed during observation");
  if (input.schedulerRunDuringObservation) errors.push("a scheduler source run started during observation");

  return {
    safeForBackup: errors.length === 0,
    errors
  };
}

export function identitiesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fileIdentity(path) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return { size: stat.size, modified_at_ms: stat.mtimeMs };
}
