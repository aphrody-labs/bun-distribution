<#
.SYNOPSIS
  n2b autonomous refactor — env + fonctions PowerShell. Portage de
  n2b-env.sh. Dot-source pour obtenir les commandes n2b-* :

      . <plugin-root>/scripts/n2b-env.ps1

  (idempotent — peut être ajouté à $PROFILE).

.DESCRIPTION
  Windows n'a pas de tmux : n2b-start lance `claude` en process caché
  (Start-Process -WindowStyle Hidden), le PID est tracé dans un fichier
  d'état JSON. Conséquences (voir n2b-help) :
    - n2b-attach / n2b-peek ne sont PAS un attach tmux interactif : ils
      lisent le fichier de log, en lecture seule.
    - n2b-stop force l'arrêt (Stop-Process) — pas de SIGINT propre vers un
      process sans console partagée sous Windows.
#>

# N2B_ROOT = racine du plugin. Explicite > CLAUDE_PLUGIN_ROOT > dérivé de
# l'emplacement de ce script > $HOME/n2b.
if (-not $env:N2B_ROOT) {
    $env:N2B_ROOT = if ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT }
        else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
}
if (-not $env:N2B_ROOT) { $env:N2B_ROOT = Join-Path $HOME "n2b" }
if (-not $env:N2B_LOG) { $env:N2B_LOG = Join-Path ([System.IO.Path]::GetTempPath()) "n2b-refactor.log" }
if (-not $env:N2B_SESSION_FILE) { $env:N2B_SESSION_FILE = Join-Path ([System.IO.Path]::GetTempPath()) "n2b-refactor-session.json" }

function Get-N2bSession {
    if (-not (Test-Path $env:N2B_SESSION_FILE)) { return $null }
    $s = Get-Content -Raw $env:N2B_SESSION_FILE | ConvertFrom-Json
    if (Get-Process -Id $s.Pid -ErrorAction SilentlyContinue) { return $s }
    return $null
}

function n2b-start {
    if (Get-N2bSession) {
        Write-Host "n2b: session déjà active (utilise n2b-attach ou n2b-restart)" -ForegroundColor Red
        return
    }
    & pwsh -NoProfile -File (Join-Path $env:N2B_ROOT "scripts/refactor-start.ps1")
}

function n2b-attach {
    # Pas de vrai attach interactif sous Windows (pas de tmux) — on suit
    # le log en live, lecture seule. Ctrl-C ici arrête juste le suivi, pas
    # la session (utiliser n2b-stop/n2b-kill pour ça).
    Write-Host "n2b: pas d'attach interactif sous Windows — suivi live du log (Ctrl-C pour quitter le suivi)" -ForegroundColor Yellow
    Get-Content -Path $env:N2B_LOG -Wait -Tail 20
}

function n2b-peek {
    if (Test-Path $env:N2B_LOG) {
        Get-Content -Path $env:N2B_LOG -Tail 100
    } else {
        Write-Host "n2b: log absent ($env:N2B_LOG)"
    }
}

function n2b-log {
    Get-Content -Path $env:N2B_LOG -Wait
}

function n2b-state {
    & pwsh -NoProfile -File (Join-Path $env:N2B_ROOT "scripts/refactor-state.ps1")
}

function n2b-status {
    $s = Get-N2bSession
    if ($s) {
        Write-Host "n2b: running (pid $($s.Pid), depuis $($s.StartedAt))"
    } else {
        Write-Host "n2b: not running"
    }
}

function n2b-stop {
    $s = Get-N2bSession
    if (-not $s) { Write-Host "n2b: not running"; return }
    # Pas d'équivalent fiable de SIGINT vers un process sans console
    # partagée sous Windows — arrêt forcé. La mission doit checkpoint
    # plan/STATE.md en continu, pas seulement à la sortie propre.
    Stop-Process -Id $s.Pid -ErrorAction SilentlyContinue
    Write-Host "n2b: process $($s.Pid) arrêté (forcé — pas de SIGINT propre sous Windows)"
}

function n2b-kill {
    $s = Get-N2bSession
    if ($s) {
        Stop-Process -Id $s.Pid -Force -ErrorAction SilentlyContinue
        Write-Host "n2b: killed"
    } else {
        Write-Host "n2b: not running"
    }
    Remove-Item $env:N2B_SESSION_FILE -ErrorAction SilentlyContinue
}

function n2b-restart {
    n2b-kill
    Start-Sleep -Seconds 1
    n2b-start
}

function n2b-green {
    Push-Location $env:N2B_ROOT
    try { bun run green-gate } finally { Pop-Location }
}

function n2b-help {
    @"
n2b autonomous refactor — helpers PowerShell :
  n2b-start    Démarre la session en arrière-plan (Claude headless + plan/MISSION.md)
  n2b-attach   Suit le log en live (PAS un attach interactif — pas de tmux sous Windows)
  n2b-peek     Snapshot non-interactif (dernières 100 lignes du log)
  n2b-log      Get-Content -Wait sur `$env:N2B_LOG
  n2b-state    plan/STATE.md + git log + git status + Status board
  n2b-status   Tourne ou pas ?
  n2b-stop     Arrêt forcé (Stop-Process — pas de SIGINT propre sous Windows)
  n2b-kill     Tue brutalement + nettoie le fichier d'état
  n2b-restart  kill + start (reprise depuis STATE.md)
  n2b-green    Lance le green-gate complet (TS + Rust + baseline + codegen)
  n2b-help     Cette aide

Équivalents bun (utilisables depuis n'importe où dans le repo) :
  bun run refactor:{start,attach,peek,state,status,stop,kill,restart,log}
  bun run green-gate            # green-gate complet en bun
  turbo run //#green-gate       # idem mais orchestré par turbo (DAG parallèle)

Sous Linux/macOS, préférer scripts/n2b-env.sh (tmux — attach et SIGINT réels).
"@
}
