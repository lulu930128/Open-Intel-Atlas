# Regional reprocess 副本驗證

## 驗證邊界

- 驗證日期：2026-08-30 Asia/Taipei。
- 正式 `data/db/atlas.sqlite` 只由 read-only connection 開啟，透過 SQLite online backup 建立暫存複本。
- 所有 migration、PromotionDecision／RegionalRelevance 規劃與寫入只發生在暫存複本；完成後刪除複本。
- 本驗證不授權正式 DB backfill、runtime restart、commit 或 push。

## 候選盤點

執行 `npm run audit:regional-reprocess`：

- Documents：1,181；Events：532；兩者都未因 configured bound 截斷。
- PromotionDecision 預估：held 147、promoted 1,034。
- 相較既有 Event evidence，promotion eligibility 改變 0、stranded Event 0。
- RegionalRelevance：TW Event 1、JP Event 1、EAST_ASIA associations 2；530 Events 沒有可證明的區域 relevance。
- source country 與 event country invariant 保持分離。

這些數字是 2026-08-30 當次正式 DB snapshot 的副本結果；正式 adoption 前必須重新執行，不能把它們當作固定寫入清單。

## Apply-twice 證據

執行 `npm run verify:regional-reprocess`：

1. 第一次 bounded apply 寫入 1,181 筆 PromotionDecision，並為 2 個 Events 寫入 4 筆 RegionalRelevance associations。
2. `event_locations` 維持 291 rows，ordered projection 的 SHA-256 前後一致；沒有用 source scope 改寫 event country。
3. `story_updates` 只增加 2 筆 relevance update。
4. 對同一份已更新複本重新 plan/apply，PromotionDecision 與 relevance writes 都是 0；row counts 與 location hash 不再改變。
5. `PRAGMA integrity_check=ok`，`PRAGMA foreign_key_check` 0 violations。

另有 isolated fixture regression 驗證 schema-only copy：第一次寫入 1 個 decision 與 1 個 Event 的 JP／EAST_ASIA relevance，第二次 0 write；Japan brief 能選到該 Event，event location 保持不變。

## 正式套用 stop conditions

正式 backfill 前必須重新建立可恢復 backup 並重跑兩個副本驗證。遇到以下任一情況就停止：

- Documents 或 Events 被 bound 截斷。
- promotion eligibility 改變不為 0，或出現 stranded Event。
- 第二次 apply 仍產生任何 write。
- `event_locations` count／hash 改變。
- SQLite integrity／foreign-key check 失敗。
- 預估寫入量和使用者授權的 bounded range 不一致。

正式 backfill 是獨立授權；通過本文件的副本驗證，不代表可以寫入正式 DB。
