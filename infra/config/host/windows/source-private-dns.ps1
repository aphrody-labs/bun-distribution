# SPDX-License-Identifier: Apache-2.0
# Owned by Aphrody Infra boot. Never starts a service/task or requests elevation.
[CmdletBinding()]
param([ValidateSet('plan', 'apply')][string]$Mode = 'plan')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourceHostname = 'source.aphrody.app'
$sourceAddress = '10.200.77.1'
$tunnelName = 'aphrody'
$markerBegin = '# aphrody-infra source-private-dns begin'
$markerEnd = '# aphrody-infra source-private-dns end'
$ownedBlock = "$markerBegin`r`n$sourceAddress $sourceHostname`r`n$markerEnd`r`n"
$encoding = [Text.Encoding]::GetEncoding(28591)

function Assert-HostsPath([string]$HostsPath, [string]$SystemDirectory) {
    if (![IO.Path]::GetFullPath($HostsPath).StartsWith([IO.Path]::GetFullPath($SystemDirectory) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'HOSTS_PATH_OUTSIDE_SYSTEM_DIRECTORY' }
    foreach ($path in @($SystemDirectory, (Join-Path $SystemDirectory 'drivers'), (Join-Path $SystemDirectory 'drivers\etc'), $HostsPath)) {
        if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'HOSTS_REPARSE_POINT_REFUSED' }
    }
    $metadata = Get-Item -LiteralPath $HostsPath
    if ($metadata.PSIsContainer -or $metadata.Length -gt 1048576) { throw 'HOSTS_SIZE_OR_TYPE_INVALID' }
}

function Get-ByteHash([byte[]]$Bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Get-HostsProposal([byte[]]$Bytes) {
    if ($Bytes -contains 0) { throw 'HOSTS_ENCODING_UNSUPPORTED' }
    $text = $encoding.GetString($Bytes)
    $beginCount = [regex]::Matches($text, '(?m)^' + [regex]::Escape($markerBegin) + '\r?$').Count
    $endCount = [regex]::Matches($text, '(?m)^' + [regex]::Escape($markerEnd) + '\r?$').Count
    $owned = $false
    if ($beginCount -or $endCount) {
        $offset = $text.IndexOf($ownedBlock, [StringComparison]::Ordinal)
        if ($beginCount -ne 1 -or $endCount -ne 1 -or $offset -lt 0 -or ($offset -gt 0 -and $text[$offset - 1] -ne "`n")) {
            throw 'OWNED_HOSTS_BLOCK_INVALID'
        }
        $foreign = $text.Remove($offset, $ownedBlock.Length)
        $owned = $true
    } else { $foreign = $text }
    foreach ($line in ($foreign -split '\r?\n')) {
        $data = ($line -split '#', 2)[0].Trim()
        if (!$data) { continue }
        $parts = $data -split '\s+'
        if ($parts.Count -lt 2) { continue }
        foreach ($name in $parts[1..($parts.Count - 1)]) {
            if ($name.TrimEnd('.').Equals($sourceHostname, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'FOREIGN_SOURCE_HOSTS_ENTRY'
            }
        }
    }
    # Preserve every foreign byte, including comments, encoding bytes and line endings.
    if ($owned) { $after = $Bytes }
    else {
        $separator = if ($Bytes.Length -and $Bytes[$Bytes.Length - 1] -ne 10) { "`r`n" } else { '' }
        [byte[]]$after = $Bytes + $encoding.GetBytes($separator + $ownedBlock)
    }
    return @{ after = $after; changed = !$owned; beforeHash = (Get-ByteHash $Bytes); afterHash = (Get-ByteHash $after) }
}

function Get-PrivateRoute {
    $adapter = Get-NetAdapter -Name $tunnelName -ErrorAction Stop
    $service = Get-Service -Name ('WireGuardTunnel$' + $tunnelName) -ErrorAction Stop
    $selected = @(Find-NetRoute -RemoteIPAddress $sourceAddress -ErrorAction Stop)
    $routes = @($selected | Where-Object { $_.PSObject.Properties['DestinationPrefix'] })
    $addresses = @($selected | Where-Object { $_.PSObject.Properties['IPAddress'] })
    $correctRoute = @($routes | Where-Object {
        $_.InterfaceAlias -eq $tunnelName -and $_.DestinationPrefix -eq '10.200.77.0/24' -and $_.NextHop -eq '0.0.0.0'
    }).Count -eq 1
    $correctAddress = @($addresses | Where-Object {
        $_.InterfaceAlias -eq $tunnelName -and $_.IPAddress -match '^10\.200\.77\.(\d+)$' -and [int]$Matches[1] -ge 2 -and [int]$Matches[1] -le 254
    }).Count -eq 1
    return $adapter.Status -eq 'Up' -and $adapter.InterfaceDescription -match '^WireGuard Tunnel' -and
        $service.Status -eq 'Running' -and $correctRoute -and $correctAddress
}

function Get-TrustedPrivateTls {
    # Windows Schannel trust; no proxy, bearer, cookie store, CA override or insecure mode.
    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Join-Path $systemDirectory 'curl.exe'
    $start.Arguments = '--silent --show-error --noproxy "*" --connect-timeout 5 --max-time 10 --resolve source.aphrody.app:443:10.200.77.1 --output NUL --write-out "%{http_code}|%{remote_ip}" https://source.aphrody.app/api/v1/version'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (!$process.Start()) { return @{ trusted = $false; status = 'TLS_CLIENT_START_FAILED' } }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(12000)) {
            $process.Kill()
            $process.WaitForExit(1000) | Out-Null
            return @{ trusted = $false; status = 'TLS_TIMEOUT' }
        }
        $result = $stdout.GetAwaiter().GetResult().Trim()
        $stderr.GetAwaiter().GetResult() | Out-Null
        return @{ trusted = ($process.ExitCode -eq 0 -and $result -match '^\d{3}\|10\.200\.77\.1$'); status = ('CURL_EXIT_' + $process.ExitCode) }
    } finally { $process.Dispose() }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'NATIVE_WINDOWS_REQUIRED' }
    if (![Environment]::Is64BitProcess) { throw 'NATIVE_64BIT_WINDOWS_REQUIRED' }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $hostsPath = Join-Path $systemDirectory 'drivers\etc\hosts'
    Assert-HostsPath $hostsPath $systemDirectory
    $before = [IO.File]::ReadAllBytes($hostsPath)
    $proposal = Get-HostsProposal $before
    $routeQualified = Get-PrivateRoute
    $tls = if ($routeQualified) { Get-TrustedPrivateTls } else { @{ trusted = $false; status = 'PRIVATE_ROUTE_UNQUALIFIED' } }
    $allowed = $isAdmin -and $routeQualified -and $tls.trusted
    $result = @{ action = $Mode; hostname = $sourceHostname; address = $sourceAddress; isAdmin = $isAdmin;
        routeQualified = $routeQualified; tlsTrusted = $tls.trusted; tlsStatus = $tls.status;
        beforeSHA256 = $proposal.beforeHash; afterSHA256 = $proposal.afterHash; changeRequired = $proposal.changed;
        applyAllowed = $allowed; applied = $false }
    if ($Mode -eq 'apply') {
        if (!$allowed) { throw 'APPLY_REQUIRES_ADMIN_PRIVATE_ROUTE_TRUSTED_TLS' }
        # No backup, service/task activation, tunnel reconfiguration or DNS-adapter change.
        Assert-HostsPath $hostsPath $systemDirectory
        $handle = [IO.File]::Open($hostsPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            if ($handle.Length -gt 1048576) { throw 'HOSTS_SIZE_LIMIT' }
            $current = [byte[]]::new([int]$handle.Length)
            $offset = 0
            while ($offset -lt $current.Length) {
                $count = $handle.Read($current, $offset, $current.Length - $offset)
                if ($count -eq 0) { throw 'HOSTS_READ_INCOMPLETE' }
                $offset += $count
            }
            if ((Get-ByteHash $current) -ne $proposal.beforeHash) { throw 'HOSTS_CHANGED_BEFORE_WRITE' }
            if ($proposal.changed) {
                # Append only: pre-existing bytes and their ACL-bearing file remain untouched.
                $suffixLength = $proposal.after.Length - $current.Length
                $handle.Position = $handle.Length
                $handle.Write($proposal.after, $current.Length, $suffixLength)
                $handle.Flush($true)
            }
            $handle.Position = 0
            $verified = [byte[]]::new([int]$handle.Length)
            $offset = 0
            while ($offset -lt $verified.Length) {
                $count = $handle.Read($verified, $offset, $verified.Length - $offset)
                if ($count -eq 0) { throw 'HOSTS_VERIFY_INCOMPLETE' }
                $offset += $count
            }
            if ((Get-ByteHash $verified) -ne $proposal.afterHash) { throw 'HOSTS_WRITE_VERIFICATION_FAILED' }
            $result.applied = $true
        } finally { $handle.Dispose() }
    }
    $result | ConvertTo-Json -Compress
} catch {
    # Emit a bounded reason, never hosts contents, TLS response headers or identities.
    @{ action = $Mode; applied = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
