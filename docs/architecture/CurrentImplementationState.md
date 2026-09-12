# 實作狀態與文件基準

本輪公開文件核對於 2026-09-12，以 `40e83485bf3355d044114e2233aec3dcf692043a` 為基準：其程式來自 `b852f29`，新增 Apache-2.0 LICENSE。Application 版本仍為 1.3.0；文件發布不代表新功能 release。

## Source 支援範圍

| 能力 | 此基準狀態 | 仍需區分 |
| --- | --- | --- |
| Source → Document → Story → Event | 已實作 | 每個來源的 live coverage |
| SQLite schema v5、persistent scheduler、change feed | 已實作 | 正式 DB 採用與歷史資料缺口 |
| REST v1、consumer contract 1.2、MCP | 已實作 | 外部 client／OMI／Kuro 實際接線 |
| Newsroom、領域頁、地圖 | 已實作 | 使用者 runtime 的版本與畫面 |
| TW／JP regional brief、promotion／relevance | 已實作 | 不保證所有來源合格或列表均有區域 filter |
| Document media policy | 已實作 | 逐來源授權、使用情境與 live availability |
| 公司專用新聞與總經擴充 | 不在此已提交基準 | 本機工作中的內容不得先宣告公開支援 |
| Public auth／rate limit、多節點、通知 delivery | 尚未完成完整產品驗收 | 本機 endpoint 不可等同公網產品 |

本輪只做文件與程式核對、Markdown 靜態檢查及發布；沒有重跑歷史程式測試、套用正式 migration、restart 或 provider acquisition。Runtime／Live／Product 均為本輪未重新驗證。

## 如何取得目前事實

核對 Git commit、實際啟動 root 與設定，讀 health、profiles、sources／freshness，再檢查代表性資料及 consumer。不要只看 application version，因同一版本字串可能涵蓋多個 commit。

[System Architecture](SystemArchitecture.md)、[Intelligence Layer](IntelligenceLayer.md)與[Roadmap](../product/Roadmap.md)包含 dated checkpoints 及 target state；它們不是即時 health page。完整來源與 capability inventory 以 source／runtime schema 為準。
