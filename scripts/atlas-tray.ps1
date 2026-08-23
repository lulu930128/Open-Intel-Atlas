[CmdletBinding()]
param(
    [switch]$SelfTest,
    [switch]$NoAutoStart,
    [ValidateRange(0, 300)]
    [int]$SmokeTestSeconds = 0
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("OpenIntelAtlas.TrayNative" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace OpenIntelAtlas
{
    public sealed class TrayNative : NativeWindow, IDisposable
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr hIcon);

        private readonly int taskbarCreatedMessage;
        public event EventHandler TaskbarCreated;

        public int TaskbarCreatedMessage { get { return taskbarCreatedMessage; } }

        public TrayNative()
        {
            taskbarCreatedMessage = RegisterWindowMessage("TaskbarCreated");
            CreateHandle(new CreateParams());
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == taskbarCreatedMessage)
            {
                EventHandler handler = TaskbarCreated;
                if (handler != null) handler(this, EventArgs.Empty);
            }
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            DestroyHandle();
        }
    }
}
"@ -ReferencedAssemblies @("System.Windows.Forms")
}

$script:AppName = "Open Intel Atlas"
$script:ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$script:ServerPath = Join-Path $script:ProjectRoot "src\atlasServer.js"
$script:EnvPath = Join-Path $script:ProjectRoot ".env"
$script:IconPath = Join-Path $script:ProjectRoot "manosaba_icon_56x56_under10KB.png"
$script:LogRoot = Join-Path $script:ProjectRoot "data\logs"
$script:TrayLogPath = Join-Path $script:LogRoot "atlas-tray.log"
$script:MutexName = "Local\OpenIntelAtlasTray"
$script:ActivationEventName = "Local\OpenIntelAtlasTrayActivate"
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:AtlasProcess = $null
$script:ExpectedStop = $false
$script:IsShuttingDown = $false
$script:RestartDueUtc = $null
$script:ConsecutiveExits = 0
$script:LastHealthProbeUtc = [DateTime]::MinValue
$script:LastHealthOk = $false
$script:LastHealthVersion = $null
$script:StartedAtUtc = $null
$script:NotifyIcon = $null
$script:Menu = $null
$script:Timer = $null
$script:TaskbarListener = $null
$script:TrayIcon = $null
$script:Mutex = $null
$script:OwnsMutex = $false
$script:ActivationEvent = $null
$script:AutoStart = -not $NoAutoStart
$script:SmokeDeadlineUtc = if ($SmokeTestSeconds -gt 0) { [DateTime]::UtcNow.AddSeconds($SmokeTestSeconds) } else { $null }

function Get-DotEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Test-Path -LiteralPath $script:EnvPath -PathType Leaf)) {
        return $null
    }

    foreach ($line in [System.IO.File]::ReadAllLines($script:EnvPath, [System.Text.Encoding]::UTF8)) {
        if ($line -notmatch '^\s*([^#=\s]+)\s*=\s*(.*)$') {
            continue
        }
        if ($matches[1] -ne $Name) {
            continue
        }

        $value = $matches[2].Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        return $value
    }

    return $null
}

$configuredPort = Get-DotEnvValue -Name "PORT"
$portValue = 8790
$parsedPort = 0
if ($null -ne $configuredPort -and [int]::TryParse($configuredPort, [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) {
    $portValue = $parsedPort
}
$script:Port = $portValue
$script:BaseUrl = "http://127.0.0.1:$($script:Port)"
$script:HealthUrl = "$($script:BaseUrl)/api/v1/health"

function Ensure-LogDirectory {
    if (-not (Test-Path -LiteralPath $script:LogRoot -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $script:LogRoot -Force)
    }
}

function Write-TrayLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR")][string]$Level = "INFO"
    )

    try {
        Ensure-LogDirectory
        $line = "{0} [{1}] {2}{3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Level, $Message, [Environment]::NewLine
        [System.IO.File]::AppendAllText($script:TrayLogPath, $line, $script:Utf8)
    }
    catch {
        # Logging must never terminate the tray lifecycle.
    }
}

function New-AtlasTrayIcon {
    if (-not (Test-Path -LiteralPath $script:IconPath -PathType Leaf)) {
        throw "Tray icon was not found: $($script:IconPath)"
    }

    $image = [System.Drawing.Image]::FromFile($script:IconPath)
    $bitmap = $null
    $handle = [IntPtr]::Zero
    try {
        $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $image
        $handle = $bitmap.GetHicon()
        return ([System.Drawing.Icon]::FromHandle($handle)).Clone()
    }
    finally {
        if ($handle -ne [IntPtr]::Zero) {
            [void][OpenIntelAtlas.TrayNative]::DestroyIcon($handle)
        }
        if ($null -ne $bitmap) {
            $bitmap.Dispose()
        }
        $image.Dispose()
    }
}

function Get-NodeExecutable {
    $command = Get-Command node.exe -ErrorAction Stop
    return $command.Source
}

function Test-OwnedAtlasRunning {
    if ($null -eq $script:AtlasProcess) {
        return $false
    }
    try {
        return -not $script:AtlasProcess.HasExited
    }
    catch {
        return $false
    }
}

function Test-AtlasTcpListener {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.BeginConnect("127.0.0.1", $script:Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(400)) {
            return $false
        }
        $client.EndConnect($connect)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Get-AtlasHealth {
    try {
        $health = Invoke-RestMethod -Uri $script:HealthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($null -ne $health -and $health.ok -eq $true) {
            return [pscustomobject]@{
                Ok = $true
                Version = [string]$health.version
                Error = $null
            }
        }
        return [pscustomobject]@{ Ok = $false; Version = $null; Error = "Health response did not report ok=true." }
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Version = $null; Error = $_.Exception.Message }
    }
}

function Set-TrayStatus {
    param([Parameter(Mandatory = $true)][string]$Text)

    if ($null -ne $script:StatusItem) {
        $script:StatusItem.Text = "狀態：$Text"
    }
    if ($null -ne $script:NotifyIcon) {
        $tooltip = "$($script:AppName)：$Text"
        if ($tooltip.Length -gt 63) {
            $tooltip = $tooltip.Substring(0, 63)
        }
        $script:NotifyIcon.Text = $tooltip
    }
}

function Show-TrayMessage {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info,
        [int]$DurationMilliseconds = 4000
    )

    if ($null -eq $script:NotifyIcon -or $script:IsShuttingDown) {
        return
    }
    try {
        $script:NotifyIcon.ShowBalloonTip($DurationMilliseconds, $script:AppName, $Message, $Icon)
    }
    catch {
        Write-TrayLog "Notification failed. error=$($_.Exception.Message)" "WARN"
    }
}

function Update-MenuOwnership {
    $owned = Test-OwnedAtlasRunning
    if ($null -ne $script:StopItem) {
        $script:StopItem.Enabled = $owned
    }
    if ($null -ne $script:RestartItem) {
        $script:RestartItem.Enabled = $owned -or -not (Test-AtlasTcpListener)
    }
    if ($null -ne $script:StartItem) {
        $script:StartItem.Enabled = -not $owned -and -not (Test-AtlasTcpListener)
    }
}

function Start-AtlasServer {
    param([string]$Reason = "tray")

    if (Test-OwnedAtlasRunning) {
        Set-TrayStatus "執行中（托盤管理）"
        return $true
    }

    if (Test-AtlasTcpListener) {
        $health = Get-AtlasHealth
        $text = if ($health.Ok) { "外部執行中（v$($health.Version)）" } else { "Port $($script:Port) 已被外部程序使用" }
        Set-TrayStatus $text
        Write-TrayLog "Refusing duplicate backend start; port is already in use. port=$($script:Port) healthy=$($health.Ok)" "WARN"
        Show-TrayMessage "Port $($script:Port) 已由其他程序使用；托盤不會接管或停止它。" ([System.Windows.Forms.ToolTipIcon]::Warning) 6000
        Update-MenuOwnership
        return $false
    }

    if (-not (Test-Path -LiteralPath $script:ServerPath -PathType Leaf)) {
        Set-TrayStatus "找不到後端 entrypoint"
        Write-TrayLog "Backend entrypoint missing. path=$($script:ServerPath)" "ERROR"
        return $false
    }

    $node = Get-NodeExecutable
    Ensure-LogDirectory
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $serverLog = Join-Path $script:LogRoot "atlas-server-$stamp.stdout.log"
    $serverErrorLog = Join-Path $script:LogRoot "atlas-server-$stamp.stderr.log"
    $nodeArguments = @(
        "`"--env-file-if-exists=$($script:EnvPath)`"",
        "`"$($script:ServerPath)`""
    )

    try {
        $process = Start-Process `
            -FilePath $node `
            -ArgumentList $nodeArguments `
            -WorkingDirectory $script:ProjectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $serverLog `
            -RedirectStandardError $serverErrorLog `
            -PassThru
        $script:AtlasProcess = $process
        $script:ExpectedStop = $false
        $script:RestartDueUtc = $null
        $script:StartedAtUtc = [DateTime]::UtcNow
        $script:LastHealthProbeUtc = [DateTime]::MinValue
        Write-TrayLog "Backend process started. owner_pid=$($process.Id) reason=$Reason stdout=$serverLog stderr=$serverErrorLog"
        Set-TrayStatus "啟動中（PID $($process.Id)）"
        Update-MenuOwnership
        return $true
    }
    catch {
        $script:AtlasProcess = $null
        Write-TrayLog "Backend start failed. error=$($_.Exception.Message)" "ERROR"
        Set-TrayStatus "啟動失敗"
        Show-TrayMessage "Atlas 後端無法啟動，請查看 log。" ([System.Windows.Forms.ToolTipIcon]::Error) 6000
        return $false
    }
}

function Complete-AtlasProcess {
    if ($null -eq $script:AtlasProcess) {
        return
    }
    try {
        if (-not $script:AtlasProcess.HasExited) {
            return
        }
    }
    catch {
        return
    }

    $exitCode = $null
    try {
        $exitCode = $script:AtlasProcess.ExitCode
    }
    catch {
        Write-TrayLog "Could not read backend exit code. error=$($_.Exception.Message)" "WARN"
    }

    $wasExpected = $script:ExpectedStop
    $ownerPid = $script:AtlasProcess.Id
    $script:AtlasProcess.Dispose()
    $script:AtlasProcess = $null
    $script:ExpectedStop = $false
    $script:LastHealthOk = $false
    Write-TrayLog "Backend process exited. owner_pid=$ownerPid exit_code=$exitCode expected=$wasExpected"

    if ($wasExpected -or $script:IsShuttingDown -or -not $script:AutoStart) {
        Set-TrayStatus "已停止"
        Update-MenuOwnership
        return
    }

    $script:ConsecutiveExits++
    $backoffSeconds = [Math]::Min(60, 5 * [Math]::Pow(2, [Math]::Min(4, $script:ConsecutiveExits - 1)))
    $script:RestartDueUtc = [DateTime]::UtcNow.AddSeconds($backoffSeconds)
    Set-TrayStatus "異常停止，$([int]$backoffSeconds) 秒後重試"
    Write-TrayLog "Backend restart scheduled. failures=$($script:ConsecutiveExits) backoff_seconds=$backoffSeconds" "WARN"
    Update-MenuOwnership
}

function Stop-AtlasServer {
    param([string]$Reason = "tray-menu")

    if (-not (Test-OwnedAtlasRunning)) {
        Complete-AtlasProcess
        if (Test-AtlasTcpListener) {
            Set-TrayStatus "外部執行中（不由托盤停止）"
            Show-TrayMessage "目前的 Atlas 後端不是由此托盤啟動，因此不會停止它。" ([System.Windows.Forms.ToolTipIcon]::Warning) 6000
        }
        else {
            Set-TrayStatus "已停止"
        }
        Update-MenuOwnership
        return
    }

    $script:ExpectedStop = $true
    $script:RestartDueUtc = $null
    $ownerPid = $script:AtlasProcess.Id
    Write-TrayLog "Stopping owned backend process tree. owner_pid=$ownerPid reason=$Reason"
    $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"

    try {
        [void](Start-Process -FilePath $taskkill -ArgumentList @("/PID", "$ownerPid", "/T", "/F") -Wait -PassThru -WindowStyle Hidden)
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $ownerStillExists = $null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
            if (-not $ownerStillExists) { break }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($ownerStillExists) {
            throw "Owned process $ownerPid still exists after bounded stop attempts."
        }
    }
    catch {
        Write-TrayLog "Owned backend stop failed. owner_pid=$ownerPid error=$($_.Exception.Message)" "ERROR"
        Show-TrayMessage "無法停止托盤管理的 Atlas 後端，請查看 log。" ([System.Windows.Forms.ToolTipIcon]::Error) 6000
        return
    }

    try { $script:AtlasProcess.Dispose() } catch {}
    $script:AtlasProcess = $null
    $script:ExpectedStop = $false
    $script:LastHealthOk = $false
    Write-TrayLog "Owned backend process tree stopped. owner_pid=$ownerPid reason=$Reason"
    Set-TrayStatus "已停止"
    Update-MenuOwnership
}

function Restart-AtlasServer {
    if (Test-OwnedAtlasRunning) {
        Stop-AtlasServer -Reason "restart"
    }
    elseif (Test-AtlasTcpListener) {
        Show-TrayMessage "Port $($script:Port) 由外部程序使用；托盤不會重啟它。" ([System.Windows.Forms.ToolTipIcon]::Warning) 6000
        return
    }
    $script:ConsecutiveExits = 0
    [void](Start-AtlasServer -Reason "restart")
}

function Refresh-AtlasStatus {
    $script:LastHealthProbeUtc = [DateTime]::UtcNow
    $health = Get-AtlasHealth
    $script:LastHealthOk = $health.Ok
    $script:LastHealthVersion = $health.Version

    if ($health.Ok) {
        if (Test-OwnedAtlasRunning) {
            Set-TrayStatus "正常（v$($health.Version)）"
            if ($null -ne $script:StartedAtUtc -and ([DateTime]::UtcNow - $script:StartedAtUtc).TotalSeconds -ge 10) {
                $script:ConsecutiveExits = 0
            }
        }
        else {
            Set-TrayStatus "外部執行中（v$($health.Version)）"
        }
    }
    elseif (Test-OwnedAtlasRunning) {
        $ageSeconds = if ($null -ne $script:StartedAtUtc) { ([DateTime]::UtcNow - $script:StartedAtUtc).TotalSeconds } else { 999 }
        if ($ageSeconds -lt 15) {
            Set-TrayStatus "啟動中"
        }
        else {
            Set-TrayStatus "程序執行中，API 尚未就緒"
        }
    }
    elseif (Test-AtlasTcpListener) {
        Set-TrayStatus "Port $($script:Port) 被占用，health 失敗"
    }
    else {
        Set-TrayStatus "已停止"
    }
    Update-MenuOwnership
    return $health
}

function Open-AtlasDashboard {
    try {
        Start-Process -FilePath $script:BaseUrl | Out-Null
    }
    catch {
        Write-TrayLog "Could not open dashboard. url=$($script:BaseUrl) error=$($_.Exception.Message)" "ERROR"
        Show-TrayMessage "無法開啟 Atlas 介面。" ([System.Windows.Forms.ToolTipIcon]::Error)
    }
}

function Open-AtlasLogFolder {
    try {
        Ensure-LogDirectory
        Start-Process -FilePath "explorer.exe" -ArgumentList "`"$($script:LogRoot)`"" | Out-Null
    }
    catch {
        Write-TrayLog "Could not open log folder. error=$($_.Exception.Message)" "ERROR"
    }
}

function Restore-TrayIcon {
    param([Parameter(Mandatory = $true)][string]$Reason)

    if ($script:IsShuttingDown -or $null -eq $script:NotifyIcon) {
        return
    }
    try {
        $script:NotifyIcon.Visible = $false
        $script:NotifyIcon.Icon = $script:TrayIcon
        $script:NotifyIcon.Visible = $true
        Write-TrayLog "Tray icon re-registered. reason=$Reason"
    }
    catch {
        Write-TrayLog "Tray icon re-registration failed. reason=$Reason error=$($_.Exception.Message)" "ERROR"
    }
}

if ($SelfTest) {
    $icon = $null
    $iconLoaded = $false
    try {
        $icon = New-AtlasTrayIcon
        $iconLoaded = $null -ne $icon
    }
    finally {
        if ($null -ne $icon) { $icon.Dispose() }
    }

    $checks = [ordered]@{
        project_root = $script:ProjectRoot
        server_exists = Test-Path -LiteralPath $script:ServerPath -PathType Leaf
        icon_path = $script:IconPath
        icon_loaded = $iconLoaded
        node_path = Get-NodeExecutable
        windows_forms_loaded = $null -ne ("System.Windows.Forms.NotifyIcon" -as [type])
        taskbar_listener_loaded = $null -ne ("OpenIntelAtlas.TrayNative" -as [type])
        port = $script:Port
        health_url = $script:HealthUrl
    }
    $success = -not ($checks.Values -contains $false)
    [pscustomobject]@{ success = $success; checks = $checks } | ConvertTo-Json -Depth 4
    if (-not $success) { exit 1 }
    exit 0
}

$script:Mutex = New-Object System.Threading.Mutex($false, $script:MutexName)
try {
    $script:OwnsMutex = $script:Mutex.WaitOne(0, $false)
}
catch [System.Threading.AbandonedMutexException] {
    $script:OwnsMutex = $true
}

if (-not $script:OwnsMutex) {
    Write-TrayLog "Secondary tray launcher detected; signaling existing instance."
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            $existingEvent = [System.Threading.EventWaitHandle]::OpenExisting($script:ActivationEventName)
            [void]$existingEvent.Set()
            $existingEvent.Dispose()
            break
        }
        catch {
            Start-Sleep -Milliseconds 200
        }
    }
    $script:Mutex.Dispose()
    exit 0
}

$script:ActivationEvent = New-Object System.Threading.EventWaitHandle(
    $false,
    [System.Threading.EventResetMode]::AutoReset,
    $script:ActivationEventName
)

Write-TrayLog "Tray starting. launcher_pid=$PID project=$($script:ProjectRoot) url=$($script:BaseUrl) icon=$($script:IconPath)"

try {
    $script:TrayIcon = New-AtlasTrayIcon
    $script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:NotifyIcon.Icon = $script:TrayIcon
    $script:NotifyIcon.Text = "$($script:AppName)：準備中"
    $script:NotifyIcon.Visible = $true

    $script:TaskbarListener = New-Object OpenIntelAtlas.TrayNative
    $script:TaskbarListener.add_TaskbarCreated({ Restore-TrayIcon -Reason "taskbar-created" })

    $script:Menu = New-Object System.Windows.Forms.ContextMenu
    $titleItem = New-Object System.Windows.Forms.MenuItem
    $titleItem.Text = $script:AppName
    $titleItem.Enabled = $false

    $script:StatusItem = New-Object System.Windows.Forms.MenuItem
    $script:StatusItem.Text = "狀態：準備中"
    $script:StatusItem.Enabled = $false

    $openItem = New-Object System.Windows.Forms.MenuItem
    $openItem.Text = "開啟 Atlas"
    $openItem.add_Click({ Open-AtlasDashboard })

    $script:StartItem = New-Object System.Windows.Forms.MenuItem
    $script:StartItem.Text = "啟動後端"
    $script:StartItem.add_Click({ [void](Start-AtlasServer -Reason "tray-menu") })

    $script:RestartItem = New-Object System.Windows.Forms.MenuItem
    $script:RestartItem.Text = "重新啟動後端"
    $script:RestartItem.add_Click({ Restart-AtlasServer })

    $script:StopItem = New-Object System.Windows.Forms.MenuItem
    $script:StopItem.Text = "停止後端"
    $script:StopItem.add_Click({ Stop-AtlasServer -Reason "tray-menu" })

    $refreshItem = New-Object System.Windows.Forms.MenuItem
    $refreshItem.Text = "重新檢查狀態"
    $refreshItem.add_Click({
        $health = Refresh-AtlasStatus
        if ($health.Ok) {
            Show-TrayMessage "Atlas API 正常，版本 $($health.Version)。"
        }
        else {
            Show-TrayMessage "Atlas API 尚未就緒。" ([System.Windows.Forms.ToolTipIcon]::Warning)
        }
    })

    $logItem = New-Object System.Windows.Forms.MenuItem
    $logItem.Text = "開啟 log 資料夾"
    $logItem.add_Click({ Open-AtlasLogFolder })

    $exitItem = New-Object System.Windows.Forms.MenuItem
    $exitItem.Text = "結束托盤並停止後端"
    $exitItem.add_Click({
        if ($script:IsShuttingDown) { return }
        $script:IsShuttingDown = $true
        Write-TrayLog "Exit requested from tray menu."
        $script:NotifyIcon.Visible = $false
        Stop-AtlasServer -Reason "tray-exit"
        [System.Windows.Forms.Application]::Exit()
    })

    foreach ($item in @(
        $titleItem,
        $script:StatusItem,
        (New-Object System.Windows.Forms.MenuItem "-"),
        $openItem,
        (New-Object System.Windows.Forms.MenuItem "-"),
        $script:StartItem,
        $script:RestartItem,
        $script:StopItem,
        $refreshItem,
        (New-Object System.Windows.Forms.MenuItem "-"),
        $logItem,
        (New-Object System.Windows.Forms.MenuItem "-"),
        $exitItem
    )) {
        [void]$script:Menu.MenuItems.Add($item)
    }

    $script:NotifyIcon.ContextMenu = $script:Menu
    $script:NotifyIcon.add_DoubleClick({ Open-AtlasDashboard })

    $script:Timer = New-Object System.Windows.Forms.Timer
    $script:Timer.Interval = 1000
    $script:Timer.add_Tick({
        if ($script:IsShuttingDown) {
            return
        }
        if ($null -ne $script:SmokeDeadlineUtc -and [DateTime]::UtcNow -ge $script:SmokeDeadlineUtc) {
            Write-TrayLog "Smoke-test deadline reached; exiting cleanly."
            $script:IsShuttingDown = $true
            $script:Timer.Stop()
            [System.Windows.Forms.Application]::Exit()
            return
        }

        if ($script:ActivationEvent.WaitOne(0)) {
            Restore-TrayIcon -Reason "secondary-launch"
            Show-TrayMessage "Atlas 托盤已在執行。"
        }

        Complete-AtlasProcess
        if ($null -ne $script:RestartDueUtc -and [DateTime]::UtcNow -ge $script:RestartDueUtc -and -not $script:IsShuttingDown) {
            $script:RestartDueUtc = $null
            [void](Start-AtlasServer -Reason "automatic-recovery")
        }

        if (([DateTime]::UtcNow - $script:LastHealthProbeUtc).TotalSeconds -ge 5) {
            [void](Refresh-AtlasStatus)
        }
    })

    Set-TrayStatus "準備中"
    if ($script:AutoStart) {
        [void](Start-AtlasServer -Reason "tray-startup")
    }
    else {
        Set-TrayStatus "待命"
        Update-MenuOwnership
    }

    $script:Timer.Start()
    Write-TrayLog "Tray ready. activation_event=$($script:ActivationEventName) taskbar_message=$($script:TaskbarListener.TaskbarCreatedMessage)"
    if ($SmokeTestSeconds -eq 0) {
        Show-TrayMessage "已常駐系統托盤；雙擊 icon 可開啟 Atlas。"
    }
    [System.Windows.Forms.Application]::Run()
}
finally {
    $script:IsShuttingDown = $true
    if ($null -ne $script:Timer) {
        $script:Timer.Stop()
        $script:Timer.Dispose()
    }
    if (Test-OwnedAtlasRunning) {
        Stop-AtlasServer -Reason "tray-shutdown"
    }
    if ($null -ne $script:NotifyIcon) {
        $script:NotifyIcon.Visible = $false
        $script:NotifyIcon.Dispose()
    }
    if ($null -ne $script:Menu) { $script:Menu.Dispose() }
    if ($null -ne $script:TaskbarListener) { $script:TaskbarListener.Dispose() }
    if ($null -ne $script:TrayIcon) { $script:TrayIcon.Dispose() }
    if ($null -ne $script:ActivationEvent) { $script:ActivationEvent.Dispose() }
    if ($script:OwnsMutex -and $null -ne $script:Mutex) { $script:Mutex.ReleaseMutex() }
    if ($null -ne $script:Mutex) { $script:Mutex.Dispose() }
    Write-TrayLog "Tray stopped."
}
