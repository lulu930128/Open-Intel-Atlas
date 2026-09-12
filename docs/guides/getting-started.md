# 開始使用

## 環境需求

- Node.js 24 以上；儲存使用內建的 `node:sqlite`。
- npm 與 Git。
- Windows 托盤流程另外需要 Windows PowerShell；直接 Node 啟動與托盤管理是不同入口。

先確認既有工具，不需要重複安裝：

```powershell
node --version
npm --version
git --version
```

## 新安裝

```powershell
git clone https://github.com/lulu930128/Open-Intel-Atlas.git
Set-Location Open-Intel-Atlas
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm start
```

預設入口：

| 入口 | 位置 |
| --- | --- |
| Newsroom | `http://127.0.0.1:8790/` |
| 地圖 | `http://127.0.0.1:8790/atlas.html` |
| Health | `http://127.0.0.1:8790/api/v1/health` |
| MCP | `http://127.0.0.1:8790/mcp` |

若修改 `PORT`，所有 consumer 必須使用相同實際值。不要同時從終端與托盤啟動兩份 backend。

## 第一次啟動會做什麼

Runtime 開啟 canonical SQLite、執行 schema 初始化／migration、登記來源，並依設定啟動 scheduler。預設 `ATLAS_AUTO_COLLECT=true`、`ATLAS_COLLECT_ON_START=true`，會對已啟用來源做 bounded acquisition。

新 DB 的資料逐步累積，首頁空白或 partial 不表示可以補造事件。來源被停用時請查看 `disabled_reason`。關機期間能補多少取決於 upstream 是否保留歷史資料。

只想先檢查設定或空資料畫面：

```powershell
$env:ATLAS_AUTO_COLLECT = "false"
npm start
```

這會停用自動 collector；啟動本身仍可能建立／遷移 DB，不是完全唯讀。手動管理操作另有副作用。

## 設定

以根目錄 [.env.example](../../.env.example) 與 [config.js](../../src/config.js) 為準。常用項目：

| 設定 | 預設／用途 |
| --- | --- |
| `HOST` | `127.0.0.1`；本機使用 |
| `PORT` | `8790` |
| `ATLAS_DB_PATH` | `data/db/atlas.sqlite`；相對路徑以 repo root 解讀 |
| `ATLAS_AUTO_COLLECT` | 啟用自動排程 |
| `ATLAS_COLLECT_ON_START` | scheduler 啟用時的啟動收集 |
| `COLLECTOR_CONCURRENCY` | 有界並行數，預設 3 |
| `ATLAS_MEDIA_USAGE_CONTEXT` | 預設 `unreviewed`，不自動准許圖片展示 |
| `SOURCE_<SOURCE_ID>_ENABLED` | 單一來源開關，標點轉底線且使用大寫 |

Provider key／識別資訊只放本機設定。範例中的 `contact@example.com` 不是有效聯絡身分；需要 SEC 等來源時填入符合該來源要求的設定。未通過來源 gate 仍會停用。

## Windows 托盤

在 repo root 執行：

```powershell
wscript.exe .\scripts\start-atlas-tray.vbs
```

Tray 提供開啟頁面、啟停、重啟與狀態檢查，只管理自己建立的程序。登入自啟動屬選用系統變更，先閱讀 [install-atlas-logon-task.ps1](../../scripts/install-atlas-logon-task.ps1) 的參數與行為，再自行決定是否安裝。

資料保存、更新與故障排查見[維運指南](operations.md)。
