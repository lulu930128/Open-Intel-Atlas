# 對外介面與整合契約

## 1. 目標

REST、MCP、OMI 與 Kuro 必須使用同一個 backend capability layer。Transport 可以不同，但 taxonomy、evidence、freshness、coverage、verification 與排序規則不能各自重做。

## 2. REST API

### 2.1 Versioning

- 新 canonical API 使用 `/api/v1`。
- major version 承擔 breaking contract；minor/additive change 透過 response `contract_version` 表達。
- 現有 `/api/events`、`/api/dashboard` 等為 legacy compatibility surface，先標示 deprecation，不在 v1 未驗證前移除。

### 2.2 1.3.0 目前 endpoints

| Method / Path | 用途 | 狀態 |
| --- | --- | --- |
| `GET /api/v1/health` | process、DB/schema、readiness；不把所有 provider 短暫失敗等同 process unhealthy | 已實作 |
| `GET /api/v1/profiles` | backend-owned representation profiles 與 consumer contract version | 已實作 |
| `GET /api/v1/domains` | domain/topic registry 與顯示 metadata | 已實作 |
| `GET /api/v1/freshness` | 全域或 domain-scoped freshness、coverage、gap warnings | 已實作 |
| `GET /api/v1/sources` | source registry、last run、last success/failure、coverage | 已實作 |
| `GET /api/v1/documents[/{id}]` | normalized document list/detail | 已實作 |
| `GET /api/v1/stories[/{id}]` | story list/detail、timeline、evidence、verification | 已實作 |
| `GET /api/v1/events[/{id}]` | 結構化 event list/detail | 已實作 |
| `GET /api/v1/entities[/{id}]` | entity list/profile | 已實作 |
| `GET /api/v1/entities/{id}/events` | entity 關聯 events | 已實作 |
| `GET /api/v1/search` | bounded mixed-result search | 已實作 |
| `GET /api/v1/brief` | 可重現的 compact brief；帶 scope、as-of 與 evidence IDs | 已實作 |
| `GET /api/v1/changes` | durable Story/Event change feed；opaque cursor 綁定 filter scope | 已實作 |
| `GET /api/v1/collector` | collector/scheduler 狀態 | 已實作、local operational surface |
| `POST /api/v1/collect` | bounded source collection control | 已實作、loopback only；不屬 public read surface |

下列項目仍是 target state，不應被 client 當作 1.3.0 已上線 contract：

| Method / Path | 用途 | 狀態 |
| --- | --- | --- |
| `POST /api/v1/admin/jobs` | trusted admin 的 bounded refresh/backfill/reprocess | 未實作 |
| `GET /api/v1/admin/jobs/{id}` | job progress、error、counts、audit | 未實作 |

### 2.3 1.3.0 目前 filters

- 通用 list filter：單一 `domain`、`q`、`from`、`to`、`cursor`、`limit=1..200`。
- Documents：另支援單一 `source`、`document_type`。
- Stories：另支援單一 `status`。
- Events／Brief：另支援單一 `event_type`、ISO 3166-1 alpha-2 `country`、`entity`、`severity`、`lifecycle`、`verification`；Brief 另支援 `presentation=global|east_asia|taiwan_focus|japan_focus`。
- Sources：支援單一 `domain`。
- Changes：支援單一 `domain`、`change_type`、opaque `cursor` 與 `limit`。
- Search：要求至少兩個字元的 `q`，並支援 `limit` 與可選 representation `profile`。
- `verification` 僅接受 `unverified`、`single_source`、`multi_source`、`primary_source_confirmed`、`official_confirmed`、`disputed`、`corrected`、`retracted`。

逗號分隔 multi-value filter，以及 `topic`、`entity_id`、`location_id`、`source_id`、`language` 等統一 filter vocabulary 仍屬 target state。需要時必須先定義 cursor scope 與 compatibility，不可由 client 自行拆成另一套語意。分類值由 `/api/v1/domains` 發布，client 不應內建永久封閉清單。

### 2.4 Response envelope

```json
{
  "contract_version": "1.2",
  "profile": "latest_events_v1",
  "generated_at": "2026-08-23T08:10:00Z",
  "data": [],
  "pagination": {
    "count": 0,
    "next_cursor": null
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
| `atlas.brief` | 取得可供 agent 使用、來源可追溯的 brief；支援獨立的 ISO alpha-2 `country` location filter 與 `presentation` selection preference |
| `atlas.changes` | 讀取可續接、可去重的 Story/Event change feed |
| `atlas.sources.status` | 查詢 source health、last success 與 coverage gap |

### 3.2 Resources

- `atlas://stories/{story_id}`
- `atlas://brief/latest`
- `atlas://sources/status`
- `atlas://domains`

### 3.3 邊界

- `/mcp` transport 只呼叫與 REST 共用的 capability layer，不直接呼叫 store/provider，也不計算可信度。
- 第一版不提供 delete、publish、notify、refresh-all 或任意 URL fetch。
- refresh/backfill 若日後需要，作為 trusted admin capability，和 public tools 分開。
- MCP response 保留 stable IDs、as-of、source links、freshness、coverage、warnings 與 contract version。
- MCP `2026-07-28` 完整驗證走 `server/discover → tools/list → representative tool call/resource read`；legacy 相容面另走 `initialize → tools/list`。本機 endpoint 的 transport 驗證不等於外部 host/connector 已採用。
- 目前 `/mcp` 只接受 loopback，並驗證 localhost Host/Origin；public auth、tunnel 與多使用者不是這個邊界的一部分。

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
  -> Kuro resumes /api/v1/changes with its persisted cursor
  -> Kuro selects relevant update IDs and reads brief/story through REST or MCP
  -> Kuro checks freshness + warnings + last delivered story IDs
  -> Kuro applies local notification/persona policy
  -> user-facing message links back to Atlas Story/source
```

避免讓 Kuro 直接抓 publisher RSS；否則來源限制、去重、correction 與 Atlas UI 會出現不同真相。

## 6. Representation profiles

目前通用 API 與 MCP 共用下列 server-owned、versioned profiles：

- `brief_compact_v1`：Kuro／一般 agent 使用。
- `evidence_pack_v1`：OMI／分析 agent 使用。
- `story_detail_v1`：UI／研究使用。
- `change_feed_v1`：Kuro 背景同步與其他 durable consumers。
- `source_status_v1`、`latest_events_v1`、`search_results_v1`、`domain_registry_v1`：對應 bounded capability 投影。

profile 只控制欄位與大小，不改變 evidence、verification 或權限。profile 名稱不是 authentication。

`presentation` 是 backend capability 的 selection preference，不是新的 event truth。Selector 在 DB `LIMIT` 前先以共享 policy 排除過期、cancelled／superseded 與 retracted／disputed／unverified 候選，再由 capability layer 重做完整 quality gate 與 durable RegionalRelevance 排序；區域證據不足時回傳較少項目與 `coverage_gaps`，不得由 UI 或 MCP 以 global filler 補滿。REST 與 MCP 的 `country=TW|JP` 都是 event location filter，與 presentation 分離；來源所屬國不得填入缺失的 event country。

`representative_media` 是 nullable additive field，可出現在 Document、Story 與 compact Event projection；它包含實際 media-owning `document_id`／`source_id`、attribution、rights class、effective display policy 與 current policy version。Consumer 只有在 `display_policy=remote_embed` 時才可顯示遠端圖片，且 media 不取代 `representative_url` 或 evidence IDs。Backend 會以 persisted media policy 與 current source policy 共同 fail closed，再依 display-aware evidence priority 選圖；Source status 的 `media_policy` 另公開 `display_authorization`、`terms_url`、`reviewed_at` 與 allowed hosts，供稽核 policy 依據。這些欄位是 additive，consumer contract 為 `1.2`。

Change cursor 是 opaque global sequence 加上 filter scope。Consumer 必須以相同 `domain`／`change_type` 續接；換 scope 時從新的 cursor 開始，不能把舊 cursor 當成通用時間戳。

## 7. 相容與採用策略

1. `已完成`：建立 `/api/v1` contract tests、legacy projection mapping、representation profiles 與 durable change feed。
2. `已完成`：建立 read-only MCP transport 並完成 modern/legacy local protocol smoke。
3. `已完成`：正式 Newsroom 與 Full Map 改讀 v1；Full Map 使用 cursor pagination、canonical domain/geo，legacy projection 僅保留作 compatibility path。
4. `待完成`：OMI 採用單一 read-only evidence flow並驗證市場語意 ownership。
5. `待完成`：Kuro 採用 change cursor + compact brief flow並驗證 persona/notification ownership。
6. `待完成`：以 access log/contract version 確認 legacy consumer 歸零後，才討論移除舊 API。

完成整合的證據不是「endpoint 存在」，而是 consumer runtime 實際讀到正確 contract，並在 stale/partial/failure state 下保持 truthful degradation。
