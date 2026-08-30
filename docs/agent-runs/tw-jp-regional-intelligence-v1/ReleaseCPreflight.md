# Release C／日本官方底層來源 preflight

## 範圍與邊界

- 日期：2026-08-30 Asia/Taipei。
- 附件只作候選來源與驗收條件參考；本批仍依 Atlas source-ready gate 決定是否啟用。
- 本批沒有寫入正式 DB、沒有操作 8790、沒有 commit 或 push。
- 每個 live probe 都由 `scripts/verify-regional-sources.mjs --no-write` 走正式 Node HTTP client 與 adapter，只輸出 canonical Document sample。

## 採用結果

### `jp-fdma-disaster-info`：source-ready

- 官方契約：`https://www.fdma.go.jp/about/rss.html` 明列災害情報 feed `https://www.fdma.go.jp/disaster/info/index.xml`。
- Live Node probe：HTTP 200、1 fetch、15 Documents、payload 未截斷、4,213 ms。
- RSS record identity 位於 `/disaster/info/#<id>`。Canonical URL 只對此 provider 明確 opt-in 保留 fragment；其他來源仍維持預設移除 fragment。
- `pubDate` 是初次發布時間；標題中的 `R8.8.30更新` 解析為最新 observation time，避免持續更新的災害被 freshness 誤判 stale。
- 有 provider incident ID 時才 `event_eligible=true`；Event 可由 official source scope 取得 JP／EAST_ASIA relevance，但不建立 location 或 event country。

### `jp-ndl-diet-minutes`：source-ready

- 官方契約：`https://kokkai.ndl.go.jp/api.html`；使用免註冊的 `meeting_list` JSON API。
- Live Node probe：HTTP 200、1 fetch、30 Documents、payload 未截斷、743 ms；查詢窗為 2026-06-01～2026-08-30。
- 每次只取一頁、最多 30 meetings；`numberOfRecords` 與 `nextRecordPosition` 保存於 metadata，存在下一頁也不在同一 run 無界追取。
- 只保存 issue ID、院別、會議名、日期、meeting URL 與 speaker count；不保存 speech text 或逐發言 Document。
- 所有 meeting records `event_eligible=false`。Primary legislative authority 不等於每場會議都是 Event。

## Fail-closed／hold 結果

### `jp-meti-latest`：registered、default-disabled

- 官方 RSS 目錄與 Atom shape 已確認；fixture、domain projection 與 isolated canonical pipeline 通過。
- Atlas Node client 以明確非瀏覽器 User-Agent 讀取英文 Atom 時回 HTTP 403；更換 `Accept` 或使用帶 contact 的產品 User-Agent 仍為 403。
- 新版日文 news-release Atom 在系統 client probe 回 HTTP 202 且空 body，不能替代成 healthy source。
- 不使用 browser User-Agent 偽裝、不把空 body 當成功。Registry 保留 adapter 與 rollback flag，但 `defaultEnabled=false`，正式 adoption 必須顯示 disabled。

### 立法院 open data：hold

- 舊平台 `https://data.ly.gov.tw/` 有正式開發指南與政府資料開放授權條款；JSON API 單頁上限 1,000。
- 第 11 屆第 3～5 會期的 dataset 20 query 皆回空；`selectTerm=all&page=1` 回傳 1,000 筆但從第 8 屆開始，不適合作 current intelligence cadence。
- 新 `https://ppg.ly.gov.tw/ppg/` 有 2026 年第 11 屆第 5 會期內容，但本輪未找到公開、穩定的 API contract。不得依賴未文件化的前端內部 endpoint。

### EDINET：credential gate

- 官方頁面明示 EDINET API v2 需要註冊並取得 API key。
- 在沒有合法 key 前不 probe、不硬編碼、不讓 Atlas 啟動依賴 EDINET；維持後續 finance batch 候選。

## Source-level acceptance

- Targeted tests 覆蓋 registry metadata、fragment identity、revision timestamp、METI domains、NDL bounded query、valid empty、isolated idempotency 與 source-country/event-country separation。
- FDMA、METI fixture、NDL 的 isolated store 第一次各插入 1 Document，第二次 inserted 0／updated 1。
- 只有 FDMA 形成 1 Event；`event_locations=0`、RegionalRelevance rows=2（JP／EAST_ASIA），`japan_focus` 可選到該 Event。
- 後續 NCDR batch 納入後，`npm run verify:isolated-adoption` 已更新為 33 registered sources；NCDR／FDMA／NDL enabled+unknown，METI disabled+disabled。Unknown 表示 isolated gate 未執行 provider I/O，不偽裝 healthy。

正式 runtime adoption、三次 cadence observation、正式 DB reprocess 與 G5 browser/MCP 驗收仍是後續獨立 gates。
