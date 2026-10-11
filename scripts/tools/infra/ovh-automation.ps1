# SPDX-License-Identifier: Apache-2.0
# Narrow native scheduler fallback for the demonstrated installed Infra boot gap.
[CmdletBinding()]
param([switch]$Apply,[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$repositoryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$declared=Get-Content -LiteralPath (Join-Path $repositoryRoot 'tools/config/ovh-automation.json') -Raw|ConvertFrom-Json
$entry=@($declared.boot.entries)[0]
if(@($declared.boot.entries).Count -ne 1 -or $entry.name -ne 'Aphrody OVH protected audit' -or $entry.path -ne '\Aphrody\' -or $entry.principal -ne 'user' -or $entry.runLevel -ne 'limited' -or -not $entry.desktop -or -not $entry.periodic){throw 'Unexpected OVH task declaration'}
$deploymentRoot=Join-Path $StateRoot 'automation/ovh'
$program=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$wrapper=Join-Path $deploymentRoot 'ovh-protected.ps1'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments="-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapper`" -Action Audit -StateRoot `"$StateRoot`""
$plan=[ordered]@{name=$entry.name;path=$entry.path;principal=$user;logonType='Interactive';runLevel='Limited';execute=$program;arguments=$arguments;workingDirectory=$deploymentRoot;triggers=@('atLogon','every:360m');executionLimitMinutes=5;scope='One declared read-only OVH task only';apply=[bool]$Apply}
$plan|ConvertTo-Json -Depth 4|Write-Output
if(-not $Apply){return}
New-Item -ItemType Directory -Force -Path (Join-Path $deploymentRoot 'tools/config')|Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ovh-protected.ps1') -Destination $wrapper
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'tools/config/ovh-automation.json') -Destination (Join-Path $deploymentRoot 'tools/config/service-catalog.json')
$action=New-ScheduledTaskAction -Execute $program -Argument $arguments -WorkingDirectory $deploymentRoot
$logon=New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 6)
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $entry.name -TaskPath $entry.path -Action $action -Trigger @($logon,$repeat) -Principal $principal -Settings $settings -Description $entry.description -Force|Out-Null
[xml]$xml=Export-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
$registered=Get-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
# Windows omits XML RunLevel for the default LeastPrivilege; inspect the native principal too.
if($registered.Principal.RunLevel -ne 'Limited' -or $xml.Task.Principals.Principal.RunLevel -eq 'HighestAvailable' -or $xml.Task.Principals.Principal.LogonType -ne 'InteractiveToken' -or $xml.Task.Triggers.TimeTrigger.Repetition.Interval -ne 'PT6H' -or $xml.Task.Actions.Exec.Command -ne $program -or $xml.Task.Settings.ExecutionTimeLimit -ne 'PT5M'){throw 'Registered task differs from the limited interactive plan'}
Start-ScheduledTask -TaskName $entry.name -TaskPath $entry.path
Write-Output 'Registered and started the declared limited interactive read-only OVH audit task.'
