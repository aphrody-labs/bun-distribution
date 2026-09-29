# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$DryRun,
    [switch]$SkipN2bFix
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$script:Changed = $false

function Invoke-Step([string]$Label, [scriptblock]$Action) {
    Write-Host "[toolchain] $Label"
    if (-not $DryRun) { & $Action }
}

function Test-Command([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

if (-not (Test-Command 'bun')) { throw 'Bun is required to bootstrap the toolchain.' }

$packagePath = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packagePath)) { throw "No package.json in $ProjectRoot" }
$package = Get-Content -Raw $packagePath | ConvertFrom-Json
$devDependencies = @{}
if ($package.devDependencies) { $package.devDependencies.psobject.Properties | ForEach-Object { $devDependencies[$_.Name] = $_.Value } }
$missing = @('oxlint', 'oxfmt', 'turbo') | Where-Object { -not $devDependencies.ContainsKey($_) }
if ($missing.Count -gt 0) {
    Invoke-Step "Add missing dev tools: $($missing -join ', ')" { bun add --dev --exact $missing }
} else { Write-Host '[toolchain] oxlint, oxfmt and turbo already declared' }

$configFiles = @(
    @{ Path = 'oxlint.json'; Content = '{"$schema":"https://oxc.rs/oxlint-schema.json"}' },
    @{ Path = '.oxfmtrc.json'; Content = '{"sortImports":true}' }
)
foreach ($config in $configFiles) {
    $path = Join-Path $ProjectRoot $config.Path
    if (-not (Test-Path -LiteralPath $path)) {
        Invoke-Step "Create $($config.Path)" { Set-Content -LiteralPath $path -Value $config.Content -Encoding utf8 }
    } else { Write-Host "[toolchain] $($config.Path) already configured" }
}

$turboPath = Join-Path $ProjectRoot 'turbo.json'
if (-not (Test-Path -LiteralPath $turboPath)) {
    Invoke-Step 'Create minimal turbo.json' { Set-Content -LiteralPath $turboPath -Value '{"$schema":"https://turborepo.org/schema.json","tasks":{"build":{"outputs":["dist/**"]},"test":{"dependsOn":["^build"]},"lint":{},"typecheck":{}}}' -Encoding utf8 }
} else { Write-Host '[toolchain] turbo.json already configured' }

if (-not (Test-Command 'n2b')) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    if (Test-Path (Join-Path $repoRoot 'Cargo.toml')) {
        Invoke-Step 'Install n2b from the local checkout' { cargo install --locked --path (Join-Path $repoRoot 'crates/aphrody-n2b') --force }
    } else { throw 'n2b is missing and the local checkout is unavailable.' }
} else { Write-Host "[toolchain] n2b already available: $((n2b --version) -join ' ')" }

if (-not $SkipN2bFix -and -not $DryRun) {
    $scriptsPath = Join-Path $ProjectRoot 'scripts'
    if (Test-Path -LiteralPath $scriptsPath) {
        & n2b $scriptsPath --fix
        if ($LASTEXITCODE -gt 1) { throw "n2b safe fix failed with exit code $LASTEXITCODE" }
    }
}
Write-Host '[toolchain] ready'
