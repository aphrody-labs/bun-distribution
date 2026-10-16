[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$ConfirmCleanup
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$protected = @('.git', 'data', 'var', 'private', 'assets', 'examples', 'vcpkg_installed', '.venv', 'target', 'node_modules', 're-backup-*', 'vfs', 'lua-vfs', 'lua-vfs-all', 'iecode-extract')
$ignored = @(git -C $repo ls-files --others --ignored --exclude-standard -z) -join ''
$paths = @($ignored -split "`0" | Where-Object { $_ })
if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate ignored files.' }
$candidates = [System.Collections.Generic.List[string]]::new()

foreach ($relative in $paths) {
    $parts = $relative -split '[\\/]'
    if ($protected | Where-Object { $parts -contains $_ -or $relative -like $_ }) { continue }
    if ($parts | Where-Object { $_ -like '.env*' -or $_ -like '*.keys' }) { continue }
    $full = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $full -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
    $isArtifact =
        ($parts | Where-Object { $_ -in @('coverage', 'test-results', 'playwright-report', '.nyc_output', '.cache', 'tmp', 'temp', 'scratch') })
    if ($isArtifact) { $candidates.Add($full) }
}

$candidates = @($candidates | Sort-Object -Unique)
$bytes = ($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    ForEach-Object { (Get-Item -LiteralPath $_).Length } | Measure-Object -Sum).Sum
Write-Host ("Safe cleanup candidates: {0} files, {1:N0} bytes ({2:N2} GB)" -f $candidates.Count, $bytes, ($bytes / 1GB))
$candidates | ForEach-Object { Write-Host "  $_" }

if (-not $ConfirmCleanup) {
    Write-Host 'Preview only. Add -ConfirmCleanup to remove these exact files.'
    exit 0
}
foreach ($path in $candidates) {
    if ((Test-Path -LiteralPath $path) -and $PSCmdlet.ShouldProcess($path, 'Remove ignored cleanup artifact')) {
        Remove-Item -LiteralPath $path -Force
    }
}
Write-Host 'Safe cleanup complete.'
