# 來源、覆蓋與媒體政策

## 來源由 registry 管理

[atlasSourceRegistry.js](../../src/atlasSourceRegistry.js) 保存來源身分與政策；`GET /api/v1/sources` 顯示執行中的啟用狀態與資料限制。新增 adapter 不等於 live source 已驗收，註冊數量也不等於實際可用數量。

目前領域包含政治、科技、金融與災害，來源類型涵蓋官方公告、RSS、公開資料 API、研究與資安資訊。台灣／日本區域來源同樣需要自己的設定、transport 與 coverage gate。

## 如何讀狀態

- `disabled`：設定或 gate 不允許執行，查看原因。
- `failed`：最近執行失敗；既有 evidence 不因此自動消失。
- `stale`：資料時效不符目前政策。
- `partial`：存在可用內容，但覆蓋仍不足。
- `unknown`：缺少足夠資訊，不能等同沒有事件。

來源更新成功、Document 時間、事件時間與查詢時間分開判讀。HTTP 304 是 conditional request 成功，不需要建立重複 Document。

來源國別、事件地點與 RegionalRelevance 是不同概念。Aggregator 多筆結果或轉載不能直接算作多個獨立佐證。

## 憑證與啟用

請依 [.env.example](../../.env.example) 設定可選 key、必要 User-Agent／聯絡識別及來源開關。不要使用範例識別假裝有效憑證。

METI 在此 source 基準預設停用；先前 transport gate 未通過不應以瀏覽器偽裝繞過，也不能假定目前仍是相同 HTTP 狀態。重新啟用前需要新的 bounded acceptance。

## 文章與圖片

Document 保留 metadata、短摘錄、原文連結、bounded raw 與 lineage，不定位為全文鏡像站。程式授權不代替第三方文章、圖片或資料來源的使用條件。

Representative media 必須同時通過 persisted policy 與 current source policy。有效展示還需 HTTPS、允許的 host、權利分類與審查證據。Backend 可立即把既有 candidate 降為 link-only，consumer 不得自行放寬。

`ATLAS_MEDIA_USAGE_CONTEXT=unreviewed` 預設不開放展示。此基準的 BBC thumbnail 分支只在明確的 `personal_noncommercial` context 及來源 gate 通過時允許 remote embed，並保留 attribution／原文連結。不要把私人 runtime 的設定視為公開部署授權。

本輪文件不重新認定上游授權或 live availability；公開或商業部署前需按使用情境重新核對各來源條款。

## Attribution

NVD 要求的既有聲明：

> This product uses data from the NVD API but is not endorsed or certified by the NVD.

來源條件及展示政策的 executable owner 為 registry 與 media projection，詳見[系統架構](../architecture/SystemArchitecture.md)。
