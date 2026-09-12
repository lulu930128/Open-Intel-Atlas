# Macro Intelligence 第一版

## 目標

在既有 OLA backend／SQLite／Source Registry 內提供美國 CPI、Core CPI、PPI final demand、PPI excluding foods and energy、PPI excluding foods/energy/trade services 的官方指數、MoM、YoY、發布日曆與不可覆寫的修訂歷史；REST／MCP 共用唯讀 capability。

## 限制

- 保留既有未提交變更；不 commit、push、重啟正式服務或直接操作正式 DB。
- 公告表格為發布取得途徑；不以 BLS API 或 FRED 保證發布延遲。FRED 既有 Document 保留，Macro capability 僅讀 Macro canonical store。
- 明確保存 SA／NSA、reference period、官方時間語意、首次取得時間、raw fetch lineage；未知值不是零。
- 共用 collector／lease／退避；發布窗口每分鐘 bounded check，其餘低頻。失敗不得繞過 backoff。
- 不做市場利多利空、consensus、交易訊號；不擴充其他國家、PCE、GDP、FOMC 或重做 UI。

## 驗收

正式 production path 的 fixture／SQLite／scheduler／REST／MCP 測試；官方 bounded sample parser 驗證。正式 runtime adoption 與下次發布窗口的實測延遲分開記錄。
