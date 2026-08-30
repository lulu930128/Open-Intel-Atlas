# 進度

## 狀態

- Current milestone: 4 - 分層驗證
- Status: complete (source-level; runtime adoption not performed)
- Last updated: 2026-08-30 Asia/Taipei

## 已完成

- 已確認 repo product boundary、Source Registry、Document normalization、media policy 與 event eligibility。
- 已以 bounded live sample 確認三個官方 provider 契約：
  - 總統府 JSON：`https://www.president.gov.tw/Handler/GetNews.ashx`
  - 行政院本院新聞 RSS：`https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3`
  - 外交部新聞稿 RSS：`https://www.mofa.gov.tw/OpenData.aspx?SN=E0AB271EE713F7E8`
- 已確認不需要新 dependency、API key 或 schema migration。
- 已完成三個 source definitions 與 adapters；總統府、行政院預設啟用，外交部因 Node transport live timeout 預設停用。
- 已完成 registry、JSON/RSS normalization、localized timestamp、empty/malformed payload 與 provider error regression tests。

## 驗證證據

- 總統府 sample 包含 `PublishDate`、`Title`、`Description`、`URL`、`Images`、`Videos`。
- 行政院與外交部 sample 均為 RSS 2.0，item 具 `title`、`link`、`description`、`pubDate`。
- 專案 HTTP client 的 isolated live adapter smoke：總統府成功 10 Documents、行政院成功 30 Documents，兩者第一筆皆有 canonical URL 且 `event_eligible=false`。
- 外交部 endpoint 可由 bounded `curl` 讀取，但專案 Node HTTP client 以預設、curl-like、browser-like User-Agent 均在 12 秒逾時；來源因此 fail closed。
- `npm run check`：通過，40 files。
- `node --test --test-isolation=none test/tw-official-sources-v1.test.js`：4/4 通過。
- `npm test`：35/35 通過。
- registry projection：26 total、19 enabled；台灣來源為總統府 enabled、行政院 enabled、外交部 disabled、TWSE enabled、CWA disabled。
- `git diff --check`：本任務 tracked diff 通過。

## 已知限制

- 本里程碑只擴充底層 Document coverage，不處理首頁／brief 的區域多樣性排序。
- runtime adoption 與正式資料庫 collection 尚未執行。
- 日本來源與台灣媒體來源尚未納入本里程碑。
- 外交部來源需要後續處理 Node transport／provider 可達性後，才可設定 `SOURCE_TW_MOFA_PRESS_RELEASES_ENABLED=true`。

## 下一步

- 另開里程碑處理日本 JMA／防衛省／JPCERT 官方來源。
- 若要啟用外交部來源，先修復或繞過 Node runtime transport timeout，再做正式 collection acceptance。
- 需要 runtime adoption 時，另行確認後再重啟服務並觀察 source health、Document 寫入與 UI/consumer projection。
