[CmdletBinding()]
param(
    # aphrody-ai builds aphrody-google; it path-depends on its category siblings.
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..\aphrody-ai'),
    # aphrody-web holds the BXC Google web implementation; checked for presence only.
    [Alias('AphrodyOsRoot')]
    [string]$AphrodyWebRoot = (Join-Path $PSScriptRoot '..\..\aphrody-web'),
    [string]$HomeDirectory = $(if ($env:APHRODY_HOME) { $env:APHRODY_HOME } else { Join-Path $HOME '.aphrody' }),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$AphrodyRoot = (Resolve-Path $AphrodyRoot).Path
$AphrodyWebRoot = (Resolve-Path $AphrodyWebRoot).Path
$bin = Join-Path $HomeDirectory 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

if (-not $SkipBuild) {
    Push-Location $AphrodyRoot
    try { cargo build --release --locked -p aphrody-google; if ($LASTEXITCODE) { throw 'aphrody-google build failed' } }
    finally { Pop-Location }
}

$target = Join-Path $AphrodyRoot 'target\release\aphrody-google.exe'
if (-not (Test-Path $target)) { $target = Join-Path $AphrodyRoot 'target\release\aphrody-google' }
if (-not (Test-Path $target)) { throw "Missing release artifact: $target" }

$destination = Join-Path $bin ([IO.Path]::GetFileName($target))
$temporary = "$destination.new.$PID"
Copy-Item -LiteralPath $target -Destination $temporary -Force
Move-Item -LiteralPath $temporary -Destination $destination -Force
Copy-Item -LiteralPath $destination -Destination (Join-Path $bin 'google.exe') -Force

[Environment]::SetEnvironmentVariable('APHRODY_HOME', $HomeDirectory, 'User')
[Environment]::SetEnvironmentVariable('APHRODY_GOOGLE_BIN', $destination, 'User')
Write-Output "APHRODY_GOOGLE_INSTALLED=$destination"
& $destination doctor
if ($LASTEXITCODE) { throw 'aphrody-google doctor failed' }
