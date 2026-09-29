<#
.SYNOPSIS
  refactor-state (PowerShell) — vue d'ensemble de l'état du refactor :
  STATE.md + git log + git status + Status board. Portage de
  refactor-state.sh (lecture seule, aucun effet de bord).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest

$N2bRoot = if ($env:N2B_ROOT) { $env:N2B_ROOT }
    elseif ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT }
    else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
Set-Location $N2bRoot

Write-Host "── plan/STATE.md ──"
if (Test-Path "plan/STATE.md") {
    Get-Content "plan/STATE.md" | Write-Host
} else {
    Write-Host "(STATE.md absent — Phase 0 pas encore commencée ou jamais committée)"
}

Write-Host ""
Write-Host "── git log (20 derniers commits) ──"
git log --oneline -20

Write-Host ""
Write-Host "── git status ──"
$out = git status --short
if (-not $out) {
    Write-Host "(arbre propre)"
} else {
    $out | Write-Host
}

Write-Host ""
Write-Host "── plan/README.md Status board ──"
# Extrait le tableau « Status board » (en-tête + séparateur + toutes les
# lignes `|` qui suivent, jusqu'à la première ligne non-`|`) — portage
# fidèle de l'awk du .sh, y compris son `getline` pour la ligne séparatrice.
if (Test-Path "plan/README.md") {
    $lines = @(Get-Content "plan/README.md")
    $flag = 0
    $i = 0
    while ($i -lt $lines.Count) {
        $line = $lines[$i]
        if ($flag -eq 0 -and $line -match '^## Status board') { $flag = 1; $i++; continue }
        if ($flag -eq 1 -and $line -match '^\| Phase ') {
            Write-Host $line
            $i++
            if ($i -lt $lines.Count) { Write-Host $lines[$i] }
            $flag = 2
            $i++
            continue
        }
        if ($flag -eq 2 -and $line -match '^\|') { Write-Host $line; $i++; continue }
        if ($flag -eq 2 -and $line -notmatch '^\|') { break }
        $i++
    }
}
