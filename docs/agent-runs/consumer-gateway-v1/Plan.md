# Plan

## Milestones

1. 現況與契約盤點
   - Scope: schema、store、pipeline、API、server、tests、產品與架構文件。
   - Acceptance: 找出 atomic change emission、cursor、profile 與 MCP 的最小穩定接點。
   - Validation: `rg --files`、相關檔案 UTF-8 讀回、`git status --short --branch`。

2. Durable change model
   - Scope: schema v3、Story version、`story_updates`、store query／cursor。
   - Acceptance: semantic state 與 change 同 transaction；重跑 idempotent；v1/v2 DB additive migration。
   - Validation: targeted schema、event rebuild、restart/cursor tests。

3. Consumer capability 與 REST profiles
   - Scope: shared query state、profile registry、brief/change/story/evidence/source projections、v1 routes。
   - Acceptance: backend 擁有語意；invalid profile/cursor fail closed；既有 API additive compatible。
   - Validation: targeted REST contract tests。

4. Read-only MCP
   - Scope: official MCP TypeScript SDK v2、loopback Host/Origin guard、tools、resources。
   - Acceptance: MCP 不直連 provider、不提供管理或外部 side effect；現行與 legacy stateless traffic 可用。
   - Validation: protocol smoke，包含 discovery/initialize compatibility、tools/list、representative tools/call、resources/read。

5. 文件與完整驗證
   - Scope: README、ExternalInterfaces、DataModel、Roadmap、Progress、diff。
   - Acceptance: current/target/adoption 狀態不混寫；沒有宣稱外部 consumer 已採用。
   - Validation: `npm run check`、`npm test`、localhost API/MCP smoke、Markdown link check、`git diff --check`。

## Stop-and-fix rules

- 若 duplicate collection 產生 duplicate change，先修正 transaction/dedupe，不進 MCP。
- 若 Story/Event 已提交但 change 未提交，或反過來，停止並修正 transaction boundary。
- 若 REST 與 MCP profile payload 語意不同，改回共用 capability layer。
- 若 MCP tool 可觸發 provider I/O、refresh、backfill、通知或其他 side effect，停止並移除。
- 若 Host/Origin 或 loopback guard 無法驗證，MCP 不開放監聽。
- 若現行 MCP SDK 無法與 Node 24／plain `node:http` 穩定整合，不手寫不完整協定；記錄 blocker 並先交付 REST boundary。

## Decisions

- 2026-08-23：Kuro 背景同步使用 durable REST change feed；MCP 專注互動查詢，不作唯一常駐傳輸。
- 2026-08-23：採單一 backend capability layer，多個 versioned representation profiles，不建立 consumer-specific pipeline。
- 2026-08-23：schema v3 以 `story_updates` 保存 append-only semantic change；Story version 只在 outward material state 改變時增加。
- 2026-08-23：採官方 MCP TypeScript SDK v2，服務 `2026-07-28` 並保留 legacy stateless compatibility，不自行維護易漂移的 wire protocol。
