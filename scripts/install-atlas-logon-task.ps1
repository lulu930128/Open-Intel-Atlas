[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = "Open Intel Atlas",
    [switch]$Force,
    [switch]$StartNow,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Uninstall) {
    if ($StartNow -or $Force) {
        throw "-Uninstall cannot be combined with -StartNow or -Force."
    }
    if (-not $existing) {
        Write-Output "Scheduled task '$TaskName' is not installed."
        exit 0
    }
    if ($PSCmdlet.ShouldProcess($TaskName, "Unregister Atlas logon task")) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Scheduled task '$TaskName' was removed. A currently running tray is not stopped."
    }
    exit 0
}

$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "atlas-tray.ps1")).Path

if ($existing -and -not $Force) {
    throw "Scheduled task '$TaskName' already exists. Re-run with -Force only if you intend to replace its definition."
}

$arguments = "-NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument $arguments -WorkingDirectory (Split-Path -Parent $runner)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description "Run the Open Intel Atlas tray at user logon; the tray owns the local backend lifecycle."

if ($PSCmdlet.ShouldProcess($TaskName, "Register Atlas tray logon task")) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force:$Force | Out-Null
    if ($StartNow) {
        Start-ScheduledTask -TaskName $TaskName
    }
    Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, Author
}
