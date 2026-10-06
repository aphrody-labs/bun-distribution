# SPDX-License-Identifier: Apache-2.0
# Aphrody installer for Windows (PowerShell 5.1 or 7):
#   irm https://downloads.aphrody.com/install.ps1 | iex
#
# The command-line twin of Aphrody-Setup.exe (the « Download Aphrody » button, one double click). By default
# (`all`) it installs the single `aphrody` multi-call binary (MCP server included, linked as aphrody-mcp.exe by
# `aphrody self install-path`), yolo, the desktop app, the Claude plugins, and declares the aphrody MCP server and
# the plugins in Claude Code. With `all`, a component not published for Windows is skipped with a note; a component
# named explicitly must install. Environment:
#   APHRODY_DOWNLOAD_URL  base URL (default https://downloads.aphrody.com)
#   APHRODY_COMPONENTS    `all` (default) or space separated: aphrody yolo desktop plugin-aphrody plugin-yolo
#                         plugin-shenron mcp
#   APHRODY_PREFIX        install prefix (default %USERPROFILE%\.local)
#   APHRODY_NO_LINKS=1    do not run `aphrody self install-path`
# Every download is verified against SHA256SUMS of the same release.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base = if ($env:APHRODY_DOWNLOAD_URL) { $env:APHRODY_DOWNLOAD_URL.TrimEnd("/") } else { "https://downloads.aphrody.com" }
$Requested = if ($env:APHRODY_COMPONENTS) { $env:APHRODY_COMPONENTS.Trim() } else { "all" }
$All = $Requested -eq "all"
$Components = if ($All) { @("aphrody", "yolo", "desktop", "plugin-aphrody", "plugin-yolo", "plugin-shenron", "mcp") } else { $Requested -split "\s+" | Where-Object { $_ } }
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
  # With `all`, an unpublished component is a note; named explicitly, it is an error.
  function Skip([string]$Message) {
    if ($All) { Write-Host "  skipped: $Message"; return }
    throw $Message
  }
  $AphrodyExe = $null
  $Plugins = @()

  foreach ($Component in $Components) {
    Write-Host "Installing $Component ($Target)"
    switch -Wildcard ($Component) {
      "aphrody" {
        $Name = Find-File "aphrody" "-$Target.zip"
        if (-not $Name) { Skip "no aphrody build for $Target in this release"; continue }
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
        $AphrodyExe = $Exe
        Write-Host "aphrody installed in $Dest"
      }
      "yolo" {
        $Name = Find-File "yolo" "-$Target.tar.gz"
        if (-not $Name) { Skip "no yolo build for $Target in this release"; continue }
        $Archive = Get-Verified $Name
        # The yolo installer reads SHA256SUMS and the archive from a local release folder and checks them itself.
        $ReleaseDir = Join-Path $Tmp "yolo-release"
        New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
        Copy-Item $SumsPath, $Archive $ReleaseDir
        $Installer = Join-Path $Tmp "install-yolo.ps1"
        Invoke-WebRequest "$Base/install-yolo.ps1" -OutFile $Installer -UseBasicParsing
        $env:YOLO_RELEASE_DIR = $ReleaseDir; $env:YOLO_NO_CRATES = "1"
        try { & powershell -NoProfile -ExecutionPolicy Bypass -File $Installer } finally { Remove-Item Env:YOLO_RELEASE_DIR, Env:YOLO_NO_CRATES -ErrorAction SilentlyContinue }
        if ($LASTEXITCODE -ne 0) { throw "the yolo installer failed ($LASTEXITCODE)" }
      }
      "desktop" {
        $Name = Find-File "aphrody-app" "-$Target.exe"
        if (-not $Name) { Skip "the desktop app is not published for $Target yet"; continue }
        $Installer = Get-Verified $Name
        # Tauri NSIS installer, per user: /S is its silent mode; it creates its own shortcuts.
        $Process = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
        if ($Process.ExitCode -ne 0) { throw "the desktop installer failed ($($Process.ExitCode))" }
        Write-Host "Aphrody desktop app installed"
      }
      "mcp" {
        $Bin = if ($AphrodyExe) { $AphrodyExe } else { (Get-Command aphrody -ErrorAction SilentlyContinue).Source }
        if (-not $Bin) { Skip "aphrody is not installed: no MCP server to declare"; continue }
        $Claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
        if (-not $Claude) { Skip "Claude Code is not installed: claude mcp add --scope user aphrody -- $Bin kernel mcp"; continue }
        & $Claude mcp remove aphrody --scope user *> $null
        & $Claude mcp add --scope user aphrody -- $Bin kernel mcp | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "claude mcp add failed" }
        Write-Host "aphrody MCP server declared in Claude Code (Aphrody-Setup.exe also declares it in Claude Desktop)"
      }
      "plugin-*" {
        if ($Component -notin @("plugin-aphrody", "plugin-yolo", "plugin-shenron")) { throw "unknown component: $Component" }
        $Name = Find-File $Component ".zip"
        if (-not $Name) { Skip "no $Component archive in this release"; continue }
        $Zip = Get-Verified $Name
        $Dest = Join-Path $Prefix "share\aphrody\plugins\$Component"
        if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Expand-Archive -Path $Zip -DestinationPath $Dest -Force
        $Plugins += $Component
        Write-Host "$Component installed in $Dest"
      }
      default { throw "unknown or unsupported component on Windows: $Component" }
    }
  }
  # The installed plugins as a local Claude Code marketplace (the one Aphrody-Setup writes), then installed.
  if ($Plugins.Count -gt 0) {
    $Root = Join-Path $Prefix "share\aphrody\plugins"
    New-Item -ItemType Directory -Force -Path (Join-Path $Root ".claude-plugin") | Out-Null
    $Market = [ordered]@{
      name = "aphrody-local"
      owner = [ordered]@{ name = "aphrody-dev"; email = "contact@aphrody.com" }
      description = "Aphrody plugins installed from downloads.aphrody.com"
      plugins = @($Plugins | ForEach-Object { [ordered]@{ name = $_.Substring(7); source = "./$_" } })
    }
    [System.IO.File]::WriteAllText((Join-Path $Root ".claude-plugin\marketplace.json"), ($Market | ConvertTo-Json -Depth 4))
    $Claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
    if ($Claude) {
      & $Claude plugin marketplace add $Root --scope user | Out-Null
      foreach ($Plugin in $Plugins) {
        & $Claude plugin install "$($Plugin.Substring(7))@aphrody-local" --scope user | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "  $($Plugin.Substring(7)) installed in Claude Code" } else { Write-Host "  claude refused $($Plugin.Substring(7))" }
      }
    } else {
      Write-Host "plugins in $Root (Claude Code not found: claude plugin marketplace add $Root)"
    }
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
