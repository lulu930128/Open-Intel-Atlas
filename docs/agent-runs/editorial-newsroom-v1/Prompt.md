# Editorial Newsroom v1

## Goal

將現有 dashboard 首頁重做成可閱讀、可查證、可長期演進的新聞平台首頁，同時保留既有全屏地圖頁與後端 API contract。

## User outcome

使用者進入首頁後，可以在第一屏判斷「現在發生什麼、何時更新、資料是否完整」，接著閱讀最新報導、瀏覽四個領域，並開啟原始證據查證。

## In scope

- 以繁體中文重建首頁資訊架構與視覺層級。
- 串接 `/api/v1/brief`、`/events`、`/stories`、`/freshness`、`/search` 與 detail endpoints。
- 提供事件／報導詳情、證據來源、搜尋與資料狀態。
- 支援桌面與窄螢幕，並對 partial、stale、空資料、API failure 提供誠實狀態。
- 不改寫 `atlas.html`、既有地圖互動或後端資料語意。

## Out of scope

- 新增翻譯、摘要生成、登入、個人化或收藏。
- 修改事件分數、嚴重度、驗證、freshness 或 coverage 的判定規則。
- 新增外部圖片／字型／UI framework。

## Constraints

- 前端只投影後端 canonical semantics，不自行重算可信度或重要性。
- 保留現有 dirty worktree，不回復或覆蓋無關修改。
- 靜態首頁拆成獨立 `newsroom.css` 與 `newsroom.js`，避免影響全屏地圖。
- 不把 partial、stale、missing 呈現為健康或即時。

## Done criteria

- 首頁可由現有 Windows 常駐 runtime 直接載入。
- lead、live、latest、domain desks、搜尋、詳情與資料狀態都使用真實 API。
- 桌面與窄螢幕都可閱讀、可操作，無水平溢出。
- 相關 syntax、test 與 browser smoke 通過，並留下可重現證據。
