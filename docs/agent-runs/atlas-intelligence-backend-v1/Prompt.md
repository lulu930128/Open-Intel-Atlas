# Atlas Intelligence Backend v1

## Goal

- 接續現有 Backend v1 與 Consumer Gateway，完成 Atlas Intelligence Layer 的第一個後端版本。
- 修復並強化 canonical entity identity，支援一個 Story 對多個 entity 的可追溯關聯。
- 建立 deterministic、versioned Assessment，分離 verification、confidence、severity、global importance 與 entity relevance/materiality。
- 以現有 append-only `story_updates` 建立 material-change detection，不新增第二套 change truth。
- 提供 bounded Top Stories、Entity News 與 structured `atlas.ask` capabilities；不依賴 mandatory LLM。

長期設計依據：[Atlas Intelligence Layer 架構](../../architecture/IntelligenceLayer.md)。

## Non-goals

- 本任務不修改 Atlas frontend、newsroom 或 map。
- 不修改或啟動 OMI、Kuro、Control Center、tunnel 或外部 connector。
- 不新增股票專用 crawler、每股獨立資料庫或另一套 market-data store。
- 不由 Atlas 擁有 instrument master、market reaction、價格方向、投資建議或交易行為。
- 不優先新增來源、全量翻譯、mandatory LLM、vector DB、PostgreSQL、Redis、message queue 或微服務。
- 不在本任務完成公網 authentication、多租戶、通知發送或付費 provider rollout。

## Hard constraints

- 保留 `Source → Document → Story → Event` canonical pipeline、stable IDs、evidence lineage 與現有 v1/legacy compatibility surface。
- Assessment、entity resolution 與 ranking 都是 versioned derivative；不得覆寫或捏造原始 evidence。
- `story_updates` 是唯一 durable material-change ledger；不可新增平行 change log。
- schema 採 additive migration，先在空 DB、legacy fixture 與 copied real DB 驗證；沒有備份／restore 證據不得直接遷移使用者 live DB。
- canonical entity name 不得被 location label、ticker alias 或單次 mention 覆寫；ambiguous／unresolved 狀態 fail closed。
- confidence 不直接提高 global importance；missing／unknown 不得轉為 0。
- public read path 不觸發無界 provider I/O；所有 list/query response 同時有 item 與 serialized-byte bounds。
- Atlas 只提供事件／entity intelligence；OMI 保有 instrument 與市場影響的 canonical semantics。
- 目前 worktree 有未提交的 Consumer Gateway 與相關文件／測試變更；不得回復、覆蓋或混入無關重構。
- 不重啟或改動 live runtime，除非使用者另行明確授權。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Runtime: Node.js 24+、native `node:http`、`node:sqlite`、single-process local-first service。
- Supported entrypoint: `npm start` → `src/atlasServer.js`。
- Source baseline: schema v3 implementation、durable `story_updates`、consumer contract `1.1` profiles、`/api/v1`、loopback read-only MCP 均存在於目前 worktree。
- 2026-08-25 validation baseline: `npm run verify` 通過 34 個 syntax checks 與 10/10 tests。
- 2026-08-25 live-state baseline: `127.0.0.1:8790` 無 listener；實際 `data/db/atlas.sqlite` migration 尚為 v2，因此 source readiness 不代表 live adoption。
- Read-only DB baseline: 668 Documents、371 Stories、315 Events、12 Entities、84 event-entity links；只有 1 個 company entity，且 country canonical name 有 contextual location overwrite 問題。

## Deliverables

- Entity identity policy、schema evolution、canonical-name repair migration 與 unresolved/conflict diagnostics。
- `StoryEntityLink` canonical model，以及 relationship/relevance/entity-event-materiality contract。
- versioned deterministic Assessment model、domain policy profiles、reason codes、limitations 與 evidence hash。
- `story_updates` material-change extension、state-transition classification 與 correction/retraction handling。
- Top Stories、Entity News、structured intelligence query capability 與 versioned projections。
- serialized response-size budget、continuation behavior 與不裁減 warnings/freshness 的 regression tests。
- migration/idempotency/replay/data-quality/API contract/partial-failure tests。
- README、DataModel、ExternalInterfaces、Roadmap 與本任務 Progress 的實作狀態更新。

## Done criteria

- canonical entity upsert 不再被 contextual labels 污染；已知錯誤資料可在 copied DB 上安全修復並保留 alias/audit evidence。
- NVIDIA/NVDA、TSMC/TSM/台積電等 fixture 能穩定解析；`Apple` 等歧義詞沒有公司證據時保持 unresolved。
- 一個 Story 可連結多個 entity，relationship、confidence、reason codes 與 evidence IDs 可追溯。
- 相同 evidence hash + policy/version 產生相同 Assessment；confidence 不直接改變 global importance。
- proposal → official、verification upgrade、severity change、correction/retraction 能產生單一、可續接、idempotent `story_updates` material change。
- Top Stories 與 Entity News 不只按 recency 排序，且不被同一 root Story 的重複 coverage 壟斷。
- structured `atlas.ask` 在沒有 LLM/key 時完成既定 intents；無法解析的 `question` 不會靜默猜測。
- REST 與 MCP projections 保留 stable IDs、freshness、coverage、warnings、limitations 與版本資訊。
- 空 DB、v1/v2/v3 migration fixture、copied DB replay、`npm run verify`、localhost API/MCP smoke 與 `git diff --check` 通過。
- source、DB、runtime 與 consumer adoption 狀態分層記錄；未驗證層級不宣稱完成。

## Open questions / assumptions

- 初期仍採 local-first、單使用者、單 Node process 與 SQLite WAL；容量證據未達 gate 前不拆服務。
- `entity_event_materiality` 僅描述非市場性的業務／法律／營運重要程度；名稱若在實作時仍易誤解，可改為更窄的 contract 名稱。
- Atlas 可以保存有來源與有效期的 ticker alias，OMI 仍是 canonical instrument mapping owner；實際 OMI adapter 不在本任務。
- Change retention、cursor expiry 與 snapshot resync 必須在開始 pruning 前定案；本任務預設保留完整新歷史。
- LLM semantic assessor 僅保留未來 extension point，不列入 Backend v1 done criteria。
