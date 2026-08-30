# 正式採用與回滾 Runbook

## 目的與授權邊界

本文件只定義 `G4 Formal adoption` 到 `G5 Product acceptance` 的操作順序。正式 runtime restart、正式 DB reprocess/backfill、commit 與 push 仍是四個獨立授權；任何一項都不由 source-level 測試自動授權。

Windows 本機 runtime 的唯一 owner 是 `scripts/atlas-tray.ps1`。採用時只能操作重新解析後、可證明屬於該 tray 的 backend process tree；不得依 image name broad-kill、建立第二個常駐 launcher，或改 port 繞過 ownership 問題。

## Gate A：採用前證據

1. 執行 `npm run verify:migration`。它以 read-only 方式開啟 `data/db/atlas.sqlite`，用 SQLite online backup 建立暫存複本，只在複本重播 migration，完成後刪除暫存目錄。
2. 要求 schema `4 → 5`、`PRAGMA integrity_check=ok`、`PRAGMA foreign_key_check` 無結果、所有既有資料表筆數不變。
3. 要求 `document_promotion_decisions` 與 `event_regional_relevance` 初始為空。Schema adoption 不得暗中執行無界 backfill。
4. 執行 `npm run verify` 與 `git diff --check`，確認 source、pipeline、selector 與 consumer contract 仍通過。
5. 執行 `npm run verify:isolated-adoption`，要求 copied runtime 為 schema 5／contract `1.2`／33 sources，且四種 presentation 的 REST/MCP ordered IDs 與 coverage gaps 相同。METI 必須是 disabled；不得為了通過 gate 改用 browser User-Agent。
6. 執行 `npm run verify:regional-live-copy`；除了七個 live provider 與 REST/MCP parity，正式 database/WAL/SHM/journal 身分必須前後一致。只看 `atlas.sqlite` 主檔不足以排除 WAL writer。
7. 執行 `npm run verify:runtime-preflight`，再重新解析 backend PID/command/parent、scheduled task、tray log 與最新 scheduler owner；不得沿用先前文件中的 PID。OS listener projection 必須以 direct TCP／health 交叉驗證；owned backend、health 或 scheduler 任一仍 active，就不得進 Gate B backup。

任一條失敗就停止 adoption，先修 migration、ownership 或測試問題。

## Gate B：正式 runtime adoption（需明確 restart 授權）

1. 由既有 tray owner 精準停止 owned backend；等待 database/WAL/SHM 身分在 bounded observation window 內不再改變。不得只因 8790 沒有 listener 就假設 writer 已停止。
2. 以 SQLite online backup 建立可恢復的正式 backup，保存建立時間、database/WAL/SHM identity、schema、source count 與來源 runtime identity。
3. 由同一 tray owner 啟動 working-tree backend。若 Scheduled Task 尚未安裝，先將 task installation 視為獨立 lifecycle 授權，不以第二個 launcher 暫代。
4. 啟動後立即驗證：
   - `/api/v1/health`：version `1.3.0`、schema `5`。
   - `/api/v1/capabilities` 或等價 projection：consumer contract `1.2`。
   - `/api/v1/sources`：registered `33`；NCDR active CAP、MOFA、MOD、JPCERT、JMA、FDMA、NDL 均 enabled，METI registered 但 disabled，且 health 不得把未執行的 provider I/O 顯示為 healthy。
   - 8790 只有一個 listener；backend 是 tray 的可驗證 child。
   - 執行 `npm run verify:formal-adoption`；runtime identity、七個 enabled sources、METI disabled 與四種 presentation REST/MCP parity 必須一次通過。
5. 不在本 gate 執行既有 Documents／Events 的全庫重算。

## Gate C：新來源 bounded collection

1. 只讓 scheduler 收集到期來源；不以 restart 觸發全來源無界 refresh。
2. 對 `tw-mofa-press-releases`、`jp-mod-news`、`jp-jpcert-alerts`、`jp-jma-eqvol`、`jp-fdma-disaster-info`、`jp-ndl-diet-minutes` 記錄首次正式 run：status、HTTP result、items、insert/update、duration、next due、failure reason。`jp-meti-latest` 不進 scheduler。
3. 至少觀察三次 success／not-modified，且跨越兩個 cadence windows。JMA 需另外確認 detail fetch 維持最多 6 份與 category cap；FDMA 要確認同 fragment revision 更新既有 Document，NDL 要確認單次仍只有一頁／最多 30 筆。
4. 單一來源失敗只停用該來源的 `SOURCE_<ID>_ENABLED=false` override；不得把 failure 包裝成 healthy，也不得連帶關閉其他區域來源。

## Gate D：reprocess/backfill（獨立授權）

1. 執行 `npm run audit:regional-reprocess`。它只在正式 DB 的 online-backup 暫存複本上輸出 Documents、Events、promotion 狀態、區域 relevance 與預估寫入量；若任何集合被 bound 截斷、eligibility change 不為 0 或出現 stranded Event，立即停止。
2. 執行 `npm run verify:regional-reprocess`。要求第一次 apply 完成 bounded writes，第二次 apply 為 0 writes；`event_locations` count／hash 不變，SQLite integrity／foreign-key check 通過。
3. 保存當次輸出並和 `ReprocessEvidence.md` 的先前 snapshot 比較。數量變動本身不是錯誤，但不得沿用舊 snapshot 當正式寫入清單。
4. 取得正式 DB reprocess 的獨立明確授權，授權內容需包含當次 Documents／Events 數量與預估 writes；預設不做未盤點的全庫 backfill。
5. PromotionDecision 先重算，RegionalRelevance 後重算；兩者都必須保留 method/version/reason/evidence。相同 semantic result 不更新 evaluated time，也不增加 Story update。
6. 正式 apply 後重跑同一範圍，要求 0 writes；抽查 source country 與 event country，JP/TW source scope 不得覆寫缺失的事件地點。取消、撤回、過期內容不得重新進入正常 highlights。

## Gate E：REST、MCP 與 UI 驗收

1. 執行 `npm run verify:formal-acceptance`；除了 formal runtime gate，七個 regional sources 必須已有 success/partial collection 與 usable health，三個 regional profiles 各至少選出一個 qualified Event。
2. 對 `global`、`east_asia`、`taiwan_focus`、`japan_focus` 保存 REST ordered Event IDs、selection metadata 與 `coverage_gaps`。
3. 以 modern MCP representative call 取得同一 profile；ordered IDs 必須和 REST 一致。Legacy projection 僅驗證相容性，不把它當 canonical contract owner。
4. 在 desktop 與 390px UI 實際切換 presentation；確認區域 profile 不再被忽略、沒有 global filler、缺資料時顯示 coverage gap，且 country filter 與 presentation preference 行為分離。
5. 檢查 Event detail 可追到原始 Document/evidence；不顯示來源國推測出的假 event country。

只有 runtime、REST/MCP、browser 三層證據都成立，才可宣告產品已不再由舊的 US/global-heavy brief selector 主導。

## 回滾

- Source transport 或 parser fault：先以單一 source override 停用，保留其他來源與 schema v5。
- Selector fault：回復 `global` presentation default，保留 canonical decisions/relevance，不刪資料。
- Migration fault：停止 runtime，重新驗證 backup identity，取得額外明確授權後才可還原；不得在 active writer 存在時覆寫 DB。
- Runtime ownership fault：停止 adoption，不反覆 restart；回到 PID/parent/command/listener/scheduled-task 的 component-owned lifecycle 診斷。
- 每次回滾都要保留 source health、error、時間與採取動作，不以刪 log 或清資料掩蓋問題。
