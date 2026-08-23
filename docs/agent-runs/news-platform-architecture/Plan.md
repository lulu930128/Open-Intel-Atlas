# Plan

## Milestones

1. Repo 與方向盤點
   - Scope: README、package、entrypoint、store、source registry、Backend v1 task、未提交變更。
   - Acceptance: current state、in-progress state 與 target gap 可被檔案證據支持。
   - Validation: `rg --files`、`git status --short`、相關檔案 UTF-8 讀取。

2. 產品方向文件
   - Scope: ProductVision、OperatingModel、QualityBar、Roadmap。
   - Acceptance: 只把使用者已說明內容與 repo 事實寫成已確認，其餘標為假設或待決策。
   - Validation: section/readback check、內部連結檢查。

3. Target architecture 文件
   - Scope: SystemArchitecture、DataModel、ExternalInterfaces。
   - Acceptance: Source → Document → Story → Event → Query flow，以及 UI/API/MCP/OMI/Kuro ownership 可落到未來 milestone。
   - Validation: 必要章節與 contract 範例檢查。

4. 任務紀錄與 Tier 0 驗證
   - Scope: docs index、Progress、diff。
   - Acceptance: 沒有改動 `docs/` 以外檔案；Markdown links 存在；無 whitespace error。
   - Validation: UTF-8 readback、PowerShell local-link probe、`git diff --check`。

## Stop-and-fix rules

- 若文件把尚未完成的 Backend v1、MCP 或 consumer wiring 描述成已上線，先修正文意再交付。
- 若架構要求 UI/MCP/consumer 重算 backend semantics，改回單一 canonical ownership。
- 若分類設計仍依賴 per-category DB 或封閉 enum，改成 registry + primary/multi-domain model。
- 若驗證發現 `docs/` 外的新變更，不觸碰或回復使用者檔案，先隔離本次 diff。

## Decisions

- 2026-08-23：沿用 Backend v1 的 Source → Document → Story → Event 方向，不另建第二套 pipeline。
- 2026-08-23：使用主要領域 + 可擴充 domain/topic/event type registry，不把四大領域綁定 DB。
- 2026-08-23：REST 與 MCP 共用 backend capability layer；MCP read-only-first 且保持薄。
- 2026-08-23：OMI 保留市場語意，Kuro 保留 persona/notification UX，Atlas 只擁有新聞 evidence 與其品質狀態。
