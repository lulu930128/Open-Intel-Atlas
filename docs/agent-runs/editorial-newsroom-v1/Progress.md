# Progress

## Status

Completed on 2026-08-23.

## Verified inputs

- `/api/v1/brief` 提供 backend-selected highlights 與 domain counts。
- `/api/v1/events/:id` 提供 evidence、official/primary source、publisher、location 與 verification status。
- `/api/v1/stories/:id` 提供 cluster documents 與 canonical URLs。
- `/api/v1/search` 同時回傳 documents、stories、events、entities。
- 現有 live coverage 可為 `partial`、freshness 可為 `stale`；UI 必須如實呈現。

## Decisions

- 首頁改用獨立 `newsroom.css`／`newsroom.js`。
- `app.js`／`styles.css` 保留給 `atlas.html`，避免本次首頁改版擴大回歸範圍。
- 以 brief 第一筆 highlight 作為頭條；前端不建立自己的排名分數。

## Delivered

- 新首頁 masthead、領域導覽、本期狀態、頭條、live desk、latest stream、field notes 與四領域 desks。
- event detail 顯示 verification、severity、time、location、evidence 與 canonical source links。
- story detail 顯示 cluster method/version、文件數、獨立來源數與 cluster documents。
- 搜尋將 events、stories、documents 分組，避免資料層混淆。
- partial、stale、missing、empty 與局部 API error 有獨立且誠實的顯示。
- 獨立 `newsroom.css`／`newsroom.js`；既有 `atlas.html`、`styles.css`、`app.js` 不因首頁改版而重寫。

## Verification

- `node --check public/newsroom.js`：通過。
- `npm run check`：31 files syntax check 通過。
- `npm test`：10 / 10 tests 通過。
- `git diff --check`：無 whitespace error；只有既有 Windows LF/CRLF 提示。
- Live static smoke：`/`、`/newsroom.css`、`/newsroom.js` 均回傳 HTTP 200，首頁載入新版 wordmark 與 script。
- Browser desktop：無 console error、無水平 overflow；頭條、事件詳情、報導詳情、搜尋、資料狀態皆完成實際互動。
- Browser 360px：無頁面水平 overflow；導覽採橫向捲動、story rows reflow、detail dialog 全寬顯示。
- `/atlas.html`：可見地圖與 records，無 console error。
- `/api/health` 與 `/api/v1/health`：`ok: true`；scheduler `enabled: true`。

## Known runtime state

- 驗收時 global coverage 為 `partial`：16 / 17 啟用來源成功。
- `gdelt-doc` 因 connect timeout 失敗；`gdacs-events` 回報 latest-only provider 的離線缺口不可完全補回。這些限制由新版 status dialog 顯示，未被 UI 隱藏。

## Next

- 規劃 headline translation／localization pipeline；目前平台保留來源原文，沒有在前端生成翻譯。
- 補 correction/retraction timeline 與真正的 domain archive pagination。
