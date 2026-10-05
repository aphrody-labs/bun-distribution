#Requires -Version 7.4
#Requires -PSEdition Core
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$HomeDirectory = $(if ($env:APHRODY_HOME) { $env:APHRODY_HOME } else { Join-Path $HOME '.aphrody' }),
    [string]$Target,
    [string]$Remote,
    [switch]$SkipFetch,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$AphrodyRoot = (Resolve-Path -LiteralPath $AphrodyRoot).Path

function Invoke-GitText {
    param([Parameter(Mandatory)][string[]]$GitArgs)
    $result = & git -C $AphrodyRoot @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed in $AphrodyRoot" }
    return ($result -join "`n").Trim()
}

$remoteOutput = Invoke-GitText @('remote')
$remoteNames = @($remoteOutput -split "`r?`n" | Where-Object { $_ })
if (-not $Remote) {
    if ($remoteNames -contains 'origin') { $Remote = 'origin' }
    elseif ($remoteNames -contains 'workspace') { $Remote = 'workspace' }
    else { throw 'No origin or workspace remote is configured; pass -Remote <name>.' }
}
if ($Remote -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $remoteNames -notcontains $Remote) {
    throw "Git remote '$Remote' is not configured; pass -Remote <configured-name>."
}
$null = Invoke-GitText @('remote', 'get-url', $Remote)
if (-not $SkipFetch) { $null = Invoke-GitText @('fetch', $Remote, 'main', '--quiet') }

$branch = Invoke-GitText @('branch', '--show-current')
if ($branch -ne 'main') { throw "Refusing update from branch '$branch'; check out main first." }
$head = Invoke-GitText @('rev-parse', 'HEAD')
$remoteRef = "refs/remotes/$Remote/main"
$remoteMain = & git -C $AphrodyRoot rev-parse --verify "$remoteRef^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Remote-tracking branch $Remote/main is unavailable; fetch it or omit -SkipFetch."
}
$remoteMain = ($remoteMain -join "`n").Trim()
if ($head -ne $remoteMain) {
    throw "Checkout is not at $Remote/main (HEAD $head, $Remote/main $remoteMain); fast-forward the monorepo first."
}
$dirty = Invoke-GitText @('status', '--porcelain=v1', '--untracked-files=all')
if ($dirty) { throw "Tracked or untracked changes block the Google CLI update:`n$dirty" }

$installer = Join-Path $PSScriptRoot 'install-google-stack.ps1'
$installArgs = @('-AphrodyRoot', $AphrodyRoot, '-HomeDirectory', $HomeDirectory)
if ($Target) { $installArgs += @('-Target', $Target) }
if ($SkipBuild) { $installArgs += '-SkipBuild' }
& $installer @installArgs
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Google CLI installation failed (exit $LASTEXITCODE)." }
Write-Output "APHRODY_GOOGLE_UPDATE=PASS ($Remote/main $head)"
