#Requires -Version 7.2
# SPDX-License-Identifier: Apache-2.0
# Infra adapter for the existing gateway; default is a read-only plan.
[CmdletBinding(SupportsShouldProcess)]
param([Parameter(Mandatory)][string]$Config, [switch]$DryRun, [switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Use the qualified native Windows gateway context.' }
if ($Apply -and $DryRun) { throw 'Choose Apply or DryRun.' }
$settings = Get-Content -LiteralPath (Resolve-Path -LiteralPath $Config).Path -Raw | ConvertFrom-Json
foreach ($name in @('home', 'sourceConfig', 'registry')) {
    if (-not [IO.Path]::IsPathFullyQualified($settings.$name)) { throw 'Configured paths must be absolute.' }
}
if ($settings.container -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$') { throw 'Invalid container name.' }
foreach ($name in $settings.serverNames) { if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$') { throw 'Invalid server name.' } }
if (@($settings.serverNames).Count -eq 0) { throw 'Declare the Aphrody server names.' }
$sourcePath = (Resolve-Path -LiteralPath $settings.sourceConfig).Path
$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$original = [Text.UTF8Encoding]::new($false, $true).GetString($sourceBytes).TrimStart([char]0xFEFF)
$registry = Get-Content -LiteralPath $settings.registry -Raw | ConvertFrom-Json
if ($registry.address -ne '127.0.0.1' -or [int]$registry.port -lt 1 -or [int]$registry.port -gt 65535) { throw 'Registry must identify the native loopback site listener.' }
$nativeProcess = Get-Process -Id $registry.pid -ErrorAction SilentlyContinue
$registeredStart = if ($registry.processStartedAt -is [datetime]) { $registry.processStartedAt.ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$registry.processStartedAt).UtcDateTime }
if (-not $nativeProcess -or $nativeProcess.StartTime.ToUniversalTime().Ticks -ne $registeredStart.Ticks) { throw 'Native site registry is stale.' }
$listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $registry.pid -LocalPort $registry.port -ErrorAction SilentlyContinue | Where-Object LocalAddress -EQ '127.0.0.1')
if ($listeners.Count -ne 1) { throw 'Native site listener ownership is not proven.' }

$begin = '# BEGIN APHRODY NATIVE SITE v1'
$end = '# END APHRODY NATIVE SITE v1'
$markerPattern = '(?ms)^' + [regex]::Escape($begin) + '\r?\n.*?^' + [regex]::Escape($end) + '\r?\n?'
$matches = [regex]::Matches($original, $markerPattern)
if ($matches.Count -gt 1 -or ([regex]::Matches($original, [regex]::Escape($begin))).Count -ne $matches.Count -or ([regex]::Matches($original, [regex]::Escape($end))).Count -ne $matches.Count) { throw 'Ambiguous or incomplete owned gateway markers.' }
$base = [regex]::Replace($original, $markerPattern, '')
# Small lexical shape guard, not a replacement Nginx parser: ignore quoted/comment
# braces and require the final brace to close the one top-level http block.
$httpMatch = [regex]::Match($base, '(?m)^http\s*\{')
$httpOpening = $httpMatch.Index + $httpMatch.Value.LastIndexOf('{')
$httpClosing = -1
$depth = 0; $quote = [char]0; $comment = $false; $escaped = $false; $lastClosing = -1
for ($index = 0; $index -lt $base.Length; $index++) {
    $character = $base[$index]
    if ($comment) { if ($character -eq "`n") { $comment = $false }; continue }
    if ($escaped) { $escaped = $false; continue }
    if ($character -eq '\') { $escaped = $true; continue }
    if ($quote -ne [char]0) { if ($character -eq $quote) { $quote = [char]0 }; continue }
    if ($character -eq '"' -or $character -eq "'") { $quote = $character; continue }
    if ($character -eq '#') { $comment = $true; continue }
    if ($character -eq '{') { $depth++; if ($index -eq $httpOpening -and $depth -ne 1) { throw 'HTTP block must be top-level.' } }
    if ($character -eq '}') { $depth--; $lastClosing = $index; if ($depth -eq 0 -and $index -gt $httpOpening -and $httpClosing -lt 0) { $httpClosing = $index }; if ($depth -lt 0) { throw 'Invalid existing gateway braces.' } }
}
if ($depth -ne 0 -or $quote -ne [char]0 -or $lastClosing -lt 0 -or $lastClosing -ne $httpClosing -or $base.Substring($lastClosing + 1).Trim().Length -ne 0 -or ([regex]::Matches($base, '(?m)^http\s*\{')).Count -ne 1) { throw 'Expected a balanced gateway ending in its single http block.' }
$model = @{
    upstreams = @(@{ name = 'aphrody_native_site'; targets = @(@{ type = 'Tcp'; target = "host.docker.internal:$($registry.port)" }); keepalive = 16 })
    servers = @(@{ listen_ports = @('80', '[::]:80'); server_names = @($settings.serverNames); locations = @(@{ path = '/'; proxy_pass = 'http://aphrody_native_site'; proxy_http_version = '1.1'; headers = @(@('Host', '$host'), @('X-Real-IP', '$remote_addr'), @('X-Forwarded-For', '$proxy_add_x_forwarded_for'), @('X-Forwarded-Proto', '$scheme'), @('Connection', '""')); custom_directives = @('proxy_read_timeout 30s') }) })
}
$tls = if ($settings.PSObject.Properties.Name -contains 'tls') { $settings.tls } else { $null }
if ($tls -and $tls.enabled) {
    if (-not [IO.Path]::IsPathFullyQualified($tls.directory) -or $tls.containerDirectory -notmatch '^/[a-zA-Z0-9/_-]+$') { throw 'Declare absolute host TLS directory and safe container directory.' }
    foreach ($item in @(@('leaf-chain.pem','certificateSha256'), @('leaf-key.pem','privateKeySha256'))) {
        if ($tls.($item[1]) -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath (Join-Path $tls.directory $item[0]) -Algorithm SHA256).Hash -ne $tls.($item[1])) { throw 'TLS artifact checksum differs from declared manifest.' }
    }
    $tlsPorts = @('443 ssl','[::]:443 ssl')
    $tlsDirectives = @('http2 on','ssl_protocols TLSv1.2 TLSv1.3')
    if ($tls.quic) {
        $tlsPorts += @('443 quic reuseport','[::]:443 quic reuseport')
        $tlsDirectives += @('http3 on','quic_retry on','add_header Alt-Svc ''h3=":443"; ma=86400'' always')
    }
    $model.servers += @{ listen_ports = $tlsPorts; server_names = @('localhost','127.0.0.1','aphrody.local'); ssl_certificate = "$($tls.containerDirectory)/leaf-chain.pem"; ssl_certificate_key = "$($tls.containerDirectory)/leaf-key.pem"; custom_directives = $tlsDirectives; locations = $model.servers[0].locations }
}
$renderedLines = ($model | ConvertTo-Json -Depth 10 -Compress) | & aphrody infra nginx render -
if ($LASTEXITCODE -ne 0) { throw 'Native Infra Nginx rendering failed.' }
$rendered = $renderedLines -join "`n"
$candidate = $base.Substring(0, $lastClosing) + "`n$begin`n$rendered`n$end`n" + $base.Substring($lastClosing)
[pscustomobject]@{ mode = if ($Apply) { 'apply' } else { 'plan' }; sourceSha256 = $sourceHash; container = $settings.container; sitePid = $registry.pid; upstreamPort = $registry.port; names = $settings.serverNames; preservesExistingRoutes = $true; markedBlockCount = $matches.Count }
if (-not $Apply -or $DryRun -or $WhatIfPreference) { return }
if ($settings.expectedSourceSha256 -ne $sourceHash) { throw 'Expected source checksum differs; refresh the reviewed plan.' }
if (-not $PSCmdlet.ShouldProcess($sourcePath, 'Validate and apply the declared Aphrody route through existing gateway')) { return }

function Invoke-DockerChecked([string[]]$Arguments) {
    $output = & docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed: $($Arguments[0])." }
    return $output
}
$inspection = Invoke-DockerChecked -Arguments @('inspect', $settings.container) | ConvertFrom-Json
$mount = @($inspection[0].Mounts | Where-Object Destination -EQ '/etc/nginx/nginx.conf')
if ($mount.Count -ne 1 -or $mount[0].Type -ne 'bind') { throw 'Gateway configuration must have exactly one declared host bind mount.' }
$mountedSource = [string]$mount[0].Source
$desktopMount = [regex]::Match($mountedSource, '^/run/desktop/mnt/host/([a-zA-Z])/(.+)$')
if ($desktopMount.Success) { $mountedSource = $desktopMount.Groups[1].Value + ':/' + $desktopMount.Groups[2].Value }
if ([IO.Path]::GetFullPath($mountedSource) -ne [IO.Path]::GetFullPath($sourcePath)) { throw 'Gateway bind mount does not match declared source.' }
if ($tls -and $tls.enabled) {
    $tlsMount = @($inspection[0].Mounts | Where-Object Destination -EQ $tls.containerDirectory)
    if ($tlsMount.Count -ne 1 -or $tlsMount[0].Type -ne 'bind' -or $tlsMount[0].RW) { throw 'Declare exactly one read-only TLS host bind mount in Compose first.' }
    $tlsSource = [string]$tlsMount[0].Source
    $desktopTls = [regex]::Match($tlsSource, '^/run/desktop/mnt/host/([a-zA-Z])/(.+)$')
    if ($desktopTls.Success) { $tlsSource = $desktopTls.Groups[1].Value + ':/' + $desktopTls.Groups[2].Value }
    if ([IO.Path]::GetFullPath($tlsSource) -ne [IO.Path]::GetFullPath($tls.directory)) { throw 'TLS bind mount differs from declared protected directory.' }
    foreach ($protocol in $(if ($tls.quic) { @('tcp','udp') } else { @('tcp') })) {
        $binding = $inspection[0].NetworkSettings.Ports.PSObject.Properties["443/$protocol"]
        if (-not $binding -or @($binding.Value | Where-Object HostPort -EQ '443').Count -eq 0) { throw "Declare published 443/$protocol in Compose first." }
    }
    foreach ($item in @(@('leaf-chain.pem','certificateSha256'), @('leaf-key.pem','privateKeySha256'))) {
        $seenHash = (Invoke-DockerChecked -Arguments @('exec', $settings.container, 'sha256sum', "$($tls.containerDirectory)/$($item[0])") -join '').Split(' ')[0]
        if ($seenHash -ne $tls.($item[1])) { throw 'Container TLS artifact checksum mismatch.' }
    }
}
$operationsDirectory = Join-Path $settings.home 'host/operations/aphrody-gateway'
[IO.Directory]::CreateDirectory($operationsDirectory) | Out-Null
$operationId = [guid]::NewGuid().ToString('N')
$backupPath = Join-Path $operationsDirectory "$operationId.backup.conf"
$candidatePath = Join-Path $operationsDirectory "$operationId.candidate.conf"
$containerCandidate = "/tmp/aphrody-site-$operationId.conf"
[IO.File]::WriteAllBytes($backupPath, $sourceBytes)
if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Backup checksum mismatch.' }
[IO.File]::WriteAllText($candidatePath, $candidate, [Text.UTF8Encoding]::new($false))
Invoke-DockerChecked -Arguments @('cp', $candidatePath, "$($settings.container):$containerCandidate") | Out-Null
Invoke-DockerChecked -Arguments @('exec', $settings.container, 'nginx', '-t', '-c', $containerCandidate) | Out-Null
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Concurrent gateway edit detected; original preserved.' }
$changed = $false
try {
    # Preserve the host bind-mounted file inode: rename/replace would leave Docker
    # reading its old inode. Workers retain their previous config until reload.
    $changed = $true
    [IO.File]::WriteAllText($sourcePath, $candidate, [Text.UTF8Encoding]::new($false))
    $candidateHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $containerHash = (Invoke-DockerChecked -Arguments @('exec', $settings.container, 'sha256sum', '/etc/nginx/nginx.conf') -join '').Split(' ')[0]
    if ($candidateHash -ne $containerHash) { throw 'Container does not see the declared candidate bytes.' }
    Invoke-DockerChecked -Arguments @('exec', $settings.container, 'nginx', '-t') | Out-Null
    Invoke-DockerChecked -Arguments @('exec', $settings.container, 'nginx', '-s', 'reload') | Out-Null
    $reloadDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $healthStatus = $null
    do {
        try {
            $health = Invoke-WebRequest -Uri 'http://127.0.0.1:80/health' -Headers @{ Host = 'localhost' } -TimeoutSec 2 -MaximumRedirection 0 -SkipHttpErrorCheck
            $healthStatus = [int]$health.StatusCode
        } catch { $healthStatus = $null }
        if ($healthStatus -ne 204) { Start-Sleep -Milliseconds 200 }
    } while ($healthStatus -ne 204 -and [DateTime]::UtcNow -lt $reloadDeadline)
    if ($healthStatus -ne 204) { throw 'PC port80 Host localhost did not reach the native site health endpoint.' }
    if ($tls -and $tls.enabled) {
        $tlsHealth = Invoke-WebRequest -Uri 'https://localhost:443/health' -TimeoutSec 5 -MaximumRedirection 0 -SkipHttpErrorCheck
        if ([int]$tlsHealth.StatusCode -ne 204) { throw 'Trusted localhost HTTPS health failed.' }
    }
    [IO.File]::WriteAllText((Join-Path $operationsDirectory "$operationId.receipt.json"), (@{ originalSha256 = $sourceHash; candidateSha256 = $candidateHash; backup = $backupPath; upstreamPort = $registry.port; httpHealth = 204; observedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    [pscustomobject]@{ applied = $true; httpHealth = 204; backup = $backupPath; sourceSha256 = $candidateHash }
} catch {
    if ($changed) {
        [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
        if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Gateway rollback checksum mismatch.' }
        Invoke-DockerChecked -Arguments @('exec', $settings.container, 'nginx', '-t') | Out-Null
        Invoke-DockerChecked -Arguments @('exec', $settings.container, 'nginx', '-s', 'reload') | Out-Null
    }
    throw
} finally {
    # Only this operation's generated candidate file, never gateway/container data.
    & docker exec $settings.container rm -f -- $containerCandidate | Out-Null
}
