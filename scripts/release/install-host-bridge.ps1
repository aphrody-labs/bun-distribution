# SPDX-License-Identifier: Apache-2.0
#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
Install the native Aphrody Hyper-V host service and session companion.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Distribution,
    [string]$Root = 'C:\ProgramData\Aphrody\Host',
    [uint32]$Port = 47651,
    [uint32]$DesktopPort = 47652
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) { throw 'Native service binary is missing.' }
if ($Port -eq 0 -or $DesktopPort -eq 0 -or $Port -eq $DesktopPort) { throw 'Ports must be distinct and positive.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$account = $identity.Name
$sid = $identity.User.Value
New-Item -ItemType Directory -Path $Root -Force | Out-Null
# Keep the privileged binary and token outside writable source checkouts.
& icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${sid}:(OI)(CI)RX" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict host directory permissions.' }
$destination = Join-Path $Root 'aphrody-host-service.exe'
$service = Get-Service -Name AphrodyHost -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') { Stop-Service -Name AphrodyHost; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
Stop-ScheduledTask -TaskName AphrodyDesktopBridge -ErrorAction SilentlyContinue
$companions = Get-Process -Name aphrody-host-service -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $destination }
foreach ($companion in $companions) {
    Stop-Process -Id $companion.Id -Force
    if (-not $companion.WaitForExit(30000)) { throw 'Previous host process did not exit.' }
}
Copy-Item -LiteralPath $Binary -Destination $destination -Force
$authPath = Join-Path $Root 'auth.json'
if (Test-Path -LiteralPath $authPath) {
    $token = (Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json).principals[0].token
} else {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    @{principals=@(@{id='wsl-bridge';token=$token;toolPrefixes=@('*');registerSubsystems=$true;publishEvents=$true})} |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $authPath -Encoding UTF8
}
# Rust's JSON reader requires UTF-8 without a Windows PowerShell BOM.
$utf8 = New-Object Text.UTF8Encoding($false)
function Write-PrivateJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8)
}
Write-PrivateJson $authPath @{principals=@(@{id='wsl-bridge';token=$token;toolPrefixes=@('*');registerSubsystems=$true;publishEvents=$true})}
$hostConfig = Join-Path $Root 'host.json'
$desktopConfig = Join-Path $Root 'desktop.json'
Write-PrivateJson $hostConfig @{port=$Port;authFile=$authPath;peer='windows';localEndpoint='\\.\pipe\aphrody-host';logFile=(Join-Path $Root 'host.log')}
Write-PrivateJson $desktopConfig @{port=$DesktopPort;authFile=$authPath;peer='desktop';localEndpoint='\\.\pipe\aphrody-desktop';logFile=(Join-Path $Root 'desktop.log')}
Write-PrivateJson (Join-Path $Root 'linux-windows.json') @{port=$Port;token=$token;peer='windows'}
Write-PrivateJson (Join-Path $Root 'linux-desktop.json') @{port=$DesktopPort;token=$token;peer='desktop'}
foreach ($number in @($Port, $DesktopPort)) {
    $guid = '{0:x8}-facb-11e6-bd58-64006a7986d3' -f $number
    $key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Virtualization\GuestCommunicationServices\$guid"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name ElementName -Value 'Aphrody native host bridge' -PropertyType String -Force | Out-Null
}
$command = '"{0}" --config "{1}"' -f $destination, $hostConfig
if (-not $service) { New-Service -Name AphrodyHost -BinaryPathName $command -DisplayName 'Aphrody native host' -StartupType Automatic | Out-Null }
else {
    & sc.exe config AphrodyHost binPath= $command start= auto | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Service configuration failed.' }
}
& sc.exe failure AphrodyHost reset= 86400 actions= restart/1000/restart/5000/restart/10000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service recovery configuration failed.' }
& sc.exe failureflag AphrodyHost 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service failure recovery configuration failed.' }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$desktopAction = New-ScheduledTaskAction -Execute $destination -Argument ('--config "{0}" --console' -f $desktopConfig)
$desktopPrincipal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName AphrodyDesktopBridge -Action $desktopAction -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $account) -Principal $desktopPrincipal -Settings $settings -Force | Out-Null
# WSL distributions belong to a Windows user, not LocalSystem. S4U lets the
# registered owner start the guest at boot without storing a password here.
$wslExecutable = Join-Path $env:ProgramFiles 'WSL\wsl.exe'
if (-not (Test-Path -LiteralPath $wslExecutable)) { $wslExecutable = Join-Path $env:SystemRoot 'System32\wsl.exe' }
$bootScript = Join-Path $Root 'start-wsl.ps1'
# Task Scheduler/cmd quoting can change distribution argv. A protected script
# preserves literal arguments and returns WSL's exit status to the scheduler.
$bootContent = "& '{0}' --distribution '{1}' --exec /bin/sleep infinity *> '{2}'`nexit `$LASTEXITCODE`n" -f $wslExecutable.Replace("'", "''"), $Distribution.Replace("'", "''"), (Join-Path $Root 'wsl-boot.log').Replace("'", "''")
[IO.File]::WriteAllText($bootScript, $bootContent, $utf8)
$wslAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $bootScript)
$bootPrincipal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName AphrodyWslBoot -Action $wslAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $bootPrincipal -Settings $settings -Force | Out-Null
Start-Service -Name AphrodyHost
Start-ScheduledTask -TaskName AphrodyDesktopBridge
Start-ScheduledTask -TaskName AphrodyWslBoot
Get-Service -Name AphrodyHost | Select-Object Name, Status, StartType
Get-ScheduledTask -TaskName AphrodyDesktopBridge,AphrodyWslBoot | Select-Object TaskName,State
