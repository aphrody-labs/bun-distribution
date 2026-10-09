# SPDX-License-Identifier: Apache-2.0
# Scheduled task "Aphrody self update" (catalog: tools/config/host/catalog.json, scheduledTasks).
# Runs `aphrody self update` every 30 minutes and at logon: compares latest.json of downloads.aphrody.com with the
# installed release, installs the verified release, rolls back when the new binary does not start.
param([int]$IntervalMinutes = 30, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'Aphrody self update'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed task: $taskName"
  return
}
$aphrody = (Get-Command aphrody -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $aphrody -Argument 'self update'
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Description 'Install the release published in latest.json (aphrody self update, with rollback).' -Action $action -Trigger @($repeat, $logon) -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Registered task: $taskName (every $IntervalMinutes min and at logon)"
