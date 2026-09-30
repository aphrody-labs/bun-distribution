[CmdletBinding()]
param(
    # aphrody-ai builds aphrody-google; aphrody-web holds the BXC Google web implementation.
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..\aphrody-ai'),
    [Alias('AphrodyOsRoot')]
    [string]$AphrodyWebRoot = (Join-Path $PSScriptRoot '..\..\aphrody-web'),
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
foreach ($repo in @($AphrodyRoot, $AphrodyWebRoot, (Join-Path $PSScriptRoot '..'))) {
    $resolved = (Resolve-Path $repo).Path
    if (-not $SkipFetch) { git -C $resolved fetch origin main --quiet; if ($LASTEXITCODE) { throw "fetch failed: $resolved" } }
    $dirty = git -C $resolved status --porcelain --untracked-files=no
    if ($dirty) { throw "tracked changes block update: $resolved" }
}

& (Join-Path $PSScriptRoot 'install-google-stack.ps1') -AphrodyRoot $AphrodyRoot -AphrodyWebRoot $AphrodyWebRoot
if ($LASTEXITCODE) { throw 'Google stack installation failed' }
Write-Output 'APHRODY_GOOGLE_UPDATE=PASS'
