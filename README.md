# Open Intel Atlas

Open Intel Atlas 是一個本地優先的公開情報監測基礎版。它會抓取公開資料源，整理成統一的事件格式，提供人類可讀的 newsroom、全屏世界地圖，以及給其他程式或 AI agent 呼叫的 JSON API。

目前版本：`1.1.0`

這不是 World Monitor 的 clone。此專案使用自己的資料模型、API contract、UI 版面、source registry 和本地 SQLite 儲存方式。

## 目前實作狀態

- Node.js 24+ 原生 HTTP server，無前端框架、無第三方 npm dependency。
- 新的 canonical pipeline 採用 `Source → Document → Story → Event`，保留來源、raw fetch、衍生方法與證據 lineage。
- 23 個 source adapter 已註冊；17 個無額外憑證即可啟用，6 個會在缺少設定或未明確開啟時 fail closed。
- 每個來源各自保存 run status、最後成功／失敗、錯誤、筆數與 latency；單一來源失敗不會拖垮查詢 API。
- SQLite schema v2 保存每個來源的 `next_due_at`、lease、failure count、backoff 與 catch-up gap；process 重啟後不會把排程狀態歸零。
- 可使用 ETag／Last-Modified 時送出 conditional GET；HTTP 304 視為來源成功但不建立重複 Document。
- freshness 同時提供全域與 politics／technology／finance／hazards 分領域 coverage。
- `/api/v1/*` 提供 versioned documents、stories、events、entities、search、brief、source health 與 collector API。
- 首頁是 newsroom-first 版面，顯示本期頭條、live desk、最新報導、四領域 desks、搜尋與資料缺口；事件與 Story 詳情可直接回到原始證據。
- `/atlas.html` 是獨立全屏情報地圖；只有具備可驗證座標的事件會出現在地圖上，並可跳到對應事件卡片。
- `/api/dispatch` 提供 AI handoff brief、分類統計、watchlist、source 狀態與 normalized event highlights。
- `/api/events` 提供 normalized event records，支援 `range`、`date`、`category`、`limit` 查詢。
- `/api/sources` 提供資料源 metadata、用途、政策備註、docs URL、最新檢查狀態、最後成功/失敗時間。
- `/api/dashboard` 提供首頁儀表板聚合資料：brief cards、top signals、watchlist impacts、sector heat、mini map points、data status、evidence feed。
- `/api/stories` 和 `/api/topics` 提供濃縮新聞 story clustering 與趨勢主題資料。
- v1 canonical data 寫入單一 `data/db/atlas.sqlite`，以關聯表表達多領域資料，不再一類別一個 DB。
- 舊分類 DB 與 dashboard DB 可能繼續存在於本機，但不會由 v1 migration 刪除或由目前 runtime 讀寫；legacy `/api/*` 直接投影 canonical store。
- Runtime DB、logs、`.env` 都已由 `.gitignore` 排除，不會進 repo。

## 資料源

目前 source registry：

- 政治：GDELT DOC、BBC World RSS、U.S. Federal Register、Congress.gov。
- 科技：arXiv、CISA KEV、CISA Advisories、NVD CVE、OSV.dev、Semantic Scholar。
- 金融：TWSE 重大訊息、SEC EDGAR、CoinGecko、Frankfurter、FRED、ECB、World Bank。
- 氣象／災害：USGS、NASA EONET、GDACS、ReliefWeb、臺灣 CWA、U.S. NWS。

預設未啟用或缺少設定的來源會明確顯示 `disabled_reason`：Congress.gov、SEC EDGAR、FRED、ReliefWeb、CWA 與 Semantic Scholar。市場觀測值與研究論文會保存為 Document，但預設不會把每個價位或每篇論文升格成 Event。

NVD attribution notice:

> This product uses data from the NVD API but is not endorsed or certified by the NVD.

正式商用前，仍需要逐一確認每個 upstream source 的 terms、attribution、cache、rate limit、redistribution 限制。

## 本地啟動

```powershell
npm start
```

開啟：

```text
http://localhost:8790
```

需求：

```text
Node.js >= 24
```

原因是本地分類儲存使用 Node 內建的 `node:sqlite`。

## Windows 托盤常駐

`scripts/atlas-tray.ps1` 是 Windows 本機 runtime 的唯一 owner。它會使用工作區實際保存的 `manosaba_icon_56x56_under10KB.png` 作為托盤 icon，隱藏啟動後端，並提供：

- 雙擊 icon 或選擇「開啟 Atlas」開啟 `http://127.0.0.1:8790`。
- 啟動、停止、重新啟動後端與重新檢查 API 狀態。
- backend 異常結束後 bounded backoff 重啟。
- Explorer/taskbar 重啟與重複 launcher 呼叫時重新註冊既有 icon，不建立第二個 instance。
- 只停止自己建立的 process tree；若 port 已被其他程序使用，托盤不會接管或 broad-kill。

手動隱藏啟動：

```powershell
wscript.exe .\scripts\start-atlas-tray.vbs
```

托盤與 backend log 位於 `data/logs/`，已由 `.gitignore` 排除。

Windows 可能在第一次啟動時把新 icon 放進通知區域的 `^` overflow；是否固定顯示由使用者的 taskbar 偏好控制，安裝腳本不會修改個人化設定。

可選環境變數：

```powershell
$env:PORT = "8790"
$env:ATLAS_AUTO_COLLECT = "true"
$env:ATLAS_DB_PATH = "data/db/atlas.sqlite"
$env:NVD_API_KEY = ""
npm start
```

`NVD_API_KEY` 可留空。需要辨識或憑證的來源請依 `.env.example` 設定；未設定時該來源停用，不會用假資料替代。開發或離線測試可設 `$env:ATLAS_AUTO_COLLECT = "false"`，GET 查詢不會觸發 provider I/O。

## API

主要 v1 API：

```text
GET  /api/v1/health
GET  /api/v1/domains
GET  /api/v1/freshness
GET  /api/v1/freshness?domain=hazards
GET  /api/v1/sources
GET  /api/v1/documents
GET  /api/v1/documents/:id
GET  /api/v1/stories
GET  /api/v1/stories/:id
GET  /api/v1/events
GET  /api/v1/events/:id
GET  /api/v1/entities
GET  /api/v1/entities/:id/events
GET  /api/v1/search?q=...
GET  /api/v1/brief
GET  /api/v1/collector
POST /api/v1/collect?source=gdacs-events  (loopback only；scheduler 啟用時回傳 202 queued)
```

列表支援 bounded `limit=1..200` 與 `cursor`。依資源可用 `domain`、`source`、`document_type`、`event_type`、`severity`、`verification`、`lifecycle`、`country`、`entity`、`from`、`to`、`q` 篩選。錯誤固定回傳 `{ "error": { "code", "message" } }`。

以下 legacy API 保留給目前前端，由 canonical Event 即時投影，不會在 GET 時抓外部來源：

```text
GET /api/health
GET /api/sources
GET /api/events
GET /api/dispatch
GET /api/dashboard
GET /api/stories
GET /api/topics
GET /api/evidence
GET /api/map-points
```

`/api/events`、`/api/dispatch`、`/api/dashboard`、`/api/stories`、`/api/topics`、`/api/evidence`、`/api/map-points` 支援：

```text
range=live | 24h | 7d | 30d | all
date=YYYY-MM-DD
category=geopolitics | infrastructure | finance | ai
limit=1..500
```

範例：

```text
GET /api/dispatch?range=live&limit=50
GET /api/events?category=infrastructure&range=7d
GET /api/events?date=2026-05-25
GET /api/dashboard?range=24h
GET /api/topics?category=ai&range=7d
GET /api/evidence?range=24h
GET /api/map-points?category=geopolitics
```

`/api/dashboard` 是之後儀表板首頁的主要資料入口。它會把 raw events 聚合成：

```text
brief_cards
top_signals
watchlist_impacts
sector_heat
mini_map_points
data_status
evidence_feed
stories
topics
```

## 本地資料庫

v1 runtime 會建立：

```text
data/db/atlas.sqlite
```

既有 runtime 可能仍保有下列 legacy 檔案；v1 不會刪除或重寫它們：

```text
data/db/geopolitics.sqlite
data/db/infrastructure.sqlite
data/db/finance.sqlite
data/db/ai.sqlite
data/db/sources.sqlite
data/db/dashboard.sqlite
```

這些是本機 runtime data，不應提交到 git。它們已被 `.gitignore` 排除。

## Event Contract

每筆 canonical event 大致如下：

```json
{
  "id": "event:stable-id",
  "event_type": "hazards.earthquake",
  "primary_domain": "hazards",
  "title": "Human readable title",
  "summary": "Short normalized summary",
  "event_severity": "high",
  "verification_status": "official_confirmed",
  "confidence": 0.9,
  "representative_source": "USGS Earthquake Hazards",
  "representative_url": "https://earthquake.usgs.gov/...",
  "occurred_at": "2026-05-25T12:00:00.000Z",
  "evidence_count": 1,
  "independent_source_count": 1,
  "location": {
    "label": "USGS observed location",
    "latitude": 38.9,
    "longitude": -77
  }
}
```

## 排程、catch-up 與 freshness

- `ATLAS_AUTO_COLLECT=true` 時，poller 只負責喚醒；真正的 due time、lease 與 backoff 保存於 `atlas.sqlite`。
- 來源成功後依 cadence 加上 bounded jitter 排下次執行；失敗後從來源 cadence 開始指數 backoff，預設最多 24 小時。
- GDELT、Federal Register、USGS 支援最多 24 小時的 bounded time-window catch-up。
- CISA KEV 與 NVD 使用 provider history；RSS、即時警報與 snapshot API 為 `latest_only`，離線太久的 gap 會顯示 `SOURCE_GAP_UNRECOVERABLE`，不假裝已補齊。
- source freshness 以 `last_success_at` 與 cadence 計算；`data_as_of` 另外表示該 scope 最近一次 Document ingestion。
- `/api/v1/freshness?domain=...` 只計算該領域的 enabled／failed／stale／disabled sources。

Windows 登入後常駐可先用 dry-run 檢查。Scheduled Task 採目前使用者 `AtLogOn`、interactive、hidden window 與 `IgnoreNew`，action 直接指向托盤 launcher；backend 不再由第二套登入 action 另外啟動：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-atlas-logon-task.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-atlas-logon-task.ps1 -StartNow
```

解除 Windows 登入啟動不會停止目前正在執行的托盤：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-atlas-logon-task.ps1 -Uninstall
```

## 已知限制

- 目前 story clustering、entity extraction、嚴重程度與 confidence 是 versioned deterministic baseline，尚未接 LLM 或完整 NLP。
- GDELT、NASA EONET、NVD 等公開來源偶爾會 timeout 或 rate limit；API 會以 `degraded: true` 表示 partial coverage。
- 沒有登入、權限管理、部署設定或 production queue。
- 尚未做完整 geocoding；沒有可靠座標的事件仍保留在列表，但不會出現在地圖上。
- scheduler truth 已持久化，但仍定位為本機單實例；SQLite lease 用於 crash recovery／防重入，不宣稱是多節點 distributed lock。
- Windows 未登入或電腦關機期間仍無法抓取；重新登入後只補 provider 仍保留且 adapter 宣告可恢復的 bounded 資料。
- Dispatch 還沒有排程寄送、webhook、MCP server。
- 前端 newsroom 仍是單機基礎版，尚未加入登入、個人 watchlist、互動圖表或真正的即時行情。

## 下一步

- 加入 scheduled dispatch：email、webhook、chat tools。
- 加入 MCP server，讓其他 AI agent 直接查詢最新 brief 與 source-backed context。
- 為 key-gated adapters 配置合法憑證／識別，逐一跑 bounded live acceptance 與 terms review。
- 增加 correction／retraction、malformed payload、rate-limit 與 adapter fixture coverage。
- 加入可選 LLM-backed analysis，保留目前 no-key public source foundation。
