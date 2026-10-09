# SPDX-License-Identifier: Apache-2.0
# Body of the \Aphrody\Container task: wait for the Docker engine (starting Docker Desktop once), then bring the
# `pc` profile up. The image must already be loaded (scripts/release/container-image.ts ship) or buildable.
[CmdletBinding()]
param([string]$Pc = 'local', [Parameter(Mandatory)][string]$Compose)
$ErrorActionPreference = 'Stop'
$env:APHRODY_PC = $Pc
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
docker compose -f $Compose --profile pc up -d --no-build --remove-orphans
exit $LASTEXITCODE
