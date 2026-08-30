import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRuntimePreflight,
  identitiesEqual,
  parseTrayOwnership
} from "../scripts/lib/runtime-adoption-preflight.mjs";

test("runtime preflight resolves the latest tray/backend lifecycle", () => {
  const ownership = parseTrayOwnership(`
2026-08-30 17:44:29.685 [INFO] Tray starting. launcher_pid=40844 project=C:\\old
2026-08-30 17:44:30.239 [INFO] Backend process started. owner_pid=51372 reason=tray-startup
2026-08-30 17:57:30.740 [INFO] Tray starting. launcher_pid=56848 project=C:\\current
2026-08-30 17:57:31.302 [INFO] Backend process started. owner_pid=50116 reason=tray-startup
`);

  assert.equal(ownership.tray.pid, 56848);
  assert.equal(ownership.backend.pid, 50116);
  assert.equal(ownership.backend.claimed_running, true);
});

test("runtime preflight recognizes a terminal backend line", () => {
  const ownership = parseTrayOwnership(`
2026-08-30 17:57:30.740 [INFO] Tray starting. launcher_pid=56848
2026-08-30 17:57:31.302 [INFO] Backend process started. owner_pid=50116 reason=tray-startup
2026-08-30 19:55:00.000 [INFO] Owned backend process tree stopped. owner_pid=50116 reason=restart
`);

  assert.equal(ownership.backend.claimed_running, false);
  assert.match(ownership.backend.terminal_line, /stopped/);
});

test("runtime preflight fails closed for a half-alive writer", () => {
  const result = evaluateRuntimePreflight({
    listenerOpen: false,
    healthOk: false,
    ownership: { tray: { pid: 56848 }, backend: { pid: 50116 } },
    backendProcessAlive: true,
    databaseIdentityChanged: true,
    schedulerRunDuringObservation: true
  });

  assert.equal(result.safeForBackup, false);
  assert.deepEqual(result.errors, [
    "owned backend PID 50116 is still alive",
    "database/WAL/SHM/journal identity changed during observation",
    "a scheduler source run started during observation"
  ]);
});

test("runtime preflight permits backup only after owner stop and stable database family", () => {
  const result = evaluateRuntimePreflight({
    listenerOpen: false,
    healthOk: false,
    ownership: { tray: { pid: 56848 }, backend: { pid: 50116, claimed_running: false } },
    backendProcessAlive: false,
    databaseIdentityChanged: false,
    schedulerRunDuringObservation: false
  });

  assert.equal(result.safeForBackup, true);
  assert.deepEqual(result.errors, []);
  assert.equal(identitiesEqual({ wal: null }, { wal: null }), true);
  assert.equal(identitiesEqual({ wal: null }, { wal: { size: 1 } }), false);
});
