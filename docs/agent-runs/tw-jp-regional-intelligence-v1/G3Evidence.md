# G3 隔離 Runtime 驗收證據

## 驗收方式

- 時間：2026-08-30 Asia/Taipei
- 命令：`npm run verify:isolated-adoption`
- 正式資料庫：只以 read-only connection 開啟，使用 SQLite online backup 建立暫存複本。
- Runtime：working-tree server、`127.0.0.1` OS-assigned ephemeral port、`ATLAS_AUTO_COLLECT=false`。
- 清理：runtime 關閉後刪除暫存 DB 與目錄；未操作正式 8790 listener。

## Identity 與 storage

| Check | Result |
| --- | --- |
| Consumer contract | `1.2` |
| Schema | `5` |
| Registered sources | `33` |
| Scheduler | disabled |
| Coverage | `partial` |
| Source runs in copied snapshot | `1,714` |
| Documents／Stories／Events | `1,181`／`678`／`532` |

`tw-mofa-press-releases`、`tw-ncdr-active-cap-alerts`、`jp-mod-news`、`jp-jpcert-alerts`、`jp-jma-eqvol`、`jp-fdma-disaster-info`、`jp-ndl-diet-minutes` 都在 isolated registry 且 enabled，health 均為 `unknown`，因為本驗收刻意不執行 provider I/O。`jp-meti-latest` 在 registry 但為 disabled／health `disabled`，符合 live Node HTTP 403 的 fail-closed 決策。

## REST／MCP parity

| Presentation | Candidates | Quality-qualified | Regional-qualified | Selected | Coverage gaps |
| --- | ---: | ---: | ---: | ---: | --- |
| `global` | 64 | 64 | n/a | 8 | none |
| `east_asia` | 64 | 64 | 0 | 0 | `no_qualified_regional_events`, `qualified_event_shortfall` |
| `taiwan_focus` | 64 | 64 | 0 | 0 | `no_qualified_regional_events`, `qualified_event_shortfall` |
| `japan_focus` | 64 | 64 | 0 | 0 | `no_qualified_regional_events`, `qualified_event_shortfall` |

四個 presentation 的 REST 與 modern MCP `atlas.brief` 均回傳相同 contract、selection presentation、ordered Event IDs 與 coverage gaps。

三個區域 profile 為 0 是預期結果：schema-only migration 不對既有 532 Events 做無界 relevance backfill。Selector 沒有拿 global highlights 補數，證明 fail-closed 與 no-global-filler contract 在真實 store snapshot 上成立。正式採用後必須由新來源 collection 或另行授權的 bounded reprocess 產生 durable relevance，才可進入 G5 UI product acceptance。

## Isolated UI acceptance

- 使用 working-tree static UI 與正式 DB 複本，在 scheduler-disabled `127.0.0.1` isolated runtime 執行。
- Desktop initial render：global radio checked、12/12 selection 可見、Hero 與 Live Desk 都由 backend brief highlights 驅動。
- East Asia：URL 更新為 `?presentation=east_asia`；Hero 與 Live Desk 同時顯示 truthful empty state，並顯示兩個 backend coverage gaps，沒有 global fallback。
- Taiwan／Japan／Global：三個控制都能完成 request、更新 checked state／URL／status；切回 global 後恢復 global brief。
- URL reload：`east_asia` selection、gap 與 empty state 均可恢復。
- 390×844：control 呈 2×2 hard-edge grid，document／control 無水平 overflow，status 仍可見。
- Browser console：error 0、warning 0。
- Cleanup：隔離 port 關閉；`tw-jp-ui-acceptance.sqlite` 暫存 DB 刪除，正式 8790 與正式 DB 未操作。

這是 G3 source-level UI proof。正式 runtime 採用並產生 live regional relevance 後，仍須在 G5 重做 desktop／390px、REST/MCP ordered IDs 與 Event detail lineage 驗收。
