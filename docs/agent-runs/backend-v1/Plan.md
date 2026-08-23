# Plan

## Milestones

1. ✅ 建立 foundation
   - Scope: config、contracts、taxonomy、schema、store、task docs。
   - Acceptance: 空 `atlas.sqlite` 可 idempotent 初始化，foreign keys/WAL/busy timeout 生效。
   - Validation: `npm run check`、targeted store tests。

2. ✅ 建立 source adapters
   - Scope: 現有 10 個來源及 GDACS、ReliefWeb、CWA、NWS、SEC、TWSE、Federal Register、Congress、FRED、ECB、World Bank、OSV、Semantic Scholar。
   - Acceptance: 每個 adapter 只回傳 SourceFetchResult 與 IntelDocument；required config 缺少時 registry 顯示 disabled。
   - Validation: parser/adapter fixtures 與 bounded live samples。

3. ✅ 建立 intelligence pipeline
   - Scope: normalize、dedupe、Story clustering、Event fusion、verification、entity、geo。
   - Acceptance: 3 篇相同事件可聚為 1 Story；重抓相同 structured source 保持穩定 identity；無證據不建 Event。
   - Validation: `node --test test/documents test/stories test/events test/store`。

4. ✅ 建立 API 與 scheduler
   - Scope: `/api/v1`、legacy projection、collector、bounded scheduler、shutdown。
   - Acceptance: API request 不觸發無界 fetch；單一來源失敗不阻斷其他來源；舊 frontend contract 仍可取得資料。
   - Validation: localhost health/source/document/event smoke。

5. ✅ 文件與整體驗證
   - Scope: README、`.env.example`、package scripts、Progress。
   - Acceptance: 設定、來源狀態、限制、啟動與驗證命令可重現。
   - Validation: `npm run verify`、`git diff --check`、runtime smoke。

## Stop-and-fix rules

- 若 schema idempotency、dedupe identity、provider isolation 或 evidence lineage 測試失敗，先修正再進下一步。
- 若 live API 的授權、User-Agent、配額或 payload 與官方文件不符，該來源改為 disabled，不使用非官方 workaround。
- 若現有未提交 frontend 行為被破壞，保留 legacy projection 或暫停整合，不回復使用者變更。
- 不刪除 legacy DB；需要清理時另行取得明確授權。

## Decisions

- 2026-08-23：使用單一 `atlas.sqlite` 新路徑，legacy DB 保留但不再作 Backend v1 主 read path。
- 2026-08-23：來源分成 discovery、official evidence、reporting、research、context；aggregator 不自動增加 independent source count。
- 2026-08-23：需要金鑰或具名身分的來源採 ready-but-disabled，避免硬編碼或假身分。
- 2026-08-23：先保留既有 public frontend，透過 legacy API projection 驗證相容，不在本次改版。
- 2026-08-23：`POST /api/v1/collect` 只允許 loopback client；GET read path 與 scheduler/provider I/O 解耦。
- 2026-08-23：OSV modified index 以 HTTP Range 限制為 1 MiB，再逐筆取得 8 筆詳情，避免放寬全域 response bound。
