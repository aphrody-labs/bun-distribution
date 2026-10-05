<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan Directeur Unique — Aphrody & Yolo Core Trinity

Document d'architecture canonique et plan d'exécution unifié.
Version : 2026-10-05 | Auteur : aphrody-dev <contact@aphrody.com>

---

## 1. Vision et Doctrine Fondamentale

Ce plan centralise et fusionne l'ensemble des axes directeurs du projet :
1. **Dépôt central unique** : `/home/aphro/aphrody` est l'espace monorepo consolidé. Aucun clone orphelin ou arborescence de code résiduelle hors de ce périmètre.
2. **Trinité Technologique 2026** :
   - **Rust** : Moteur natif haute performance, C-ABI stable, sûreté mémoire, zéro copie.
   - **Bun** : Runtime JavaScript/TypeScript 7 ultra-rapide, consommation native directe via `bun:ffi`.
   - **Python / uv** : Écosystème IA/ML, PyO3 sans GIL (`py.detach()`), packaging unifié sous `uv`.
3. **Zéro duplication** :
   - Un seul workspace Rust Cargo consolidé.
   - Un seul workspace Bun (`package.json`).
   - Un seul workspace Python (`uv` / `pyproject.toml`).
   - Élimination des wrappers et ponts redondants.

---

## 2. Cartographie et Rôles

| Composant | Rôle & Responsabilité | Localisation canonique |
| :--- | :--- | :--- |
| **Aphrody CLI** | Point d'entrée AI-first, orchestration globale, MCP, agents, commandes | `apps/cli`, `crates/infra/aphrody-command` |
| **Yolo Core & Runtime** | Moteur de supervision, benchmarking matériel, isolation processus | `crates/engine/yolo-core`, `crates/engine/yolo-runtime` |
| **Interop FFI Unique** | Bibliothèque C-ABI unifiée (`libaphrody_ffi.so`) chargeant CLI, runtime, M3 tokens et tooling | `crates/interop/ffi` |
| **M3 UI & Design System** | Tokens Material 3, composants, Canvas et rendu graphique pur | `m3/`, `crates/ui/*` |
| **Python IA / ML SDK** | Extension native PyO3 (`_yolo_native` / `aphrody_rust`), RAG, embeddings | `py/packages/aphrody`, `crates/engine/yolo-pyo3`, `crates/ai/rag-python` |
| **Obscura / Web Engine** | Navigation headless, extraction de données, profils stealth, HAR | `crates/web/*` |

---

## 3. Architecture FFI Unifiée

### A. Dynamic Library C-ABI (`bun:ffi`)
- **Bibliothèque unique** : `libaphrody_ffi.so` (Linux) / `aphrody_ffi.dll` (Windows).
- **Surfaces exportées** :
  1. `aphrody_*` : Exécution in-process des commandes de la CLI.
  2. `yolo_*` : Cycle de vie du runtime, supervision de processus, sondes HTTP, benchmark matériel.
  3. `bun_rs_*` : Rendu des composants M3, calculs colorimétriques HCT, compilation SASS, SVG.
  4. `aphrody_n2b_*` & `aphrody_oxc_*` : Passerelles AST et transpilation.
  5. `ffi_sum_squares` : Calcul vectoriel zéro copie haute performance.

### B. Python Extension Modules (PyO3 0.29)
- Déchargement systématique du GIL via `py.detach()`.
- Calculs vectoriels, similarités cosinus et RRF natifs via Rayon.

---

## 4. Jalons d'Exécution

- [x] **Phase 1 : Consolidation Monorepo**
  - Fusion des packages Bun et suppression des clones redondants (`nie-ui`, `aphrody-py`).
  - Validation des suites de tests TypeScript (135 tests réussis).
  - Validation de la suite de tests Python via `uv` (37 tests réussis).

- [x] **Phase 2 : Unification Native FFI** (source; `cargo check -p aphrody-ffi` OK 2026-10-05, cdylib export non vérifié par nm)
  - Intégrer les exports `yolo_*` et `ffi_sum_squares` dans `crates/interop/ffi`.
  - Harmoniser le header C `crates/interop/ffi/include/aphrody.h`.
  - Vérifier la compilation Cargo (`cargo check -p aphrody-ffi`).

- [~] **Phase 3 : Consolidation des Consommateurs SDK** (le SDK charge la bibliothèque nommée par le manifest d'artefact ; aucune modification requise, requalification `bun:ffi` en attente)
  - Pointer le SDK `@aphrody/runtime` de manière transparente vers `aphrody_ffi`.
  - Requalifier le chargement dynamique sous Bun (`bun:ffi`).

- [~] **Phase 4 : Documentation & Nettoyage Final** (chemins du tableau §2 vérifiés présents 2026-10-05 ; intégrité Agent Home `crates/ai/agent-home` en attente du gate Cargo sérialisé)
  - Vérifier que tous les chemins relatifs sont synchronisés.
  - Valider l'intégrité de l'Agent Home.

## 5. Consolidation : un CLI, un FFI, un MCP (inventaire 2026-10-05)

Cibles uniques : CLI `aphrody` (`apps/cli` + `crates/infra/aphrody-command`), FFI `aphrody-ffi`
(`crates/interop/ffi`), MCP `aphrody-mcp` (`crates/ai/mcp`). Bun : un seul CLI `yolo`
(`apps/yolo/cli`). Les identités publiées (binaires, symboles `yolo_*`, noms d'outils MCP)
restent des alias de compatibilité jusqu'à qualification.

- [ ] **CLI Rust** — absorber en sous-commandes de `aphrody-command` : `aphrody-infra`, `aphrody-yolo`,
  `aphrody-google`, `aphrody-gemini-web`, `aphrody-x` (`x-cli`), `n2b`, `aphrody-translate`,
  `aphrody-summary`, `aphrody-skills`, `aphrody-embed`, `aphrody-jev`, `aphrody-web`, `aphrody-app`,
  `aphrody-kernel`, `aphrody-llama-daemon`. Bins de test/outil (`paint_file`, `pixel`, `export_assets`,
  `a2a-duel-loop`, `rag-eval`, `tauri-e2e`) vont sous `examples/` ou `xtask`.
- [ ] **CLI Bun** — replier `aphrody-ops`, `aphrody-optimize`, `aphrody-workspace`, `aphrody-update`,
  `aphrody-ovh`, `aphrody-google`, `pipeline`, `doc-ai`, `agent-browser` en sous-commandes de `yolo`.
- [ ] **FFI** — un seul cdylib `aphrody_ffi` : intégrer `yolo-tooling` (24 L, ré-exporte n2b-native et
  oxc-bridge), `aphrody-inference-ffi`, `yolo-desktop`, `aphrody-a2a-ui`, `aphrody-shell-web`,
  `aphrody-m3-showcase` par features ; `yolo-runtime` est déjà une dépendance. `yolo-pyo3` et
  `py/packages/aphrody/native` restent des modules d'extension Python (PyO3), pas des cdylib C.
- [ ] **MCP** — un seul serveur `aphrody-mcp` : intégrer `aphrody-google-mcp`, `obscura-mcp`,
  `aphrody-tauri-mcp` (orphelins, aucun consommateur) et `aphrody-mcp-smoke` (test) ; `mcp-client` et
  `mcp-oauth` restent des bibliothèques.
- Gate : chaque fusion est qualifiée par `cargo check`/tests via la factory (révision épinglée) ou
  `bun test`, puis l'ancien crate/package est supprimé. Aucune fusion sans gate.

## 6. Bun au centre (directive propriétaire du 2026-10-05)

Bun est le runtime central ; le fork `aphrody-labs/bun` (branche `yolo`, `vendor/bun`, pin dans
`config/vendor.json`) absorbe les bibliothèques JS/TS au niveau du résolveur, comme Bun le fait déjà
pour `ws`, `undici` et `node-fetch` (`src/js/thirdparty` + `src/resolve_builtins/HardcodedModule.rs`).
Ce qui ne sert ni la production ni ce but sort du dépôt.

Contrat : [config/bun-absorb.json](config/bun-absorb.json) classe chaque paquet npm — `builtin`
(déclaration refusée), `fork` (servi par le fork), `native` (API Bun existante, imports en ratchet
descendant via `config/bun-absorb.baseline.json`), `gap` (candidat fork). Gate :
`bun scripts/audit/workspace/bun-absorb.ts` (catalogue mort refusé ; `--fork-active` refuse aussi les
paquets `fork` déclarés).

- [x] Contrat, ratchet et retrait de 50 entrées de catalogue mortes.
- [x] Fork : `picocolors`, `tiny-invariant`, `dotenv` (+ `dotenv/config`), `uuid` servis en natif (source).
- [x] `bun-forge` (`apps/yolo/forge`, config [config/bun-forge.json](config/bun-forge.json)) : un
  exécutable compilé (Bun embarqué, servi au build comme `bun` via `BUN_BE_BUN=1`) qui installe la chaîne
  sur machine vierge (apt avec sudo ; LLVM 23.1.1, cmake, rustup dans son cache, sans root), crée une
  partition temporaire par commit (loop ext4, tmpfs ou répertoire), y extrait un worktree du miroir partiel
  et construit `scripts/build.ts --profile=release` ; `watch` construit chaque nouveau commit de la branche
  surveillée (`yolo`, branche de production et branche par défaut du fork ; `main` = miroir amont) ; reçu JSON, binaire et sha256 par commit.
- [~] Activation : premier build complet du fork par `bun-forge` sur la factory fait (yolo `954db0c0`,
  7 min 10 s, Bun 1.4.3, les 5 spécifiers absorbés résolus en natif) ; restent l’installation du runtime
  (glibc 2.43 : WSL Ubuntu 26.04), puis `--fork-active` et le retrait des déclarations `fork`.
- [ ] `native` : `postgres`/`pg` → `Bun.SQL`, `sharp` → `Bun.Image`, `playwright*` → `Bun.WebView`,
  `marked` → `Bun.markdown`, `dayjs`/`date-fns` → `Temporal`, `smol-toml` → `Bun.TOML`, `tsup` → `Bun.build`.
- [ ] `gap` → fork : `pino`, `fuse.js`, `qrcode`, `@napi-rs/canvas` (`lru-cache`, `p-queue`, `p-retry`,
  `bottleneck` sont partis avec FUT).

## 7. Noyau et paquets installables (décision du 2026-10-05)

Gestionnaire de paquets : Bun natif. `workspace:*` dans le monorepo ; les paquets installables sont publiés
sous le scope npm `@aphrody` (`bun publish`, 51 paquets déjà publiés par le propriétaire) ; les dépôts
frères privés consomment le canal d’archives adressées par sha256 de `aphrody-ops aphrody-packages prepare`
(pin `config/aphrody-packages.json`, consommateurs : IECODE, FUT). Pas de second gestionnaire.

- Noyau (monorepo, jamais installé seul) : engine (yolo-core), runtime SDK, paths, http, sql, update,
  workspace, plugins, os, shell-web, test-dom, CLI `yolo`.
- Paquets installables (indépendants, publiables) : `@aphrody/x`, `xai`, `google`, `doc-ai`, `ovh`,
  `messaging`, `n2b-*`, `web-test`, `bun` (FFI), famille m3 ; `agent-browser` est à absorber dans
  Aphrody Web (Rust).
- Non-produit → dépôt propre : [x] FUT (`aphrody-labs/fut`, historique conservé, 148 tests verts en
  autonomie sur le pin d’archives) ; [ ] Shenron et Koharu à trancher.
- [ ] Retirer les doublons de mécanismes : crate morte `aphrody-marketplace`, `publish-workspaces.ts`,
  pin SDK `config/sibling-checkouts.json` (remplacé par le canal d’archives), wrappers `bun install`
  multiples (façade unique `yolo-core/pm`) ; scan `aphrody-packages` étendu à `m3/packages` et `crates/tauri`.
- [ ] GitHub : archiver les dépôts absorbés (`yolo`, `aphrody-m3`, `nie-ui`, `plugin-*` → `plugins`) et les
  forks intégrés ou purgés (tauri, tao, wry, plugins-workspace, create-tauri-app, next.js, tailwindcss,
  base-ui, fonts, material-*) ; trancher `aphrody-py` contre `py/`.
- [ ] npm : déprécier les paquets absorbés par Bun (`zstd`, `xml2`, `web-storage`, `web-notification`), renommés
  (`bun-rs`), ou hors produit (scrapers d’épisodes, `bxc*`) ; jeton npm du propriétaire requis.
