# Macro Intelligence v1 使用契約

## 第一版範圍

同一個 OLA process、Source Registry、collector、source run／raw fetch ledger 與 SQLite；schema v9 新增 Macro 專用 tables。Source Result 的 optional `macro_batch` 經 `processSourceResult` 進入 store transaction；日曆、observation 與 evidence Document 不經新聞標題推導數字。

| 指標家族 | ID 前綴 | 指數口徑 | MoM | YoY |
| --- | --- | --- | --- | --- |
| CPI headline | `US_CPI_HEADLINE` | NSA，1982–84=100 | SA | NSA |
| CPI core，排除食品與能源 | `US_CPI_CORE` | NSA，1982–84=100 | SA | NSA |
| PPI final demand | `US_PPI_FINAL_DEMAND` | SA，2009-11=100 | SA | NSA |
| PPI，排除食品與能源 | `US_PPI_EX_FOOD_ENERGY` | SA，2010-04=100 | SA | NSA |
| PPI，再排除 trade services | `US_PPI_EX_FOOD_ENERGY_TRADE` | SA，2013-08=100 | SA | NSA |

每個前綴有 `_INDEX`、`_MOM`、`_YOY`，共 15 個 indicator。數值直接取官方表格，不自行用 rounded index 計算新聞公布的百分比。PPI observation 的 `index_base` 保留官方表格標記（例如 `04/10`）；以各筆 observation 的基期為準。

來源：BLS CPI／PPI release summary、Table 1、PPI Table 3；日曆使用帶有 Reference Month 的官方 release schedule HTML。摘要公告的 evidence Document 連到該次 archived release URL，避免下月 latest URL 滾動造成 evidence identity 合併。

## 啟用

新來源預設停用，避免現有 runtime 一重開就自動增加外部輪詢。正式採用時，先完成 DB backup，再在 `.env` 設定：

```dotenv
SOURCE_BLS_MACRO_CALENDAR_ENABLED=true
SOURCE_BLS_CPI_RELEASE_ENABLED=true
SOURCE_BLS_PPI_RELEASE_ENABLED=true
```

沿用既有啟動方式；backend 開啟 writable store 時自動追加 schema v9。2026-09-12 使用者授權後，已備份正式 schema 9 DB 與 `.env`、啟用三個 flags，並透過原 Tray 恢復 backend 完成正式採用，證據見 `Acceptance.md`。這三個來源不需要 API key，仍遵守現有全域 `ATLAS_AUTO_COLLECT` 與 HTTP bounds。

平時六小時一次，calendar 也是六小時一次。發布前十分鐘至發布後三十分鐘，未齊備指標使用一分鐘 cadence；齊備後回到低頻並繼續檢查修訂。單次 CPI 最多兩個 HTTP requests、PPI 三個、calendar 兩個，無 adapter retry。既有 lease、concurrency 與 failure backoff 優先，不能為追求低延遲繞過退避。這是 best-effort watch，不是 SLA 或秒級即時 feed。

## REST／MCP

所有回傳使用 `contract_version=1.2`、`profile=macro_v1`，共享 Macro capability；GET 與 MCP 不抓 provider、不寫資料。

| REST | MCP | 用途 |
| --- | --- | --- |
| `GET /api/v1/macro/indicators` | `atlas.macro.indicator` | 指標定義；可指定 `indicator_id`／`group` |
| `GET /api/v1/macro/calendar` | `atlas.macro.calendar` | 發布批次、actual、狀態、完整度 |
| `GET /api/v1/macro/releases` | `atlas.macro.calendar` | 日曆集合別名 |
| `GET /api/v1/macro/releases/US_CPI_2026-08` | `atlas.macro.release` | 單次 release 與最多 100 筆最近 calendar versions |
| `GET /api/v1/macro/observations` | `atlas.macro.observations` | 最新觀測或觀測版本歷史 |

共用 filter：`group=cpi|ppi`、`country=US`。集合 limit 預設 30、最大 100；cursor 綁定 query，改 filter 必須從第一頁開始。

日曆的 `from`／`to` 接受 UTC ISO 或 `YYYY-MM-DD`，`to` 不包含在內；最多 366 天。預設最近七天至未來三十天，cursor 保存首次查詢的時間範圍。日曆是 live view，官方 reschedule 後建議重新查第一頁。

observations 可加 `indicator_id`、`reference_period=YYYY-MM`、`history=true`。預設為每個 indicator／period 最新的已觀測版本；`history=true` 包含全部已保存版本。`as_of` 限制 Atlas 的 `fetched_at`，不是用現在的值重建過去市場已知資料。cursor 固定 observation sequence 上限，避免翻頁期間新 revision 造成舊資料被跳過。

例子：

```text
/api/v1/macro/calendar?from=2026-09-01&to=2026-10-01
/api/v1/macro/observations?indicator_id=US_CPI_HEADLINE_MOM&reference_period=2026-08
/api/v1/macro/observations?indicator_id=US_CPI_HEADLINE_MOM&history=true&limit=100
/api/v1/macro/observations?indicator_id=US_CPI_HEADLINE_MOM&as_of=2026-09-12T01:30:00Z
```

## 時間、修訂與缺值

- release identity 是 `group + reference_period`，不因發布時間異動另建 release；calendar schedule 變動追加版本，缺少日曆列不擅自推論 cancelled。
- `source_published_at` 取官方 embargo 時間，`timestamp_semantics=official_embargo_time`；`released_at=null`，不假裝量到官方真正上線時刻。
- `first_observed_at` 是 Atlas 第一次拿到該 release；來源宣告尚未解禁的資料 fail closed。
- `revision_number=0` 代表 Atlas 的第一個已觀測版本。`initial_release_value_verified=false` 明示它不保證是官方首次公布值。相同值／基期／preliminary 狀態重抓不追加 observation；改變時追加，舊版不可覆寫。reversion 也會成為新 observed version。
- `previous`／`previous_observation_id` 凍結在發布前 Atlas 確實知道的上期值；未曾取得則為 null。`revised_previous` 是該 vintage 表格中的上期值，不表示一定發生修訂；比較兩者才知道是否改變。
- `status=scheduled|due|released` 與 `acquisition_status=missing|partial|complete` 分開。部分值缺失不轉成零，也不把抓取失敗當官方延後發布。
- envelope freshness 同時考慮該 group 到期 release 與來源執行健康；舊月份資料即使重新抓取成功，也不補足新 release 的缺口。歷史查詢的 envelope 是現在的服務／coverage 狀態，`as_of` 僅限制 observation knowledge time。
- source run、raw fetch ID、table column、官方 URL、evidence Document 可追溯。HTTP raw archive 超過既有保存上限時，在 observation 的 `raw_capture.truncated` 與 warnings 揭露；不把截斷 archive 稱為完整 payload。
- consensus 尚未接入，固定 null／`not_configured`。不計算市場利多利空或交易訊號。

## 第一版限制與後續

- 初次取得只涵蓋官方當期表格列出的歷史窗口：CPI index 可含去年同月、上月與本月，MoM 通常三期；PPI index／MoM 通常五期，YoY 本期。後續累積本機 observed history；**未實作 BLS API 全歷史補抓或 ALFRED vintage 匯入**。
- FRED 既有 Document 保留，Macro capability 不讀它，沒有第二個 outward CPI truth。未加入自動 FRED fallback；也不以 FRED 或 BLS API 承諾發布延遲。
- 官方更正、HTML 結構更動、同次公告日期變更可能需要人工調查；無法確認表頭／月份／單位時不猜值。歷史初值無法由後來的表格補回。
- 第一版提供 REST／MCP 與 evidence Document，未新增 Macro UI 或 Story／Event promotion bridge；後續 bridge 必須繼續保留 Document evidence。
- 正式 DB adoption、OMI 實際採用與發布窗口 latency 驗收是獨立工作；未完成的發布窗口不可用本次隔離樣本替代。

## 回退

停用三個 source flags 並重載 backend 可停止自動取得，歷史資料保留。v9 為 additive migration，沒有刪除既有 table；不執行破壞性的自動 down migration。此次備份已是 schema 9，只能回復到 BLS 啟用前狀態；回到 v8 需要另外確認真正的 v8 備份。恢復 DB 前必須停止其 owner，並保存恢復時的最新 DB／WAL，避免遺失備份後的其他來源資料；正常停用優先只關閉 flags。

## 官方參考

- [BLS CPI 表 1](https://www.bls.gov/news.release/cpi.t01.htm)
- [BLS PPI 表 1](https://www.bls.gov/news.release/ppi.t01.htm)
- [BLS PPI 表 3](https://www.bls.gov/news.release/ppi.t03.htm)
- [CPI 日曆](https://www.bls.gov/schedule/news_release/cpi.htm)、[PPI 日曆](https://www.bls.gov/schedule/news_release/ppi.htm)
- [BLS API 限制](https://www.bls.gov/bls/api_features.htm)、[來源權利與引用](https://www.bls.gov/bls/linksite.htm)
