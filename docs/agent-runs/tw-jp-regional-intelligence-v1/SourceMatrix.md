# Source Matrix

## 已存在／已實作

| Source | Region/domain | Current state | Next gate |
| --- | --- | --- | --- |
| `tw-president-office-news` | TW / politics | current runtime enabled、healthy、current；10 Documents；routine releases 為 Document-only | 跨至少兩個 cadence windows／三次成功或 304 的 health observation |
| `tw-executive-yuan-news` | TW / politics | current runtime enabled、healthy、current；30 Documents；routine releases 為 Document-only | 跨至少兩個 cadence windows／三次成功或 304 的 health observation |
| `tw-mofa-press-releases` | TW / politics | formal runtime enabled、healthy、current；30 Documents；完整 OpenData formats 因 2.5–3.5 MB 且無 validator 不作 routine persistence；3 次 usable 且跨 2 cadence 已達標 | G5 detail/UI acceptance；routine release 保持 Document-only，support opt-in 修正仍待 runtime adoption |
| `tw-ncdr-active-cap-alerts` | TW / hazards | formal runtime enabled、healthy、current；87 Documents；feed-level `Public Domain` gate；3 次 usable 且跨 2 cadence 已達標 | G5 detail/UI acceptance；只用 CAP ID/status/msgType，不從摘要猜 location |
| `twse-material-info` | TW / finance | current runtime enabled、healthy、current；最近一次 valid not-modified | observation；materiality/promotion policy 另行驗收 |
| `cwa-weather-warnings` | TW / hazards | current runtime disabled；缺 `cwaApiKey`，fail closed | credential decision → bounded live sample → isolated adoption |
| `gdelt-doc` | global / politics | current runtime failed；`ECONNRESET`、9 consecutive failures、backoff；store 尚無 Documents | 不新增第二套 service；先收斂 transport，再把 regional profile 放到最後 |
| `jp-mod-news` | JP / politics | formal runtime enabled、healthy、current；40 Documents，全部 Document-only；3 次 usable 且跨 2 cadence 已達標 | G5 detail/UI acceptance；support opt-in 修正仍待 runtime adoption |
| `jp-jpcert-alerts` | JP / technology | formal runtime enabled、healthy、current；6 alerts；3 次 usable 且跨 2 cadence 已達標；CVE identity 與 promotion fail closed | G5 detail/UI acceptance；held support opt-in 修正仍待 runtime adoption／recollection |
| `jp-jma-eqvol` | JP / hazards | formal runtime enabled、healthy、current；7 Documents；3 次 usable 且跨 2 cadence 已達標；EventID/Serial/InfoType、取消 handling 已採用 | G5 detail/UI acceptance；持續觀察 serial/cancel lifecycle |
| `jp-fdma-disaster-info` | JP / hazards | formal runtime enabled、healthy、current；15 Documents；3 次 usable 且跨 2 cadence 已達標；fragment identity 與 revision date 已保存 | G5 detail/UI acceptance；持續確認 provider anchor lifecycle |
| `jp-ndl-diet-minutes` | JP / politics | formal runtime enabled、healthy、current；30 meeting metadata Documents；目前 1 次 usable；metadata-only／Document-only | 再累積 2 次 usable 且跨 2 cadence；不擴成 transcript mirror；support opt-in 修正待 adoption |
| `jp-meti-latest` | JP / politics+technology+finance | formal runtime registered、disabled；compliant Node User-Agent 連續 HTTP 403，health `disabled` | transport revalidation；不得以 browser spoof 解鎖 |

## 日本核心來源契約

| Candidate | Region/domain | Official evidence | Planned contract |
| --- | --- | --- | --- |
| JMA 防災 XML／Atom | JP / hazards | `https://xml.kishou.go.jp/xmlpull.html`；公開 PULL feeds、免註冊，有下載量與延遲注意事項 | 已實作 `eqvol`：Atom 只作索引；每次最多地震 3、津波 2、火山 3，總數 6；provider EventID 作 stable identity；不以 source country 填 event country |
| MOD 報道資料 RSS | JP / politics | `https://www.mod.go.jp/j/rss/news.xml`，官方 RSS 2.0 | 已實作 metadata/original link；相對 URL resolve 至官方 host；routine notice 不升 Event |
| JPCERT/CC RSS | JP / technology | `https://www.jpcert.or.jp/rss/jpcert.rdf`，官方 RSS 1.0 | 已實作 RSS 1.0 `dc:identifier`／`dc:date`；只納 `/at/` alerts；CVE identity 對齊其他 security evidence；promotion fail closed |
| FDMA 災害情報 RSS | JP / hazards | `https://www.fdma.go.jp/about/rss.html` 明列 `https://www.fdma.go.jp/disaster/info/index.xml` | 已實作最多 40 筆；provider fragment 作 incident identity；解析明示 revision date；無 structured location 時只給 regional relevance |
| NDL 國會會議錄 API | JP / politics | `https://kokkai.ndl.go.jp/api.html`；免註冊 JSON，meeting-list 每次最多 100 | 已實作單頁最多 30 meeting metadata；保留 next position，不抓逐字稿；所有 records Document-only |

## Preflight 後才決定是否實作

| Candidate | Reason for hold | Decision gate |
| --- | --- | --- |
| METI | 官方 Atom shape 與 adapter 已確認，但 compliant Atlas Node transport 固定 HTTP 403，不能宣告 source-ready | provider transport 恢復或官方提供可由產品 client 使用的 endpoint；維持 default disabled |
| TWCERT/CC | 官方 RSS 技術契約存在，但官方版權頁明載僅供閱讀且不得逕自使用、重製或散布 | 取得明確再利用授權前不持久化、不實作；不以可抓取性替代 rights gate |
| CNA RSS | 專業媒體可補 general news，但 metadata、摘要與圖片再散布權需先審 | rights matrix；圖片預設 candidate-only |
| 立法院 open data | 舊 API current-term 回空；新 PPG 有 current content 但未找到公開 stable API | 新官方 API contract；保持 metadata-only／Document-only policy |
| EDINET | JP / finance primary disclosure，需和現有 finance Event identity 對齊 | API/terms、issuer identity、materiality |
| GDELT TW/JP profiles | discovery-only，現有 global owner 尚需 health 收斂 | 單一 implementation owner、query profiles、cross-profile dedupe |

## 啟用規則

- `registered` 不等於 `enabled`；`enabled` 不等於 `healthy`；`healthy endpoint` 不等於 product adopted。
- 新來源必須依序通過：official endpoint/rights → fixture → bounded live sample → isolated runtime → explicit formal adoption → observation。
- valid empty／304 可以是成功；malformed、timeout、rate-limit 必須保留分類與 backoff，不可用空 payload 假裝健康。
- 每個 source 的 `policyNote`、attribution、cadence、timeout、catch-up、required config、media policy 與 rollback flag 必須在 registry 可見。
