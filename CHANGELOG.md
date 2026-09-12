# 變更紀錄

本專案的重要變更會記錄在此。版本號採用 Semantic Versioning。

## 1.4.0 — 2026-09-12

- 發布七組官方 Macro 資料、schema 11、39 個指標與獨立總體數據頁面。
- 保存 canonical Entity/Company、source-result 與必要頁面依賴，維持單一資料庫與 scheduler。
- 新增啟動來源指紋、完整 REST/MCP parity 與發布窗口證據工具。
- 隔離提交候選 162 項測試通過。發布窗口延遲、歷史全量回填、dot plot、forecast/surprise、OMI 接入維持待驗收。

## 文件補齊 — 2026-09-12

- 重整公開 README 與文件入口，新增安裝、功能、維運、來源政策、API／MCP、開發與 GitHub 呈現指南。
- 補上 Support、Security、Contributing 與 issue／PR 模板。
- 文件依已提交 source 核對；不包含本機尚未提交的公司／總經擴充，也不重新宣稱 runtime、provider 或 consumer 驗收。

## 1.3 系列已提交整合

此節按 commit 補記先前未收錄的功能，不另宣告 release 日期。Application 版本為 1.3.0。

- `65b9ca2`：durable Consumer Gateway、Story／Event change feed、REST representation 與 MCP。
- `0b5a391`：evidence newsroom、Document media policy 與 canonical 架構收斂。
- `b852f29`：TW／JP 區域來源、PromotionDecision、RegionalRelevance 與區域 brief。
- `40e8348`：新增 Apache-2.0 LICENSE。

以上是 source 變更紀錄；來源可用性與正式採用需另驗收。後續規劃見 [Roadmap](docs/product/Roadmap.md)。

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
