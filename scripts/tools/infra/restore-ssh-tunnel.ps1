# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$AphrodyHome = (Join-Path $env:USERPROFILE '.aphrody'),
    [string]$WireGuardExe = 'C:\Program Files\WireGuard\wireguard.exe'
)

$ErrorActionPreference = 'Stop'
$config = Join-Path $AphrodyHome 'wireguard\aphrody.conf'
$keyFile = Join-Path $AphrodyHome 'wireguard\aphrody.key'
$serviceName = 'WireGuardTunnel$aphrody'
if (!(Test-Path -LiteralPath $WireGuardExe) -or !(Test-Path -LiteralPath $config)) {
    throw 'WireGuard executable or protected aphrody.conf is missing.'
}
$text = [IO.File]::ReadAllText($config)
if ($text -notmatch '(?m)^Address\s*=\s*10\.200\.77\.4/(24|32)\s*$' -or
    $text -notmatch '(?m)^AllowedIPs\s*=\s*10\.200\.77\.0/24\s*$') {
    throw 'Expected the owner workstation split tunnel; refusing another configuration.'
}
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (!$Apply) {
    [pscustomobject]@{
        Service = $serviceName
        Installed = [bool]$service
        Config = $config
        Action = 'Install if absent; Automatic startup; restart on failure; start tunnel'
    }
    return
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator elevation is required to install the tunnel service.'
}
if (!$service) {
    # Keep the key in its existing protected store; never put it in argv or output.
    $acl = Get-Acl -LiteralPath $config
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in 'S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'Allow')
        $acl.SetAccessRule($rule)
    }
    Set-Acl -LiteralPath $config -AclObject $acl
    if ($text -notmatch '(?m)^PrivateKey\s*=') {
        $key = [IO.File]::ReadAllText($keyFile).Trim()
        if ($key -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Invalid protected WireGuard key.' }
        $text = $text.Replace('[Interface]', "[Interface]`r`nPrivateKey = $key")
        [IO.File]::WriteAllText($config, $text, [Text.UTF8Encoding]::new($false))
        $key = $null
        $text = $null
    }
    $install = Start-Process -FilePath $WireGuardExe -ArgumentList @('/installtunnelservice', ('"' + $config + '"')) -WindowStyle Hidden -PassThru
    if (!$install.WaitForExit(15000)) { throw 'WireGuard service installer exceeded 15 seconds; inspect service state before retrying.' }
    if ($install.ExitCode -ne 0) { throw "WireGuard service installer failed ($($install.ExitCode))." }
}
Set-Service -Name $serviceName -StartupType Automatic
& "$env:SystemRoot\System32\sc.exe" failure $serviceName reset= 86400 actions= restart/5000/restart/5000/restart/60000
if ($LASTEXITCODE -ne 0) { throw 'Could not configure tunnel service recovery.' }
Start-Service -Name $serviceName
Get-Service -Name $serviceName | Select-Object Name, Status, StartType
