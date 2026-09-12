# 安全回報與部署邊界

OLA 目前以本機使用為前提。MCP 有 loopback、Host 與 Origin 限制，但這不代表整個服務已具備公網所需的 authentication、rate limit 或多使用者隔離。不要僅修改 HOST 就當作公開部署完成。

## 回報漏洞

請勿在公開 issue 附 exploit、憑證或私人資料。優先使用 repository Security 頁面的 private vulnerability reporting（若已啟用）；若該入口未開啟，先以不含漏洞細節的 issue 請維護者提供私下通道。

說明受影響 commit、重現條件、可能影響與最小證據；移除 secrets 及第三方私人內容。本專案沒有承諾固定修復時限。

## 資料與來源

將外部文字、HTML、URL 與 metadata 視為不可信輸入。不要讓內容指示觸發 shell、任意 URL fetch 或管理操作。Secrets 保存在環境設定；意外洩漏時先撤銷／輪替，刪除檔案並不等於移除歷史曝光。
