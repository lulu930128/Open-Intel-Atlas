# Open Intel Atlas

Open Intel Atlas 是一個本地優先的公開情報監測基礎版。它會抓取公開資料源，整理成統一的事件格式，提供全屏世界地圖、人類可讀的 dashboard，以及給其他程式或 AI agent 呼叫的 JSON API。

目前版本：`0.6.0`

這不是 World Monitor 的 clone。此專案使用自己的資料模型、API contract、UI 版面、source registry 和本地 SQLite 儲存方式。

## 目前實作狀態

- Node.js 24+ 原生 HTTP server，無前端框架、無第三方 npm dependency。
- 首頁第一屏是全屏世界地圖，事件圓點可點擊並跳到下方對應事件卡片。
- 下方 dashboard 包含時間篩選、日期篩選、分類篩選、dispatch watchlist、事件列表、source registry / health。
- `/api/dispatch` 提供 AI handoff brief、分類統計、watchlist、source 狀態與 normalized event highlights。
- `/api/events` 提供 normalized event records，支援 `range`、`date`、`category`、`limit` 查詢。
- `/api/sources` 提供資料源 metadata、用途、政策備註、docs URL、最新檢查狀態、最後成功/失敗時間。
- 事件資料依分類寫入獨立 SQLite DB；source health 寫入獨立 `sources.sqlite`。
- Runtime DB、logs、`.env` 都已由 `.gitignore` 排除，不會進 repo。

## 資料源

目前接入的公開資料源：

- GDELT DOC API：地緣政治新聞探索。
- BBC World RSS：地緣政治 fallback RSS。
- USGS Earthquake Hazards GeoJSON：地震與基礎設施風險。
- NASA EONET v3：自然事件與災害監測。
- CISA Known Exploited Vulnerabilities JSON：已知遭利用漏洞。
- NVD CVE API：CVSS、CWE、CPE、受影響產品 enrichment。
- CISA Cybersecurity Advisories RSS：資安與基礎設施 advisory。
- CoinGecko Simple Price API：crypto 市場風險代理訊號。
- Frankfurter FX API：外匯參考匯率。
- arXiv API：AI / ML / CL 最新研究更新。

NVD attribution notice:

> This product uses data from the NVD API but is not endorsed or certified by the NVD.

正式商用前，仍需要逐一確認每個 upstream source 的 terms、attribution、cache、rate limit、redistribution 限制。

## 本地啟動

```powershell
npm start
```

開啟：

```text
http://localhost:8787
```

需求：

```text
Node.js >= 24
```

原因是本地分類儲存使用 Node 內建的 `node:sqlite`。

可選環境變數：

```powershell
$env:PORT = "8787"
$env:CACHE_TTL_SECONDS = "300"
$env:NVD_API_KEY = ""
npm start
```

`NVD_API_KEY` 可留空。沒有 key 時，系統只對 NVD 做低量單次查詢，避免超出公開 API 限制。

## API

```text
GET /api/health
GET /api/sources
GET /api/events
GET /api/dispatch
```

`/api/events` 和 `/api/dispatch` 支援：

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
```

## 本地資料庫

Runtime 會建立以下 SQLite 檔案：

```text
data/db/geopolitics.sqlite
data/db/infrastructure.sqlite
data/db/finance.sqlite
data/db/ai.sqlite
data/db/sources.sqlite
```

這些是本機 runtime data，不應提交到 git。它們已被 `.gitignore` 排除。

## Event Contract

每筆 normalized event 大致如下：

```json
{
  "id": "source-stable-id",
  "category": "infrastructure",
  "title": "Human readable title",
  "summary": "Short normalized summary",
  "severity": "high",
  "confidence": 0.9,
  "source": "NVD CVE API",
  "url": "https://nvd.nist.gov/vuln/detail/CVE-2008-4250",
  "observed_at": "2026-05-25T12:00:00.000Z",
  "location": {
    "label": "Cyber infrastructure",
    "lat": 38.9,
    "lon": -77
  },
  "tags": ["cybersecurity", "infrastructure", "nvd", "cve"]
}
```

## 已知限制

- 目前摘要與嚴重程度仍是 heuristic，尚未接 LLM 分析。
- GDELT、NASA EONET、NVD 等公開來源偶爾會 timeout 或 rate limit；API 會以 `degraded: true` 表示 partial coverage。
- 沒有登入、權限管理、部署設定或 production queue。
- 世界地圖定位仍是基於簡化座標與 keyword hints，尚未做完整 geocoding。
- Dispatch 還沒有排程寄送、webhook、MCP server。

## 下一步

- 加入 scheduled dispatch：email、webhook、chat tools。
- 加入 MCP server，讓其他 AI agent 直接查詢最新 brief 與 source-backed context。
- 透過 source registry 繼續接入 GDACS、SEC EDGAR、OpenAlex、Hugging Face Hub。
- 加入可選 LLM-backed analysis，保留目前 no-key public source foundation。
