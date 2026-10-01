---
name: aphrody-cmd-system-net
description: "Commandes système, cycle de vie et réseau de la CLI aphrody (version, doctor, auth, self, mirror, oc-*, search, a2a, mcp, notify, ide, term, index), dont les destructives. Utiliser pour diagnostiquer, installer, notifier ou nettoyer l'état local."
version: "1.1.0"
metadata:
  source: aphrody native — apps/cli/src/lib.rs (enum Commands), apps/cli/src/{commands,oc_cmd,mcp_cmd,index_cmd}.rs
  since: "2026-05-23"
---

# aphrody — commandes système / cycle de vie / réseau / intégration

> **S'applique quand :** le binaire `aphrody` est installé (`aphrody --version`), idéalement depuis le monorepo Aphrody (`apps/cli`) ; les commandes marquées *(feature)* n'existent que dans un build compilé avec cette feature. **Sinon :** lire `aphrody --help` et ne pas proposer une commande que ce binaire ne liste pas ; dans le monorepo, `docs/ecosystem/CLI.md` (généré) donne l'arbre exact.

Cross-platform (Linux #1, Windows, macOS). Vérité de référence : `aphrody <cmd> --help`.

## Diagnostic & cycle de vie

- **`aphrody version [--json]`** — version + état système.
- **`aphrody doctor [--json]`** — diagnostic env + intégration A2A + supply-chain (first-impression).
- **`aphrody auth [--force]`** — authentification Google (God Mode / OAuth2).
- **`aphrody completions <bash|zsh|fish|powershell|elvish>`** — génère les completions shell (`pwsh` est accepté comme alias de `powershell`).
- **`aphrody self <install-path|bootstrap>`** — installer / bootstrap natif (remplace les scripts `.ps1`/`.sh`) : `install-path` enregistre le binaire sur le PATH utilisateur ; `bootstrap [--check]` inventorie la toolchain de dev.
- **`aphrody mirror [start|stop|status]`** — gère le mirroring des assets MD3 (argument positionnel, défaut `start`).
- **`aphrody cros <sync|build>`** — compilation hyper-optimisée de ChromeOS.

## openclaw (état local) — ⚠ certaines opérations sont destructives

- **`aphrody oc-onboard [--workspace D] [--non-interactive] [--accept-risk] [-f/--force] [--skip-bootstrap]`** — bootstrap état local + seed config. `--non-interactive` exige `--accept-risk`.
- **`aphrody oc-reset --scope <config|config-creds-sessions|full> [--yes] [--dry-run]`** — ⚠ **destructif** : reset état local. `--yes` requis (sauf `--dry-run`). Toujours proposer `--dry-run` d'abord.
- **`aphrody oc-uninstall [--service|--state|--workspace|--app|--all] [--yes] [--dry-run]`** — ⚠ **destructif** : désinstalle des scopes.
- **`aphrody oc-pairing <list|approve|add>`** — pairing DM sécurisé (`~/.aphrody/pairing.json`) : `list [--channel C] [--json]`, `approve <channel> <code>`, `add <channel> <id> <code>`.
- **`aphrody oc-docs <query> [--url-only]`** — ouvre / cherche le site de doc.

## Réseau / intégration

- **`aphrody search <termes…>`** — recherche Google native. Il n'existe pas de sous-commande `aphrody dns` : la résolution DNS passe par l'outil MCP `aphrody_google_dns` (serveur `aphrody-kernel` connecté) ou par `aphrody google …` (forward vers Aphrody Web : Search, Translate, DNS, Books, Gemini Web, TTS).
- **`aphrody a2a <serve|tick|invoke|send|peers>`** — coordination A2A : `serve [--bind 127.0.0.1:8788]` (listener HTTP `/ping`, `/msg`, JSON-RPC, agent card), `tick --iteration N …` (ajoute une enveloppe JSONL), `invoke --peer <grok|agy|claude|codex|bxc> [--dry-run] [--claim <fichier>] "<prompt>"` (lance une CLI pair), `send --target <pair> [--source S] [--yolo] "<instruction>"` (JSON-RPC `message/send`), `peers` (pairs résolus). Un texte libre sans sous-commande (`aphrody <prompt>`) est routé vers le client A2A (`$APHRODY_A2A_ENDPOINT`, défaut `http://localhost:8788`).
- **`aphrody mcp <list|call|add|get|remove>`** — Model Context Protocol : serveurs TOML dans `~/.aphrody/config.toml`, plus l'ancien JSON `~/.config/aphrody/mcp.json` (ou `$APHRODY_MCP_CONFIG`) ; `call <serveur> <outil> --args '<json>'`.
- **`aphrody notify --channel <slack|telegram|matrix|discord> --message <txt> [--room R] [--attach F…]`** — envoie un message (pièces jointes : Discord seulement). Sans `--room`, lit `SLACK_CHANNEL` / `TELEGRAM_CHAT_ID` / `MATRIX_ROOM_ID` / `DISCORD_DM_CHANNEL_ID` ; jetons : `SLACK_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `MATRIX_HOMESERVER` + `MATRIX_ACCESS_TOKEN` + `MATRIX_USER_ID`, `DISCORD_BOT_TOKEN`.
- **`aphrody ide <info|extensions|re|state|launch>`** — inspecteur de l'IDE Antigravity (lecture seule sauf `launch`). Ex. : `aphrody ide info --json | jq '.ideVersion'`.
- **`aphrody term [--addr 127.0.0.1:8788] [--shell …] [--cwd D] [--token T]`** — pont WebSocket-PTY pour le frontend WASM (localhost uniquement). Même port par défaut que `a2a serve` : n'en lancer qu'un ou fixer `--addr` / `--bind`.
- Autres surfaces système : `os`, `native`, `shell`, `infra`, `ssh`, `vpn`, `mail`, `git`, `docs`, `package`, `runtime`, `model` — voir `aphrody <cmd> --help`.

## Index recherche locale

- **`aphrody index build --root <dir> [--db F]`** / **`aphrody index search "<q>" [--limit N] [--json]`** *(feature `index`)* — index FTS5 metadata-only (mirror du `local_files.db` Google), base par défaut `~/.aphrody/fsindex.db`.

## Garde-fous

- Opérations destructives (`oc-reset`, `oc-uninstall`) : exiger confirmation explicite (`--yes`) ou proposer `--dry-run` ; jamais en aveugle.
- `term` : bind localhost strict, jamais exposé publiquement.
