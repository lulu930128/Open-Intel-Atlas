# 進度

- 2026-09-12：開始實作。已確認 main 工作樹含大量既有變更，相關檔案另存本機 baseline 供 scoped diff。
- 官方 CPI／PPI 公告、表 1、PPI 表 3 與 release calendar 透過既有 Atlas HTTP client 各單次取得 HTTP 200。僅保存在 `.tmp/macro-v1-provider/`，未寫正式 DB。
- 已完成：15 個 indicator、官方表格／日曆 parser、schema v9、Macro store transaction、Source Result／pipeline 接點、bounded scheduler watch、REST／MCP 共用 capability、啟用與限制文件。
- 已完成：修訂追加、previous vintage 凍結、calendar schedule 歷史、query-bound cursor、raw archive 截斷揭露、不同 release 的 evidence Document 身份隔離。
- 原有 FRED adapter 未修改；Macro capability 不讀取其 Document，不形成平行 truth。
- 驗證：`npm run check` 通過 114 個 JS／MJS syntax checks；相關 regression 共 49 tests passed，其中 Macro 專項 11 tests。
- 官方來源：`node scripts/verify-macro-sample.mjs --live` 最後於 2026-09-12 執行成功。7 requests，26 個 release calendar entries，47 筆觀測；隔離 SQLite／REST／MCP parity、GET 無寫入、captured replay 冪等、foreign key check 均通過。實測報告：`.tmp/macro-v1-live-proof.json`。
- 差異檢查：依本輪起始 baseline 檢查既有檔案，修改集中於 Macro registration／transaction／schema 與對應版本、來源數、MCP 工具預期值。`git diff --check` 通過，新增檔 UTF-8 讀回通過。
- 初次程式交付未修改正式 `.env`、DB 或 Tray；隨後使用者授權備份與正式測試，已完成正式採用。未 commit／push。
- 正式 runtime adoption：passed；OMI consumer adoption、正式發布窗口延遲：pending；本次取得是發布後讀取，不是發布時量測。
- 延後範圍：BLS API 全歷史 backfill／ALFRED、其他國家與指標、Macro UI、Event promotion bridge。第一版歷史為官方當期表格窗口與之後累積的 Atlas observed versions。
- 2026-09-12 正式測試：schema 9 啟用前 online backup 與 `.env` 備份完成，完整性／外鍵通過；三個 flags 已啟用，原 Tray 重建 backend，8790 listener PID 49760 血緣驗證通過。
- 正式 scheduler 三個 BLS sources 均成功，47 筆觀測、本期 15 指標齊全。五組 REST／MCP parity、macro read stability、正式外鍵與 events API smoke 均通過，詳見 `Acceptance.md`。
- 下一步：在官方發布窗口量測取得延遲；目前未另建排程通知或 OMI consumer。
