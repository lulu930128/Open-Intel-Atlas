Option Explicit

Dim shell, fso, scriptDir, trayScript, powerShellPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = fso.BuildPath(scriptDir, "atlas-tray.ps1")
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = Chr(34) & powerShellPath & Chr(34) & " -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34)

shell.Run command, 0, False
