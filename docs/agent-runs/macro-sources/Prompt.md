# Macro 四組官方來源接入

使用者授權接上 Labor、GDP、Jobless Claims、FOMC，完成後檢視實際程式碼。沿用 Source Registry、Collector/Scheduler、Macro Store、Capability、REST/MCP 及總體數據前端；不接 forecast、交易判斷或 OMI。

官方資料與 fixture 均保留 evidence URL、實際期別、單位、發布階段；FOMC 使用獨立 typed decision 與 artifacts，不以單一數值代表整份決议。新安裝來源預設關閉。保留其他 dirty work，不 commit/push。
