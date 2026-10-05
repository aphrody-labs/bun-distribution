# SPDX-License-Identifier: Apache-2.0
# Aphrody installer for Windows (PowerShell 5.1 or 7):
#   irm https://downloads.aphrody.com/install.ps1 | iex
#
# Installs the single `aphrody` multi-call binary (MCP server included, linked as aphrody-mcp.exe by
# `aphrody self install-path`). Environment:
#   APHRODY_DOWNLOAD_URL  base URL (default https://downloads.aphrody.com)
#   APHRODY_COMPONENTS    space separated: aphrody plugin-aphrody plugin-yolo plugin-shenron (default: aphrody)
#   APHRODY_PREFIX        install prefix (default %USERPROFILE%\.local)
#   APHRODY_NO_LINKS=1    do not run `aphrody self install-path`
# Every download is verified against SHA256SUMS of the same release.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base = if ($env:APHRODY_DOWNLOAD_URL) { $env:APHRODY_DOWNLOAD_URL.TrimEnd("/") } else { "https://downloads.aphrody.com" }
$Components = if ($env:APHRODY_COMPONENTS) { $env:APHRODY_COMPONENTS -split "\s+" | Where-Object { $_ } } else { @("aphrody") }
$Prefix = if ($env:APHRODY_PREFIX) { $env:APHRODY_PREFIX } else { Join-Path $env:USERPROFILE ".local" }
$Target = "x86_64-pc-windows-msvc"
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") { throw "unsupported architecture (x86_64 only)" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("aphrody-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $SumsPath = Join-Path $Tmp "SHA256SUMS"
  Invoke-WebRequest "$Base/SHA256SUMS" -OutFile $SumsPath -UseBasicParsing
  $Sums = @{}
  foreach ($line in Get-Content $SumsPath) {
    $parts = $line -split "\s+", 2
    if ($parts.Count -eq 2) { $Sums[$parts[1].Trim()] = $parts[0].Trim().ToLower() }
  }
  function Get-Verified([string]$Name) {
    if (-not $Sums.ContainsKey($Name)) { throw "$Name is not listed in SHA256SUMS" }
    $Dest = Join-Path $Tmp $Name
    Invoke-WebRequest "$Base/files/$Name" -OutFile $Dest -UseBasicParsing
    $Got = (Get-FileHash -Algorithm SHA256 $Dest).Hash.ToLower()
    if ($Got -ne $Sums[$Name]) { throw "checksum mismatch for $Name (expected $($Sums[$Name]), got $Got)" }
    Write-Host "  verified $Name"
    return $Dest
  }
  function Find-File([string]$Prefix, [string]$Suffix) {
    $Sums.Keys | Where-Object { $_.StartsWith("$Prefix-") -and $_.EndsWith($Suffix) } | Select-Object -First 1
  }

  foreach ($Component in $Components) {
    Write-Host "Installing $Component ($Target)"
    switch -Wildcard ($Component) {
      "aphrody" {
        $Name = Find-File "aphrody" "-$Target.zip"
        if (-not $Name) { throw "no aphrody build for $Target in this release" }
        $Zip = Get-Verified $Name
        $Release = $Name.Substring(0, $Name.Length - "-$Target.zip".Length)
        $Dest = Join-Path $Prefix "lib\aphrody\$Release"
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Expand-Archive -Path $Zip -DestinationPath $Dest -Force
        $Exe = Join-Path $Dest "aphrody.exe"
        if (-not (Test-Path $Exe)) { throw "the archive has no aphrody.exe" }
        & $Exe --version | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "the downloaded aphrody.exe does not run on this host" }
        if (-not $env:APHRODY_NO_LINKS) {
          & $Exe self install-path --bin $Exe
          if ($LASTEXITCODE -ne 0) { throw "aphrody self install-path failed" }
        }
        Write-Host "aphrody installed in $Dest"
      }
      "plugin-*" {
        if ($Component -notin @("plugin-aphrody", "plugin-yolo", "plugin-shenron")) { throw "unknown component: $Component" }
        $Name = Find-File $Component ".zip"
        if (-not $Name) { throw "no $Component archive in this release" }
        $Zip = Get-Verified $Name
        $Dest = Join-Path $Prefix "share\aphrody\plugins\$Component"
        if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Expand-Archive -Path $Zip -DestinationPath $Dest -Force
        Write-Host "$Component installed in $Dest (claude --plugin-dir $Dest)"
      }
      default { throw "unknown or unsupported component on Windows: $Component" }
    }
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
