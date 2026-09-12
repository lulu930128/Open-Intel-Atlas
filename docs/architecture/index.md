# 架構導覽

OLA 使用同一套 canonical evidence 服務人與程式。先讀[目前實作狀態](CurrentImplementationState.md)，再讀需要的責任層。

| 文件 | 用途 |
| --- | --- |
| [系統架構](SystemArchitecture.md) | Pipeline、依賴方向、ownership、source／media policy |
| [資料模型](DataModel.md) | Document／Story／Event、SQLite 與 lineage |
| [對外介面](ExternalInterfaces.md) | REST／MCP、profiles、版本與 target boundary |
| [Intelligence Layer](IntelligenceLayer.md) | 後續情報層提案，規劃不等於已上線 |
| [運作模型](../product/OperatingModel.md) | Atlas、OMI、Kuro 與管理操作責任 |
| [品質標準](../product/QualityBar.md) | 資料、UI、外部 IO 與驗證門檻 |

Executable owner 是 source registry、schema、capabilities 與 pipeline。歷史文件中的 fixed counts、port 與 dated PASS 是當時 checkpoint；不應用來覆蓋目前程式或 live evidence。

Source 可用、正式 runtime 採用、provider 資料有效及最終 consumer 可見是不同驗收面。公網 auth、notifications 與多實例部署仍需要自己的設計與驗收。

一般使用請從[完整文件導覽](../README.md)開始。
