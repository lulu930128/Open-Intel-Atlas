# Progress

## Status

- Current phase: done
- Last updated: 2026-08-23 完成（Asia/Taipei）

## Completed

- 讀取產品文件、Backend v1 scheduler/store/API、目前 source cadence 與既有未提交狀態。
- 確認目前排程真相仍在 process-memory timer，DB 只有 source run history，沒有 next due、lease、backoff 或 catch-up watermark。
- 確認 freshness 目前為全域最新 Document + source status，尚未依 domain scope 聚合。
- 完成 schema v2 `source_schedule_state`、source run trigger/catch-up/304 audit columns 與 v1 additive migration。
- 完成 SQLite due/claim/lease/expired recovery、持久化 failure count、exponential backoff、bounded jitter 與 graceful stop。
- 完成 `latest_only`／`window`／`provider_history` capability；GDELT、Federal Register、USGS 接受 bounded time window。
- 完成 ETag／Last-Modified conditional GET；304 計為成功並保留 validator，不建立重複 Document。
- 完成 `/api/v1/freshness`、domain-scoped source filtering、source operational/freshness 雙狀態、gap warnings 與 `data_as_of`。
- 完成 `run-atlas.ps1` 與 logon Scheduled Task installer；只做 `-WhatIf` 驗證，沒有註冊系統工作。
- 版本更新為 `1.1.0`，README、`.env.example`、Roadmap 與 ExternalInterfaces 同步。

## Validation evidence

- Backend v1 前一階段：`npm run verify` 通過，localhost v1/legacy smoke 通過。
- 現有 registry：23 sources；17 enabled、6 ready-but-disabled。
- `npm run verify`: syntax check 30 files；10 tests 全數通過。
- migration fixture: schema v1 run 保留並升級至 v2，重複初始化成功。
- actual migration backup: `data/db/atlas.sqlite.pre-scheduler-v2.bak`。
- actual migration counts before/after: sources 23、runs 19、documents 372、stories 271、events 240、evidence 340；完全一致。
- actual DB migration: schema=2、schedule states=23、`foreign_key_check=0`、`integrity_check=ok`。
- live scheduler: 17 sources 執行，16 success、1 GDELT timeout；5 runs 使用 conditional 304。
- live domain freshness: technology/finance/hazards=`full/current`；politics=`partial/stale`，warning 指向 GDELT。
- restart smoke: source runs 維持 36、`last_due_tick_at=null`、active=0、lease=0，證明 restart 尊重 persisted `next_due_at`。
- post-live DB: documents 379、stories 278、events 247、evidence 347、running runs=0、active leases=0、event without evidence=0、unredacted key URL=0。
- Windows installer elevated `-WhatIf`: 僅顯示預計註冊 `Open Intel Atlas`，沒有建立 task。
- graceful shutdown: 8790 listener 關閉。
- final no-provider smoke (`ATLAS_AUTO_COLLECT=false`): version 1.1.0、schema 2、runs 36、schedule states 23、politics partial、hazards full/current、legacy dashboard 20 events、首頁 HTTP 200；關閉後無 listener。

## Decisions made

- 沿用單一 `atlas.sqlite`，以 schema v2 additive migration 擴充，不建立第二套 scheduler DB。
- 先做 SQLite-owned scheduler truth，再提供 Windows always-on 啟動 script。
- `collectOnStart` 只讓無歷史來源立即 due；既有來源依 DB `next_due_at`，避免每次 restart full refresh。
- current coverage 與 historical gap 分開：最新來源可 current/full，同時保留過去 `SOURCE_GAP_UNRECOVERABLE` warning。

## Known issues / risks

- GDELT live catch-up 仍為 upstream timeout；scheduler 已從 10 分鐘 cadence 起做持久化 backoff，不影響其他 domain。
- latest-only provider 的 powered-off gap 無法保證補回；系統會保留 warning，不能靠程式推測遺失內容。
- Windows task 尚未安裝；未登入或電腦關機時不會收集。實際註冊仍需使用者明確執行 installer。
- Node 24 `node:sqlite` 仍會顯示 ExperimentalWarning；需固定 runtime 並在 Node 升級時重跑 migration/contract tests。

## Next step

- 由使用者決定是否註冊 Windows logon task；後續產品實作優先轉向 Operational UI 的 freshness／gap／evidence 呈現。
