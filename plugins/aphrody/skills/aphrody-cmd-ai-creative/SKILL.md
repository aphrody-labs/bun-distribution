---
name: aphrody-cmd-ai-creative
description: "Commandes IA et créatives de la CLI aphrody (chat, agy, agy-loop, antigravity, hermes, notebooklm, memory, firefly, design, logo): flags, variables d'env, features. Utiliser pour lancer, scripter ou diagnostiquer l'une d'elles."
version: "1.1.0"
metadata:
  source: aphrody native — apps/cli/src/lib.rs (enum Commands) et apps/cli/src/commands.rs
  since: "2026-05-23"
---

# aphrody — commandes IA / génératif / créatif

> **S'applique quand :** le binaire `aphrody` est installé (`aphrody --version`), idéalement depuis le monorepo Aphrody (`apps/cli`). Les commandes marquées *(feature)* n'existent que dans un build compilé avec cette feature Cargo. **Sinon :** lire `aphrody --help` et ne pas proposer une commande que ce binaire ne liste pas ; dans le monorepo, `docs/ecosystem/CLI.md` (généré) donne l'arbre exact des commandes.

Cross-platform (Linux #1, Windows, macOS). Vérité de référence : `aphrody <cmd> --help`.

## LLM & chat

- **`aphrody chat [--prompt <txt>]`** — agent turn-loop unifié (aphrody-chat : gemini-runtime, tools, memory, session, router, cost, context). Avec `--prompt` : un tour, réponse sur stdout ; sans : REPL ligne à ligne (`/help`, `/model`, `/tools`, `/exit`). Flags : `-m/--model` (`gemini/default`, `anthropic/claude-opus-4-7`), `--system`, `--stub` (backend déterministe, CI), `-a/--attach <PATH>` (répétable), `-l/--local` (llama-server / vLLM en loopback :8080). Backend par défaut : token **agy** ; s'il n'est pas configuré, repli automatique sur le backend local.
- **`aphrody agy …`** — forward vers le binaire natif Antigravity CLI (`agy`). Résolution : `$APHRODY_AGY_BIN` > emplacements d'installation par défaut > PATH. Avant de passer la main, provisionne `~/.gemini` (persona, serveur MCP `aphrody`, skills yolo) en best-effort.
- **`aphrody gemini …`** — **déprécié** : alias de `agy`. Honore encore `APHRODY_GEMINI_BIN` ou un fork in-tree s'ils existent, sinon forward vers `agy`. Préférer `aphrody agy`.
- **`aphrody agy-loop <start|stop|status|hook|hooks-json>`** — boucle de codage autonome pour `agy`. `start --goal "…" [--max N]` (défaut 50) arme la boucle pour le workspace courant ; `stop` la désarme ; `status` affiche l'état en JSON ; `hook` est le driver (stdin/stdout JSON) des hooks `Stop` et `PostInvocation` d'agy ; `hooks-json` imprime le fragment `hooks.json` qui les câble. La boucle s'arrête quand l'agent émet `APHRODY_LOOP_DONE` seul sur une ligne, sur arrêt demandé ou au plafond `--max`. État : `.agents/aphrody-loop.json`. (`AfterAgent` n'est que le dialecte du Gemini CLI déprécié.)
- **`aphrody antigravity <models|whoami|load|chat|onboard|refresh|login|token-info|config|state-sync|item-table|cloud-code>`** — surface API Antigravity pure, sans binaire `agy` : jeton lu dans le magasin d'identifiants de la plateforme (Windows Credential Manager, entrée `gemini:antigravity`) + RPC Cloud Code `v1internal` (`cloudcode-pa`). Sortie JSON. `chat --prompt <txt> [--model <id>]` (défaut `gemini-3-flash`) ; ex. `… | jq '.candidates[0].content'`.
- **`aphrody hermes --channel <discord|x>`** — agent multi-canaux voice-to-voice (modèle flash via le token agy). Flags : `--voice` (STT Whisper entrant + TTS ElevenLabs sortant), `--trigger <txt>` (ex. `@aphrody` ; vide = répond à tout), `-m/--model`, `--stub`, `--simulate <msg>` (traite un message synthétique et sort, sans token de canal). Env : `DISCORD_BOT_TOKEN` / `X_HANDLE`, `OPENAI_API_KEY` (STT), `ELEVENLABS_API_KEY` (TTS).
- **`aphrody notebooklm <list|create|delete|upload|chat|generate|download>`** — client RPC NotebookLM. Env : `NOTEBOOKLM_OAUTH_TOKEN` ou `NOTEBOOKLM_COOKIES`, plus `NOTEBOOKLM_AT_TOKEN` + `NOTEBOOKLM_BL_TOKEN` (XSRF + bootstrap exportés par l'UI web).
- **`aphrody memory migrate --from <mem0|honcho|sqlite-local|lance-db> --to <…> --agent-id <id> [--dry-run] [--json|--pretty]`** — copie les enregistrements d'un provider mémoire à un autre (trait `MemoryProvider`) ; `lance-db` demande la feature `memory-lancedb`. Env HTTP : `MEM0_API_KEY` / `HONCHO_API_KEY`. `migrate` est la seule sous-commande.

## Image / créatif

- **`aphrody firefly generate "<prompt>" --out <dir>`** *(feature `firefly`)* — Adobe Firefly Services (v3 async, OAuth S2S IMS). Env : `FIREFLY_CLIENT_ID` / `FIREFLY_CLIENT_SECRET`. Il n'existe pas de sous-commande `aphrody image`.
- **`aphrody design tokens [--format css|shadcn-registry] [--fusion] [--dark] [-o <fichier>]`** — tokens couleur Material 3 en CSS (`--md-sys-color-*` ; `--fusion` ajoute les feuilles shadcn et Tailwind v4) ou item `registry:theme` shadcn. Adossé à `crates/ui/m3-tokens` (`aphrody-m3-tokens`).
- **`aphrody logo [--ico <chemin>] [--svg <chemin>] [--maskable <chemin> [--size N]]`** — exporte le logo canonique (`crates/ui/identity/assets/logo/aphrody.webp`) : `.ico` multi-résolution, `.svg`, PNG maskable M3 (`--size`, défaut 512).

## Garde-fous

- Keyless par défaut (cookies/token agy) ; jamais committer une clé en clair.
- Features host-only (`firefly`, `forensics`, `index`, `rag`, `train`, `infer`, `jobs`, `ocr`) : absentes d'un build par défaut et du wasm ; la commande répond alors « `aphrody <cmd>` requires --features <feature> ».
