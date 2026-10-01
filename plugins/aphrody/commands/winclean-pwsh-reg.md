---
description: Read, write, or delete a Windows Registry value via PowerShell PSDrive (never reg.exe)
argument-hint: <get|set|list|delete> <HKLM:\...|HKCU:\...> [value-name] [value-data]
allowed-tools: PowerShell
---

Manipulate the Registry using PowerShell's native `HKLM:` / `HKCU:` PSDrives:

$ARGUMENTS

Read:

```powershell
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name ProductName, CurrentBuild
(Get-Item 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').GetValue('ProductName')
```

List subkeys:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
```

Write (requires elevation for HKLM):

```powershell
New-Item -Path 'HKCU:\Software\MyApp' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\MyApp' -Name 'Version' -Value '1.0' -Type String
```

Delete:

```powershell
Remove-ItemProperty -Path 'HKCU:\Software\MyApp' -Name 'Version'
Remove-Item -Path 'HKCU:\Software\MyApp' -Recurse
```

**Never** use `reg.exe` unless explicitly needed for a legacy batch script — the PSDrive cmdlets are typed and scriptable.
