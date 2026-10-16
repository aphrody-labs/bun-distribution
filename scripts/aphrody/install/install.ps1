# SPDX-License-Identifier: Apache-2.0
# Aphrody one-click installer (Windows 11, PowerShell 5.1 or 7): thin entry point of `aphrody self install`.
#   irm https://downloads.aphrody.com/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://downloads.aphrody.com/install.ps1))) --host vps
#   & ([scriptblock]::Create((irm https://downloads.aphrody.com/install.ps1))) --target wasm
# Downloads the latest release (latest.json), verifies its SHA-256 against the release SHA256SUMS, then hands
# over to `aphrody self install` (layout, PATH, links, manifest, boot). Arguments are passed through.
# Environment: APHRODY_DOWNLOAD_URL, APHRODY_RELEASE (immutable id),
# APHRODY_COMPONENTS (anything but `aphrody` runs the full installer, install-full.ps1: plugins, MCP, desktop).
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$PassThru = $args

$Base = if ($env:APHRODY_DOWNLOAD_URL) { $env:APHRODY_DOWNLOAD_URL.TrimEnd("/") } else { "https://downloads.aphrody.com" }
$Target = "x86_64-pc-windows-msvc"
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") { throw "unsupported architecture (x86_64 only)" }
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("aphrody-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $ReleaseId = $env:APHRODY_RELEASE
  if (-not $ReleaseId) { $ReleaseId = (Invoke-RestMethod "$Base/latest.json" -UseBasicParsing).release.id }
  if ($ReleaseId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw "invalid or missing release ID" }
  $ReleaseBase = "$Base/releases/$ReleaseId"

  if ($env:APHRODY_COMPONENTS -and $env:APHRODY_COMPONENTS.Trim() -ne "aphrody") {
    $Full = Join-Path $Tmp "install-full.ps1"
    Invoke-WebRequest "$Base/install-full.ps1" -OutFile $Full -UseBasicParsing
    $env:APHRODY_RELEASE = $ReleaseId
    & $Full
    return
  }

  $Sums = @{}
  Invoke-WebRequest "$ReleaseBase/SHA256SUMS" -OutFile (Join-Path $Tmp "SHA256SUMS") -UseBasicParsing
  foreach ($line in Get-Content (Join-Path $Tmp "SHA256SUMS")) {
    $p = $line -split "\s+", 2
    if ($p.Count -ne 2 -or $p[0] -notmatch '^[0-9a-fA-F]{64}$' -or $p[1].Trim() -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "invalid SHA256SUMS" }
    $Sums[$p[1].Trim()] = $p[0].Trim().ToLower()
  }
  $Name = $Sums.Keys | Where-Object { $_ -match "^aphrody-[0-9].*-$Target\.zip$" } | Select-Object -First 1
  if (-not $Name) { throw "no aphrody build for $Target in release $ReleaseId" }
  $Zip = Join-Path $Tmp $Name
  Invoke-WebRequest "$ReleaseBase/files/$Name" -OutFile $Zip -UseBasicParsing
  $Got = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower()
  if ($Got -ne $Sums[$Name]) { throw "checksum mismatch for $Name (expected $($Sums[$Name]), got $Got)" }
  Write-Host "verified $Name (release $ReleaseId)"

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
  try {
    foreach ($Entry in $Archive.Entries) {
      if ($Entry.FullName.Replace('\', '/') -match '^/|^[A-Za-z]:|(^|/)\.\.(/|$)') { throw "unsafe archive entry: $($Entry.FullName)" }
    }
  } finally { $Archive.Dispose() }
  $Out = Join-Path $Tmp "x"
  Expand-Archive -Path $Zip -DestinationPath $Out -Force
  $Exe = Join-Path $Out "aphrody.exe"
  if (-not (Test-Path $Exe)) { throw "the archive has no aphrody.exe" }
  & $Exe --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "the downloaded aphrody.exe does not run on this host" }
  $env:APHRODY_DOWNLOAD_URL = $Base
  & $Exe self install --bin $Exe @PassThru
  if ($LASTEXITCODE -ne 0) { throw "aphrody self install failed ($LASTEXITCODE)" }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
