# SPDX-License-Identifier: Apache-2.0
# Idempotent per-user toolchain sync for Windows (pwsh 7, non-elevated), driven by config/infra/toolchain.json.
# No Cargo build, no PATH/profile edits (owned by aphrody-claude user/shell/profile.ps1).
param([string]$Manifest = (Join-Path $PSScriptRoot '..\..\config\infra\toolchain.json'))
$ErrorActionPreference = 'Continue'
$m = Get-Content $Manifest -Raw | ConvertFrom-Json
$home_ = $env:USERPROFILE
$env:Path = "$home_\.cargo\bin;$home_\.bun\bin;$home_\.local\bin;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
New-Item -ItemType Directory -Force "$home_\.local\bin" | Out-Null
function Log($t) { Write-Output "== $t" }

Log rustup
$rust = $m.versions.rust
rustup toolchain install $rust --profile minimal @($m.rustToolchain.components | % { '-c'; $_ }) 2>&1 | Select-Object -Last 1
rustup default $rust 2>&1 | Select-Object -Last 1
rustup target add --toolchain $rust wasm32-unknown-unknown wasm32-wasip1 2>&1 | Select-Object -Last 1

Log cargo-binstall
if (-not (Get-Command cargo-binstall -ErrorAction SilentlyContinue)) {
  Set-ExecutionPolicy Unrestricted -Scope Process -Force
  iex ((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.ps1).Content)
}
foreach ($c in ($m.binstall + @('eza', 'ripgrep'))) {
  cargo-binstall --no-confirm --disable-strategies compile --locked $c 2>&1 | Select-Object -Last 1
}

Log winget
$ids = @('jqlang.jq', 'MikeFarah.yq', 'rsteube.Carapace', 'Facebook.zstd', 'wez.wezterm.nightly')
foreach ($id in $ids) {
  winget install --id $id --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 2
}
winget upgrade --id astral-sh.uv --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 1
winget upgrade --id Oven-sh.Bun --exact --silent 2>&1 | Select-Object -Last 1

Log bun
bun add -g @($m.bunGlobal) 2>&1 | Select-Object -Last 2

Log uv
uv python install $m.versions.python 2>&1 | Select-Object -Last 1

Log ovhcloud
$ov = $m.versions.ovhcloud
$have = (& ovhcloud version 2>$null | Out-String)
if ($have -notmatch "v$ov") {
  $zip = Join-Path $env:TEMP 'ovh.zip'
  Invoke-WebRequest "https://github.com/ovh/ovhcloud-cli/releases/download/v$ov/ovhcloud-cli_Windows_x86_64.zip" -OutFile $zip
  Expand-Archive $zip "$env:TEMP\ovh" -Force
  Copy-Item "$env:TEMP\ovh\ovhcloud.exe" "$home_\.local\bin\ovhcloud.exe" -Force
  Remove-Item $zip, "$env:TEMP\ovh" -Recurse -Force
}
Log done
