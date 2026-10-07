# SPDX-License-Identifier: Apache-2.0
$CargoArgs = @($args)
$ErrorActionPreference = 'Stop'
if ($CargoArgs.Count -eq 0) { throw 'usage: cargo-serial.ps1 <cargo arguments...>' }
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$factoryConfig = Join-Path $sourceRoot 'tools/config/build-factory.json'
$cargoCommand = if ($CargoArgs[0] -like '+*') { $CargoArgs[1] } else { $CargoArgs[0] }
$heavyCommands = @('build', 'b', 'check', 'c', 'test', 't', 'clippy', 'rustdoc', 'doc', 'd', 'bench', 'run', 'r', 'install', 'rustc', 'nextest', 'xwin', 'zigbuild')
$helpOnly = ($CargoArgs -contains '--help') -or ($CargoArgs -contains '-h')
if (($heavyCommands -contains $cargoCommand) -and -not $helpOnly -and (Test-Path -LiteralPath $factoryConfig) -and $env:APHRODY_BUILD_HOST -ne 'vps' -and $env:APHRODY_LOCAL_CARGO -ne '1') {
  $factory = Get-Content -Raw -LiteralPath $factoryConfig | ConvertFrom-Json
  if ($factory.enabled -eq $true) {
    throw 'Heavy Cargo execution belongs to the VPS factory. Use yolo ops build-factory run with the pinned revision and owner command. APHRODY_LOCAL_CARGO=1 is only for an explicitly selected scoped diagnostic.'
  }
}
foreach ($arg in $CargoArgs) {
  if ($arg -match '^(--jobs|-j)(=|\d|$)') { throw 'Do not override Cargo job count; set APHRODY_CARGO_JOBS=1..6 instead.' }
}
$jobs = if ($env:APHRODY_CARGO_JOBS) { [int]$env:APHRODY_CARGO_JOBS } else { 6 }
if ($jobs -lt 1 -or $jobs -gt 6) { throw 'APHRODY_CARGO_JOBS must be an integer from 1 through 6.' }
$waitSeconds = 1800
if ($env:APHRODY_CARGO_LOCK_TIMEOUT_SECS) {
  if ($env:APHRODY_CARGO_LOCK_TIMEOUT_SECS -notmatch '^\d+$') { throw 'APHRODY_CARGO_LOCK_TIMEOUT_SECS must be an integer.' }
  $waitSeconds = [int]$env:APHRODY_CARGO_LOCK_TIMEOUT_SECS
}
$savedEnvironment = @{}
foreach ($name in @('CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'CARGO_TERM_COLOR')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$mutex = [Threading.Mutex]::new($false, 'Local\AphrodyCargoBuild')
$locked = $false
try {
  try { $locked = $mutex.WaitOne([TimeSpan]::FromSeconds($waitSeconds)) }
  catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Timed out waiting for the shared Windows Cargo build lock.' }
  $env:CARGO_BUILD_JOBS = [string]$jobs
  $env:CARGO_INCREMENTAL = '0'
  $env:CARGO_TERM_COLOR = 'never'
  & cargo @CargoArgs
  exit $LASTEXITCODE
}
finally {
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
