# Plan

## Milestones

1. Baseline、版本與安全落腳點
   - Scope: Git status、README/package/runtime version、schema v3、產品/架構文件、現有 tests、Newsroom renderer、source policy、live listener／DB 唯讀證據。
   - Acceptance: worktree scope 已固定；README/package/runtime version 一致；`npm run verify` baseline 通過；只建立 temp/copied DB 測試路徑，不碰 live DB；暫定 release target 已記錄。
   - Validation: `git status --short --branch`、`npm run verify`、read-only DB migration/count probe、`Get-NetTCPConnection -LocalPort 8790`。

2. Media policy 與 normalized contract
   - Scope: `atlasSourceRegistry.js`、Document normalization、URL/security helper、source media policy schema、tests。
   - Acceptance: `candidate != remote_embed`；HTTPS embed、userinfo/IP/private/localhost/host allowlist、rights/policy version 均 fail closed；media array 有 item/string bounds、stable identity 與 deterministic dedupe。
   - Validation: targeted normalization/policy tests，涵蓋 valid、javascript/data、HTTP embed、private host、unapproved CDN、tracking query、duplicate、malformed dimension 與 oversized metadata。

3. Schema v4 與 transactional persistence
   - Scope: `atlasSchema.js`、`atlasStore.js`、`document_media` DDL、upsert/read helpers、representative invariant、copied-DB fixtures。
   - Acceptance: additive v3→v4；`UNIQUE(document_id, normalized_url)`；partial unique representative index；enum/dimension checks；Document+media 同 transaction；重跑與 duplicate ingest idempotent；media failure 可降級。
   - Validation: fresh DB、v1/v2/v3 migration fixtures、actual copied-DB replay、failure rollback、duplicate/reingest tests；before/after Documents/Stories/Events/Story updates counts 不減少。

4. Provider media ingestion
   - Scope: GDELT adapter、RSS parser、實際有明確 media payload 的其他 adapter；raw metadata compatibility。
   - Acceptance: GDELT `socialimage` 建立 normalized candidate；RSS 僅解析明確 `media:content`、`media:thumbnail`、image enclosure／Atom equivalent；非 image／malformed media 被忽略；不 fetch article HTML。
   - Validation: provider fixtures、parser ordering/quote/CDATA/entity fixtures、無 media fixture、single-media failure isolation；provider-live 另列 gate。

5. Representative selection 與 bounded read model
   - Scope: Document detail/list、Story/Event list/detail、batch media lookup、representative/fallback policy。
   - Acceptance: Document 代表 media deterministic；Story/Event 先沿 representative Document，fallback 時保留 selected Document lineage；list 只帶 bounded representative object；detail media array 有上限；無 media 為 `null`。
   - Validation: representative/fallback/tie-break/blocked-policy tests；test-only query counter證明 1→20 items 不增加逐 item media query；serialized payload size 有上限。

6. Capability、REST、MCP 與 change semantics
   - Scope: `atlasCapabilities.js`、`atlasApi.js`、profiles、contract docs、MCP shared projection。
   - Acceptance: `projectDocument`、`projectCompactEvent`、`projectStory` 投影 optional additive media；REST/MCP stable IDs、lineage、policy、freshness、coverage、warnings 一致；media 不取代 evidence citation；policy change 不冒充 Story material change。
   - Validation: REST/MCP contract tests、legacy no-media fixtures、byte-budget tests、invalid profile/input tests、change-feed invariants。

7. Newsroom visual foundation
   - Scope: `public/index.html`、`public/newsroom.js`、`public/newsroom.css`、static security headers。
   - Acceptance: `resolveVisual(item)` 只讀 backend data並只在 `remote_embed` 成立時回傳 source image；Latest 前 2–3 筆與 Domain 首則支援 optional media；Live Desk 不放 thumbnail；沒有 media 不產生 visual block。
   - Validation: JS syntax、DOM assertions、source inspection 確認沒有 canonical URL/provider fetch、沒有 `raw_metadata.socialimage` 或 source-rights hardcode。

8. Image failure、安全、responsive 與可存取性
   - Scope: CSP/Referrer-Policy、`<img>` attributes、error handling、fixed aspect ratio、desktop/mobile CSS、attribution/source labels。
   - Acceptance: blocked media 不 render；404／timeout image 自動移除 figure；不重抓 API、不隱藏 headline/evidence；360px 無水平 overflow；有圖時 hero 以 image→headline stack，無圖時直接 headline；keyboard/dialog/reduced-motion baseline 不退步。
   - Validation: isolated browser desktop/mobile、broken/no-media/slow-image states、console/network/overflow checks、request count、basic accessibility inspection。

9. Full regression、文件與 source-ready checkpoint
   - Scope: complete tests、docs、version metadata、diff、release candidate audit。
   - Acceptance: 只包含 Media v1 範圍；沒有 secrets、runtime DB、logs、screenshots垃圾或無關格式化；current/target/adoption/provider states 分開記錄。
   - Validation: `npm run verify`、targeted migration/parser/contract tests、`npm audit --audit-level=high --ignore-scripts`、Markdown/local-link check、`git diff --check`、exact staged diff review。

10. Live runtime adoption（需另行明確授權）
    - Scope: 現有 launcher lifecycle、backup、live v3→v4 migration、representative API/MCP calls、Newsroom desktop/mobile、provider sample。
    - Acceptance: exact process／entrypoint／DB/schema 已確認；backup可用；API/MCP/UI 真正採用新 source；source image、fallback、partial/stale 可見；停止後沒有 orphan process。
    - Validation: launcher-selected endpoint、`/api/v1/health`、profiles/events/stories/brief、MCP representative calls、browser screenshots/DOM/network、live DB count/invariant audit；遠端 provider 不可用時 provider-live 保持 pending。

## Stop-and-fix rules

- 若 README/package/runtime version 未收斂，不進 release；若 copied-DB migration 未通過，不碰 live DB。
- 若 source/media policy 無法證明 rights 與 allowed host，保持 `candidate`／`link_only`，不得為了顯示圖片改成 `remote_embed`。
- 若 URL 可指向 localhost、private/link-local host、userinfo 或任意未核准 host，停止 UI embed 並修正 policy validation。
- 若 media normalize/save failure 使 Document collection 失敗，先恢復 failure isolation，不進 UI。
- 若同一 Document 可有多個 representative media、重跑產生 duplicate row 或 migration 降低 canonical counts，停止並修正 schema/transaction。
- 若 Story/Event 保存獨立 image URL，或前端讀 raw metadata／canonical URL 抓圖，停止並回到 Document-owned contract。
- 若 list/brief 對 media 產生逐 item DB 或 REST lookup，先改為 JOIN/batch，不用 cache 掩蓋 N+1。
- 若 payload budget 裁掉 freshness、coverage、warnings、limitations 或 evidence lineage，視為 contract failure。
- 若 no-media/broken-media 造成新聞消失、broken icon、layout shift、水平 overflow 或 detail/evidence 不可操作，停止並修正 UI。
- 若 source image 與 Atlas editorial/data visual 無法辨識，停止 release 並補 provenance label。
- 若 GDELT/provider 不可用，只標記 provider-live pending；不得以 fixture/source-ready 冒充 live success。
- 未取得 live runtime／DB migration 明確授權前，不啟動、重啟、備份或寫入 live DB。

## Decisions

- 2026-08-30：採 Document-owned media；Story/Event/REST/MCP/UI 只使用 backend-selected projection。
- 2026-08-30：`candidate` 預設不可顯示；`remote_embed` 需通過 source-specific rights 與 host policy。
- 2026-08-30：schema v4 使用 additive `document_media`；migration 本身不做外部 fetch 或無界 backfill。
- 2026-08-30：Media v1 不把 presentation policy change 寫成 Story material change。
- 2026-08-30：Live Desk 保持 text-first；Hero、Latest、Domain 首則才建立 visual hierarchy。
- 2026-08-30：Hazards mini-map、Finance data visual 與更完整 domain visual 延後 Media v1.1，避免第一輪同時擴大資料與視覺語意。
- 2026-08-30：後續產品決策 supersede missing-image fallback；只有 `remote_embed` 顯示來源圖片，無合法圖片時 visual block 完全省略，Atlas-owned visualization 日後使用獨立 contract。
- 2026-08-30：`publisher_owned` 不再單獨等同可展示；真實 `remote_embed` policy 必須另有展示授權、terms evidence 與審核時間。
- 2026-08-30：BBC News RSS 採 usage-context gate；只有明確 `personal_noncommercial` 的本機 runtime 使用官方 feed 原樣 thumbnail，未設定或商業情境保持 `candidate`。
- 2026-08-30：source release 暫定 `1.3.0`；consumer contract若只新增 nullable field，可維持 `1.1`，並以 contract tests證明 additive compatibility。
