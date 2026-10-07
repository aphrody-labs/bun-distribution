# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
$rustCatalog = Join-Path $root 'crates/os/kernel/comps/winclean/src/tools.json'
$ledgerPath = Join-Path $root 'crates/os/kernel/comps/winclean/tool-migration.json'
$bunCatalog = Join-Path $root 'packages/os/winclean/src/generated.ts'
# Resolve the real target directory via `cargo metadata`: the superproject's
# `../.cargo/config.toml` routes this workspace into a target-dir shared with
# sibling repos, so it is never `$root/target`.
$osTargetDir = (cargo metadata --manifest-path (Join-Path $root 'Cargo.toml') --format-version 1 --no-deps 2>$null | ConvertFrom-Json).target_directory
if (-not $osTargetDir) { throw "unable to resolve target_directory via cargo metadata for $root" }
$kernel = Join-Path $osTargetDir 'debug/aphrody-kernel.exe'

foreach ($path in @($rustCatalog, $ledgerPath, $bunCatalog)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "WinClean integration input missing: $path" }
}
& bun (Join-Path $root 'scripts/tools/os/scripts/generate-winclean-catalog.ts') --check
if ($LASTEXITCODE -ne 0) { throw 'WinClean generated bindings or catalog metadata diverge.' }

$rustTools = @((Get-Content -LiteralPath $rustCatalog -Raw | ConvertFrom-Json).tools).Count
$catalogTools = $rustTools

$ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
$ledgerTools = @($ledger.tools)
if ($ledger.catalog_tool_count -ne $catalogTools -or $ledgerTools.Count -ne $catalogTools) {
    throw "WinClean migration ledger count drift: declared=$($ledger.catalog_tool_count) ledger=$($ledgerTools.Count) catalog=$catalogTools"
}
$nativeNames = @((Get-Content -LiteralPath $rustCatalog -Raw | ConvertFrom-Json).tools.name | Sort-Object)
$ledgerNames = @($ledgerTools | Sort-Object)
if (($ledgerNames | Select-Object -Unique).Count -ne $ledgerNames.Count -or (Compare-Object $nativeNames $ledgerNames)) {
    throw 'WinClean migration ledger names diverge from the frozen catalog.'
}
$catalogText = [IO.File]::ReadAllText($rustCatalog).Replace("`r`n", "`n")
$catalogBytes = [Text.Encoding]::UTF8.GetBytes($catalogText)
# The ledger pins Git's LF blob; core.autocrlf may expand the working file to CRLF on Windows.
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $catalogHash = [BitConverter]::ToString($hasher.ComputeHash($catalogBytes)).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
if ($ledger.catalog_sha256 -ne $catalogHash) { throw 'WinClean migration ledger schema hash drift.' }

if (-not (Test-Path -LiteralPath $kernel)) {
    throw 'Build aphrody-kernel before the live integration probe.'
}

$pipeName = "aphrody-winclean-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$pipe = "\\.\pipe\$pipeName"
$server = Start-Process -FilePath $kernel -ArgumentList @('--socket', $pipe, 'serve', '--no-browser', '--no-shell') -WindowStyle Hidden -PassThru
try {
    $probe = [IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [IO.Pipes.PipeDirection]::InOut)
    try { $probe.Connect(5000) } finally { $probe.Dispose() }
    if ($server.HasExited) { throw 'Kernel exited before the live integration probe.' }
    $listed = & $kernel --socket $pipe tools | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Kernel tools/list failed.' }
    $kernelNames = @($listed.tools.name)
    $missing = @($nativeNames | Where-Object { $_ -notin $kernelNames })
    if ($missing.Count -or @($kernelNames | Where-Object { $_ -in $nativeNames }).Count -ne $catalogTools) {
        throw "Kernel admin drift: missing=$($missing -join ', ') catalog=$catalogTools"
    }
    $liveCall = & $kernel --socket $pipe call get_os_info '{}' | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $liveCall.isError -ne $false -or -not $liveCall.structuredContent) {
        throw 'Live kernel get_os_info call failed.'
    }
    [pscustomobject]@{
        catalog_tools = $catalogTools
        rust_tools = $rustTools
        ledger_tools = @($ledgerTools).Count
        rust_dispatched_tools = @($ledger.dispatch_overrides.psobject.Properties | Where-Object { $_.Value -eq 'rust' }).Count
        kernel_tools = $catalogTools
        live_call = 'get_os_info'
        plugin = Join-Path $(if ($env:APHRODY_PLUGINS_ROOT) { $env:APHRODY_PLUGINS_ROOT } else { Join-Path $HOME 'plugins' }) 'aphrody'
    } | ConvertTo-Json -Compress
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    $server.WaitForExit()
}
