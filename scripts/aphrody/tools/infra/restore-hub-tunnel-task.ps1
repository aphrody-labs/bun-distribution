# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runner = Join-Path $repository 'scripts\tools\infra\hub-tunnel-service.ts'
$bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
$taskPath = '\Aphrody\Native\'
$taskName = 'hub-tunnel'
$task = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
if (!(Test-Path -LiteralPath $runner) -or !(Test-Path -LiteralPath $bun)) {
    throw 'Qualified tunnel runner or installed Bun is missing.'
}
if (!$Apply) {
    [pscustomobject]@{
        Task = $taskPath + $taskName
        Executable = $bun
        Runner = $runner
        WorkingDirectory = $repository
        Principal = $task.Principal.UserId
        LogonType = 'S4U'
        Action = 'Preserve triggers and recovery; register the owned hidden tunnel; start it'
    }
    return
}
$identity = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator elevation is required for the existing task S4U principal.'
}
Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName
# Retire only this tunnel's orphaned SSH children, never another SSH session.
$ownedPids = @(Get-NetTCPConnection -State Listen | Where-Object {
    $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -in 24888, 24889
} | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($ownedPid in $ownedPids) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedPid"
    if ($process.Name -ne 'ssh.exe' -or
        $process.CommandLine -notlike '*127.0.0.1:24888:127.0.0.1:23888*' -or
        $process.CommandLine -notlike '*127.0.0.1:24889:127.0.0.1:23889*') {
        throw 'An unrelated process owns a tunnel port; refusing to stop it.'
    }
    Stop-Process -Id $ownedPid
}
$action = New-ScheduledTaskAction -Execute $bun -Argument ('--no-env-file "' + $runner + '"') -WorkingDirectory $repository
# S4U runs without an interactive console or a stored password, under the same owner.
$principal = New-ScheduledTaskPrincipal -UserId $task.Principal.UserId -LogonType S4U -RunLevel Limited
Set-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Principal $principal | Out-Null
Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null
Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Select-Object TaskName, State
