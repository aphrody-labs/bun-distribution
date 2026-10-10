#Requires -Version 5.1
# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Réserve une bande de l'écran (zone morte) comme barre d'application, peinte en noir.

.DESCRIPTION
  Aucune option Windows native ne réduit la surface du bureau et une zone morte matérielle
  (pixels morts, bande) ne se répare pas par logiciel. Ce script enregistre la bande comme
  « appbar » (comme la barre des tâches) avec SHAppBarMessage : les fenêtres maximisées ne
  passent plus dessous. Le script ne touche ni au pilote ni à la résolution.

  Modes (un seul à la fois) :
    (aucun)         affiche le plan et la géométrie calculée, ne modifie rien
    -ListMonitors   liste les moniteurs (index, bornes en pixels physiques, DPI effectif)
    -Run            réserve la bande maintenant (processus au premier plan, icône de zone de
                    notification avec « Quitter »)           [dry-run sans -Apply]
    -Install        tâche planifiée à l'ouverture de session, masquée, utilisateur courant
                    (sauvegarde le XML d'une tâche existante)  [dry-run sans -Apply]
    -Uninstall      arrête l'instance, exporte puis supprime la tâche [dry-run sans -Apply]
    -Stop           demande à l'instance en cours de quitter proprement (annulation)

  DPI : le script déclare le processus « Per-Monitor v2 » (SetProcessDpiAwarenessContext(-4),
  Windows 10 1703+), sinon SetProcessDpiAwareness(2) puis SetProcessDPIAware(). Cet appel doit
  précéder toute fenêtre ; il est donc fait avant de lire les moniteurs. Conséquence : toutes
  les valeurs sont en pixels PHYSIQUES de la dalle. -Percent est un pourcentage de la
  dimension perpendiculaire à la bande (largeur pour Left/Right, hauteur pour Top/Bottom) ;
  -Pixels est une épaisseur en pixels physiques. Si le processus hôte est déjà DPI-aware
  (ISE), l'appel échoue et le niveau existant est conservé ; s'il est « unaware », -Run refuse.

  Sortie propre : icône de zone de notification > « Quitter », ou `-Stop` depuis une autre
  fenêtre (événement nommé Local\Aphrody.DeadZone.Stop.<Edge>-<Monitor|main>). Fermer la console
  tue le processus sans ABM_REMOVE.

.PARAMETER Edge        Bord de l'écran à réserver : Left, Right (défaut), Top, Bottom.
.PARAMETER Percent     Épaisseur en % de la dimension perpendiculaire (défaut 10 si -Pixels absent).
.PARAMETER Pixels      Épaisseur en pixels physiques (exclusif avec -Percent).
.PARAMETER Monitor     Index du moniteur (voir -ListMonitors). -1 = principal (défaut).
.PARAMETER Apply       Exécute réellement. Sans lui, -Run/-Install/-Uninstall n'affichent que le plan.
.PARAMETER HideConsole Masque la console (passé par la tâche planifiée).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -ListMonitors
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -Edge Right -Percent 10 -Run -Apply
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -Edge Right -Percent 10 -Install -Apply
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -Edge Right -Stop
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -Edge Right -Uninstall -Apply

.NOTES
  Écrit sous Linux : analysé syntaxiquement seulement (PowerShell 7 Parser). L'exécution sous
  Windows 11 n'a PAS été testée. Voir README.md.
#>
[CmdletBinding()]
param(
    [ValidateSet('Left', 'Right', 'Top', 'Bottom')]
    [string]$Edge = 'Right',

    [ValidateRange(0.1, 50)]
    [double]$Percent,

    [ValidateRange(1, 8000)]
    [int]$Pixels,

    [int]$Monitor = -1,

    [switch]$ListMonitors,
    [switch]$Run,
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Stop,
    [switch]$Apply,
    [switch]$HideConsole
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Les fonctions ont leur propre $PSBoundParameters : on capture ici l'état du script.
$script:SelfPath = $PSCommandPath
if (-not $script:SelfPath) { $script:SelfPath = $MyInvocation.MyCommand.Path }
$script:UsePixels = $PSBoundParameters.ContainsKey('Pixels')
$script:PercentValue = if ($PSBoundParameters.ContainsKey('Percent')) { $Percent } else { 10.0 }

$script:TaskFolder = '\Aphrody\'
$script:BackupDir = Join-Path $env:LOCALAPPDATA 'Aphrody\creator-kit\backup'

# --- Code C# (compatible C# 5 pour Windows PowerShell 5.1 ; ASCII uniquement) -----------------
$script:CSharp = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Aphrody.DeadZone
{
    public static class NativeMethods
    {
        // Valeurs verifiees dans shellapi.h (microsoft/win32metadata).
        public const uint ABM_NEW = 0x0, ABM_REMOVE = 0x1, ABM_QUERYPOS = 0x2, ABM_SETPOS = 0x3;
        public const uint ABM_ACTIVATE = 0x6, ABM_WINDOWPOSCHANGED = 0x9;
        public const int ABN_STATECHANGE = 0x0, ABN_POSCHANGED = 0x1, ABN_FULLSCREENAPP = 0x2, ABN_WINDOWARRANGE = 0x3;
        public const uint ABE_LEFT = 0, ABE_TOP = 1, ABE_RIGHT = 2, ABE_BOTTOM = 3;

        public const int WM_ACTIVATE = 0x0006, WM_WINDOWPOSCHANGED = 0x0047, WM_DISPLAYCHANGE = 0x007E;
        public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        // Disposition shellapi.h : DWORD, HWND, UINT, UINT, RECT, LPARAM
        // (36 octets en x86, 48 en x64 : l'alignement par defaut du marshaler suffit).
        [StructLayout(LayoutKind.Sequential)]
        public struct APPBARDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage;
            public uint uEdge;
            public RECT rc;
            public IntPtr lParam;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [DllImport("shell32.dll")]
        public static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterWindowMessage(string lpString);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")]
        public static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")]
        public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
        [DllImport("shcore.dll")]
        public static extern int SetProcessDpiAwareness(int value);
        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
        [DllImport("shcore.dll")]
        public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        // Retourne 0 = unaware, 1 = system, 2 = per-monitor (enum DPI_AWARENESS), -1 = inconnu.
        public static int CurrentAwareness()
        {
            try { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
            catch (EntryPointNotFoundException) { return -1; }
        }

        // Doit etre appele avant toute fenetre. Essaie Per-Monitor v2 (-4), puis les API plus anciennes.
        public static int EnsureDpiAwareness()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(new IntPtr(-4))) { return CurrentAwareness(); }
            }
            catch (EntryPointNotFoundException) { }
            try
            {
                if (CurrentAwareness() < 2 && SetProcessDpiAwareness(2) == 0) { return CurrentAwareness(); }
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            if (CurrentAwareness() < 1) { SetProcessDPIAware(); }
            return CurrentAwareness();
        }

        public static uint EffectiveDpi(int centerX, int centerY)
        {
            try
            {
                POINT p = new POINT(); p.X = centerX; p.Y = centerY;
                IntPtr hMon = MonitorFromPoint(p, 2); // MONITOR_DEFAULTTONEAREST
                uint dx, dy;
                if (GetDpiForMonitor(hMon, 0, out dx, out dy) == 0) { return dx; } // MDT_EFFECTIVE_DPI
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            return 0;
        }

        public static void HideConsole()
        {
            IntPtr h = GetConsoleWindow();
            if (h != IntPtr.Zero) { ShowWindow(h, 0); } // SW_HIDE
        }
    }

    public sealed class DeadZoneBar : Form
    {
        private readonly uint edge;
        private readonly int monitorIndex;
        private readonly double percent;
        private readonly int pixels;
        private readonly uint callbackMsg;
        private readonly string tip;
        private readonly string stopEventName;
        private bool registered;
        private bool positioning;
        private Rectangle lastRect = Rectangle.Empty;
        private NotifyIcon tray;
        private EventWaitHandle stopEvent;
        private RegisteredWaitHandle stopWait;

        public string ErrorMessage { get; private set; }

        public DeadZoneBar(int edge, int monitorIndex, double percent, int pixels, string stopEventName, string tip)
        {
            this.edge = (uint)edge;
            this.monitorIndex = monitorIndex;
            this.percent = percent;
            this.pixels = pixels;
            this.stopEventName = stopEventName;
            this.tip = tip;
            this.callbackMsg = NativeMethods.RegisterWindowMessage("Aphrody.DeadZone.AppBar." + stopEventName);

            this.FormBorderStyle = FormBorderStyle.None;
            this.ShowInTaskbar = false;
            this.StartPosition = FormStartPosition.Manual;
            this.BackColor = Color.Black;
            this.TopMost = true;
            this.AutoScaleMode = AutoScaleMode.None;
            this.Text = "Aphrody dead zone";
            this.MinimumSize = new Size(1, 1);
            this.Bounds = new Rectangle(-32000, -32000, 1, 1); // hors ecran jusqu'au premier ABM_SETPOS
            BuildTray();
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080;   // WS_EX_TOOLWINDOW : hors Alt+Tab
                cp.ExStyle |= 0x08000000;   // WS_EX_NOACTIVATE : ne vole pas le focus
                return cp;
            }
        }

        private void BuildTray()
        {
            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = tip.Length > 60 ? tip.Substring(0, 60) : tip;
            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem info = new ToolStripMenuItem(tip);
            info.Enabled = false;
            ToolStripMenuItem quit = new ToolStripMenuItem("Quitter (lib\u00e9rer l'\u00e9cran)");
            quit.Click += delegate(object s, EventArgs ev) { Close(); };
            menu.Items.Add(info);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(quit);
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
        }

        private Rectangle MonitorBounds()
        {
            Screen[] all = Screen.AllScreens;
            Screen s = (monitorIndex >= 0 && monitorIndex < all.Length) ? all[monitorIndex] : Screen.PrimaryScreen;
            return s.Bounds;
        }

        private int Thickness(Rectangle m)
        {
            int span = (edge == NativeMethods.ABE_LEFT || edge == NativeMethods.ABE_RIGHT) ? m.Width : m.Height;
            int t = pixels > 0 ? pixels : (int)Math.Round(span * percent / 100.0);
            if (t > span / 2) { t = span / 2; }
            if (t < 1) { t = 1; }
            return t;
        }

        private NativeMethods.APPBARDATA NewData()
        {
            NativeMethods.APPBARDATA abd = new NativeMethods.APPBARDATA();
            abd.cbSize = Marshal.SizeOf(typeof(NativeMethods.APPBARDATA));
            abd.hWnd = this.Handle;
            return abd;
        }

        // Sequence documentee : ABM_NEW une fois, puis ABM_QUERYPOS -> ajustement -> ABM_SETPOS -> deplacement.
        private void RegisterBar()
        {
            NativeMethods.APPBARDATA abd = NewData();
            abd.uCallbackMessage = callbackMsg;
            if (NativeMethods.SHAppBarMessage(NativeMethods.ABM_NEW, ref abd) == UIntPtr.Zero)
            {
                throw new InvalidOperationException("ABM_NEW refuse : barre deja enregistree ou erreur du shell.");
            }
            registered = true;
            PositionBar();
        }

        private void PositionBar()
        {
            if (positioning || !registered) { return; }
            positioning = true;
            try
            {
                Rectangle m = MonitorBounds();
                int t = Thickness(m);
                NativeMethods.APPBARDATA abd = NewData();
                abd.uEdge = edge;
                NativeMethods.RECT rc = new NativeMethods.RECT();
                if (edge == NativeMethods.ABE_LEFT) { rc.Left = m.Left; rc.Top = m.Top; rc.Right = m.Left + t; rc.Bottom = m.Bottom; }
                else if (edge == NativeMethods.ABE_RIGHT) { rc.Left = m.Right - t; rc.Top = m.Top; rc.Right = m.Right; rc.Bottom = m.Bottom; }
                else if (edge == NativeMethods.ABE_TOP) { rc.Left = m.Left; rc.Top = m.Top; rc.Right = m.Right; rc.Bottom = m.Top + t; }
                else { rc.Left = m.Left; rc.Top = m.Bottom - t; rc.Right = m.Right; rc.Bottom = m.Bottom; }
                abd.rc = rc;

                NativeMethods.SHAppBarMessage(NativeMethods.ABM_QUERYPOS, ref abd);
                // Le systeme ajuste par soustraction de rectangles sans garder l'epaisseur : on la restaure.
                if (edge == NativeMethods.ABE_LEFT) { abd.rc.Right = abd.rc.Left + t; }
                else if (edge == NativeMethods.ABE_RIGHT) { abd.rc.Left = abd.rc.Right - t; }
                else if (edge == NativeMethods.ABE_TOP) { abd.rc.Bottom = abd.rc.Top + t; }
                else { abd.rc.Top = abd.rc.Bottom - t; }

                Rectangle final = Rectangle.FromLTRB(abd.rc.Left, abd.rc.Top, abd.rc.Right, abd.rc.Bottom);
                if (final == lastRect) { return; } // evite la boucle ABM_SETPOS -> ABN_POSCHANGED -> ABM_SETPOS
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_SETPOS, ref abd);
                NativeMethods.SetWindowPos(this.Handle, NativeMethods.HWND_TOPMOST,
                    abd.rc.Left, abd.rc.Top, abd.rc.Right - abd.rc.Left, abd.rc.Bottom - abd.rc.Top,
                    NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);
                lastRect = final;
            }
            finally { positioning = false; }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (stopWait == null && stopEventName != null)
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

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try { RegisterBar(); }
            catch (Exception ex) { ErrorMessage = ex.Message; Close(); }
        }

        protected override void WndProc(ref Message m)
        {
            if (callbackMsg != 0 && m.Msg == (int)callbackMsg)
            {
                int code = (int)m.WParam.ToInt64();
                if (code == NativeMethods.ABN_POSCHANGED)
                {
                    PositionBar();
                }
                else if (code == NativeMethods.ABN_FULLSCREENAPP)
                {
                    // Doc : a l'ouverture d'une application plein ecran, descendre au bas du z-order ; remonter a la fermeture.
                    NativeMethods.SetWindowPos(this.Handle, m.LParam != IntPtr.Zero ? NativeMethods.HWND_BOTTOM : NativeMethods.HWND_TOPMOST,
                        0, 0, 0, 0, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
                }
                return;
            }
            if (registered)
            {
                if (m.Msg == NativeMethods.WM_ACTIVATE)
                {
                    NativeMethods.APPBARDATA a = NewData();
                    a.lParam = (m.WParam.ToInt64() & 0xFFFF) != 0 ? new IntPtr(1) : IntPtr.Zero;
                    NativeMethods.SHAppBarMessage(NativeMethods.ABM_ACTIVATE, ref a);
                }
                else if (m.Msg == NativeMethods.WM_WINDOWPOSCHANGED)
                {
                    NativeMethods.APPBARDATA a = NewData();
                    NativeMethods.SHAppBarMessage(NativeMethods.ABM_WINDOWPOSCHANGED, ref a);
                }
                else if (m.Msg == NativeMethods.WM_DISPLAYCHANGE)
                {
                    lastRect = Rectangle.Empty;
                    BeginInvoke(new MethodInvoker(PositionBar));
                }
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (registered)
            {
                NativeMethods.APPBARDATA abd = NewData();
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_REMOVE, ref abd); // obligatoire avant destruction
                registered = false;
            }
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
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
        throw 'Ce script ne fonctionne que sous Windows.'
    }
}

function Get-WinFormsReference {
    # Chemins complets des assemblies : fonctionne en 5.1 (.NET Framework) et en 7 (.NET).
    $types = @(
        [System.Windows.Forms.Form], [System.Windows.Forms.NotifyIcon],
        [System.Drawing.Icon], [System.Drawing.Color], [System.ComponentModel.Component]
    )
    $paths = @($types | ForEach-Object { $_.Assembly.Location } | Where-Object { $_ })
    if ($PSVersionTable.PSEdition -eq 'Core') {
        $paths += [AppDomain]::CurrentDomain.GetAssemblies() |
            Where-Object { -not $_.IsDynamic -and $_.GetName().Name -match '^System\.(Windows\.Forms|Drawing)' } |
            ForEach-Object { $_.Location }
    }
    $paths | Where-Object { $_ } | Sort-Object -Unique
}

function Initialize-DeadZoneType {
    Assert-Windows
    if ('Aphrody.DeadZone.NativeMethods' -as [type]) { return }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    try {
        Add-Type -TypeDefinition $script:CSharp -ReferencedAssemblies (Get-WinFormsReference) -ErrorAction Stop
    }
    catch {
        throw ("Compilation C# impossible ($($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)). " +
            "Relancez avec Windows PowerShell 5.1 : powershell.exe -File `"$($script:SelfPath)`" ... Détail : $($_.Exception.Message)")
    }
}

function Initialize-DpiAwareness {
    Initialize-DeadZoneType
    $level = [Aphrody.DeadZone.NativeMethods]::EnsureDpiAwareness()
    $name = switch ($level) { 0 { 'unaware' } 1 { 'system' } 2 { 'per-monitor' } default { 'inconnu' } }
    return [pscustomobject]@{ Level = $level; Name = $name }
}

function Get-ScriptFullPath {
    if (-not $script:SelfPath) { throw 'Chemin du script introuvable : exécutez-le depuis un fichier .ps1.' }
    return $script:SelfPath
}

function Get-InstanceId { return ('{0}-{1}' -f $Edge, $(if ($Monitor -lt 0) { 'main' } else { $Monitor })) }
function Get-TaskName { return ('Aphrody-DeadZone-{0}' -f (Get-InstanceId)) }

function Resolve-Band {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    if ($Monitor -ge $screens.Count) {
        throw "Moniteur $Monitor inexistant ($($screens.Count) détecté(s)). Utilisez -ListMonitors."
    }
    $s = if ($Monitor -lt 0) { [System.Windows.Forms.Screen]::PrimaryScreen } else { $screens[$Monitor] }
    $b = $s.Bounds
    $isVertical = $Edge -in @('Left', 'Right')
    $span = if ($isVertical) { $b.Width } else { $b.Height }
    $thick = if ($script:UsePixels) { $Pixels } else { [int][Math]::Round($span * $script:PercentValue / 100.0) }
    if ($thick -lt 1 -or $thick -gt [int]($span / 2)) {
        throw "Épaisseur $thick px hors limites (1..$([int]($span / 2)) px pour $span px)."
    }
    switch ($Edge) {
        'Left'   { $r = [pscustomobject]@{ X = $b.Left; Y = $b.Top; W = $thick; H = $b.Height } }
        'Right'  { $r = [pscustomobject]@{ X = $b.Right - $thick; Y = $b.Top; W = $thick; H = $b.Height } }
        'Top'    { $r = [pscustomobject]@{ X = $b.Left; Y = $b.Top; W = $b.Width; H = $thick } }
        default  { $r = [pscustomobject]@{ X = $b.Left; Y = $b.Bottom - $thick; W = $b.Width; H = $thick } }
    }
    [pscustomobject]@{
        Device    = $s.DeviceName
        Primary   = $s.Primary
        Bounds    = ('{0}x{1} @ ({2},{3})' -f $b.Width, $b.Height, $b.Left, $b.Top)
        Thickness = $thick
        Span      = $span
        Band      = $r
    }
}

function Show-Monitor {
    $awareness = Initialize-DpiAwareness
    Write-Info ("DPI du processus : {0}" -f $awareness.Name)
    $screens = [System.Windows.Forms.Screen]::AllScreens
    for ($i = 0; $i -lt $screens.Count; $i++) {
        $s = $screens[$i]
        $dpi = [Aphrody.DeadZone.NativeMethods]::EffectiveDpi([int]($s.Bounds.Left + $s.Bounds.Width / 2), [int]($s.Bounds.Top + $s.Bounds.Height / 2))
        $dpiText = if ($dpi -gt 0) { '{0} DPI ({1}%)' -f $dpi, [int]($dpi * 100 / 96) } else { 'DPI inconnu' }
        Write-Info ("[{0}] {1}{2}  {3}x{4} @ ({5},{6})  zone de travail {7}x{8}  {9}" -f `
                $i, $s.DeviceName, $(if ($s.Primary) { ' (principal)' } else { '' }),
            $s.Bounds.Width, $s.Bounds.Height, $s.Bounds.Left, $s.Bounds.Top,
            $s.WorkingArea.Width, $s.WorkingArea.Height, $dpiText)
    }
}

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

function Get-RunArgumentLine {
    $script = Get-ScriptFullPath
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $script),
        '-Run', '-Apply', '-HideConsole', '-Edge', $Edge, '-Monitor', $Monitor)
    if ($script:UsePixels) { $a += @('-Pixels', $Pixels) }
    else { $a += @('-Percent', $script:PercentValue.ToString([System.Globalization.CultureInfo]::InvariantCulture)) }
    return ($a -join ' ')
}

# --- Actions -----------------------------------------------------------------------------------
function Invoke-Plan {
    $aw = Initialize-DpiAwareness
    $band = Resolve-Band
    Write-Info "Plan (aucune modification) :" Cyan
    Write-Info ("  moniteur   : {0}{1}, {2}" -f $band.Device, $(if ($band.Primary) { ' (principal)' } else { '' }), $band.Bounds)
    Write-Info ("  bande      : bord {0}, {1} px sur {2} px ({3:N1} %)" -f $Edge, $band.Thickness, $band.Span, ($band.Thickness * 100.0 / $band.Span))
    Write-Info ("  rectangle  : x={0} y={1} {2}x{3} (pixels physiques)" -f $band.Band.X, $band.Band.Y, $band.Band.W, $band.Band.H)
    Write-Info ("  DPI process: {0}" -f $aw.Name)
    Write-Info "Ajoutez -Run -Apply (maintenant), -Install -Apply (à chaque session), -Stop, -Uninstall -Apply, -ListMonitors."
}

function Invoke-RunBar {
    $aw = Initialize-DpiAwareness
    if ($aw.Level -eq 0) {
        throw 'Processus non DPI-aware : géométrie fausse. Lancez dans une nouvelle fenêtre powershell.exe (pas ISE/hôte déjà démarré).'
    }
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
        throw 'Thread MTA : relancez avec -STA (powershell.exe -STA -File ...).'
    }
    $band = Resolve-Band
    $id = Get-InstanceId
    $tip = 'Zone morte : {0} {1} px (moniteur {2})' -f $Edge, $band.Thickness, $Monitor
    if (-not $Apply) {
        Invoke-Plan
        Write-Info "[dry-run] -Run -Apply réserverait ce rectangle via SHAppBarMessage (ABM_NEW, QUERYPOS, SETPOS) et afficherait une icône « Quitter »." Yellow
        return
    }
    $mutex = New-Object System.Threading.Mutex($false, "Local\Aphrody.DeadZone.$id")
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) {
            Write-Info "Déjà en cours pour $id (utilisez -Stop pour le fermer)." Yellow
            return
        }
        if ($HideConsole) { [Aphrody.DeadZone.NativeMethods]::HideConsole() }
        [System.Windows.Forms.Application]::EnableVisualStyles()
        $edgeCode = @{ Left = 0; Top = 1; Right = 2; Bottom = 3 }[$Edge]
        $pxArg = if ($script:UsePixels) { $Pixels } else { 0 }
        $pctArg = if ($script:UsePixels) { 0.0 } else { $script:PercentValue }
        $form = New-Object Aphrody.DeadZone.DeadZoneBar -ArgumentList @(
            [int]$edgeCode, [int]$Monitor, [double]$pctArg, [int]$pxArg, "Local\Aphrody.DeadZone.Stop.$id", $tip)
        try {
            Write-Info ("Bande réservée : {0} ({1} px). Quitter : icône de la zone de notification." -f $Edge, $band.Thickness) Green
            [System.Windows.Forms.Application]::Run($form)
            if ($form.ErrorMessage) { throw $form.ErrorMessage }
        }
        finally { $form.Dispose() }
    }
    finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Invoke-StopBar {
    $id = Get-InstanceId
    try {
        $ev = [System.Threading.EventWaitHandle]::OpenExisting("Local\Aphrody.DeadZone.Stop.$id")
    }
    catch [System.Threading.WaitHandleCannotBeOpenedException] {
        Write-Info "Aucune instance en cours pour $id." Yellow
        return
    }
    try { [void]$ev.Set(); Write-Info "Arrêt demandé à l'instance $id (ABM_REMOVE puis sortie)." Green }
    finally { $ev.Dispose() }
}

function Invoke-InstallTask {
    $null = Initialize-DpiAwareness
    $band = Resolve-Band
    $name = Get-TaskName
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argLine = Get-RunArgumentLine
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    Write-Info "Plan d'installation :" Cyan
    Write-Info ("  tâche      : {0}{1} (utilisateur {2}, niveau limité, masquée)" -f $script:TaskFolder, $name, $userId)
    Write-Info ("  déclencheur: ouverture de session, délai 10 s")
    Write-Info ("  commande   : {0} {1}" -f $psExe, $argLine)
    Write-Info ("  bande      : {0}, {1} px (calculée maintenant sur {2})" -f $Edge, $band.Thickness, $band.Device)
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour enregistrer la tâche.' Yellow; return }

    $backup = Save-TaskBackup -TaskName $name
    if ($backup) { Write-Info "Tâche existante sauvegardée : $backup" }
    # Session interactive requise (appbar) : console hébergée par conhost --headless, jamais affichée.
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\conhost.exe') -Argument ('--headless "{0}" {1}' -f $psExe, $argLine)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    try { $trigger.Delay = 'PT10S' } catch { Write-Warning "Délai de déclenchement non appliqué : $($_.Exception.Message)" }
    $settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $reg = @{
        TaskName = $name; TaskPath = $script:TaskFolder; Action = $action; Trigger = $trigger
        Settings = $settings; Principal = $principal; Force = $true
        Description = 'Aphrody creator-kit : zone morte écran (appbar)'
    }
    try { $null = Register-ScheduledTask @reg }
    catch {
        if ($_.Exception.Message -match 'denied|refus|0x80070005') {
            throw "Accès refusé à l'enregistrement de la tâche : relancez PowerShell en administrateur (non vérifié : certains déclencheurs d'ouverture de session l'exigent). Alternative : placez un raccourci vers la commande ci-dessus dans shell:startup."
        }
        throw
    }
    Write-Info "Tâche installée. Démarrage immédiat : Start-ScheduledTask -TaskPath '$($script:TaskFolder)' -TaskName '$name'  (ou -Run -Apply)." Green
    Write-Info "Retrait : -Edge $Edge -Monitor $Monitor -Uninstall -Apply."
}

function Invoke-UninstallTask {
    $name = Get-TaskName
    $existing = Get-ScheduledTask -TaskName $name -TaskPath $script:TaskFolder -ErrorAction SilentlyContinue
    Write-Info "Plan de désinstallation :" Cyan
    Write-Info ("  arrêter l'instance {0} si elle tourne, exporter puis supprimer {1}{2} ({3})" -f (Get-InstanceId), $script:TaskFolder, $name, $(if ($existing) { 'présente' } else { 'absente' }))
    if (-not $Apply) { Write-Info '[dry-run] ajoutez -Apply pour appliquer.' Yellow; return }
    Invoke-StopBar
    if ($existing) {
        $backup = Save-TaskBackup -TaskName $name
        Unregister-ScheduledTask -TaskName $name -TaskPath $script:TaskFolder -Confirm:$false
        Write-Info "Tâche supprimée. Sauvegarde XML : $backup" Green
    }
}

# --- Point d'entrée ----------------------------------------------------------------------------
$modes = @($ListMonitors.IsPresent, $Run.IsPresent, $Install.IsPresent, $Uninstall.IsPresent, $Stop.IsPresent) | Where-Object { $_ }
if (@($modes).Count -gt 1) { throw 'Un seul mode à la fois : -ListMonitors, -Run, -Install, -Uninstall ou -Stop.' }
if ($PSBoundParameters.ContainsKey('Percent') -and $script:UsePixels) {
    throw '-Percent et -Pixels sont exclusifs.'
}
Assert-Windows
if ($Stop) { Invoke-StopBar }
elseif ($ListMonitors) { Show-Monitor }
elseif ($Run) { Invoke-RunBar }
elseif ($Install) { Invoke-InstallTask }
elseif ($Uninstall) { Invoke-UninstallTask }
else { Invoke-Plan }
