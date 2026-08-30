# 台灣官方底層來源 v1

## 任務背景

Open Intel Atlas 目前的政治與公共政策來源明顯偏向美國與全球聚合來源。這個里程碑先補入已確認、無需 API key、可由既有 collector 直接取得的台灣中央政府官方來源，建立後續區域化擴充的可重複做法。

## 目標

- 將總統府新聞、行政院本院新聞、外交部新聞稿加入 canonical Source Registry；未通過 runtime transport smoke 的來源須 fail closed。
- 所有來源都經既有 `Source → Document` 寫入路徑，不建立 consumer 或 frontend 私有抓取。
- 保留來源身分、官方權威、原始連結、發布時間、語言與台灣來源範圍。
- 例行官方新聞稿預設只形成 Document，不由 adapter 直接宣告為已驗證 Event。
- 使用 fixture 驗證 provider schema、日期、空資料、malformed feed 與錯誤傳遞。

## 非目標

- 不修改首頁排序、brief 選擇器或區域配額。
- 不加入日本來源、CNA、立法院或需新法律／授權審查的來源。
- 不重啟目前 runtime、不對正式資料庫觸發 collection。
- 不 commit、不 push。

## 硬性限制

- 不新增 dependency、secret、database schema 或第二套 pipeline。
- 不把「官方發布」誤寫成「事件已被多方驗證」。
- 不推論新聞內容的事件所在地；`countries: ["TW"]` 只表示來源範圍。
- 圖片沿用預設 candidate policy，不因政府來源身分自動取得 remote embed 授權。
- 保留工作樹中既有、與本任務無關的修改。

## 交付物

- `src/atlasAdaptersPolitics.js` 的三個新來源與 adapter。
- `test/tw-official-sources-v1.test.js` 的 registry 與 fixture regression tests。
- 本任務的 `Prompt.md`、`Plan.md`、`Progress.md`。

## 完成條件

- 三個來源都存在於 default registry、無缺少設定，且公開契約標示官方／台灣／繁體中文；只有通過 live adapter smoke 的來源預設啟用。
- fixture 能產生 canonical Document，總統府在地時間正確轉成 UTC。
- 產出的 Document 具有穩定 identity、原始 URL、bounded summary 與 `event_eligible: false`。
- malformed／empty payload 不產生假 Document；HTTP error 不被 adapter 靜默吞掉。
- `npm run check`、targeted test 與完整 `npm test` 通過。
