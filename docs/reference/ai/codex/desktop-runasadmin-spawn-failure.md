# Codex Desktop : « Failed to spawn Codex CLI » causé par un flag RUNASADMIN

**Date** : 2026-09-07 · **Plateforme** : Windows 11 Home 10.0.28000 · **Codex CLI** 0.153.4 · **App Desktop** 26.901.6511.0 · **Statut** : résolu

## Symptôme

L'application Codex Desktop s'ouvre brièvement puis se ferme. Aucune fenêtre exploitable, aucun rapport Crashpad, aucun événement `Application Error` dans le journal Windows.

Le log de l'app se termine invariablement par :

```
warning [AppServerConnection] app_server_connection.transport_connect_failed
  errorMessage="Failed to spawn Codex CLI at %LOCALAPPDATA%\OpenAI\Codex\bin\8e5b6932251c2c1c\codex.exe"
error   [AppServerConnection] fatal_error_broadcasted
error   Desktop bootstrap failed to start the main app phase=bootstrap-import-main
```

## Cause racine

Le binaire `codex.exe` portait le flag de compatibilité Windows **`RUNASADMIN`**, posé dans :

```
HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers
```

Quatre entrées étaient présentes, dont **précisément celle du binaire que l'app Desktop lance** :

```
%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe                              = ~ RUNASADMIN
%LOCALAPPDATA%\OpenAI\Codex\bin\8e5b6932251c2c1c\codex.exe                      = ~ RUNASADMIN   <-- celui-ci
%USERPROFILE%\.codex\packages\standalone\current\bin\codex.exe                               = ~ RUNASADMIN
%USERPROFILE%\.codex\packages\standalone\releases\0.153.2-x86_64-pc-windows-msvc\bin\codex.exe = ~ RUNASADMIN
```

### Pourquoi cela casse l'app

L'app Desktop est une application Electron : elle démarre son back-end en appelant `child_process.spawn()` sur `codex.exe`, ce qui se traduit par un `CreateProcess` Win32.

`CreateProcess` **ne sait pas élever un processus**. Quand la cible porte `RUNASADMIN`, l'appel échoue avec `ERROR_ELEVATION_REQUIRED` (740) — seul `ShellExecute` avec le verbe `runas` peut déclencher l'invite UAC. L'app n'a aucun moyen de récupérer cette erreur : le transport `stdio` ne s'établit jamais et le bootstrap avorte.

Le flag posé sur un binaire empoisonne donc tout lancement **programmatique**, pas seulement les double-clics.

### Ce qui rendait le diagnostic trompeur

- Lancer `codex.exe --version` ou `codex.exe app-server` **à la main fonctionnait** — parce que le shell de test était **déjà élevé**, aucune nouvelle élévation n'était requise.
- La panne se reproduisait **aussi bien élevé que non élevé** au niveau de l'app, ce qui écarte à tort la piste UAC si l'on ne pense pas au flag de compatibilité.
- `codex doctor` rapportait l'app Desktop comme correctement installée : le flag est invisible pour lui.

### Fausses pistes écartées

| Hypothèse | Vérification | Verdict |
| --- | --- | --- |
| Binaire corrompu ou absent | `codex.exe --version` → `codex-cli 0.153.4` | ✗ |
| ACL insuffisantes sur `bin\` | `aphro` a `FullControl` sur toute la chaîne de dossiers | ✗ |
| Blocage Defender / règle ASR | Aucun événement Defender, aucune règle ASR active | ✗ |
| Cache CLI corrompu | Renommage de `bin\` → l'app le reprovisionne, panne identique | ✗ |
| `cwd` de workspace inexistant | `selected-project` = `%USERPROFILE%\niers`, présent | ✗ |
| Redirection MSIX de `%LOCALAPPDATA%` | Le manifeste déclare `unvirtualizedResources` | ✗ |

## Correctif

Supprimer les entrées `RUNASADMIN` visant `codex.exe`, avec sauvegarde préalable de la clé.

```powershell
$path = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'

# 1. Sauvegarde
$bak = "$env:USERPROFILE\codex-runasadmin-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').reg"
reg.exe export "HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" $bak /y

# 2. Inspection
$k = Get-Item $path
$targets = $k.GetValueNames() | Where-Object { $_ -match 'odex' }
$targets | ForEach-Object { "$_ = $($k.GetValue($_))" }

# 3. Suppression
foreach ($t in $targets) { Remove-ItemProperty -Path $path -Name $t -Force }

# 4. Relance
Get-Process Codex -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process explorer.exe "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
```

Vérifier ensuite `HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers` : le flag peut aussi y avoir été posé pour toute la machine.

### Résultat

L'app démarre et reste en vie ; le log ne contient plus ni `Failed to spawn` ni `bootstrap failed`.

### Restauration

```powershell
reg.exe import "$env:USERPROFILE\codex-runasadmin-backup-<horodatage>.reg"
```

## À retenir

> Ne jamais poser « Exécuter en tant qu'administrateur » (onglet *Compatibilité*, ou une entrée `AppCompatFlags\Layers`) sur un binaire qu'un autre programme lance en arrière-plan.

Codex est concerné au premier chef : l'app Desktop, le CLI et les serveurs MCP se lancent mutuellement par `CreateProcess`. Un seul flag suffit à briser toute la chaîne.

### La bonne façon de faire tourner Codex élevé

Le CLI gère l'élévation lui-même. Utiliser la configuration prévue dans `~/.codex/config.toml` :

```toml
[windows]
sandbox = "elevated"
```

Pour une commande ponctuelle, élever le **terminal**, jamais le binaire :

```powershell
Start-Process pwsh -Verb RunAs -ArgumentList '-NoExit','-Command','codex'
```

## Vérification rapide

```powershell
# Ne doit rien retourner
@(
  'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers',
  'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
) | ForEach-Object {
  if (Test-Path $_) { (Get-Item $_).GetValueNames() | Where-Object { $_ -match 'odex' } }
}
```
