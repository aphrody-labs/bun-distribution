$ErrorActionPreference = 'Stop'

$taskName = 'Shenron PostgreSQL off-host backup'
$scriptPath = Join-Path $PSScriptRoot 'pull-shenron-pg-backup.ps1'
$pwshPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $pwshPath -Argument "-NoProfile -NonInteractive -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At '6:00 AM'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Description 'Pull Shenron PostgreSQL snapshots from DBFR and verify SHA-256 off-host.' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Registered and started task: $taskName"
