# 二階段進度與驗收

日期：2026-09-12。本輪完成 PCE slice 與獨立總體數據頁，並非整份 Phase 2 路線圖封版。

## 已交付

- 官方 BEA 兩個 sources：bea-pce-release、bea-pce-calendar；經同一 Registry/Collector/Store 取得。每個 source 每次最多 2 個 HTTP requests，無 adapter retry、六小時 cadence，release watch 沿用既有 lease/backoff。
- 6 個新指標：PCE/Core PCE 月增、年增，current-dollar personal income/current-dollar PCE 月增。所有新指標為 percent、SA，月增不是年化增率；不包含 index level、所得/消費金額水準。
- 官方 release body/table 保留來源 URL、欄位、raw fetch 與 observed revision；BEA Document raw lineage 指向發布正文，不指向 discovery landing page。
- group metadata 管理 source/calendar ownership、official host 與 expected indicator count。既有 schema 9 表可直接容納新 metadata，未新增 DB/table 或宣稱 GDP/FOMC 模型已通用化。
- macro.html：本期數值、previous/revised_previous、發布日曆、來源狀態、指標歷史及修訂選項。首頁「資料說明」右側新增「總體數據」，domain/stocks 也有入口。
- 唯讀 evidence 工具：`node --env-file-if-exists=.env scripts/verify-macro-release-window.mjs US_CPI_2026-08`。輸出 `data/runtime/macro-release-windows/` 不覆寫先前 capture；綁定 observation lineage 區分舊表 HTTP success。實際 watch entry 與 before-health 未 instrument，保持 null；不自動通過 latency gate。

## 驗證

- `npm run check`：120 files passed。
- Macro/BEA 與 source-result、scheduler、entity、schema、backend、company、regional 相關 regression：52 passed、0 failed。
- BEA 官方 [July 2026 release](https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026) 真實樣本：10 observations；fixture 是官方選取的表格、標題、日期與必要正文，非新聞推算。PCE 定義参考 [BEA NIPA Chapter 5](https://www.bea.gov/resources/methodologies/nipa-handbook/pdf/chapter-05.pdf)。
- 正式啟用前 online backup：`data/db/backups/macro-phase2-2026-09-12T04-16-14-908Z/`，含原 .env，integrity_check=ok、foreign_key_check 無違規。
- 正式 runtime：8790，backend/listener PID 54660、runner 57924、原 Tray 30192。來源總數 43、指標 21、觀測 57（CPI 14、PPI 33、PCE 10）。BEA 兩個 source 成功；三組 coverage current/complete。
- 三組正式 REST/MCP data/coverage parity 通過，讀取期間 Macro run count 不變，正式 foreign_key_check 通過。證據：`data/runtime/macro-phase2-formal-proof.json`、`macro-phase2-owner-proof.json`。
- 正式 browser：首頁最右側入口實際點擊至 macro.html；CPI 6 筆、PCE 6 筆本期值可讀，Core PCE YoY 歷史選擇與 revisions checkbox 操作正常。390px viewport，document scrollWidth=375，无整頁水平溢出，數據表独立橫向捲動。手機 viewport 測試後已 reset。
- 隔離 503 preview：錯誤訊息「讀取失敗（HTTP 503）；請使用重新讀取」可見，重試按鈕可用，無假數值。正式來源未為測試故意停用。
- Release evidence 工具正式事後 smoke：parity=true、after_window、verified=false，沒有將發布後樣本冒充真實窗口驗收。

## Git checkpoint 與限制

- HEAD 的 atlasSchema 仍為 schema 5；工作樹既有 entity/company/schema 6–8、Source Result/pipeline 等變更未形成 checkpoint。Macro 的 save/pipeline/capability 接點依賴這批工作，單挑新增檔不構成可重現的獨立 commit。未 staging、commit、push 或移除其他 dirty changes。
- 原 v1 文件中的 41 sources/15 indicators 是該階段驗收快照；本輪當前數字以此文件與 README 為準。
- BEA 日曆目前取當期與 next release，非完整年度日曆。官方正文措辭或表格 header 變化會 fail closed；缺值不補零。
- 發布窗口連續 evidence、watch entry instrumentation、正式 latency acceptance 仍 pending；未建立額外背景排程或通知。
- Labor、GDP estimate stages、FOMC typed decision、Event bridge、forecast、OMI adoption 尚未實作。後續仍須逐 provider 定義／驗證，維持單一 canonical ownership。
