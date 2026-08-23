# 對外介面與整合契約

## 1. 目標

REST、MCP、OMI 與 Kuro 必須使用同一個 backend capability layer。Transport 可以不同，但 taxonomy、evidence、freshness、coverage、verification 與排序規則不能各自重做。

## 2. REST API

### 2.1 Versioning

- 新 canonical API 使用 `/api/v1`。
- major version 承擔 breaking contract；minor/additive change 透過 response `contract_version` 表達。
- 現有 `/api/events`、`/api/dashboard` 等為 legacy compatibility surface，先標示 deprecation，不在 v1 未驗證前移除。

### 2.2 初始 endpoints

| Method / Path | 用途 |
| --- | --- |
| `GET /api/v1/health` | process、DB/schema、readiness；不把所有 provider 短暫失敗等同 process unhealthy |
| `GET /api/v1/domains` | domain/topic registry 與顯示 metadata |
| `GET /api/v1/freshness` | 全域或 domain-scoped freshness、coverage、gap warnings |
| `GET /api/v1/sources` | source registry、last run、last success/failure、coverage |
| `GET /api/v1/documents` | 有權限與 bounds 的 normalized documents 查詢 |
| `GET /api/v1/stories` | story list、filters、cursor pagination |
| `GET /api/v1/stories/{id}` | story detail、timeline、evidence、verification |
| `GET /api/v1/events` | 結構化 events 查詢 |
| `GET /api/v1/entities/{id}` | entity profile 與相關 stories/events |
| `GET /api/v1/search` | bounded search；回傳 mixed result types 與 coverage |
| `GET /api/v1/brief` | 可重現的 compact brief；帶 scope、as-of 與 evidence IDs |
| `POST /api/v1/admin/jobs` | trusted admin 的 bounded refresh/backfill/reprocess；不屬 public read surface |
| `GET /api/v1/admin/jobs/{id}` | job progress、error、counts、audit |

### 2.3 Common filters

- `domain=politics,technology`
- `topic=ai`
- `entity_id=...`
- `location_id=...`
- `from=...&to=...`
- `verification=corroborated,official`
- `severity=high,critical`
- `source_id=...`
- `language=zh-Hant,en`
- `limit=1..100&cursor=...`

分類值由 `/api/v1/domains` 發布，client 不應內建永久封閉清單。

### 2.4 Response envelope

```json
{
  "contract_version": "1.0",
  "data": [],
  "meta": {
    "request_id": "req_...",
    "generated_at": "2026-08-23T08:10:00Z",
    "next_cursor": null,
    "filters": {}
  },
  "freshness": {
    "status": "current",
    "as_of": "2026-08-23T08:09:00Z"
  },
  "coverage": {
    "status": "partial",
    "expected_sources": 8,
    "successful_sources": 7
  },
  "warnings": []
}
```

### 2.5 HTTP semantics

- `200`：查詢成功；`coverage=partial` 可和有效資料並存。
- `400`：filter、cursor、range 或 request shape 無效。
- `401/403`：未驗證或無權限；不能只靠 `caller_profile`。
- `404`：stable resource 不存在或已不可見。
- `409`：admin job conflict 或 idempotency conflict。
- `429`：rate/quota limit；提供 bounded retry hint。
- `503`：canonical read service 不可用或沒有任何可用資料面；單一 provider failure 通常不是 503。

錯誤使用 predictable code，不把 secret、raw upstream response 或 stack trace 回傳給 client。

## 3. MCP

### 3.1 第一版 tools

| Tool | 說明 |
| --- | --- |
| `atlas.latest` | 依 domain/topic/time 取得最新 stories 的 compact projection |
| `atlas.search` | bounded search，回傳 story/event/document references |
| `atlas.story.get` | 取得單一 Story 的 timeline、evidence、freshness 與 coverage |
| `atlas.brief` | 取得可供 agent 使用、來源可追溯的 brief |
| `atlas.sources.status` | 查詢 source health、last success 與 coverage gap |

### 3.2 Resources

- `atlas://stories/{story_id}`
- `atlas://briefs/{brief_id}`
- `atlas://sources/status`
- `atlas://domains`

### 3.3 邊界

- MCP adapter 不直接連 SQLite、不呼叫 upstream source、不計算可信度。
- 第一版不提供 delete、publish、notify、refresh-all 或任意 URL fetch。
- refresh/backfill 若日後需要，作為 trusted admin capability，和 public tools 分開。
- MCP response 保留 stable IDs、as-of、source links、freshness、coverage、warnings 與 contract version。
- 完整驗證必須走 `initialize → retain session if transport requires → tools/list → representative tool call/resource read`。

## 4. OMI 整合

### 4.1 Atlas 提供

- 與市場相關的政治、科技、金融、災害 stories/events。
- entity、地區、產業 topic、時間線與 supporting/disputing evidence。
- source independence、verification、freshness、coverage 與 data limits。
- stable IDs，讓 OMI 可保存引用或建立關聯，而不是複製全文。

### 4.2 OMI 保留

- 行情、基本面、籌碼、持倉、交易日與市場 freshness 的 canonical semantics。
- Atlas story 和特定股票／產業／市場之間的影響判斷。
- 投資情境、風險、反證、建議與任何交易行為。

### 4.3 建議呼叫流程

```text
OMI question / scheduled analysis
  -> OMI internal policy chooses external-news scope
  -> Atlas /api/v1/brief or /stories query
  -> OMI validates freshness + coverage + evidence IDs
  -> OMI joins its own market data
  -> OMI produces market-specific answer with Atlas citations
```

若 Atlas 不可用，OMI 應保留自身資料並清楚降級，不把新聞缺口當成「沒有風險」。Atlas 也不應為 OMI 建立第二套市場 DB。

## 5. Kuro 整合

### 5.1 Atlas 提供

- compact brief：標題、兩三句摘要、domain、severity、verification、as-of、來源連結。
- story updates：新增、升級、修正、爭議、解除或 retraction。
- 可供 Kuro 決定是否值得說明的 structured importance；必須能解釋，不是黑箱 persona 文案。

### 5.2 Kuro 保留

- 使用者偏好、安靜時間、通知頻率、去打擾策略。
- 桌寵人格、語氣、情緒、動畫、TTS 與對話上下文。
- 是否主動提醒及如何把消息說成人話。

### 5.3 建議呼叫流程

```text
Kuro timer / user request
  -> Kuro selects compact scope
  -> Atlas /api/v1/brief?domain=... or MCP atlas.brief
  -> Kuro checks freshness + warnings + last delivered story IDs
  -> Kuro applies local notification/persona policy
  -> user-facing message links back to Atlas Story/source
```

避免讓 Kuro 直接抓 publisher RSS；否則來源限制、去重、correction 與 Atlas UI 會出現不同真相。

## 6. Representation profiles

通用 API 足以支援初期整合。若 payload 逐漸過大，可新增 server-owned、versioned profiles：

- `brief_compact_v1`：Kuro／一般 agent 使用。
- `evidence_pack_v1`：OMI／分析 agent 使用。
- `story_detail_v1`：UI／研究使用。

profile 只控制欄位與大小，不改變 evidence、verification 或權限。profile 名稱不是 authentication。

## 7. 相容與採用策略

1. 先建立 `/api/v1` contract tests 與 legacy projection mapping。
2. UI 改讀 v1，但保留 feature flag 或 rollback path。
3. 建立 MCP thin adapter 並完成 local protocol smoke。
4. OMI 先採用單一 read-only evidence flow。
5. Kuro 再採用 compact brief flow。
6. 以 access log/contract version 確認 legacy consumer 歸零後，才討論移除舊 API。

完成整合的證據不是「endpoint 存在」，而是 consumer runtime 實際讀到正確 contract，並在 stale/partial/failure state 下保持 truthful degradation。
