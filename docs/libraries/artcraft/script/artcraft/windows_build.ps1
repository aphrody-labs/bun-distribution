$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location -LiteralPath (Join-Path $taskRoot 'frontend')
try {
  bun install --frozen-lockfile --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Frontend installation failed.' }
} finally {
  Pop-Location
}
$env:VITE_ENVIRONMENT_TYPE = 'production'
$env:SQLX_OFFLINE = 'true'
$env:TAURI_FRONTEND_PATH = Join-Path $taskRoot 'frontend'
$env:TAURI_APP_PATH = Join-Path $taskRoot 'crates/desktop/artcraft'
Push-Location -LiteralPath $taskRoot
try {
  cargo tauri build --config (Join-Path $env:TAURI_APP_PATH 'tauri.conf.json')
  if ($LASTEXITCODE -ne 0) { throw 'Native ArtCraft build failed.' }
} finally {
  Pop-Location
}
