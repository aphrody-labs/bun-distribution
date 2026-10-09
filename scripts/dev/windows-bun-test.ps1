# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Run `bun test` natively on Windows against the selected workspace source packages.
.DESCRIPTION
  Workspace packages (@aphrody/*) are resolved through a generated tsconfig `paths` map pointing at their
  source entry points, so no Windows-side install is written into the shared tree. Run it from the package
  directory under test (no repository bunfig preload is applied there).
.EXAMPLE
  From packages/infra/workspace: pwsh -File ../../../scripts/dev/windows-bun-test.ps1 test
#>
$ErrorActionPreference = 'Stop'
$package = (Get-Location).Path
$root = $package
while ($root -and -not (Test-Path (Join-Path $root 'Cargo.toml'))) { $root = Split-Path $root -Parent }
if (-not $root) { throw 'Run from inside the Aphrody checkout.' }
$paths = [ordered]@{}
Get-ChildItem (Join-Path $root 'packages') -Filter package.json -Recurse -Depth 3 -File |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  ForEach-Object {
    $manifest = Get-Content $_.FullName -Raw | ConvertFrom-Json
    if ($manifest.name -notlike '@aphrody/*') { return }
    $entry = $null
    if ($manifest.exports -and $manifest.exports.'.' -is [string]) { $entry = $manifest.exports.'.' }
    elseif ($manifest.module) { $entry = $manifest.module }
    elseif ($manifest.main) { $entry = $manifest.main }
    if (-not $entry) { return }
    $absolute = Join-Path $_.DirectoryName $entry
    $paths[$manifest.name] = @($absolute.Replace('\', '/'))
    $paths["$($manifest.name)/*"] = @((Join-Path $_.DirectoryName 'src').Replace('\', '/') + '/*')
  }
$config = Join-Path $env:TEMP ('aphrody-windows-tsconfig-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  @{ compilerOptions = @{ baseUrl = $root.Replace('\', '/'); paths = $paths } } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $config -Encoding utf8
  & bun @args --tsconfig-override $config
  $result = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue
}
exit $result
