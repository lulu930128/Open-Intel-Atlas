# Progress

## Status

- Current phase: completed
- Last updated: 2026-08-23 完成（Asia/Taipei）

## Completed

- 讀取工程計畫、repo 現況、package scripts、現有 adapters/store/server 與未提交 diff。
- 確認 Node.js `v24.14.1`，baseline `npm run check` 通過。
- 確認目前七個可選 provider 設定均未配置，未讀取或輸出任何 secret。
- 以官方文件與 bounded live sample 核對 GDACS、TWSE、Federal Register、World Bank、NWS、ECB 回應欄位。
- 完成統一 config、domain/source registry、bounded HTTP client 與 23 個 adapters；其中 17 個預設可啟用，6 個依設定 fail closed。
- 完成 `atlas.sqlite` schema、source run/raw fetch、Document、Story、Event、evidence、entity、location 與游標查詢 store。
- 完成文字／URL／時間清洗、stable identity、同來源 dedupe、deterministic clustering、verification 與沒有 evidence 不建立 Event 的 invariant。
- 完成 `/api/v1`、freshness／coverage／warnings envelope、loopback-only manual collect、in-process scheduler 與 graceful shutdown。
- 完成 legacy `/api/*` read-only projection，現有 dashboard 與 map contract 可繼續取得 canonical Event。
- 更新 README、`.env.example`、package scripts 與 Backend v1 測試。

## Validation evidence

- `npm run check`: baseline passed。
- `Get-NetTCPConnection -LocalPort 8790`: 本輪開始時無 listener。
- 公開 API bounded field probe: TWSE、Federal Register、GDACS、World Bank、NWS、ECB 成功。
- `npm run verify`: syntax check 29 files；3 個 Node tests 全數通過。
- live collector cycle: 17 個預設來源中 15 個首次成功；修正 OSV range 後為 16 healthy、1 failed、6 disabled。
- live canonical store: 372 Documents、271 Stories、240 Events、11 Entities；舊 DB 未修改。
- consistency audit: event without evidence=0、orphan document=0、invalid point=0、0/0 point=0、market/research promoted event=0、unredacted key URL=0。
- localhost runtime smoke: `npm start` 監聽 `127.0.0.1:8790`；v1 health/sources/events/hazards、legacy dashboard 與首頁 HTTP 200；19/20 hazard sample 有來源座標。
- graceful shutdown: SIGINT 後 listener 關閉。

## Decisions made

- 新 v1 與 legacy DB 並存，避免破壞目前 runtime data。
- 先完成 adapter contract 與 store，再接新來源，避免擴大 `src/sources.js` 耦合。
- live API sample 只讀取 bounded 欄位，不保存或顯示任何憑證。
- 市場觀測與研究內容保存為 Document，但預設 `event_eligible=false`；無可靠座標的 Event 不進 map。
- API outward response 不顯示本機 DB 路徑；含 key 的 query URL 在 raw lineage 與錯誤訊息中遮罩。

## Known issues / risks

- GDELT 連續兩次為 `UND_ERR_CONNECT_TIMEOUT`；目前誠實顯示 failed，BBC 與其他來源仍正常，未以 fallback 偽裝成功。
- Congress.gov、SEC EDGAR、FRED、ReliefWeb、CWA 需要合法設定；Semantic Scholar 預設 opt-in，因此尚未做本輪 live acceptance。
- Node 24 的 `node:sqlite` 仍會顯示 ExperimentalWarning；本機驗證可用，但對外 production 部署前需固定 Node 版本並納入升級驗證。
- scheduler 是本機單 process baseline；多實例、長期 retention、job lease／queue、auth/rate limit 不在本次範圍。
- 2026-08-23 後續 `scheduler-freshness-v2` 已將 schema 升到 v2，加入 SQLite schedule state、lease/backoff、bounded catch-up、conditional GET 與 domain freshness；本文件保留 v1 驗收歷史。

## Next step

- 取得合法 provider 設定後，逐一啟用 6 個 ready-but-disabled adapters 並補 live contract fixtures；之後再進行 UI 改讀 v1 或 MCP thin adapter。
