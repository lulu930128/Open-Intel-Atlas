# Progress

## Status

- Current phase: done
- Last updated: 2026-08-30 16:29 Asia/Taipei

## Completed

- 讀取產品願景、運作模型、品質標準、首頁 renderer／CSS、正式 API 與目前完整首頁。
- 確認根因是 domain 2×2 CSS Grid row stretch：政治版首圖提高整列高度，科技版因此留下大片空白。
- 固定「首頁摘要＋共用 domain 子頁」的資訊架構與 backend-owned domain contract。
- 首頁只保留 6 則 latest stories 與四個 compact domain entries；每個入口最多 2 則事件，不再以同一個 grid row 承載不同高度的完整 desk。
- 新增 registry 驅動的共用 domain 子頁、bounded cursor 分頁、來源與缺口 rail、Event evidence dialog，以及 invalid／empty／error state。
- 修正來源錯誤長網址造成的水平 overflow，並以全域 `[hidden]` contract 避免 author CSS 覆寫原生隱藏狀態。

## Validation evidence

- live `/api/v1/domains`：四個 active canonical domains，含中英文名稱與 description。
- live politics freshness：`stale`／`partial`，3 個 expected sources中 2 個 successful、1 個 failed。
- desktop full-page screenshot：首頁同時渲染 9 則 latest stories 與四版各 4 則 events，domain politics image造成同列不等內容的大面積空白。
- live desktop homepage：4 個 domain entries 高度均為 407px、6 則 latest stories、`scrollWidth === clientWidth`。
- 四個 live domain pages：政治／科技／金融／氣象與重大天災皆使用正確 active nav，分別渲染 17／17／11／17 筆非 lead 事件，且無水平 overflow。
- politics cursor smoke：事件列由 17 增至 35，35 個 `data-detail-id` 全部唯一；Event dialog 顯示原始證據與原始來源連結。
- invalid-domain smoke：資料 workspace 實際 `display: none`，提供四個 canonical domain 返回入口，不保留誤導性的 loading 狀態。
- 390px browser：首頁與 politics domain page 皆為單欄、來源 rail 滿寬、事件 dialog 滿寬，無水平 overflow；browser console 無 error。
- `npm run verify`：syntax check 38 files，29 tests 全數通過。
- `git diff --check` 與 `node --check public/newsroom.js public/domain.js public/domainPageModel.js` 通過。

## Decisions made

- 首頁 domain entry 最多顯示 2 則事件，不顯示大圖；圖片留給首頁 lead與 domain page lead。
- Domain page 直接顯示來源健康與 warning，不把空白解讀為無事件或完整覆蓋。

## Known issues / risks

- worktree 已有未提交的 Media、Newsroom、Map與 1.3.0 收斂變更，本輪不可 broad stage／commit。
- 正式 runtime 目前是 1.3.0；本輪只修改 static frontend，既有 runtime 已直接讀取並呈現新檔案，不需重啟 backend。

## Next step

- 等待使用者驗收；本輪未 stage、commit 或 push。
