param([string]$At = '09:00', [switch]$Remove, [switch]$Status)
$ErrorActionPreference = 'Stop'
$taskName = 'Shuttlecraft-Daily-Guide'
if ($Status) {
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
  Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
  exit
}
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output 'Daily guide task removed.'
  exit
}
if ($At -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'At must use HH:mm local machine time.' }
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runnerPath = Join-Path $PSScriptRoot 'run-daily.ps1'
$powerShellPath = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runnerPath + '"') -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Generate one sourced English/Vietnamese badminton guide through local 9router; requires this user to be signed in.' -Force | Select-Object TaskName, State
Write-Output "Scheduled at $At local machine time. Keep this account signed in and 9router running."
