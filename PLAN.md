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

- [~] **CLI Rust** — binaire multi-call unique `aphrody` (`crates/infra/aphrody-command/src/multicall.rs`) :
  `aphrody <outil> …` ou ancien nom en lien (`aphrody self install-path`) pour infra, ovh, yolo, kernel,
  host-service, ssh, wsl, backend, mcp-server, web-engine, web-worker, x, gemini-web, google,
  translate-project, jev, embed, summary, skills, agent-home-memory, agent-train, llama-daemon, n2b,
  identity, m3-reproduce, canvas, bindgen ; leurs `[[bin]]` sont retirés (`cli_main` en lib), le faux
  pilier `aphrody infra` est remplacé par le vrai plan de contrôle, `aphrody google` n'a plus de
  sous-processus. Démos/tests → `examples/` (`paint_file`, `a2a_duel_loop`, `mcp_smoke`, `shell_e2e`).
  Restent : outillage amont Tauri (`cargo-tauri`, `tauri-driver`, …), `rag-eval` (claim purge).
- [~] **CLI Bun** — `yolo` absorbe `ops`, `workspace`, `optimize`, `update`, `google` (drive, fonts),
  `doc-ai`, `browser` (agent-browser), `forge` (ex-`bun-forge`, bin retiré) et `m3` in-process : `yolo m3` = CLI
  framework, `yolo m3 next|bun|os-themes|next-migrate|svg-to-ico|web-to-tauri|scaffold` = outils des paquets m3
  (leurs `bin` npm restent pour les consommateurs externes ; usages internes repointés). `aphrody-ovh` Bun
  retiré au profit de `aphrody ovh`. Les liens `aphrody-{ops,optimize,workspace}` restent exécutables tant que
  des consommateurs les appellent.
- [~] **App desktop** — une seule app `aphrody-app` : `yolo-desktop` (hôte runtime `--runtime-host`,
  protocole `yolo.desktop/1` inchangé) et `m3-showcase` (`--showcase`, sidecar Bun) absorbés,
  `tauri-e2e` → exemple `shell_e2e`.
- [~] **FFI** — un seul cdylib C-ABI `aphrody_ffi` : `yolo-tooling` (feature `tooling`, défaut) et
  `aphrody-inference-ffi` (feature `inference`) absorbés 2026-10-05, `yolo-runtime` réduit à `rlib` ; consommateurs
  Bun repointés vers `libaphrody_ffi`. Restent hors C-ABI : `aphrody-a2a-ui`/`aphrody-shell-web` (wasm-bindgen),
  cibles mobiles de `yolo-desktop`/`aphrody-m3-showcase` (fusion app desktop). `yolo-pyo3` et
  `py/packages/aphrody/native` restent des modules d'extension Python (PyO3), pas des cdylib C.
- [~] **MCP** — un seul serveur `aphrody-mcp` : `aphrody-tauri-mcp` retiré (14 outils déjà servis par
  `aphrody-mcp`, appel `aphrody_webview_*` corrigé), `aphrody-mcp-smoke` → exemple `mcp_smoke`, boucles
  stdio/HTTP mortes d'`obscura-mcp` retirées (bibliothèque d'outils seule). Un seul point d'entrée plugin :
  `aphrody kernel mcp` proxie `aphrody-mcp` et attache `yolo mcp` (`yolo_*`) et `m3-mcp` (`m3_*`) comme
  sous-systèmes (désactivables par `APHRODY_{YOLO,M3}_MCP_BIN=` vide) ; les plugins `aphrody`/`yolo` ne
  déclarent plus que ce serveur. `mcp-client` et `mcp-oauth` restent des bibliothèques.
- Gate : chaque fusion est qualifiée par `cargo check`/tests via la factory (révision épinglée) ou
  `bun test`, puis l'ancien crate/package est supprimé. Aucune fusion sans gate.

## 6. Bun au centre (directive propriétaire du 2026-10-05)

Plan de fusion du propriétaire (Obscura × Bun, futur dépôt `yolo`) : copie du dossier Drive « Aphrody » dans
[`docs/plans/fusion/drive/`](docs/plans/fusion/drive/README.md) ; la partie 4 y consigne les audits du 2026-10-05
(état des forks, mécanismes d'extension du fork Bun, Obscura, Tauri, collisions de nom, décisions ouvertes).

Bun est le runtime central ; le fork `aphrody-labs/bun` (branche unique `main` : amont + correctifs Aphrody, `vendor/bun`, pin dans
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
  surveillée (`main`, branche unique et par défaut du fork depuis le 2026-10-05 : amont + correctifs Aphrody) ; reçu JSON, binaire et sha256 par commit.
- [~] Activation : premier build complet du fork par `bun-forge` sur la factory fait (yolo `954db0c0`,
  7 min 10 s, Bun 1.4.3, les 5 spécifiers absorbés résolus en natif) ; restent l’installation du runtime
  (glibc 2.43 : WSL Ubuntu 26.04), puis `--fork-active` et le retrait des déclarations `fork`.
- [ ] `native` : `postgres`/`pg` → `Bun.SQL`, `sharp` → `Bun.Image`, `playwright*` → `Bun.WebView`,
  `marked` → `Bun.markdown`, `dayjs`/`date-fns` → `Temporal`, `smol-toml` → `Bun.TOML`, `tsup` → `Bun.build`.
- [ ] `gap` → fork : `pino`, `fuse.js`, `qrcode`, `@napi-rs/canvas` (`lru-cache`, `p-queue`, `p-retry`,
  `bottleneck` sont partis avec FUT).

## 7. Noyau et paquets installables (décision du 2026-10-05)

Gestionnaire de paquets : Bun natif, un seul canal. `workspace:*` dans le monorepo ; tout paquet consommé
hors du monorepo est publié sur l’organisation npm `@aphrody` (propriétaire `yohan971`, `bun publish` depuis
le monorepo, versions exactes, `workspace:`/`catalog:` réécrits par Bun) et installé par les dépôts frères
comme n’importe quel paquet npm (exemption `minimumReleaseAgeExcludes` pour `@aphrody/*`). Le canal
d’archives sha256 (`aphrody-ops aphrody-packages prepare`) est transitoire et disparaît après la migration
d’IECODE et de FUT.

- Noyau (monorepo, jamais installé seul) : engine (yolo-core), runtime SDK, paths, http, sql, update,
  workspace, plugins, os, shell-web, test-dom, CLI `yolo` ; crates Rust (dont le socle ML `crates/ml`,
  ex-`koharu-*`, renommé `aphrody-*` le 2026-10-05).
- Paquets installables (indépendants, publiés) : `@aphrody/x`, `xai`, `google`, `doc-ai`, `ovh`,
  `messaging`, `n2b-*`, `web-test`, `bun` (FFI), famille m3, `api` et `plugin-*` Tauri (sorties JS produites
  par `crates/tauri/build-js.ts`) ; `agent-browser` est à absorber dans Aphrody Web (Rust).
- Produits hors plateforme → dépôt propre (modèle Bun/Linux : aucun produit aval dans le dépôt) :
  [x] FUT (`aphrody-labs/fut`, historique conservé, 148 tests verts en autonomie) ;
  [x] Shenron + couche traduction Koharu extraits (`aphrody-labs/shenron`, 2026-10-05, historique conservé :
  apps, paquets, UI, crates Koharu, modules Rust Shenron, plugin, `@aphrody/media`) ; le plan d’hôtes Shenron
  (systemd, nginx, privoxy, déploiement atomique, sauvegardes) et la passerelle `/api/v1/shenron/*` restent à l’Infra.
- [x] Doublons de mécanismes retirés (`8b94aa7d4`, session aphrody-1a) : crate `aphrody-marketplace`,
  `publish-workspaces.ts`, pin SDK `sibling-checkouts`, wrappers `bun install` (façade `yolo-core/pm`).
- [ ] Publication npm des paquets consommés par Shenron et FUT, puis migration d’IECODE et FUT vers npm.
- [ ] `packages/` aplati (`packages/<nom>`, comme `bun/packages`) ; `py/` rendu à `aphrody-py`.
- [ ] GitHub : archiver les dépôts absorbés (`yolo`, `aphrody-m3`, `nie-ui`, `plugin-*` → `plugins`) et les
  forks intégrés ou purgés (tauri, tao, wry, plugins-workspace, create-tauri-app, next.js, tailwindcss,
  base-ui, fonts, material-*).
- [ ] npm : déprécier les paquets absorbés par Bun (`zstd`, `xml2`, `web-storage`, `web-notification`), renommés
  (`bun-rs`), ou hors produit (scrapers d’épisodes, `bxc*`).

## 8. Tout Aphrody publié (directive propriétaire du 2026-10-05)

Tout Aphrody est public, installable et publiable : Bun sur npm `@aphrody` (session aphrody-1a, commande
`aphrody-ops aphrody-packages publish`), Rust sur crates.io, Python sur PyPI. Les consommateurs (dont Shenron)
passent uniquement par ces registres : aucun lien en dur, aucune archive, aucun import relatif inter-dépôts.

- [ ] crates.io (316 crates) : métadonnées héritées du workspace (licence, dépôt, description), retrait des
  `publish = false` (177), versions sur les dépendances de chemin (52) ; audit `cargo package --list` (secrets,
  chemins hôte, taille < 10 Mo) ; 14 noms déjà pris par l’amont (`koharu*` réglé par le renommage `aphrody-*` de `crates/ml`, `obscura`, `serde-saphyr`, `simdutf`,
  `tauri-plugin-mcp-bridge`) → dépendre de la version amont si nos correctifs sont résorbés, sinon renommer le
  fork ; `cargo publish --workspace --dry-run` sur la fabrique, puis envoi local `--no-verify` dans l’ordre topologique.
- [ ] PyPI : paquets `py/` construits et publiés par `uv build` / `uv publish`.
- [~] Shenron + Koharu → `aphrody-labs/shenron`, Bun + Rust : extraction faite (voir §7) ; la fusion UI/apps, l’app
  desktop Tauri 3 + Bun + Next 16, le RAG/backend propres, le MCP `dragonball.*` et l’installation Windows sont menés
  dans ce dépôt. Le socle ML reste ici sous `crates/ml` (`aphrody-{llama,llama-sys,torch,torch-sys,diffusion,diffusion-sys,bindgen,ml-runtime,ml-config}`, ex-`koharu-*`).
