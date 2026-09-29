# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
# Unified wrapper delegating to cross-platform scripts/forensics/map-google-local.ts
[CmdletBinding()]
param(
    [string]$Target = (Join-Path $env:LOCALAPPDATA 'Google\Google'),
    [string]$OutDir = 'var/data/google-local-map',
    [int]$MaxHashBytes = 1048576
)
$ErrorActionPreference = 'Stop'
$tsScript = Join-Path $PSScriptRoot 'map-google-local.ts'
& bun $tsScript $Target $OutDir $MaxHashBytes
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
