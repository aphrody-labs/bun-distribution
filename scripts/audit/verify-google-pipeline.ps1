#Requires -Version 7.4
#Requires -PSEdition Core
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$PythonRoot = (Join-Path $PSScriptRoot '..\..\py'),
    [switch]$StaticOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$AphrodyRoot = (Resolve-Path -LiteralPath $AphrodyRoot).Path
$PythonRoot = (Resolve-Path -LiteralPath $PythonRoot).Path

function Require-File {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Owner file missing: $Path" }
}

function Invoke-OwnerCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )
    Write-Output "==> $Name"
    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) { throw "$Name failed (exit $exitCode)." }
    } finally {
        Pop-Location
    }
}

$cargoManifest = Join-Path $AphrodyRoot 'crates/google/google/Cargo.toml'
$rustMain = Join-Path $AphrodyRoot 'crates/google/google/src/cli.rs'
$bunManifestPath = Join-Path $AphrodyRoot 'packages/google/google/package.json'
$bunEntrypoint = Join-Path $AphrodyRoot 'packages/google/google/src/cli.ts'
$docAiManifestPath = Join-Path $AphrodyRoot 'packages/ai/doc-ai/package.json'
$docAiEntrypoint = Join-Path $AphrodyRoot 'packages/ai/doc-ai/src/llm.ts'
$pythonManifest = Join-Path $PythonRoot 'packages/ai/py/aphrody/pyproject.toml'
$pythonWorkspaceManifest = Join-Path $PythonRoot 'pyproject.toml'
$pythonFacade = Join-Path $PythonRoot 'packages/ai/py/aphrody/aphrody/google.py'
$cargoWrapper = Join-Path $AphrodyRoot 'scripts/build/rust/cargo-serial.ps1'
$pythonLock = Join-Path $PythonRoot 'uv.lock'
$toolchainManifest = Join-Path $AphrodyRoot 'config/system-packages.json'

foreach ($path in @(
    (Join-Path $AphrodyRoot 'Cargo.toml'), $cargoManifest, $rustMain,
    $bunManifestPath, $bunEntrypoint, $docAiManifestPath, $docAiEntrypoint,
    $cargoWrapper, $pythonManifest, $pythonWorkspaceManifest, $pythonFacade, $pythonLock, $toolchainManifest
)) { Require-File $path }

$cargoMetadataOutput = & cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $AphrodyRoot 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'cargo metadata failed for the monorepo workspace.' }
$cargoMetadata = ($cargoMetadataOutput -join "`n") | ConvertFrom-Json
$rustPackage = $cargoMetadata.packages | Where-Object {
    $_.name -eq 'aphrody-google'
} | Select-Object -First 1
# aphrody-google is a library entry (cli_main) of the single multi-call `aphrody` binary.
$aphrodyPackage = $cargoMetadata.packages | Where-Object { $_.name -eq 'aphrody' } | Select-Object -First 1
if (-not $rustPackage -or -not ($rustPackage.targets | Where-Object {
    $_.kind -contains 'lib'
})) { throw 'Current Cargo metadata does not expose the aphrody-google library.' }
if (-not $aphrodyPackage -or -not ($aphrodyPackage.targets | Where-Object {
    $_.name -eq 'aphrody' -and $_.kind -contains 'bin'
})) { throw 'Current Cargo metadata does not expose the aphrody multi-call binary.' }
if ([IO.Path]::GetFullPath($rustPackage.manifest_path) -ne [IO.Path]::GetFullPath($cargoManifest)) {
    throw "Cargo package aphrody-google is not owned by $cargoManifest."
}

$bunManifest = Get-Content -LiteralPath $bunManifestPath -Raw | ConvertFrom-Json
if ($bunManifest.name -ne '@aphrody/google') { throw "Unexpected Bun package owner: $($bunManifest.name)" }
foreach ($scriptName in @('test', 'build', 'verify')) {
    if (-not $bunManifest.scripts.PSObject.Properties.Name.Contains($scriptName)) {
        throw "@aphrody/google has no '$scriptName' script."
    }
}

$docAiManifest = Get-Content -LiteralPath $docAiManifestPath -Raw | ConvertFrom-Json
if ($docAiManifest.name -ne '@aphrody/doc-ai') { throw "Unexpected doc-ai owner: $($docAiManifest.name)" }
foreach ($scriptName in @('test', 'typecheck')) {
    if (-not $docAiManifest.scripts.PSObject.Properties.Name.Contains($scriptName)) {
        throw "@aphrody/doc-ai has no '$scriptName' script."
    }
}

$pythonText = Get-Content -LiteralPath $pythonManifest -Raw
if ($pythonText -notmatch '(?m)^name\s*=\s*["'']aphrody["'']\s*$') {
    throw "Python package manifest does not declare project 'aphrody': $pythonManifest"
}
if ($pythonText -notmatch '(?ms)^\[project\.scripts\]\s*.*?^aphrody-google\s*=\s*["'']aphrody\.google_cli:main["'']') {
    throw "Python package does not expose the aphrody-google entry point: $pythonManifest"
}
$pythonWorkspaceText = Get-Content -LiteralPath $pythonWorkspaceManifest -Raw
$pythonUvMatch = [regex]::Match($pythonWorkspaceText, '(?m)^required-version\s*=\s*["'']==([^"'']+)["'']\s*$')
if (-not $pythonUvMatch.Success) { throw "Python workspace does not pin uv in $PythonRoot/pyproject.toml." }
$pythonUvVersion = $pythonUvMatch.Groups[1].Value
$toolchainManifestValue = Get-Content -LiteralPath $toolchainManifest -Raw | ConvertFrom-Json
$monorepoUvVersion = [string]$toolchainManifestValue.toolchains.uv.version
if ($pythonUvVersion -ne $monorepoUvVersion) {
    throw "uv pin mismatch: monorepo config/system-packages.json requires $monorepoUvVersion, but py/ requires $pythonUvVersion. Align the workspace manifests before running the Python gate."
}

# These source checks reject literal key assignments without reading local env
# files or printing match contents.
$scanRoots = @(
    (Join-Path $AphrodyRoot 'packages/google/google'),
    (Join-Path $AphrodyRoot 'packages/ai/doc-ai'),
    (Join-Path $PythonRoot 'packages/ai/py/aphrody/aphrody')
)
foreach ($scanRoot in $scanRoots) {
    foreach ($needle in @('GEMINI_API_KEY=', 'GOOGLE_API_KEY=')) {
        $null = & rg --fixed-strings --quiet --glob '*.ts' --glob '*.py' $needle $scanRoot 2>$null
        $scanExitCode = $LASTEXITCODE
        if ($scanExitCode -eq 0) { throw "Literal API key assignment found under $scanRoot." }
        if ($scanExitCode -gt 1) { throw "Source scan failed under $scanRoot (rg exit $scanExitCode)." }
    }
}

Write-Output 'GOOGLE_PIPELINE: manifests and Rust/Bun/Python owner paths verified.'
Write-Output "Rust: $($rustPackage.manifest_path) -> aphrody-google"
Write-Output "Bun: $bunManifestPath -> @aphrody/google"
Write-Output "Doc AI: $docAiManifestPath -> @aphrody/doc-ai"
Write-Output "Python: $pythonManifest -> aphrody.google / aphrody-google"
if ($StaticOnly) { return }

$uvVersionOutput = & uv --version
if ($LASTEXITCODE -ne 0) { throw 'Could not query the uv version for the Python gate.' }
if ($uvVersionOutput -notmatch "\b$([regex]::Escape($pythonUvVersion))\b") {
    throw "Python gate requires uv $pythonUvVersion from py/pyproject.toml; found $uvVersionOutput."
}

$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
# Every crate of the Google domain (crates/google/*) builds and tests on its own: one `-p` per crate,
# so a crate that silently relies on a sibling's features fails here.
$googleCrates = $cargoMetadata.packages |
    Where-Object { [IO.Path]::GetFullPath($_.manifest_path).StartsWith([IO.Path]::GetFullPath((Join-Path $AphrodyRoot 'crates/google'))) } |
    ForEach-Object { $_.name } | Sort-Object
if ($googleCrates.Count -lt 8) { throw "expected the 8 crates of crates/google, found: $($googleCrates -join ', ')" }
foreach ($crate in $googleCrates) {
    Invoke-OwnerCommand "Rust $crate clippy (serialized, standalone)" $pwsh @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $cargoWrapper,
        'clippy', '--locked', '-p', $crate, '--all-targets', '--', '-D', 'warnings'
    ) $AphrodyRoot
    Invoke-OwnerCommand "Rust $crate tests (serialized, standalone)" $pwsh @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $cargoWrapper,
        'test', '--locked', '-p', $crate
    ) $AphrodyRoot
}
Invoke-OwnerCommand '@aphrody/google verify (tests + Bun build)' 'bun' @(
    'run', '--filter', '@aphrody/google', 'verify'
) $AphrodyRoot
Invoke-OwnerCommand '@aphrody/doc-ai tests' 'bun' @(
    'run', '--filter', '@aphrody/doc-ai', 'test'
) $AphrodyRoot
Invoke-OwnerCommand '@aphrody/doc-ai typecheck' 'bun' @(
    'run', '--filter', '@aphrody/doc-ai', 'typecheck'
) $AphrodyRoot
# The SDK is maintained in its independent pinned Git repository. Locked sync
# builds its wheel through uv and verifies the actual consumer without a checkout.
Invoke-OwnerCommand 'Python pinned google-antigravity SDK installs from the lock' 'uv' @(
    'sync', '--locked', '--package', 'aphrody-py-workspace'
) $PythonRoot
Invoke-OwnerCommand 'Python google-antigravity SDK imports' 'uv' @(
    'run', '--locked', 'python', '-c', 'import google.antigravity'
) $PythonRoot
Invoke-OwnerCommand 'Python aphrody tests' 'uv' @(
    'run', '--locked', '--package', 'aphrody', 'pytest'
) $PythonRoot

Write-Output 'GOOGLE_PIPELINE: all current owner gates passed.'
