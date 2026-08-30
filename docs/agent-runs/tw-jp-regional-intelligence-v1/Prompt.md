# 台日區域情報完善計畫 v1

## Goal

- 將 Open Intel Atlas 從「Global／US-heavy、TW limited、JP sparse」提升為具有台灣與日本 dedicated official coverage 的區域情報系統。
- 新來源全部沿用 canonical `Source → Document → Story → Event → Capability` 主線，不建立台日私有 pipeline、database 或 consumer fallback。
- 補齊從來源取得、權利與健康、Story／Event 提升、區域關聯、brief 選擇到 runtime／UI 驗收的完整閉環，而不只增加 RSS 數量。
- 在 `east_asia`／`taiwan_focus`／`japan_focus` presentation profile 中，優先曝光符合品質門檻的區域情報；資料不足時如實少顯示並揭露 coverage gap，不以舊、低品質或重複內容補比例。

## Non-goals

- 不做新聞全文鏡像、媒體圖片 proxy/cache 或未完成權利審查的 remote embed。
- 不以 keyword 命中直接宣告重大 Event，也不把官方發布等同多方獨立證實。
- 不在本任務加入 LLM 自動分類、投資判斷、Kuro 通知或 OMI market reaction。
- 不同時加入多個付費 aggregator；GNews／NewsData 保留為後續獨立決策。
- 不因本計畫自動重啟正式 runtime、backfill 正式 DB、commit 或 push。

## Hard constraints

- Source country、Event country、regional relevance 與 presentation preference 必須分開建模。
- `GET /api/v1/events?country=TW|JP` 只可使用有 location／country evidence 的 Event，不得因來源來自台灣或日本就偽造事件所在地。
- official authority 表示「官方機關發布了這項內容」，不代表所有延伸主張已獨立驗證。
- aggregator、轉載、同集團 syndication 不增加獨立來源數；JPCERT／JVN／NVD／CISA／OSV 的同一弱點不可形成多個獨立 Event。
- Source adapter 只處理 provider contract；promotion、relevance、freshness、verification 與 presentation selection 由 backend canonical owner 負責。
- 每個來源都要能單獨停用；單一 parser／provider 失敗不得回滾整體 schema 或拖垮其他 coverage slice。
- 正式 runtime adoption、DB reprocess／backfill、commit 與 push 都是獨立確認 gate。
- 保留目前工作樹內既有、與本計畫無關的 UI／tray／release 修改。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Related systems: Source Registry、collector/scheduler、canonical SQLite store、Story/Event intelligence、`/api/v1`、read-only MCP、Newsroom UI。
- Milestone 0 formal runtime baseline 為 26 registered、19 enabled；2026-08-30 後續 adoption 已將正式 runtime 更新為 1.3.0、schema v5、consumer contract 1.2、33 registered，scheduler enabled。
- Current source baseline：NCDR active CAP、MOD、JPCERT、JMA、FDMA、NDL 與 MOFA 已通過 bounded Node probe 並由正式 runtime 啟用；METI 因 compliant Node transport HTTP 403 而 registered/default-disabled。
- 總統府與行政院 adapters 已由目前 runtime 採用，兩者均 enabled、healthy、current；adoption 發生於本計畫 Milestone 0 盤點前，本計畫未執行 restart。
- 外交部 adapter、fixture 與三次專案 Node HTTP client bounded live probe 均完成；正式 runtime 已 default enabled、healthy、current，仍待三次／兩 cadence observation gate。
- 既有 CWA weather warnings 需要 `CWA_API_KEY`，目前 fail closed；TWSE material information 已在 registry。
- 現有 brief 由 `last_updated_at DESC` 的 Event page 直接取前 8 筆，沒有 regional relevance 或 diversity reranking。
- Milestone 0 live baseline：1,153 Documents／527 Events；TW dedicated official Documents 41、JP 0；Event country TW／JP 各 1、US 119，另有 393 筆 country truth 不完整；當次 brief 的 TW／JP exposure 均為 0。
- 總統府／行政院／外交部目前為 Document-only ingestion；若沒有 canonical promotion decision，不會改善首頁 Event mix。
- 官方已確認並通過 source-level gate 的日本結構化來源：JMA 防災 XML／Atom、MOD 報道資料 RSS、JPCERT/CC RSS 1.0、FDMA 災害情報 RSS、NDL 國會會議錄 API。METI transport fail closed；EDINET 維持 API-key gate。

## Deliverables

- 可稽核的 source matrix：endpoint、authority、rights、cadence、transport、parser、promotion policy、runtime status。
- 台灣來源收斂：總統府、行政院 runtime adoption；外交部 transport 決議；CWA credential gate；TWCERT/CNA/立法院候選審核。
- 日本官方核心來源：JMA、MOD、JPCERT、FDMA、NDL adapters 與 tests；METI 保留 registered/default-disabled transport evidence，EDINET 依 credential gate 決定。
- backend-owned `PromotionDecision`／`RegionalRelevance` 契約與 versioned deterministic policy。
- backend-owned regional brief selector 與 additive API/MCP input/profile；UI 只呈現 backend selection 與 coverage gap。
- source fixture、integration、pipeline/DB、API contract、isolated runtime、正式 adoption、browser/MCP 分層證據。
- rollback/runbook 與每批來源的觀察紀錄。

## Done criteria

- Minimum official coverage：TW 至少總統府、行政院、TWSE 三類來源在正式 runtime 健康；CWA 在取得合法 credential 後健康，否則明確顯示 disabled；MOFA 要嘛通過 Node runtime transport，要嘛保留帶原因的 disabled 狀態。
- JP 至少 JMA hazards、MOD politics、JPCERT technology 三個 dedicated official sources 通過 fixture、bounded live sample、isolated runtime 與正式 runtime health。
- 每個 enabled 新來源至少連續三次成功或 valid-not-modified，跨越至少兩個 cadence window；重跑不產生重複 Document。
- 所有 Event 都有可解釋的 promotion reason、method/version 與 evidence lineage；routine press release 不會因來源權威自動升格。
- `source_country` 不污染 `event_country`；regional relevance 有 reason/evidence/method/version，可與 location 分開查核。
- regional selector 先過 freshness、verification、dedupe、retraction 與 quality gate，再做 soft diversity；沒有合格 TW／JP Event 時不補假內容。
- API、MCP 與 UI 對相同 presentation profile 回傳一致結果，並顯示不足原因與 source health。
- source-ready、isolated runtime、正式 adoption、觀察期、UI/MCP acceptance、commit/push 各自有獨立證據，不互相代替。

## Open questions / assumptions

- 目前假設此本機產品的預設 presentation preference 最終採 `east_asia`；在 selector 實作前仍需由使用者確認是否取代 `global` 預設。
- CWA 需要使用者以安全方式提供／設定 credential；計畫不建立假 key 或繞過授權。
- CNA 是否納入取決於 RSS 穩定性、metadata/摘要再散布條款與圖片權利審查，不是 Release A 的硬性完成條件。
- 若 durable promotion/relevance audit 無法由既有 schema 清楚表達，允許 additive schema migration；不得把這些理由只藏在 raw metadata 或 frontend config。
