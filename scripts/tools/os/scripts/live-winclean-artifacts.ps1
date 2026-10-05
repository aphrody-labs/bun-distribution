# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$ArtifactRoot = "var/winclean-live"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$kernel = Join-Path $root 'target/debug/aphrody.exe'
if (-not (Test-Path -LiteralPath $kernel)) {
    throw "aphrody missing: $kernel"
}

$targetKind = 'chatgpt-msix'
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $package) { throw 'OpenAI.Codex MSIX package not installed; explicit -SourcePath is required.' }
    $source = Join-Path $package.InstallLocation 'app/ChatGPT.exe'
} else {
    $targetKind = 'explicit'
$source = [System.IO.Path]::GetFullPath((Join-Path $root $SourcePath))
}
$asarPath = Join-Path (Split-Path -Parent $source) 'resources/app.asar'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Source file missing: $source"
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$common = Join-Path $root $ArtifactRoot
$session = Join-Path $common $stamp
$latest = Join-Path $common 'latest'
New-Item -ItemType Directory -Force -Path $session, $latest | Out-Null
$pipe = "\\.\pipe\aphrody-winclean-live-$stamp"
$server = Start-Process -FilePath $kernel -ArgumentList @('kernel', '--socket', $pipe, 'serve', '--no-shell', '--no-browser') -WindowStyle Hidden -PassThru

function Invoke-KernelTool([string]$Tool, [hashtable]$Arguments) {
    $payload = $Arguments | ConvertTo-Json -Compress -Depth 20
    $raw = & $kernel kernel --socket $pipe call $Tool $payload 2>&1
    if ($LASTEXITCODE -ne 0) { throw "kernel call failed: $Tool`n$($raw -join "`n")" }
    return ($raw -join "`n" | ConvertFrom-Json)
}

function Invoke-KernelA2a([string]$Target, [string]$Tool, [hashtable]$Arguments) {
    $payload = $Arguments | ConvertTo-Json -Compress -Depth 20
    $raw = & $kernel kernel --socket $pipe a2a $Target $Tool $payload 2>&1
    if ($LASTEXITCODE -ne 0) { throw "A2A call failed: $Tool`n$($raw -join "`n")" }
    return ($raw -join "`n" | ConvertFrom-Json)
}

try {
    Start-Sleep -Milliseconds 700
    $tools = (& $kernel kernel --socket $pipe tools 2>$null | ConvertFrom-Json)
    $hash = Invoke-KernelTool 'binary_hash_multi' @{ path = $source }
    $strings = Invoke-KernelTool 'binary_extract_strings' @{ path = $source; minLength = 4; maxResults = 32 }
    $entropy = Invoke-KernelTool 'binary_entropy_map' @{ path = $source; blockSize = 256 }
    $xorOutput = Join-Path $session 'xor-output.bin'
    $xor = Invoke-KernelTool 'binary_xor_decrypt' @{ inputPath = $source; outputPath = $xorOutput; keyHex = 'A5 5A' }
    $aesOutput = Join-Path $session 'aes-output.bin'
    $aes = Invoke-KernelTool 'binary_aes_ctr_decrypt' @{ inputPath = $source; outputPath = $aesOutput; keyHex = '00000000000000000000000000000000'; ivHex = '00000000000000000000000000000000' }
    $sectionOutput = Join-Path $session 'pe-text-section.bin'
    $section = Invoke-KernelTool 'binary_section_dump' @{ path = $source; sectionName = '.text'; outputPath = $sectionOutput }
    $peHeader = Invoke-KernelTool 'binary_parse_pe_header' @{ path = $source }
    $aob = Invoke-KernelTool 'aob_scan' @{ path = $source; pattern = '4D 5A ?'; maxMatches = 10 }
    $asar = if (Test-Path -LiteralPath $asarPath) { Invoke-KernelTool 'asar_list' @{ path = $asarPath } } else { [ordered]@{ success = $false; skipped = $true; error = "app.asar not found: $asarPath" } }
    $os = Invoke-KernelTool 'get_os_info' @{}
    $a2a = Invoke-KernelA2a 'codex-gui-electron' 'binary_hash_multi' @{ path = $source }

    $manifest = [ordered]@{
        schema = 'aphrody.winclean.live.v1'
        status = 'verified-live'
        session = $stamp
        generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        producer = 'aphrody-kernel'
        source = $source
        targetKind = $targetKind
        consumers = @('aphrody-re', 'codex', 'gui-electron')
        transport = @('mcp/tools-call', 'a2a/message/send', 'cli')
        ownerByArtifact = [ordered]@{
            'binary-hash-multi.json' = 'aphrody-re'
            'binary-extract-strings.json' = 'aphrody-re'
            'binary-entropy-map.json' = 'aphrody-re'
            'binary-xor-decrypt.json' = 'aphrody-re'
            'binary-aes-ctr-decrypt.json' = 'aphrody-re'
            'binary-section-dump.json' = 'aphrody-re'
            'binary-parse-pe-header.json' = 'aphrody-re'
            'aob-scan.json' = 'aphrody-re'
            'asar-list.json' = 'aphrody-re'
            'os-info.json' = 'aphrody-winclean'
            'a2a-codex-gui-electron.json' = 'aphrody-re'
        }
        toolCount = @($tools.tools).Count
        artifacts = @('manifest.json', 'kernel-tools.json', 'binary-hash-multi.json', 'binary-extract-strings.json', 'binary-entropy-map.json', 'binary-xor-decrypt.json', 'binary-aes-ctr-decrypt.json', 'binary-section-dump.json', 'binary-parse-pe-header.json', 'aob-scan.json', 'asar-list.json', 'xor-output.bin', 'aes-output.bin', 'pe-text-section.bin', 'os-info.json', 'a2a-codex-gui-electron.json')
    }

    $outputs = @{
        'manifest.json' = $manifest
        'kernel-tools.json' = $tools
        'binary-hash-multi.json' = $hash
        'binary-extract-strings.json' = $strings
        'binary-entropy-map.json' = $entropy
        'binary-xor-decrypt.json' = $xor
        'binary-aes-ctr-decrypt.json' = $aes
        'binary-section-dump.json' = $section
        'binary-parse-pe-header.json' = $peHeader
        'aob-scan.json' = $aob
        'asar-list.json' = $asar
        'os-info.json' = $os
        'a2a-codex-gui-electron.json' = $a2a
    }
    foreach ($name in $outputs.Keys) {
        $json = $outputs[$name] | ConvertTo-Json -Depth 80
        Set-Content -LiteralPath (Join-Path $session $name) -Value $json -Encoding utf8
        Set-Content -LiteralPath (Join-Path $latest $name) -Value $json -Encoding utf8
    }
    Copy-Item -LiteralPath $xorOutput -Destination (Join-Path $latest 'xor-output.bin') -Force
    Copy-Item -LiteralPath $aesOutput -Destination (Join-Path $latest 'aes-output.bin') -Force
    Copy-Item -LiteralPath $sectionOutput -Destination (Join-Path $latest 'pe-text-section.bin') -Force
    [pscustomobject]@{ status = 'verified-live'; session = $stamp; latest = (Resolve-Path $latest).Path; source = $source; toolCount = @($tools.tools).Count } | ConvertTo-Json -Compress
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    if ($server) { $server.WaitForExit() }
}
