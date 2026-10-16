# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([string]$Destination = "$PWD\aphrody", [switch]$SkipPython)
$ErrorActionPreference = 'Stop'
if (Test-Path $Destination) { throw "Destination already exists: $Destination" }
git clone https://github.com/aphrody-labs/aphrody.git $Destination
if ($LASTEXITCODE -ne 0) { throw 'Aphrody clone failed' }
$bootstrap = Join-Path $Destination 'scripts/dev/bootstrap.ps1'
$bootstrapArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$bootstrap)
if ($SkipPython) { $bootstrapArgs += '-SkipPython' }
$shellExe = (Get-Process -Id $PID).Path
& $shellExe @bootstrapArgs
if ($LASTEXITCODE -ne 0) { throw 'Aphrody bootstrap failed' }
