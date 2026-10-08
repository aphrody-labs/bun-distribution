<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture Agent-First & Maturation de la Stack

Document normatif définissant l'arbre de décision technologique, la rigueur d'auditabilité Agent-First, la boucle récursive d'outillage et l'exposition multiprotocole (MCP, FFI, API).

---

## 1. Rigueur & Auditabilité

### Mesure absolue
Toute opération doit être systématiquement mesurée, testée et vérifiée :
- Horodatages ISO-8601 stricts (`startedAt`, `timestamp`).
- Durées et débits en haute précision nanoseconde (`Bun.nanoseconds()`).
- Empreintes d'intégrité et détection de modifications ultra-rapides (`Bun.hash.wyhash`, `crc32`). La provenance cryptographique formelle et les pins d'intégrité de sécurité demeurent rigoureusement garantis sur SHA-256 (comme les pins de l'arbre Aphrody).
- Métriques d'accélération et de parallélisme (`wallMs`, `sumGateMs`, `speedup`).

### Agent-First
Toutes les sorties de la CLI interne (`yolo`) doivent être directement exploitables sans scraping textuel ou regex fragile :
- **`--json` :** Schémas versionnés stricts (`yolo.verify/1`, `yolo.status/1`, `yolo.scan/1`, `yolo.parse/1`, `yolo.bench/1`, `yolo.doctor/1`, `yolo.tools/1`).
- **`--md` :** Tableaux Markdown GitHub-Flavored propres, sans codes d'échappement ANSI.

---

## 2. Boucle Récursive de l'Outillage (CLI ↔ Projet)

```
┌─────────────────────────────────────────────────────────┐
│               BOUCLE RÉCURSIVE DE L'OUTILLAGE          │
└─────────────────────────────────────────────────────────┘
        ▲                                         │
        │ Projets & Besoins                       │ Outillage interne
        │ (tests, scans, FFI,                     │ (`yolo` CLI, MCP,
        │  diagnostics, gates)                    │  serveur REST)
        │                                         ▼
   ┌─────────┐    Factorisation Native     ┌──────────────┐
   │ One-    │ ─────────────────────────► │ yolo CLI     │
   │ Liners  │    (Bun.Glob, wyhash,      │  (Bun / TS7) │
   │ Éliminés│     Bun.serve, FFI)        └──────────────┘
```

- **Symbiose :** La CLI répond immédiatement aux besoins du projet ; chaque besoin récurrent ou opération d'inspection enrichit la CLI sous forme de commande typée.
- **Factorisation immédiate :** Élimination systématique des commandes lentes et des *one-liners* (`find | xargs wc -l`, scripts Python ad-hoc, inline `bun -e`) au profit de sous-commandes natives intégrées (`yolo scan`, `yolo parse`, `yolo bench`, `yolo doctor`).
- **Exécution YOLO autonome :** Workflows nativement récursifs, massivement parallèles (via limiteurs de concurrence partagés), automatisables sans intervention humaine intermédiaire.

---

## 3. Maturation de la Stack (Arbre de Décision)

```
                         Besoin Fonctionnel / Technique
                                       │
                                       ▼
          ┌────────────────────────────────────────────────────────┐
          │  Tier 1 : Bun / TypeScript Natif (Socle par défaut)    │
          │  Orchestration, CLI interne, I/O zero-copy, prototypage│
          └────────────────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼ Bibliothèque officielle ?    ▼ Chemin critique / perf ?     ▼ Écosystème tiers IA/ML ?
 ┌───────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────────────────┐
 │ Tier 3 : C / C++          │  │ Tier 2 : Rust (Maturation)│  │ Tier 5 : Python via `uv`     │
 │ Adoption immédiate        │  │ Crates workspace, C ABI,  │  │ Modèles IA (Gemma 4, SFT/DPO,│
 │ WebKitGTK, SQLite, zstd   │  │ calcul intensif, SIMD, FFI│  │ GGUF), envs isolés sans     │
 │ C ABI / `bun:ffi` direct  │  └───────────────────────────┘  │ pollution globale            │
 └───────────────────────────┘                                 └──────────────────────────────┘
                                                                              │
                                                                              ▼ Bas niveau interpréteur ?
                                                                ┌─────────────────────────────┐
                                                                │ Tier 4 : CPython (Restreint)│
                                                                └─────────────────────────────┘
```

1. **Bun / TypeScript (Natif) :** Socle par défaut pour l'orchestration, l'outillage interne, la CLI et le prototypage rapide. Exploite les primitives natives Bun (`Bun.file`, `Bun.Glob`, `Bun.hash.wyhash`, `Bun.serve`, `Bun.TOML`, `Bun.JSONL`).
2. **C / C++ (Adoption immédiate) :** Dès qu'une bibliothèque officielle de référence existe déjà en C/C++ (WebKitGTK, Wry, SQLite, zstd), adoption immédiate sans réimplémentation redondante, interfacée via le C ABI ou `bun:ffi`.
3. **Rust (Maturation ciblée) :** Cible finale pour remplacer le code TypeScript/Bun sur le chemin critique dès que la performance brute, le calcul intensif, la sûreté mémoire sans GC ou la distribution binaire autonome l'exigent (`crates/engine/yolo-core`, `crates/engine/yolo-runtime`, `crates/engine/yolo-desktop` (not in repo)).
4. **Python via `uv` (Écosystème IA / ML) :** Mobilisé dès qu'un écosystème externe de modèles ou bibliothèques spécialisées (Gemma 4, PyTorch, Hugging Face, Unsloth) est requis, strictement conteneurisé sous des environnements `uv` isolés.
5. **CPython (Restreint) :** Réservé exclusivement aux besoins système très bas niveau liés aux détails internes de l'interpréteur.

---

## 4. Exposition & Protocoles Modulaires

Chaque fonctionnalité de la CLI `yolo` est conçue pour être exposée via quatre protocoles complémentaires :

### 1. CLI Entrypoint
- Exécutable autonome ou script repo `./bin/yolo`.
- Formatage adaptatif : terminal couleur ANSI pour l'humain, `--json` et `--md` pour les agents IA.

### 2. MCP (Model Context Protocol 2024-11-05)
- Commande `yolo mcp`.
- Serveur stdio JSON-RPC 2.0 natif zéro dépendance npm.
- Expose le catalogue d'outils aux agents IA (Antigravity, Claude Code, Gemini CLI, etc.) :
  - `yolo_verify` : exécution parallèle des quality gates.
  - `yolo_status` : état des submodules, crates vendored et Cargo workspace.
  - `yolo_scan` : scan récursif rapide (lignes, octets, wyhash).
  - `yolo_parse` : analyse AST, imports, exports et checksum.
  - `yolo_bench` : micro-benchmarks wyhash, crc32, stringWidth.
  - `yolo_doctor` : diagnostic toolchain et runtime.
  - `yolo_host_space` : mesure d'espace disque avec déduplication d'inodes.

### 3. API / REST / OpenAPI 3.1
- Commande `yolo api [--port N] [--host H]`.
- Serveur HTTP haute performance sous `Bun.serve` avec support CORS.
- Endpoints REST : `/health`, `/api/status`, `/api/verify`, `/api/parse`, `/api/bench`, `/api/doctor`, `/api/scan`, `/api/tools`, `/api/openapi.json`.

### 4. FFI (Foreign Function Interface) & PyO3 Native Interop
- **TypeScript / Bun (`bun:ffi`) :** Couche `packages/engine/runtime` (`@aphrody/yolo-runtime`) interfacée avec `crates/engine/yolo-runtime` via `bun:ffi` zéro-copie (`ptr(Float64Array)` direct sans sérialisation).
- **Python / PyO3 0.29 (`crates/engine/yolo-pyo3`) :** Extension native `_yolo_native` compilée avec Maturin, exploitant `py.detach()` pour relâcher instantanément le GIL et basculer sur les cœurs de calcul Rayon SIMD, prête pour CPython 3.14t Free-Threaded (PEP 703 No-GIL).
- **Package Python `yolo` (`packages/python` (not in repo)) :** Intégration Pydantic V2, Apache Arrow IPC / Polars DataFrame, stubs typés PEP 484/561 (`py.typed`, `_yolo_native.pyi`).
- C ABI versionné (`EXPECTED_ABI_MAJOR = 1`, `EXPECTED_ABI_MINOR = 4`).
- Zéro dépendance d'en-tête externe, gestion stricte des lifetimes et panic boundaries.

---

## 5. La Stack Utile & Optimisée (Production 2026 — Zéro Goulot d'Étranglement)

L'architecture d'exécution concrète en production pour 2026 unifie 4 couches complémentaires à performance maximale (référence détaillée : [STACK-PRODUCTION-2026.md](../../architecture/runtime-native/STACK-PRODUCTION-2026.md)) :

1. **Couche 1 : Interface & Scripts (Dual Engine : Humain vs IA)**
   - *Humain Exploratoire :* Nushell 0.116 (21ms cold start, pipelines typés) + Starship.
   - *No-Human-In-The-Loop / IA :* Bun Shell natif in-process (`crates/compat/bun-bridge`) + JavaScriptCore (22x plus rapide, 0ms fork, `AstArena` bump allocator).
   - *Core Tools Rust :* `ripgrep`, `fd`, `bottom`, `Helix`, `Yazi`.
2. **Couche 2 : Terminal & Rendu GPU**
   - *Moteur Terminal :* `aphrody-term` (absorbé de Rio, Cosmic-Term & WezTerm) avec cellules compactes 16B (`PackedCell`) alignées sur lignes de cache L1, fast-path ASCII `memchr`, `FairMutex` à baux bornés (256 Ko) anti-famine, et quads instanciés WebGPU coalescés en 2 passes.
   - *Compositeur :* `niri` (sur Wayland Linux) et `Headless Buffer` (pour agent IA kernel).
3. **Couche 3 : Userland & Builtins en Mémoire**
   - *Builtins In-Process :* `uutils-coreutils` + builtins Bun (cat, ls, echo, rm, cp...) sans création de sous-processus OS.
   - *Agent Computer-Use :* `ComputerUseController` (>10 Go/s scraping mémoire direct, injection programmatique d'événements).
   - *Allocateurs :* `mimalloc` (allocateur global multithreadé) + `AstArena` (bump allocator pour zéro fragmentation du tas).
4. **Couche 4 : Noyau & Accélérateurs Matériels Réels**
   - *Pilotes NVIDIA natifs :* CUDA 12.x, TensorRT-LLM, cuDNN, NVLink, DirectStorage DMA.
   - *Noyaux :* Linux 6.x (`io_uring`, `cgroups v2`) et Windows NT (`DirectStorage`).
   - *Abstraction sécurité :* `aphrody-ostd` (`crates/os/ostd`, inspiré d'Asterinas, sans privilèges Ring 0).
5. **Couche Virtualisation Full-WASM :**
   - MicroVM in-process avec `v86` (reprise sous 50ms par snapshot mémoire) et `container2wasm` (coureur OCI WebAssembly), unifiés sous le trait canonique `SandboxHost` ([WASM-CONTAINER-V86.md](../../architecture/runtime-native/WASM-CONTAINER-V86.md)).

