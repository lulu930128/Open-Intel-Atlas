# Progress

## Status

- Current phase: complete in source; publication candidate validated; external adoption pending
- Last updated: 2026-08-30 +08:00

## Completed

- 讀取產品願景、運作模型、品質標準、Roadmap、ExternalInterfaces 與目前 README。
- 盤點 schema v2、Store、Document → Story → Event pipeline、`/api/v1` 與既有 regression tests。
- 確認目前 repo 尚無 durable change table、representation profile registry 或 MCP transport。
- 對照 MCP 現行 `2026-07-28` stateless revision與官方 TypeScript SDK v2 dual-era handler。
- 固定 Consumer Gateway v1 goal、non-goal、trust boundary、done criteria 與 stop-and-fix rules。
- 完成 schema v3 migration：`stories.version`、append-only `story_updates`、filter indexes 與 migration record。
- 將 Event material-state comparison、Story version increment 與 durable update insert 放進同一 `saveEvent()` transaction；duplicate collection 不產生 duplicate change。
- 建立 contract `1.1` capability layer與 profiles；REST 新增 `/api/v1/profiles`、`/api/v1/changes`，並讓 events/search/story/brief/source/domain 的 profile route 共用 projection。
- Change cursor 以 opaque global sequence + filter scope 編碼；invalid、ahead、scope mismatch 與未來 retention expiry 均 fail closed。
- 完成 loopback-only `/mcp`：六個 read-only tools、三個 static resources、一個 Story template resource、localhost Host/Origin guards。
- MCP 支援 `2026-07-28` modern per-request flow，也保留 `2025-11-25`／`2025-06-18` legacy stateless traffic。
- README、DataModel、ExternalInterfaces、SystemArchitecture、QualityBar 與 Roadmap 已同步 current implementation／external adoption boundary。

## Validation evidence

- `git status --short --branch`: `main...origin/main`，開始前 worktree clean。
- `rg --files src test scripts docs`: 找到 canonical runtime 與兩份測試檔，無 nested `AGENTS.md`。
- MCP 官方 specification／SDK 文件：確認現行 revision 移除 transport session，SDK v2 handler 可同時服務現行與 legacy stateless requests。
- `npm install @modelcontextprotocol/server@2 @modelcontextprotocol/node@2 zod@4`：建立 lockfile；`npm audit --audit-level=high` 回報 0 vulnerabilities。
- `node --test --test-isolation=none test/backend-v1.test.js`：REST profiles/change cursor、duplicate idempotency、DB restart/cursor、modern MCP discovery/list/call/resource、legacy initialize/list、Host/Origin rejection 全部通過。
- `npm run check`：34 files syntax check passed。
- `npm test`：10 tests passed，包含 v1 → v3 migration、scheduler/freshness regression 與 Consumer Gateway HTTP/MCP end-to-end。
- `git diff --check`：通過。
- Live runtime inspection：`127.0.0.1:8790` 本輪沒有 listener，因此未重啟或宣稱既有 tray/runtime 已採用新 source。
- 2026-08-30 publication candidate：`npm run verify` 再次通過，34 files syntax check、10/10 tests passed；source version 整理為 `1.2.0`，consumer contract 維持 `1.1`。

## Decisions made

- Change emission 會放入現有 `saveEvent()` transaction，不使用 process-memory event bus 當 durable truth。
- Kuro cursor/delivery policy 由 consumer 保存；Atlas 只發 global ordered change log。
- 本輪不修改或啟動外部 Kuro、OMI、Control Center 與 tunnel runtime。
- MCP transport 與 backend 同 process，但只呼叫共用 capability layer；若未來需要 lifecycle/fault isolation，可在保留 contract 的前提下拆成獨立薄 adapter。
- v1/v2 migration 不合成過去不存在的 Story update history；既有 current state 由 brief/story snapshot 取得，change feed 從 v3 後的 material changes 開始。

## Known issues / risks

- 現行本機其他 MCP components 多半仍使用舊 sessionful transport；本輪保留 legacy stateless compatibility，但外部 host adoption 仍需另做 runtime 證明。
- correction/retraction 的完整自動判定尚未實作；change schema 可承載這些狀態，但不將 contract capability 誤稱為 NLP closure。
- Change retention 尚未啟用；啟用前需完成 `cursor_expired` operational policy、snapshot resync 與 backup/restore acceptance。
- Node 24 `node:sqlite` 測試仍會顯示 ExperimentalWarning，與既有 runtime 相同。

## Next step

- 先以 Kuro 建立一條 `cursor=now → persist cursor → brief/story lookup → local notification policy` 的 shadow-only read flow，完成實際桌寵可見輸出與 restart recovery proof；再以 OMI 接 `evidence_pack_v1`，保留市場語意 ownership。
