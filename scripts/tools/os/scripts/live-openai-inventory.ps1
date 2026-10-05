# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([string]$ArtifactRoot = 'var/winclean-live/openai')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$kernel = Join-Path $root 'target/debug/aphrody.exe'
if (-not (Test-Path -LiteralPath $kernel)) { throw "aphrody missing: $kernel" }

$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'OpenAI.Codex MSIX package not installed.' }
$installRoot = [System.IO.Path]::GetFullPath($package.InstallLocation)
$family = $package.PackageFamilyName
$userRoots = @(
    @{ Kind = 'user-appdata'; Path = (Join-Path $env:APPDATA 'OpenAI') },
    @{ Kind = 'user-local'; Path = (Join-Path $env:LOCALAPPDATA 'OpenAI') },
    @{ Kind = 'msix-localcache'; Path = (Join-Path $env:LOCALAPPDATA "Packages\$family\LocalCache") },
    @{ Kind = 'msix-localstate'; Path = (Join-Path $env:LOCALAPPDATA "Packages\$family\LocalState") },
    @{ Kind = 'codex-home'; Path = (Join-Path $env:USERPROFILE '.codex') },
    @{ Kind = 'chatgpt-home'; Path = (Join-Path $env:USERPROFILE '.chatgpt') }
) | Where-Object { Test-Path -LiteralPath $_.Path -PathType Container }
$scanRoots = @(@{ Kind = 'msix-install'; Path = $installRoot }) + $userRoots

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$common = Join-Path $root $ArtifactRoot
$session = Join-Path $common $stamp
$latest = Join-Path $common 'latest'
New-Item -ItemType Directory -Force -Path $session, $latest | Out-Null
$pipe = "\\.\pipe\aphrody-openai-inventory-$stamp"
$server = Start-Process -FilePath $kernel -ArgumentList @('kernel', '--socket', $pipe, 'serve', '--no-shell', '--no-browser') -WindowStyle Hidden -PassThru

function Invoke-KernelTool([string]$Tool, [hashtable]$Arguments) {
    $payload = $Arguments | ConvertTo-Json -Compress -Depth 20
    $raw = & $kernel kernel --socket $pipe call $Tool $payload 2>&1
    if ($LASTEXITCODE -ne 0) { throw "kernel call failed: $Tool" }
    return ($raw -join "`n" | ConvertFrom-Json)
}

function Is-Sensitive([string]$Path) {
    return $Path -match '(?i)(token|secret|cookie|credential|password|passwd|auth|private[-_]?key|\.env($|\.))'
}

function Classify([System.IO.FileInfo]$File, [string]$RootKind) {
    if (Is-Sensitive $File.FullName) { return 'sensitive-metadata-only' }
    $ext = $File.Extension.ToLowerInvariant()
    if ($ext -in @('.exe','.dll','.sys','.node','.msi','.appx')) { return 'binary' }
    if ($ext -in @('.asar','.zip','.7z','.pak')) { return 'archive' }
    if ($ext -in @('.db','.sqlite','.sqlite3','.wal','.shm')) { return 'database-metadata-only' }
    if ($ext -in @('.json','.jsonl','.toml','.yaml','.yml','.ini','.cfg','.conf')) { return 'configuration-metadata-only' }
    if ($ext -in @('.js','.mjs','.cjs','.ts','.tsx','.css','.html')) { return 'application-source' }
    if ($ext -in @('.png','.jpg','.jpeg','.gif','.ico','.svg','.webp')) { return 'asset' }
    if ($RootKind -like 'msix-*') { return 'application-data' }
    return 'user-data-metadata-only'
}

try {
    Start-Sleep -Milliseconds 700
    $yoloStatus = (& $kernel yolo --root $root --socket $pipe --json win status | ConvertFrom-Json)
    $records = [System.Collections.Generic.List[object]]::new()
    $binaries = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $scanRoots) {
        $base = [System.IO.Path]::GetFullPath($entry.Path)
        $files = Get-ChildItem -LiteralPath $base -File -Force -Recurse -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            $classification = Classify $file $entry.Kind
            $relative = [System.IO.Path]::GetRelativePath($base, $file.FullName)
            $record = [ordered]@{
                path = $file.FullName
                rootKind = $entry.Kind
                relativePath = $relative
                extension = $file.Extension.ToLowerInvariant()
                bytes = $file.Length
                lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString('o')
                classification = $classification
                sensitive = ($classification -eq 'sensitive-metadata-only')
            }
            $records.Add([pscustomobject]$record)
            if ($classification -eq 'binary' -and -not $record.sensitive -and $file.Length -le 1073741824) {
                try { $hash = Invoke-KernelTool 'binary_hash_multi' @{ path = $file.FullName } }
                catch { $hash = [ordered]@{ success = $false; error = $_.Exception.Message } }
                $pe = $null
                if ($file.Extension -in @('.exe','.dll','.sys')) {
                    try { $pe = Invoke-KernelTool 'binary_parse_pe_header' @{ path = $file.FullName } }
                    catch { $pe = [ordered]@{ success = $false; error = $_.Exception.Message } }
                }
                $binaries.Add([pscustomobject]@{ path = $file.FullName; bytes = $file.Length; hash = $hash; pe = $pe })
            }
        }
    }

    $asarPath = Join-Path $installRoot 'app/resources/app.asar'
    $asar = if (Test-Path -LiteralPath $asarPath) { Invoke-KernelTool 'asar_list' @{ path = $asarPath } } else { [ordered]@{ success = $false; error = 'app.asar not found' } }
    $asarPayload = if ($asar.structuredContent) { $asar.structuredContent } else { $asar }
    $profile = Invoke-KernelTool 'get_system_profile' @{}
    $os = Invoke-KernelTool 'get_os_info' @{}
    $manifest = [ordered]@{
        schema = 'aphrody.openai.local.inventory.v1'
        status = 'verified-live-read-only'
        session = $stamp
        package = [ordered]@{ name = $package.Name; version = $package.Version.ToString(); family = $family; installRoot = $installRoot }
        roots = $scanRoots
        counts = [ordered]@{ files = $records.Count; binaries = $binaries.Count; sensitiveMetadataOnly = @($records | Where-Object sensitive).Count; asarFiles = if ($asarPayload.totalFiles) { $asarPayload.totalFiles } else { 0 } }
        policy = 'metadata, hashes and structural classification only; no secret or user-content extraction'
        consumers = @('aphrody-re','codex','gui-electron')
        artifacts = @('manifest.json','file-map.json','binary-analysis.json','asar-map.json','system-profile.json','os-info.json','yolo-status.json')
    }
    $outputs = [ordered]@{
        'manifest.json' = $manifest
        'file-map.json' = @($records)
        'binary-analysis.json' = @($binaries)
        'asar-map.json' = $asar
        'system-profile.json' = $profile
        'os-info.json' = $os
        'yolo-status.json' = $yoloStatus
    }
    foreach ($name in $outputs.Keys) {
        $json = $outputs[$name] | ConvertTo-Json -Depth 80
        Set-Content -LiteralPath (Join-Path $session $name) -Value $json -Encoding utf8
        Set-Content -LiteralPath (Join-Path $latest $name) -Value $json -Encoding utf8
    }
    [pscustomobject]@{ status = $manifest.status; session = $stamp; latest = (Resolve-Path $latest).Path; files = $records.Count; binaries = $binaries.Count; asarFiles = $manifest.counts.asarFiles; sensitiveMetadataOnly = $manifest.counts.sensitiveMetadataOnly } | ConvertTo-Json -Compress
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    if ($server) { $server.WaitForExit() }
}
