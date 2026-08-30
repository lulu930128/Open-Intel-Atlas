# Progress

## Status

- Current phase: source-ready；等待獨立 runtime adoption gate
- Last updated: 2026-08-30

## Completed

- 讀取 repo 產品方向、品質標準、runtime/API、Media/Map/legacy 實作與測試。
- 固定 branch `main`、HEAD `65b9ca2` 與既有 dirty Media Visual Newsroom worktree。
- live read-only audit：runtime `1.3.0`、schema v4、523 Events；3 個 cursor pages，172 筆有座標、134 筆有 country code。
- 確認 Media lineage 在 store/capability projection 遺失，Story/Event selection 未依 effective display policy 排序。
- 確認 Full Map 是 `/api/dashboard` 唯一正式 UI consumer，且仍使用 legacy category 與 `COUNTRY_HINTS`。
- Media outward projection 已統一套用 current source policy、完整輸出 Document／Source lineage，並跨 representative／supporting evidence deterministic 選圖。
- Full Map 已改讀 canonical `/api/v1/events`，完成 bounded cursor pagination、UTC range、canonical domain、可靠座標與 alpha-2 country association；缺座標 Event 仍保留在列表。
- 已移除沒有 production reference 的舊 runtime island 與舊 dashboard client；legacy compatibility API／database 保留。
- current architecture、data model、external interface 與 product roadmap 文件已收斂至 v1.3.0 現況。

## Validation evidence

- `GET /api/v1/health`: reachable；runtime `1.3.0`、schema v4，coverage `partial`、freshness `stale`。
- `GET /api/v1/events?limit=200` cursor walk: 3 pages／523 Events／172 located／134 country-coded。
- `rg` reference audit: `public/atlas.html` 是 `public/app.js` 唯一 consumer；old runtime island沒有 package/test/script production reference。
- targeted tests：Media／backend／Map 共 17 tests 全數通過。
- `npm run verify`：35 個 source files syntax check、24 tests 全數通過。
- copied DB isolated runtime：version `1.3.0`、schema v4、1100 Documents／523 Events／33 Media；REST map pagination為 3 pages／523 Events。
- isolated MCP：modern discover、tools list與 `atlas.latest` 均為 HTTP 200；代表圖包含 `document_id`、`source_id`、effective `display_policy` 與 current `policy_version`。
- browser：桌機與 390px 窄畫面通過；All 顯示 523 Events／172 mapped／3 pages，Hazards 顯示 173 Events／172 mapped；console 無 error/warning，修正窄畫面 15px 水平 overflow。
- `npm run check`、`git diff --check` 通過。

## Decisions made

- 以 current `sources.media_policy_json` 作 projection-time policy truth；persisted media policy 只保留 ingestion evidence，不保證當下可展示。
- Map filter 改用 canonical `politics / technology / finance / hazards`，不保留 legacy `infrastructure` 合併語意。
- pipeline batching 延後為獨立工作。

## Known issues / risks

- Worktree 已有大量未提交 Media／Newsroom 變更，任何修改與驗證必須避免覆蓋或誤 stage。
- live runtime 尚未採用本輪 source changes；source-ready、runtime-adopted與 UI-visible 需分開驗證。
- live coverage 仍是 `partial`、freshness 仍是 `stale`；本輪不把 process/endpoint 可達誤報為資料完整健康。

## Next step

- 取得獨立授權後，以既有 launcher lifecycle 採用本輪 source，重驗正式 port 的 REST／MCP／桌機與窄畫面；通過後再決定是否精準 commit／push。
