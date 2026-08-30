# Runtime adoption preflight

## 2026-08-30 19:47–19:55 Asia/Taipei snapshot

- 19:47 的 `Get-NetTCPConnection` 查詢沒有回傳 port `8790` listener；這項單次 OS projection 不能單獨證明 server 已失去 listener。
- Tray PID `56848`：PowerShell，start time `2026-08-30 17:57:29 +08:00`，仍存活。
- Backend PID `50116`：Node，start time `2026-08-30 17:57:31 +08:00`，仍存活。
- `atlas-tray.log` 將 PID `50116` 記為 PID `56848` 啟動且綁定 kill-on-close Job Object 的 backend。
- 對應 stdout 證明它起初曾成功 listen `127.0.0.1:8790`，啟動時為 `19/26` enabled、scheduler true；stderr 只有 Node SQLite experimental warning。
- 19:55 新增的 direct TCP probe 與 `/api/v1/health` 前後兩次皆成功：version `1.3.0`、schema `4`、consumer contract `1.1`。因此 current authoritative state 是舊 runtime 在線，而不是已證實的 listener loss。
- `Open Intel Atlas` 與 `Open Intel Atlas Recovery` Scheduled Task 都沒有安裝。
- Windows 拒絕 Win32_Process command-line/parent 查詢；不以受限查詢結果猜測 process identity。

## Database evidence

正式資料庫仍是 schema migration `1–4`、26 sources。Scheduler 持續以同一 owner 寫入正式 DB；19:45–19:54 可見總統府、行政院、TWSE、NWS、CoinGecko、USGS、Federal Register、arXiv、BBC 等 scheduler runs。

`npm run verify:runtime-preflight` 以直接 TCP／health、tray log lineage、PID existence、database family identity 與 scheduler run delta 共同判斷。19:55 的 10 秒實測中 DB family 沒有變動、沒有新 scheduler run，但因 listener、health 與 owned backend 都仍 active，仍正確回傳 `safe_for_backup=false`。

## Adoption implication

正式 adoption 不能直接建立第二個 runtime，也不能在 active writer 存在時覆寫 DB。取得明確 runtime 授權後，操作必須由 PID `56848` 的既有 tray ownership 精準停止 PID `50116` process tree，等待 direct health 關閉且 DB/WAL/SHM 靜止，再建立可恢復 backup；Scheduled Task 安裝與正式 DB backfill 仍分別需要明確授權。
