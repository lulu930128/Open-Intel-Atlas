# 實作計畫

## 里程碑 1：確認 provider 契約

驗收條件：

- 確認總統府 `GetNews.ashx` 回傳 JSON array，並記錄 localized timestamp 與 media 欄位。
- 確認行政院本院新聞 RSS 與外交部新聞稿 OpenData RSS 可回傳 RSS 2.0 item。
- 不使用由附件推測但未驗證的 endpoint。

## 里程碑 2：接入 canonical registry

驗收條件：

- 新來源沿用 `politicsSources`、bounded HTTP client、`createIntelDocument`、`sourceFetchResult`。
- source contract 包含 provider type、authority、語言、國家、cadence、attribution 與 policy note。
- 例行新聞稿保持 `event_eligible: false`，不在 adapter 內做重大性或事實確認推論。

## 里程碑 3：fixture 與 regression

驗收條件：

- registry 能解析三個來源且預設啟用。
- JSON、RSS、localized timestamp、HTML cleanup、media candidate、empty/malformed payload 有測試。
- provider error 原樣向 collector 傳遞。

## 里程碑 4：分層驗證

驗收條件：

- `npm run check` 通過。
- 新增的 targeted test 通過。
- 完整 `npm test` 通過。
- `git diff --check` 通過，且 diff 不包含既有 UI／tray 工作。

## 決策紀錄

- 2026-08-30：第一階段只做台灣中央政府、無金鑰、官方結構化來源；日本與媒體授權來源留到下一里程碑。
- 2026-08-30：來源的 `countries` 表示 source coverage，不等同每篇文件的事件地理位置，因此不寫入 `location`。
- 2026-08-30：官方權威只證明發布者身分，不代表所有陳述已獨立驗證；新聞稿先作 Document-only ingestion。
- 2026-08-30：總統府圖片保留為候選證據媒體，但不自動開放 remote embed。
- 2026-08-30：外交部 endpoint 可由 bounded `curl` 取得，但專案 Node HTTP client 在不同 User-Agent 下均逾時；保留完整 adapter 與 fixture，但 default disabled，避免把未通過 runtime adoption 的來源算成 ready。
