# 維運、更新與備份

## 誰管理服務

直接 `npm start` 由終端管理；Windows 常駐由 `scripts/atlas-tray.ps1` 管理。使用同一 owner 啟停，避免第二個實例寫入同一 DB。此文件以已提交基準為準，不假定本機未發布的 port fallback 或 recovery 功能已存在。

## 資料位置

| 內容 | 預設位置 |
| --- | --- |
| Canonical DB | `data/db/atlas.sqlite` |
| Tray／backend logs | `data/logs/` |
| 本機設定 | `.env` |
| Schema owner | `src/atlasSchema.js` |

自訂 DB 以實際 `ATLAS_DB_PATH` 為準。Legacy category DB 可能仍存在，但現行 canonical runtime 不以它們作為資料來源；更新不應擅自刪除它們。

## 更新既有 checkout

1. 記錄 commit、Node 版本、設定及實際 DB 路徑。
2. 用正常 owner 停止 writer，建立一致備份。
3. 先看 `git status --short --branch`；有未提交工作時先理解歸屬。
4. 對乾淨、可 fast-forward 的 checkout 執行 `git pull --ff-only`，再執行 `npm ci`。
5. 比較新的 `.env.example`，不要覆蓋私人設定。
6. 正常啟動並核對 health、schema、collector 與代表性資料。

啟動會開啟／遷移 SQLite；source 更新不等於 runtime 已採用。Migration 不會自動重建缺少的歷史資料或完成 consumer 設定。

## 備份與回復

使用 SQLite 一致備份方式，或停止所有 writer 後保存 DB 及仍存在的 WAL／SHM sidecar。不要在 runtime 持續寫入時只複製主 DB，便宣稱備份完整。

同時保存 source commit、設定與備份時間。回復先在另一個 DB 路徑驗證可開啟、schema 與代表性 records，並停用自動收集，避免驗證期間改動正式資料。回復到正式路徑前停止所有 writer，不以覆蓋正式 DB 作為試驗。

目前沒有已驗收的全自動 backup retention／restore 服務；保存期限與容量需自行管理。

## 排錯

| 現象 | 先確認 |
| --- | --- |
| 無法開啟頁面 | 啟動 log、Node 版本、HOST／PORT、現有 listener owner |
| 首頁資料少 | 是否新 DB、auto collect 是否關閉、來源 disabled reason |
| 單一領域過期 | 該領域來源的 last success、backoff 與 coverage |
| Brief 比預期短 | presentation、時間範圍、promotion 與 coverage gaps |
| MCP 連不上 | backend 是否同一實例、loopback／Host／Origin 與 client transport |
| 圖片未顯示 | 媒體政策是否只允許 candidate／link_only |
| 重啟後仍缺歷史 | provider 保留範圍與 bounded catch-up；不保證補回關機期間 |

不要 broad-kill 佔用 port 的程序，不要刪除 DB 解決 stale，也不要提高並行與重試來掩蓋 rate limit。

## 取證與驗收

分開記錄 source／測試、runtime 採用、provider 實際資料、UI／MCP／consumer 行為。HTTP 200 只說明該請求成功，不能代表所有來源完整。

回報附版本或 commit、時間與時區、重現步驟、經遮蔽的 log、filter 與 coverage。不要上傳 `.env`、token、完整 DB 或私人 consumer 狀態。詳見 [Support](../../SUPPORT.md)。
