# SPDX-License-Identifier: Apache-2.0
# Persistent loopback transport to the authorized Omar browser gateway.
$ErrorActionPreference = 'Stop'
$taskPath = '\Aphrody\'
$taskName = 'Aphrody Omar Browser'
$ssh = 'C:\Program Files\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $ssh)) { throw 'OpenSSH client is missing' }
$arguments = '-N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:9223:127.0.0.1:9233 omar-pc'
$action = New-ScheduledTaskAction -Execute $ssh -Argument $arguments -WorkingDirectory 'C:\Users\aphro'
$triggers = @(New-ScheduledTaskTrigger -AtStartup; New-ScheduledTaskTrigger -AtLogOn -User 'APHRODY\aphro')
$principal = New-ScheduledTaskPrincipal -UserId 'APHRODY\aphro' -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Authorized SSH transport to Omar Bun browser gateway; loopback only.' -Force | Out-Null
Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Select-Object TaskName,State | ConvertTo-Json -Compress
