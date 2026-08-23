# 變更紀錄

本專案的重要變更會記錄在此。版本號採用 Semantic Versioning。

## [1.1.0] - 2026-08-23

### 新增

- 建立 `Source → Document → Story → Event` canonical intelligence pipeline，保留 evidence lineage、來源執行狀態與版本化衍生方法。
- 接入 23 個政治、科技、金融與災害來源 adapter；缺少必要設定的來源會 fail closed。
- 新增 SQLite schema v2 scheduler state、lease、backoff、bounded catch-up、conditional GET 與 domain-scoped freshness。
- 新增 `/api/v1/*` versioned API，以及由 canonical store 投影的 legacy `/api/*` 相容介面。
- 新增 newsroom 首頁、事件／報導／搜尋詳情、資料缺口顯示與獨立全屏情報地圖。
- 新增 Windows tray runtime owner、登入排程安裝器、自我檢查與可重現啟動腳本。
- 新增產品方向、系統架構、資料模型、外部介面與任務驗收文件。

### 變更

- 預設 port 由 `8787` 改為 `8790`。
- `npm start` 改由 `src/atlasServer.js` 啟動 canonical runtime。
- 資料主儲存改為單一 `data/db/atlas.sqlite`；既有 category DB 僅保留在本機，不再由目前 runtime 讀寫。

### 已知限制

- GDELT 等公開來源可能 timeout 或 rate limit；系統會將 coverage 誠實標示為 partial 或 stale。
- Windows 關機期間，latest-only provider 的資料缺口無法完整補回。
- MCP、通知 delivery、public authentication、rate limit 與完整 correction/retraction workflow 尚未實作。
