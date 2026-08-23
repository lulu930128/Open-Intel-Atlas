# Progress

## Status

- Current phase: done
- Last updated: 2026-08-23（Asia/Taipei）

## Completed

- 讀取 repo README、package、環境範例、server/store/source/dashboard 架構與 git 未提交範圍。
- 讀取既有 Backend v1 Prompt/Plan/Progress，確認 canonical pipeline 方向與 current worktree 邊界。
- 建立長期產品文件、target architecture、canonical data model、REST/MCP/OMI/Kuro 整合契約與文件索引。
- 所有新增內容限制在 `docs/`，未修改現有 frontend/backend 程式。

## Validation evidence

- 11 份本任務 Markdown 以 strict UTF-8 讀回：無 replacement character。
- 必要章節檢查：0 missing。
- local Markdown link 檢查：0 broken。
- trailing whitespace 檢查：0 hits。
- `git diff --check`：無 whitespace error；只顯示既有 tracked worktree 的 LF/CRLF warning。
- `git status --short -- docs`：`docs/` 仍為未追蹤文件範圍。
- 本任務未修改 `docs/` 外檔案；外部既有／並行的 frontend、backend 與 Backend v1 變更均保留。

## Decisions made

- 現有四類 `geopolitics / infrastructure / finance / ai` 視為 legacy mapping，不作長期 storage topology。
- Target taxonomy 使用 `primary_domain`、`domains[]`、`topics[]`、`event_types[]`，以 registry 擴充醫療等領域。
- `severity`、`verification`、`freshness`、`coverage` 分成不同狀態軸。
- public query 不直接觸發無界 source fetch；scheduler/admin job 與 read path 分離。

## Known issues / risks

- Backend v1 仍在進行且 worktree 未提交；本文件尚未轉換為 runtime schema/API。
- 公網部署、多語、retention、LLM 角色與通知時效仍待使用者確認。
- External source rights 與 redistribution policy 必須逐來源審核，文件只能定義預設邊界。

## Next step

- 由使用者確認優先待決策項目，再將 architecture 對齊 Backend v1 implementation milestones。
