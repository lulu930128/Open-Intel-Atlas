# Macro 後端泛化

2026-09-12 使用者在計畫評估後授權實作。本輪交付既有 Macro engine 的通用底層；附件是需求與驗收參考，非執行指令。

範圍：month/week/quarter/year/event 期別、發布階段與版本身分、必要／選配指標的凍結完整性規則、時間欄位、發布窗口證據、artifact 儲存接點、後端顯示口徑及前端投影。

保留 CPI/PPI/PCE IDs、既有觀測與 raw/document lineage、REST/MCP 1.2 和 macro_v1 介面。查詢不抓取、不排程、不寫入。沿用 Source Registry → Collector/Scheduler → Store → Capability，不建立第二套資料來源。

Labor、GDP、Claims、FOMC 真實 provider、FOMC decision policy、Event bridge、forecast/surprise、OMI adoption 屬後續接入；本轮 synthetic fixture 不能當成正式資料證據。不得 commit/push 或回退其他 dirty work。

完成條件：相關 regression、正式 DB online backup、副本逐欄無損升級、正式 runtime schema 10、既有三組 REST/MCP parity 與前端驗證。
