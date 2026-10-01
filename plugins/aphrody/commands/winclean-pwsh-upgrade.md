---
description: Upgrade all winget packages silently (use with caution — system-wide)
argument-hint: "[--exclude=<id1,id2>]"
allowed-tools: PowerShell
---

Run `winget upgrade --all` with all the silent/accept flags via the `PowerShell` tool.

Steps:

1. **List first** — show what would upgrade:

   ```powershell
   winget upgrade --accept-source-agreements
   ```

   If `winget` is not in PATH (common when bash spawns PowerShell), locate it:

   ```powershell
   (Get-AppxPackage Microsoft.DesktopAppInstaller).InstallLocation + '\winget.exe'
   ```

   and call via `& $winget …`.

2. **Ask the user** which packages to exclude before proceeding (Docker Desktop from msstore and any app currently running may fail or prompt).

3. **Run the upgrade** in background (long-running):

   ```powershell
   & $winget upgrade --all --silent --accept-package-agreements --accept-source-agreements --disable-interactivity --include-unknown
   ```

4. **Report** the final status — packages upgraded vs failed.

User request / scope: $ARGUMENTS
