[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$serverPath = Join-Path $projectRoot "src\atlasServer.js"
$envFile = Join-Path $projectRoot ".env"
$node = Get-Command node.exe -ErrorAction Stop

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Atlas server entrypoint was not found: $serverPath"
}

Set-Location -LiteralPath $projectRoot
& $node.Source "--env-file-if-exists=$envFile" $serverPath
exit $LASTEXITCODE
