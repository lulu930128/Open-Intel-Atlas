# 產品路線圖

## 北極星目標

Open Intel Atlas 能在單一可信資料模型上持續蒐集多領域公開資訊，將新聞文件整理成可追溯的 Story／Event，讓使用者從 UI 理解現況，也讓 OMI、Kuro 與其他 agent 透過穩定 API/MCP 取得一致證據。

## 目前基線

- `已存在`：Node.js 原生 HTTP server、23-source registry、canonical `Source → Document → Story → Event` pipeline、schema v3 `atlas.sqlite`、SQLite-owned persistent scheduler、durable `story_updates`、bounded catch-up、conditional GET、domain freshness、consumer contract `1.1` profiles、`/api/v1`、loopback read-only MCP、legacy projection、editorial newsroom／map UI、contract tests，以及由 current-user Windows logon task 啟動的 single-instance 托盤 owner。
- `進行中`：Operational UI 第一個可用版本已完成 overview、事件／報導 evidence view、domain desks、search 與 system status；Consumer Gateway 已完成 Atlas 端 contract 與 local protocol proof，接著收斂 correction/retraction、OMI/Kuro 實際採用與長期營運能力。
- `尚未完成`：correction/retraction 完整流程、auth/rate limit、公網部署、OMI/Kuro runtime wiring、backup retention/restore drill 與多節點 scheduler。

後續里程碑必須接續目前 canonical backend、Consumer Gateway 與既有 frontend projection，不另開互相競爭的 backend 或資料 truth。

## 里程碑

### M0：確認產品與契約

成果：確認領域 taxonomy、多語策略、部署範圍、資料保存政策、LLM 角色與對外使用者。

驗收：產品文件中的待決策項目有 owner 與結果；System Architecture 和 Backend v1 task 不互相矛盾。

### M1：Canonical ingestion foundation

成果：Source Registry、bounded HTTP client、scheduler、`source_runs`、`raw_artifacts`、`documents`、schema migrations 與 idempotent collection。

驗收：單一來源失敗隔離；重抓不重複；缺設定的 provider 為 `disabled`；fixture tests 與空 DB initialization 通過。

### M2：Story／Event intelligence layer

成果：Document dedupe、Story clustering、Event/evidence、entity、location、verification、correction/retraction 與可重算 enrichment version。

驗收：同事件多篇文件可聚合；aggregator 不誤算獨立佐證；每筆 outward Event 可回溯 evidence；無 geo evidence 不放假座標。

### M3：Operational UI

成果：overview、story detail/timeline、domain explorer、source health、search、system status，以及完整 empty/partial/stale/error state。

驗收：desktop 與窄螢幕實際畫面通過；第一屏同時顯示重大故事與 coverage/freshness；可由 story 回到原始來源。

### M4：Stable API 與 MCP

成果：`/api/v1` read API、cursor pagination、contract envelope、auth/rate limit 邊界、read-only MCP tools/resources 與相容政策。

驗收：API contract tests；MCP modern `server/discover → tools/list → representative call/resource read` 與 legacy stateless compatibility；查詢不觸發無界外部 fetch。

### M5：OMI 與 Kuro 採用

成果：薄 adapter、representation profile、consumer contract tests、runtime configuration 與 end-to-end adoption proof。

驗收：OMI 實際取得 Atlas evidence 且仍擁有市場語意；Kuro 實際取得 compact brief 且仍擁有人格／通知 UX；各層 freshness 與 error state 一致。

### M6：公開服務與領域擴充

成果：依決策加入公網部署、多使用者、quota、observability、backup/restore、醫療等新領域與正式來源政策審核。

驗收：TLS、authentication、rate limit、abuse control、restore drill、source rights matrix 與容量 gate 通過後才開放。

## 近期優先順序

1. 讓 Operational UI 直接呈現 v1 domain freshness、source gap 與 Story/Event evidence，不在前端重算語意。
2. 補 correction/retraction、retention、backup/restore 與 provider contract regression。
3. 以 OMI 與 Kuro 各一條最小真實讀取流程驗證 contract，而不是先做大量 consumer-specific endpoints。
4. 定義 change retention、cursor expiry 與 snapshot resync，再考慮 pruning。

## 近期完成

- `2026-08-23`：交付 editorial newsroom v1。首頁以 backend-selected highlight 作頭條，提供 live events、latest stories、四領域版面、跨事件／報導／文件搜尋、evidence drawer 與 partial/stale/source-gap 說明；desktop 與 360px browser smoke 通過，既有全屏地圖維持可用。
- `2026-08-23`：交付 Consumer Gateway v1。Schema v3 保存 durable Story/Event changes；REST 與 MCP 共用 contract `1.1` profiles；loopback MCP 通過 modern/legacy protocol smoke。外部 OMI/Kuro adoption 仍屬 M5。

## 延後事項

- 自動對外通知、email、webhook 與付費 provider。
- LLM 自動產生高風險結論或無人工可追溯的「真相分數」。
- PostgreSQL、Redis、message queue、vector database 與微服務拆分；先由容量與可靠度指標觸發。
- 大規模全文搜尋、全文鏡像與長期原始內容保存，需先完成權利與成本評估。

## 風險與依賴

- upstream schema、rate limit、授權與可重散布範圍會變動。
- 多語去重、同事件 clustering、地理定位與來源獨立性比單純 keyword 分類困難。
- 本機 powered-off 期間只能補回 provider 仍保存的歷史資料。
- 公開 API 會引入 authentication、濫用、配額、隱私、內容授權與營運成本。
- 若未先收斂 canonical schema，UI、MCP、OMI 與 Kuro 會各自依賴不同 payload。
