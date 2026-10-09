#Requires -Version 7.2
#Requires -RunAsAdministrator
# SPDX-License-Identifier: Apache-2.0
<# Keeps a Windows tunnel member (Omar's PC by default) reachable without anyone at the keyboard: self-healing
scheduled tasks under \Aphrody\ for the wg1 tunnel (boot, SYSTEM), the remote desktop + VNC, the MCP HTTP server,
the reverse SSH tunnel to the hub (fallback while wg1 has no handshake) and the WSL Ubuntu sshd (port 2222), plus
power settings that stop the PC from sleeping. Every task repeats every 5 minutes with IgnoreNew, so a crashed or
disconnected process comes back on its own. Idempotent: re-running replaces the tasks with the same definitions.
Secrets are never read or printed here: tokens and keys stay in <aphrody home>\private and ~/.ssh.
Runbook: docs/operations/infra/OMAR-REMOTE-CONTROL.md (section 2.10).
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Member = 'omar',
    [string]$Address = '10.200.77.10',
    [string]$Hub = '51.77.147.152',
    [string]$HubUser = 'omar',
    [string]$Distro = 'Ubuntu',
    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$Aphrody = (Join-Path $env:LOCALAPPDATA 'Aphrody\bin\aphrody.exe'),
    [switch]$NoWsl,
    [switch]$NoReverse,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'install-always-online requires native Windows.' }
if (-not [Net.IPAddress]::TryParse($Address, [ref]$null)) { throw 'Address must be a literal IP address.' }
$mcp = Join-Path (Split-Path $Aphrody) 'aphrody-mcp.exe'
foreach ($exe in @($Aphrody, $mcp)) { if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe (install Aphrody first)." } }
$aphrodyHome = if ($env:APHRODY_HOME) { $env:APHRODY_HOME } else { Join-Path $env:USERPROFILE '.aphrody' }
$logs = Join-Path $aphrodyHome 'logs'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskPath = '\Aphrody\'

function Register-AphrodyTask {
    param([string]$Name, [string]$Execute, [string]$Arguments, [ValidateSet('Boot', 'Logon')][string]$At, [switch]$System)
    $action = New-ScheduledTaskAction -Execute $Execute -Argument $Arguments
    $start = if ($At -eq 'Boot') { New-ScheduledTaskTrigger -AtStartup } else { New-ScheduledTaskTrigger -AtLogOn -User $user }
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
    $principal = if ($System) { New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest }
    else { New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest }
    if ($DryRun) { Write-Output "plan: $taskPath$Name [$At$(if ($System) { ', SYSTEM' })] $Execute $Arguments"; return }
    Register-ScheduledTask -TaskPath $taskPath -TaskName $Name -Action $action -Trigger @($start, $repeat) -Settings $settings `
        -Principal $principal -Description 'Aphrody always-online (scripts/tools/infra/install-always-online.ps1)' -Force | Out-Null
    Start-ScheduledTask -TaskPath $taskPath -TaskName $Name
    Write-Output "task: $taskPath$Name"
}

if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }

# 1. No sleep, no hibernation on mains power: an asleep PC drops wg1 and every service.
if ($DryRun) { Write-Output 'plan: powercfg standby/hibernate 0 (AC), hibernate off' }
else {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change hibernate-timeout-ac 0 | Out-Null
    powercfg /hibernate off | Out-Null
}

# 2. wg1 tunnel at boot as SYSTEM, before any logon. WireGuardNT lives with this process: the task keeps it alive.
$wgLog = Join-Path $logs 'wg.log'
Register-AphrodyTask -Name "Aphrody WG $Member" -At Boot -System -Execute "$env:SystemRoot\System32\cmd.exe" `
    -Arguments "/d /c `"set APHRODY_HOME=$aphrodyHome&& `"$Aphrody`" infra wg up $Member --name aphrody >> `"$wgLog`" 2>&1`""

# 3. Remote desktop (8795) + VNC (5900) in the interactive session (screen capture needs the desktop).
Register-AphrodyTask -Name 'Aphrody Remote Desktop' -At Logon -Execute $Aphrody -Arguments "infra remote serve --bind ${Address}:8795"

# 4. MCP HTTP (computer_* WinClean) on loopback, published on the tunnel address by a persistent portproxy.
$mcpEnv = Join-Path $aphrodyHome 'private\mcp-http.env'
$mcpArgs = 'http --bind 127.0.0.1:8793' + $(if (Test-Path -LiteralPath $mcpEnv) { " --env-file `"$mcpEnv`"" } else { '' })
Register-AphrodyTask -Name 'Aphrody MCP HTTP' -At Logon -Execute $mcp -Arguments $mcpArgs
if ($DryRun) { Write-Output "plan: portproxy ${Address}:8793 -> 127.0.0.1:8793" }
else {
    netsh interface portproxy delete v4tov4 listenaddress=$Address listenport=8793 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=$Address listenport=8793 connectaddress=127.0.0.1 connectport=8793 | Out-Null
    Set-Service iphlpsvc -StartupType Automatic; Start-Service iphlpsvc
}

# 5. Reverse SSH tunnel to the hub: the owner reaches this PC through the vps loopback even without a wg1 handshake.
if (-not $NoReverse) {
    $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
    $forwards = @('22010:127.0.0.1:22', '28795:127.0.0.1:8795', '28793:127.0.0.1:8793', '22011:127.0.0.1:2222', '25900:127.0.0.1:5900') |
        ForEach-Object { "-R 127.0.0.1:$_" }
    Register-AphrodyTask -Name "Aphrody $Member reverse" -At Logon -Execute $ssh -Arguments (@(
            '-N', '-o BatchMode=yes', '-o ExitOnForwardFailure=yes', '-o ServerAliveInterval=30', '-o ServerAliveCountMax=3',
            '-o StrictHostKeyChecking=accept-new', "-i `"$IdentityFile`"") + $forwards + "$HubUser@$Hub" -join ' ')
}

# 6. WSL Ubuntu: mirrored networking (reachable on the tunnel address), sshd on 2222 kept running with the VM.
if (-not $NoWsl -and (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    $wslConfig = Join-Path $env:USERPROFILE '.wslconfig'
    $text = if (Test-Path -LiteralPath $wslConfig) { Get-Content -LiteralPath $wslConfig -Raw } else { '' }
    $wanted = [ordered]@{ networkingMode = 'mirrored'; firewall = 'false' }
    $missing = $wanted.Keys | Where-Object { $text -notmatch "(?m)^\s*$_\s*=" }
    if ($missing) {
        if ($DryRun) { Write-Output "plan: .wslconfig add $($missing -join ', ') (then wsl --shutdown)" }
        else {
            if ($text -notmatch '(?m)^\[wsl2\]') { $text = $text.TrimEnd() + "`n[wsl2]`n" }
            $lines = ($missing | ForEach-Object { "$_=$($wanted[$_])" }) -join "`n"
            $text = $text -replace '(?m)^\[wsl2\]\s*$', "[wsl2]`n$lines"
            Set-Content -LiteralPath $wslConfig -Value $text.TrimEnd() -Encoding utf8NoBOM
            wsl.exe --shutdown
        }
    }
    Register-AphrodyTask -Name 'Aphrody WSL sshd' -At Logon -Execute "$env:SystemRoot\System32\wsl.exe" `
        -Arguments "-d $Distro -u root -- sh -c `"service ssh status >/dev/null 2>&1 || service ssh start; exec sleep infinity`""
}

if ($DryRun) { return }
Start-Sleep -Seconds 10
Get-ScheduledTask -TaskPath $taskPath | ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    '{0,-28} {1,-8} last={2}' -f $_.TaskName, $_.State, $info.LastTaskResult
}
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -in 22, 2222, 5900, 8793, 8795 | Sort-Object LocalPort |
    ForEach-Object { 'listen {0}:{1}' -f $_.LocalAddress, $_.LocalPort }
