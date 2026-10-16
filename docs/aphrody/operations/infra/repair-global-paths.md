<!-- SPDX-License-Identifier: Apache-2.0 -->
# Réparer les chemins globaux Windows

`bun scripts/tools/infra/repair-global-paths.ts` examine par défaut uniquement la commande MCP Bun de `~/.codex/config.toml`. Il compare l'ancien chemin `C:\Windows\System32\bun.exe` à l'exécutable qui lance le script. Ce dernier doit exister, être un PE et être reconnu par `bun agent-plugin doctor --json` comme runtime Aphrody courant. Sans `--apply`, aucun fichier n'est modifié.

```powershell
bun scripts/tools/infra/repair-global-paths.ts
bun scripts/tools/infra/repair-global-paths.ts --apply
bun scripts/tools/infra/repair-global-paths.ts --audit-path
```

Pour les autres exécutables, bibliothèques ou répertoires d'installation, fournir un manifeste JSON de règles explicites. Chaque règle donne `id`, `config` (chemin absolu), `format` (`toml` ou `json`), `key` (chemin des clés séparées par des points), `from`, `to` (chemins absolus), `kind` (`executable`, `library` ou `installation`) et `sha256` du binaire cible. Pour `installation`, ajouter `anchor` relatif au répertoire cible : son SHA-256 sert de preuve. Le cas Bun peut employer `provenance: "aphrody-bun"` à la place du hash. Le manifeste se passe avec `--manifest <fichier>`, et `--apply` reste nécessaire pour écrire.

Une règle de `PATH` omet `config`, `format` et `key`, et déclare `scope: "user"` ou `"machine"`, `kind: "installation"`, `from`, `to`, `anchor` et `sha256`. Elle remplace exactement une entrée, garde l'ordre et le type `REG_SZ` ou `REG_EXPAND_SZ`, puis relit le registre. Elle échoue si la source est ambiguë, si le répertoire cible ou son ancre ne sont pas vérifiés ou si la valeur du registre a changé. L'écriture du `PATH` machine requiert les droits Windows habituels.

Une règle ne modifie qu'une valeur qui correspond exactement à `from`. Le document est reparsé après remplacement ; l'écriture temporaire est atomique et conserve les permissions du fichier. Aucun exécutable n'est installé ni supprimé. `--audit-path` compte les entrées littérales manquantes et dupliquées du `PATH` du processus, de l'utilisateur et de la machine, sans modifier ces variables ni afficher leurs valeurs. Les entrées à expansion ou relatives sont ignorées pour éviter les faux positifs. Les autres sorties affichent seulement l'identifiant et l'état de chaque règle, jamais les valeurs des configurations protégées.
