---
description: Run one command elevated (UAC) and wait; use when a non-admin shell gets Access denied.
argument-hint: <powershell-command>
allowed-tools: PowerShell, Write, Read
---

Run **$ARGUMENTS** elevated.

## Pattern

Check if already elevated:

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

If **already elevated**, run the command directly in the PowerShell tool.

If **not elevated**, write the command to a temp script and relaunch elevated, waiting for completion:

```powershell
$script = @'
<the command(s)>
'@
$tmp = Join-Path $env:TEMP ("elev-" + [Guid]::NewGuid().ToString('N') + ".ps1")
Set-Content -Path $tmp -Value $script -Encoding UTF8
try {
    Start-Process pwsh -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', $tmp -Verb RunAs -Wait
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
```

## Notes

- `Start-Process -Verb RunAs` triggers Windows UAC. The user accepts or declines. There is no programmatic bypass without pre-granted tokens or disabling UAC system-wide.
- `-Wait` blocks until the elevated process exits, so you can read its output file if you redirected stdout/stderr inside `$script`.
- For multi-line commands with complex quoting, always use a here-string `@'...'@` (literal) or `@"..."@` (interpolated) to avoid escape hell.
- Capture elevated output by redirecting inside `$script`:
  ```powershell
  $script = @'
  <command> *> "$env:TEMP\elev-out.txt"
  '@
  ```
  Then read it back in the non-elevated shell after `-Wait` returns.
