# 運作模型

## 核心模組與責任

| 模組 | 負責 | 不負責 |
| --- | --- | --- |
| Source Registry | 來源身分、授權備註、cadence、必要設定、來源類型與啟停政策 | 抓取內容、判定事件真偽 |
| Collector / Scheduler | bounded fetch、timeout、retry、並行限制、排程、startup catch-up | 回應查詢時無界抓取、跨來源推論 |
| Normalization | URL、時間、語言、文字、stable ID、bounded raw、Document contract | 把新聞直接升格為已證實事件 |
| Intelligence Pipeline | 去重、Story clustering、Event 建立、entity／geo、evidence lineage、verification | 消費端特定商業判斷 |
| Canonical Store | 保存來源執行、Document、Story、Event、Evidence、Brief 與 schema version | 以 UI snapshot 取代 canonical data |
| Query/API Service | versioned query、filter、pagination、freshness／coverage envelope | 替 caller 隱藏缺漏或直接呼叫 provider |
| UI | 呈現 overview、timeline、evidence、source health 與查詢操作 | 重新計算 severity、confidence、freshness |
| MCP Adapter | 將 canonical API 投影成少量 read-only tools/resources | 自己抓新聞、分類或生成另一套真相 |
| OMI Adapter | 取得 Atlas evidence 並交給 OMI 的市場語意層 | 讓 Atlas 決定投資或交易含義 |
| Kuro Adapter | 取得 compact brief、story update、來源連結 | 讓 Atlas 決定人格、措辭或通知 UX |

## 真相來源

- 來源定義與使用限制：version-controlled Source Registry。
- provider 實際執行狀態：`source_runs`，而不是設定檔中的預期狀態。
- 外部取得的內容：bounded `raw_artifacts` 與 normalized `documents`。
- 跨來源故事與結構化事件：canonical `stories`、`events` 及其 evidence relation。
- freshness、coverage、verification：由 backend 根據保存的來源執行與 evidence 計算。
- UI、API、MCP、OMI 與 Kuro：都只是上述 backend truth 的 consumer，不可各自建立不同定義。
- LLM 輸出：帶 model、prompt/version、input evidence IDs 與 generated time 的衍生 artifact；不能覆寫原始 evidence。

## 權限與確認邊界

- v1 對外工具以 read-only 為預設；查詢不應觸發任意外部 fetch 或資料刪除。
- scheduler 可以依已核准 Source Registry 自動抓取；新增來源、提高 quota、修改保存政策或啟用付費 provider 需要明確設定與審核。
- refresh、backfill、reprocess、重建索引與資料清理屬管理能力，必須和 public API/MCP 分離，保留 audit log 與 bounded scope。
- `caller_profile`、query parameter 或 MCP tool 名稱只可描述用途，不是授權依據。對外權限必須由 server-side authentication 與 policy 決定。
- 若未來加入 webhook、通知或其他外部 side effect，預設採 opt-in、idempotency key、重試上限與 delivery log。

## 外部整合邊界

### OMI

Atlas 提供政治、科技、金融、災害等故事的 evidence pack、發生時間、來源、實體、地點、verification 與 freshness。OMI 將其與行情、基本面、持倉或市場資料結合，並保有市場影響、資料新鮮度與投資判斷的最終責任。

### Kuro

Atlas 提供 compact brief、重大 story update、來源連結與限制。Kuro 決定何時說、如何說、是否通知及如何與使用者互動。Atlas 的摘要不應直接夾帶 Kuro 的 persona 文案。

### 其他 consumer

優先使用通用、versioned API 與少量 MCP capabilities。只有在通用 contract 無法穩定表達需求時，才新增 versioned representation profile；不為每個 consumer 複製整套資料管線。

## 資料保存與可回復性

- 目前單機 runtime 使用 SQLite WAL、schema migration 與單一 `atlas.sqlite`；legacy category DB 只保留為未刪除的本機歷史資料，現行相容 API 直接投影 canonical store。
- stable ID、unique constraint 與 idempotent upsert 防止 scheduler 重跑造成重複污染。
- 原始 payload 必須有大小、格式與 retention 上限；預設不保存完整受版權保護的新聞全文。
- 備份必須包含 DB schema version、建立時間與 restore smoke；不能只備份 UI snapshot。
- 電腦關機期間只能在來源仍提供歷史資料時做 bounded catch-up，不承諾補回 provider 未保留的即時內容。
- correction、retraction 與 source deletion 不直接抹除既有 lineage；以狀態與時間線保留可稽核變化，依法或依政策刪除時另留最小 audit record。
