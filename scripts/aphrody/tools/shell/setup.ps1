#Requires -Version 5.1
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Install)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../../docs/aphrody')).Path
$homePath = [Environment]::GetFolderPath('UserProfile')
$env:APHRODY_ROOT = if ($env:APHRODY_ROOT) { $env:APHRODY_ROOT } else { $repoRoot }
$env:APHRODY_HOME = if ($env:APHRODY_HOME) { $env:APHRODY_HOME } else { Join-Path $homePath '.aphrody' }
$env:APHRODY_AGENT_DOMAIN = if ($env:APHRODY_AGENT_DOMAIN) { $env:APHRODY_AGENT_DOMAIN } else { 'aphrody' }
$env:APHRODY_WORKSPACE = if ($env:APHRODY_WORKSPACE) { $env:APHRODY_WORKSPACE } else { Join-Path (Join-Path $env:APHRODY_HOME 'workspaces') $env:APHRODY_AGENT_DOMAIN }
$env:APHRODY_SOURCE_ROOT = if ($env:APHRODY_SOURCE_ROOT) { $env:APHRODY_SOURCE_ROOT } else { Join-Path $env:APHRODY_ROOT '.cache/upstream' }
$env:APHRODY_PY_ROOT = if ($env:APHRODY_PY_ROOT) { $env:APHRODY_PY_ROOT } else { Join-Path $env:APHRODY_ROOT 'py' }
$env:APHRODY_IECODE_ROOT = if ($env:APHRODY_IECODE_ROOT) { $env:APHRODY_IECODE_ROOT } else { Join-Path (Split-Path $env:APHRODY_ROOT -Parent) 'iecode' }
$env:IECODE_ROOT = if ($env:IECODE_ROOT) { $env:IECODE_ROOT } else { $env:APHRODY_IECODE_ROOT }
$env:CARGO_HOME = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $homePath '.cargo' }
$env:BUN_INSTALL = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path $homePath '.bun' }
$env:CARGO_BUILD_JOBS = if ($env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS } else { '6' }
$env:CARGO_INCREMENTAL = if ($env:CARGO_INCREMENTAL) { $env:CARGO_INCREMENTAL } else { '0' }
$pathEntries = @((Join-Path $env:CARGO_HOME 'bin'), (Join-Path $env:BUN_INSTALL 'bin'), (Join-Path $homePath '.local/bin'))
$env:PATH = (($pathEntries + ($env:PATH -split [IO.Path]::PathSeparator)) | Where-Object { $_ } | Select-Object -Unique) -join [IO.Path]::PathSeparator

if ($Install) {
    $profilePath = $PROFILE.CurrentUserAllHosts
    $profileDir = Split-Path $profilePath -Parent
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    if (-not (Test-Path $profilePath)) { New-Item -ItemType File -Path $profilePath | Out-Null }
    $content = Get-Content -LiteralPath $profilePath -Raw
    $marker = '# >>> aphrody global environment >>>'
    if (-not $content.Contains($marker)) {
        $escaped = $PSCommandPath.Replace("'", "''")
        Add-Content -LiteralPath $profilePath -Value "`n$marker`n. '$escaped'`n# <<< aphrody global environment <<<"
    }
    Write-Output "Installed PowerShell hook in $profilePath. Open a new shell to load it."
}
