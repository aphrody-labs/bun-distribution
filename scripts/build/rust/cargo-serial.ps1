# SPDX-License-Identifier: Apache-2.0
$CargoArgs = @($args)
$ErrorActionPreference = 'Stop'
if ($CargoArgs.Count -eq 0) { throw 'usage: cargo-serial.ps1 <cargo arguments...>' }
foreach ($arg in $CargoArgs) {
  if ($arg -match '^(--jobs|-j)(=|\d|$)') { throw 'Do not override Cargo job count; set APHRODY_CARGO_JOBS=1..6 instead.' }
}
$jobs = if ($env:APHRODY_CARGO_JOBS) { [int]$env:APHRODY_CARGO_JOBS } else { 6 }
if ($jobs -lt 1 -or $jobs -gt 6) { throw 'APHRODY_CARGO_JOBS must be an integer from 1 through 6.' }
$mutex = [Threading.Mutex]::new($false, 'Local\AphrodyCargoBuild')
$locked = $false
try {
  try { $locked = $mutex.WaitOne([TimeSpan]::FromSeconds(1800)) }
  catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Timed out waiting for the shared Windows Cargo build lock.' }
  $env:CARGO_BUILD_JOBS = [string]$jobs
  $env:CARGO_INCREMENTAL = '0'
  $env:CARGO_TERM_COLOR = 'never'
  & cargo @CargoArgs
  exit $LASTEXITCODE
}
finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
