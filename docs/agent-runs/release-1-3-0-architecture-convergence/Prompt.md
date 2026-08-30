# Open Intel Atlas 1.3.0 封版前架構收斂

## Goal

- 讓 Media outward projection 保留 Document／Source lineage，並依 runtime 現行來源政策 fail closed 後再選代表圖。
- 讓 Full Map 只讀 canonical `/api/v1/events`，使用 cursor pagination、canonical domain、可靠座標與 ISO alpha-2 country code。
- 收斂不再使用的舊 runtime island，修正 current architecture 文件，完成可重現的 API、MCP、DB 與瀏覽器驗收。

## Non-goals

- 不實作 Intelligence Layer 新功能、LLM enrichment、OMI／Kuro adoption、公開部署或 image proxy。
- 不修改 canonical severity、verification、domain、Story clustering 或 Event truth。
- 不在本輪進行 pipeline batching；除非驗證發現它是封版 blocker，否則保留為後續獨立工作。
- 不刪除 legacy SQLite／runtime data，也不移除仍作 compatibility surface 的 legacy API。

## Hard constraints

- 保留目前 dirty worktree 的既有 Media／Newsroom 變更；不 broad revert、不整包 commit。
- effective media policy 必須使用 backend current source policy，重新驗證 HTTPS、rights、display authorization、terms evidence、review time 與 host allowlist。
- 所有 outward Media projection 共用同一判斷；UI 與 MCP 不重算政策。
- Map 不推測國家、不放置假座標；缺 country code 仍可顯示可靠 marker，缺座標仍保留列表紀錄。
- API pagination 必須 bounded；截斷時 UI 明確標示。
- runtime restart、commit 與 push 是獨立 gate；本次實作授權不自動包含發布。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Related systems: canonical SQLite store、REST v1、MCP capability、Newsroom、Full Map、Windows local runtime。
- Current known state: branch `main`、HEAD `65b9ca2`，package/runtime `1.3.0`、live schema v4；2026-08-30 盤點有 523 Events、172 筆可靠座標，`/api/v1/events` 每頁最多 200 筆且 live response 有 cursor。
- Current worktree: Media Visual Newsroom v1 尚未提交，必須逐檔保留與審查。

## Deliverables

- Media effective-policy helper、display-aware representative selection、lineage projection與回歸測試。
- Full Map canonical v1 client、cursor pagination、domain/range filters、presentation adapter與測試。
- legacy runtime island 清理或明確隔離、current architecture 文件修正。
- `npm run verify`、copied/fresh DB、REST/MCP、desktop/mobile browser與 final diff evidence。

## Done criteria

- Document、Story、Event、brief、latest REST/MCP 的 representative media lineage 與 effective policy 一致。
- 現行來源政策降級後，既有 persisted `remote_embed` 在下一次讀取立即 fail closed，不需重新抓來源。
- Full Map network 不再要求 `/api/dashboard`，能跨 cursor 顯示 canonical Event，filter 與截斷狀態 truthful。
- 正式 runtime entrypoint 唯一且文件沒有 current-state 矛盾。
- 所有相關自動測試與實際 UI smoke 通過；任何未完成項目明確列為 pending。

## Open questions / assumptions

- `Live` 保留為最新一頁／近期操作視圖；`24H`、`7D`、`30D` 使用 UTC `from`，`All` 受明確 client cap 限制並顯示截斷狀態。
- legacy API 先標示 compatibility-only；移除須等正式 consumer 歸零，不在本輪強制刪除。
