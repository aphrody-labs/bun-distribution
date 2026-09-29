# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
$feature = if ($platform -match 'Windows') { 'windows' } elseif ($platform -match 'Linux') { 'unix' } else {
    throw "uutils/coreutils build is only wired for Windows and Linux, got: $platform"
}
$binaryName = if ($feature -eq 'windows') { 'coreutils.exe' } else { 'coreutils' }
$installRoot = Join-Path $repoRoot 'target/aphrody-uutils/coreutils'
$targetDir = Join-Path $repoRoot 'target/aphrody-uutils/build'

& cargo install --root $installRoot --target-dir $targetDir --locked --force `
    --version 0.12.0 --features $feature coreutils
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$binary = Join-Path $installRoot "bin/$binaryName"
if (-not (Test-Path -LiteralPath $binary)) {
    throw "uutils build completed without the expected multicall binary: $binary"
}

$utilities = & $binary --list
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$required = @('cat', 'cp', 'ls', 'rm', 'sha256sum', 'sort', 'whoami')
foreach ($utility in $required) {
    if ($utilities -notcontains $utility) {
        throw "uutils multicall binary is missing required utility: $utility"
    }
}

if ($Verify) {
    & $binary echo aphrody
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$companions = @(
    @{ Repository = 'uutils-findutils'; Binary = 'find'; VerifyArgs = @('--version') },
    @{ Repository = 'uutils-grep'; Binary = 'grep'; VerifyArgs = @('--version') },
    @{ Repository = 'uutils-sed'; Binary = 'sed'; VerifyArgs = @('--version') },
    @{ Repository = 'uutils-diffutils'; Binary = 'diffutils'; VerifyArgs = @() },
    @{ Repository = 'uutils-tar'; Binary = 'tarapp'; VerifyArgs = @('tar', '--version') }
)

foreach ($companion in $companions) {
    $companionRoot = Join-Path $repoRoot "third_party/$($companion.Repository)"
    $companionManifest = Join-Path $companionRoot 'Cargo.toml'
    if (-not (Test-Path -LiteralPath $companionManifest)) {
        throw "uutils companion source is unavailable: $companionRoot. Run git submodule update --init --recursive"
    }
    # Keep all uutils crates in one sequential Cargo target cache. This lets
    # shared dependencies (clap, uucore, serde, ...) reuse compiled artifacts.
    $env:CARGO_TARGET_DIR = $targetDir
    & cargo build --manifest-path $companionManifest --locked --release
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $companionBinary = Join-Path $env:CARGO_TARGET_DIR "release/$($companion.Binary)$([IO.Path]::GetExtension($binaryName))"
    if (-not (Test-Path -LiteralPath $companionBinary)) {
        throw "uutils companion build completed without expected binary: $companionBinary"
    }
    if ($Verify -and $companion.VerifyArgs.Count -gt 0) {
        & $companionBinary $companion.VerifyArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Output "uutils/$($companion.Repository.Substring(7)) is ready: $companionBinary"
}

Write-Output "uutils/coreutils is ready: $binary ($feature feature set)"
