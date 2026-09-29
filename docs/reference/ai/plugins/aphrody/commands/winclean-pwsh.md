---
description: Run an arbitrary PowerShell command via the PowerShell tool
argument-hint: <powershell-expression>
allowed-tools: PowerShell
---

Run the following PowerShell command using the `PowerShell` tool (not `Bash`):

$ARGUMENTS

If the command prints raw objects or too much data, pipe to `Format-Table -AutoSize` or `Select-Object -First 50` for readability. Report the result concisely.
