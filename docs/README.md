# Open Intel Atlas 文件索引

本目錄區分「長期產品方向」、「目標架構」與「單次實作任務」。三者的責任不同，不應互相取代。

## 長期產品方向

- [產品願景](product/ProductVision.md)
- [運作模型](product/OperatingModel.md)
- [品質標準](product/QualityBar.md)
- [產品路線圖](product/Roadmap.md)

`docs/product/` 只記錄長期適用、已由使用者提出或明確標為待確認的方向。單次實作細節不應直接升格為產品事實。

## 目標架構

- [系統架構](architecture/SystemArchitecture.md)
- [資料模型](architecture/DataModel.md)
- [對外介面與整合契約](architecture/ExternalInterfaces.md)

這些文件描述 target state。每一份文件都必須清楚區分目前已實作、正在進行與尚未實作的部分。

## 任務紀錄

- [Backend v1](agent-runs/backend-v1/Prompt.md)
- [新聞平台長期架構設計](agent-runs/news-platform-architecture/Prompt.md)
- [Scheduler 與 freshness v2](agent-runs/scheduler-freshness-v2/Prompt.md)
- [Editorial newsroom v1](agent-runs/editorial-newsroom-v1/Prompt.md)
- [Windows tray v1](agent-runs/windows-tray-v1/Prompt.md)

`docs/agent-runs/` 是可中斷續作的工作紀錄，不是永久架構規則。完成實作後，只有仍然成立的決策才回寫到產品或架構文件。
