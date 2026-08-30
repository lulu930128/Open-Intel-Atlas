# Atlas Consumer Gateway v1

## Goal

- 建立可供 Kuro、OMI 與其他 agent 共用的 Atlas consumer boundary。
- 以 SQLite 持久化 Story/Event 的可觀察狀態變化，提供可續接、可去重的 `/api/v1/changes`。
- 提供 backend-owned、versioned representation profiles，讓 REST 與 MCP 投影同一套 canonical evidence、freshness、coverage 與 warnings。
- 建立 read-only MCP endpoint，完成現行協定與 legacy stateless 相容面的本機 protocol smoke。

## Non-goals

- 本次不修改 Kuro、OMI、`C:\GPT_MCPtool` Control Center、tunnel 或外部 connector 設定。
- 不宣稱桌寵或 ChatGPT 已採用；consumer runtime wiring 與可見輸出驗證屬後續獨立里程碑。
- 不加入通知發送、webhook、email、任意 URL fetch、MCP 寫入工具或 public admin capability。
- 不在本次完成完整 correction/retraction NLP 判定；只建立可承載這些狀態的 durable change contract。

## Hard constraints

- Atlas backend 持有 taxonomy、verification、severity、freshness、coverage 與 evidence truth；REST、MCP、Kuro 與 OMI 不得重算。
- Story/Event 與 change 必須在同一 canonical SQLite transaction 內保存，不能先更新狀態再以易失記憶通知。
- 重抓相同資料、scheduler 重跑或 runtime 重啟不得產生重複 semantic change。
- MCP adapter 只呼叫共用 capability layer，不直接抓 provider、不提供 refresh/backfill/delete/notify。
- `/mcp` 預設只允許 loopback，並驗證 Host/Origin；身分資訊或 profile 名稱不是授權依據。
- API 變更 additive-first；保留既有 `/api/v1` 與 legacy `/api/*` 行為。
- 不把 source failure、stale 或 partial coverage 解讀為「沒有事件」。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Current branch: `main`
- Current source version: `1.1.0`
- Current canonical schema: v2，已有 Source → Document → Story → Event 與持久化 scheduler，尚無 `story_updates`／change feed。
- Current outward contract: `/api/v1` contract `1.0`，已有 brief、search、stories、events、sources 與 freshness。
- Current MCP state: repo 尚無 MCP transport；README 明確列為未完成。
- Protocol baseline: MCP `2026-07-28` 為現行 stateless revision；官方 TypeScript SDK v2 可在單一 handler 同時服務現行 revision 與 legacy stateless traffic。

## Deliverables

- SQLite schema v3 migration、Story version 與 durable `story_updates`。
- 共用 consumer capability/projection module。
- `GET /api/v1/profiles`、`GET /api/v1/changes` 與 versioned brief/change/story/source profiles。
- read-only `/mcp` tools/resources。
- schema migration、idempotency、cursor、profile、REST 與 MCP regression/smoke tests。
- README、architecture、roadmap 與本任務 Progress 更新。

## Done criteria

- 相同資料重抓不新增 change；新增獨立 evidence 只產生一個具 reason codes 的新 story version。
- runtime 關閉並重開同一 DB 後，change cursor 可續接且 stable change ID 不變。
- REST 與 MCP 對同一 capability 回傳一致 stable IDs、profile、contract version、freshness、coverage 與 warnings。
- invalid cursor/profile/tool input 使用 predictable error，不靜默回到第一頁。
- MCP 完成現行 `server/discover → tools/list → tools/call → resources/read`，並覆蓋 legacy stateless compatibility。
- `npm run check`、相關 tests、完整 `npm test`、API/MCP localhost smoke 與 `git diff --check` 通過。

## Open questions / assumptions

- 本輪假設 Atlas 仍為 local-first 單使用者，MCP 只綁定現有 loopback backend；public auth、tunnel 與多使用者延後。
- Change retention 本輪先保留完整歷史；加入清理政策前必須先定義 cursor expiry 與 snapshot resync。
- Kuro 的 `last_cursor`、安靜時間、去打擾與 delivery log 由 Kuro 自己保存，Atlas 不建立 consumer-specific preference table。
