# 參與貢獻

OLA 的核心是來源可追溯、資料限制可見與共用 backend 語意。先閱讀[開發指南](docs/guides/development.md)與[架構導覽](docs/architecture/index.md)。

## 提出變更

先搜尋現有 issue。較大的功能請描述使用情境、資料來源、owner、失敗狀態與驗收方式，再決定實作範圍。維持小而清楚的 diff，不加入無關升級或格式化。

新增來源需說明設定、使用限制、bounded IO、parser／empty／failure tests 與來源 lineage。不要以 fixture 成功宣稱 provider 或正式 UI 已驗收。

## Pull request

- 說明問題、行為改變與主要檔案。
- 列出實際執行的驗證、未驗證範圍與風險。
- 同步受影響的指南或 contract。
- 使用明確 commit message，例如 `docs: clarify source setup`。
- 不提交 secrets、私人設定、DB、raw payload、logs、暫存資料或 dependency 目錄。

純文件做 UTF-8、連結、Markdown 結構與 diff 檢查即可；程式變更依[開發指南](docs/guides/development.md)選擇相關 tests。

本 repository 的程式授權見 [LICENSE](LICENSE)；第三方內容另依來源政策處理。請只提交你有權提供的內容。
