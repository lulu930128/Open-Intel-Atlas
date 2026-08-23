# Open Intel Atlas 新聞平台長期架構設計

## Goal

- 將使用者提出的政治、科技發展、金融、氣象／重大天災為主、其他領域可擴充的新聞系統，整理成可長期維護的產品與 target architecture Markdown。
- 明確定義 UI、canonical backend、versioned API、read-only-first MCP、OMI 與 Kuro 的責任邊界。
- 以目前 repo 與 Backend v1 工作為基線，避免另建互相競爭的架構。

## Non-goals

- 本任務不修改 frontend、backend runtime、DB schema、source adapters 或 MCP 程式碼。
- 不啟動、重啟或對外發布服務。
- 不替使用者決定公網部署、多語、retention、LLM 或通知時效等尚未確認的產品選項。

## Hard constraints

- Repo 已有大量未提交 frontend、server、store 與 Backend v1 變更；只新增 `docs/` 文件，不覆寫既有工作。
- 主要領域不得成為 hard-coded storage topology；需要可擴充分類註冊表。
- outward Event 必須有 evidence lineage；來源失敗與資料缺口要保留 truthful state。
- OMI 擁有市場語意，Kuro 擁有人格／通知 UX；Atlas 提供 canonical news evidence。
- MCP 與 consumer adapter 保持薄，backend 擁有 taxonomy、freshness、coverage、verification 與 severity。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Current branch: `main`
- Current repo description: local-first public intelligence dashboard and JSON API prototype, version `0.8.0`。
- Current runtime path: `src/server.js` 使用 legacy `collectIntel()`、category DB 與 `/api/*`。
- In-progress task: `docs/agent-runs/backend-v1/` 已定義 Source → Document → Story → Event 與 canonical `atlas.sqlite` 方向，但尚未完成 runtime wiring。
- Current visible test directory: 無測試檔。

## Deliverables

- `docs/product/`：ProductVision、OperatingModel、QualityBar、Roadmap。
- `docs/architecture/`：SystemArchitecture、DataModel、ExternalInterfaces。
- `docs/README.md` 文件索引。
- 本任務 Prompt、Plan、Progress 與 Tier 0 驗證證據。

## Done criteria

- 文件明確區分已確認、目前假設、待決策、目前實作與 target state。
- 分類、資料模型、scheduler、UI、API、MCP、OMI/Kuro、security、rights、observability 與 migration 皆有清楚邊界。
- Markdown 內部連結可解析，UTF-8 讀回正常，`git diff --check` 不新增 whitespace error。
- 不修改 `docs/` 外的既有未提交檔案。

## Open questions / assumptions

- 目前假設先維持 local-first 單使用者，再由公網／多使用者需求觸發部署升級。
- 待使用者確認部署範圍、多語策略、更新時效、資料保存期限、LLM 角色與第一級 domain 清單。
