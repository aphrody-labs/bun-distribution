# SPDX-License-Identifier: Apache-2.0
# Single owner of "a scheduled task that never shows a window" for every PowerShell script of the repository.
# A visible console comes from the session, not from the command line: -WindowStyle Hidden still flashes. So:
#   * SYSTEM (ServiceAccount) and S4U principals run without a window station: no window can exist;
#   * a task that needs the interactive desktop (-Desktop: screen capture, tray) runs Interactive and its console
#     program is wrapped in `conhost.exe --headless`, so the console is never created on screen;
#   * Settings.Hidden is always set.
# The same policy is enforced for catalog tasks by `aphrody infra boot` (crates/infra/infra/src/boot.rs).
#Requires -Version 5.1
Set-StrictMode -Version Latest

function New-AphrodyTaskAction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Execute,
        [string]$Argument,
        [string]$WorkingDirectory,
        # Interactive-session task: wrap the program in a headless console host.
        [switch]$Desktop
    )
    $p = @{ Execute = $Execute }
    if ($Argument) { $p.Argument = $Argument }
    if ($WorkingDirectory) { $p.WorkingDirectory = $WorkingDirectory }
    if ($Desktop) {
        $inner = if ($Argument) { '"{0}" {1}' -f $Execute.Trim('"'), $Argument } else { '"{0}"' -f $Execute.Trim('"') }
        $p.Execute = Join-Path $env:SystemRoot 'System32\conhost.exe'
        $p.Argument = "--headless $inner"
    }
    New-ScheduledTaskAction @p
}

function New-AphrodyTaskPrincipal {
    [CmdletBinding()]
    param(
        # Run as LocalSystem (session 0).
        [switch]$System,
        # Needs the interactive desktop; otherwise the current user runs S4U (whether logged on or not, no window).
        [switch]$Desktop,
        [ValidateSet('Highest', 'Limited')][string]$RunLevel = 'Limited',
        [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    )
    if ($System) { return New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest }
    $logon = if ($Desktop) { 'Interactive' } else { 'S4U' }
    New-ScheduledTaskPrincipal -UserId $User -LogonType $logon -RunLevel $RunLevel
}

function Register-AphrodyHiddenTask {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$TaskPath = '\Aphrody\',
        [Parameter(Mandatory)][string]$Execute,
        [string]$Argument,
        [string]$WorkingDirectory,
        [Parameter(Mandatory)][Microsoft.Management.Infrastructure.CimInstance[]]$Trigger,
        [switch]$System,
        [switch]$Desktop,
        [ValidateSet('Highest', 'Limited')][string]$RunLevel = 'Limited',
        [string]$Description = 'Aphrody',
        [TimeSpan]$ExecutionTimeLimit = [TimeSpan]::Zero,
        # Restart after a failure (long-running tasks).
        [switch]$Restart,
        [switch]$Start
    )
    $action = New-AphrodyTaskAction -Execute $Execute -Argument $Argument -WorkingDirectory $WorkingDirectory -Desktop:$Desktop
    $set = @{
        Hidden = $true; StartWhenAvailable = $true; MultipleInstances = 'IgnoreNew'
        AllowStartIfOnBatteries = $true; DontStopIfGoingOnBatteries = $true; ExecutionTimeLimit = $ExecutionTimeLimit
    }
    if ($Restart) { $set.RestartCount = 999; $set.RestartInterval = New-TimeSpan -Minutes 1 }
    $settings = New-ScheduledTaskSettingsSet @set
    $principal = New-AphrodyTaskPrincipal -System:$System -Desktop:$Desktop -RunLevel $RunLevel
    if (-not $PSCmdlet.ShouldProcess("$TaskPath$Name", 'Register hidden scheduled task')) { return }
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings `
        -Principal $principal -Description $Description -Force | Out-Null
    if ($Start) { Start-ScheduledTask -TaskPath $TaskPath -TaskName $Name }
}

# Starts a console child without any window: shares the (headless or window-less) console of the caller.
function Start-AphrodyHiddenProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory,
        [switch]$PassThru
    )
    $p = @{ FilePath = $FilePath; NoNewWindow = $true; PassThru = $PassThru.IsPresent }
    if ($ArgumentList.Count) { $p.ArgumentList = $ArgumentList }
    if ($WorkingDirectory) { $p.WorkingDirectory = $WorkingDirectory }
    Start-Process @p
}

Export-ModuleMember -Function New-AphrodyTaskAction, New-AphrodyTaskPrincipal, Register-AphrodyHiddenTask, Start-AphrodyHiddenProcess
