---
name: aphrody-cmd-codex
description: "aphrody CLI Codex-compatible commands (exec, resume, fork, codex, app-server, config): agentic runs and configuration."
version: "1.0.0"
metadata:
  source: aphrody native — crates/aphrody/src/main.rs (Codex compatibility)
  since: "2026-09-19"
---

# aphrody — Commandes Codex-compatibles

Aphrody implémente l'interface de commande et le protocole complets d'OpenAI Codex en environnement autonome (Zero Human-in-the-loop).

## Commandes Principales

- **`aphrody exec "<prompt>"`** — Exécute une tâche de façon autonome de bout en bout.
  - `--oss` : Force l'utilisation d'un modèle open-source local via le superviseur `llama-server`.
  - `-m, --model <id>` : Spécifie le modèle (`qwen2.5-coder-7b-instruct-q5km`, `gpt-oss-20b`, `claude-3-5-sonnet`, etc.).
  - `--experimental-json` : Émet le flux d'événements NDJSON compatible avec le SDK TypeScript Codex (`thread.started`, `turn.*`, `item.*`).
  - `--sandbox <mode>` : Mode sandbox (`workspace-write`, `read-only`, `danger-full-access`).
  - `-c, --config key=value` : Override TOML à la volée (ex: `-c rag.mode=hybrid`).
- **`aphrody resume <session_id>`** — Reprend une session existante depuis son journal d'événements rollout.
- **`aphrody fork <session_id>`** — Crée un nouveau fil d'exécution dérivé d'une session précédente.
- **`aphrody codex …`** — Provisionne et relaie vers le binaire Codex local ou le runtime natif.
  - Enregistre `aphrody` et `aphrody web` en serveurs MCP stdio dans `$CODEX_HOME/config.toml`.
  - Injecte la persona YOLO dans `$CODEX_HOME/AGENTS.md`.
- **`aphrody app-server`** — Démarre le serveur JSON-RPC v2 compatible avec les extensions et IDEs OpenAI Codex.
- **`aphrody config {show|path|import-codex}`** :
  - `show` : Affiche la configuration active résolue (TOML ou `--json`).
  - `path` : Affiche le chemin vers `~/.aphrody/config.toml`.
  - `import-codex` : Importe les providers et serveurs MCP de `~/.codex/config.toml` de manière non-destructive.
