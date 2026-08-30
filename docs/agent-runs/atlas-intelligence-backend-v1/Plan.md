# Plan

## Milestones

1. 收斂 baseline 與 migration gate
   - Scope: 現有 dirty worktree、Consumer Gateway、schema v3 source、實際 v2 DB、備份／restore procedure、data-quality audit。
   - Acceptance: 明確固定本任務起始 commit/diff；Consumer Gateway tests 維持通過；在 copied DB 證明 v2→v3 migration、rollback/restore 與 row-count invariants，不動 live DB。
   - Validation: `npm run verify`、`git diff --check`、read-only schema/count audit、copied-DB migration smoke。

2. Entity identity foundation
   - Scope: `entities`／`entity_aliases` evolution、identifier provenance、resolution runs、unresolved/conflict queue、canonical-name repair。
   - Acceptance: canonical identity 不被 contextual mention 覆寫；alias/identifier 有來源與 method；修復可重跑且不丟失 event links。
   - Validation: `node --test --test-isolation=none test/entity-identity-v1.test.js test/entity-migration-v1.test.js`。

3. Story Entity Link 與 resolver
   - Scope: `story_entity_links`、relationship taxonomy、relevance、entity-event-materiality、evidence linkage、deterministic resolver stages。
   - Acceptance: one Story → many entities；NVIDIA/NVDA/TSMC fixtures 正確；ambiguous Apple fixture 保持 unresolved；重跑不重複 link。
   - Validation: `node --test --test-isolation=none test/entity-resolution-v1.test.js test/story-entity-links-v1.test.js`。

4. Deterministic Assessment shadow
   - Scope: assessments schema、domain policy profiles、component scores、global importance、confidence、reason codes、limitations、evidence hash/cache key。
   - Acceptance: 相同輸入完全可重現；confidence 不直接增加 importance；缺資料保留 unknown/limitation；不改變現有 outward ranking。
   - Validation: `node --test --test-isolation=none test/assessment-v1.test.js test/assessment-fixtures-v1.test.js`。

5. Material Change engine
   - Scope: 擴充 `story_updates`、state transition classifier、change importance、correction/retraction、assessment linkage。
   - Acceptance: proposal→official、verification upgrade、severity change、evidence-only update、correction/retraction fixtures 產生正確且唯一的 change；duplicate ingest 不增加 version。
   - Validation: `node --test --test-isolation=none test/material-change-v1.test.js test/backend-v1.test.js`。

6. Ranking 與 intelligence capabilities
   - Scope: Top Stories、Entity News、diversity policy、horizon filters、item/byte budgets、continuation、versioned profiles。
   - Acceptance: 全域 ranking 與 entity ranking 使用不同 policy；同一 Story 不重複佔位；低全球重要度／高 entity materiality 可出現在 Entity News；warnings/freshness 不被裁掉。
   - Validation: `node --test --test-isolation=none test/ranking-v1.test.js test/intelligence-capabilities-v1.test.js`。

7. Structured `atlas.ask`
   - Scope: deterministic intent router、request resolution、input validation、REST/MCP projection；structured parameters 為 authoritative input。
   - Acceptance: `top_stories`、`material_changes`、`entity_news`、`story_detail`、`timeline`、`evidence`、`freshness` 無 LLM 可用；unknown/ambiguous question fail closed；舊 tools/routes 保持相容。
   - Validation: `node --test --test-isolation=none test/atlas-ask-v1.test.js test/backend-v1.test.js`。

8. Backend acceptance 與文件收斂
   - Scope: copied real DB replay、migration、diagnostics、full regression、localhost API/MCP smoke、README/architecture/task docs。
   - Acceptance: schema/row-count/lineage invariants、orphan=0、Event without evidence=0、assessment/link idempotency、partial failure、payload bounds 全部通過；未啟動 OMI/Kuro/frontend work。
   - Validation: `npm run verify`、targeted intelligence tests、copied-DB replay audit、localhost API/MCP smoke、UTF-8/link check、`git diff --check`。

## Validation matrix

| Surface | Required evidence |
| --- | --- |
| Schema/migration | empty DB、v1/v2/v3 fixtures、copied real DB、backup/restore |
| Entity quality | canonical overwrite、alias provenance、ambiguous/unresolved、multi-entity Story |
| Assessment | determinism、policy/version、confidence separation、unknown semantics |
| Material change | state transitions、correction/retraction、duplicate idempotency、cursor restart |
| Ranking | global/entity fixture separation、diversity、Top-K snapshot、low-confidence critical case |
| API/MCP | additive contract、invalid input、pagination、byte budget、freshness/warnings preservation |
| Runtime | exact entrypoint/PID/DB/schema、localhost representative calls；需要重啟時先取得授權 |

## Stop-and-fix rules

- 若現有 Consumer Gateway、migration、cursor 或 MCP regression 失敗，先恢復 baseline，不進 Intelligence Layer。
- 若 entity migration 會覆寫正確 canonical identity、遺失 alias 或斷開 event links，停止 migration 並改用 additive repair/audit flow。
- 若 resolver 對 ambiguous mention 自動建立高信心 link，fail closed 並保留 unresolved，不以人工特例掩蓋。
- 若 confidence 直接影響 global importance，或 market reaction 被放進 Atlas Assessment，停止並修正 ownership/policy。
- 若 material change 需要第二張 competing ledger，回到 `story_updates` contract，不建立雙重 truth。
- 若 response budget 會裁掉 warnings、freshness、coverage 或 limitations，視為 contract failure。
- 若 copied DB replay 未通過，不遷移 live DB；若 runtime identity／DB path 未確認，不啟動或重啟服務。
- 每個 milestone 完成後更新 `Progress.md`；target、source-ready、runtime-adopted 與 consumer-adopted 分開記錄。

## Decisions

- 2026-08-25：先完成後端 Intelligence Layer，再處理 frontend、OMI 與 Kuro adoption。
- 2026-08-25：接續既有 Backend v1／Consumer Gateway，禁止建立第二套 backend、store 或 change log。
- 2026-08-25：Entity identity 修復先於 Assessment、ranking 與股票／公司 news projection。
- 2026-08-25：Material Change 擴充既有 append-only `story_updates`；目前採 mutable current Event + previous/current change state。
- 2026-08-25：Atlas 擁有事件／entity evidence 與非市場性 importance；OMI 擁有 instrument mapping、market reaction 與投資判斷。
- 2026-08-25：Assessment deterministic-first、shadow-first；LLM 不是 Backend v1 correctness dependency。
- 2026-08-25：本輪只建立規格與計畫，不修改 runtime code、DB 或外部系統。
