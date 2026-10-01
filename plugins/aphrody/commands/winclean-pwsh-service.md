---
description: Query or control a Windows service (status / start / stop / restart)
argument-hint: <service-name> <status|start|stop|restart|enable|disable>
allowed-tools: PowerShell
---

Manage a Windows service using **PowerShell-native cmdlets** (never `sc.exe` or `net.exe`):

$ARGUMENTS

Cmdlets to use:

- `Get-Service <name>` — status
- `Start-Service <name>` / `Stop-Service <name>` / `Restart-Service <name>` — state change
- `Set-Service <name> -StartupType Automatic|Manual|Disabled` — configure
- `Get-CimInstance Win32_Service -Filter "Name='<name>'"` — richer detail (PID, path, account)

Start/Stop/Restart require elevation. If not elevated, report clearly rather than silently failing.
