# REST 與 MCP 整合入門

REST 與 MCP 共用 backend capability layer。完整欄位、filter 與規劃邊界見[對外介面契約](../architecture/ExternalInterfaces.md)；下方是最小讀取流程，不是另一份完整 inventory。

## REST 快速檢查

在已啟動的本機 runtime 上：

```powershell
$atlasBase = "http://127.0.0.1:8790"
Invoke-RestMethod "$atlasBase/api/v1/health"
Invoke-RestMethod "$atlasBase/api/v1/profiles"
Invoke-RestMethod "$atlasBase/api/v1/brief?presentation=taiwan_focus&profile=brief_compact_v1"
Invoke-RestMethod "$atlasBase/api/v1/sources?profile=source_status_v1"
```

此基準 consumer contract 為 `1.2`，與 application `1.3.0`、API path `v1`、SQLite schema 是不同版本。

主要資源為 documents、stories、events、entities、search、brief、sources 與 changes。查詢讀 canonical store，不抓 provider。管理用 `POST /api/v1/collect` 可能建立收集工作與消耗上游 quota，不屬此唯讀流程。

## 回應必讀欄位

保留 `contract_version`、profile、pagination、freshness、coverage、warnings 及 evidence identity。HTTP 200 可以與 partial 並存；空 data 不一定代表外界沒有事件。

List 的 `limit` 有界；各 route 的 filters 不完全相同。Search 的 q 至少兩個字元。不要把 UI 顯示名稱當成永久 taxonomy，改讀 `/api/v1/domains`。

## Change feed

`/api/v1/changes` 提供 durable Story／Event 更新。Cursor 為 opaque，續頁帶回同一 domain／change_type；不要解析或跨 scope 重用。

只訂閱之後的變化時，可用 `cursor=now` 取得 head cursor。Consumer 自行保存進度、去重與 delivery log。Atlas 不會因讀取 feed 就發通知，也不會為舊 schema 合成不存在的歷史變更。

## MCP

將支援 HTTP MCP 的本機 client 指向 `http://127.0.0.1:8790/mcp`。設定欄位依 client 而異，不把某個 client 的 JSON 格式當成通用 contract。

此基準提供 `atlas.latest`、`atlas.search`、`atlas.story.get`、`atlas.brief`、`atlas.changes`、`atlas.sources.status`，以及 domains、source status、latest brief 與 story resources。實際可呼叫參數以 runtime discovery／tools list 為準。

Transport 只接受 loopback client 與合格 localhost Host／Origin，沒有 refresh、delete、publish、notify 或任意 URL fetch tool。雲端 ChatGPT 不能直接使用另一台電腦的 localhost；本機 endpoint 成功不等於 connector 已接好。公網部署需要另行設計授權與存取控制。

## Consumer 的責任

OMI 取得事件 evidence，仍自行負責市場語意；Kuro 取得 brief／changes，仍負責人格、通知與 cursor 保存。Consumer 不重算 verification、severity、freshness，不把摘要替代原始證據。

公司專用新聞、總經 Intelligence Layer 與其他工作中的功能，不屬此已提交基準的 API 承諾。請先查[實作狀態](../architecture/CurrentImplementationState.md)。
