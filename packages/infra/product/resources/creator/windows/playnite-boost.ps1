#Requires -Version 5.1
# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Playnite : démarrage avec Windows (tâche planifiée), raccourci clavier global et audit/optimisation.

.DESCRIPTION
  Arguments de ligne de commande utilisés (TOUS vérifiés dans CmdLineOptions.cs et la doc
  « Application arguments » de Playnite, 2026-10-06) :
    --hidesplashscreen  --nolibupdate  --startdesktop  --startfullscreen  --startclosedtotray
  Les noms --skiplibupdate, --safemode et --clearcache N'EXISTENT PAS ; les vrais sont
  --nolibupdate, --safestartup et --clearwebcache.

  Playnite est mono-instance (mutex + canal nommé) : relancer l'exécutable sans argument
  demande à l'instance existante de se restaurer/prendre le focus (CheckOtherInstances dans
  PlayniteApplication.cs). Le lanceur à raccourci clavier s'appuie sur ce mécanisme, donc il ne
  crée jamais de deuxième instance.

  Réglage natif équivalent : « Launch Playnite when you start your computer » (+ « Start closed
  to tray ») crée Playnite.lnk dans le dossier Démarrage avec --hidesplashscreen. Si ce réglage
  est actif en même temps que -StartupTask, le script le signale (double lancement inoffensif
  grâce au mono-instance, mais le mode peut basculer) : désactivez l'un des deux.

  Modes (dry-run par défaut ; -Apply pour agir) :
    (aucun)              état + usage
    -StartupTask         tâche planifiée à l'ouverture de session (délai, mode, drapeaux)
    -Hotkey 'Ctrl+Alt+G' lanceur en zone de notification : démarre Playnite ou le remet au premier
                         plan (ne lance jamais deux instances). Avec -InstallHotkeyTask : le
                         lanceur démarre à chaque session.
    -Optimize            rapport (lecture seule) : extensions, thèmes, tailles, durée de
                         démarrage, motifs lourds, recommandations
       -DisableExtension <id|dossier>[,...]   déplace vers une sauvegarde (jamais de suppression)
       -RestoreExtension <id|dossier>[,...]   annule un déplacement précédent
       -ClearCache Web|Images|All             vide les caches reconstructibles uniquement
    -Stop                demande au lanceur à raccourci de quitter
    -Uninstall           supprime les tâches planifiées créées (XML exporté avant)

  Les actions -DisableExtension/-RestoreExtension/-ClearCache exigent que Playnite soit fermé ;
  le script ne ferme jamais Playnite.

.PARAMETER PlaynitePath  Dossier d'installation ou exécutable (auto-détecté sinon).
.PARAMETER DataDir       Dossier de données (config.json, Extensions...). Auto : dossier du programme si
                         portable (pas de unins000.exe), sinon %APPDATA%\Playnite, ou --userdatadir du
                         processus en cours.
.PARAMETER Mode          Default (respecte le réglage Playnite), Desktop (--startdesktop) ou Fullscreen
                         (--startfullscreen).
.PARAMETER DelaySeconds  Délai après l'ouverture de session (tâche planifiée).
.PARAMETER SkipLibraryUpdate  Ajoute --nolibupdate.
.PARAMETER ShowSplash    Ne pas ajouter --hidesplashscreen.
.PARAMETER StartClosedToTray  Ajoute --startclosedtotray.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\playnite-boost.ps1 -Optimize
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\playnite-boost.ps1 -StartupTask -DelaySeconds 30 -Mode Fullscreen -SkipLibraryUpdate -Apply
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\playnite-boost.ps1 -Hotkey 'Ctrl+Alt+G' -InstallHotkeyTask -Apply
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\playnite-boost.ps1 -Optimize -DisableExtension MonExtensionId -Apply

.NOTES
  Écrit sous Linux : analysé syntaxiquement seulement. L'exécution sous Windows 11 n'a PAS
  été testée. Voir README.md.
#>
[CmdletBinding()]
param(
    [string]$PlaynitePath,
    [string]$DataDir,
    [ValidateSet('Default', 'Desktop', 'Fullscreen')]
    [string]$Mode = 'Default',
    [ValidateRange(0, 600)]
    [int]$DelaySeconds = 20,
    [switch]$SkipLibraryUpdate,
    [switch]$ShowSplash,
    [switch]$StartClosedToTray,

    [switch]$StartupTask,
    [string]$Hotkey,
    [switch]$InstallHotkeyTask,
    [switch]$Optimize,
    [string[]]$DisableExtension,
    [string[]]$RestoreExtension,
    [ValidateSet('Web', 'Images', 'All')]
    [string[]]$ClearCache,
    [switch]$Stop,
    [switch]$Uninstall,

    [switch]$Apply,
    [switch]$HideConsole
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:SelfPath = $PSCommandPath
if (-not $script:SelfPath) { $script:SelfPath = $MyInvocation.MyCommand.Path }
$script:TaskFolder = '\Aphrody\'
$script:StartupTaskName = 'Aphrody-Playnite-Startup'
$script:HotkeyTaskName = 'Aphrody-Playnite-Hotkey'
$script:BackupDir = Join-Path $env:LOCALAPPDATA 'Aphrody\creator-kit\backup'
$script:StopEventName = 'Local\Aphrody.PlayniteBoost.Stop'
$script:BuiltinIds = @(
    'AmazonLibrary_Builtin', 'BattlenetLibrary_Builtin', 'BethesdaLibrary_Builtin', 'EpicGamesLibrary_Builtin',
    'GogLibrary_Builtin', 'HumbleLibrary_Builtin', 'IGDBMetadata_Builtin', 'ItchioLibrary_Builtin',
    'LibraryExporterPS_Builtin', 'OriginLibrary_Builtin', 'PlayStationLibrary_Builtin', 'SteamLibrary_Builtin',
    'TwitchLibrary_Builtin', 'UplayLibrary_Builtin', 'XboxLibrary_Builtin')
$script:LastLaunch = [DateTime]::MinValue

# --- Code C# du lanceur (C# 5, ASCII uniquement) --------------------------------------------------
$script:CSharp = @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Aphrody.PlayniteBoost
{
    public static class NativeMethods
    {
        public const int WM_HOTKEY = 0x0312;
        public const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_WIN = 0x8, MOD_NOREPEAT = 0x4000;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        public static void HideConsole()
        {
            IntPtr h = GetConsoleWindow();
            if (h != IntPtr.Zero) { ShowWindow(h, 0); } // SW_HIDE
        }
    }

    // Fenetre jamais affichee : recoit WM_HOTKEY (RegisterHotKey avec hWnd, doc Microsoft Learn).
    public sealed class HotkeyHost : Form
    {
        private const int HotkeyId = 0x4A31; // plage applicative 0x0000-0xBFFF
        private readonly uint modifiers;
        private readonly uint vk;
        private readonly string tip;
        private readonly string stopEventName;
        private bool registered;
        private NotifyIcon tray;
        private EventWaitHandle stopEvent;
        private RegisteredWaitHandle stopWait;

        public event EventHandler HotkeyPressed;
        public event EventHandler LaunchRequested;
        public string ErrorMessage { get; private set; }

        public HotkeyHost(uint modifiers, uint vk, string tip, string stopEventName)
        {
            this.modifiers = modifiers;
            this.vk = vk;
            this.tip = tip;
            this.stopEventName = stopEventName;
            this.ShowInTaskbar = false;
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Bounds = new Rectangle(-32000, -32000, 1, 1);
            BuildTray();
        }

        private void BuildTray()
        {
            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = tip.Length > 60 ? tip.Substring(0, 60) : tip;
            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem info = new ToolStripMenuItem(tip);
            info.Enabled = false;
            ToolStripMenuItem launch = new ToolStripMenuItem("Lancer / afficher Playnite");
            launch.Click += delegate(object s, EventArgs ev) { RaiseLaunch(); };
            ToolStripMenuItem quit = new ToolStripMenuItem("Quitter le lanceur");
            quit.Click += delegate(object s, EventArgs ev) { Close(); };
            menu.Items.Add(info);
            menu.Items.Add(launch);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(quit);
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate(object s, EventArgs ev) { RaiseLaunch(); };
            tray.Visible = true;
        }

        public void Notify(string title, string text)
        {
            if (tray != null) { tray.ShowBalloonTip(3000, title, text, ToolTipIcon.Info); }
        }

        private void RaiseLaunch()
        {
            try
            {
                EventHandler h = LaunchRequested;
                if (h != null) { h(this, EventArgs.Empty); }
            }
            catch (Exception ex) { Notify("Playnite", ex.Message); }
        }

        protected override void SetVisibleCore(bool value)
        {
            if (!IsHandleCreated) { CreateHandle(); }
            base.SetVisibleCore(false);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (!NativeMethods.RegisterHotKey(this.Handle, HotkeyId, modifiers | NativeMethods.MOD_NOREPEAT, vk))
            {
                int code = Marshal.GetLastWin32Error();
                ErrorMessage = "RegisterHotKey a echoue (erreur Win32 " + code + " : " + new Win32Exception(code).Message + "). Raccourci deja pris ?";
                BeginInvoke(new MethodInvoker(Close));
                return;
            }
            registered = true;
            if (stopEventName != null)
            {
                stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, stopEventName);
                stopWait = ThreadPool.RegisterWaitForSingleObject(stopEvent, new WaitOrTimerCallback(OnStopSignaled), null, Timeout.Infinite, true);
            }
        }

        private void OnStopSignaled(object state, bool timedOut)
        {
            try
            {
                if (IsHandleCreated && !IsDisposed) { BeginInvoke(new MethodInvoker(Close)); }
            }
            catch (InvalidOperationException) { /* fenetre deja detruite : arret deja en cours */ }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_HOTKEY && m.WParam.ToInt64() == HotkeyId)
            {
                try
                {
                    EventHandler h = HotkeyPressed;
                    if (h != null) { h(this, EventArgs.Empty); }
                }
                catch (Exception ex) { Notify("Playnite", ex.Message); }
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (registered) { NativeMethods.UnregisterHotKey(this.Handle, HotkeyId); registered = false; }
            if (stopWait != null) { stopWait.Unregister(null); stopWait = null; }
            if (stopEvent != null) { stopEvent.Close(); stopEvent = null; }
            if (tray != null) { tray.Visible = false; tray.Dispose(); tray = null; }
            base.OnFormClosed(e);
        }
    }
}
'@

# --- Utilitaires -------------------------------------------------------------------------------
function Write-Info {
    param([string]$Message, [string]$Color = 'Gray')
    Write-Host $Message -ForegroundColor $Color
}

function Assert-Windows {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Ce script ne fonctionne que sous Windows.' }
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} Go' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} Mo' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} Ko' -f ($Bytes / 1KB)) }
    return ('{0:N0} o' -f $Bytes)
}

function Get-DirSize {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return [double]0 }
    $m = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum
    if ($null -eq $m -or $null -eq $m.Sum) { return [double]0 }
    return [double]$m.Sum
}

function Read-SimpleYaml {
    # Lit les paires « Clé: valeur » de premier niveau (extension.yaml / theme.yaml), sans module YAML.
    param([string]$Path)
    $r = @{}
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if ($line -match '^(?<k>[A-Za-z][A-Za-z0-9_]*)\s*:\s*(?<v>.*?)\s*$') {
            $v = $Matches['v']
            if ($v.Length -ge 2 -and ($v[0] -eq '"' -or $v[0] -eq "'") -and $v[$v.Length - 1] -eq $v[0]) { $v = $v.Substring(1, $v.Length - 2) }
            if (-not $r.ContainsKey($Matches['k'])) { $r[$Matches['k']] = $v }
        }
    }
    return $r
}

function Get-JsonScalar {
    param([string]$Text, [string]$Name)
    $m = [regex]::Match($Text, '"' + [regex]::Escape($Name) + '"\s*:\s*(?<v>true|false|null|-?\d+|"[^"]*")')
    if (-not $m.Success) { return $null }
    $v = $m.Groups['v'].Value
    if ($v -eq 'true') { return $true }
    if ($v -eq 'false') { return $false }
    if ($v -eq 'null') { return $null }
    if ($v.StartsWith('"')) { return $v.Trim('"') }
    return [int]$v
}

function Get-JsonStringArray {
    param([string]$Text, [string]$Name)
    $m = [regex]::Match($Text, '"' + [regex]::Escape($Name) + '"\s*:\s*\[(?<a>[^\]]*)\]')
    if (-not $m.Success) { return @() }
    return @([regex]::Matches($m.Groups['a'].Value, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value })
}

function Get-PlayniteProcess {
    return @(Get-Process -Name 'Playnite.DesktopApp', 'Playnite.FullscreenApp' -ErrorAction SilentlyContinue)
}

function Find-Playnite {
    $cand = New-Object System.Collections.Generic.List[string]
    if ($PlaynitePath) { $cand.Add($PlaynitePath) }
    foreach ($p in (Get-PlayniteProcess)) { if ($p.Path) { $cand.Add((Split-Path -Parent $p.Path)) } }
    $cand.Add((Join-Path $env:LOCALAPPDATA 'Playnite'))   # dossier par défaut de l'installeur (PlayniteInstaller)
    if ($env:ProgramFiles) { $cand.Add((Join-Path $env:ProgramFiles 'Playnite')) }
    foreach ($c in $cand) {
        $dir = if (Test-Path -LiteralPath $c -PathType Leaf) { Split-Path -Parent $c } else { $c }
        $exe = Join-Path $dir 'Playnite.DesktopApp.exe'
        if (-not (Test-Path -LiteralPath $exe)) { continue }
        $portable = -not (Test-Path -LiteralPath (Join-Path $dir 'unins000.exe'))   # PlaynitePaths.IsPortable
        $data = $null
        if ($DataDir) { $data = $DataDir }
        else {
            try {
                $wp = Get-CimInstance Win32_Process -Filter "Name='Playnite.DesktopApp.exe' OR Name='Playnite.FullscreenApp.exe'" -ErrorAction Stop |
                    Where-Object { $_.CommandLine -match '--userdatadir' } | Select-Object -First 1
                if ($wp -and $wp.CommandLine -match '--userdatadir\s+(?:"(?<d>[^"]+)"|(?<d>\S+))') { $data = $Matches['d'].TrimEnd('\', '/') }
            }
            catch { Write-Verbose "Ligne de commande de Playnite illisible : $($_.Exception.Message)" }
        }
        if (-not $data) { $data = if ($portable) { $dir } else { Join-Path $env:APPDATA 'Playnite' } }
        return [pscustomobject]@{
            ProgramDir = $dir; DesktopExe = $exe; FullscreenExe = (Join-Path $dir 'Playnite.FullscreenApp.exe')
            IsPortable = $portable; DataDir = $data
        }
    }
    return $null
}

function Get-PlayniteFlag {
    $f = New-Object System.Collections.Generic.List[string]
    if (-not $ShowSplash) { $f.Add('--hidesplashscreen') }
    if ($SkipLibraryUpdate) { $f.Add('--nolibupdate') }
    if ($Mode -eq 'Desktop') { $f.Add('--startdesktop') }
    if ($Mode -eq 'Fullscreen') { $f.Add('--startfullscreen') }
    if ($StartClosedToTray) { $f.Add('--startclosedtotray') }
    return ,$f.ToArray()
}

function Get-StartupShortcutPath {
    return (Join-Path ([Environment]::GetFolderPath('Startup')) 'Playnite.lnk')
}

# --- Tâches planifiées -------------------------------------------------------------------------
function Save-TaskBackup {
    param([string]$TaskName)
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
    if (-not $existing) { return $null }
    $null = New-Item -ItemType Directory -Path $script:BackupDir -Force
    $file = Join-Path $script:BackupDir ('{0}-{1:yyyyMMdd-HHmmss}.xml' -f $TaskName, (Get-Date))
    $xml = Export-ScheduledTask -TaskName $TaskName -TaskPath $script:TaskFolder
    [System.IO.File]::WriteAllText($file, $xml, (New-Object System.Text.UTF8Encoding($false)))
    return $file
}

function Register-LogonTask {
    param(
        [string]$TaskName, [string]$Execute, [string]$Argument, [string]$WorkingDirectory,
        [int]$Delay, [string]$Description
    )
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $backup = Save-TaskBackup -TaskName $TaskName
    if ($backup) { Write-Info "Tâche existante sauvegardée : $backup" }
    # Session interactive requise (Playnite) : console hébergée par conhost --headless, jamais affichée.
    $actionArgs = @{ Execute = (Join-Path $env:SystemRoot 'System32\conhost.exe'); Argument = ('--headless "{0}" {1}' -f $Execute, $Argument) }
    if ($WorkingDirectory) { $actionArgs.WorkingDirectory = $WorkingDirectory }
    $action = New-ScheduledTaskAction @actionArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    if ($Delay -gt 0) {
        try { $trigger.Delay = 'PT{0}S' -f $Delay }   # propriété LogonTrigger.Delay (ISO 8601)
        catch { Write-Warning "Délai non appliqué : $($_.Exception.Message)" }
    }
    $settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $reg = @{
        TaskName = $TaskName; TaskPath = $script:TaskFolder; Action = $action; Trigger = $trigger
        Settings = $settings; Principal = $principal; Force = $true; Description = $Description
    }
    try { $null = Register-ScheduledTask @reg }
    catch {
        if ($_.Exception.Message -match 'denied|refus|0x80070005') {
            throw "Accès refusé : relancez PowerShell en administrateur (non vérifié : certains déclencheurs d'ouverture de session l'exigent), ou utilisez le réglage natif de Playnite « Launch Playnite when you start your computer »."
        }
        throw
    }
}

function Unregister-LogonTask {
    param([string]$TaskName)
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
    if (-not $existing) { Write-Info "Tâche $TaskName absente." ; return }
    $backup = Save-TaskBackup -TaskName $TaskName
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath $script:TaskFolder -Confirm:$false
    Write-Info "Tâche $TaskName supprimée. Sauvegarde XML : $backup" Green
}

# --- Démarrage Windows -------------------------------------------------------------------------
function Invoke-StartupTask {
    $pn = Find-Playnite
    if (-not $pn) { throw 'Playnite introuvable. Indiquez -PlaynitePath <dossier ou exe>.' }
    $flags = Get-PlayniteFlag
    $argLine = $flags -join ' '
    Write-Info 'Plan -StartupTask :' Cyan
    Write-Info ("  Playnite   : {0} ({1})" -f $pn.DesktopExe, $(if ($pn.IsPortable) { 'portable' } else { 'installé' }))
    Write-Info ("  tâche      : {0}{1}, ouverture de session + {2} s, masquée, utilisateur courant" -f $script:TaskFolder, $script:StartupTaskName, $DelaySeconds)
    Write-Info ("  commande   : `"{0}`" {1}" -f $pn.DesktopExe, $argLine)
    $lnk = Get-StartupShortcutPath
    if (Test-Path -LiteralPath $lnk) {
        Write-Info ("  ATTENTION  : {0} existe (réglage Playnite « Launch Playnite when you start your computer »). Désactivez-le pour éviter un double lancement." -f $lnk) Yellow
    }
    $cfg = Join-Path $pn.DataDir 'config.json'
    if (Test-Path -LiteralPath $cfg) {
        $boot = Get-JsonScalar -Text (Get-Content -LiteralPath $cfg -Raw -Encoding UTF8) -Name 'StartOnBoot'
        if ($boot -eq $true) { Write-Info '  ATTENTION  : config.json indique StartOnBoot=true (Playnite recrée Playnite.lnk à chaque démarrage tant que ce réglage est actif).' Yellow }
    }
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour enregistrer la tâche.' Yellow; return }
    Assert-Windows
    Register-LogonTask -TaskName $script:StartupTaskName -Execute $pn.DesktopExe -Argument $argLine `
        -WorkingDirectory $pn.ProgramDir -Delay $DelaySeconds -Description 'Aphrody creator-kit : démarrage de Playnite'
    Write-Info "Tâche installée. Test immédiat : Start-ScheduledTask -TaskPath '$($script:TaskFolder)' -TaskName '$($script:StartupTaskName)'. Retrait : -Uninstall -Apply." Green
}

# --- Raccourci clavier -------------------------------------------------------------------------
function ConvertTo-HotkeySpec {
    param([string]$Text)
    $mods = [uint32]0; $key = $null; $hasWin = $false
    foreach ($tok in ($Text -split '\+')) {
        switch -Regex ($tok.Trim()) {
            '^(ctrl|control)$' { $mods = $mods -bor 0x2; continue }
            '^alt$' { $mods = $mods -bor 0x1; continue }
            '^shift$' { $mods = $mods -bor 0x4; continue }
            '^(win|windows)$' { $mods = $mods -bor 0x8; $hasWin = $true; continue }
            default {
                if ($null -ne $key) { throw "Raccourci invalide « $Text » : plusieurs touches principales." }
                try { $key = [System.Enum]::Parse([System.Windows.Forms.Keys], $tok.Trim(), $true) }
                catch { throw "Touche inconnue « $tok » (noms de [System.Windows.Forms.Keys], ex. G, F9, D1)." }
            }
        }
    }
    if ($null -eq $key) { throw "Raccourci invalide « $Text » : touche principale manquante." }
    if ($mods -eq 0) { throw 'Ajoutez au moins un modificateur (Ctrl, Alt, Shift, Win).' }
    if ($key -eq [System.Windows.Forms.Keys]::F12) { throw 'F12 est réservée au débogueur (doc RegisterHotKey).' }
    if ($hasWin) { Write-Warning 'Les raccourcis avec la touche Windows sont réservés au système (doc RegisterHotKey) : risque de refus.' }
    [pscustomobject]@{ Modifiers = $mods; VirtualKey = [uint32][int]$key; Text = $Text }
}

function Get-WinFormsReference {
    $types = @([System.Windows.Forms.Form], [System.Windows.Forms.NotifyIcon], [System.Drawing.Icon],
        [System.Drawing.Color], [System.ComponentModel.Component])
    $paths = @($types | ForEach-Object { $_.Assembly.Location } | Where-Object { $_ })
    if ($PSVersionTable.PSEdition -eq 'Core') {
        $paths += [AppDomain]::CurrentDomain.GetAssemblies() |
            Where-Object { -not $_.IsDynamic -and $_.GetName().Name -match '^System\.(Windows\.Forms|Drawing)' } |
            ForEach-Object { $_.Location }
    }
    $paths | Where-Object { $_ } | Sort-Object -Unique
}

function Initialize-HotkeyType {
    Assert-Windows
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    if ('Aphrody.PlayniteBoost.HotkeyHost' -as [type]) { return }
    try { Add-Type -TypeDefinition $script:CSharp -ReferencedAssemblies (Get-WinFormsReference) -ErrorAction Stop }
    catch {
        throw ("Compilation C# impossible ($($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)). Relancez avec Windows PowerShell 5.1 : " +
            "powershell.exe -STA -File `"$($script:SelfPath)`" ... Détail : $($_.Exception.Message)")
    }
}

function Invoke-StartOrFocus {
    # Playnite est mono-instance : le même exécutable lancé sans argument restaure/focalise l'instance existante.
    if (([DateTime]::UtcNow - $script:LastLaunch).TotalSeconds -lt 3) { return 'ignoré (anti-rebond 3 s)' }
    $script:LastLaunch = [DateTime]::UtcNow
    $running = @(Get-PlayniteProcess)
    if ($running.Count -gt 0) {
        $exe = $null
        try { $exe = $running[0].Path } catch { Write-Verbose "Chemin du processus illisible : $($_.Exception.Message)" }
        if (-not $exe) { $exe = $script:Playnite.DesktopExe }
        Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
        return 'Playnite déjà lancé : demande de focus envoyée'
    }
    $flags = Get-PlayniteFlag
    $sp = @{ FilePath = $script:Playnite.DesktopExe; WorkingDirectory = $script:Playnite.ProgramDir }
    if ($flags.Count -gt 0) { $sp.ArgumentList = ($flags -join ' ') }
    Start-Process @sp
    return 'Playnite lancé'
}

function Invoke-HotkeyLauncher {
    $pn = Find-Playnite
    if (-not $pn) { throw 'Playnite introuvable. Indiquez -PlaynitePath <dossier ou exe>.' }
    $script:Playnite = $pn
    Assert-Windows
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $spec = ConvertTo-HotkeySpec -Text $Hotkey
    $flags = Get-PlayniteFlag
    Write-Info 'Plan -Hotkey :' Cyan
    Write-Info ("  raccourci  : {0} (global ; MOD_NOREPEAT)" -f $spec.Text)
    Write-Info ("  action     : Playnite absent -> `"{0}`" {1} ; présent -> même exe sans argument (focus natif Playnite)" -f $pn.DesktopExe, ($flags -join ' '))
    if ($InstallHotkeyTask) {
        $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $argLine = Get-HotkeyTaskArgument
        Write-Info ("  tâche      : {0}{1} à l'ouverture de session (+{2} s), masquée" -f $script:TaskFolder, $script:HotkeyTaskName, $DelaySeconds)
        Write-Info ("  commande   : {0} {1}" -f $psExe, $argLine)
        if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour enregistrer la tâche du lanceur.' Yellow; return }
        Register-LogonTask -TaskName $script:HotkeyTaskName -Execute $psExe -Argument $argLine -WorkingDirectory '' `
            -Delay $DelaySeconds -Description 'Aphrody creator-kit : lanceur Playnite à raccourci clavier'
        Write-Info "Tâche installée. Retrait : -Uninstall -Apply. Arrêt immédiat : -Stop." Green
        return
    }
    if (-not $Apply) {
        Write-Info '[dry-run] -Hotkey ... -Apply démarre le lanceur maintenant (icône « Quitter » dans la zone de notification).' Yellow
        return
    }
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Thread MTA : relancez avec -STA (powershell.exe -STA -File ...).' }
    Initialize-HotkeyType
    $mutex = New-Object System.Threading.Mutex($false, 'Local\Aphrody.PlayniteBoost.Launcher')
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { Write-Info 'Lanceur déjà en cours (utilisez -Stop pour le fermer).' Yellow; return }
        if ($HideConsole) { [Aphrody.PlayniteBoost.NativeMethods]::HideConsole() }
        [System.Windows.Forms.Application]::EnableVisualStyles()
        $tip = 'Playnite : {0}' -f $spec.Text
        $script:Form = New-Object Aphrody.PlayniteBoost.HotkeyHost -ArgumentList @(
            [uint32]$spec.Modifiers, [uint32]$spec.VirtualKey, $tip, $script:StopEventName)
        $handler = [System.EventHandler] {
            try { $msg = Invoke-StartOrFocus; $script:Form.Notify('Playnite', $msg) }
            catch { $script:Form.Notify('Playnite : erreur', $_.Exception.Message) }
        }
        $script:Form.add_HotkeyPressed($handler)
        $script:Form.add_LaunchRequested($handler)
        try {
            Write-Info ("Lanceur actif : {0}. Quitter : icône de la zone de notification ou -Stop." -f $spec.Text) Green
            [System.Windows.Forms.Application]::Run($script:Form)
            if ($script:Form.ErrorMessage) { throw $script:Form.ErrorMessage }
        }
        finally { $script:Form.Dispose() }
    }
    finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Get-HotkeyTaskArgument {
    if (-not $script:SelfPath) { throw 'Chemin du script introuvable : exécutez-le depuis un fichier .ps1.' }
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $script:SelfPath),
        '-Hotkey', ('"{0}"' -f $Hotkey), '-Apply', '-HideConsole', '-Mode', $Mode)
    if ($PlaynitePath) { $a += @('-PlaynitePath', ('"{0}"' -f $PlaynitePath)) }
    if ($SkipLibraryUpdate) { $a += '-SkipLibraryUpdate' }
    if ($ShowSplash) { $a += '-ShowSplash' }
    if ($StartClosedToTray) { $a += '-StartClosedToTray' }
    return ($a -join ' ')
}

function Invoke-StopLauncher {
    try { $ev = [System.Threading.EventWaitHandle]::OpenExisting($script:StopEventName) }
    catch [System.Threading.WaitHandleCannotBeOpenedException] { Write-Info 'Aucun lanceur en cours.' Yellow; return }
    try { [void]$ev.Set(); Write-Info 'Arrêt demandé au lanceur.' Green } finally { $ev.Dispose() }
}

# --- Optimisation ------------------------------------------------------------------------------
function Get-StartupTiming {
    param([string]$LogPath)
    if (-not (Test-Path -LiteralPath $LogPath)) { return [pscustomobject]@{ Found = $false; Reason = 'journal absent' } }
    $fs = [System.IO.File]::Open($LogPath, 'Open', 'Read', 'ReadWrite')
    try {
        $take = [Math]::Min($fs.Length, 3MB)
        [void]$fs.Seek(-$take, 'End')
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd()
    }
    finally { $fs.Dispose() }
    $rx = '^(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\|(?<lvl>[A-Za-z]+):(?<msg>.*)$'
    $starts = New-Object System.Collections.Generic.List[double]
    $begin = $null; $matched = 0; $errors = @{}
    foreach ($line in ($text -split "`r?`n")) {
        $m = [regex]::Match($line, $rx)
        if (-not $m.Success) { continue }
        $matched++
        $ts = [DateTime]::Parse($m.Groups['ts'].Value.Replace(',', '.'), [System.Globalization.CultureInfo]::InvariantCulture)
        $msg = $m.Groups['msg'].Value
        if ($m.Groups['lvl'].Value -eq 'ERROR') {
            $k = if ($msg.Length -gt 110) { $msg.Substring(0, 110) } else { $msg }
            if ($errors.ContainsKey($k)) { $errors[$k]++ } else { $errors[$k] = 1 }
        }
        if ($msg -like "Application started from '*") { $begin = $ts }
        elseif ($null -ne $begin -and $msg -match '^Application \S+ started$') {
            $starts.Add(($ts - $begin).TotalSeconds); $begin = $null
        }
    }
    if ($matched -eq 0) { return [pscustomobject]@{ Found = $false; Reason = 'format de ligne non reconnu (attendu : "yyyy-MM-dd HH:mm:ss.ffff|NIVEAU:message")' } }
    if ($starts.Count -eq 0) { return [pscustomobject]@{ Found = $false; Reason = "$matched lignes lues mais aucun couple « Application started from » / « Application X started » dans les derniers 3 Mo" } }
    $last = @($starts | Select-Object -Last 5)
    [pscustomobject]@{
        Found = $true; Samples = $last.Count
        Last = $last[-1]; Min = ($last | Measure-Object -Minimum).Minimum
        Avg = ($last | Measure-Object -Average).Average; Max = ($last | Measure-Object -Maximum).Maximum
        Errors = $errors
    }
}

function Get-Addon {
    param([string]$Root, [string]$ManifestName)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    $rootFull = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($mf in (Get-ChildItem -LiteralPath $Root -Recurse -Filter $ManifestName -File -ErrorAction SilentlyContinue)) {
        $y = Read-SimpleYaml -Path $mf.FullName
        $rel = $mf.DirectoryName.Substring($rootFull.Length).TrimStart('\', '/')
        $top = if ($rel) { Join-Path $rootFull (($rel -split '[\\/]')[0]) } else { $mf.DirectoryName }
        $out.Add([pscustomobject]@{
                Id = $y['Id']; Name = $y['Name']; Version = $y['Version']; Type = $y['Type']; Mode = $y['Mode']
                Dir = $mf.DirectoryName; TopDir = $top; Folder = (Split-Path -Leaf $top)
                SizeBytes = (Get-DirSize -Path $mf.DirectoryName)
            })
    }
    return $out.ToArray()
}

function Show-Table {
    param($Rows, [string[]]$Property)
    $items = @($Rows | Where-Object { $null -ne $_ })
    if ($items.Count -eq 0) { Write-Info '  (aucun)'; return }
    ($items | Format-Table -Property $Property -AutoSize | Out-String).TrimEnd() -split "`r?`n" | ForEach-Object { Write-Info "  $_" }
}

function Show-OptimizeReport {
    param($Pn)
    $cfgPath = Join-Path $Pn.DataDir 'config.json'
    $cfg = if (Test-Path -LiteralPath $cfgPath) { Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 } else { '' }
    $freq = @{ 0 = 'Only manually'; 1 = 'On every startup'; 2 = 'Once a day'; 3 = 'Once a week' }
    $notes = New-Object System.Collections.Generic.List[string]

    Write-Info '== Installation' Cyan
    Write-Info ("  programme  : {0} ({1})" -f $Pn.ProgramDir, $(if ($Pn.IsPortable) { 'portable : pas de unins000.exe' } else { 'installé' }))
    Write-Info ("  données    : {0}{1}" -f $Pn.DataDir, $(if (Test-Path -LiteralPath $Pn.DataDir) { '' } else { ' (introuvable)' }))
    $run = @(Get-PlayniteProcess)
    Write-Info ("  en cours   : {0}" -f $(if ($run.Count) { ($run | ForEach-Object { $_.ProcessName }) -join ', ' } else { 'non' }))

    Write-Info '== Réglages (config.json)' Cyan
    if ($cfg) {
        $upd = Get-JsonScalar -Text $cfg -Name 'CheckForLibraryUpdates'
        $emu = Get-JsonScalar -Text $cfg -Name 'CheckForEmulatedLibraryUpdates'
        $updText = if ($upd -is [int] -and $freq.ContainsKey($upd)) { $freq[$upd] } else { "$upd" }
        $emuText = if ($emu -is [int] -and $freq.ContainsKey($emu)) { $freq[$emu] } else { "$emu" }
        Write-Info ("  Update libraries (CheckForLibraryUpdates)      : {0}" -f $(if ($null -eq $upd) { 'absent (défaut Playnite : On every startup)' } else { $updText }))
        Write-Info ("  Scan emulation folders (CheckForEmulated...)   : {0}" -f $(if ($null -eq $emu) { 'absent (défaut : On every startup)' } else { $emuText }))
        foreach ($k in 'StartOnBoot', 'StartOnBootClosedToTray', 'StartInFullscreen', 'StartMinimized', 'DisableHwAcceleration', 'DownloadMetadataOnImport', 'Theme') {
            $v = Get-JsonScalar -Text $cfg -Name $k
            Write-Info ("  {0,-46} : {1}" -f $k, $(if ($null -eq $v) { '(absent)' } else { $v }))
        }
    }
    else { Write-Info "  config.json introuvable ($cfgPath) : démarrez Playnite une fois ou précisez -DataDir." Yellow }
    $disabled = if ($cfg) { @(Get-JsonStringArray -Text $cfg -Name 'DisabledPlugins') } else { @() }
    Write-Info ("  DisabledPlugins : {0}" -f $(if ($disabled.Count) { $disabled -join ', ' } else { 'aucun' }))

    Write-Info '== Extensions' Cyan
    $extUser = Join-Path $Pn.DataDir 'Extensions'
    $ext = @(Get-Addon -Root $extUser -ManifestName 'extension.yaml')
    $thirdParty = @($ext | Where-Object { $_.Id -and $_.Id -notin $script:BuiltinIds -and $_.Id -notlike '*_Builtin' })
    $builtin = @($ext | Where-Object { $_.Id -in $script:BuiltinIds -or ($_.Id -like '*_Builtin') })
    Write-Info ("  dossier : {0} ; {1} tierce(s), {2} intégrée(s) vues dans ce dossier ({3})" -f $extUser, $thirdParty.Count, $builtin.Count, $(if ($Pn.IsPortable) { 'portable : intégrées et tierces partagent Extensions\' } else { 'les intégrées sont dans le dossier du programme' }))
    $rows = $thirdParty | Sort-Object SizeBytes -Descending | ForEach-Object {
        [pscustomobject]@{ Id = $_.Id; Nom = $_.Name; Type = $_.Type; Version = $_.Version; Taille = (Format-Size $_.SizeBytes); Dossier = $_.Folder }
    }
    Show-Table -Rows $rows -Property 'Id', 'Nom', 'Type', 'Version', 'Taille', 'Dossier'
    $progExt = if ($Pn.IsPortable) { @() } else { @(Get-Addon -Root (Join-Path $Pn.ProgramDir 'Extensions') -ManifestName 'extension.yaml') }
    $allLib = @(@($thirdParty) + @($builtin) + @($progExt) | Where-Object { $_.Type -eq 'GameLibrary' })
    $enabledLib = @($allLib | Where-Object { $_.Id -notin $disabled })
    Write-Info ("  plugins de bibliothèque (GameLibrary) : {0} au total, {1} actif(s)" -f $allLib.Count, $enabledLib.Count)
    $libThreshold = 4
    if ($enabledLib.Count -ge $libThreshold -and ($null -eq (Get-JsonScalar -Text $cfg -Name 'CheckForLibraryUpdates') -or (Get-JsonScalar -Text $cfg -Name 'CheckForLibraryUpdates') -eq 1)) {
        $notes.Add(("Motif lourd (heuristique, seuil {0}) : {1} plugins de bibliothèque actifs et « Update libraries = On every startup » : chaque démarrage interroge tous les magasins. Réglez « Update libraries » sur « Once a day » / « Only manually » (réglage Playnite) ou ajoutez --nolibupdate via -StartupTask -SkipLibraryUpdate (argument documenté)." -f $libThreshold, $enabledLib.Count))
    }
    $scripts = @($thirdParty | Where-Object { $_.Type -eq 'Script' })
    if ($scripts.Count -gt 0) { $notes.Add(("{0} extension(s) de type Script (PowerShell/Python) : chargées au démarrage, vérifiez leur utilité." -f $scripts.Count)) }
    if ($thirdParty.Count -ge 15) { $notes.Add(("{0} extensions tierces (heuristique, seuil 15) : testez un démarrage en mode sans échec (--safestartup : extensions intégrées + thème par défaut, documenté) pour mesurer l'écart." -f $thirdParty.Count)) }

    Write-Info '== Thèmes (dossier utilisateur)' Cyan
    $themeRoot = Join-Path $Pn.DataDir 'Themes'
    $themes = @(Get-Addon -Root $themeRoot -ManifestName 'theme.yaml')
    $mediaExt = @('.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.gif', '.apng', '.webp')
    $trows = New-Object System.Collections.Generic.List[object]
    foreach ($t in $themes) {
        $files = @(Get-ChildItem -LiteralPath $t.Dir -Recurse -File -ErrorAction SilentlyContinue)
        $media = @($files | Where-Object { $mediaExt -contains $_.Extension.ToLowerInvariant() })
        $bigImg = @($files | Where-Object { $_.Extension -match '^\.(png|jpe?g|bmp)$' -and $_.Length -ge 2MB })
        $xaml = @($files | Where-Object { $_.Extension -eq '.xaml' })
        $media_el = 0; $forever = 0
        foreach ($x in $xaml) {
            $c = Get-Content -LiteralPath $x.FullName -Raw -ErrorAction SilentlyContinue
            if ($c) { $media_el += [regex]::Matches($c, 'MediaElement').Count; $forever += [regex]::Matches($c, 'RepeatBehavior\s*=\s*"Forever"').Count }
        }
        $trows.Add([pscustomobject]@{ Id = $t.Id; Nom = $t.Name; Mode = $t.Mode; Taille = (Format-Size $t.SizeBytes); Medias = $media.Count; ImagesGrosses = $bigImg.Count; MediaElement = $media_el; AnimInfinie = $forever })
        if ($media.Count -gt 0 -or $media_el -gt 0) {
            $notes.Add(("Thème « {0} » : {1} fichier(s) vidéo/animé(s) ({2}) et {3} MediaElement : un fond animé/vidéo consomme CPU/GPU en continu (heuristique)." -f $t.Name, $media.Count, (($media | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', '), $media_el))
        }
        if ($t.SizeBytes -ge 100MB) { $notes.Add(("Thème « {0} » : {1} sur disque (heuristique, seuil 100 Mo) : images non optimisées probables." -f $t.Name, (Format-Size $t.SizeBytes))) }
        if ($forever -gt 0) { $notes.Add(("Thème « {0} » : {1} animation(s) RepeatBehavior=Forever (heuristique)." -f $t.Name, $forever)) }
    }
    Show-Table -Rows $trows -Property 'Id', 'Nom', 'Mode', 'Taille', 'Medias', 'ImagesGrosses', 'MediaElement', 'AnimInfinie'

    Write-Info '== Caches (reconstructibles)' Cyan
    $caches = @(
        @{ Key = 'Web'; Label = 'cache web CEF (équivaut à --clearwebcache)'; Path = (Join-Path $Pn.DataDir 'browsercache') },
        @{ Key = 'Images'; Label = 'cache images'; Path = (Join-Path $Pn.DataDir 'cache\images') },
        @{ Key = 'Images'; Label = 'cache icônes'; Path = (Join-Path $Pn.DataDir 'cache\icons') })
    foreach ($c in $caches) { Write-Info ("  {0,-45} {1,10}  {2}" -f $c.Label, (Format-Size (Get-DirSize -Path $c.Path)), $c.Path) }
    Write-Info ("  JITProfiles (NON vidé : accélère le démarrage) : {0}" -f (Format-Size (Get-DirSize -Path (Join-Path $Pn.DataDir 'JITProfiles'))))

    Write-Info '== Durée de démarrage (playnite.log)' Cyan
    $tm = Get-StartupTiming -LogPath (Join-Path $Pn.DataDir 'playnite.log')
    if ($tm.Found) {
        Write-Info ("  {0} démarrage(s) récents : dernier {1:N1} s, min {2:N1}, moyenne {3:N1}, max {4:N1} (de « Application started from » à « Application X started »)" -f $tm.Samples, $tm.Last, $tm.Min, $tm.Avg, $tm.Max)
        if ($tm.Avg -ge 15) { $notes.Add(('Démarrage lent (moyenne {0:N1} s, heuristique seuil 15 s) : comparez avec --safestartup, puis désactivez les extensions/thèmes coupables.' -f $tm.Avg)) }
        $top = $tm.Errors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5
        foreach ($e in $top) { Write-Info ("  erreur x{0} : {1}" -f $e.Value, $e.Key) Yellow }
    }
    else { Write-Info ("  non analysable : {0}" -f $tm.Reason) Yellow }

    Write-Info '== Recommandations' Cyan
    if ($notes.Count -eq 0) { Write-Info '  Aucun motif lourd détecté par les heuristiques du script.' }
    foreach ($n in $notes) { Write-Info ("  - {0}" -f $n) }
    Write-Info '  - Avant toute modification, faites une sauvegarde native : Playnite.DesktopApp.exe --backup <dossier> (documenté).'
    Write-Info '  - Les réglages natifs restent la voie principale : « Launch Playnite when you start your computer », « Start closed to tray », « Launch in Fullscreen Mode », « Update libraries ».'
}

function Split-NameList {
    # powershell.exe -File passe « A,B » comme une seule chaîne : on éclate aussi sur la virgule.
    param([string[]]$Value)
    return @($Value | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Resolve-ExtensionTarget {
    param($Ext, [string[]]$Names)
    foreach ($n in $Names) {
        $hit = @($Ext | Where-Object { $_.Id -eq $n -or $_.Folder -eq $n -or $_.Name -eq $n })
        if ($hit.Count -eq 0) { throw "Extension « $n » introuvable (Id, nom de dossier ou nom exact)." }
        $hit | Select-Object -First 1
    }
}

function Get-MoveLogPath { param($Pn) return (Join-Path $Pn.DataDir 'ExtensionsDisabled.aphrody\moves.json') }

function Read-MoveLog {
    param($Pn)
    $p = Get-MoveLogPath -Pn $Pn
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    $parsed = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json
    # 5.1 renvoie le tableau JSON comme un seul objet : on l'aplatit pour obtenir le même résultat qu'en 7.
    return @($parsed | ForEach-Object { $_ })
}

function Write-MoveLog {
    param($Pn, $Entries)
    $p = Get-MoveLogPath -Pn $Pn
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force
    $json = ConvertTo-Json -InputObject @($Entries) -Depth 4
    [System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-PlayniteClosed {
    $r = @(Get-PlayniteProcess)
    if ($r.Count -gt 0) { throw 'Playnite est en cours d''exécution : fermez-le (le script ne le ferme jamais) puis relancez avec -Apply.' }
}

function Invoke-OptimizeAction {
    param($Pn)
    $extUser = Join-Path $Pn.DataDir 'Extensions'
    if ($DisableExtension) {
        $ext = @(Get-Addon -Root $extUser -ManifestName 'extension.yaml')
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $dest = Join-Path $Pn.DataDir ('ExtensionsDisabled.aphrody\{0}' -f $stamp)   # hors du dossier Extensions (analysé récursivement par Playnite)
        Write-Info '== -DisableExtension' Cyan
        $plan = New-Object System.Collections.Generic.List[object]
        foreach ($t in @(Resolve-ExtensionTarget -Ext $ext -Names (Split-NameList $DisableExtension))) {
            if ($t.Id -in $script:BuiltinIds -or $t.Id -like '*_Builtin') {
                throw "« $($t.Id) » est une extension intégrée : ne la déplacez pas. Désactivez-la dans les réglages de Playnite (liste DisabledPlugins)."
            }
            $plan.Add([pscustomobject]@{ Id = $t.Id; Name = $t.Name; From = $t.TopDir; To = (Join-Path $dest $t.Folder); Size = $t.SizeBytes })
        }
        foreach ($p in $plan) { Write-Info ("  déplacer {0} ({1}) : {2} -> {3}" -f $p.Id, (Format-Size $p.Size), $p.From, $p.To) }
        if (-not $Apply) { Write-Info '[dry-run] -Apply déplace (jamais de suppression) ; annulation : -RestoreExtension.' Yellow }
        else {
            Assert-PlayniteClosed
            $null = New-Item -ItemType Directory -Path $dest -Force
            $log = @(Read-MoveLog -Pn $Pn)
            foreach ($p in $plan) {
                Move-Item -LiteralPath $p.From -Destination $p.To
                $log += [pscustomobject]@{ Id = $p.Id; Name = $p.Name; From = $p.From; To = $p.To; Moved = (Get-Date).ToString('o'); Restored = $null }
                Write-Info ("  déplacé : {0}" -f $p.Id) Green
            }
            Write-MoveLog -Pn $Pn -Entries $log
        }
    }
    if ($RestoreExtension) {
        Write-Info '== -RestoreExtension' Cyan
        $log = @(Read-MoveLog -Pn $Pn)
        $todo = New-Object System.Collections.Generic.List[object]
        foreach ($n in (Split-NameList $RestoreExtension)) {
            $hit = @($log | Where-Object { -not $_.Restored -and ($_.Id -eq $n -or $_.Name -eq $n -or (Split-Path -Leaf $_.From) -eq $n) })
            if ($hit.Count -eq 0) { throw "Aucun déplacement non restauré pour « $n » (journal : $(Get-MoveLogPath -Pn $Pn))." }
            $todo.Add($hit[-1])
        }
        foreach ($e in $todo) { Write-Info ("  restaurer {0} : {1} -> {2}" -f $e.Id, $e.To, $e.From) }
        if (-not $Apply) { Write-Info '[dry-run] -Apply restaure.' Yellow }
        else {
            Assert-PlayniteClosed
            foreach ($e in $todo) {
                if (Test-Path -LiteralPath $e.From) { throw "Destination déjà présente : $($e.From). Rien n'est écrasé." }
                Move-Item -LiteralPath $e.To -Destination $e.From
                $e.Restored = (Get-Date).ToString('o')
                Write-Info ("  restauré : {0}" -f $e.Id) Green
            }
            Write-MoveLog -Pn $Pn -Entries $log
        }
    }
    if ($ClearCache) {
        Write-Info '== -ClearCache (données dérivées reconstruites par Playnite : pas de sauvegarde)' Cyan
        $want = if ($ClearCache -contains 'All') { @('Web', 'Images') } else { $ClearCache }
        $targets = New-Object System.Collections.Generic.List[string]
        if ($want -contains 'Web') { $targets.Add((Join-Path $Pn.DataDir 'browsercache')) }
        if ($want -contains 'Images') { $targets.Add((Join-Path $Pn.DataDir 'cache\images')); $targets.Add((Join-Path $Pn.DataDir 'cache\icons')) }
        foreach ($t in $targets) { Write-Info ("  vider {0} ({1})" -f $t, (Format-Size (Get-DirSize -Path $t))) }
        if (-not $Apply) { Write-Info '[dry-run] -Apply vide ces dossiers (JITProfiles, library, ExtensionsData jamais touchés).' Yellow }
        else {
            Assert-PlayniteClosed
            foreach ($t in $targets) {
                if (-not (Test-Path -LiteralPath $t)) { continue }
                # garde-fou : uniquement sous le dossier de données et nommé comme un cache
                $full = (Resolve-Path -LiteralPath $t).Path
                $data = (Resolve-Path -LiteralPath $Pn.DataDir).Path
                if (-not $full.StartsWith($data, [StringComparison]::OrdinalIgnoreCase) -or ($full -notmatch '(browsercache|\\cache\\(images|icons))$')) { throw "Chemin refusé : $full" }
                Get-ChildItem -LiteralPath $full -Force | Remove-Item -Recurse -Force
                Write-Info ("  vidé : {0}" -f $full) Green
            }
        }
    }
}

function Invoke-Optimize {
    $pn = Find-Playnite
    if (-not $pn) { throw 'Playnite introuvable. Indiquez -PlaynitePath <dossier ou exe>.' }
    Show-OptimizeReport -Pn $pn
    if ($DisableExtension -or $RestoreExtension -or $ClearCache) { Invoke-OptimizeAction -Pn $pn }
}

function Invoke-UninstallTask {
    Write-Info 'Plan -Uninstall : exporter puis supprimer les tâches Aphrody-Playnite-Startup et Aphrody-Playnite-Hotkey, arrêter le lanceur.' Cyan
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply. (Les déplacements d''extensions se défont avec -RestoreExtension.)' Yellow; return }
    Invoke-StopLauncher
    Unregister-LogonTask -TaskName $script:StartupTaskName
    Unregister-LogonTask -TaskName $script:HotkeyTaskName
}

function Show-Status {
    $pn = Find-Playnite
    Write-Info 'playnite-boost : dry-run par défaut. Modes : -StartupTask, -Hotkey, -Optimize, -Stop, -Uninstall (+ -Apply).' Cyan
    if ($pn) {
        Write-Info ("Playnite détecté : {0} ({1}) ; données : {2}" -f $pn.DesktopExe, $(if ($pn.IsPortable) { 'portable' } else { 'installé' }), $pn.DataDir)
    }
    else { Write-Info 'Playnite non détecté : utilisez -PlaynitePath <dossier ou exe>.' Yellow }
    foreach ($n in $script:StartupTaskName, $script:HotkeyTaskName) {
        $t = Get-ScheduledTask -TaskName $n -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
        Write-Info ("  tâche {0} : {1}" -f $n, $(if ($t) { $t.State } else { 'absente' }))
    }
    if (Test-Path -LiteralPath (Get-StartupShortcutPath)) { Write-Info '  Playnite.lnk présent dans le dossier Démarrage (réglage natif actif).' }
}

# --- Point d'entrée ----------------------------------------------------------------------------
Assert-Windows
$modes = @($StartupTask.IsPresent, [bool]$Hotkey, $Optimize.IsPresent, $Stop.IsPresent, $Uninstall.IsPresent) | Where-Object { $_ }
if (@($modes).Count -gt 1) { throw 'Un seul mode à la fois : -StartupTask, -Hotkey, -Optimize, -Stop ou -Uninstall.' }
if (($DisableExtension -or $RestoreExtension -or $ClearCache) -and -not $Optimize) { throw '-DisableExtension, -RestoreExtension et -ClearCache s''utilisent avec -Optimize.' }
if ($Stop) { Invoke-StopLauncher }
elseif ($Uninstall) { Invoke-UninstallTask }
elseif ($StartupTask) { Invoke-StartupTask }
elseif ($Hotkey) { Invoke-HotkeyLauncher }
elseif ($Optimize) { Invoke-Optimize }
else { Show-Status }
