# SPDX-License-Identifier: Apache-2.0
# Windows twin of bun-hygiene.sh (same policy: newest stable Bun older than MinAgeDays, report-only hygiene).
# Install: pwsh -File bun-hygiene.ps1 -Register  (user-level Scheduled Task, daily 05:30, no elevation).
param([int]$MinAgeDays = 3, [switch]$Register)
$ErrorActionPreference = 'Continue'
$h = $env:USERPROFILE
if ($Register) {
  New-Item -ItemType Directory -Force "$h\.local\bin" | Out-Null
  Copy-Item $PSCommandPath "$h\.local\bin\aphrody-bun-hygiene.ps1" -Force
  $a = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument "-NoProfile -File `"$h\.local\bin\aphrody-bun-hygiene.ps1`""
  $t = New-ScheduledTaskTrigger -Daily -At 05:30
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName 'AphrodyBunHygiene' -Action $a -Trigger $t -Settings $s -Force | Out-Null
  Write-Output 'registered AphrodyBunHygiene'; return
}
$env:Path = "$h\.bun\bin;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
$logDir = "$env:LOCALAPPDATA\aphrody\log"; New-Item -ItemType Directory -Force $logDir | Out-Null
Start-Transcript -Path "$logDir\bun-hygiene.log" -Append | Out-Null
$cur = (bun --version).Trim(); "start host=$env:COMPUTERNAME bun=$cur"
$rel = Invoke-RestMethod 'https://api.github.com/repos/oven-sh/bun/releases?per_page=10'
$tgt = ($rel | Where-Object { -not $_.prerelease -and -not $_.draft -and ((Get-Date).ToUniversalTime() - [datetime]$_.published_at).TotalDays -gt $MinAgeDays } | Select-Object -First 1).tag_name -replace '^bun-v', ''
if ($tgt -and [version]$tgt -gt [version]$cur) {
  "upgrade $cur -> $tgt"; winget upgrade --id Oven-sh.Bun --exact --version $tgt --silent --accept-package-agreements 2>&1 | Select-Object -Last 2
} else { "version ok cur=$cur eligible=$tgt" }
'global packages'; bun pm ls -g 2>&1
'outdated (global)'; Push-Location "$h\.bun\install\global"; bun outdated 2>&1; Pop-Location
'untrusted lifecycle scripts'; bun pm -g untrusted 2>&1
$cache = (bun pm cache 2>$null | Select-Object -Last 1)
if ($cache -and (Test-Path $cache)) {
  $gb = (Get-ChildItem $cache -Recurse -File -ea 0 | Measure-Object Length -Sum).Sum / 1GB; "cache $cache {0:N1}GB" -f $gb
  if ($gb -gt 5) { Get-ChildItem $cache -Directory | Where-Object LastAccessTime -lt (Get-Date).AddDays(-30) | Remove-Item -Recurse -Force -ea 0; 'pruned entries unused for 30 days' }
}
'lockfile verify skipped (no checkout on Windows; WSL/factory own it)'
Stop-Transcript | Out-Null
