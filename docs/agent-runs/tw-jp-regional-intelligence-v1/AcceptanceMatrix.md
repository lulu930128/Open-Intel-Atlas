# Completion and acceptance matrix

## Reading rule

`Proven in G1–G3` means the working tree, fixtures, copied database, isolated runtime, or isolated UI has passed。`G4 passed` 表示正式 runtime identity／schema／source／contract 已採用；仍不代表本輪尚未 restart 的 source changes、正式 backfill 或 G5 product acceptance 已完成。`Not achieved` 表示必要證據尚不存在或 current formal evidence 未達門檻。

## Requirement audit

| Requirement | Current status | Authoritative evidence | Remaining proof |
| --- | --- | --- | --- |
| One canonical `Source → Document → Story → Event → Capability` path | G4 passed；本輪修正 source-level | Formal runtime 1.3.0／schema 5／contract 1.2／33 sources；full tests 79/79 | 本輪 held evidence／regional candidate prefilter／MCP brief country 修正仍需後續 runtime adoption |
| TW dedicated official sources and truthful gates | G4 passed；target observation passed | President、Executive Yuan、MOFA、NCDR、TWSE contracts；formal MOFA/NCDR healthy/current 且達 observation gate；CWA credential-disabled；TWCERT rights hold | G5 UI/detail acceptance |
| JP dedicated official core | G4 passed；observation partial | Formal JMA、MOD、JPCERT、FDMA、NDL healthy/current；JMA／MOD／JPCERT／FDMA 已達 observation gate；METI disabled | NDL 完成三次／兩 cadence |
| Provider rights/transport failures fail closed | G4 passed | Formal METI disabled；source tests保留 NCDR rights、TWCERT hold、CWA credential gate | G5 failure-slice 行為抽查 |
| Durable PromotionDecision with reason/method/version | G4 schema passed；full backfill pending | Schema v5、promotion tests、formal DB 已自然累積 499 decisions、copy apply-twice | 另行授權完整 bounded backfill |
| Durable RegionalRelevance separate from event location | Proven in G2/G3 | Relevance tests、event-location count/hash invariant、copy reprocess | Formal backfill and outward Event-detail spot checks |
| Source country never fabricates Event country | Proven in G2/G3 | NCDR/FDMA/JMA negative tests and unchanged `event_locations` hash | Formal Event detail and `country=TW|JP` acceptance after backfill |
| Regional selector quality gate and no global filler | G4 contract passed；修正版 source-level | Formal contract 1.2 四種 presentation 可區分且 Japan shortfall 如實回傳；Store candidate regression passed | 修正版 runtime adoption與 post-backfill ordered IDs |
| REST and modern MCP parity | G4 passed；本輪擴充 source-level | Formal adoption verifier四種 presentation ordered IDs parity；targeted REST/MCP tests涵蓋 `atlas.latest.country`、`atlas.brief.country` 與 country/presentation 交集 | 本輪修正的 formal runtime parity |
| Truthful partial source health | G4 passed；observation partial | 七個 enabled regional sources formal healthy/current；MOFA、NCDR、JMA、MOD、JPCERT、FDMA observation passed；METI disabled | NDL observation；failure-slice behavior |
| Formal runtime schema/source/contract identity | G4 passed | Current 8790 is 1.3.0、schema 5、contract `1.2`、33 sources、scheduler enabled | 本輪尚未 adopted source diff 要另走 restart gate |
| Three usable runs across two cadence windows | Partially achieved | MOFA、NCDR、JMA、MOD、JPCERT、FDMA達標；NDL 仍只有 1 次 | 等待 NDL 自然跨 cadence後重跑 `verify:formal-acceptance`；不可人工補跑假裝跨 cadence |
| Formal regional product mix | Partially proven | East Asia/Taiwan 各選 8；Japan 選 2 並回 `qualified_event_shortfall`；REST/MCP parity | observation 完成、授權 backfill、formal browser/detail acceptance |
| Desktop and 390px formal UI | Not achieved | Isolated UI passed, but no formal G5 browser evidence exists | Browser DOM/screenshot, URL reload, gaps, overflow and console checks on formal 8790 |
| Formal MCP and Event-detail lineage | Partial | Formal presentation MCP parity passed；本輪 held evidence與 country filter只在 source/copy驗證 | 修正版 adoption、backfill後 representative Event → Document/evidence trace |
| Runtime adoption, DB backfill, task installation, commit and push remain independent | Proven as process boundary | Runbook and fail-closed verifiers preserve separate gates | Obtain explicit authorization for each operation before execution |
| Optional GDELT regional discovery | Optional / held | Existing global GDELT has failure/backoff history | Revisit only after core regional product acceptance |

## Current completion decision

Source、canonical policy、selector、migration、copy replay、isolated runtime/UI 與 formal acceptance tooling 已實作；G4 formal runtime adoption 也已通過。專案仍未完成，因本輪 held evidence／regional candidate prefilter／MCP brief country 修正尚未被正式 runtime 採用，完整 backfill 未授權，NDL observation 未達門檻，G5 UI／Event-detail／MCP product acceptance 尚未完成。

下一個 transition 保持窄範圍：先讓 scheduler 自然累積 NDL cadence evidence；本輪 source diff 若要進正式 runtime，另取 restart 授權並重跑 G4。正式 backfill 必須在新 runtime recollection 後重新 read-only audit，取得獨立寫入授權後才可執行；最後再做 G5 browser／Event detail／MCP acceptance。
