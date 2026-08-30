# Progress

## Status

- Current phase: Milestone 0–6 source-level complete、G3 isolated runtime/UI passed、G4 formal runtime adoption passed；held evidence／regional candidate／MCP country contract 已完成 source-level 與 bounded copy validation；formal full backfill、部分來源 observation 與 G5 product acceptance pending
- Last updated: 2026-08-30 Asia/Taipei

## Completed

- 重讀 product vision、operating model、quality bar、roadmap 與 canonical Source/Document/Story/Event/brief owner。
- 完成目前 runtime 的 read-only identity、source health、全量 Documents／Events 與 brief exposure 基準，詳見 `Baseline.md`。
- 確認目前 runtime 已採用 26-source tree；總統府與行政院均為 enabled、healthy、current。這項 adoption 在本里程碑前已發生，本計畫沒有執行 restart。
- 將已完成的 `tw-official-sources-v1` 納入本計畫前置成果，而不是重做。
- 確認目前可見性缺口：總統府／行政院／外交部為 Document-only，brief 仍直接使用 recency page 前 8 筆。
- 以官方頁面確認日本第一批結構化候選：
  - JMA 防災 XML PULL／Atom feeds。
  - MOD 報道資料 RSS 2.0。
  - JPCERT/CC RSS 1.0／RDF。
- 將 source expansion、promotion/relevance、regional selector、runtime/UI acceptance 拆成獨立 gates。
- 全量 cursor 盤點 1,153 Documents 與 527 Events：TW dedicated official Documents 41、JP dedicated Documents 0；Event country 為 TW／JP 各 1、US 119，另有 393 筆缺 country truth。
- 當次 brief 8 筆為 NWS 1、BBC 3、OSV 4，TW／JP exposure 均為 0。
- 建立 `scripts/verify-regional-sources.mjs --source <id> --no-write`，輸出 bounded fetch／Document contract evidence，不寫 DB。
- 修正 shared feed parser 的 RSS 1.0 `dc:identifier`／`dc:date` 支援。
- 完成 JP Release B 第一批 source-level 實作：
  - `jp-mod-news`：官方 RSS、相對 URL 安全 resolve、routine Document-only。
  - `jp-jpcert-alerts`：只納官方 `/at/` alerts、CVE event key、promotion fail closed。
  - `jp-jma-eqvol`：Atom index、最多 6 份 actual event XML、EventID／Serial／InfoType、取消處理、兩種 coordinate 格式；不以 source country 偽造 event country。
- 完成第二批日本官方底層來源 preflight／實作：
  - `jp-fdma-disaster-info`：官方災害 RSS、provider fragment incident identity、revision date freshness、structured Event；沒有 location 時只形成 JP／EAST_ASIA relevance。
  - `jp-ndl-diet-minutes`：官方 meeting-list JSON、單頁最多 30 筆、保留 next position、metadata-only／Document-only，不保存 speech text。
  - `jp-meti-latest`：registry、fixture、domain projection 與 isolated pipeline 完成；compliant Node transport 固定 HTTP 403，因此 default-disabled，沒有使用 browser spoof。
  - 立法院舊 API current-term 回空、新 PPG 未找到公開 stable API；EDINET 明確需要 API key，兩者維持 hold/gate。
- 完成台灣第四個新增專用來源 preflight／實作：
  - `tw-ncdr-active-cap-alerts`：官方 active CAP Atom、feed-level `Public Domain` contract、單次最多 100 Documents、CAP status/msgType/effective/expires 與原發布機關 lineage；不從摘要猜 location 或 event country。
  - Atlas Node no-write probe HTTP 200／793 ms／1 fetch／95 Documents／payload 未截斷；fixture 與 isolated store apply twice 通過。
  - TWCERT/CC 雖有官方 RSS，但官方條款限定僅供閱讀並禁止未授權再利用，因此 rights hold，不實作、不以內部 API 繞過。
- MOFA 完整 OpenData RSS/XML/JSON/CSV 實測為 2.5–3.5 MB，且沒有 ETag／Last-Modified；改用官方新聞稿第一頁 `PageSize=30`（約 245–250 KB response、約 204–208k characters），保留 30 筆 metadata/original links、date precision 並在 DOM contract 不符時 fail closed。後續 formal runtime 已採用並顯示 healthy/current。
- 完成 schema v5 additive canonical contract：
  - `document_promotion_decisions` 保存 promoted／held／cancelled、reason codes、method/version 與 evaluated time。
  - `event_regional_relevance` 分開保存 TW／JP／EAST_ASIA score、reason/evidence、method/version，不修改 `event_locations.country_code`。
  - JMA `InfoType=取消` 會形成 durable cancelled decision，收斂既有 Event 為 `lifecycle=cancelled`／`verification_status=retracted`。
- 完成 backend regional brief selector 與 REST/MCP 共用 contract `1.2`：`global`、`east_asia`、`taiwan_focus`、`japan_focus`；先過 freshness／verification／lifecycle gate，再做 relevance ranking 與 soft domain diversity。
- 區域 profile 沒有足夠合格 Event 時回傳較少 highlights 與 `coverage_gaps`，不以 global filler 補數量。
- 建立 `scripts/verify-schema-migration.mjs` 與 `npm run verify:migration`：以 read-only source connection 對正式 SQLite 做 online backup，只在暫存複本重播 migration，完成後自動刪除複本。
- 完成 schema v4→v5 正式資料複本演練：156,823,552 bytes／38,287 pages；既有 18 張資料表筆數完全一致，兩張新 audit table 初始為 0。
- 建立 `AdoptionRunbook.md`，將正式 backup、tray-owned restart、bounded collection、reprocess、REST/MCP/UI acceptance 與回滾拆成明確 gates。
- 建立 `scripts/verify-isolated-adoption.mjs` 與 `npm run verify:isolated-adoption`，在正式 DB online-backup 複本上啟動 scheduler-disabled ephemeral runtime，完成 working-tree runtime identity 與 REST/MCP parity gate。
- G3 isolated runtime：schema 5、contract `1.2`、33 sources、coverage `partial`；NCDR、MOFA、MOD、JPCERT、JMA、FDMA、NDL enabled／health `unknown`，METI disabled／health `disabled`，沒有以未執行的 provider I/O 偽裝 healthy。
- G3 regional brief：global 選 8；east_asia／taiwan_focus／japan_focus 因舊資料尚無 relevance rows 選 0 並回傳 coverage gaps；REST/MCP ordered IDs 與 gaps 完全一致，沒有 global filler。
- Newsroom 新增 `global`／`east_asia`／`taiwan_focus`／`japan_focus` 摘要視角控制；frontend 只傳 backend presentation preference，Hero 與 Live Desk 都以同一 brief highlights 驅動。
- 區域視角為空或 request 失敗時不沿用 global／上一個視角內容；UI 顯示 backend coverage gaps，URL query 可保存與重載選擇，global 維持 compatibility default。
- 建立 canonical bounded reprocess seam：`planRegionalReprocess` 先檢查 truncation、eligibility change、stranded Event 與 semantic write candidates；`applyRegionalReprocess` 對 unsafe plan fail closed，且不為 evaluated time 單獨產生 write。
- AtlasStore 提供局部 PromotionDecision／RegionalRelevance persistence；relevance backfill 只替換該 Event 的 relevance 並新增對應 Story update，不重寫 event locations 或其他 Event relations。
- 建立 `npm run audit:regional-reprocess` 與 `npm run verify:regional-reprocess`，正式 DB 只作 read-only online backup，盤點與 apply-twice 全部在暫存複本完成。
- 建立 `npm run verify:regional-live-copy`：在正式 DB online-backup 複本執行七個台日 live providers、schema v5 migration、ephemeral REST/MCP parity；正式 DB/WAL/SHM/journal 只做身分比對。
- Live-copy provider/consumer checks 通過：七來源皆 HTTP 200、211 Documents、97 Events、13 fetches、0 truncation；east_asia／taiwan_focus 各選 8，japan_focus 選 2 並回 truthful shortfall；REST/MCP parity 0 errors。
- 加強 WAL identity 後整體 gate 正確失敗：tray PID 56848／backend PID 50116 與 scheduler owner 仍 active，正式 WAL 在 rehearsal 期間改變；後續 direct TCP／health 證明舊 runtime 仍在線。詳見 `RuntimeAdoptionPreflight.md` 與 `LiveCopyAdoptionEvidence.md`。
- 新增 `npm run verify:runtime-preflight`，共同驗證 tray/backend lineage、PID existence、direct TCP／health、DB/WAL/SHM/journal identity 與 scheduler delta；current runtime 因仍 active 而 `safe_for_backup=false`。
- 新增 formal outward gates：`npm run verify:formal-adoption` 驗證 schema v5／contract 1.2／33 sources／source enablement／REST-MCP presentation parity；`npm run verify:formal-acceptance` 再要求七來源 live health 與三個 regional profiles 各至少一個 qualified Event。
- Formal product gate 現在另以 read-only `source_runs` 要求每個 enabled regional source 最近三次連續 usable，且第一／第三次至少跨兩個 source cadence windows；一次成功不再能冒充 observation complete。
- 建立 `AcceptanceMatrix.md`，逐項區分 G1–G3 已證明、formal evidence 未完成、contract hold 與 optional scope；completion decision 不以 full test green 取代 G4/G5。
- 拆分 PromotionDecision 的三種責任：Event creation、evidence attachment、evidence support。held-only／held+held／cancellation-only Story 都不建立 Event；普通 held 對 Event attachment fail closed，只有明確 `evidence_support=true` 的 held official Document 可加入既有 Event lineage、verification 與 RegionalRelevance，且不接管 representative、location、severity 或 identity；cancelled 只作非支持 correction lineage。
- JPCERT、MOD、METI、NDL、總統府、行政院與外交部的 Document-only official evidence 改為 provider 明確 opt-in `evidence_support=true`；一般 held Document 不會被自動當成支持證據。
- regional brief 不再先取 global 最新 N 筆再過濾；Store 以 `event_regional_relevance` 直接形成區域候選集，並在 DB `LIMIT` 前套用 selector-owned freshness／lifecycle／verification prefilter；`east_asia` 使用 canonical `EAST_ASIA` 關聯，避免合法區域 Event 被 global cap 餓死。
- MCP `atlas.latest` 與 `atlas.brief` 都提供與 REST 一致的 ISO alpha-2 `country` input；`country` 是 Event location truth filter，`presentation` 是 selection preference，兩者維持獨立且可交集。
- bounded reprocess 可重建 evidence composition 與衍生 verification/relevance，並刻意保留既有 lifecycle、identity、severity、time、location；audit 現在輸出 change reasons，阻止時間推移造成的 219 筆非本任務 lifecycle rewrite。

## Validation evidence

- Milestone 0 只執行 read-only runtime/API 盤點，未修改 runtime 或 DB。
- Product docs 與相關 source/pipeline/brief code 已讀回。
- 官方 source documentation 與 JP feeds bounded live adapter samples 均已確認。
- JP bounded live adapters：MOD 40 Documents／1 fetch；JPCERT 6 alerts／1 fetch；JMA 6 Documents／7 fetches。所有 payload 在 configured response bound 內。
- JP/TW targeted tests 12/12；JP isolated canonical store 對三來源各跑兩次，第二次均 inserted 0／updated 1，總計 3 Documents、1 JMA Event。
- `npm run check`：syntax 63 files passed；`npm test`：full suite 79/79 passed，新增 ordinary-held fail-closed、reprocess removal metric、MCP brief country parity 與 250 stale candidate starvation regression。
- `npm run verify:migration`：schema 4→5、migration versions 1–5、`integrity_check=ok`、foreign-key violations 0、count mismatches 0；正式 DB 只以 read-only connection 開啟。
- 最新 `npm run verify:isolated-adoption`：passed；copy 182,841,344 bytes，ephemeral port 9839，scheduler disabled，schema 5／contract `1.2`／33 sources，四種 presentation 與 `JP+global`／`US+japan_focus` REST/MCP ordered-ID parity errors 0；Japan focus 在 current source selector 下選到 4 筆並保留 truthful shortfall。
- Targeted regional UI tests：14/14 passed，涵蓋 canonical presentation query、no-global-filler、Hero/Live Desk 共用 brief、visible gap 與 760px responsive rule。
- In-app browser isolated preview：desktop 與 390×844 均無水平 overflow；四個視角切換與 URL reload 通過；台灣／日本／東亞 empty/gap state 可見；console error/warning 0。隔離 port 已關閉，暫存 DB 已刪除。
- `npm run audit:regional-reprocess`：copy snapshot 1,181 Documents／532 Events，無 truncation、eligibility change 0、stranded Event 0；預估 held 147／promoted 1,034，TW relevance Event 1、JP 1、EAST_ASIA associations 2。
- `npm run verify:regional-reprocess`：copy 第一次寫入 1,181 decisions 與 2 Events／4 relevance rows，Story updates +2；第二次 0／0 writes；291 event locations 的 count 與 SHA-256 不變，integrity ok、foreign-key violations 0。
- Targeted reprocess／backend regression：7/7 passed；schema-only fixture 第一次 apply 1 decision／1 relevance Event，第二次 0 writes，Japan brief 可見且 event country 不變。
- FDMA／METI／NDL targeted tests：7/7 passed；registry、fragment identity、revision timestamp、official-host fail-closed、cross-domain metadata、bounded query、valid empty、isolated idempotency 與 no-fake-country 全部覆蓋。
- Live no-write probes：FDMA HTTP 200／1 fetch／15 Documents／payload untruncated；NDL HTTP 200／1 fetch／30 Documents／payload untruncated。METI compliant Node request HTTP 403，truthfully fail closed。
- NCDR targeted tests 4/4 passed；live no-write probe HTTP 200／793 ms／1 fetch／95 Documents／payload untruncated；isolated store apply twice 後 1 Event、0 locations、TW/EAST_ASIA relevance 各 0.75。
- MOFA bounded HTML-list tests 6/6 passed；source uses the official first page, preserves date precision, creates Document-only evidence, and fails closed on an unrecognized DOM.
- `npm run verify:regional-live-copy` provider/consumer layer passed；the strengthened overall run intentionally failed because the formal WAL changed during the rehearsal, proving the active-writer guard works.
- Adoption 前的 `npm run verify:runtime-preflight` baseline：direct TCP／health 前後成功、schema 4／contract `1.1`／26 sources、owned backend active，因此當時 `safe_for_backup=false`。
- Adoption 前的 `npm run verify:formal-adoption` baseline 如預期 fail closed；精確列出 1.1/4/26、MOFA disabled、其餘七個新 registry entries 缺失，以及四種 presentation selection metadata 缺失。此項只保留為歷史對照。
- Adoption 前的 `npm run verify:formal-acceptance` baseline 如預期 fail closed；當時沒有來源達到三次／兩 cadence observation gate。此項已由下方 21:15 新 snapshot 取代。
- 2026-08-30 21:15 Asia/Taipei `npm run verify:formal-adoption`：passed；正式 runtime 1.3.0、schema 5、contract `1.2`、33 sources、scheduler enabled，七個 enabled regional sources healthy/current，四種 presentation REST/MCP ordered IDs parity 全數成立；METI 保持 disabled。
- 同次 `npm run verify:formal-acceptance`：runtime gate passed、product gate fail closed；NCDR、JMA、FDMA 已達三次／兩 cadence，MOFA、MOD、JPCERT 僅兩次，NDL 僅一次。
- 2026-08-30 21:43 Asia/Taipei 再次 read-only `verify:formal-acceptance`：MOFA、MOD、JPCERT 已達三次／兩 cadence；只剩 NDL 1 次未達 observation gate。正式 Japan focus 仍選 2 筆並 truthfully 回報 shortfall。
- 最新 `npm run audit:regional-reprocess`：read-only source＋temp copy 完整盤點 1,381 Documents／632 Events，無 truncation、eligibility change 或 stranded Event；在新的 held fail-closed policy 下 evidence rebuild／新增 supporting links／非支持 evidence removals 都是 0，只剩 1 個 relevance-only candidate，event location changes 0。
- 最新 `npm run verify:regional-reprocess`：只在 temp copy apply；第一次 1,381 promotion writes、0 event rebuilds、1 relevance write，第二次全為 0；Event 632／evidence 1,156／location 294 筆與 evidence/location SHA-256 不變，integrity ok、foreign-key violations 0。
- 最新 `npm run verify:migration`：schema 5 replay 前後 20 張表筆數一致，migration versions 1–5、integrity ok、foreign-key violations 0；只讀正式 DB 並寫入 temp copy。

## Decisions made

- Provider transport/parser foundation 已完成；後續來源一律先走同一 no-write probe。
- Source count 不作完成指標；以 dedicated evidence、truthful health 與 product-visible qualified mix 為主。
- PromotionDecision 與 RegionalRelevance 必須由 backend canonical owner 擁有，frontend 只傳 presentation preference。
- 日本來源分批加入：第一批 JMA／MOD／JPCERT，第二批 FDMA／NDL；METI、立法院與 EDINET 依各自 transport／API／credential gate 保持 hold。
- 台灣新增專用來源以 rights gate 優先：TWCERT/CC 因僅供閱讀而 hold；NCDR active CAP 因官方程式介接文件與 feed-level `Public Domain` 宣告通過 source-ready。
- Canonical URL 已新增 provider opt-in fragment identity seam，供 FDMA record 使用；JPCERT Weekly Report sections 仍需另定 section identity 與 promotion policy，不因 seam 存在就自動納入。
- JMA 每次最多 6 個 detail fetch，並以 category cap 避免火山高頻報告排擠地震／津波。
- `global` 保持預設 presentation 以維持既有 consumer compatibility；區域 UI 預設是否切為 `east_asia` 留到正式 adoption 後依實際 coverage 驗收，不在資料尚未採用時先做展示假象。
- held 不再同時代表「不可建立 Event」與「不可進 evidence」；attachment 與 support 都必須由 provider metadata 明確 opt-in，普通 held fail closed，cancelled 只作 correction/cancellation lineage，不作正向支持。
- reprocess 的 canonical write surface 限於 promotion audit、evidence composition 與 regional relevance；lifecycle aging 屬另一個政策／排程責任，不可混入 backfill。

## Known issues / risks

- Windows 拒絕讀取 runtime 的完整 process command line；已驗證 listener、PID、Node executable、start time 與 API source tree，但不推測 launcher arguments。
- Runtime coverage 為 `partial`；`gdelt-doc` 因 `ECONNRESET` 連續失敗並進入 backoff。
- MOFA 先前 timeout 本回合未再現；新的 bounded page live-copy run 為 HTTP 200／30 Documents／0 truncation，仍需 formal runtime cadence observation。
- CWA credential 尚未提供。
- METI 官方 Atom 對 compliant Atlas Node User-Agent 回 HTTP 403；Accept/content negotiation 與帶 contact 的產品 User-Agent 都未改善。Source registered 但 default-disabled。
- 立法院舊 Open Data API 的 current-term query 回空；新 PPG current content 尚無已確認的公開 stable API。EDINET API v2 需要 key。
- Schema v5 migration 本身刻意不做無界 backfill；正式 DB 的既有 Documents／Events 必須在獨立 reprocess gate 後才會補齊 promotion/relevance audit。
- Copy audit 顯示目前 snapshot 可安全 bounded apply，但正式資料可能在 scheduler 運作中改變；正式 backfill 前必須用新 backup 重跑 audit/apply-twice，並以當次預估 writes 重新取得授權。
- JMA cancellation 已收斂；其他 provider 的 correction/retraction mapping 仍需逐來源加入 structured status，不做 title keyword 猜測。
- Formal runtime 已採用 1.3.0／schema 5／contract 1.2，但本輪新增的 held-evidence、Store regional candidate 與 MCP country source changes 尚未經另一次 runtime adoption；source regression 不能冒充 live runtime proof。
- Formal DB 目前只自然累積 501／1,381 promotion decisions，尚未執行完整 backfill。先前舊 attachment policy 產生的 2-link copy 計畫已被新的 fail-closed policy 淘汰；最新 audit 為 0 evidence rebuild／0 additions／0 removals。後續新 runtime recollection 後仍要重新 audit，不能沿用任何舊計畫直接 apply。
- G5 仍未通過：最新 read-only formal acceptance 顯示 MOFA、MOD、JPCERT 已與 NCDR、JMA、FDMA 一起通過 observation gate，只剩 NDL 尚未達三次成功或 valid-not-modified 且跨兩個 cadence windows；Japan focus 目前只有 2 個 qualified Events，truthfully 回報 shortfall。

## Next step

- 下一個無寫入 gate 是等待 NDL 自然完成三次成功或 valid-not-modified 並跨兩個 cadence windows，再重跑 `verify:formal-acceptance` 與正式 Newsroom desktop/mobile、Event detail lineage、MCP acceptance。
- 本輪 source changes 的 runtime adoption／restart 與正式 DB reprocess/backfill 都仍是獨立授權；正式 backfill 前必須在新 runtime recollection 後重新跑 read-only audit，將當次 promotion、supporting-evidence、verification 與 relevance 預估 writes 重新提交確認。
- 本次 exact-scope commit/push publication gate 已由使用者授權；正式 runtime restart/adoption 與 DB backfill 仍未授權。實際 commit SHA 與 remote evidence 由本次交付回覆記錄。
