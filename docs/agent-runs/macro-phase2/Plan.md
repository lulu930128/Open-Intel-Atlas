# 施工計畫

1. 核对 baseline 與前置依賴，保留所有既有 dirty changes。
2. 抽出 group metadata；接入 BEA 官方發布與日曆，保持數值與來源邊界。
3. 補 release-window 唯讀 evidence 工具，缺少實際 timestamp 不推測。
4. 新增總體數據頁與各頁右側導覽入口；可查發布、指標歷史與 revisions。
5. targeted regression、bounded official sample、正式/隔離 UI 驗證分別記錄。

任何來源期間或口徑不明即 fail closed。測試失敗先修正。BEA 來源預設關閉；啟用前備份正式狀態。
