# Plan

## Milestones

1. ✅ Schema v2 與 persistent schedule store
   - Scope: migration、schedule state、lease、run audit、restart recovery。
   - Acceptance: v1 fixture 無資料遺失升級；claim/complete/recover idempotent。
   - Validation: targeted SQLite migration/scheduler tests。

2. ✅ Conditional HTTP 與 catch-up contracts
   - Scope: ETag/Last-Modified lookup、304、source capability、bounded window context。
   - Acceptance: secret-safe conditional headers；304 不建立 Document；window 不超過設定上限。
   - Validation: local HTTP fixture tests與 adapter URL assertions。

3. ✅ Persistent scheduler runtime
   - Scope: due polling、lease、jitter/backoff、startup recovery、graceful stop。
   - Acceptance: restart 後使用 DB `next_due_at`；同來源不重入；失敗不阻斷其他來源。
   - Validation: fake clock/fake source integration tests。

4. ✅ Freshness v2 API
   - Scope: source operational/freshness state、domain coverage、warnings、`/api/v1/freshness`。
   - Acceptance: politics failure 不讓 hazards 顯示 partial；global 與 scoped envelope 可解釋。
   - Validation: API contract tests與 actual DB smoke。

5. ✅ Windows handoff、文件與整體驗證
   - Scope: logon task scripts、README、env、Progress。
   - Acceptance: scripts 無機器硬編碼且未自動執行；啟動／停用方式可重現。
   - Validation: `npm run verify`、`git diff --check`、localhost runtime smoke。

## Stop-and-fix rules

- migration row counts、foreign keys、既有 Event evidence 或 schema version 不符時，先停止後續實作。
- lease/backoff 測試出現重入、busy loop 或失敗來源高頻重試時，先修正 scheduler。
- catch-up adapter 無法證明 provider 支援時間範圍時，降級為 `latest_only`，不假裝已補抓。
- freshness envelope 若以其他 domain 的成功掩蓋 scoped failure，視為阻斷問題。

## Decisions

- 2026-08-23：SQLite schedule state 擁有 `next_due_at`、lease、failure count 與 last success；timer 只負責喚醒，不擁有真相。
- 2026-08-23：失敗 backoff 從該來源 cadence 起算並指數增加，加入 bounded jitter，避免 timeout provider 被密集重試。
- 2026-08-23：Windows task 僅交付 installer script，不在本次自動修改系統。
- 2026-08-23：既有 run history 在 schema v2 seed 時保留原 cadence due time；只有全新、從未執行的來源受 `collectOnStart` 立即排程。
- 2026-08-23：最新一次 provider 成功時間決定 freshness；Document ingestion 另以 `data_as_of` 表示，兩者不混用。
