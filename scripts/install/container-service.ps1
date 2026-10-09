# SPDX-License-Identifier: Apache-2.0
# Windows service of the complete Aphrody container (compose profile `pc`) for one PC: the owner PC and Omar's PC
# run this same script. Registers the hidden scheduled task \Aphrody\Container (interactive user, console wrapped in
# conhost --headless so no window appears, at logon; no elevation needed) that starts Docker Desktop when needed and runs `docker compose up -d` on the loopback API.
#   pwsh -File container-service.ps1 [-Pc local|omar] [-Repo <checkout>] [-Remove] [-DryRun]
#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('local', 'omar')][string]$Pc = 'local',
    [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [switch]$Remove,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\tools\infra\AphrodyHiddenTask.psm1') -Force

$name = 'Container'
$path = '\Aphrody\'
if ($Remove) {
    if (-not $DryRun) { Unregister-ScheduledTask -TaskName $name -TaskPath $path -Confirm:$false -ErrorAction SilentlyContinue }
    Write-Output "removed $path$name"
    return
}

$compose = Join-Path $Repo 'tools\config\container\compose.yaml'
if (-not (Test-Path $compose)) { throw "compose file not found: $compose" }
$runner = Join-Path $Repo 'scripts\install\container-service-run.ps1'
$argument = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Pc {1} -Compose "{2}"' -f $runner, $Pc, $compose
if ($DryRun) { Write-Output "plan: register $path$name -> pwsh $argument"; return }

$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$action = New-AphrodyTaskAction -Execute $pwsh -Argument $argument -WorkingDirectory $Repo -Desktop
$triggers = @(New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $name -TaskPath $path -Action $action -Trigger $triggers -Settings $settings `
    -Principal (New-AphrodyTaskPrincipal -Desktop) -Force | Out-Null
Start-ScheduledTask -TaskName $name -TaskPath $path
Write-Output "registered $path$name for pc=$Pc"
