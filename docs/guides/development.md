# 開發指南

先依[安裝指南](getting-started.md)完成 Node 24+ 與 `npm ci`。目前使用原生 Node HTTP server、SQLite 與靜態 HTML／CSS／JavaScript；沒有獨立 frontend build 步驟。

## 責任地圖

| 位置 | 職責 |
| --- | --- |
| `src/config.js`、`atlasSourceRegistry.js` | 設定、來源身分與政策 |
| `src/atlasHttp.js`、`atlasCollector.js` | 有界外部 IO、排程 |
| `src/documents/`、`atlasPipeline.js` | 正規化與 intelligence 流程 |
| `src/atlasStore.js`、`atlasSchema.js` | Canonical 儲存與 schema |
| `src/atlasCapabilities.js`、`atlasApi.js`、`atlasMcp.js` | 共用能力及 transports |
| `public/` | Newsroom、領域頁與地圖 |
| `test/` | Node test runner regression |
| `scripts/` | Syntax check、migration／adoption 驗證與 Windows owner |

## 修改順序

先確認資料 owner、contract、失敗狀態與最近 tests。來源 parsing 留在 adapter；UI／MCP 不接管分類、freshness、圖片權限或 provider IO。Migration 不應在 GET 中暗自修補資料。

保留使用者的 dirty work，不做 broad reset 或整個 repo 格式化。新增 public contract 要同步 consumer compatibility 與相應文件。

## 依風險驗證

| 修改 | 最小起點 |
| --- | --- |
| 文件 | UTF-8 讀回、相對連結、code fence、`git diff --check` |
| JavaScript 局部邏輯 | `npm run check` 與最接近 test file |
| 資料／shared contract | 相關 regression；必要時 `npm test` |
| UI 互動 | 對應 tests 與獨立 runtime／browser 證據 |
| Schema／provider | 隔離資料驗證及有界 acceptance，不直接操作正式 DB |

```powershell
npm run check
node --test --test-isolation=none test/backend-v1.test.js
npm test
```

`npm run verify` 結合 check 與 tests。其他 `probe:*`、`verify:*` 腳本不全是離線操作；先讀程式與參數，確認網路、DB 副本、輸出位置與 runtime 要求。不要為純文件改動啟動來源收集或正式 runtime。

## 文件維護

使用者行為放 guides；穩定責任放 architecture；未來方向放 Roadmap；單次歷史證據不當作當前支援保證。程式、runtime、provider 與 consumer acceptance 分開記錄。

版本更新同步 package／config／變更紀錄。純文件發布不必創造新的 application version 或宣稱重新驗收 production。
