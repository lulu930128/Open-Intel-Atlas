# Macro 基準版本收尾

本次授權：完成既有七組 Macro 的收尾 checkpoint；不 push、不加新資料源、不處理 Event bridge、forecast、dot plot 或下一次發布延遲驗收。

## 提交邊界

`CheckpointFiles.txt` 是逐檔 staging 清單。首頁另採精準 hunk，只加入總體數據連結。既有 `.env`、DB、WAL、logs、runtime 證據、`.tmp` 不入 Git。

目前 HEAD 是 schema 5；正式服務的 schema 6–8、source-result、Entity/Company、分類與資料管線也未提交。Macro 使用同一個 server/store/collector/registry，不能只加入 Macro 目錄。這些既有 canonical backend 以明列的 dependency checkpoint 一起保存，不把它們說成本輪新增功能，也不任意拆除成熟的 owner 邊界。`src/` fingerprint 涵蓋完整 backend，避免留下只有 dirty tree 才能啟動的依賴。

Macro 導覽連結到股票頁，所以保存股票頁及它直接使用的 view model、CSS 與 API backend 依賴。首頁／domain 新聞版面、newsroom controller/style 改動、Tray/lifecycle 與其他任務文件仍留在工作目錄，不整包提交。

## 驗收順序

1. 補啟動 fingerprint、四種 capability 完整投影 parity、release-window evidence 欄位。
2. 正式 DB online backup 的隔離 runtime：七組 × 四種能力 parity、禁止 provider I/O、同一 owner connection total_changes 不變、FK、舊觀測保存。
3. 精準 stage，檢查 staged paths／diff／敏感資料；由 staged tree 匯出乾淨候選目錄。
4. 候選目錄執行 syntax、Macro、migration、source-result、scheduler、backend、Company/Entity、regional regression。共用已安裝且符合 lockfile 的 Node dependencies，不複製 `.env`。
5. 建立本機 checkpoint；確認 committed tree 等於受測候選內容。
6. idle 正式 owner 採用新程式，確認啟動 fingerprint 等於 checkpoint，重新驗證七組 parity。保留 backup，schema 不降版。

## 指紋定義

SHA-256 對排序後的檔名、長度、UTF-8 LF 內容雜湊，範圍為 `src/`、package/lockfile 與四個 Macro UI 檔案。排除 `.env`、資料、node_modules、非 Macro 頁面和 launcher。指紋於 server module 載入時計算，GET 只回傳保存值；不是每次 GET 重算磁碟狀態，也不是未受測的整個 repository clean 宣稱。啟動期間應保持來源檔案不變。

## 保留債務

Release latency 維持 unverified；歷史全量回填、SEP 點陣圖、Event bridge、consensus/surprise、OMI、新來源都不阻塞這次基準封版。六小時 Claims cadence 與 PDF raw archive 截斷限制保留。正式讀取證據只宣稱 source-run/observation count 不變；owner total_changes 的證據由隔離 runtime 提供。
