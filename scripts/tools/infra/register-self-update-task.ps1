# SPDX-License-Identifier: Apache-2.0
# Scheduled task "Aphrody self update" (catalog: tools/config/host/catalog.json, scheduledTasks).
# Runs `aphrody self update` every 30 minutes and at logon: compares latest.json of downloads.aphrody.com with the
# installed release, installs the verified release, rolls back when the new binary does not start.
# Hidden S4U task (no window), see AphrodyHiddenTask.psm1.
param([int]$IntervalMinutes = 30, [switch]$Remove)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AphrodyHiddenTask.psm1') -Force
$taskName = 'Aphrody self update'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed task: $taskName"
  return
}
$aphrody = (Get-Command aphrody -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
$task = @{
  Name = $taskName; TaskPath = '\'; Execute = $aphrody; Argument = 'self update'; Trigger = @($repeat, $logon)
  ExecutionTimeLimit = (New-TimeSpan -Minutes 15)
  Description = 'Install the release published in latest.json (aphrody self update, with rollback).'
}
Register-AphrodyHiddenTask @task
Write-Output "Registered task: $taskName (every $IntervalMinutes min and at logon)"
