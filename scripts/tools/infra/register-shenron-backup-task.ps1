# SPDX-License-Identifier: Apache-2.0
# Daily Shenron PostgreSQL off-host pull: hidden S4U task (no window), see AphrodyHiddenTask.psm1.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AphrodyHiddenTask.psm1') -Force

$taskName = 'Shenron PostgreSQL off-host backup'
$scriptPath = Join-Path $PSScriptRoot 'pull-shenron-pg-backup.ps1'
$pwshPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$task = @{
    Name = $taskName; TaskPath = '\'; Execute = $pwshPath; Argument = "-NoProfile -NonInteractive -File `"$scriptPath`""
    Trigger = New-ScheduledTaskTrigger -Daily -At '6:00 AM'; ExecutionTimeLimit = (New-TimeSpan -Minutes 30)
    Description = 'Pull Shenron PostgreSQL snapshots from DBFR and verify SHA-256 off-host.'; Start = $true
}
Register-AphrodyHiddenTask @task
Write-Output "Registered and started task: $taskName"
