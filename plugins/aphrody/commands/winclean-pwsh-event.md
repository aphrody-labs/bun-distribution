---
description: Query the Windows Event Log via Get-WinEvent (never Get-EventLog, which is legacy)
argument-hint: <LogName> [max-events] [--id=<N>] [--level=Error|Warning|Information]
allowed-tools: PowerShell
---

Query the Windows Event Log with `Get-WinEvent`:

$ARGUMENTS

Patterns:

```powershell
# Most recent System errors
Get-WinEvent -LogName System -MaxEvents 50 |
    Where-Object { $_.LevelDisplayName -eq 'Error' }

# By event ID across multiple logs (fast — uses FilterHashtable server-side)
Get-WinEvent -FilterHashtable @{ LogName='Application'; Id=1000,1001; StartTime=(Get-Date).AddHours(-1) }

# Recent crashes
Get-WinEvent -FilterHashtable @{ LogName='Application'; ProviderName='Application Error' } -MaxEvents 20

# Full detail for one event
Get-WinEvent -LogName System -MaxEvents 1 | Select-Object -Property * | Format-List
```

**Prefer `-FilterHashtable` over pipeline `Where-Object`** — it filters server-side and is 10-100× faster on large logs.

**Never** use `Get-EventLog` (legacy, misses newer logs like `Microsoft-Windows-*`).
