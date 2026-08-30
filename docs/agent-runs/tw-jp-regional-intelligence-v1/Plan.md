# Plan

## Milestones

| Milestone | Status at 2026-08-30 |
| --- | --- |
| 0 baseline | complete；證據在 `Baseline.md` |
| 1 provider foundation | complete；no-write probe、RSS 1.0、JMA Atom→XML bound 已完成 |
| 2 TW Release A | formal runtime adopted；MOFA／NCDR healthy/current 且 observation gate passed，TWCERT rights hold，CWA credential gate |
| 3 JP Release B | formal runtime adopted；JMA／MOD／JPCERT／FDMA healthy/current 且 observation gate passed，METI registered/default-disabled |
| 4 PromotionDecision／RegionalRelevance | source-level complete；held attachment fail closed、schema v5 replay 與 bounded copy apply-twice passed，formal full backfill pending |
| 5 regional brief selector | contract 1.2 已由 formal runtime 採用；Store pre-LIMIT candidate policy 與 MCP latest／brief country 修正 source-level passed，修正版 runtime adoption／product acceptance pending |
| 6 additional sources | partial；NDL metadata source-ready，立法院 hold，EDINET credential gate |
| 7 runtime/UI/consumer acceptance | G3 isolated runtime/UI passed；G4 formal adoption passed；G5 observation／browser product acceptance pending |
| 8 optional GDELT regional profile | pending |

### 0. 鎖定 baseline 與量測面

- Scope：registry、正式 runtime identity、source health、最近 Documents／Stories／Events、country/location/relevance 缺漏、首頁／brief mix。
- Acceptance：保存 source-level 與 live-runtime baseline；至少列出 TW／JP／US／global 的 source、Document、Event、brief exposure，unknown 與 missing 分開。
- Validation：read-only registry projection、`/api/v1/sources`、`/api/v1/events` cursor walk、`/api/v1/brief`、正式 launcher/process/DB identity。
- Stop：若正式 runtime 尚未採用目前 source tree，不用舊 runtime 統計判斷新 adapter 品質。

### 1. Provider transport、rights 與 reusable adapter foundation

- Scope：完成 `SourceMatrix.md`；診斷 MOFA Node timeout；補 RSS 1.0/RDF、JMA Atom→XML 等必要 parser contract；建立 `scripts/verify-regional-sources.mjs --source <id> --no-write` 類 bounded probe。
- Acceptance：每個候選都有 endpoint、authority、terms/attribution、response bound、cadence、catch-up、error taxonomy、media policy 與 enable/rollback 決策；不需 browser scraping subsystem。
- Validation：fixture parser；timeout／malformed／empty／304／429；三次 bounded live probe；`npm run check` 與 targeted tests。
- Stop：不得用關閉 TLS 驗證、無界 timeout、shell-only production transport 或偽裝瀏覽器來宣稱 provider ready。

### 2. Release A：台灣 official coverage 收斂

- Scope：總統府、行政院 isolated/full runtime adoption；MOFA transport；NCDR active CAP；CWA credential gate；評估 TWCERT。CNA 只在 rights 通過後加入。
- Acceptance：TW source health 與 failure reason 在 API/UI 可見；新官方 press releases 保持 Document-first；TWSE／CWA 等 structured event sources保留各自 domain contract。
- Validation：source-specific fixture、isolated DB idempotency、source health projection、正式 adoption 後 24h 或至少三個 cadence windows 觀察。
- Stop：沒有 credential 不啟用 CWA；NCDR feed-level rights 不再是 `Public Domain` 時立即 fail closed；TWCERT/CNA rights 不明不持久化全文或開圖片。

### 3. Release B：日本 official core

- Scope：JMA hazards、MOD politics、JPCERT technology、FDMA response/damage；METI 只有在 compliant product transport 通過後啟用。
- Acceptance：
  - JMA 以 provider EventID、InfoType、Serial、TargetDateTime 建立可更新的 observation lineage，不把 Atom entry URL 當最終 Event truth。
  - MOD 保留發布者、原始時間、URL、日文語言與 Document-only 預設。
  - JPCERT 解析 RSS 1.0/RDF，使用 CVE/JVN/advisory identity 去重，不和 NVD/CISA/OSV 重複增加 independent source count。
  - FDMA 保留 provider fragment incident identity 與 revision date；無 structured location 時只形成 source-scope relevance，不偽造 event country。
- Validation：JP fixture、timezone/serial/update/cancel tests、cross-source security dedupe integration、bounded live probe、isolated runtime。
- Stop：JMA schema／serial update 處理未通過前，不把高頻 feed 接入正式 scheduler。

### 4. Canonical PromotionDecision 與 RegionalRelevance

- Scope：把 Event promotion 從 adapter boolean 收斂到 backend deterministic policy；建立可稽核 reason/method/version；將 location、source scope、actor/entity relevance 分開。
- Acceptance：
  - routine press release 預設 `hold`；structured hazard/security/material disclosure 依明確 provider fields 與 policy 決定。
  - Story 可在 evidence 累積後重新評估；promotion 可重算、可回滾、保留歷史理由。
  - `event_country` 只來自 location evidence；`regional_relevance` 可來自 actor/entity/source scope，但必須帶理由且不覆寫 location。
  - retracted/corrected/disputed evidence 不會被 selection 當正常新 Event。
- Validation：pipeline/DB migration、bounded copy audit、apply-twice 0-write idempotency、event-location hash invariant、同事件 TW/JP official+publisher+aggregator synthetic integration、geo negative tests。
- Stop：若理由只能藏在 frontend 或 raw metadata，暫停並完成 canonical contract／migration 再繼續。

### 5. Backend regional brief selector 與 outward contract

- Scope：在 `atlasCapabilities`／store query 建立 versioned selector；additive 支援 `global`、`east_asia`、`taiwan_focus`、`japan_focus`，UI/MCP 只傳 profile/preference。
- Selection order：quality/freshness/retraction gate → dedupe → severity/verification/recency score → soft regional diversity → per-source/per-story cap。
- Acceptance：
  - `target_share` 是 soft target，不是 quota；沒有合格內容時回傳較少項目與 coverage gap。
  - 任何 profile 都不改 Event verification、severity、confidence 或 location truth。
  - outward envelope 回傳 selector version、preference、candidate/selected counts、unmet targets 與原因碼。
  - 同一 input 在 REST/MCP/UI 取得一致 ordered IDs。
- Validation：deterministic selector unit tests、all-US／TW-one-item／JP-stale／duplicate／retracted fixtures、API contract、MCP representative call。
- Stop：不得由 frontend `GET all` 後自行排序或用 hard quota 插入低品質內容。

### 6. Release C：primary evidence 與 coverage gap 補齊

- Scope：本批採 NDL meeting metadata；立法院等新 stable API、EDINET credential 與 CNA rights；每批最多 2–3 個來源。FDMA 已回歸 Release B，METI 維持 transport hold。
- Acceptance：新增來源補的是明確 domain/relevance gap，而不是只增加 source count；legislative/session/disclosure records 有 stable identity 與 materiality policy。
- Validation：每來源走同一 source-ready → fixture → isolated runtime → formal adoption → observation 流程。
- Stop：若新來源不改善 dedicated evidence 或只複製既有 aggregator coverage，保持候選而不實作。

### 7. 正式 runtime adoption、UI 與 consumer acceptance

- Scope：經使用者確認後，依 Release A/B/C 分批採用；觀察 scheduler、DB、API、Newsroom、domain pages、MCP。
- Acceptance：
  - 正式 runtime source identity 與 source tree 一致；DB migration/quick check 正常。
  - desktop 與 390px 首頁顯示 backend-selected regional mix、selection profile、freshness/coverage gap；無 overflow、console error 或假座標。
  - `country=TW|JP` 與 presentation preference 行為分離；Event detail 可追到原始 evidence。
  - source failure 只降低對應 slice，其他來源持續服務。
- Validation：`npm run check`、`npm test`、API cursor/brief probes、MCP modern/legacy smoke、browser DOM/screenshot、24h source-health observation。
- Stop：source tests 或 health endpoint 不能取代 browser/runtime proof；任一批 adoption 失敗先停該 source，不連帶開下一批。

### 8. Release D：GDELT regional discovery（最後、可選）

- Scope：保留單一 `gdelt-doc` implementation owner，只新增 TW/JP query profiles／schedule definitions，不複製 service。
- Acceptance：original publisher lineage、跨 profile dedupe、quota/backoff、global profile rollback 全部成立；discovery 不提高 authority/verification。
- Validation：query fixture、cross-profile duplicate test、bounded live sample、health observation。
- Stop：global GDELT health 尚未收斂或 provider 連續失敗時，不加入 regional profiles。

## Release gates

| Gate | Meaning | Evidence required |
| --- | --- | --- |
| G1 Source-ready | code/contract 可用 | registry、fixture、targeted tests、bounded live sample |
| G2 Pipeline-ready | canonical promotion/relevance 正確 | DB/pipeline integration、idempotency、lineage、negative tests |
| G3 Isolated runtime | 不碰正式 DB 的可執行證據 | temp/copy DB、source health、API/MCP smoke |
| G4 Formal adoption | 正式 launcher/runtime 採用 | explicit approval、process/build/DB identity、health |
| G5 Product acceptance | 使用者實際看到正確結果 | browser desktop/mobile、brief IDs、detail lineage |
| G6 Publication | commit/push/release | exact diff、secret scan、commit/push evidence；另行授權 |

## Stop-and-fix rules

- 任一來源 fixture、live transport、idempotency、rights 或 attribution 失敗，停該來源，不以 fallback fake Document/Event 繼續。
- promotion false positive、source country 污染 event country、aggregator 增加獨立來源數時，先修 canonical policy，再做 presentation。
- selector 為達比例選入 stale、retracted、duplicate 或低於品質門檻的項目時，該 milestone 不通過。
- 正式 runtime 與 source tree 身分不一致時，停止 UI/product acceptance claim。
- 需要 credential、runtime restart、正式 DB reprocess/backfill、commit/push 或外部付費行為時，先取得明確確認。

## Decisions

- 2026-08-30：不照附件原順序一次增加所有 TW/JP feed；先修 transport/rights，再完成 promotion/relevance/selector，避免只有 Document count 增加而產品仍 US-heavy。
- 2026-08-30：第一批 JP 先完成 JMA、MOD、JPCERT；後續 preflight 讓 FDMA 與 NDL 通過 source-level gate。METI 因 compliant Node HTTP 403 維持 default-disabled，立法院舊 API current-term 回空而 hold。
- 2026-08-30：CNA 是 professional media，不算 official；rights 未確認前不是 TW launch blocker。
- 2026-08-30：TWCERT/CC RSS 因官方明示僅供閱讀且禁止未授權再利用而 hold；改採 feed 自身宣告 `Public Domain`、官方文件允許程式介接的 NCDR active CAP，維持 source scope 與 event location 分離。
- 2026-08-30：regional preference 只影響 presentation，不改 verification、severity、confidence 或 Event truth。
- 2026-08-30：將 Event creation、evidence attachment 與 evidence support 拆成 canonical helpers；普通 held Document 對 Event fail closed，只有 provider 明確標記 `evidence_support=true` 才可附掛並參與 verification/relevance，且不能自行建立 Event；cancelled 只保留 correction lineage。
- 2026-08-30：bounded reprocess 只重建 evidence composition 與其衍生 verification/relevance；不得藉回填重算既有 lifecycle、identity、severity、time 或 location。
- 2026-08-30：GDELT regional profiles 排最後，且必須沿用單一 implementation owner。
