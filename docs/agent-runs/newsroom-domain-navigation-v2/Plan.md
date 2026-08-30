# Plan

## Milestones

1. 固定現況與資訊架構
   - Scope: current HTML／CSS／renderer、live API、desktop screenshot、task docs。
   - Acceptance: 跑版根因、首頁與子頁責任、backend ownership 已記錄。
   - Validation: browser full-page screenshot、`GET /api/v1/domains|freshness|sources`。

2. 首頁摘要化
   - Scope: `public/index.html`、`public/newsroom.js`、`public/newsroom.css`。
   - Acceptance: latest 限制為 6；domain overview 由 registry 生成，每個入口最多 2 則事件；nav 指向子頁。
   - Validation: syntax check、frontend contract test、desktop/mobile DOM與 screenshot。

3. 共用 domain 子頁
   - Scope: `public/domain.html`、`public/domain.js`、共用 newsroom styling/media helper。
   - Acceptance: registry 驗證、bounded cursor、freshness／coverage／sources、Event detail、invalid／empty／error state。
   - Validation: model/unit test、local API browser interaction。

4. 文件與最終驗收
   - Scope: README／Roadmap／Progress、full verify、runtime/browser evidence。
   - Acceptance: source-ready 與 runtime-adopted分開；無 console error、overflow或不實狀態。
   - Validation: `npm run verify`、`git diff --check`、desktop／390px screenshots。

## Stop-and-fix rules

- 若 domain registry、cursor或 invalid-domain 測試失敗，不以 hard-coded fallback 冒充正式子頁資料。
- 若圖片或長標題仍造成 layout height coupling／水平 overflow，先修正再驗收。
- 若 UI 隱藏 `partial`／`stale`／source failure，停止視覺驗收並修正。
- 不以 source code或 health endpoint 取代實際瀏覽器證據。

## Decisions

- 2026-08-30：首頁只保留跨領域判讀所需摘要，完整 domain event stream 移至共用子頁。
- 2026-08-30：子頁使用 query parameter 與單一 template，避免四份重複頁面。
- 2026-08-30：domain 名稱與描述讀 backend registry；presentation accent 不成為 taxonomy truth。
