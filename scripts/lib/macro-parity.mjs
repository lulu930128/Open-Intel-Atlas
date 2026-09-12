import assert from "node:assert/strict";

export const macroProjection = ({ data, coverage, freshness, warnings }) => ({ data, coverage, freshness, warnings });

export async function verifyMacroParity(base, group, releaseId, range) {
  const checks = [
    ["calendar", "calendar", { group, from: range.from, to: range.to }],
    ["release", `releases/${encodeURIComponent(releaseId)}`, { release_id: releaseId }],
    ["indicator", "indicators", { group }],
    ["observations", "observations", { group }]
  ];
  const results = [];
  for (const [tool, route, args] of checks) {
    const query = tool === "release" ? "" : `?${new URLSearchParams(args)}`;
    const response = await fetch(`${base}/api/v1/macro/${route}${query}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `${group}/${tool} REST`);
    const rest = await response.json();
    const result = await fetch(`${base}/mcp`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": `atlas.macro.${tool}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: `${group}/${tool}`, method: "tools/call", params: {
        name: `atlas.macro.${tool}`, arguments: args, _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "macro-closeout", version: "1" }
        }
      } })
    });
    assert.equal(result.status, 200, `${group}/${tool} MCP`);
    const mcp = (await result.json()).result?.structuredContent;
    assert.ok(mcp, `${group}/${tool} structured content`);
    assert.deepEqual(macroProjection(rest), macroProjection(mcp), `${group}/${tool} parity`);
    results.push({ group, tool, parity: true, rest: macroProjection(rest), mcp: macroProjection(mcp) });
  }
  return results;
}
