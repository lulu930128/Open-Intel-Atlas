# Plan

## Milestones

1. 固定基線與任務邊界
   - Scope: git status／target diff、產品文件、runtime/API、task docs。
   - Acceptance: dirty worktree 與 current live state 已記錄；不混入 Intelligence、pipeline batching、commit/push。
   - Validation: `git status --short --branch`、`GET /api/v1/health`、cursor page audit。

2. Media final closure
   - Scope: `src/documents/media.js`、`src/atlasStore.js`、`src/atlasCapabilities.js`、media/backend tests。
   - Acceptance: lineage 完整；先計算 current effective policy，再跨 supporting evidence deterministic 選圖；REST/MCP 共用 projection。
   - Validation: `node --test --test-isolation=none test/media-visual-newsroom-v1.test.js test/backend-v1.test.js`。

3. Full Map canonical convergence
   - Scope: `public/atlas.html`、獨立 map model/client module、Map renderer與 tests。
   - Acceptance: 不讀 `/api/dashboard`；支援 cursor pagination、canonical domain/range、alpha-2 association、可靠 marker與 truthful truncation。
   - Validation: targeted Node tests、browser network/DOM/screenshot desktop與窄畫面。

4. Legacy 與文件收斂
   - Scope: old runtime island reference audit、compatibility boundary、SystemArchitecture／IntelligenceLayer 等 current docs。
   - Acceptance: unsupported runtime 不再與正式 runtime 混淆；compatibility API 不被誤刪；current schema/runtime 說法一致。
   - Validation: reference grep、`npm run check`、UTF-8 讀回、`git diff --check`。

5. 最終驗收
   - Scope: fresh/copied DB、full verify、REST/MCP、live browser、diff/security scope review。
   - Acceptance: 所有 gate 各自有證據；partial/stale/provider failure 不被健康 endpoint 掩蓋。
   - Validation: `npm run verify`、local isolated runtime smoke、live read-only probes、browser screenshots。

## Stop-and-fix rules

- targeted test 未通過，不進下一 milestone。
- effective policy 若無法從 current source registry/store deterministic 重建，停止 outward media cutover。
- Map cursor、filter或零座標測試失敗，不以第一頁或猜測資料 fallback。
- 發現 legacy 檔案仍有 production reference 時，不刪除，改為文件化隔離。
- copied DB migration/count invariant 未通過，不觸碰 live DB。

## Decisions

- 2026-08-30：Media selection 與 policy downgrade 合併成單一 backend selection path，避免先選後降級造成錯誤 fallback。
- 2026-08-30：Map 使用 v1 cursor pagination；總量 cap 後仍有 cursor 時必須顯示截斷。
- 2026-08-30：legacy cleanup 與 pipeline batching 分離；batching 預設延後。
- 2026-08-30：現有 dirty worktree 不建立 broad checkpoint；只在後續得到 commit 授權時精準 stage。
