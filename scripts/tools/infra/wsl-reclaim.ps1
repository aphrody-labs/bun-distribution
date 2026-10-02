# SPDX-License-Identifier: Apache-2.0
# Apply config/wsl/wslconfig and give the free space of the WSL disk back to C:.
# Run from Windows PowerShell when no agent session is working: `wsl --shutdown` stops every WSL process.
#   powershell -ExecutionPolicy Bypass -File \\wsl$\Ubuntu-24.04\home\aphro\aphrody\scripts\tools\infra\wsl-reclaim.ps1
$ErrorActionPreference = 'Stop'
$distro = 'Ubuntu-24.04'
$vhd = Get-ChildItem "$env:LOCALAPPDATA\wsl" -Recurse -Filter ext4.vhdx | Sort-Object Length -Descending | Select-Object -First 1
$before = [math]::Round($vhd.Length / 1GB)
wsl.exe --shutdown
# Existing disks stay dense even with sparseVhd=true in .wslconfig; this converts the distro disk once.
wsl.exe --manage $distro --set-sparse true
# Start the distro and trim: every free ext4 block is released to C:.
wsl.exe -d $distro -u root -- fstrim -v /
$after = [math]::Round((Get-Item $vhd.FullName).Length / 1GB)
"ext4.vhdx: $before GiB -> $after GiB; C: free: $([math]::Round((Get-PSDrive C).Free / 1GB)) GiB"
