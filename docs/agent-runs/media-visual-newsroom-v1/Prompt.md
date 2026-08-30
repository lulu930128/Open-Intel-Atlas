# Media & Visual Newsroom v1

> 2026-08-30 supersession：使用者後續確認 source image 為 optional enhancement；沒有 `remote_embed` 時不再顯示 Atlas editorial fallback，而是完全省略 visual block。Atlas-owned map／chart 需另走 `event_visualization` contract。

## Goal

- 為 Atlas 建立由 Document 擁有、可追溯、可治理、可降級的 canonical media contract。
- 讓 Story／Event、REST、MCP 與 Newsroom 共用 backend-selected `representative_media`，不建立第二份媒體 truth。
- 以 source-backed media 改善 Hero、Latest Reports 與 Domain Desks 的視覺層級；無合法圖片時採自然收合的純文字版面，同時保留 evidence-first、partial/stale 與 no-media 語意。
- 以 schema v4 additive migration、copied-DB replay、contract tests、query budget 與 desktop/mobile browser smoke 證明可維護性。

## User outcome

- 使用者在首頁第一屏可同時看到重大事件、代表視覺、verification、freshness 與 evidence；圖片缺失或載入失敗時，仍可完整閱讀與查證。
- 來源圖片、官方圖片、Atlas 資料／editorial visual 必須可辨識，不以 AI 生成的擬真新聞圖補洞。

## Non-goals

- 不在 UI 或 public read path 抓 publisher HTML、解析 OpenGraph、探測任意 URL 或重算代表圖片。
- 不建立 image proxy/cache、任意網頁 scraper、公共 CDN、登入、public auth 或多租戶 media service。
- 不把 media 變成 Document／Story／Event 成立的必要條件。
- 不修改 Story clustering、Event identity、verification、severity、freshness、ranking、OMI market semantics 或 Kuro notification policy。
- 本輪不實作 Hazards mini-map、Finance trend、完整 Story/Event route 或 Intelligence Layer ranking；只保留未來不受阻礙的 contract。
- 不使用 AI photorealistic news illustration、generic stock photo 或無來源的情境圖。

## Hard constraints

- Media canonical owner 是 Document；Story／Event 只投影 backend-selected media 與 `selected_document_id` lineage。
- `candidate` 只表示已發現，不表示可顯示；只有 backend source/media policy 明確產生的 `remote_embed` 才可進 `<img>`。
- 第一版 `remote_embed` 預設 HTTPS-only，禁止 userinfo、IP literal、localhost、private/link-local host 與未核准 host；source policy 必須提供 allowed publisher/CDN hosts、rights class、policy version、reason 與 evaluated time。
- UI 只接受 `representative_media`；不得讀取 `raw_metadata.socialimage`、不得依 source id hardcode rights、不得逐卡呼叫 Document detail。
- Static UI 必須設定 bounded `img-src` CSP／Referrer-Policy；圖片使用固定 aspect ratio、`referrerpolicy="no-referrer"`、適當 lazy/eager、非 inline error handler與可存取的 alt；載入失敗時整個 visual 收合。
- Media normalize／save failure 必須降級為 document without media，不能使 source collection、Story/Event 或 Newsroom 消失。
- schema v4 migration 只做 additive DDL，不在 migration 內執行外部 fetch 或無界 JSON backfill；live DB migration 前必須通過 copied-DB replay 與備份/restore gate。
- List／brief projection 不得新增逐 item REST 或 DB media lookup；需以 JOIN／batch projection 與 query-count regression 證明 query cost 不隨 item 數線性增加。
- `representative_media` nullable；沒有 media 是 `null`，不是 fake image，也不代表沒有新聞。
- Media／rights policy 變化第一版不增加 Story version 或 material-change event；consumer 以 snapshot/profile refresh 取得 presentation 更新。
- Source-ready、migration-ready、isolated-runtime-ready、runtime-adopted、provider-live 與 UI-visible 是不同 gate，不得互相代稱。
- 沒有使用者對 live runtime／DB migration 的明確授權前，只能使用 fixture、temp DB 或 copied DB；不得重啟 tray/backend 或寫入 `data/db/atlas.sqlite`。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Baseline branch: `main`
- Baseline source release: README/package `1.2.0`；`src/config.js` 的 runtime version 仍為 `1.1.0`，Milestone 0 必須先收斂。
- Current schema: source 與實際 `data/db/atlas.sqlite` 均為 v3；2026-08-30 唯讀證據為 1,033 Documents、589 Stories、508 Events、384 Story updates。
- Current runtime: `127.0.0.1:8790` 無 listener；本計畫建立時未啟動或重啟。
- Current GDELT evidence: adapter 保存 `raw_metadata.socialimage`，但實際 DB 有 0 筆 GDELT Document，最近 runs 為 connect timeout／reset；fixture readiness 不等於 provider-live。
- Current UI: `public/newsroom.js` 的 Hero、Latest、Domain renderer 均無 media slot；Live Desk 保持 text-first。
- Current query shape: capability `latest()`／`brief()` 會逐筆 `getEvent()`；Media v1 必須避免在此基線上再增加 media N+1。
- Proposed source release: 暫定 `1.3.0`；正式 release 前確認，但 consumer contract 可在 optional additive field 前提下維持 `1.1`。

## Deliverables

- Source-owned media/rights policy contract與公開投影邊界。
- normalized Document media contract、schema v4 `document_media`、transactional persistence、dedupe 與 deterministic representative selection。
- GDELT `socialimage` 與 bounded RSS `media:content`／`media:thumbnail`／image enclosure parsing；不新增 webpage scraper。
- List/detail/batch store projections與 optional additive `representative_media` capability/API contract。
- Newsroom visual resolver、Hero／Latest／Domain optional visual hierarchy、no-media layout、image failure/security/accessibility handling。
- Migration、normalization、policy denial、idempotency、query budget、contract、no-media、broken-media、partial/stale 與 responsive regression evidence。
- README、DataModel、SystemArchitecture、ExternalInterfaces、QualityBar、Roadmap 與本任務 Progress 同步。

## Done criteria

- README/package/runtime version drift 已收斂，release target 已記錄。
- schema v3 copied DB 可無資料遺失升級 v4；重跑 idempotent；fresh DB 正確初始化；live DB 尚未授權時保持未變更。
- `document_media` 保證 `(document_id, normalized_url)` 唯一，且每個 Document 最多一筆 representative media。
- invalid/private/unapproved URL 不得成為 `remote_embed`；unknown rights 只能保存為 `candidate` 或 `link_only`。
- 相同文件重抓不產生 duplicate media；media parsing failure 不影響 Document ingestion。
- GDELT/RSS fixture、normalization、persistence、representative selection 與 REST/MCP contract tests 通過。
- Story/Event list、brief 與 domain queries 帶 bounded `representative_media`，且 1 item 與 20 items 的 media query 數不線性增加。
- Hero 實際消費 backend `representative_media`；Latest 前幾則與每個 Domain 首則形成 mixed hierarchy；Live Desk 維持 text-first。
- no-media、blocked media、404/broken media、partial/stale/source failure 下仍可閱讀、查證且沒有 broken-image icon、水平 overflow 或隱藏 warning。
- `npm run verify`、copied-DB migration、API/MCP contract、desktop/mobile browser smoke、request/query budget 與 `git diff --check` 通過。
- Runtime adoption 只有在明確授權後，以現有 launcher/runtime lifecycle 完成；若 GDELT 或其他 provider 不可用，provider-live 保持 pending，不以 fixture 冒充。

## Open questions / assumptions

- 暫定 source release 為 `1.3.0`；若使用者選擇不同版本，只調整 release metadata，不改 media contract。
- 第一個可顯示的 remote source 必須先完成官方 terms/attribution 與 allowed-host review；在此之前 UI 使用純文字版面，不放寬 policy。
- 既有 GDELT Documents 為 0，因此 v1 不承諾 live raw-metadata backfill；若後續 DB 出現可回收的 legacy metadata，另以 bounded、可重跑 job 執行並回報掃描／建立／跳過／拒絕數。
- Media policy 更新第一版不寫入 `story_updates`；若未來 consumer 需要 presentation change stream，另設不冒充 semantic change 的 contract。
