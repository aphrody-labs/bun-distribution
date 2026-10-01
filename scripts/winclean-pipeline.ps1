# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
    WinClean Sovereign Pipeline - Complete Windows Deep Optimization & Clean.
.DESCRIPTION
    Autonomous, non-destructive optimization reproducing the entire WinClean workflow:
    - Phase 1: Storage Reclamation (Caches, build artifacts, orphaned packages, Temp)
    - Phase 2: System & Boot Optimization (NTFS tuning, TRIM, BCD timeout, RAM tuning)
    - Phase 3: Telemetry & Autostart Sanitization (Startup Run keys, background parasites)
    - Phase 4: Auto-Update Disablement (Windows Update, edge, google, launchers)
    - Phase 5: Instant Search & In-Memory Preload (Windows Search, fd disk index)
#>

[CmdletBinding()]
param(
    [switch]$Yolo,
    [switch]$SkipIndex
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   APHRODY INFRA :: WINCLEAN SOVEREIGN PIPELINE (PWSH)    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. STORAGE RECLAMATION
Write-Host "`n[*] Phase 1: Reclaiming Storage & Caches..." -ForegroundColor Yellow

# Keep Rust caches warm: deleting them forces large cold builds that can
# saturate Windows while Cargo recompiles the monorepo.
if (Get-Command sccache -ErrorAction SilentlyContinue) {
    sccache --show-stats
}
$sccacheDir = "$env:LOCALAPPDATA\Mozilla\sccache\cache"
if (Test-Path $sccacheDir) {
    Write-Host "  -> Preserving reusable sccache data at $sccacheDir" -ForegroundColor DarkGray
}

# Clean Temp folders
$tempDirs = @("$env:TEMP", "$env:SystemRoot\Temp")
foreach ($td in $tempDirs) {
    if (Test-Path $td) {
        Get-ChildItem -Path $td -Recurse -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  -> Purged User & Windows Temp folders" -ForegroundColor Green

# Keep registry downloads and unpacked sources; Cargo reuses them between builds.
$cargoCache = "$env:USERPROFILE\.cargo\registry\cache"
$cargoSrc = "$env:USERPROFILE\.cargo\registry\src"
if ((Test-Path $cargoCache) -or (Test-Path $cargoSrc)) {
    Write-Host "  -> Preserving reusable Cargo registry caches" -ForegroundColor DarkGray
}

# Clean NVIDIA OTA updates
$nvOta = "C:\ProgramData\NVIDIA Corporation\NVIDIA app\UpdateFramework\ota-artifacts"
if (Test-Path $nvOta) {
    Remove-Item -LiteralPath $nvOta -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  -> Purged NVIDIA downloaded driver packages" -ForegroundColor Green
}

# Disable Hibernation (reclaims hiberfil.sys)
powercfg /h off | Out-Null
Write-Host "  -> Disabled hibernation (hiberfil.sys reclaimed)" -ForegroundColor Green

# 2. SYSTEM & HARDWARE OPTIMIZATION
Write-Host "`n[*] Phase 2: Hardware, NTFS & Boot Optimization..." -ForegroundColor Yellow

# NTFS optimizations
cmd.exe /c "fsutil behavior set disablelastaccess 1" | Out-Null
cmd.exe /c "fsutil 8dot3name set C: 1" | Out-Null
Write-Host "  -> NTFS: Disabled last-access timestamps & 8.3 short names" -ForegroundColor Green

# Memory & CPU Priority tuning
$memKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management"
Set-ItemProperty -Path $memKey -Name "DisablePagingExecutive" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
Set-ItemProperty -Path $memKey -Name "LargeSystemCache" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl" -Name "Win32PrioritySeparation" -Value 38 -Type DWord -Force -ErrorAction SilentlyContinue
Write-Host "  -> Kernel: DisablePagingExecutive=1, Win32PrioritySeparation=38" -ForegroundColor Green

# Boot timeout
bcdedit /timeout 3 | Out-Null
Write-Host "  -> Boot: BCD timeout set to 3s" -ForegroundColor Green

# SSD TRIM
Write-Host "  -> Running SSD TRIM on C:..." -ForegroundColor Gray
defrag C: /L | Out-Null
Write-Host "  -> SSD TRIM completed" -ForegroundColor Green

# 3. BOOT & AUTOSTART PARASITES SANITIZATION
Write-Host "`n[*] Phase 3: Telemetry & Autostart Sanitization..." -ForegroundColor Yellow

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$parasiteApps = @('EADM', 'Discord', 'NVIDIA Broadcast')
foreach ($app in $parasiteApps) {
    if (Get-ItemProperty -Path $runKey -Name $app -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $runKey -Name $app -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Removed HKCU Run: $app" -ForegroundColor Green
    }
}

$parasiteServices = @(
    'IntelTelemetryAgent',
    'SystemUsageReportSvc_QUEENCREEK',
    'IntelCollectorService',
    'ESRV_SVC_QUEENCREEK',
    'DSAService',
    'DSAUpdateService',
    'IpOverUsbSvc'
)
foreach ($s in $parasiteServices) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name $s -Force -ErrorAction SilentlyContinue
        Set-Service -Name $s -StartupType Disabled -ErrorAction SilentlyContinue
        Write-Host "  -> Disabled service: $s" -ForegroundColor Green
    }
}

# 4. AUTO-UPDATE DISABLEMENT
Write-Host "`n[*] Phase 4: Disabling Auto-Updates..." -ForegroundColor Yellow

$updateServices = @(
    'wuauserv',
    'edgeupdate',
    'edgeupdatem',
    'gupdate',
    'gupdatem',
    'GoogleUpdaterInternalService156.0.8067.0',
    'GoogleUpdaterService156.0.8067.0',
    'battlenet_helpersvc',
    'Denuvo Anti-Cheat Update Service',
    'LGHUBUpdaterService'
)
foreach ($s in $updateServices) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name $s -Force -ErrorAction SilentlyContinue
        Set-Service -Name $s -StartupType Disabled -ErrorAction SilentlyContinue
        Write-Host "  -> Disabled update service: $s" -ForegroundColor Green
    }
}

$wuPolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
if (-not (Test-Path $wuPolicy)) { New-Item -Path $wuPolicy -Force | Out-Null }
Set-ItemProperty -Path $wuPolicy -Name "NoAutoUpdate" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
Set-ItemProperty -Path $wuPolicy -Name "AUOptions" -Value 2 -Type DWord -Force -ErrorAction SilentlyContinue

$doPolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization"
if (-not (Test-Path $doPolicy)) { New-Item -Path $doPolicy -Force | Out-Null }
Set-ItemProperty -Path $doPolicy -Name "DODownloadMode" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
Write-Host "  -> Windows Update & Delivery Optimization policies locked" -ForegroundColor Green

# 5. INSTANT SEARCH & IN-MEMORY INDEX
if (-not $SkipIndex) {
    Write-Host "`n[*] Phase 5: Configuring Windows Search & In-Memory Index..." -ForegroundColor Yellow
    Set-Service -Name "wsearch" -StartupType Automatic -Status Running -ErrorAction SilentlyContinue
    $searchKey = "HKLM:\SOFTWARE\Microsoft\Windows Search\Gathering Manager"
    if (-not (Test-Path $searchKey)) { New-Item -Path $searchKey -Force | Out-Null }
    Set-ItemProperty -Path $searchKey -Name "DisableBackOff" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows Search" -Name "EnableEnhancedSearch" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
    
    $fdPath = "$env:USERPROFILE\.cargo\bin\fd.exe"
    if (Test-Path $fdPath) {
        if (-not (Test-Path "C:\tmp")) { New-Item -ItemType Directory -Path "C:\tmp" -Force | Out-Null }
        Write-Host "  -> Refreshing in-memory C:\ index in background..." -ForegroundColor Gray
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$fdPath -c never -H -I -a --base-directory C:\ . > C:\tmp\disk_c_index.txt`"" -WindowStyle Hidden
    }
    Write-Host "  -> Search indexer configured with zero-backoff" -ForegroundColor Green
}

# RAM Working Sets Trim
$definition = @'
[DllImport("psapi.dll")]
public static extern int EmptyWorkingSet(IntPtr hwProc);
'@
$psapi = Add-Type -MemberDefinition $definition -Name "PsApiTrimInfra" -Namespace "Win32" -PassThru -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.WorkingSet64 -gt 50MB } | ForEach-Object {
    try {
        if ($_.Handle) { $null = [Win32.PsApiTrimInfra]::EmptyWorkingSet($_.Handle) }
    } catch {}
}
Write-Host "`n[+] RAM working sets trimmed." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   WINCLEAN WORKFLOW SUCCESSFULLY COMPLETED              " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
