# Persistent Scheduler and Freshness v2

## Goal

- 將 Backend v1 的 process-memory `setInterval` 升級為 SQLite-owned、可在重啟後恢復的 per-source schedule state。
- 對可恢復來源執行 bounded startup catch-up，對 latest-only 來源誠實標示不可補回的 gap。
- 以 source/domain scoped freshness、coverage 與 warnings 取代只看全域最新 Document 的近似判斷。
- 使用既有 ETag／Last-Modified lineage 送出 conditional request，降低重複下載與配額消耗。

## Non-goals

- 本次不建立 distributed queue、Redis、PostgreSQL、多節點 leader election 或公網 admin service。
- 不承諾補回 provider 未保存的 RSS、即時行情或已失效警報。
- 不自動安裝 Windows Scheduled Task，不在未確認下修改作業系統啟動項目。
- 不改版 frontend，不啟用需要 credential 的來源，不增加付費 provider。

## Hard constraints

- `atlas.sqlite` migration 必須 additive/idempotent，保留已收集的 Document／Story／Event 與 legacy DB。
- 單一來源 lease、retry 或 catch-up 失敗不得阻斷其他來源或 GET API。
- GET read path 不呼叫 provider；manual collection 仍只允許 loopback。
- freshness 必須區分 provider last success、資料 last ingested、operational failure、stale 與 coverage gap。
- conditional request URL、錯誤與 raw lineage 不得洩漏 API key。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Current runtime: Node.js 24、`node:sqlite`、single process、23 registered sources。
- Current scheduler: 啟動後 250ms full cycle，再用 per-source `setInterval`；process 結束即失去 timer。
- Current data: scheduler acceptance 曾驗證 16 healthy／1 failed／6 disabled；GDELT upstream connect timeout。

## Deliverables

- Schema v2 schedule state、run trigger/catch-up audit fields、store claim/lease/recovery API。
- Persistent scheduler loop、exponential backoff、bounded jitter、startup recovery 與 due-source execution。
- Source catch-up capability metadata；至少 GDELT、Federal Register、USGS 使用 bounded time window。
- Conditional GET validator plumbing 與 HTTP 304 handling。
- `/api/v1/freshness` 與 domain-scoped freshness/coverage envelope。
- Windows logon task scripts（只建立、不執行）與 README／`.env.example`。
- Migration、lease、restart recovery、304、backoff、domain freshness 與 runtime tests。

## Done criteria

- 既有 schema v1 DB 無資料遺失升級至 v2；空 DB 與重複初始化均成功。
- scheduler restart 後依 persisted `next_due_at` 決定 due source，expired lease 可恢復且不重複同時執行。
- failed source 依持久化 consecutive failure 做 bounded backoff；成功後歸零。
- conditional 304 計為成功且更新 source freshness，不產生假 Document。
- domain query 的 coverage 只計算該 domain 來源，且 stale/failed/disabled 可辨識。
- `npm run verify`、migration fixture、localhost smoke 與 `git diff --check` 通過。

## Open questions / assumptions

- 初期維持單機 SQLite lease；lease 是 crash recovery 與防重入，不宣稱多節點 production coordination。
- Windows 常駐先交付可審查 script；實際註冊系統 task 需使用者另行確認。
- 預設最大 catch-up window 為 24 小時，可由環境變數調整但設上限。
