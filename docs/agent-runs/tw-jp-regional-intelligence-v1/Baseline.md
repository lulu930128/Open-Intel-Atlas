# Runtime 與區域曝光基準

## 擷取時間

- 2026-08-30 18:08 Asia/Taipei
- Runtime endpoint：`http://127.0.0.1:8790/api/v1`
- Listener：`127.0.0.1:8790`，PID `50116`，`C:\Program Files\nodejs\node.exe`
- Process start：2026-08-30 17:57:31 Asia/Taipei
- Windows 拒絕讀取該 process 的完整 command line，因此本基準只宣告已驗證的 listener、PID、executable、start time 與 API source tree，不推測 launcher arguments。

## Runtime source tree

- Registered：26
- Enabled／expected：19
- Healthy or current：18
- Failed：1（`gdelt-doc`，`ECONNRESET`，連續 9 次失敗並已 backoff）
- Disabled：7
- Coverage：`partial`

### 台灣來源

| Source | Runtime state | Last result | Documents |
| --- | --- | --- | ---: |
| `tw-president-office-news` | enabled、healthy、current | success，10 items | 10 |
| `tw-executive-yuan-news` | enabled、healthy、current | success，30 items | 30 |
| `twse-material-info` | enabled、healthy、current | valid not-modified | 1 |
| `tw-mofa-press-releases` | disabled | source flag | 0 |
| `cwa-weather-warnings` | disabled | missing `cwaApiKey` | 0 |

總統府與行政院已被目前 runtime 採用；這項 adoption 發生於本里程碑盤點前，本計畫不宣稱執行過 restart。

## Canonical store distribution

- Documents：1,153
- Events：527
- TW dedicated official Documents：41（3.56%）
- JP dedicated Documents：0

Document volume 最高來源：`gdacs-events` 456、`osv-dev` 104、`bbc-world-rss` 103、`arxiv-ai` 100、`nasa-eonet` 88、`federal-register` 80。這說明既有 store 的 global／US-heavy 不是單一廣告來源問題，而是 ingestion volume、Event promotion 與 brief selection 共同造成。

### Event geography

| Geography state | Events | Share |
| --- | ---: | ---: |
| no location object | 237 | 44.97% |
| location present but country unknown | 156 | 29.60% |
| US | 119 | 22.58% |
| TW | 1 | 0.19% |
| JP | 1 | 0.19% |
| other identified countries | 13 | 2.47% |

`source_country` 不可用來填補上述 event geography。TW／JP Event 各 1 筆是既有 location evidence 的結果，不代表 dedicated 台日來源已完成 Event promotion。

## Brief exposure

目前 `/api/v1/brief` 回傳 8 個 highlights：

- US NWS hazards：1
- BBC world politics：3
- OSV technology：4
- TW：0
- JP：0

因此 Milestone 0 的核心結論是：新增總統府與行政院來源已改善 Document coverage，但尚未改善首頁／brief 的區域曝光。下一步不能只繼續加 RSS；必須完成 promotion audit、regional relevance 與 backend selector，且先通過 freshness、verification、dedupe 與 retraction gate。

## Baseline limitations

- 這是單一時間點的 read-only snapshot，不代表 24 小時 health observation。
- 未執行 restart、正式 DB reprocess／backfill 或 mutation。
- `gdelt-doc` 當時失敗，不能用其缺資料推論長期 regional coverage。
- Brief 統計只描述當次 8 個 highlights；完整 store 分布另由全量 cursor pagination 計算。

## 18:35 bounded recheck

- 同一 listener PID `50116` 仍回傳 26 sources、schema 4、consumer contract `1.1`。
- 正式 DB 已自然前進到 1,654 source runs、1,753 raw fetches、1,154 Documents、674 Stories、565 Story Updates、528 Events；本計畫沒有寫入這些資料。
- `presentation=east_asia` 被舊 contract 忽略，ordered highlights 與 global request 相同，仍是 NWS／BBC／OSV 共 8 筆；這證明 working-tree selector 尚未被 runtime 採用。
- 隨後以 SQLite online backup 建立暫存複本並重播 schema 5：既有 18 張表筆數不變、integrity ok、foreign keys 0；正式 DB connection 為 read-only，沒有執行 migration 或 backfill。
