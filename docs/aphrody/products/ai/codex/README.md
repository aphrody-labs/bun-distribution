# Codex — notes d'exploitation

Notes de dépannage sur l'installation locale de Codex (CLI + application Desktop) sous Windows 11.

| Document | Sujet |
| --- | --- |
| [`desktop-runasadmin-spawn-failure.md`](../../../reference/ai/codex/desktop-runasadmin-spawn-failure.md) | L'app Desktop refuse de démarrer : `Failed to spawn Codex CLI` causé par un flag `RUNASADMIN` |

## Contexte de l'installation

| Élément | Chemin |
| --- | --- |
| App Desktop (MSIX) | `C:\Program Files\WindowsApps\OpenAI.Codex_<version>_x64__2p2nqsd0c76g0\app\Codex.exe` |
| Données de l'app | `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\` |
| Logs de l'app | `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Codex\Logs\<AAAA>\<MM>\<JJ>\` |
| CLI standalone | `%USERPROFILE%\.codex\packages\standalone\current\bin\codex.exe` |
| CLI utilisé par l'app | `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` |
| Configuration | `%USERPROFILE%\.codex\config.toml` |

## Réflexes de diagnostic

```powershell
# Bilan de santé complet de l'installation
codex doctor

# Dernier log de l'app Desktop
Get-ChildItem "$env:LOCALAPPDATA\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Codex\Logs" -Recurse -Filter *.log |
  Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Tail 40

# Lancer l'app packagée (contexte utilisateur, non élevé)
Start-Process explorer.exe "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
```
