---
description: Run a CIM/WMI query — always Get-CimInstance, never the deprecated Get-WmiObject or wmic
argument-hint: <Win32_Class> [Field1,Field2,...]
allowed-tools: PowerShell
---

Execute a CIM query using `Get-CimInstance` (the modern replacement for `Get-WmiObject` and `wmic`):

$ARGUMENTS

Common classes:

- `Win32_OperatingSystem` — OS version, uptime, install date
- `Win32_ComputerSystem` — manufacturer, model, RAM, domain
- `Win32_Processor` — CPU details
- `Win32_LogicalDisk` — drives with free space
- `Win32_Process` — running processes (richer than Get-Process for path/commandline)
- `Win32_Service` — services with full detail
- `CIM_NetworkAdapter` / `MSFT_NetAdapter` — network interfaces

Example:

```powershell
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
    Select-Object DeviceID, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}}, @{N='TotalGB';E={[math]::Round($_.Size/1GB,1)}}
```

**Never** use `Get-WmiObject` (removed in PowerShell 7+) or `wmic` (deprecated in Windows 11).
