#Requires -Version 7.0
# Build the maintained `nie` public Rust binary.
[CmdletBinding()]
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $Root
try {
    cargo build --release -p aphrody-nie-cli --bin nie
    if (-not $SkipTests) { cargo test -p aphrody-nie-cli --lib --tests }
    $bin = Join-Path $Root 'target\release\nie.exe'
    if (-not (Test-Path $bin)) { throw "Release binary not found: $bin" }
    $item = Get-Item $bin
    Write-Host "Built $($item.FullName) ($($item.Length) bytes)"
} finally { Pop-Location }
