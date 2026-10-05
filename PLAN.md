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

- [ ] **Phase 4 : Documentation & Nettoyage Final**
  - Vérifier que tous les chemins relatifs sont synchronisés.
  - Valider l'intégrité de l'Agent Home.
