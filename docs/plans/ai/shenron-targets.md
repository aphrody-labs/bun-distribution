<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron : trois cibles RAG (WASM web, natif desktop, FFI Bun)

Date : 2026-10-06. Claim `shenron-targets`. Owner des capacités : `crates/ai/rag-core`
([plan RAG](rag-native-integration.md)). Aucune capacité n'est redéclarée dans un binding.

## Source de vérité unique

`crates/ai/rag-core/src/api.rs` : trois points d'entrée (`manifest`, `call_json`, `call_vec`) et deux
tables, `JSON_OPS` (chunking, texte, fusion RRF/pondérée/scores, MMR, quotas de sources, harnais eval) et
`VEC_OPS` (kernels vectoriels f32/f64/i8 sur buffers little-endian, top-k). Ajouter une capacité = une
ligne de table. Les bindings sont des adaptateurs sans logique :

| Cible | Crate / package | Forme |
| :-- | :-- | :-- |
| Web | `crates/ai/rag-wasm` (wasm-bindgen `--target web`) + `@aphrody/rag-core/wasm` | ESM, `loadRagWasm()` |
| `cargo check -p aphrody-ffi` (re-export `aphrody_rag_*`) | ok ; présence des symboles dans le cdylib `aphrody-ffi` complet non vérifiée (pas de build release) |
| `cargo clippy -D warnings` (3 crates, `--all-targets`) | ok |
| Desktop natif | dépendance Rust directe sur `aphrody-rag-core` (pas de binding) | rlib |
| Backend Bun | `crates/ai/rag-ffi` (rlib), réexporté par l'unique cdylib `aphrody-ffi` + `@aphrody/rag-core/ffi` | `openRagFfi()` |

Le paquet `packages/ai/rag-core` expose une façade typée unique (`createRagCore(transport)`) : wasm et FFI
n'implémentent que le transport. `test/contract.test.ts` exécute le même contrat sur chaque backend construit ;
un test de dérive échoue si la façade n'a pas une opération du manifest ; `test/ffi-symbols.test.ts` et
`packages/interop/native/test/ffi-drift.test.ts` comparent les exports C Rust aux tables TypeScript.

## Inventaire avant ce lot (2026-10-06)

- `rag-core` : pur, `forbid(unsafe_code)`, wasm32 documenté, mais aucun export wasm ni FFI. Dépendance inutilisée
  dans `aphrody-ffi`.
- `rag-python` (PyO3, `aphrody_rust`) : 12 fonctions (kernels f32/f64, RRF, top-k cosinus). Pas de chunkers,
  MMR, quotas ni eval. Contrat Python inchangé ; non rebranché sur `api.rs` (identité de wheel).
- `aphrody-ffi` : CLI en processus, `zerocopy` (réparation et validation de tool calls), web (extraction, DOM,
  HNSW, jobs, embed/rerank, X), `yolo_*`, inférence (feature `inference`, `@aphrody/inference`).
- Mémoire, llama-server, modèles : lots Shenron non commités du checkout principal, hors périmètre.

## Contrat FFI `aphrody_rag_*`

Buffers appartenant à l'appelant, rien d'alloué côté natif, donc pas de `free`. Retour = taille du résultat ;
trop grand : rien n'est écrit, résultat gardé en thread-local, relu par `aphrody_rag_take` (pas de recalcul).
`call_json` renvoie toujours `{"ok":…}` ou `{"error":…}` ; `call_vec` renvoie `-2` et le message via
`aphrody_rag_last_error`. `-1` argument invalide, `-3` panique interceptée.

## Build et usage

- WASM : `bun run build:wasm` dans `packages/ai/rag-core` ; propriétaire commun
  `scripts/build/rust/wasm-package.ts` (cargo `wasm32-unknown-unknown` sur le tunnel VPS ou `cargo-serial.sh` en
  session cloud, `wasm-bindgen` aligné sur `Cargo.lock` via cargo-binstall, `wasm-opt -Oz` avec liste de features
  explicite : `--all-features` produit des imports de chaînes illisibles par JavaScriptCore). Sortie `wasm/`
  ignorée par Git, incluse dans le tarball (`files`).
- FFI : `cargo build --release -p aphrody-ffi` (usine VPS) ; bibliothèque dans le store `lib` ou
  `APHRODY_RAG_LIBRARY`. Les tests Bun ont tourné contre `cargo rustc -p aphrody-rag-ffi --crate-type cdylib`
  (mêmes symboles, 7,1 Mo), pas contre le `aphrody-ffi` complet.

## `@aphrody/shell-web`

Le `.wasm` n'était pas dans le paquet. `build:wasm` passe maintenant par le même propriétaire
(`scripts/build/shell/build-wasm.sh` délègue) ; `files` inclut `pkg/`, `exports` ajoute `./wasm`, `./wasm-glue`,
`./pkg/*`, `./worker` ; `test/pkg.test.ts` charge le module par les exports et vérifie le tarball
(`bun pm pack --dry-run`, rien publié). Correction préexistante : `postMessage(msg, location.origin)` (argument
invalide pour un Worker, `location` absent de l'objet) retiré dans `src/index.ts` et `src/worker.ts`, ce qui
rétablit le typecheck et le test du transport worker.

## WASM de la CLI `aphrody`

Mesuré le 2026-10-06 (`cargo check --target wasm32-unknown-unknown`) :

- `aphrody-command` compile déjà en wasm32 (26 s, 0 avertissement), mais comme stub voulu : `run_wasm` n'affiche
  que version et aide ; toutes les variantes de `Commands` et leurs dépendances (tokio full, mio, reqwest,
  rustls/ring, git, ssh, obscura, web-service, ort, rusqlite) sont sous `cfg(not(target_arch = "wasm32"))`.
- Les capacités pures, elles, compilent en wasm32 : `aphrody-rag-core` (oxc inclus), `aphrody-toolcall-repair`,
  `aphrody-web-extract`, `aphrody-translate`.
- Bloquant pour un vrai WASM de la CLI : `Commands` est une énumération clap unique couplée au runtime async natif ;
  exposer des sous-commandes pures impose de séparer un crate pur (parsing clap + exécution sans E/S), ce qui touche
  `aphrody-command` (hors claim). Non fait. Voie retenue : le WASM porte les capacités (`api.rs`), pas la CLI ;
  `toolcall-repair` et `web-extract` peuvent rejoindre une surface `call_json` du même modèle, sans binaire CLI.

## Résultats (2026-10-06)

| Élément | Résultat |
| :-- | :-- |
| `cargo test -p aphrody-rag-core -p aphrody-rag-ffi -p aphrody-rag-wasm` (VPS) | 21 + 3 + 1 tests ok, suites rag-core existantes comprises |
| wasm32 `release` (rag-wasm, oxc inclus) | 4 041 804 o bindgen, 3 098 608 o après `wasm-opt -Oz`, 1,09 Mo gzip |
| wasm32 `release` (shell-web) | 983 485 o, 750 655 o après `wasm-opt -Oz`, 0,30 Mo gzip |
| Bun, backend wasm | 14 tests (contrat, chargement asynchrone, dérive) ok |
| Bun, backend FFI | 23 tests (contrat sur les deux backends, résultat plus grand que le scratch) ok |
| Dérive des exports C (`ffi-drift`, `ffi-symbols`) | ok |
| Micro-mesures Bun (20 000 x 384 f32, top-10 cosinus) | wasm 8,0 ms, FFI 4,4 ms ; chunk 1,3 Mo de prose : wasm 16 ms, FFI 11,5 ms |
| `cargo check -p aphrody-ffi` (re-export `aphrody_rag_*`) | ok ; présence des symboles dans le cdylib `aphrody-ffi` complet non vérifiée (pas de build release) |
| `cargo clippy -D warnings` (3 crates, `--all-targets`) | ok |
| Desktop natif | `aphrody-rag-core` testé en natif (rlib, mêmes 21 tests) ; aucune couche de binding |
