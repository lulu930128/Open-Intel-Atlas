# 第一版驗收紀錄

日期：2026-09-12。已完成程式、隔離樣本與正式 runtime 採用驗收；發布窗口延遲仍待實測。

| 驗證面 | 結果 |
| --- | --- |
| Syntax | `npm run check`：114 files passed |
| 相關 regression | 49 tests passed，0 failed |
| Macro 專項 | 11 tests：口徑／DST／malformed／缺值、collector／transaction、revision／as-of／pagination、failure、watch／backoff、calendar reschedule、previous、future embargo、migration |
| 官方樣本 | 7 次請求，calendar 26 entries，observations 47 筆，15 個本期指標 |
| REST／MCP | fixture 與官方樣本均比對同一份 canonical data／coverage |
| 唯讀邊界 | 查詢前後 SQLite `total_changes()` 不變，沒有 provider request |
| 重抓 | 使用已取得的官方 responses replay，observation 數量不變 |
| 資料完整性 | 隔離 DB `PRAGMA foreign_key_check` 無違規 |
| 舊資料相容 | 舊 schema migration／Company／source result／scheduler／backend／regional gate 相關測試通過 |
| 變更範圍 | 起始 baseline 對照；UTF-8 讀回與 `git diff --check` 通過 |

相關 regression 指令：

```powershell
node --test --test-isolation=none test/macro-intelligence-v1.test.js test/source-result-v2.test.js test/scheduler-freshness-v2.test.js test/entity-pipeline-v1.test.js test/schema-company-news-v7.test.js test/schema-entity-v6.test.js test/backend-v1.test.js test/company-capabilities-v1.test.js test/formal-regional-acceptance-v1.test.js test/jp-primary-evidence-sources-v1.test.js test/tw-ncdr-cap-source-v1.test.js
```

官方樣本指令：

```powershell
node scripts/verify-macro-sample.mjs --live
```

此指令僅開啟臨時 DB／ephemeral listener，source set 僅包含三個 BLS source；回放不重複打 provider，最後移除臨時 DB。報告保存在 `.tmp/macro-v1-live-proof.json`，不包含 credentials 或 provider 全文。

## 正式採用驗收

- 使用者授權備份後直接測試。啟用前正式 DB 已是 schema 9，三個 BLS 來源均未採集。
- 備份：`data/db/backups/macro-v1-2026-09-12T03-48-44-104Z/`，包含 SQLite online backup、原 `.env`、manifest。備份副本重新開啟，`integrity_check=ok`、外鍵違規 0；此備份是 schema 9 啟用前狀態，不能作為 schema 8 回復點。
- 已啟用三個 BLS flags。在 collector 閒置時停止已驗證的 backend PID 35744，由原 Tray PID 30192 自動恢復；新 runner 3244、backend／8790 listener 49760，血緣再次核對通過。
- 三個來源由正式 scheduler 採集成功：日曆 26 筆、CPI 14 筆、PPI 33 筆觀測；本期 `2026-08` 共 15 個指標完整，coverage／freshness 為 current。
- 正式 observations、calendar、indicator、CPI release、PPI release 五組 REST／MCP data 與 coverage 一致。全年日曆查詢採 `[2026-01-01, 2027-01-01)`，返回 25 筆；來源總數 26 包含查詢範圍外項目。
- 查詢前後 BLS source runs 與全部 macro observations 完全一致；正式 DB 外鍵違規 0，既有 events API smoke 通過。正式 scheduler 持續工作，此結果不宣稱整個 DB 零寫入。
- 證據：`data/runtime/macro-v1-formal-proof.json`、`macro-v1-owner-proof.json`、`macro-v1-backup.json`。未 commit／push。

## 保留限制

- Repo 來源預設仍停用；本機 `.env` 已啟用且正式 DB 已取得觀測，既有 Tray 保留。
- 官方 HTML 可能變動。BLS API 可用性不代表發布即時性；這次是在發布後取得樣本，無法驗證下次公布的端到端延遲。
- PPI 完整 raw table 超過既有 archive 上限的情況已在 source warning／observation raw capture flags 揭露；不聲稱保留完整原始 HTML。
- previous 若在發布前未取得則 null；revision 0 是本機首見版本，不是保證官方 initial vintage。
- 完整歷史 backfill、正式 OMI 採用、Macro UI／Event bridge 另列後續，不包含在本次第一版驗收。
