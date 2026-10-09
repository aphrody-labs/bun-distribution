<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron : trois cibles RAG (WASM web, natif desktop, FFI Bun)

> Path reconciliation (2026-10-07): `crates/ai/rag-ffi` (not in repo) → `crates/interop/ffi/src/rag_ffi.rs`. Original dated observations below retain their historical scope.

Date : 2026-10-06. Claim `shenron-targets`. Owner des capacités : `crates/ai/rag-core`
([plan RAG](rag-native-integration.md)). Aucune capacité n'est redéclarée dans un binding.

## Source de vérité unique

`crates/ai/rag-core/src/api.rs` : trois points d'entrée (`manifest`, `call_json`, `call_vec`) et deux
tables, `JSON_OPS` (chunking, texte, fusion RRF/pondérée/scores, MMR, quotas de sources, harnais eval) et
`VEC_OPS` (kernels vectoriels f32/f64/i8 sur buffers little-endian, top-k). Ajouter une capacité = une
ligne de table. Les bindings sont des adaptateurs sans logique :

| Cible | Crate / package | Forme |
| :-- | :-- | :-- |
| Web | `crates/infra/aphrody-command-wasm` (wasm-bindgen `--target web`) + `@aphrody/rag-core/wasm` | ESM, `loadRagWasm()`; module, chargeur et mémoire partagés avec `@aphrody/cli-wasm` |
| `cargo check -p aphrody-ffi` (re-export `aphrody_rag_*`) | ok ; `cargo build --release -p aphrody-ffi` (VPS, 5 min 39 s) : `nm -D` montre les 6 symboles `aphrody_rag_*` ; les 23 tests Bun FFI passent contre ce cdylib complet (395 Mo, non strippé), top-10 cosinus 20 000 x 384 en 3,2 ms |
| `cargo clippy -D warnings` (3 crates, `--all-targets`) | ok |
| `nextest run -p aphrody-command` après ajout de `Commands::Pure` | 195 tests ok sur 195 |
| `cargo test` pure, wasm, translate-core, translate | 8 + 2 + 15 + 3 tests et doctests ok |
| `cargo clippy -D warnings` (pure, wasm, translate-core, translate, command, `--all-targets`) | ok |
| `cargo check --target wasm32-unknown-unknown` (aphrody-command, translate, translate-core, pure) | ok, 0 avertissement |
| wasm32 `release` (`aphrody-command-wasm`, tout le crate pur) | 5 600 803 o bindgen, 4 234 221 o après `wasm-opt -Oz`, 1,54 Mo gzip |
| `@aphrody/cli-wasm` : tests Bun, dont parité avec `aphrody pure` natif (`APHRODY_NATIVE_BIN`, build debug) | 7 tests, 15 cas à sortie et code identiques |
| `bun pm pack --dry-run` (`@aphrody/cli-wasm`, `@aphrody/rag-core`, `@aphrody/shell-web`) | 8, 12 et 7 fichiers, `.wasm` inclus |
| Desktop natif | dépendance Rust directe sur `aphrody-rag-core` (pas de binding) | rlib |
| Backend Bun | `crates/interop/ffi/src/rag_ffi.rs` (rlib), réexporté par l'unique cdylib `aphrody-ffi` + `@aphrody/rag-core/ffi` | `openRagFfi()` |

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
  HNSW, jobs, embed/rerank, X), `yolo_*`, inférence (feature `inference`, `@aphrody/bun` `src/inference.ts`).
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

## WASM de la CLI `aphrody` : crate pur

Mesure de départ (2026-10-06) : `aphrody-command` compile déjà en wasm32 (26 s) mais comme stub (`run_wasm` :
version et aide), tout le reste de `Commands` et ses dépendances (tokio, mio, reqwest, rustls/ring, git, ssh,
obscura, ort, rusqlite) étant sous `cfg(not(target_arch = "wasm32"))`. Les capacités pures, elles, compilaient
déjà en wasm32 (rag-core oxc inclus, toolcall-repair, web-extract, translate).

Réalisé (claim `aphrody-command-pure`) :

- `crates/infra/aphrody-command-pure` : parsing clap et exécution de `aphrody pure <groupe> <commande>`, sans
  réseau, processus, tokio, git ni ssh. Entrées par un trait `PureIo` (`StdIo` natif et wasip1, `MemoryIo`
  navigateur et tests). Groupes : `rag` (`ops`, `call`, `chunk` : forwarde vers `rag-core::api`, source unique
  partagée avec les bindings wasm et FFI), `toolcall` (`repair`, `validate`, `extract`), `html` (`extract`,
  `markdown`, `simhash`), `text` (`comments`, `scrub`, `aphrodify`, `is-japanese`).
- `crates/ai/translate-core` : étages purs de `aphrody-translate` (extraction de commentaires, nettoyage des
  marqueurs IA, style Aphrody, détection du japonais) déplacés et réexportés par `aphrody-translate`, dont le
  réseau (reqwest, tokio) reste. Chemins publics inchangés. Doctest préexistant cassé de `cli.rs` corrigé.
- `aphrody-command` consomme le crate pur : variante `Commands::Pure` (dispatch natif, plus bras de `run_wasm`).
- `crates/infra/aphrody-command-wasm` (wasm-bindgen, une fonction `run`) et `packages/infra/cli-wasm`
  (`@aphrody/cli-wasm`, `loadCliWasm`, `cli.json/text/run`) ; pack à blanc seulement.

Non couvert, et pourquoi : `translate` réseau (MyMemory) et `web` avec fetch dépendent de reqwest/tokio ; `rag`
index/recherche (`aphrody-rag`) dépend de SQLite et de l'embedding natif. Un sous-ensemble de plus dans le crate
pur demande d'abord de séparer sa partie sans E/S, comme pour translate.

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
| `cargo check -p aphrody-ffi` (re-export `aphrody_rag_*`) | ok ; `cargo build --release -p aphrody-ffi` (VPS, 5 min 39 s) : `nm -D` montre les 6 symboles `aphrody_rag_*` ; les 23 tests Bun FFI passent contre ce cdylib complet (395 Mo, non strippé), top-10 cosinus 20 000 x 384 en 3,2 ms |
| `cargo clippy -D warnings` (3 crates, `--all-targets`) | ok |
| Desktop natif | `aphrody-rag-core` testé en natif (rlib, mêmes 21 tests) ; aucune couche de binding |
