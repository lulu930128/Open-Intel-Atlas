# 四組官方 Macro 來源實作紀錄

2026-09-12；本機 working tree 已實作並由正式 runtime 採用，未 commit／push。

## 完成範圍

- `src/macro/sourceIndicators.js`：新增 18 個指標，合計 39 個；BLS 就業薪資 7、BEA GDP 5、DOL Claims 4、Fed 利率上下限 2。
- `src/macro/sources/expandedSources.js` 與四個 `*Parser.js`：新增四組 calendar/release 共八個 adapter。沿用 canonical store、scheduler、REST/MCP capability，不由前端重新判斷口徑。
- `pdfText.js`、`atlasHttp.js`：有上限的 PDF 下載與 Poppler 解析；透過 `MACRO_PDFTOTEXT_PATH` 設定，缺設定停用 DOL，不猜測資料。
- `migrationV11.js`、`store.js`、`capabilities.js`：additive schema 11，保存 FOMC typed decision、statement/implementation lineage、生效日期；date-only 不補成午夜。GDP stage 與本機 revision 保持分離，Claims 續領與初領分別保存週別，過舊發布會顯示 stale。
- `public/macro.html`、`public/macro.js`：七組系列切換、每列資料期間、GDP 階段、FOMC 決議與 artifact 連結。

## 驗證

- 相關 regression：65 passed，0 failed。涵蓋 Macro 四組測試、source-result、scheduler、entity/company schema/capability、backend、regional acceptance、JP/NCDR。
- 真實官方來源：`scripts/verify-macro-expanded-live.mjs --live`；八個 adapter 全部成功，新增 22 筆觀測，四組資料 complete，REST/MCP 一致；隔離 DB 讀取前後 `total_changes()` 不變，FK 違規 0。
- 隔離證據：`data/runtime/macro-sources-live-2026-09-12T05-18-53-363Z/proof.json`。此證據與以下正式採用證據分開保存。
- 備份：`data/db/backups/macro-generalization-2026-09-12T05-20-59-453Z/`，包含 schema 10 DB、原始 `.env`、migration copy 與 manifest。升級副本逐表舊欄位 digest 相同，integrity/FK 通過。
- 正式 runtime：2026-09-12 13:22 臺北時間啟動，PID 53620，8790，schema 11、51 sources；新八個來源全數 success。正式七組資料均 complete/current，REST/MCP data 一致，讀取未觸發新增來源採集；57 筆舊觀測逐欄相同，總計 79 筆，FK 違規 0。
- 正式證據：`data/runtime/macro-sources-formal-proof.json`。
- 正式瀏覽器：逐一切換 Labor/GDP/Claims/FOMC，核對本期 7/5/4/2 列、GDP 第二次估計、Claims 兩種週別、FOMC 生效日期與四份官方文件；FOMC 桌面 screenshot 確認布局。
- 最終 `npm run check`：137 files passed；`git diff --check` 通過。

## 已知限制

- 目前證明實際來源可採集與正式服務已採用；尚未在下一次發布窗口實測取得延遲，不宣稱零延遲即時。
- GDP 採最新官方估計及下一次發布日曆，歷史版本從後續觀測累積；未做全量歷史回填。
- Claims 只建立已發布日曆，不臆測節假日的下一次發布日期；預設六小時採集，另有八天發布年齡限制。
- DOL PDF 大於既有 raw archive 上限，明確回報 `raw_payload_archival_truncated`；數值由完整有界 PDF 解析，但 DB 並非完整 PDF 檔案庫。
- FOMC 一般會議 14:00 Eastern 為明示的排程政策；不當作官方日曆明示時刻。緊急會議／notation vote 不冒充一般會議。
- FOMC artifact 隨官方日曆連結收錄；本期有 statement、implementation note、minutes、press conference。SEP 非每次會議都有，未做點陣圖數值抽取或影音處理。
- 來源 HTML/PDF 改版可能使解析 fail closed；失敗保留 last-good 與可見狀態，不填零。

## 程式碼檢閱入口

先看 `sourceIndicators.js` 與 `expandedSources.js` 的資料契約和採集，再依序看四個 parser、`store.js` 的交易與 lineage 驗證、`capabilities.js` 唯讀投影，以及 `test/macro-expanded-sources.test.js`。新安裝仍預設關閉十三個 Macro adapter；本機 `.env` 已明確啟用。
