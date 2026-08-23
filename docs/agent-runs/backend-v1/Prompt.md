# Open Intel Atlas Backend v1

## Goal

- 將目前 request-driven、source adapter 直接產生 Event 的原型，收斂成可排程、可追溯、可查詢的公開情報後端。
- 以標準 Source → Document → Story → Event 流程接入現有與新增的政治、科技、金融、災害來源。
- 對輸入做 bounded raw 保存、文字清洗、URL 正規化、stable ID、去重、基礎分類、來源獨立性與 evidence lineage。

## Non-goals

- 不重做前端視覺。
- 不加入登入、RBAC、MCP、LLM、向量資料庫、PostgreSQL、Redis 或 message queue。
- 不鏡像新聞全文，也不把市場觀測或每篇論文自動升格為重大 Event。
- 不刪除或 migration 目前的 legacy SQLite；新後端不再把它們當主資料來源。

## Hard constraints

- Repo 目前有使用者尚未提交的 frontend、server、store 與 dashboard 變更；不得覆蓋或回復無關工作。
- 任何 outward Event 必須能追溯至少一筆 Document；來源失敗不得產生 fake event。
- API key、token、聯絡信箱與機器特定資料只可由環境變數提供。
- 需要 key、核准 app name 或具名 User-Agent 的來源，在未設定時必須 fail closed 為 disabled。
- Raw payload 必須 bounded；沒有地理證據時不得偽造座標。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Current version: `0.8.0`
- Runtime: Node.js 24+ 原生 HTTP server與 `node:sqlite`
- Current known state: 10 個來源集中在 `src/sources.js`，直接輸出 legacy Event；六個 category/dashboard SQLite 已存在但由 `.gitignore` 排除。
- 2026-08-23 baseline: `npm run check` 通過；本輪開始時 `8790` 未在監聽。

## Deliverables

- 統一設定、source registry、HTTP policy 與四領域 adapters。
- `atlas.sqlite` schema、migration marker、store 與 source-run health。
- Document 清洗／去重、Story clustering、Event fusion、verification、entity／geo 基礎處理。
- `/api/v1/health|sources|documents|stories|events|entities|search|brief`。
- scheduler、bounded concurrency、timeout、retry、graceful shutdown。
- legacy API 的 read-only compatibility projection，讓現有 frontend 可繼續讀取。
- fixture-based tests、README 與 `.env.example`。

## Done criteria

- 空 DB 可重複初始化，且只新增 `atlas.sqlite` 作為 v1 主資料庫。
- adapters 只輸出 Document；沒有 `FALLBACK_EVENTS` 進入 v1 pipeline。
- 無金鑰來源可在 bounded collector cycle 中獨立執行；缺少設定的來源明確顯示 disabled。
- 相同來源重抓不重複建立 Document／Event；基礎跨來源 Story clustering 有 fixture 驗證。
- provider failure 被保存為 source run，其他來源仍可繼續。
- `npm run check`、`npm test`、`npm run verify` 通過，並完成 localhost API smoke。

## Open questions / assumptions

- Backend v1 先以本機單使用者、單 Node process、SQLite WAL 為容量邊界。
- 一般天氣數值屬 context；只有警報、災害或明確異常才升格為 Event。
- SEC、CWA、Congress、FRED、ReliefWeb 在取得必要設定前只交付 ready-but-disabled adapter。
