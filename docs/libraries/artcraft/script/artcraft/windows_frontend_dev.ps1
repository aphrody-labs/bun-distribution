$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location -LiteralPath (Join-Path $taskRoot 'frontend')
try {
  bun install --frozen-lockfile --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Frontend installation failed.' }
  if (-not $env:VITE_ENVIRONMENT_TYPE) { $env:VITE_ENVIRONMENT_TYPE = 'production' }
  bun run dev
  if ($LASTEXITCODE -ne 0) { throw 'Frontend server failed.' }
} finally {
  Pop-Location
}
