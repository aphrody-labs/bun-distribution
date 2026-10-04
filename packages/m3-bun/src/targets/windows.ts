// SPDX-License-Identifier: Apache-2.0
// Windows: build script for the compiled `.exe` (cross-compiled from any OS), and service scripts. A Bun
// executable does not speak the Windows service control protocol, so `sc.exe create` on it fails with error 1053.
// The scripts therefore use WinSW (https://github.com/winsw/winsw, drop `WinSW-x64.exe` next to them) when it is
// there, and a scheduled task that starts at boot as the fallback.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const buildScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Cross-compile ${c.name}.exe (Windows x64) from any OS with Bun installed, then record its SHA-256.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
& ${c.cli} compile --target windows-x64 --outfile (Join-Path $out '${c.name}.exe')
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $out '${c.name}.exe')).Hash.ToLower()
"$hash  ${c.name}.exe" | Set-Content -Encoding ascii (Join-Path $out 'SHA256SUMS')
Write-Host "built $out\\${c.name}.exe ($hash)"
`;

export const installScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Installs ${c.name} as a Windows service through WinSW, or as a boot-time scheduled task when WinSW is absent.
# Run from an elevated PowerShell next to ${c.name}.exe (and WinSW-x64.exe, if you have it). Nothing runs until you do.
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles '${c.name}'),
  [int]$Port = ${c.port},
  [switch]$OpenFirewall
)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'run this script as Administrator' }

$exe = Join-Path $PSScriptRoot '${c.name}.exe'
if (-not (Test-Path $exe)) { throw "missing $exe (run build-windows.ps1)" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $exe $InstallDir -Force

$winsw = Join-Path $PSScriptRoot 'WinSW-x64.exe'
if (Test-Path $winsw) {
  $svc = Join-Path $InstallDir '${c.name}-service.exe'
  Copy-Item $winsw $svc -Force
  (Get-Content (Join-Path $PSScriptRoot '${c.name}-service.xml') -Raw).Replace('__PORT__', "$Port") | Set-Content -Encoding utf8 (Join-Path $InstallDir '${c.name}-service.xml')
  & $svc install
  & $svc start
  Write-Host 'service installed with WinSW'
} else {
  $action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir '${c.name}.exe') -WorkingDirectory $InstallDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName '${c.name}' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  [Environment]::SetEnvironmentVariable('PORT', "$Port", 'Machine')
  Start-ScheduledTask -TaskName '${c.name}'
  Write-Host 'WinSW not found: registered a boot-time scheduled task instead'
}
if ($OpenFirewall) {
  New-NetFirewallRule -DisplayName '${c.name}' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}
`;

export const uninstallScript = (c: TargetContext): string => `# ${GENERATED_NOTE}
[CmdletBinding()]
param([string]$InstallDir = (Join-Path $env:ProgramFiles '${c.name}'))
$ErrorActionPreference = 'Stop'
$svc = Join-Path $InstallDir '${c.name}-service.exe'
if (Test-Path $svc) { & $svc stop; & $svc uninstall }
if (Get-ScheduledTask -TaskName '${c.name}' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '${c.name}' -Confirm:$false }
Get-NetFirewallRule -DisplayName '${c.name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'removed; ${c.name}.exe and its folder are left in place'
`;

export const winswXml = (c: TargetContext): string => `<?xml version="1.0" encoding="utf-8"?>
<!-- ${GENERATED_NOTE} -->
<service>
  <id>${c.name}</id>
  <name>${c.windows?.title ?? c.name}</name>
  <description>${c.windows?.description ?? `${c.name}: M3 app, UI and API from one executable`}</description>
  <executable>%BASE%\\${c.name}.exe</executable>
  <env name="PORT" value="__PORT__" />
  <env name="HOST" value="0.0.0.0" />
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="30 sec" />
  <startmode>Automatic</startmode>
</service>
`;

export const windows: Target = {
  id: "windows",
  title: "Windows",
  description: "build-windows.ps1 (compiled .exe), install and uninstall scripts (WinSW service or boot-time scheduled task), WinSW XML",
  generate(c): GeneratedFile[] {
    return [
      { path: "build-windows.ps1", content: buildScript(c) },
      { path: "install-service.ps1", content: installScript(c) },
      { path: "uninstall-service.ps1", content: uninstallScript(c) },
      { path: `${c.name}-service.xml`, content: winswXml(c) },
    ];
  },
};
