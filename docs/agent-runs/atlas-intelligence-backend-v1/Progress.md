# Progress

## Status

- Current phase: planning complete; implementation not started
- Last updated: 2026-08-30 +08:00

## Completed

- 將使用者提供的 Intelligence Engineering Plan 視為構想，對照目前 ProductVision、OperatingModel、QualityBar、Roadmap、SystemArchitecture、DataModel 與 ExternalInterfaces。
- 對照既有 Backend v1 與 Consumer Gateway 任務，確認本計畫必須接續現有 canonical pipeline、schema v3 source、`story_updates`、profiles 與 MCP。
- 完成 [Atlas Intelligence Layer 架構](../../architecture/IntelligenceLayer.md)，記錄 responsibility split、canonical model、assessment、entity links、material change、ranking、query、payload 與 rollout 原則。
- 固定 Backend v1 goal、non-goals、hard constraints、deliverables、done criteria、milestones 與 stop-and-fix rules。
- 明確將 backend 排在 frontend、OMI、Kuro 與 consumer runtime adoption 之前。

## Validation evidence

- 2026-08-25 baseline `npm run verify`: 34 files syntax check passed；10/10 tests passed。
- 2026-08-25 `git diff --check`: baseline passed。
- 唯讀 live-state probe：`127.0.0.1:8790` 無 listener；未啟動或重啟 runtime。
- 唯讀 `atlas.sqlite` audit：migration v1/v2；668 Documents、371 Stories、315 Events、12 Entities、84 event-entity links。
- Entity audit：只有 1 個 company entity，且 country canonical name 可被 contextual location label 覆寫；已列為 Milestone 2 前的 foundation blocker。
- Worktree audit：現有 Consumer Gateway 相關 source/docs/tests 尚未提交；本輪只新增規劃文件，不回復或重寫既有變更。
- 2026-08-30 publication candidate：Consumer Gateway source 與本規劃文件已一起通過 `npm run verify`；這不代表 live DB migration、runtime adoption 或 Intelligence Layer implementation 已完成。

## Decisions made

- 本輪只記錄架構與後端計畫，不實作、不改 DB、不改 runtime。
- `story_updates` 保持唯一 durable material-change truth；不新增 competing `material_changes` ledger。
- Entity canonical identity／repair 先於 scoring、ranking 與 entity news。
- `entity_event_materiality` 不代表市場價格影響；OMI 保留 instrument／market semantics。
- `atlas.ask` 先做 structured deterministic router；任意自然語言與 LLM semantic assessor 延後。
- 每個新 intelligence stage 先 shadow/replay，再影響 outward ranking 或 consumer profile。

## Known issues / risks

- Source 已包含 schema v3，但 2026-08-25 的實際 DB 證據仍是 v2；開始實作前仍需以此次 Consumer Gateway baseline 完成 copied-DB migration gate。
- 目前 Event 是由 Story ID 產生的 mutable current state；若未來改成 immutable Event revisions，需要獨立架構決策與 migration。
- 多語 Story clustering、entity ambiguity、source independence、correction/retraction 與 ranking calibration 是主要品質風險。
- 現有 legacy dashboard ranking 將 confidence 加入優先分數；新 ranking cutover 前必須避免雙重 backend truth。
- 尚未定義 change retention、cursor expiry、snapshot resync 與長期 assessment retention。

## Next step

- 進入 Milestone 1「收斂 baseline 與 migration gate」：先固定 Consumer Gateway 起始狀態，在 copied DB 驗證 v2→v3 migration、backup/restore 與 entity data-quality invariants；沒有 live runtime／DB 寫入授權前只做 source、fixture 與副本驗證。
