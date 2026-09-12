# 功能導覽

OLA 的閱讀順序是：掌握重點、縮小範圍、查看證據、確認資料限制。

## Newsroom

首頁 `/` 提供頭條、live desk、最新報導與四個領域入口。政治、科技、金融、災害共用資料管線，並非四個互不相通的資料庫。

先看 coverage 與更新時間，再解讀內容。畫面有新資料不表示所有來源都正常；一個來源失敗也不代表其他故事都不可用。

## 區域 brief

`global`、`east_asia`、`taiwan_focus`、`japan_focus` 是 backend 的 brief selection。區域內容不足時會保留 gaps，不以全球 filler 補滿。

區域相關性不是事件發生國。來源位於日本，也不代表它報導的事件發生在日本。此基準不承諾所有列表都支援與 brief 相同的 presentation 參數。

## 領域頁

`/domain.html?domain=politics` 等領域頁提供事件流、來源健康與 evidence view。從單篇內容回到來源，分辨是 Document、聚合 Story，還是通過 promotion 的 Event。

| 名稱 | 意義 |
| --- | --- |
| Document | 從來源取得並正規化的內容，保留 lineage |
| Story | 相關內容的聚合與演進脈絡 |
| Event | 有證據支持的結構化發生事項 |
| Verification | 佐證狀態，不等於影響程度 |
| Severity | 潛在影響，不等於已證實程度 |

市場觀測、論文與例行紀錄可能只保留 Document，這不一定是遺漏。

## 搜尋與地圖

搜尋可用關鍵字與 backend 支援的 filter；地圖位於 `/atlas.html`，只為可靠座標建立 marker。無座標事件仍可保留在列表。

地圖上的分布受來源覆蓋與定位證據影響，不能當成全球事件發生率或風險排名。

## 圖片與缺口

圖片是選用的來源內容，只有 backend 授權的 `remote_embed` 才顯示。沒有核准圖片時使用文字版面，並非圖片載入故障。

看到 stale、partial、disabled、failed 或 unknown，先查[來源政策](sources-and-media.md)與[排錯流程](operations.md)，不要把未知解讀為零。
