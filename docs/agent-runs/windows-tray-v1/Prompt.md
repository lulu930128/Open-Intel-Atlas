# Windows 托盤常駐 v1

## Goal

- 將 Open Intel Atlas 做成登入後常駐的 Windows 系統托盤程式，由托盤唯一管理本機後端的啟動、停止、重新啟動、健康狀態與介面入口。
- Windows 登入工作直接指向托盤 launcher，並使用使用者提供、工作區實際保存為 `manosaba_icon_56x56_under10KB.png` 的 56×56 PNG 作為托盤 icon。

## Non-goals

- 本次不改新聞資料模型、來源 adapter、freshness contract 或前端設計。
- 不建立 Windows Service；托盤需要互動式登入 session，因此採目前使用者的 `AtLogOn` Scheduled Task。
- 不停止或接管不屬於托盤的既有 Node/process。

## Hard constraints

- Repo 現有未提交修改均視為使用者工作，不得回復或覆寫。
- 托盤只停止自己建立的 process tree；若 8790 已由外部程序使用，必須 fail closed。
- 所有啟動視窗保持隱藏，runtime log 保存在已被 gitignore 的本機資料目錄。
- 重複啟動不得建立多個托盤 instance；Explorer/taskbar 重啟後必須能重新註冊 icon。

## Context

- Repo: `C:\project\Open Intel Atlas`
- Backend entrypoint: `src\atlasServer.js`
- Default local URL: `http://127.0.0.1:8790`
- Current known state: schema v2 scheduler 已保存於 SQLite；修改前無 8790 listener，且 Windows 無名為 `Open Intel Atlas` 的 Scheduled Task。

## Deliverables

- PowerShell NotifyIcon 托盤 launcher、隱藏 VBS 入口與可逆的登入工作安裝腳本。
- 托盤 self-test、runtime smoke、後端 health 與 Windows Scheduled Task 實際採用證據。
- README 與任務進度紀錄。

## Done criteria

- PowerShell AST parse 與托盤 self-test 通過。
- Repo regression 通過。
- 托盤可隱藏啟動後端，`/api/v1/health` 成功，8790 listener owner 可追溯到托盤 process tree。
- Scheduled Task action 精確指向此 repo 的 `scripts\atlas-tray.ps1`，使用 interactive current-user logon。
- 重複啟動不產生第二個 tray/backend instance；停止行為不會 broad-kill 外部程序。

## Open questions / assumptions

- 將「讓 Windows 直接指向他」解讀為：Windows 登入工作直接啟動托盤 owner，而不是另外啟動裸後端。
