# Progress

## Status

- Current phase: done
- Last updated: 2026-08-23 Asia/Taipei

## Completed

- 已確認指定 PNG 為 56×56、有效的 `System.Drawing` image。
- 使用者提供的附件在工作區實際路徑為 `manosaba_icon_56x56_under10KB.png`；托盤以實際檔案為準。
- 已確認修改前 8790 無 listener，且 Windows 無名為 `Open Intel Atlas` 的 Scheduled Task。
- 已讀取產品方向、現有 scheduler 啟動腳本與既有未提交範圍。
- 已建立 `atlas-tray.ps1`：single instance、PNG icon、hidden direct Node child、health/menu、bounded restart、external-port fail closed、owner-only stop 與 taskbar/secondary activation recovery。
- 已建立 hidden VBS 入口，並將 Windows logon installer 改為直接啟動 tray owner；支援 `-WhatIf` 與 `-Uninstall`。
- 已正式註冊並啟動 current-user `Open Intel Atlas` Scheduled Task。

## Validation evidence

- `Get-ScheduledTask -TaskName 'Open Intel Atlas'`: task not found。
- `Get-NetTCPConnection -LocalPort 8790 -State Listen`: no listener。
- `npm run verify`: syntax check 30 files；10 tests passed。
- `npm run tray:selftest`: icon、Node、entrypoint、WinForms、TaskbarCreated listener 與 health URL 全部通過。
- Windows PowerShell 5.1 AST parse：3 個 PowerShell scripts 皆 0 errors。
- bounded tray smoke：direct Node PID 56056 由 tray 建立；deadline 後 tray/Node 都結束且 8790 釋放。
- SQLite：`integrity_check=ok`、foreign-key errors 0、running source runs 0、leases 0（安裝前）。
- Scheduled Task：`Running`、current-user `Interactive`／`Limited`、`IgnoreNew`、restart count 3；action 精確指向 `scripts\atlas-tray.ps1`。
- Live lineage：tray PID 46064、Node PID 38888、Node parent PID 46064、8790 listener PID 38888、無 visible console window。
- Live API：`/api/v1/health` ok、version 1.1.0、scheduler enabled；freshness 16/17 enabled sources 成功，technology／finance／hazards full/current，politics 因 GDELT timeout partial/stale。
- duplicate hidden launcher：tray count 1、Node count 1、listener unchanged；log 記錄 `Tray icon re-registered. reason=secondary-launch`。
- `git diff --check`: no whitespace errors；只有既有 LF→CRLF warnings。

## Decisions made

- 由托盤成為 backend lifecycle owner；登入 task 不再直接執行 `run-atlas.ps1`。
- 托盤若遇到外部 8790 listener，只呈現狀態，不停止、不重新啟動該程序。
- backend 直接由 tray 以 Node process 啟動，stdout/stderr 分檔；不再透過會造成 orphan child 的 `cmd.exe` wrapper。

## Known issues / risks

- Windows 可能把新 icon 放在通知區域的 `^` overflow；不修改使用者 taskbar 個人化設定。
- 沒有以重啟 Explorer 做破壞性 live test；TaskbarCreated listener 已載入，secondary activation 的同一條 re-register 路徑已實測。
- GDELT 目前 connect timeout，屬 provider coverage 警告，不影響 tray/backend health。

## Next step

- 進入 Operational UI：直接呈現 domain freshness、source gap 與 evidence lineage。
