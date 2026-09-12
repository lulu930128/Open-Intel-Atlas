# 二階段：PCE 與總體數據頁

本輪使用者授權接續二階段並新增獨立前端，導覽列最右邊入口為「總體數據」。

範圍：既有 CPI/PPI 相容、metadata 管理來源與完整性、BEA PCE/Core PCE 月增與年增及個人所得/名目消費月增、發布窗口唯讀證據工具、獨立 macro.html 與歷史觀測/日曆/來源狀態。

維持同一 Registry、Collector、Store 與 capability。前端不抓官方資料，不重算 freshness、previous 或發布狀態。GDP/Labor/FOMC、Event bridge、forecast 與跨 repo OMI 分批後續，不宣稱完成整份路線圖。Git checkpoint 先盤點依賴；本輪未授權 commit/push。

驗收：官方 bounded sample、parser malformed/missing/ownership、既有 CPI/PPI regression、GET read-only 與 REST/MCP parity、desktop/mobile browser、錯誤與空資料呈現。正式發布延遲必須真實窗口證據，事後讀取不算。
