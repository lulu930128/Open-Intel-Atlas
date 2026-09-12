import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// A readiness snapshot, never a liveness lease. Shutdown does not modify it:
// an old process must not overwrite a successor's announcement.
export function createEndpointPublisher({ rootDir, statePath, version, sourceFingerprint = null }) {
  const identity = {
    schema_version: 1,
    service: "open-intel-atlas",
    installation_id: createHash("sha256").update(resolve(rootDir)).digest("hex"),
    instance_id: randomUUID(),
    pid: process.pid,
    version,
    source_fingerprint: sourceFingerprint,
    started_at: new Date().toISOString()
  };
  let current = { ...identity, status: "starting" };
  return {
    snapshot: () => ({ ...current }),
    async publish(address) {
      const host = address.address;
      if (!["127.0.0.1", "::1"].includes(host)) {
        if (statePath) throw new Error("Atlas discovery publication requires a loopback listener");
        return;
      }
      current = { ...identity, status: "running", base_url: `http://${host === "::1" ? "[::1]" : host}:${address.port}` };
      if (!statePath) return;
      await mkdir(dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${identity.instance_id}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(current, null, 2) + "\n", { flag: "wx" });
        await rename(temporary, statePath);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    stop() { current = { ...current, status: "stopped" }; }
  };
}
