# SPDX-License-Identifier: Apache-2.0
# Body of the \Aphrody\Container task: wait for the Docker engine (starting Docker Desktop once), then bring the
# `pc` profile up. The image must already be loaded (scripts/release/container-image.ts ship) or buildable.
[CmdletBinding()]
param([string]$Pc = 'local', [Parameter(Mandatory)][string]$Compose)
$ErrorActionPreference = 'Stop'
$env:APHRODY_PC = $Pc
# Per-PC bearer token, generated once under the user's private Aphrody directory and never committed.
$private = Join-Path $HOME '.aphrody/private'
$tokenFile = Join-Path $private 'aphrody_mcp_http_token'
if (-not (Test-Path $tokenFile)) {
    New-Item -ItemType Directory -Force $private | Out-Null
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [IO.File]::WriteAllText($tokenFile, ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant())
    icacls $tokenFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
}
$env:APHRODY_MCP_HTTP_TOKEN = (Get-Content -Raw $tokenFile).Trim()
$deadline = (Get-Date).AddMinutes(10)
$started = $false
while ($true) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
    if (-not $started) {
        $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path $desktop) { Start-Process $desktop -WindowStyle Hidden }
        $started = $true
    }
    if ((Get-Date) -gt $deadline) { throw 'docker engine unavailable after 10 minutes' }
    Start-Sleep -Seconds 5
}
docker compose -f $Compose --profile pc up -d --no-build --remove-orphans pc
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Stay alive while the container runs so the task reports Running; the task restarts if the container stops.
docker wait aphrody-pc | Out-Null
exit 1
