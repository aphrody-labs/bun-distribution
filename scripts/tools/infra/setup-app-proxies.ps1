# setup-app-proxies.ps1 — Configure US Proxy routing STRICTLY for: Gemini App, AGY CLI, and AGY Desktop
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$proxyUrl = "socks5://127.0.0.1:1080"
$proxySocks5h = "socks5h://127.0.0.1:1080"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " ROUTAGE PROXY US STRICT (VPS 127.0.0.1:1080)" -ForegroundColor Cyan
Write-Host " Cibles exclusives : Gemini App | AGY CLI | AGY Desktop" -ForegroundColor Cyan
Write-Host " (Tout le reste du système reste en connexion directe)" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Détection des exécutables
$chromeCandidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$agCandidates = @(
    "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe",
    "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe",
    "$env:ProgramFiles\Antigravity\Antigravity.exe"
)
$agPath = $agCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$agyCandidates = @(
    "$env:LOCALAPPDATA\agy\bin\agy.exe",
    (Get-Command agy.exe -ErrorAction SilentlyContinue).Source
)
$agyPath = $agyCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$desktopPath = [Environment]::GetFolderPath('Desktop')
$startMenuPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

$ws = New-Object -ComObject WScript.Shell

# 2. Nettoyage de l'ancien raccourci Chrome générique (pour ne pas proxifier tout Chrome)
foreach ($dir in @($desktopPath, $startMenuPath)) {
    $oldLnk = Join-Path $dir "Google Chrome (US Proxy).lnk"
    if (Test-Path $oldLnk) {
        Remove-Item $oldLnk -Force -ErrorAction SilentlyContinue
        Write-Host "[-] Supprimé : $oldLnk (Chrome général reste direct)" -ForegroundColor Gray
    }
}

# 3. Raccourci DÉDIÉ : Gemini App (US Proxy)
# Utilise le mode --app de Chrome avec un profil dédié pour ne pas impacter les autres onglets Chrome
if ($chromePath) {
    Write-Host "[+] Google Chrome disponible pour Gemini App : $chromePath" -ForegroundColor Green
    $geminiDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\GeminiApp"
    
    foreach ($dir in @($desktopPath, $startMenuPath)) {
        if (Test-Path $dir) {
            $lnkPath = Join-Path $dir "Gemini App (US Proxy).lnk"
            $lnk = $ws.CreateShortcut($lnkPath)
            $lnk.TargetPath = $chromePath
            $lnk.Arguments = "--app=https://gemini.google.com/app --proxy-server=`"$proxyUrl`" --user-data-dir=`"$geminiDataDir`""
            $lnk.IconLocation = "$chromePath,0"
            $lnk.Description = "Google Gemini App via VPS US SOCKS5 Proxy ($proxyUrl)"
            $lnk.WorkingDirectory = [System.IO.Path]::GetDirectoryName($chromePath)
            $lnk.Save()
            Write-Host "    -> Raccourci créé : $lnkPath" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[-] Chrome non trouvé pour encapsuler Gemini App." -ForegroundColor Yellow
}

# 4. Raccourci DÉDIÉ : AGY Desktop (Antigravity 2)
if ($agPath) {
    Write-Host "[+] AGY Desktop (Antigravity 2) détecté : $agPath" -ForegroundColor Green
    
    foreach ($dir in @($desktopPath, $startMenuPath)) {
        if (Test-Path $dir) {
            $lnkPath = Join-Path $dir "AGY Desktop (US Proxy).lnk"
            $lnk = $ws.CreateShortcut($lnkPath)
            $lnk.TargetPath = $agPath
            $lnk.Arguments = "--proxy-server=`"$proxyUrl`""
            $lnk.IconLocation = "$agPath,0"
            $lnk.Description = "Antigravity Desktop via VPS US SOCKS5 Proxy ($proxyUrl)"
            $lnk.WorkingDirectory = [System.IO.Path]::GetDirectoryName($agPath)
            $lnk.Save()
            Write-Host "    -> Raccourci créé : $lnkPath" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[-] AGY Desktop (Antigravity) non trouvé." -ForegroundColor Yellow
}

# 5. Raccourci & Intégration : AGY CLI
if ($agyPath) {
    Write-Host "[+] AGY CLI détecté : $agyPath" -ForegroundColor Green
    Write-Host "    -> Routage automatique assuré par 'aphrody agy' ou 'agy-us'." -ForegroundColor Gray
}

# 6. Lanceurs console (~/.cargo/bin)
$cargoBin = "$env:USERPROFILE\.cargo\bin"
if (Test-Path $cargoBin) {
    # Nettoyage de l'ancien chrome-us.cmd
    $oldCmd = Join-Path $cargoBin "chrome-us.cmd"
    if (Test-Path $oldCmd) { Remove-Item $oldCmd -Force -ErrorAction SilentlyContinue }

    # gemini-us.cmd
    if ($chromePath) {
        $geminiCmd = "@echo off`r`nstart `"`" `"$chromePath`" --app=https://gemini.google.com/app --proxy-server=`"$proxyUrl`" --user-data-dir=`"$env:LOCALAPPDATA\Google\Chrome\User Data\GeminiApp`" %*"
        Set-Content -Path (Join-Path $cargoBin "gemini-us.cmd") -Value $geminiCmd -Encoding ASCII
        Write-Host "[+] Commande console : gemini-us" -ForegroundColor Green
    }

    # agy-desktop-us.cmd / antigravity-us.cmd
    if ($agPath) {
        $agCmd = "@echo off`r`nstart `"`" `"$agPath`" --proxy-server=`"$proxyUrl`" %*"
        Set-Content -Path (Join-Path $cargoBin "agy-desktop-us.cmd") -Value $agCmd -Encoding ASCII
        Set-Content -Path (Join-Path $cargoBin "antigravity-us.cmd") -Value $agCmd -Encoding ASCII
        Write-Host "[+] Commande console : agy-desktop-us" -ForegroundColor Green
    }

    # agy-us.cmd
    $agyCmd = "@echo off`r`naphrody agy --us-proxy %*"
    Set-Content -Path (Join-Path $cargoBin "agy-us.cmd") -Value $agyCmd -Encoding ASCII
    Write-Host "[+] Commande console : agy-us" -ForegroundColor Green
}

Write-Host "`n======================================================" -ForegroundColor Cyan
Write-Host " STRICT FOCUS RÉALISÉ AVEC SUCCÈS" -ForegroundColor Cyan
Write-Host " 1. Gemini App   -> Fenêtre PWA dédiée avec proxy US" -ForegroundColor Green
Write-Host " 2. AGY CLI      -> Ingestion SOCKS5 US automatique" -ForegroundColor Green
Write-Host " 3. AGY Desktop  -> Client IDE sous proxy US" -ForegroundColor Green
Write-Host " (Tout navigateur Chrome normal ou autre app reste 100% direct)" -ForegroundColor White
Write-Host "======================================================" -ForegroundColor Cyan
