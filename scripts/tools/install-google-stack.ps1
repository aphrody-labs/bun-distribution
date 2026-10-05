#Requires -Version 7.4
#Requires -PSEdition Core
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$HomeDirectory = $(if ($env:APHRODY_HOME) { $env:APHRODY_HOME } else { Join-Path $HOME '.aphrody' }),
    [string]$Target,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AphrodyRoot = (Resolve-Path -LiteralPath $AphrodyRoot).Path
$HomeDirectory = [IO.Path]::GetFullPath($HomeDirectory)
$cargoManifest = Join-Path $AphrodyRoot 'crates/google/google/Cargo.toml'
$cargoWrapper = Join-Path $AphrodyRoot 'scripts/build/rust/cargo-serial.ps1'
if (-not (Test-Path -LiteralPath $cargoManifest -PathType Leaf)) {
    throw "Google Rust owner manifest is missing: $cargoManifest"
}
if (-not (Test-Path -LiteralPath $cargoWrapper -PathType Leaf)) {
    throw "Serialized Cargo wrapper is missing: $cargoWrapper"
}

$metadataOutput = & cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $AphrodyRoot 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'cargo metadata failed for the monorepo workspace' }
$metadata = ($metadataOutput -join "`n") | ConvertFrom-Json
$package = $metadata.packages | Where-Object { $_.name -eq 'aphrody-google' } | Select-Object -First 1
if (-not $package -or -not ($package.targets | Where-Object { $_.name -eq 'aphrody-google' -and $_.kind -contains 'bin' })) {
    throw 'Cargo workspace does not expose the aphrody-google binary from crates/google/google.'
}

$artifact = $null
if (-not $SkipBuild) {
    $buildArgs = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $cargoWrapper,
        'build', '--release', '--locked', '-p', 'aphrody-google',
        '--message-format=json-render-diagnostics'
    )
    if ($Target) { $buildArgs += @('--target', $Target) }

    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $buildOutput = & $pwsh @buildArgs 2>&1
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) {
        $details = $buildOutput | ForEach-Object { [string]$_ }
        throw "Serialized Cargo build failed (exit $buildExitCode).`n$($details -join "`n")"
    }

    foreach ($line in $buildOutput) {
        try { $event = ([string]$line) | ConvertFrom-Json -ErrorAction Stop }
        catch { continue }
        if ($event.reason -eq 'compiler-artifact' -and
            $event.target.name -eq 'aphrody-google' -and
            $event.executable) {
            $artifact = $event.executable
        }
    }
} else {
    $targetDirectory = [string]$metadata.target_directory
    $effectiveTarget = $Target
    if (-not $effectiveTarget) { $effectiveTarget = $env:CARGO_BUILD_TARGET }
    if (-not $effectiveTarget) {
        $rustcInfo = & rustc -vV
        if ($LASTEXITCODE -ne 0) { throw 'rustc -vV failed while resolving the existing artifact.' }
        $hostLine = $rustcInfo | Where-Object { $_ -match '^host: ' } | Select-Object -First 1
        if (-not $hostLine) { throw 'rustc did not report its host target; pass -Target.' }
        $effectiveTarget = ($hostLine -replace '^host: ', '').Trim()
    }
    $artifactName = if ($effectiveTarget -match 'windows') { 'aphrody-google.exe' } else { 'aphrody-google' }
    $artifact = Join-Path $targetDirectory (Join-Path $effectiveTarget (Join-Path 'release' $artifactName))
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        $artifact = Join-Path $targetDirectory (Join-Path 'release' $artifactName)
    }
}

if (-not $artifact -or -not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Aphrody Google Rust CLI artifact was not found. Build it with scripts/build/rust/cargo-serial.ps1 or pass the matching -Target."
}
$artifact = (Resolve-Path -LiteralPath $artifact).Path

# This installer owns the native Rust CLI only. Bun and Python providers remain
# in their workspace packages and are verified by verify-google-pipeline.ps1.
$bin = Join-Path $HomeDirectory 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$destination = Join-Path $bin ([IO.Path]::GetFileName($artifact))
$temporary = "$destination.new.$PID"
Copy-Item -LiteralPath $artifact -Destination $temporary -Force
Move-Item -LiteralPath $temporary -Destination $destination -Force

$aliasName = if ([IO.Path]::GetExtension($destination) -eq '.exe') { 'google.exe' } else { 'google' }
Copy-Item -LiteralPath $destination -Destination (Join-Path $bin $aliasName) -Force
$env:APHRODY_HOME = $HomeDirectory
$env:APHRODY_GOOGLE_BIN = $destination
if ($IsWindows) {
    [Environment]::SetEnvironmentVariable('APHRODY_HOME', $HomeDirectory, 'User')
    [Environment]::SetEnvironmentVariable('APHRODY_GOOGLE_BIN', $destination, 'User')
}

Write-Output "APHRODY_GOOGLE_INSTALLED=$destination"
& $destination doctor
if ($LASTEXITCODE -ne 0) { throw 'aphrody-google doctor failed' }
