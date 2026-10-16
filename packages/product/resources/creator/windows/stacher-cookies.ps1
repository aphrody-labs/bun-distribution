#Requires -Version 5.1
# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Diagnostique et contourne les blocages de cookies navigateur de yt-dlp (utilisé par Stacher).

.DESCRIPTION
  Cause (sources primaires, voir README) :
    1. Chrome/Edge/Brave (Chromium) ouvrent la base Network\Cookies en accès exclusif sous
       Windows tant qu'un processus du navigateur tourne, y compris en arrière-plan : yt-dlp
       échoue avec « Could not copy Chrome cookie database » (issue yt-dlp #7271, ouverte).
       Redémarrer le PC ou fermer TOUS les processus du navigateur lève le verrou.
    2. Chrome 127+ (et les navigateurs Chromium) chiffrent les nouveaux cookies avec
       « App-Bound Encryption » : yt-dlp échoue avec « Failed to decrypt with DPAPI »
       (issue #10927, ouverte). Fermer le navigateur n'y change rien.
    3. Firefox n'a pas ce chiffrement : yt-dlp copie cookies.sqlite, ce qui fonctionne en
       général navigateur ouvert. C'est le navigateur recommandé ici.
  Stacher est fermé : il ne peut pas être corrigé. Ce script évite le problème en amont : il
  produit un cookies.txt (format Netscape) à un chemin stable que vous donnez à Stacher.

  Modes (dry-run par défaut ; -Apply pour agir) :
    (aucun)/-Diagnose  lecture seule : yt-dlp, processus navigateur, bases de cookies, test de
                       verrou (lecture partagée = ce que fait yt-dlp, puis FileShare.None),
                       indice App-Bound, conclusions
    -Export            écrit le cookies.txt (yt-dlp --cookies-from-browser X --cookies fichier)
    -CloseBrowser      avec -Export : liste puis ferme proprement le navigateur ; -ForceKill pour
                       terminer les processus restants (explicite, perte possible d'état non
                       enregistré)
    -Schedule          tâche planifiée de rafraîchissement (Firefox uniquement)
    -Uninstall         supprime la tâche et les fichiers cookies/journal créés par le script

  Les valeurs des cookies ne sont JAMAIS affichées ni journalisées (comptes seulement). Le fichier
  est protégé par ACL pour l'utilisateur courant. cookies.txt équivaut à un accès à vos comptes :
  ne le partagez pas, ne le versionnez pas, supprimez-le quand vous n'en avez plus besoin.

.PARAMETER Browser         firefox (défaut), chrome, edge, brave.
.PARAMETER BrowserProfile  Profil yt-dlp (BROWSER:PROFILE).
.PARAMETER OutFile         Défaut : %LOCALAPPDATA%\Aphrody\creator-kit\cookies\cookies.txt
.PARAMETER YtDlpPath       yt-dlp.exe explicite (défaut : copie de Stacher dans ~\.stacher puis PATH).
.PARAMETER Domains         Ne conserve que ces domaines (suffixe), ex. youtube.com,google.com.
.PARAMETER EveryHours      Période du rafraîchissement planifié (1-168, défaut 6).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\stacher-cookies.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\stacher-cookies.ps1 -Export -Browser firefox -Domains youtube.com,google.com -Apply
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\stacher-cookies.ps1 -Schedule -EveryHours 6 -Domains youtube.com,google.com -Apply

.NOTES
  Écrit sous Linux : analysé syntaxiquement seulement. L'exécution sous Windows 11 n'a PAS
  été testée. La façon dont Stacher consomme un fichier cookies n'est PAS vérifiée. Voir README.md.
#>
[CmdletBinding()]
param(
    [ValidateSet('firefox', 'chrome', 'edge', 'brave')]
    [string]$Browser = 'firefox',
    [string]$BrowserProfile,
    [string]$OutFile,
    [string]$YtDlpPath,
    [string[]]$Domains,

    [switch]$Diagnose,
    [switch]$Export,
    [switch]$CloseBrowser,
    [switch]$ForceKill,
    [switch]$Schedule,
    [ValidateRange(1, 168)]
    [int]$EveryHours = 6,
    [switch]$Uninstall,
    [switch]$KeepFile,

    [switch]$Apply,
    [switch]$Quiet
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:SelfPath = $PSCommandPath
if (-not $script:SelfPath) { $script:SelfPath = $MyInvocation.MyCommand.Path }
$script:HomeDir = Join-Path $env:LOCALAPPDATA 'Aphrody\creator-kit\cookies'
$script:DefaultOut = Join-Path $script:HomeDir 'cookies.txt'
$script:LogFile = Join-Path $script:HomeDir 'refresh.log'
$script:BackupDir = Join-Path $env:LOCALAPPDATA 'Aphrody\creator-kit\backup'
$script:TaskFolder = '\Aphrody\'
$script:TaskName = 'Aphrody-Stacher-Cookies'
$script:Target = if ($OutFile) { $OutFile } else { $script:DefaultOut }

# --- Utilitaires -------------------------------------------------------------------------------
function Write-Info {
    param([string]$Message, [string]$Color = 'Gray')
    if ($Quiet) { Add-CookieLog -Message $Message; return }
    Write-Host $Message -ForegroundColor $Color
}

function Add-CookieLog {
    # Journal de la tâche planifiée : jamais de valeur de cookie, seulement des états et des comptes.
    param([string]$Message)
    try {
        $null = New-Item -ItemType Directory -Path $script:HomeDir -Force
        if ((Test-Path -LiteralPath $script:LogFile) -and (Get-Item -LiteralPath $script:LogFile).Length -gt 256KB) {
            $tail = Get-Content -LiteralPath $script:LogFile -Tail 100
            Set-Content -LiteralPath $script:LogFile -Value $tail -Encoding UTF8
        }
        Add-Content -LiteralPath $script:LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message) -Encoding UTF8
    }
    catch { Write-Verbose "Journal indisponible : $($_.Exception.Message)" }
}

function Assert-Windows {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Ce script ne fonctionne que sous Windows.' }
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1MB) { return ('{0:N1} Mo' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} Ko' -f ($Bytes / 1KB)) }
    return ('{0:N0} o' -f $Bytes)
}

function Split-NameList {
    param([string[]]$Value)
    return @($Value | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function ConvertTo-ArgString {
    param([string[]]$Arguments)
    $q = foreach ($a in $Arguments) {
        if ($a -match '[\s"]' -or $a -eq '') { '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' } else { $a }
    }
    return ($q -join ' ')
}

function Get-BrowserInfo {
    param([string]$Name)
    switch ($Name) {
        'firefox' { [pscustomobject]@{ Name = 'firefox'; Display = 'Firefox'; Process = 'firefox'; Chromium = $false; Root = (Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles') } }
        'chrome' { [pscustomobject]@{ Name = 'chrome'; Display = 'Google Chrome'; Process = 'chrome'; Chromium = $true; Root = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') } }
        'edge' { [pscustomobject]@{ Name = 'edge'; Display = 'Microsoft Edge'; Process = 'msedge'; Chromium = $true; Root = (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data') } }
        'brave' { [pscustomobject]@{ Name = 'brave'; Display = 'Brave'; Process = 'brave'; Chromium = $true; Root = (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data') } }
    }
}

function Get-CookieDatabase {
    # Chromium : <User Data>\<profil>\Network\Cookies ; Firefox : Profiles\<profil>\cookies.sqlite (chemins lus dans yt-dlp cookies.py).
    param($Info)
    if (-not (Test-Path -LiteralPath $Info.Root)) { return @() }
    $list = New-Object System.Collections.Generic.List[object]
    if ($Info.Chromium) {
        foreach ($d in (Get-ChildItem -LiteralPath $Info.Root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })) {
            $db = Join-Path $d.FullName 'Network\Cookies'
            if (Test-Path -LiteralPath $db) { $f = Get-Item -LiteralPath $db; $list.Add([pscustomobject]@{ Profile = $d.Name; Path = $db; LastWrite = $f.LastWriteTime; Size = $f.Length }) }
        }
    }
    else {
        foreach ($d in (Get-ChildItem -LiteralPath $Info.Root -Directory -ErrorAction SilentlyContinue)) {
            $db = Join-Path $d.FullName 'cookies.sqlite'
            if (Test-Path -LiteralPath $db) { $f = Get-Item -LiteralPath $db; $list.Add([pscustomobject]@{ Profile = $d.Name; Path = $db; LastWrite = $f.LastWriteTime; Size = $f.Length }) }
        }
    }
    return @($list.ToArray() | Sort-Object LastWrite -Descending)
}

function Test-CookieLock {
    # 1) lecture partagée (ReadWrite|Delete) : c'est ce dont a besoin la copie de yt-dlp ;
    # 2) FileShare.None : informatif (échoue dès qu'un autre processus a la base ouverte).
    param([string]$Path)
    $res = [ordered]@{ CanCopy = $false; ExclusiveFree = $false; Detail = '' }
    try {
        $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite,Delete'); $fs.Dispose(); $res.CanCopy = $true
    }
    catch [System.IO.IOException] { $res.Detail = 'violation de partage (un processus a la base ouverte en exclusif)' }
    catch [System.UnauthorizedAccessException] { $res.Detail = 'accès refusé' }
    if ($res.CanCopy) {
        try { $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'None'); $fs.Dispose(); $res.ExclusiveFree = $true }
        catch [System.IO.IOException] { $res.Detail = 'ouverte par un autre processus mais lisible en partage' }
    }
    [pscustomobject]$res
}

function Test-AppBound {
    # Indice : la clé « os_crypt.app_bound_encrypted_key » est présente dans Local State (nom lu dans le code Chromium). Contenu jamais lu ni affiché.
    param($Info)
    $ls = Join-Path $Info.Root 'Local State'
    if (-not (Test-Path -LiteralPath $ls)) { return $null }
    try {
        $t = [System.IO.File]::ReadAllText($ls)
        return [bool]($t -match '"app_bound_encrypted_key"\s*:')
    }
    catch { return $null }
}

function Get-BrowserProcess {
    param($Info)
    return @(Get-Process -Name $Info.Process -ErrorAction SilentlyContinue)
}

function Find-YtDlp {
    $cands = New-Object System.Collections.Generic.List[string]
    if ($YtDlpPath) { $cands.Add($YtDlpPath) }
    $stacher = Join-Path $env:USERPROFILE '.stacher'   # emplacement de la copie propre à Stacher (source secondaire : linuxadictos.com)
    if (Test-Path -LiteralPath $stacher) {
        foreach ($f in (Get-ChildItem -LiteralPath $stacher -Recurse -Depth 3 -File -Filter 'yt-dlp*.exe' -ErrorAction SilentlyContinue)) { $cands.Add($f.FullName) }
    }
    $cmd = Get-Command 'yt-dlp' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $cands.Add($cmd.Source) }
    foreach ($c in $cands) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) {
            $ver = $null
            try { $ver = (& $c --version 2>$null | Select-Object -First 1) } catch { Write-Verbose "yt-dlp --version : $($_.Exception.Message)" }
            return [pscustomobject]@{ Path = $c; Version = $ver; IsStacher = ($c -like "$stacher*") }
        }
    }
    return $null
}

function Invoke-YtDlp {
    param([string]$Exe, [string[]]$Arguments, [int]$TimeoutSeconds = 120)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = ConvertTo-ArgString -Arguments $Arguments
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
        try { $p.Kill() } catch { Write-Verbose "Kill : $($_.Exception.Message)" }
        throw "yt-dlp n'a pas terminé en $TimeoutSeconds s."
    }
    [void]$p.WaitForExit()
    [pscustomobject]@{ ExitCode = $p.ExitCode; Text = ($out.Result + "`n" + $err.Result) }
}

function Protect-PrivatePath {
    # DACL = utilisateur courant uniquement (héritage coupé). Pour un dossier : héritable par ses fichiers.
    param([string]$Path, [switch]$Container)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
    $inherit = if ($Container) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-ErrorHint {
    param([string]$Text)
    $h = New-Object System.Collections.Generic.List[string]
    if ($Text -match 'Could not copy Chrome cookie database') { $h.Add('Base de cookies Chromium verrouillée (yt-dlp #7271) : fermez TOUS les processus du navigateur (-CloseBrowser, voire -ForceKill) ou utilisez Firefox.') }
    if ($Text -match 'Failed to decrypt with DPAPI') { $h.Add('App-Bound Encryption (Chrome/Edge 127+, yt-dlp #10927) : fermer le navigateur ne sert à rien. Utilisez Firefox, ou exportez avec une extension (voir README).') }
    if ($Text -match 'could not find .* cookies database|FileNotFoundError') { $h.Add('Base de cookies introuvable : vérifiez -Browser et -BrowserProfile (profil le plus récent par défaut).') }
    if ($Text -match 'database is locked|OperationalError') { $h.Add('Base SQLite en cours d''écriture pendant la copie (hypothèse) : réessayez ; avec Firefox, fermez-le brièvement.') }
    if ($Text -match 'unsupported platform|sqlite3 support') { $h.Add('yt-dlp sans support sqlite3 : utilisez yt-dlp.exe officiel.') }
    return $h.ToArray()
}

# --- Diagnostic --------------------------------------------------------------------------------
function Invoke-Diagnose {
    $info = Get-BrowserInfo -Name $Browser
    Write-Info "== Diagnostic cookies ($($info.Display))" Cyan
    $yt = Find-YtDlp
    if ($yt) {
        Write-Info ("yt-dlp : {0} (version {1}){2}" -f $yt.Path, $(if ($yt.Version) { $yt.Version } else { 'inconnue' }), $(if ($yt.IsStacher) { ' [copie de Stacher]' } else { '' }))
    }
    else { Write-Info 'yt-dlp : INTROUVABLE (cherché dans ~\.stacher, PATH, -YtDlpPath). Installez-le depuis github.com/yt-dlp/yt-dlp/releases ou indiquez -YtDlpPath.' Yellow }

    $procs = Get-BrowserProcess -Info $info
    if ($procs.Count -gt 0) {
        $bg = @($procs | Where-Object { $_.MainWindowHandle -eq [IntPtr]::Zero }).Count
        Write-Info ("processus {0} : {1} en cours dont {2} sans fenêtre (arrière-plan : ils gardent la base verrouillée)" -f $info.Process, $procs.Count, $bg) Yellow
    }
    else { Write-Info ("processus {0} : aucun" -f $info.Process) }

    $dbs = @(Get-CookieDatabase -Info $info)
    if ($dbs.Count -eq 0) { Write-Info ("base de cookies : introuvable sous {0}" -f $info.Root) Yellow }
    $first = $true
    foreach ($d in $dbs) {
        $lock = Test-CookieLock -Path $d.Path
        $verdict = if ($lock.CanCopy) { 'copiable' } else { "BLOQUÉE ({0})" -f $lock.Detail }
        Write-Info ("  profil {0}{1} : {2}, {3}, modifiée {4:yyyy-MM-dd HH:mm}, {5}{6}" -f $d.Profile, $(if ($first) { ' (le plus récent : choisi par yt-dlp)' } else { '' }), $verdict, (Format-Size $d.Size), $d.LastWrite,
            $(if ($lock.CanCopy -and -not $lock.ExclusiveFree) { 'ouverte par un autre processus (lisible en partage)' } elseif ($lock.CanCopy) { 'aucun autre processus' } else { $d.Path }),
            '')
        if (-not $info.Chromium) {
            $wal = $d.Path + '-wal'
            if (Test-Path -LiteralPath $wal) {
                Write-Info ("    cookies.sqlite-wal : {0} : yt-dlp ne copie que cookies.sqlite (cookies.py) ; les cookies encore dans le WAL peuvent manquer tant que Firefox ne l'a pas fusionné (hypothèse tirée du code)." -f (Format-Size (Get-Item -LiteralPath $wal).Length))
            }
        }
        $first = $false
    }
    if ($info.Chromium) {
        $ab = Test-AppBound -Info $info
        if ($ab -eq $true) { Write-Info 'App-Bound Encryption : clé app_bound_encrypted_key PRÉSENTE : --cookies-from-browser échouera probablement (Failed to decrypt with DPAPI, yt-dlp #10927).' Yellow }
        elseif ($ab -eq $false) { Write-Info 'App-Bound Encryption : clé non trouvée dans Local State.' }
        else { Write-Info 'App-Bound Encryption : Local State illisible.' }
    }

    Write-Info '== Conclusions' Cyan
    if ($info.Chromium) {
        Write-Info '  - Chromium : (1) verrou tant que le navigateur (même en arrière-plan) tourne ; (2) App-Bound Encryption depuis Chrome 127. Le script ne peut lever que (1).'
        Write-Info '  - Recommandé : connectez-vous dans Firefox et lancez -Export -Browser firefox -Apply.'
        Write-Info '  - Réglages de fond à vérifier (libellés des navigateurs, non testés ici) : Chrome « Continue running background apps when Google Chrome is closed » ; Edge « Startup boost » et « Continue running background extensions and apps when Microsoft Edge is closed ».'
    }
    else {
        Write-Info '  - Firefox : pas d''App-Bound Encryption ; la copie de la base fonctionne en général navigateur ouvert (retours utilisateurs yt-dlp). Lancez -Export -Browser firefox -Apply.'
    }
    Write-Info '  - YouTube fait tourner les cookies des sessions ouvertes : le wiki yt-dlp conseille un export depuis une fenêtre privée (Extractors > Exporting YouTube cookies). Un cookies.txt issu d''une session normale peut donc expirer vite.'
    Write-Info ("  - Fichier cible : {0}. Stacher : voir README (utilisation d'un fichier cookies NON vérifiée)." -f $script:Target)
}

# --- Fermeture du navigateur ---------------------------------------------------------------------
function Invoke-CloseBrowser {
    param($Info)
    $procs = Get-BrowserProcess -Info $Info
    if ($procs.Count -eq 0) { Write-Info ("{0} n'est pas en cours d'exécution." -f $Info.Display); return }
    Write-Info ("Processus {0} à fermer :" -f $Info.Process) Yellow
    foreach ($p in $procs) {
        $title = ''
        try { $title = $p.MainWindowTitle } catch { $title = '' }
        Write-Info ("  PID {0}  {1}" -f $p.Id, $(if ($title) { "fenêtre « $title »" } else { '(sans fenêtre : arrière-plan)' }))
    }
    if (-not $Apply) { Write-Info '[dry-run] -CloseBrowser -Apply fermerait les fenêtres puis attendrait ; -ForceKill termine les restes.' Yellow; return }
    foreach ($p in $procs) { try { if ($p.MainWindowHandle -ne [IntPtr]::Zero) { [void]$p.CloseMainWindow() } } catch { Write-Verbose "CloseMainWindow : $($_.Exception.Message)" } }
    $deadline = (Get-Date).AddSeconds(15)
    do { Start-Sleep -Milliseconds 500; $left = Get-BrowserProcess -Info $Info } while ($left.Count -gt 0 -and (Get-Date) -lt $deadline)
    if ($left.Count -eq 0) { Write-Info 'Navigateur fermé.' Green; return }
    if (-not $ForceKill) {
        Write-Info ("{0} processus restent (probablement en arrière-plan). Fermez-les depuis la zone de notification, ou relancez avec -ForceKill (état non enregistré possiblement perdu)." -f $left.Count) Yellow
        return
    }
    foreach ($p in $left) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { Write-Info ("  PID {0} : {1}" -f $p.Id, $_.Exception.Message) Yellow } }
    Start-Sleep -Milliseconds 800
    $left = Get-BrowserProcess -Info $Info
    Write-Info $(if ($left.Count -eq 0) { 'Processus terminés (-ForceKill).' } else { "$($left.Count) processus ne se terminent pas." }) $(if ($left.Count -eq 0) { 'Green' } else { 'Yellow' })
}

# --- Export ------------------------------------------------------------------------------------
function Select-CookieDomain {
    # Filtre un cookies.txt Netscape en mémoire par suffixe de domaine ; renvoie le nouveau texte et les comptes (aucune valeur affichée).
    param([string]$Text, [string[]]$Keep)
    $lines = [regex]::Split($Text, '(?<=\n)')
    $sb = New-Object System.Text.StringBuilder
    $kept = 0; $dropped = 0
    foreach ($l in $lines) {
        if ($l -eq '') { continue }
        $trim = $l.TrimEnd("`r", "`n")
        $isCookie = ($trim -ne '') -and ($trim -notmatch '^#' -or $trim -match '^#HttpOnly_') -and ($trim -split "`t").Count -ge 7
        if (-not $isCookie) { [void]$sb.Append($l); continue }
        $dom = ($trim -split "`t")[0] -replace '^#HttpOnly_', ''
        $dom = $dom.TrimStart('.').ToLowerInvariant()
        $match = $false
        foreach ($k in $Keep) { $kk = $k.TrimStart('.').ToLowerInvariant(); if ($dom -eq $kk -or $dom.EndsWith('.' + $kk)) { $match = $true; break } }
        if ($match) { [void]$sb.Append($l); $kept++ } else { $dropped++ }
    }
    [pscustomobject]@{ Text = $sb.ToString(); Kept = $kept; Dropped = $dropped }
}

function Get-CookieCount {
    param([string]$Text)
    $n = 0
    foreach ($l in ($Text -split "`n")) {
        $t = $l.TrimEnd("`r")
        if ($t -ne '' -and ($t -notmatch '^#' -or $t -match '^#HttpOnly_') -and ($t -split "`t").Count -ge 7) { $n++ }
    }
    return $n
}

function Invoke-Export {
    $info = Get-BrowserInfo -Name $Browser
    $yt = Find-YtDlp
    if (-not $yt) { throw 'yt-dlp introuvable (cherché dans ~\.stacher, PATH, -YtDlpPath).' }
    $keep = @(Split-NameList $Domains)
    $spec = if ($BrowserProfile) { '{0}:{1}' -f $Browser, $BrowserProfile } else { $Browser }
    $tmpDir = Join-Path $script:HomeDir '.tmp'
    $tmp = Join-Path $tmpDir ('cookies-{0}.txt' -f [Guid]::NewGuid().ToString('N'))
    $ytArgs = @('--cookies-from-browser', $spec, '--cookies', $tmp)

    Write-Info '== Export cookies.txt' Cyan
    Write-Info ("  yt-dlp  : {0} ({1})" -f $yt.Path, $(if ($yt.Version) { $yt.Version } else { 'version inconnue' }))
    Write-Info ("  commande: yt-dlp {0}   (sans URL : yt-dlp écrit le fichier puis sort avec le code 2 « You must provide at least one URL », attendu ; FAQ yt-dlp)" -f ($ytArgs -join ' '))
    Write-Info ("  cible   : {0}  (ACL utilisateur courant uniquement ; version précédente gardée en .prev)" -f $script:Target)
    Write-Info ("  domaines: {0}" -f $(if ($keep.Count) { $keep -join ', ' } else { 'TOUS les cookies du profil (utilisez -Domains pour limiter l''exposition)' }))
    if ($info.Chromium) {
        Write-Info ("  AVERTISSEMENT : {0} est Chromium : verrou de base et App-Bound Encryption possibles (voir -Diagnose). Firefox est recommandé." -f $info.Display) Yellow
    }
    Write-Info '  AVERTISSEMENT : cookies.txt donne accès à vos comptes. Ne le partagez pas, ne le versionnez pas, supprimez-le après usage.' Yellow
    if ($CloseBrowser) { Invoke-CloseBrowser -Info $info }
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour exécuter yt-dlp et écrire le fichier.' Yellow; return }

    $null = New-Item -ItemType Directory -Path $script:HomeDir -Force
    $ownDir = ((Split-Path -Parent $script:Target) -eq $script:HomeDir)
    if ($ownDir) { Protect-PrivatePath -Path $script:HomeDir -Container }
    $null = New-Item -ItemType Directory -Path $tmpDir -Force
    try {
        $r = Invoke-YtDlp -Exe $yt.Path -Arguments $ytArgs
        $keyLines = @($r.Text -split "[`r`n]+" | Where-Object { $_ -match 'Extracting cookies|Extracted \d+ cookies|ERROR|WARNING|Could not copy|Failed to decrypt' -and $_ -notmatch 'You must provide at least one URL' } | Select-Object -Unique)
        foreach ($k in $keyLines) { Write-Info ("  yt-dlp> {0}" -f $k) }
        $ok = (Test-Path -LiteralPath $tmp) -and ((Get-Item -LiteralPath $tmp).Length -gt 0)
        if (-not $ok) {
            foreach ($h in (Get-ErrorHint -Text $r.Text)) { Write-Info ("  -> {0}" -f $h) Yellow }
            throw ("Aucun cookies.txt produit (code de sortie yt-dlp {0})." -f $r.ExitCode)
        }
        $text = [System.IO.File]::ReadAllText($tmp)
        if ($text -notmatch '^\s*#\s*(Netscape )?HTTP Cookie File') { throw 'Le fichier produit n''a pas l''en-tête Netscape attendu ; abandon (rien n''est remplacé).' }
        $total = Get-CookieCount -Text $text
        if ($keep.Count -gt 0) {
            $f = Select-CookieDomain -Text $text -Keep $keep
            $text = $f.Text
            Write-Info ("  filtre domaines : {0} cookies conservés, {1} écartés" -f $f.Kept, $f.Dropped)
            $total = $f.Kept
        }
        if ($total -eq 0) { throw 'Aucun cookie utilisable après extraction/filtrage ; rien n''est remplacé.' }
        [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
        Protect-PrivatePath -Path $tmp
        $targetDir = Split-Path -Parent $script:Target
        $null = New-Item -ItemType Directory -Path $targetDir -Force
        if (Test-Path -LiteralPath $script:Target) { Move-Item -LiteralPath $script:Target -Destination ($script:Target + '.prev') -Force }
        Move-Item -LiteralPath $tmp -Destination $script:Target
        Protect-PrivatePath -Path $script:Target
        if (Test-Path -LiteralPath ($script:Target + '.prev')) { Protect-PrivatePath -Path ($script:Target + '.prev') }
        Write-Info ("OK : {0} cookies écrits dans {1} ({2})" -f $total, $script:Target, (Format-Size (Get-Item -LiteralPath $script:Target).Length)) Green
        if (-not $Quiet) {
            Write-Info ("Stacher : dans ses réglages, cherchez une option de fichier cookies ou d'arguments personnalisés (« Custom Arguments ») et utilisez --cookies `"{0}`" ; retirez toute option « cookies from browser » équivalente. Non vérifié : l'interface de Stacher n'a pas pu être consultée." -f $script:Target)
        }
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

# --- Planification -----------------------------------------------------------------------------
function Save-TaskBackup {
    $existing = Get-ScheduledTask -TaskName $script:TaskName -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
    if (-not $existing) { return $null }
    $null = New-Item -ItemType Directory -Path $script:BackupDir -Force
    $file = Join-Path $script:BackupDir ('{0}-{1:yyyyMMdd-HHmmss}.xml' -f $script:TaskName, (Get-Date))
    $xml = Export-ScheduledTask -TaskName $script:TaskName -TaskPath $script:TaskFolder
    [System.IO.File]::WriteAllText($file, $xml, (New-Object System.Text.UTF8Encoding($false)))
    return $file
}

function Invoke-Schedule {
    if ($Browser -ne 'firefox') { throw 'La planification n''est acceptée qu''avec -Browser firefox : Chromium exige un navigateur fermé et échoue avec App-Bound Encryption, et la tâche ne ferme jamais le navigateur.' }
    if (-not $script:SelfPath) { throw 'Chemin du script introuvable : exécutez-le depuis un fichier .ps1.' }
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $script:SelfPath), '-Export', '-Apply', '-Quiet', '-Browser', $Browser)
    if ($BrowserProfile) { $a += @('-BrowserProfile', ('"{0}"' -f $BrowserProfile)) }
    if ($OutFile) { $a += @('-OutFile', ('"{0}"' -f $OutFile)) }
    if ($YtDlpPath) { $a += @('-YtDlpPath', ('"{0}"' -f $YtDlpPath)) }
    $keep = @(Split-NameList $Domains)
    if ($keep.Count) { $a += @('-Domains', ('"{0}"' -f ($keep -join ','))) }
    $argLine = $a -join ' '
    Write-Info '== Plan -Schedule' Cyan
    Write-Info ("  tâche    : {0}{1} : à l'ouverture de session (+60 s) puis toutes les {2} h, masquée, utilisateur courant" -f $script:TaskFolder, $script:TaskName, $EveryHours)
    Write-Info ("  commande : {0} {1}" -f $psExe, $argLine)
    Write-Info ("  journal  : {0} (états et comptes seulement)" -f $script:LogFile)
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour enregistrer la tâche.' Yellow; return }
    $backup = Save-TaskBackup
    if ($backup) { Write-Info "Tâche existante sauvegardée : $backup" }
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
    try { $logon.Delay = 'PT60S' } catch { Write-Warning "Délai non appliqué : $($_.Exception.Message)" }
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $EveryHours) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited   # S4U : pas de station de fenêtres, donc aucune console visible
    $reg = @{
        TaskName = $script:TaskName; TaskPath = $script:TaskFolder; Action = $action; Trigger = @($logon, $repeat)
        Settings = $settings; Principal = $principal; Force = $true; Description = 'Aphrody creator-kit : rafraîchit cookies.txt pour yt-dlp/Stacher (Firefox)'
    }
    try { $null = Register-ScheduledTask @reg }
    catch {
        if ($_.Exception.Message -match 'denied|refus|0x80070005') { throw 'Accès refusé : relancez PowerShell en administrateur (non vérifié : certains déclencheurs d''ouverture de session l''exigent).' }
        throw
    }
    Write-Info "Tâche installée. Test immédiat : Start-ScheduledTask -TaskPath '$($script:TaskFolder)' -TaskName '$($script:TaskName)'. Retrait : -Uninstall -Apply." Green
}

function Invoke-UninstallTask {
    $existing = Get-ScheduledTask -TaskName $script:TaskName -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
    $files = @($script:Target, ($script:Target + '.prev'), $script:LogFile) | Where-Object { Test-Path -LiteralPath $_ }
    Write-Info '== Plan -Uninstall' Cyan
    Write-Info ("  tâche : {0}" -f $(if ($existing) { 'présente : exportée (XML) puis supprimée' } else { 'absente' }))
    if ($KeepFile) { Write-Info '  fichiers : conservés (-KeepFile)' }
    else { foreach ($f in $files) { Write-Info ("  supprimer : {0}" -f $f) } }
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour appliquer.' Yellow; return }
    if ($existing) {
        $backup = Save-TaskBackup
        Unregister-ScheduledTask -TaskName $script:TaskName -TaskPath $script:TaskFolder -Confirm:$false
        Write-Info "Tâche supprimée. Sauvegarde XML : $backup" Green
    }
    if (-not $KeepFile) {
        foreach ($f in $files) { Remove-Item -LiteralPath $f -Force; Write-Info ("supprimé : {0}" -f $f) Green }
    }
}

# --- Point d'entrée ----------------------------------------------------------------------------
try {
    Assert-Windows
    $modes = @($Diagnose.IsPresent, $Export.IsPresent, $Schedule.IsPresent, $Uninstall.IsPresent) | Where-Object { $_ }
    if (@($modes).Count -gt 1) { throw 'Un seul mode à la fois : -Diagnose, -Export, -Schedule ou -Uninstall.' }
    if ($CloseBrowser -and -not $Export) { throw '-CloseBrowser s''utilise avec -Export.' }
    if ($ForceKill -and -not $CloseBrowser) { throw '-ForceKill s''utilise avec -CloseBrowser.' }
    if ($Export) { Invoke-Export }
    elseif ($Schedule) { Invoke-Schedule }
    elseif ($Uninstall) { Invoke-UninstallTask }
    else { Invoke-Diagnose }
}
catch {
    if ($Quiet) { Add-CookieLog ('ERREUR : ' + $_.Exception.Message); exit 1 }
    throw
}
