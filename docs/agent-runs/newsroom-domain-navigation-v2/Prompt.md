# Newsroom Domain Navigation v2

## Goal

- 將首頁從完整內容堆疊收斂為跨領域摘要入口，消除 domain Grid 因圖片高度造成的大片空白與過長頁面。
- 建立共用領域子頁，讓政治、科技、金融、氣象與災害能各自深入閱讀事件、來源狀態與資料缺口。

## Non-goals

- 不修改 backend taxonomy、severity、verification、freshness、Story clustering 或來源選擇。
- 不新增第三方 UI library、前端 framework、圖片 proxy 或外部字型依賴。
- 不在本輪改造 Full Map、MCP contract 或 canonical API shape。

## Hard constraints

- Domain ID、名稱與描述以 `/api/v1/domains` 為 truth；前端只保留有限的 presentation accent。
- 首頁與子頁必須如實呈現 `partial`、`stale`、`failed`、`missing`，不以空白或綠色狀態掩蓋缺口。
- 圖片仍只顯示 backend-selected `remote_embed`；失敗時自然收合。
- 子頁查詢使用 bounded `/api/v1/events` cursor，不在瀏覽器抓 provider 或重算事件語意。
- 保留既有 detail dialog、搜尋與正式來源連結能力。
- runtime restart、commit、push 仍是獨立 gate。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Current UI: `public/index.html`、`public/newsroom.js`、`public/newsroom.css`。
- Current evidence: 首頁 domain 以 2×2 Grid 顯示四個完整列表；政治首圖會把科技同列拉到相同高度，造成大片空白；完整頁同時呈現 9 則最新報導與 16 則 domain events。
- Current API: `/api/v1/domains`、`/api/v1/events?domain=`、`/api/v1/freshness?domain=`、`/api/v1/sources?domain=`。

## Deliverables

- 摘要化首頁與四個 domain navigation entry。
- 共用 `domain.html`／`domain.js` 領域子頁。
- bounded domain pagination、來源狀態、缺口與 event evidence dialog。
- frontend contract tests、desktop／mobile browser screenshots與 runtime adoption evidence。

## Done criteria

- 首頁不再渲染四個完整 domain list，domain overview 在桌機與窄畫面沒有不對稱空白或水平 overflow。
- 四個 domain 入口都能開啟正確子頁，顯示 backend registry label、正確 domain events、freshness、coverage與來源狀態。
- 子頁可開啟 Event evidence detail，且 Load more 只沿 canonical cursor 讀取。
- `npm run verify`、`git diff --check` 與實際 desktop／mobile UI smoke 通過。

## Open questions / assumptions

- 共用靜態路徑採 `/domain.html?domain=<id>`，避免為四個領域複製 HTML 或修改 server routing。
- 首頁每個 domain 顯示 2 則事件；完整清單移至子頁。
