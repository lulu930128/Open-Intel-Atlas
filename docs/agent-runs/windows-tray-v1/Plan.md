# Plan

## Milestones

1. 建立托盤 runtime owner
   - Scope: `scripts\atlas-tray.ps1`、hidden launcher。
   - Acceptance: single instance、指定 PNG icon、bounded restart、health、owner-only stop、Explorer recovery。
   - Validation: PowerShell AST parse、`-SelfTest`、bounded smoke。

2. 對齊 Windows 登入入口
   - Scope: `scripts\install-atlas-logon-task.ps1`。
   - Acceptance: AtLogOn task 直接啟動 tray，支援 `-WhatIf` 與可逆移除。
   - Validation: task definition inspection、實際 StartNow 後 process lineage。

3. 文件與 regression
   - Scope: README、package scripts、Progress。
   - Acceptance: 操作、限制、解除安裝方式可重現。
   - Validation: `npm run verify`、`git diff --check`、health/runtime probes。

## Stop-and-fix rules

- 若 tray self-test、repo test、API health 或 SQLite integrity 失敗，先修正再註冊 Windows task。
- 若 8790 已有不屬於本任務的 listener，不停止它；改以外部 owner 衝突回報。
- 若發現同名 Scheduled Task 已存在但 action 不屬於此 repo，不使用 `-Force` 覆寫。

## Decisions

- 2026-08-23：沿用 current-user interactive `AtLogOn` Scheduled Task，因 NotifyIcon 需要登入 desktop session。
- 2026-08-23：Windows task 只啟動 tray，由 tray 管理 backend；避免 task 與 tray 形成雙 owner。
