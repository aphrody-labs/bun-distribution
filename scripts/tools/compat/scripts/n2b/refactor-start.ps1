<#
.SYNOPSIS
  refactor-start (PowerShell) — lance Claude headless en arrière-plan pour
  exécuter plan/MISSION.md de bout en bout. Portage de refactor-start.sh.

.DESCRIPTION
  Windows n'a pas d'équivalent de tmux : ce script lance `claude` comme
  process caché (Start-Process -WindowStyle Hidden) avec stdout/stderr
  redirigés vers $N2B_LOG, et trace le PID dans un fichier d'état JSON.
  Conséquences (voir n2b-env.ps1 / n2b-help) :
    - n2b-attach/n2b-peek ne sont PAS un vrai attach tmux : ils "tail" le
      fichier de log (snapshot ou suivi live), lecture seule.
    - n2b-stop ne peut pas envoyer un vrai SIGINT à un process cliqué sans
      console partagée sur Windows ; c'est un Stop-Process forcé — la
      mission doit checkpoint plan/STATE.md fréquemment, pas seulement à
      la sortie propre.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$N2bRoot = if ($env:N2B_ROOT) { $env:N2B_ROOT }
    elseif ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT }
    else { (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
$N2bLog = if ($env:N2B_LOG) { $env:N2B_LOG } else { Join-Path ([System.IO.Path]::GetTempPath()) "n2b-refactor.log" }
$StateFile = if ($env:N2B_SESSION_FILE) { $env:N2B_SESSION_FILE } else { Join-Path ([System.IO.Path]::GetTempPath()) "n2b-refactor-session.json" }

# Pré-conditions.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Error "claude pas dans PATH"; exit 1
}
$missionPath = Join-Path $N2bRoot "plan/MISSION.md"
if (-not (Test-Path $missionPath)) {
    Write-Error "$missionPath introuvable"; exit 1
}

if (Test-Path $StateFile) {
    $existing = Get-Content -Raw $StateFile | ConvertFrom-Json
    $proc = Get-Process -Id $existing.Pid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "n2b: session déjà active (pid $($existing.Pid)) — abort" -ForegroundColor Red
        Write-Host "     (n2b-attach pour voir, n2b-restart pour relancer)" -ForegroundColor Red
        exit 1
    }
}

$mission = Get-Content -Raw $missionPath
$missionFile = Join-Path ([System.IO.Path]::GetTempPath()) ("n2b-mission-" + [guid]::NewGuid().ToString("N") + ".txt")
Set-Content -Path $missionFile -Value $mission -NoNewline

$gitHead = try { (git -C $N2bRoot rev-parse --short HEAD 2>$null) } catch { "?" }
if (-not $gitHead) { $gitHead = "?" }

$banner = @"

════════════════════════════════════════════════════════════
  n2b refactor — session démarrée $(Get-Date -Format "o")
  N2B_ROOT  = $N2bRoot
  N2B_LOG   = $N2bLog
  git HEAD  = $gitHead
════════════════════════════════════════════════════════════
"@
Add-Content -Path $N2bLog -Value $banner

# `claude -p` lit la mission depuis un fichier (Get-Content -Raw) pour
# éviter toute limite de longueur/échappement de ligne de commande — la
# version bash passe la mission inline via printf %q, impossible à
# répliquer proprement en PowerShell (pas d'équivalent shell-safe direct).
$wrapper = "Set-Location '$N2bRoot'; " +
    "`$mission = Get-Content -Raw '$missionFile'; " +
    "claude -p `$mission --dangerously-skip-permissions *>> '$N2bLog'; " +
    "Remove-Item '$missionFile' -ErrorAction SilentlyContinue"

$proc = Start-Process -FilePath "pwsh" `
    -ArgumentList @("-NoProfile", "-Command", $wrapper) `
    -WindowStyle Hidden -PassThru

@{ Pid = $proc.Id; StartedAt = (Get-Date -Format "o"); Log = $N2bLog; Root = $N2bRoot } |
    ConvertTo-Json | Set-Content -Path $StateFile

Write-Host "n2b: started"
Write-Host "  pid     : $($proc.Id)"
Write-Host "  log     : $N2bLog"
Write-Host "  peek    : n2b-peek     (dernières lignes du log)"
Write-Host "  log     : n2b-log      (tail -f du log)"
Write-Host "  state   : n2b-state    (STATE.md + git)"
Write-Host "  stop    : n2b-stop     (Stop-Process — pas de SIGINT propre sous Windows, voir n2b-help)"
