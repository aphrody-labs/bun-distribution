---
name: aphrody-cmd-codex
description: "Commandes de la CLI aphrody de forme Codex (exec, resume, fork, codex, app-server, session, config) : flags, JSONL, sessions, configuration. Utiliser pour une exécution agentique scriptée ou la config TOML d'aphrody."
version: "1.1.0"
metadata:
  source: aphrody native — apps/cli/src/{lib,exec_cmd,session_cmd,codex_provision,config_cmd}.rs
  since: "2026-09-19"
---

# aphrody — Commandes de forme Codex

> **S'applique quand :** le binaire `aphrody` est installé (`aphrody --version`), idéalement depuis le monorepo Aphrody (`apps/cli`). **Sinon :** lire `aphrody <cmd> --help` et ne pas supposer un flag absent ; `aphrody codex` exige en plus le binaire `codex` (`$APHRODY_CODEX_BIN` ou PATH) et, sans lui, il faut s'en tenir à `exec`/`resume`/`fork`.

Ces commandes reprennent la forme de celles d'OpenAI Codex (flux d'événements JSONL, sessions persistées, config TOML). Aucune parité complète n'est revendiquée : vérifier chaque flag avec `--help`.

## Commandes principales

Options communes aux commandes agent (`exec`, `resume`, `fork`) : `-c/--config key=value` (override TOML ; les clés se lisent avec `aphrody config show`), `-m/--model <id>`, `-p/--profile`, `--oss` (fournisseur local open-weight), `--local-provider <llama|ollama|lmstudio|vllm>`, `-C/--cd <dir>`, `--yolo` (aucune limite artificielle d'itérations).

- **`aphrody exec ["<prompt>"]`** — exécute une tâche de façon autonome (prompt absent ou `-` : lu sur stdin). Flags propres : `--json` (alias `--experimental-json`) émet le flux d'événements JSONL de forme Codex, `--stub` (backend hors-ligne déterministe), `--ephemeral` (sans persistance), `-o/--output-last-message <fichier>`, `--output-schema <PATH>` (valide la réponse finale contre un JSON Schema), `--skip-git-repo-check`, `--image <PATH>` (répétable), `--max-tool-iterations <N>` (0 = jusqu'à la fin).
- **`aphrody resume [SESSION_ID] [PROMPT] [--last]`** — reprend une session enregistrée (id ou préfixe non ambigu). Aussi : `aphrody exec resume`.
- **`aphrody fork [SESSION_ID] [PROMPT] [--last]`** — démarre une nouvelle session avec la conversation enregistrée comme historique. Aussi : `aphrody exec fork`.
- **`aphrody codex …`** — forward vers le binaire `codex` (résolution : `$APHRODY_CODEX_BIN` > PATH > emplacements globaux npm/bun > `~/.local/bin`). Avant de passer la main, provisionne `$CODEX_HOME` (défaut `~/.codex`) : section `[mcp_servers.aphrody]` dans `config.toml` et bloc de persona YOLO dans `AGENTS.md` ; `APHRODY_CODEX_NO_PROVISION=1` désactive cette étape (`apps/cli/src/codex_provision.rs`).
- **`aphrody app-server [--http] [--addr 127.0.0.1:8765]`** — sert le protocole app-server local sur stdio ou en HTTP loopback. `aphrody session serve` sert l'app-server de forme Codex (JSON-RPC délimité par lignes) sur stdin/stdout, ou en HTTP avec `--http`.
- **`aphrody config {show|path|import-codex}`** :
  - `show [--json]` : configuration active résolue (TOML, ou JSON).
  - `path` : chemin de `~/.aphrody/config.toml`.
  - `import-codex` : importe et superpose la configuration de `~/.codex/config.toml`.
