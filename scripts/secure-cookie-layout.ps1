[CmdletBinding()]
param([string]$AphrodyHome = (Join-Path $env:USERPROFILE '.aphrody'))
$ErrorActionPreference = 'Stop'
$CookieDir = Join-Path $AphrodyHome 'cookies'

New-Item -ItemType Directory -Force -Path $CookieDir | Out-Null
$resolved = (Resolve-Path -LiteralPath $CookieDir).Path
$acl = Get-Acl -LiteralPath $resolved
$acl.SetAccessRuleProtection($true, $false)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $resolved -AclObject $acl
[Environment]::SetEnvironmentVariable('BXC_COOKIES_DIR', $resolved, 'User')
[Environment]::SetEnvironmentVariable('APHRODY_HOME', $AphrodyHome, 'User')
$env:BXC_COOKIES_DIR = $resolved
Write-Output "APHRODY_HOME=$AphrodyHome"
Write-Output "BXC_COOKIES_DIR=$resolved"
Write-Output 'Cookie values were not read or copied.'
