<#
.SYNOPSIS
    wslg-manager.ps1 - Windows Host Inspector and Orchestrator for WSLg and COSMIC Epoch
.DESCRIPTION
    Inspects host-side WSLg state, msrdc.exe processes, RDP RAIL windows, GPU passthrough,
    and provides launch helpers for seamless or full desktop COSMIC sessions.
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet("Status", "Windows", "Gpu", "Desktop", "Json")]
    [string]$Action = "Status",

    [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"

function Get-WslgHostInfo {
    $installPath = "C:\Program Files\WSL"
    $systemVhd = Join-Path $installPath "system.vhd"
    $msrdcExe = Join-Path $installPath "msrdc.exe"
    $wslgRdp = Join-Path $installPath "wslg.rdp"
    $desktopRdp = Join-Path $installPath "wslg_desktop.rdp"

    $msrdcProc = Get-Process -Name "msrdc" -ErrorAction SilentlyContinue | Select-Object -First 1
    $wslService = Get-Process -Name "wslservice" -ErrorAction SilentlyContinue | Select-Object -First 1

    [PSCustomObject]@{
        Installed         = (Test-Path $msrdcExe)
        InstallPath       = $installPath
        SystemVhdExists   = (Test-Path $systemVhd)
        SystemVhdSizeMb   = if (Test-Path $systemVhd) { [math]::Round((Get-Item $systemVhd).Length / 1MB, 2) } else { 0 }
        MsrdcRunning      = ($null -ne $msrdcProc)
        MsrdcPid          = if ($msrdcProc) { $msrdcProc.Id } else { $null }
        MsrdcWorkingSetMb = if ($msrdcProc) { [math]::Round($msrdcProc.WorkingSet64 / 1MB, 2) } else { 0 }
        WslServiceRunning = ($null -ne $wslService)
        WslServicePid     = if ($wslService) { $wslService.Id } else { $null }
        WslgRdpExists     = (Test-Path $wslgRdp)
        DesktopRdpExists  = (Test-Path $desktopRdp)
    }
}

function Show-Status {
    Write-Host "`n=== 1. État de l'Hôte WSLg (Windows) ===" -ForegroundColor Cyan
    $info = Get-WslgHostInfo
    Write-Host "  Chemin d'installation : $($info.InstallPath)"
    Write-Host "  Image System VHD      : $(if ($info.SystemVhdExists) { "[OK] $($info.SystemVhdSizeMb) Mo" } else { "[MANQUANT]" })"
    Write-Host "  Client RDP (msrdc)    : $(if ($info.MsrdcRunning) { "[ACTIF] PID $($info.MsrdcPid) ($($info.MsrdcWorkingSetMb) Mo RAM)" } else { "[INACTIF]" })"
    Write-Host "  Service WSL           : $(if ($info.WslServiceRunning) { "[ACTIF] PID $($info.WslServicePid)" } else { "[INACTIF]" })"

    Write-Host "`n=== 2. Pilote Graphique Hôte (DirectX / Vulkan) ===" -ForegroundColor Cyan
    Get-CimInstance Win32_VideoController | ForEach-Object {
        Write-Host "  Carte Graphique  : $($_.Name)"
        Write-Host "  Version Pilote   : $($_.DriverVersion)"
        Write-Host "  Processeur Vidéo : $($_.VideoProcessor)"
    }

    Write-Host "`n=== 3. Profils de Connexion RDP WSLg ===" -ForegroundColor Cyan
    Write-Host "  Mode RAIL/VAIL (Applications individuelles) : $($info.WslgRdpExists)"
    Write-Host "  Mode Bureau Complet (Session graphique)     : $($info.DesktopRdpExists)"
}

function Show-Windows {
    Write-Host "`n=== Fenêtres Graphiques WSLg Actives sur le Bureau Windows ===" -ForegroundColor Cyan
    $msrdcProc = Get-Process -Name "msrdc" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $msrdcProc) {
        Write-Host "  Aucun processus msrdc.exe en cours d'exécution." -ForegroundColor Yellow
        return
    }

    $windows = Get-Process -Name "msrdc" | Where-Object { $_.MainWindowHandle -ne 0 }
    if ($windows.Count -eq 0) {
        Write-Host "  Processus msrdc.exe actif (PID $($msrdcProc.Id)), aucune fenêtre principale active au premier plan."
    } else {
        $windows | ForEach-Object {
            Write-Host "  HWND: $($_.MainWindowHandle) | Titre: '$($_.MainWindowTitle)' | PID: $($_.Id)"
        }
    }
}

function Show-Gpu {
    Write-Host "`n=== Analyse Accélération Graphique Hôte / Invité ===" -ForegroundColor Cyan
    Get-CimInstance Win32_VideoController | Format-Table Name, DriverVersion, AdapterRAM, Status -AutoSize
    
    Write-Host "Interrogation du statut WSLg côté invité ($Distro)..."
    $guestScript = (wsl.exe -d $Distro -e wslpath -a ($PSScriptRoot -replace '\\', '/')).Trim() + '/wslg-manager.sh'
    wsl.exe -d $Distro -e /bin/bash $guestScript gpu
}

function Start-FullDesktop {
    Write-Host "`n=== Lancement de la Session Bureau Complet COSMIC / WSLg ===" -ForegroundColor Cyan
    $desktopRdp = "C:\Program Files\WSL\wslg_desktop.rdp"
    if (-not (Test-Path $desktopRdp)) {
        Write-Error "Fichier $desktopRdp introuvable."
        return
    }

    Write-Host "Démarrage de mstsc.exe avec le profil $desktopRdp..."
    Start-Process "mstsc.exe" -ArgumentList "`"$desktopRdp`""
}

switch ($Action) {
    "Status"  { Show-Status }
    "Windows" { Show-Windows }
    "Gpu"     { Show-Gpu }
    "Desktop" { Start-FullDesktop }
    "Json"    { Get-WslgHostInfo | ConvertTo-Json -Depth 3 }
}
