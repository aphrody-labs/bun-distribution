# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$config = Join-Path $env:ProgramData 'ssh\sshd_config'
$sshd = Join-Path $env:SystemRoot 'System32\OpenSSH\sshd.exe'
$address = '10.200.77.10'
if (!(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue)) {
    throw 'The Omar private tunnel address is absent; refusing another host.'
}
$original = [IO.File]::ReadAllText($config)
$match = [regex]::Match($original, '(?im)^\s*Match\s+')
$global = if ($match.Success) { $original.Substring(0, $match.Index) } else { $original }
$matches = if ($match.Success) { $original.Substring($match.Index) } else { '' }
$global = [regex]::Replace($global, '(?im)^\s*ListenAddress\s+[^\r\n]*(\r?\n|$)', '')
$candidate = $global.TrimEnd() + "`r`nListenAddress 0.0.0.0`r`n" + $matches
# Keep authentication and Match rules; firewall confines the wildcard to the private interface.
foreach ($name in 'OpenSSH-Server-In-TCP', 'Omar-Server-Mesh') {
    $rule = Get-NetFirewallRule -Name $name -ErrorAction Stop
    $port = $rule | Get-NetFirewallPortFilter
    if ($rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or
        $port.Protocol -ne 'TCP' -or ($name -eq 'OpenSSH-Server-In-TCP' -and $port.LocalPort -ne '22')) {
        throw "Unexpected firewall rule contract: $name"
    }
}
$meshSources = @((Get-NetFirewallRule -Name 'Omar-Server-Mesh' | Get-NetFirewallAddressFilter).RemoteAddress)
if ($meshSources.Count -ne 1 -or $meshSources[0] -notin @('10.200.77.0/24', '10.200.77.0/255.255.255.0')) {
    throw 'Unexpected mesh source network; refusing to broaden SSH access.'
}
if (!$Apply) {
    [pscustomobject]@{
        HostAddress = $address
        Listener = '0.0.0.0:22 (survives tunnel startup/restart)'
        Firewall = 'Private local address only; owner key route and existing VPN mesh sources'
        Service = 'sshd Automatic, failure recovery, restart after config validation'
    }
    return
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator rights are required.'
}
$staged = Join-Path (Split-Path $config) ('sshd-check-' + [guid]::NewGuid().ToString('N'))
try {
    [IO.File]::WriteAllText($staged, $candidate, [Text.UTF8Encoding]::new($false))
    & $sshd -t -f $staged
    if ($LASTEXITCODE -ne 0) { throw 'Candidate sshd configuration is invalid.' }
    # Restrict the existing broad rule before enabling the persistent wildcard listener.
    Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Get-NetFirewallAddressFilter |
        Set-NetFirewallAddressFilter -LocalAddress $address -RemoteAddress '10.200.77.4' > $null
    $mesh = Get-NetFirewallRule -Name 'Omar-Server-Mesh'
    $meshPorts = $mesh | Get-NetFirewallPortFilter
    $sshMesh = Get-NetFirewallRule -Name 'Aphrody-Omar-SSH-Mesh' -ErrorAction SilentlyContinue
    if (!$sshMesh) {
        New-NetFirewallRule -Name 'Aphrody-Omar-SSH-Mesh' -DisplayName 'Aphrody Omar SSH (private mesh)' `
            -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $address `
            -RemoteAddress $meshSources -Profile Any > $null
    } else {
        $sshMesh | Get-NetFirewallAddressFilter |
            Set-NetFirewallAddressFilter -LocalAddress $address -RemoteAddress $meshSources > $null
        $sshMesh | Enable-NetFirewallRule > $null
    }
    $remainingPorts = @($meshPorts.LocalPort | Where-Object { $_ -ne '22' })
    if ($remainingPorts.Count -eq 0) { throw 'Expected the existing multi-port Omar mesh rule.' }
    if (@($meshPorts.LocalPort) -contains '22') {
        $meshPorts | Set-NetFirewallPortFilter -LocalPort $remainingPorts > $null
    }
    [IO.File]::WriteAllText($config, $candidate, [Text.UTF8Encoding]::new($false))
    Set-Service -Name sshd -StartupType Automatic
    & "$env:SystemRoot\System32\sc.exe" failure sshd reset= 86400 actions= restart/10000/restart/30000/restart/60000
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure sshd recovery.' }
    Restart-Service -Name sshd
    Get-NetTCPConnection -State Listen -LocalPort 22 | Select-Object LocalAddress,LocalPort
} finally {
    Remove-Item -LiteralPath $staged -ErrorAction SilentlyContinue
}
