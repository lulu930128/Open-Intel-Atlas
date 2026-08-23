# Plan

## Milestone 1 — Contract and boundary audit

- 確認列表、詳情、搜尋、freshness 的 live payload。
- 確認 `atlas.html` 與 legacy CSS/JS 的依賴邊界。
- Acceptance: 新首頁不需自造資料語意，也不破壞地圖頁。

## Milestone 2 — Editorial shell

- 建立 masthead、領域導覽、頭條、即時脈絡、最新報導、領域版面與資料說明。
- Acceptance: 無 JS 時仍有清楚語意與 loading／noscript 提示。

## Milestone 3 — Canonical data integration

- 串接 brief、events、stories、freshness、search 與 detail。
- 實作 evidence ledger、來源連結、partial/stale 狀態與錯誤處理。
- Acceptance: UI 不重算 backend semantics；任一局部失敗不使整頁崩潰。

## Milestone 4 — Responsive and accessibility

- 完成鍵盤導覽、dialog focus、reduced motion、窄螢幕 reflow。
- Acceptance: 360px 窄螢幕不靠縮小字體硬塞內容，主流程可完成。

## Milestone 5 — Verification

- 執行 syntax、repo tests、live health 與 browser screenshot／DOM smoke。
- 驗證 desktop、mobile、搜尋、詳情與資料不完整狀態。
- Stop-and-fix: 本次修改造成的失敗須先修正；無關失敗需隔離並記錄。
