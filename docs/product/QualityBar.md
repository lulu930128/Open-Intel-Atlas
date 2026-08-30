# 品質標準

## 產品品質標準

- 重大畫面與 outward response 都能追溯到至少一筆 Document；沒有 evidence 不建立 Event。
- source failure 只能造成該來源或該 coverage slice 降級，不得讓所有領域一起失效。
- 相同資料重抓、服務重啟或 scheduler 重跑必須 idempotent。
- API、MCP 與 UI 對 `missing`、`partial`、`stale`、`disabled`、`failed`、`unknown` 使用一致語意。
- target state、已實作狀態與 roadmap 不得混寫；文件中的未完成能力要明確標示。

## UX / UI 標準

- 第一屏優先呈現「發生什麼、何時、在哪裡、可信到什麼程度、資料是否完整」。
- 資訊密度高但保持層級：brief → story → event/evidence → source detail。
- 卡片不能只靠顏色傳達 severity 或 freshness；需要文字、圖示或狀態 label。
- 窄螢幕以重新編排和漸進揭露為主，不只縮小字體。
- 時間顯示同時保留來源時間與使用者時區；相對時間不能取代精確時間。
- map 是輔助視圖。沒有可靠座標的事件不可放置假位置，也不能因無座標而從列表消失。
- 來源圖片是 optional enhancement；沒有核准圖片時使用自然收合的純文字版面，不放 generic placeholder、AI 新聞照或冒充資料視覺的 fallback。

## 技術品質標準

- Source adapter 只產生明確 contract；provider-specific parsing 不外洩到 UI、MCP 或 consumer。
- source I/O 具 timeout、response size、retry、rate limit、User-Agent 與錯誤分類。
- schema migration 可重複執行，重要 identity／lineage 有 DB constraint 與 fixture test。
- API 使用 major version、bounded pagination、predictable error envelope 與 contract test。
- scheduler 與 HTTP read path 解耦；查詢不因單一 client request 觸發無界 provider I/O。
- secrets 只由環境變數或安全設定注入；log、API error 與 raw artifact 不得洩漏 secrets。
- MCP adapter 保持薄且 read-only 起步；現行協定驗證包含 `server/discover → tools/list → representative call/resource read`，legacy 相容面另驗證 `initialize` 與 stateless request。

## 資料與可信度標準

- 分別保存 `published_at`、`source_updated_at`、`first_seen_at`、`last_seen_at` 與 `ingested_at`；不把 ingest time 假裝成事件發生時間。
- `severity` 表示潛在影響，`verification` 表示佐證狀態，`confidence` 若保留則需有可解釋組成；三者不可混用。
- aggregator、轉載與同集團 syndication 不自動增加 independent source count。
- 官方來源可以提高 authority，但官方聲明本身仍是「誰主張了什麼」的 evidence，不代表所有延伸解讀都已證實。
- 自動分類、摘要、entity／geo 與 clustering 必須保存 method/version，允許重算且不破壞原始資料。
- 系統不能把空集合或未排名資料解讀為零，也不能用 stale cache 假裝 current。

## 驗證分級

- 文件／contract：UTF-8 讀回、Markdown links、範例 schema、`git diff --check`。
- adapter：fixture parser、timeout／malformed／empty／rate-limit 測試，以及 bounded live sample。
- pipeline／DB：migration、idempotency、dedupe、lineage、correction/retraction、partial failure 測試。
- API：contract、pagination、filter、freshness、auth、error isolation 與 localhost smoke。
- UI：lint/typecheck/build，再以實際瀏覽器驗證 desktop、窄螢幕、empty/partial/stale/error state。
- MCP／consumer：本機 protocol smoke 與 OMI/Kuro 實際讀取；backend 健康不等於 adapter 或 consumer 已採用。

## 不可接受的捷徑

- 用 fallback fake event 掩蓋來源失敗。
- 以 keyword 命中直接當作已證實的 Story 或 Event，而沒有 lineage 與門檻。
- 把完整第三方文章塞進 DB 或對外 API，之後再處理版權問題。
- 讓前端或 consumer 自行 hardcode taxonomy、freshness 或 verification 規則。
- 只驗證 build、health endpoint 或 source code，就宣稱 UI、MCP、OMI 或 Kuro 整合完成。
