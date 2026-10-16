<!-- SPDX-License-Identifier: Apache-2.0 -->

# Unified Polyglot Stack — aphrody (2026)

Architecture polyglotte universelle régissant l'écosystème Aphrody :
Rust Native Core, Station de Travail RustOS 2026, Moteur d'Inférence IA Embarqué (CUDA / DirectML), Surface Bun/TypeScript M3, et Couche Python.

---

## 1. Station de Travail & Outils Systèmes Rust 2026 (RustOS Workstation)

L'ensemble des utilitaires standards GNU/Linux et commandes Windows lentes ont été remplacés par des binaires natifs en Rust.

| Commande / Alias | Remplacement Classique | Outil Rust 2026 | Version | Rôle & Fonctionnalité Clé |
|---|---|---|---|---|
| `nu` | `powershell.exe` / `cmd.exe` | **Nushell** | v0.115.1 | Shell structuré orienté données (pipelines de tables typées) |
| Prompt | Prompt Windows standard | **Starship** | v1.26.0 | Prompt contextuel multi-shell (Git, Rust, Bun, Python) |
| `zellij` | tmux / screen | **Zellij** | v0.45.1 | Multiplexeur de terminal moderne avec layouts et plugins WASM |
| `y`, `fm` | Windows Explorer / ranger | **Yazi** | v26.5.6 | Explorateur terminal asynchrone GPU avec prévisualisation et auto-CWD |
| `ls`, `dir` | GNU `ls` / Windows `dir` | **Eza** | v0.23.5 | Icônes Nerd Font, statut Git inline, timestamps relatifs, arborescence |
| `cat`, `type` | GNU `cat` / `type` | **Bat** | v0.26.1 | Coloration syntaxique, intégration git diff, Material Theme |
| `grep` | GNU `grep` / `findstr` | **Ripgrep** (`rg`) | v15.2.0 | Recherche textuelle récursive multithreadée |
| `find` | GNU `find` | **Fd** | v10.5.0 | Recherche de fichiers rapide avec respect du `.gitignore` |
| `z` | `cd` / autojump | **Zoxide** | v0.10.0 | Navigation intelligente par fréquence et récence (frecency) |
| `sk` | `fzf` | **Skim** | v0.16.0 | Sélecteur flou (fuzzy finder) interactif universel |
| `top` | Task Manager / `htop` | **Bottom** (`btm`) | v0.14.9 | Moniteur de ressources graphique interactif |
| `ps` | Windows `tasklist` | **Procs** | v0.14.12 | Arbre hiérarchique des processus et ports ouverts |
| `du` | GNU `du` | **Dust** | v1.2.5 | Visualisation graphique de l'espace disque |
| `dua` | `ncdu` | **dua-cli** | v2.44.0 | Calcul d'espace disque parallèle et nettoyage interactif |
| Coreutils | GNU coreutils | **uutils-coreutils** | v0.11.0 | 70+ utilitaires Linux réécrits en Rust natif (`uname`, `wc`, `cat`, etc.) |
| `sg` | `sed` / `awk` | **Ast-grep** | v0.45.3 | Recherche et refactoring basés sur l'arbre syntaxique (AST) |
| `sd` | `sed` regex | **sd** | v1.0.0 | Remplacement regex intuitif et direct |
| `d` | `git diff` | **Git-Delta** | v0.19.2 | Diffs Git syntaxiques avec mise en page côte à côte |
| `gui` | `lazygit` / `tig` | **GitUI** | v0.28.1 | Client Git TUI rapide au clavier |
| `jj` | `git` / `hg` | **Jujutsu** (`jj`) | v0.28.0 | VCS compatible Git avec système d'annulation automatique |
| `hx` | `vim` / `neovim` / `nano` | **Helix** | v25.07.1 | Éditeur modal moderne, sélections multiples, LSP et Tree-sitter natifs |
| `hex` | `hexdump` / `xxd` | **Hexyl** | v0.17.0 | Inspecteur hexadécimal coloré par catégorie d'octets |
| `tldrp` | `man` pages | **Tealdeer** | v1.9.0 | Exemples de commandes directs en cache local |
| `bench` | `Measure-Command` / `time` | **Hyperfine** | v1.20.0 | Benchmark statistique de commandes (warmup, outliers, exports JSON/MD) |
| `ping` | `ping` | **Gping** | v1.21.0 | Ping avec graphique de latence dynamique en ASCII/TUI |
| `trip` | `traceroute` / `mtr` | **Trippy** | v0.12.0 | Outil de diagnostic réseau combinant traceroute et ping interactif |
| `xh` | `curl` / `httpie` | **xh** | v0.26.2 | Client HTTP terminal ergonomique avec coloration syntaxique JSON |
| `qsv` | `awk` / `csvkit` | **qsv** | v0.135.0 | Couteau suisse pour découper, indexer, filtrer et agréger des CSV |
| `br` | `tree` | **Broot** | v1.60.1 | Vue arborescente compacte et interactive avec raccourcis |
| `mise` | `asdf` / `nvm` / `pyenv` | **Mise** | v2026.9.5 | Gestionnaire unifié de runtimes polyglottes et d'environnements |
| `watch` | `entr` / `nodemon` | **Watchexec** | v2.7.2 | Exécution automatique de commandes à la modification de fichiers |
| `numbat` | `bc` / `calc` | **Numbat** | v1.14.0 | Calculatrice scientifique terminal avec typage sur unités physiques |
| `mdcat` | `cat` markdown | **mdcat** | v2.16.1 | Afficheur Markdown riche pour terminal avec coloration |
| `rerun` | — | **Rerun** | v0.37.2 | Visualisation multimodale 3D/2D/Tensors basée sur egui |
| `typst` | `latex` / `pdflatex` | **Typst** | v0.15.1 | Moteur de composition et de rendu documentaire |

---

## 2. Écosystème Local d'Inférence IA Embarquée (`aphrody model`)

Piloté par les crates `aphrody-models`, `aphrody-model-client` et l'accélérateur matériel CUDA 13.3 (NVIDIA GeForce RTX 4070 - 12 GB VRAM).
Politique stricte : 100% local, zéro OOM, zéro débordement CPU grâce à une empreinte VRAM maîtrisée.

| Rôle | Modèle Embarqué | Format / Quant | VRAM Résidente | Débit / Vitesse (estimation, non mesurée) | Spécialité & Cas d'Usage |
|---|---|---|---|---|---|
| **[SYS_CODE]** | `Qwen2.5-Coder-7B-Instruct` | GGUF Q4_K_M | ~5.5 GB | 90-110 tok/s | Ingénierie logicielle avancée (Rust, TS, Python), 32k contexte. |
| **[OCR_FAST]** | `PP-OCRv5` | ONNX | 20 MB | ~5 ms / page | Détection de blocs, lignes et coordonnées de texte. |
| **[OCR_DOC]** | `Granite-Docling-258M` | GGUF Q8_0 | 350 MB | ~20 ms / page | Parsing structurel de documents, tableaux, PDF/scans vers Markdown. |
| **[OCR_DEEP]** | `dots.ocr-3B` | GGUF Q8_0 | 4.1 GB | ~1.2 s / page | Japonais vertical dense, kanjis complexes, formules LaTeX, graphiques. |
| **[STT_ENGINE]** | `Whisper-Large-v3-Turbo` | GGML Q5_0 | 1.0 GB | >15x temps réel | Transcription vocale haute fidélité multilingue (FR, JA, EN). |
| **[TTS_ENGINE]** | `Kokoro-82M` / Google TTS | ONNX / Natif | < 300 MB | <30 ms | Synthèse vocale multilingue. |
| **[VISION_LOC]**| `Florence-2-Base-ft` + `SmolVLM` | ONNX q4 / GGUF | ~0.8 GB | ~25 ms / image | Bounding boxes UI, localisation d'éléments d'écran, spatialisation. |
| **[DIFFUSION]** | `SDXL-Lightning` (4-step) | Diffusers FP16 | ~6.0 GB | 1.5 s / image | Génération d'images haute résolution 1024x1024 en une seule passe. |

---

## 3. Surface Bun / TypeScript & Frontend M3

Géré à la racine par les workspaces Bun v1.4+ (`bun run --filter`).

| Rôle | Bibliothèque / Outil | Version | SPDX | Usage & Règle |
|---|---|---|---|---|
| **Runtime** | `bun` | 1.4.0+ | MIT | Exécution native TypeScript, SQLite rapide (`bun:sqlite`), Bun Shell (`$`). |
| **Monorepo** | `bun run --filter` | Bun | MIT | Orchestration des builds et typechecks du workspace `@aphrody/*`, dans l'ordre des dépendances (turbo retiré le 2026-10-09). |
| **Linter** | `oxlint` | 1.66.0+ | MIT | Linter écrit en Rust, configuré via `.oxlintrc.json`. |
| **Formatteur** | `oxfmt` | 0.51.0+ | MIT | Formatage du code source. |
| **Web Components** | `lit` / `@lit/react` | 3.3.3 / 1.0.8 | BSD-3-Clause | Composants web natifs réactifs. |
| **Design System** | `@material/web` | Fork interne | Apache-2.0 | Implémentation native de Google Material Design 3. |
| **Tokens & Thèmes** | `@aphrody/m3-theme` | Interne | Apache-2.0 | Dynamic color (HCT), modes dark/light automatiques, tokens CSS M3. |
| **Animations** | `motion` | 12.40.0 | MIT | Animations déclaratives coordonnées pour l'interface utilisateur. |
| **Visualisation 3D**| `three` | 0.184.0 | MIT | Scènes 3D canvas pour visualisations interactives. |

---

## 4. Surface Python (2026)

Conforme et vérifiée avec `uv` sous Python 3.11+.

| Need | Library | Version | SPDX Licence | Rejected Alternative | Reason for rejection |
|---|---|---|---|---|---|
| 1. HTTP sync+async | `httpx` | 0.28.1 | BSD-3-Clause | `aiohttp` | sync API is second-class; no built-in HTTP/2 |
| 2. CLI "style Google" | `fire` | 0.7.1 | Apache-2.0 | `typer` | Typer needs type annotations everywhere; Fire mirrors google-internal CLI style |
| 3. OAuth2 / Google creds | `google-auth` + `google-auth-oauthlib` | 2.53.0 / 1.4.0 | Apache-2.0 | `authlib` | authlib is generic; google-auth has direct Credentials.from_authorized_user_info + Windows Credential Manager hooks |
| 4. Google GenAI SDK | `google-genai` | 2.5.0 | Apache-2.0 | `google-cloud-aiplatform` | google-genai is the unified SDK covering both Gemini Developer API and Vertex AI in one surface |
| 5. Browser cookies | `browser-cookie3` | 0.20.1 | LGPL-3.0 | `pycookiecheat` | pycookiecheat is macOS-only; browser-cookie3 covers Chrome/Edge/Firefox on Linux + Windows incl. DPAPI. |
| 5b. Win32 DPAPI | `pywin32` | 311 | PSF-2.0 | `ctypes` direct | pywin32 wraps win32crypt cleanly; PSF-2.0 is permissive |
| 6. Keyring / secrets | `keyring` | 25.7.0 | MIT | `secretstorage` | secretstorage is Linux-only (D-Bus); keyring is cross-platform with auto backend detection |
| 7. Data validation | `pydantic` | 2.13.4 | MIT | `attrs` | pydantic v2 has Rust core, full JSON schema, integrates with google-genai response models |
| 8. Retry / backoff | `stamina` | 26.1.0 | MIT | `tenacity` | stamina is opinionated wrapper around tenacity with sane defaults, testing helpers |
| 9. Terminal output | `rich` | 15.0.0 | MIT | `textual` | textual is for full TUI apps; rich covers tables/JSON/progress bars for CLI output |
| 10. HTTP test mocking | `pytest` + `pytest-httpx` | 9.0.3 / 0.36.2 | MIT | `respx` | pytest-httpx integrates directly with httpx transports |
| 11. Lint + types | `ruff` + `pyright` | 0.15.13 / 1.1.409 | MIT | `mypy` | pyright has faster incremental check and better Pydantic v2 plugin; ruff replaces flake8+isort |
| 12. Dates / RFC3339 | `python-dateutil` | 2.9.0.post0 | Apache-2.0 | `arrow` | dateutil is stdlib-compatible and has zero dependencies |
