# 本輪完成紀錄

## 實作

- `src/macro/period.js`：month、quarter、year、ISO week、Saturday-ending week、event；date-only 半開區間；期別位移與 stage/occurrence ID。
- `coverage.js`：首次建立 release 時凍結 completeness rule/version，各指標可指定 required 與 release_period_offset。選配缺值不阻塞必要指標完整性；新增 catalog 指標不回頭改寫歷史規則。
- `semantics.js`：後端決定 unit/transformation/SA 顯示。Observation 保存 metadata snapshot；同一指標不允許改變 unit/transformation/SA。前端本期與歷史採 observation 的口徑及基期。
- `migrationV10.js`、Store、Capability、MCP：stage-aware release identity、同值新版本歷史、泛化查詢；GET/MCP 無採集副作用。既有月資料 IDs 和 API profile 保留。
- 時間：scheduled_at、source_published_at 與 timestamp_semantics、provider_published_at、first_observed_at、persisted_at、effective_at 分開。未實際量測的 legacy timestamps 不補造。persisted_at 記錄 ingestion transaction 使用的時間，不宣稱精確 commit latency。
- Watch metadata 可設定 before_ms/after_ms/poll_ms，預設 10 分鐘／30 分鐘／60 秒。`macro_watch_windows` 保存真實 evaluation 與前態 health/schedule；backoff/lease 不被繞過。calendar 改期使用不同 watch key。
- `macro_artifacts` 保存 statement/SEP/dot_plot/press_conference/minutes 型別、raw hash/URL 與 lineage；document link 只在其 raw_fetch 對應時使用。尚未接入 FOMC provider。
- 發布窗口工具使用 durable watch evidence，分開首次有值與首次完整；歷史沒有 watch record 時保持 not_observed。latency 驗收仍需真實發布窗口。

## 驗證

- Macro、source-result、scheduler、entity、schema、backend、company、formal-regional、JP primary、NCDR 相關 regression：59 passed、0 failed。
- 新增 7 項泛化測試，包含週跨年與非法日期、GDP 同值三階段、as-of/read-only、Claims 不同參考週、required freeze/optional missing、event/artifact、watch/backoff、顯示口徑、migration rollback/FK。
- `npm run check`：126 files passed；`git diff --check` 通過（既有 ExternalInterfaces.md 有 CRLF 正規化提示）。
- Online backup：`data/db/backups/macro-generalization-2026-09-12T04-48-59-137Z/atlas.sqlite` 與 `original.env`；獨立 `migration-copy.sqlite` 完成 schema 9 → 10。21 indicators、28 releases、57 observations、28 calendar versions、57 release-observation links 的所有舊欄位 SHA-256 完全一致。integrity_check=ok、foreign_key_check=0。
- 正式載入：原 Tray 30192 維持管理，舊 backend 54660 在 collector idle 時停止；新 backend 60424、runner 18468，8790，schema 10。正式 proof：`data/runtime/macro-generalization-formal-proof.json`。
- 三組正式 current/complete，CPI/PPI/PCE 本期分別 6/9/6，總歷史 57；REST/MCP data+coverage parity，讀取前後 macro source_runs 同為 5，FK 無違規。
- 正式 browser 重新載入 `/macro.html`，CPI 數值與 PPI 切換正常。PPI 本期 9 列，基期使用已保存 observation（例如 04/10），缺值仍為「未取得」，raw archival warning 保留；截圖版面無遮擋。
- 正式 release-window 工具 smoke：parity=true、after_window、verified=false，歷史缺少 watch record 未補造。

## 後續接入與限制

正式 groups 仍為 cpi/ppi/pce、21 indicators。週／季／event 能力以 fixture 驗證；Labor → GDP → Claims → FOMC 尚待各自官方 parser、metadata、真實樣本、發布日曆與正式接入驗收。FOMC typed decision、Event bridge、surprise/forecast、OMI consumer 沒有在本輪實作。原有 provider 的「即時」延遲仍未做真實發布窗口驗收。

未修改 `.env`、未 staging/commit/push，保留既有其他工作樹變更。phase1/phase2 文件是各自歷史驗收快照，本輪 current schema 以這份紀錄為準。
