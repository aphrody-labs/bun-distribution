# SPDX-License-Identifier: Apache-2.0
# Apply tools/config/wsl/wslconfig and give the free space of the WSL disk back to C:.
# `wsl --shutdown` stops every WSL process, so it runs unattended at a quiet hour: the Windows scheduled task
# AphrodyWslReclaim (registered from WSL, copy in C:\ProgramData\Aphrody) runs it once; the log is next to it.
$ErrorActionPreference = 'Stop'
Start-Transcript -Path "$env:ProgramData\Aphrody\wsl-reclaim.log" -Append | Out-Null
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
# Bring the user services back (kernel, web, timers) by keeping the distro running.
Start-Process wsl.exe -ArgumentList '-d', $distro, '--exec', 'sleep', 'infinity' -WindowStyle Hidden
Stop-Transcript | Out-Null
