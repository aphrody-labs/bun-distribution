# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Run cargo on Windows 11 against the MSVC toolchain of the newest Visual Studio / Build Tools.
.DESCRIPTION
  Finds the installation with vswhere (nothing is hard-coded), enters its developer shell so cl.exe and
  link.exe are on PATH, keeps the build output off the checkout, serializes Cargo, preserves native sccache and maps
  the SSH alias used by private Git dependencies to HTTPS through process-local Git configuration.
.EXAMPLE
  pwsh -File scripts/dev/windows-cargo.ps1 test -p aphrody-wsl --locked
#>
# No param block on purpose: an advanced script would bind cargo's -p to a common parameter prefix.
$ErrorActionPreference = 'Stop'
if (-not $args.Count) { throw 'Usage: windows-cargo.ps1 <cargo arguments>' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'vswhere.exe not found: install Visual Studio Build Tools (yolo ops system-packages --host windows apply).' }
$install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $install) { throw 'No Visual Studio installation with the MSVC x64 tools was found.' }
$checkout = (Get-Location).Path
Set-Location $env:SystemDrive\
& (Join-Path $install 'Common7\Tools\Launch-VsDevShell.ps1') -VsInstallationPath $install -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
Set-Location $checkout
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if ($env:Path -notlike "*$cargoBin*") { $env:Path += ";$cargoBin" }
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'aphrody\target' }
if ($env:RUSTC_WRAPPER -and -not (Test-Path -LiteralPath $env:RUSTC_WRAPPER)) {
    throw 'RUSTC_WRAPPER is not available on Windows; select an installed native wrapper explicitly.'
}
if (-not $env:RUSTC_WRAPPER) {
    $cache = Get-Command sccache -ErrorAction SilentlyContinue
    if ($cache) { $env:RUSTC_WRAPPER = $cache.Source }
}
if (-not $env:CARGO_BUILD_RUSTC_WRAPPER) { $env:CARGO_BUILD_RUSTC_WRAPPER = $env:RUSTC_WRAPPER }
if (-not $env:SCCACHE_SERVER_PORT) { $env:SCCACHE_SERVER_PORT = '4227' }
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '4' }
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'url.https://github.com/.insteadOf'
$env:GIT_CONFIG_VALUE_0 = 'ssh://git@github-dev/'
$mutex = [System.Threading.Mutex]::new($false, 'Local\AphrodyCargoBuild')
$ownsLock = $false
try {
    try { $ownsLock = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsLock = $true }
    if (-not $ownsLock) { throw 'Another Windows Cargo build holds the serialization lock.' }
    & cargo @args
    $result = $LASTEXITCODE
} finally {
    if ($ownsLock) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
exit $result
