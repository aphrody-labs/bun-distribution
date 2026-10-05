# Fork Bun → `yolo` : mécanismes d'extension (préparation des faits)

Date : 2026-10-05. Analyse en lecture seule de `/home/aphro/aphrody/vendor/bun` (HEAD `c439b6fbd`, `main`, checkout superficiel et blobless) et du monorepo `/home/aphro/aphrody`.
Aucun build ni `cargo check` n'a été lancé. Seule commande cargo exécutée : `cargo metadata --no-deps --offline` (monorepo).
Les chemins `src/…`, `scripts/…` et `packages/…` sont relatifs à `vendor/bun`. Les chemins `crates/…`, `apps/…`, `config/…`, `PLAN.md` et `MEMORY.md` sont relatifs au monorepo.

---

## 1. Modules intégrés `bun:*` / `node:*` : la chaîne complète

### 1.1 Les trois sortes de modules intégrés

| Sorte | Exemples | Où vit le code | Comment le natif est atteint |
|---|---|---|---|
| **Module JS intégré** (le cas général) | `bun:sqlite`, `bun:ffi`, `node:fs`, `ws`, `picocolors` | `src/js/{bun,node,thirdparty,internal}/*.ts` | Intrinsèques `$cpp`, `$rust`, `$newRustFunction`, `$newCppFunction` et `$bindgenFn` (`src/js/private.d.ts:248-284`). Exemples : `src/js/bun/sqlite.ts:17` `$cpp("JSSQLStatement.cpp", …)` et `src/js/bun/ffi.ts:174` `$newRustFunction("ffi.rs", "Bun__FFI__cc", 1)`. |
| **Module natif synthétique (C++)** | `bun:jsc`, `bun:test`, `bun:app`, `node:buffer`, `utf-8-validate` | `src/jsc/modules/*Module.h` | Liste X-macro `src/jsc/modules/NativeModuleList.h:8-18`, plus les générateurs paresseux `:27-30` (`node:module`, `node:process`, `bun`). Mode d'emploi : `src/jsc/modules/_NativeModule.h:17-27`, macro `DEFINE_NATIVE_MODULE` `:53-57`. **C++ uniquement.** |
| **Propriété paresseuse de `Bun.*`** | `Bun.Glob`, `Bun.Archive`, `Bun.WebView` | `src/jsc/bindings/BunObject+exports.h:5-12`, `BunObject.cpp:919,927,1025` (`PropertyCallback`) | Rappel Rust `BunObject_lazyPropCb_*` (`src/runtime/api/BunObject.rs:293-296`), qui renvoie un constructeur généré (`BunObject.rs:1741` → `get_constructor::<Glob>`). |

### 1.2 Chaîne d'un module JS intégré (cas `bun:sqlite`, ou `picocolors` absorbé)

1. **Résolveur (Rust).** Trois points d'entrée dans `src/resolve_builtins/HardcodedModule.rs` :
   - variante d'enum `HardcodedModule` avec `#[strum(serialize = "bun:sqlite")]` (`:6-211`) ;
   - entrée dans `HARDCODED_MODULE_MAP` (`:213-321`) ;
   - entrée d'alias dans `BUN_EXTRA_ALIAS_KVS` (`:717-825`). Les alias `node:` vont dans `COMMON_ALIAS_KVS` (`:418-715`).

   `Alias::get` (`:945-963`) sépare `--target=bun` de `--target=node`. Les alias de `BUN_EXTRA_ALIAS_KVS` ne valent que pour la cible bun.
2. **Chargeur (Rust).** `get_hardcoded_module` (`src/runtime/jsc_hooks.rs:3523-3611`) : le bras par défaut (`:3604-3609`) produit `js_synthetic_module(name)`. Cette fonction convertit le nom en tag numérique par `Tag::from_name` (`:3509-3516`), via une PHF générée.
   Les modules soumis à condition (`bun:internal-for-testing`, `stream/iter`) ont un bras dédié qui renvoie `None` (`:3554-3594`).
3. **Codegen (TS, exécuté au build).**
   - `src/codegen/internal-module-registry-scanner.ts:6-11` liste `bun/`, `node/`, `thirdparty/` et `internal/`, **triés de A à Z**. Chaque fichier reçoit un id numérique.
   - Les modules natifs sont ajoutés ensuite, numérotés dans l'ordre de `NativeModuleList.h` (`:38-53`).
   - Un `require("x")` interne devient `$getInternalField($internalModuleRegistry, id) || $createInternalModuleById(id)` (`:61-63`).
   - Le nom public est dérivé du chemin (`src/codegen/bundle-modules.ts:356-368`) : `bun/x.ts` → `bun:x`, `node/x.ts` → `node:x`, `thirdparty/x.ts` → `x`.
   - Sorties : `InternalModuleRegistryConstants.bin`, inclus dans le binaire par `.incbin` (`bundle-modules.ts:516-540`, en-tête `"BUNBLTNS"` `:497`). Puis `InternalModuleRegistry+createInternalModuleById.h` (`:601-627`) et `generated_resolved_source_tag.rs`, la table PHF Rust spécifier → tag `(1<<9)|id` (`:632-659`).
   - Les modules natifs C++ passent par `generateNativeModule_<Enum>` (`:615-617`).
4. **Pont JS → natif.**
   - `$rust("fichier.rs", "Sym")` / `$newRustFunction` → `src/codegen/generate-js2native.ts`. Le premier argument doit figurer dans `rustIdentifierPaths` (`:46-104`), faute de quoi le build échoue (`:116-123`).
   - Le générateur émet `generated_js2native.rs`, des thunks `#[no_mangle]` `JS2Rust__…` (`:344-382`), qui appellent `crate::<module>::<fn_snake>` quand le fichier est sous `src/runtime/` (`:329-335`). Sinon l'appel passe par `crate::dispatch::js2native::<mangled>` (`:336-338`).
   - Ce point d'atterrissage est `src/runtime/dispatch_js2native.rs:1-25`, des `pub use` vers les crates ponts `*_jsc`, par exemple `bun_sql_jsc::mysql::create_binding` `:19`.
   - Le C++ consomme `GeneratedJS2Native.h` (`:196-280`).
5. **Classes natives.** `*.classes.ts` (31 fichiers, glob `src/**/*.classes.ts`, `scripts/glob-sources.ts:47-49`) passe par `src/codegen/generate-classes.ts`, qui produit le C++ JSC et `generated_classes.rs`.
   Côté Rust, une `struct` porte `#[bun_jsc::JsClass]` et des méthodes `#[bun_jsc::host_fn(method)]` (`src/runtime/api/glob.rs:18-19,576-659`, définition `src/runtime/api/Glob.classes.ts`).
   Bindgen typé : `*.bind.ts`, 6 fichiers (`glob-sources.ts:68`), appelé par `$bindgenFn`.
6. **Liste C++ `isBuiltinModule`.** `src/jsc/bindings/isBuiltinModule.cpp:3-84` est une liste codée en dur, utilisée entre autres par `Bun.plugin().module()` pour refuser de surcharger un intégré (`BunPlugin.cpp:130`).
   Elle contient `ws` et `undici`, mais **pas** `picocolors`, `uuid`, etc. Le commit Aphrody `8b5badd2a` ne l'a pas mise à jour : c'est un petit trou.
7. **Types.** `packages/bun-types/*.d.ts` (`declare module "bun:sqlite"`).

### 1.3 Contraintes

- **Pas de snapshot de tas.** JSC n'a pas l'équivalent du snapshot V8. Les sources des modules intégrés sont embarquées en latin-1 (`checkAscii`, `bundle-modules.ts:474`) et compilées paresseusement au premier `require` (création par id).
  Le seul AOT est du bytecode, embarqué par `bun build --compile --bytecode` (`src/jsc/bindings/InternalModuleRegistry.cpp:27-29,119-122`).
- **Chargement paresseux natif.** Un objet par défaut est mis en cache par slot (`_NativeModule.h:70-132`). Les propriétés `Bun.*` sont `PropertyCallback`.
- **Ce ne sont pas des modules ES.** `require` n'accepte qu'un littéral et `export default` est réécrit en `return` (`src/js/README.md`, `src/js/CLAUDE.md`). Il n'y a pas d'`import` non typé.
- **Ids renumérotés.** L'ajout d'un fichier décale les ids qui suivent (tri A-Z). C'est sans conséquence ABI puisque tout est dans le binaire, mais cela régénère le codegen.
- **Limite de taille.** La table de dépendances et `nativeStartIndex` sont en `u16` (`bundle-modules.ts:488-489`).
- **Particularité du scanner.** `internal-module-registry-scanner.ts:16-22` teste `startsWith("bun:")` sur des chemins `bun/…`. Ce test n'est jamais vrai : un module JS `bun/*` ne peut donc pas être `require("bun:x")` par spécifier depuis `src/js`.
  On passe alors par un chemin relatif ; le prototype `bun:aphrody` faisait `require("./ffi")`. Les modules natifs (`bun:jsc`) restent accessibles par spécifier (`src/js/node/v8.ts:7`).
- **Lints de l'espace de travail sur le code Rust ajouté.** `warnings = deny`, `dead_code = deny`, `unreachable_pub = deny` (`Cargo.toml:183,194,200`), et `clippy.toml` interdit `std::fs::*`. Les conventions de `src/CLAUDE.md` s'appliquent aussi (`bun_sys`, `bun_core::String`).

### 1.4 Où ajouter un espace `yolo:*` ou `bun:yolo/*`

**Option A : `bun:yolo/<nom>`.** Diff minimal, aucune modification du codegen.
- Fichier `src/js/bun/yolo/<nom>.ts`. Le nom public `bun:yolo/<nom>` et son tag sont produits automatiquement (`bundle-modules.ts:361-362`).
- `HardcodedModule.rs` : variante, entrée de map, `entry!("bun:yolo/<nom>")` dans `BUN_EXTRA_ALIAS_KVS`.
- Optionnel : `isBuiltinModule.cpp` et `packages/bun-types/yolo.d.ts`.
- Tous les traitements du préfixe `bun:` viennent gratuitement :
  - externe au bundler : `src/resolver/resolver.rs:1134-1147` ;
  - namespace `bun` : `src/bundler/linker.rs:409-413`, `bundle_v2.rs:4299,6608,6859`, `generateChunksInParallel.rs:1753`, `src/jsc/RuntimeTranspilerStore.rs:1030` ;
  - masquage dans les traces de pile : `src/jsc/VirtualMachine.rs:6490,6987`, `src/sourcemap_jsc/JSSourceMap.rs:47`.

**Option B : `yolo:<nom>`.** Plus de surface de conflit avec l'amont.
- Nouveau répertoire `src/js/yolo/`, à ajouter dans `internal-module-registry-scanner.ts:6` et dans `idToPublicSpecifierOrEnumName` (`bundle-modules.ts:356-368`).
- Variantes et alias dans `HardcodedModule.rs`. Le résolveur rendrait déjà externe tout alias présent, par `HardcodedAlias::has` (`resolver.rs:1137`).
- À répliquer pour la parité avec `bun:` : les sites `bun:` listés ci-dessus (une dizaine), plus `isBuiltinModule.cpp`.
- Un nom de fichier `thirdparty/yolo:x.ts` n'est pas portable sous Windows : le répertoire dédié est donc nécessaire.

**Natif Rust derrière le module.**
- Le module JS appelle `$newRustFunction("yolo.rs", "Yolo__x", n)` ou `$rust(...)`.
- Le fichier est déclaré dans `rustIdentifierPaths` (`generate-js2native.ts:46`).
- Le code vit soit sous `src/runtime/yolo/…` (`crate::yolo::…`), soit dans un crate pont `yolo_*_jsc` réexporté dans `src/runtime/dispatch_js2native.rs`. C'est le patron `bun_sql` / `bun_sql_jsc`.
- Classes : `src/runtime/yolo/*.classes.ts` + `#[bun_jsc::JsClass]`.
- Un module natif « pur Rust » au sens `NativeModuleList.h` n'existe pas : ce mécanisme est en C++.

**Test de fumée existant à étendre.** `apps/yolo/forge/src/plan.ts:412-423` (`ABSORBED` et `SMOKE_SCRIPT` : `require.resolve(s) === s`).

---

## 2. Plugins et chargement natif sans recompiler Bun

| Mécanisme | Recompiler Bun ? | Rust natif à l'exécution | Threads | Accès JSC | Perf / ABI |
|---|---|---|---|---|---|
| **`Bun.plugin` runtime** (`src/jsc/bindings/BunPlugin.cpp`) : `onLoad`, `onResolve`, `module(id, fn)` virtuel (`:100-147`) | Non | Oui, indirectement. `build.module("yolo:obscura", () => ({ exports: require("x.node"), loader: "object" }))`. Chargeur `object` : `src/jsc/bindings/ModuleLoader.cpp:238-284`, documenté dans `packages/bun-types/bun.d.ts:6311-6333`. Pré-chargement par `bunfig.toml` `preload`. | Thread JS | Celui de l'addon chargé | Résolution JS à chaque import. Refuse de surcharger un intégré (`BunPlugin.cpp:130`). |
| **Addon NAPI `.node`** (napi-rs) : `process.dlopen` → `dlsym("napi_register_module_v1")` (`src/jsc/bindings/BunProcess.cpp:733-781`) | Non | **Oui, le meilleur levier.** Objets JS via `napi_value`, async work, threadsafe functions (`src/runtime/napi/napi_body.rs`). En-têtes Node-API v10 (`src/runtime/napi/README.md`). | Appels NAPI sur le thread JS ; autres threads via `napi_threadsafe_function` | Indirect (handles NAPI). Pas d'API C++ JSC. Une cale V8 partielle existe (`src/jsc/bindings/v8/`). | ABI stable Node-API, binaire indépendant de la version de Bun. Coût par appel plus élevé qu'un `host_fn`. Panique Rust à capturer (FFI). |
| **`bun:ffi` `dlopen`** (`src/runtime/ffi/ffi_body.rs`, trampolines JIT TinyCC `:38,505`) | Non | Oui : cdylib Rust exposant une C-ABI | Appels synchrones sur le thread JS (bloquants). `JSCallback({threadsafe:true})` pour les rappels d'autres threads (`ffi_body.rs:114`). | Aucun, sauf les types ABI `napi_env` / `napi_value` (`src/runtime/ffi/abi_type.rs:99,240`) | Le plus rapide pour nombres et pointeurs. Chaînes en `cstring` + free manuel. ABI = contrat C de la lib. |
| **`bun:ffi` `cc`** (`$newRustFunction("ffi.rs","Bun__FFI__cc")`, `src/js/bun/ffi.ts:174`) | Non | **Non** : compile du **C** avec TinyCC à l'exécution | idem | idem (+ `#include <node_api.h>`) | JIT C, pas de Rust. |
| **Plugin natif du bundler** (`packages/bun-native-plugin-rs`, `onBeforeParse`) : `src/js/builtins/BundlerPlugin.ts:175-197`, `src/bundler/ParseTask.rs:1632,2141` | Non | Rust, mais **uniquement au bundling** (`Bun.build`), pas comme module runtime | Appelé sur **n'importe quel thread, en concurrence** (README « Concurrency ») | Aucun (C-API `bundler_plugin.h`) | Hook unique `onBeforeParse`. Livré comme addon NAPI. |

**Bilan.**
- Pour charger du Rust à l'exécution sans recompiler Bun, deux voies : **NAPI**, si des objets JS sont nécessaires, ou **`bun:ffi`** avec une cdylib C-ABI, pour des appels scalaires et JSON.
- Un module intégré du fork (`bun:yolo/*`) peut envelopper l'une ou l'autre. C'est exactement ce que faisait le prototype `bun:aphrody` (voir §5.2) : `dlopen` d'une lib désignée par une variable d'environnement, avec contrôle d'ABI.
- L'accès direct à JSC (`JSValue`, `JsClass`, `host_fn`) n'existe que pour du code compilé **dans** le binaire.
- Une cdylib Rust embarque sa propre `std`. C'est acceptable pour un DSO séparé, mais une **staticlib** liée dans Bun est refusée par l'amont (copie double de `std` : `scripts/build/deps/lolhtml.ts:5-8`).

**Voie sans recompilation propre à Obscura : `Bun.WebView`.**
- Le backend Chrome de `Bun.WebView` parle CDP. Il lance un binaire choisi par `backend.path` ou `BUN_CHROME_PATH` (`src/runtime/webview/ChromeProcess.rs:235-242`, transport `--remote-debugging-pipe`), ou se connecte à un `ws://` existant (`backend: {type:"chrome", url}`, `packages/bun-types/bun.d.ts:9630-9670`).
- `obscura-cdp` expose déjà `ws://host:port/devtools/browser` (`crates/web/obscura-cdp/src/server.rs:353,360,992`).
- Obscura (V8) peut donc rester **hors processus** et être piloté par `Bun.WebView` sans lier V8.
- À qualifier :
  - couverture des domaines CDP utilisés par Bun (`Target.createTarget`, Page, Input) ;
  - mode `--remote-debugging-pipe`, non implémenté côté Obscura : aucune occurrence trouvée dans `crates/web`.

---

## 3. Workspace Cargo du fork et liaison d'un crate externe

### 3.1 Structure

- `Cargo.toml` racine : 100 membres `src/*` (`:3-103`), `exclude = ["vendor"]` (`:104-108`).
- `[profile.release]` : `lto = "off"`, `codegen-units = 1`, `panic = "abort"` (`:129-134`). La LTO est faite **au lien**, voir §4. `[profile.dev] panic = "abort"`.
- `workspace.dependencies` : une quinzaine de crates externes, plus `lol_html = { path = "vendor/lolhtml" }` (`:349`) et `rust-argon2 = { path = "vendor/rust-argon2" }` (`:322`).
- Racine du graphe : `bun_runtime` (`src/runtime/Cargo.toml`, `[lib]` seul). Toute crate de sa fermeture de dépendances voit son rlib lié (`scripts/build/rust.ts:26-33`).
- Toolchain : `nightly-2026-09-15` (`rust-toolchain.toml:2`). Le monorepo est en stable `1.98.1` (`rust-toolchain.toml:10`), `rust-version 1.97`, edition 2024. Les crates Obscura sont en edition 2021.
- **Contrainte forte** : le LLVM de rustc et celui de clang doivent avoir la même majeure (`scripts/build/CLAUDE.md`, Phase 1 §2 ; commit amont `a4f142914`). bun-forge épingle LLVM 23.1.1 (`config/bun-forge.json`).
- `Cargo.lock` du fork : **282 paquets (180 externes)**. Aucun `tokio`, `hyper`, `rustls`, `ring`, `reqwest`, `url`, `html5ever`, `mio` : Bun a sa propre boucle d'évènements (uSockets / libuv), son client HTTP (`src/http`) et BoringSSL.
  Présents : `serde 1.0.228`, `rustix 0.38.44`, `hashbrown 0.15/0.16/0.17`, `selectors 0.33` et `cssparser 0.36` (via `lol_html`), `phf 0.13.1`, `getrandom 0.4.2`, `strum 0.26`.

### 3.2 Comment le build traite une crate

- cargo **planifie** (`cargo build … -Zunstable-options --unit-graph`, `scripts/build/rust/plan.ts:357` ; `cargo metadata --locked`, `:366`) et ninja **exécute** une invocation rustc par crate (`rust.ts:1-24`).
- `--locked` est imposé (`rust.ts:284`) : tout ajout exige un `Cargo.lock` commité.
- Paquet chemin, membre ou non (`isLocal`, `scripts/build/rust/units.ts:53-54,144`) : ses `[lints]` s'appliquent, sans `--cap-lints`. Les dépendances de registre et git reçoivent `--cap-lints allow` (`units.ts:532`).
- Bibliothèques natives des build scripts : liées sous Linux grâce au commit Aphrody `cf4e24966` (`scripts/build/rust/native-link.ts`). **Rien sous macOS ni Windows** (`native-link.ts:83` `if (!cfg.linux) return undefined`).
- Contrôles du binaire (`scripts/build/binary-expectations.ts`) :
  - ensemble **exact** des `NEEDED` ;
  - liste fermée des **initialiseurs statiques** (`:102-111,196-257`) ;
  - doublons de symboles forts.

  En CI ces contrôles échouent ; localement ils ne font qu'avertir.

### 3.3 Options de liaison d'une crate du monorepo (ex. `obscura-dom`)

| Option | Fonctionne localement | Fonctionne sous bun-forge | Remarques |
|---|---|---|---|
| **path dep** `../../../crates/web/obscura-dom` | Oui (`vendor/bun` est imbriqué dans le monorepo, qui n'en fait pas un membre : `Cargo.toml:4-10` du monorepo) | **Non.** bun-forge construit un `git worktree` frais du seul dépôt fork (`apps/yolo/forge/src/run.ts:443-447`) : le chemin n'existe pas. | Les champs `workspace = true` d'Obscura se résolvent contre la racine du monorepo. Couplage fort. |
| **git dep** `{ git = "…/aphrody", rev = … }` | Oui | Oui si le dépôt est accessible | Cargo clone tout le monorepo dans `CARGO_HOME/git`. L'héritage `workspace = true` est supporté pour les dépendances git. Lourd. |
| **sous-module git** | — | **Non** sans modifier bun-forge (`worktree add` sans `submodule update`) | Contraire à la convention Bun : les `vendor/` ne sont pas des sous-modules (`CLAUDE.md` du fork). |
| **Vendoring dans `vendor/<nom>`** | — | — | `/vendor` est **ignoré par git** dans le fork (`.gitignore:148`). Il faut donc soit une crate copiée sous `src/<nom>` comme membre (soumise aux lints de l'espace de travail sauf `[lints]` propres), soit le patron ci-dessous. |
| **Patron amont `deps/lolhtml.ts`** : `github-archive` épinglé par commit, récupéré dans `vendor/<nom>`, path dep dans l'espace de travail | Oui | Oui | `scripts/build/deps/lolhtml.ts:16-52`. Mais `emitRust` n'attend que les tampons de lolhtml et rust-argon2, codés en dur (`scripts/build/bun.ts:183` `vendorStamps`) : un 3ᵉ dépôt demande d'éditer `bun.ts`. Il faut une archive autonome : un dépôt Obscura dédié, et non le monorepo entier. |
| **crates.io** (PLAN §8 « tout publié ») | Oui | Oui | Le plus propre avec `--locked` et `--cap-lints allow`. Exige des manifestes sans `workspace = true` non résolu (ce que `cargo publish` normalise). |

### 3.4 Conflits de versions probables (lock du fork ↔ `Cargo.lock` du monorepo)

| Crate | Fork | Monorepo | Effet si Obscura est lié |
|---|---|---|---|
| `selectors` / `cssparser` | 0.33 / 0.36 (via `lol_html`) | 0.24, 0.33, **0.38** / 0.29, 0.36, **0.37** | Doubles versions (`obscura-dom/Cargo.toml:11-12`, `obscura-render/Cargo.toml:49`). Pas de conflit de lien, mais plus de taille et de temps de compilation. |
| `html5ever` / `markup5ever` / `string_cache` | absents | html5ever 0.29 → **0.40.1** | Nouvel arbre complet (`obscura-dom/Cargo.toml:10`). |
| `tokio` / `mio` / `hyper` / `reqwest` / `rustls` / `ring` | **absents** | tokio 1.53.1, hyper 1.11.1, reqwest 0.12 + 0.13.5, rustls 0.23.45, ring 0.17.14 | `obscura-net/Cargo.toml:16-18`. Ajoute un 2ᵉ runtime async (threads tokio) et une 2ᵉ pile TLS à côté de uSockets et BoringSSL. `ring` compile du C et de l'asm (symboles préfixés `ring_core_*`, pas de collision). |
| `wreq` (feature `stealth`) | — | 6.0.0-rc.31 (boring2 / boring-sys2) | **Seconde BoringSSL statique** à côté de celle de Bun. `prefix-symbols` seulement sous Linux et Android (`obscura-net/Cargo.toml:55` contre `:58`) : risque de doublons de symboles `SSL_*` ailleurs, que le contrôle de doublons détecterait. |
| `rustix` | 0.38.44 | 0.38.44 + 1.1.5 | `tempfile` (obscura-net `:29`) tire rustix 1.x : 2ᵉ version. |
| `getrandom` | 0.4.2 | 0.1 → 0.4.3 | Unifiable en 0.4. |
| `serde` / `serde_json` | 1.0.228 / 1.0.149 | 1.0.229 / 1.0.151 | Semver compatible, un seul exemplaire après mise à jour du lock. |
| `hashbrown`, `phf`, `strum`, `bitflags`, `thiserror` | 0.15 / 0.13 / 0.26 / 2 / 2 | plusieurs versions | Duplications mineures. |

Autres contraintes :
- `panic = "abort"` partout : un `catch_unwind` dans du code Obscura devient un abort.
- Allocateur global mimalloc imposé par `bin_entry`. Aucun `#[global_allocator]`, `ctor`, `inventory` ou `linkme` n'a été trouvé dans `obscura-{dom,net,render,browser}`.
- En revanche `deno_core` dépend d'`inventory`, ce qui violerait la liste des initialiseurs statiques.

---

## 4. Build, ressources, et Obscura face à V8

### 4.1 Build

- **Pilote.** `bun scripts/build.ts --profile=release` (`package.json` racine). Le profil `release` utilise WebKit **précompilé** et la ThinLTO sur bun, le bitcode du WebKit `-lto` et Rust (`scripts/build/profiles.ts:129-137`).
  Rust est émis en bitcode (`-C linker-plugin-lto`, `rust.ts:508`) dès `release && !asan` (`scripts/build/flags.ts:1504-1506`). Chaque crate forme une seule unité de code (`Cargo.toml:131`).
  **Conséquence** : toute crate ajoutée passe dans l'optimisation LTO du lien final, donc plus de temps de lien et de RAM, et compile ses gros crates sur un seul thread.
- **Graphe.** Codegen d'environ 20 étapes, puis rustc par crate (pipeline `.rmeta` sous `oven-sh/ninja`), dépendances C/C++ en `direct`, `nested-cmake` ou `prebuilt`, lien clang++/lld, puis contrôles (`scripts/build/CLAUDE.md`, Phase 2).
- **bun-forge** (`apps/yolo/forge/src/{main,plan,run}.ts`, `config/bun-forge.json`) :
  - dépôt `aphrody-labs/bun`, branche `main`, profil `release`, `lto: true` ;
  - scratch `auto` de **96 G** (loop ext4, tmpfs ou répertoire, `plan.ts:289-344`) ;
  - LLVM 23.1.1, cmake 3.30.5, rustup 1.28.2 ; paquets apt dont `golang`, `nasm`, `perl`, `ruby` ;
  - `CCACHE_MAXSIZE=40G`, `CARGO_INCREMENTAL=0` (`plan.ts:380-403`) ;
  - commande `bun scripts/build.ts --profile=release [--lto=off] [-jN]` (`plan.ts:405-410`) ;
  - toolchain Rust lue dans `rust-toolchain.toml` du checkout (`run.ts:448-472`) ;
  - artefact `build/release/bun` (`run.ts:476`), test de fumée `SMOKE_SCRIPT` (`run.ts:490-494`), reçu JSON avec sha256.
- **Temps mesuré disponible.** « premier build complet … `954db0c0`, **7 min 10 s** » (`PLAN.md:134-135`). Le matériel n'est pas consigné, et ce chiffre n'a pas été revérifié. `MEMORY.md:51` dit encore « non qualifié » pour `c439b6fbd`. Le build release de `c439b6fbd` tourne en ce moment sur le VPS ; il n'a pas été lancé ici.
- **Coût d'un ajout comme Obscura-net.** Environ 100 à 150 crates en plus (tokio, hyper, h2, reqwest, rustls, ring…), en bitcode dans la LTO. Ce coût n'est **pas mesuré** ; il faudra une comparaison avant/après par bun-forge.

### 4.2 Obscura et V8 (vérifié)

- **`obscura-js` dépend de V8.**
  - `deno_core = "0.412"` en `[build-dependencies]` et en `[dependencies]` (`crates/web/obscura-js/Cargo.toml:21,26`).
  - `Cargo.lock` du monorepo : `deno_core 0.412.0 → deno_v8 0.4.0 → v8 150.4.0` (crate `v8` avec `bindgen`).
  - `build.rs:8` génère un snapshot V8 `OBSCURA_SNAPSHOT.bin`.
  - Contenu : `js/bootstrap.js` de 734 Ko (DOM en JS), `src/ops.rs` de 282 Ko avec **59 `#[op2]`**, `src/runtime.rs` de 853 Ko avec 264 références `deno_core::` / `v8::`.
- **Dépendants transitifs de V8** (`cargo metadata --no-deps --offline`) :
  - `obscura-browser` (`Cargo.toml:17` → obscura-js) ;
  - `obscura-cdp` (`:18-19`) ;
  - `obscura-mcp` (`:16`) ;
  - `aphrody-obscura` (feature `api` par défaut → obscura-browser, `crates/web/obscura/Cargo.toml:10-11`).
- **Sans V8** :
  - `obscura-dom` (cssparser, html5ever, precomputed-hash, selectors) ;
  - `obscura-net` (reqwest, rustls, tokio, plus `wreq` optionnel) ;
  - `obscura-render` (taffy, et en option tiny-skia, athena-text, resvg).
- **Conséquence.** Seuls dom, net et render peuvent être liés dans Bun. Le « moteur » (browser, js, cdp) exige de réécrire la couche `deno_core` sur JSC : `bootstrap.js` à exécuter sur JSC, et 59 ops à refaire en `host_fn`, `JsClass` ou `$rust`. Sinon le moteur reste hors processus (CDP, §2).
- Liens WebKitGTK : le monorepo verrouille `webkit2gtk 2.0.2` et `javascriptcore-rs 1.1.2`, utilisés par la pile Tauri (fork `crates/tauri/*`, 57 entrées). Les lier dans Bun ajouterait une seconde JavaScriptCore dynamique (libjavascriptcoregtk) à côté de la JSC statique de Bun, et casserait l'ensemble `NEEDED` attendu. Point non testé.

---

## 5. Les 6 commits Aphrody du fork

Origine : `git log --author=aphrody origin/main` ; la base amont est `9bd19c98e`.

| Commit | Date | Contenu | Patron réutilisable ? |
|---|---|---|---|
| `d2d160ee6` | 10-03 | `packages/bun-types/tauri.d.ts` (52 lignes) + `index.d.ts:+1` : déclare `Bun.tauri.*`, dont `getDisplayConfig()` | **Types sans runtime.** `getDisplayConfig` n'apparaît nulle part dans `src/` : `Bun.tauri` vaut `undefined` à l'exécution. Le monorepo consomme `@types/bun` officiel (8 déclarations), pas `@aphrody/bun-types` : ces types ne sont pas utilisés. |
| `fa052eacc` | 10-03 | 14 `package.json` passés sous le scope `@aphrody/*` (`bun-types`, `bun-mdx-rs` + 7 plateformes, `bun-debug-adapter-protocol`, `bun-inspector-*`, `bun-plugin-svelte/yaml`) | Identités npm (§6). |
| `cf4e24966` | 10-05 | `scripts/build/rust/native-link.ts` (+126 lignes) : propage `rustc-link-lib`/`-search` des build scripts vers le lien clang (Linux), via un fichier de réponse et une règle ninja `rust_native_link` ; `bun.ts`, `rust.ts`, `ninja.ts`, `timings.ts` ; test de 240 lignes | **Prérequis** pour lier des crates externes à bibliothèques natives (dylib, static `-bundle`). Linux seulement. |
| `8b5badd2a` | 10-05 | `picocolors`, `tiny-invariant`, `dotenv` (+`/config`), `uuid` : `src/js/thirdparty/*.ts` + `src/js/internal/dotenv.ts` + 3 points dans `HardcodedModule.rs` + `test/js/first_party/*` | **Patron des modules JS absorbés** (sans natif). Lacunes : `isBuiltinModule.cpp`, aucun `.d.ts`. |
| `954db0c03` | 10-05 | `bun.lock` synchronisé avec le renommage `@aphrody/bun-types` (refus de `--frozen-lockfile`) | La clé `resolutions["bun-types"]` reste `workspace:packages/bun-types` dans le `package.json` racine. |
| `c439b6fbd` | 10-05 | fusion `upstream/main` → `main` | — |

### 5.1 Ce que ces commits ne contiennent pas

Aucun commit de `main` ne fixe encore de patron de **module intégré natif** (`bun:*` adossé à Rust). Ce patron existe hors `main` :
- branche `claude/aphrody-unified-ffi` (n'est plus une tête distante, mais les objets sont présents localement) ;
- commits `94a34b49d4` → `0ba45879b0` (2026-09-28/30), `bun:aphrody` :
  - `src/js/bun/aphrody.ts` (117 lignes) : `require("./ffi")`, `dlopen` d'une lib désignée par `APHRODY_FFI_LIB` ou cherchée à côté de `process.execPath`, contrôle `*_abi_version`, chaînes possédées libérées par `*_string_free` ;
  - `HardcodedModule.rs` (+4), `packages/bun-types/aphrody.d.ts`, `test/js/bun/resolve/aphrody.test.ts` ;
  - qualifié le 2026-09-30 : 14 tests passés en `bun bd test` (`docs/migration/BUN-FORK-UNIFIED-NATIVE.md:42-51`).
- `git merge-base --is-ancestor 0ba45879b c439b6fbd` → **absent de `main`**.

### 5.2 Autres faits sur le dépôt distant

- `refs/heads/aphrody` (`ef75653d`, 2026-10-02 : « Aphrody fork kernel, runtime bridge », paquet JS `packages/aphrody-bun-runtime`) existe encore sur `origin`.
- `origin` compte **12 457 têtes** (miroir des branches amont). « Branche unique » n'est vrai que pour la branche de travail.

---

## 6. Renommage `aphrody-labs/bun` → `aphrody-labs/yolo`

### 6.1 Collisions avec l'existant

- **`aphrody-labs/yolo` existe déjà** (`git ls-remote git@github-dev:aphrody-labs/yolo.git HEAD` → `048886bf…`). `PLAN.md:166` prévoit de l'archiver comme « absorbé ».
  GitHub refuse un renommage vers un nom pris, archivé compris : il faut d'abord renommer ou supprimer l'ancien `yolo`. Après le renommage, GitHub redirige `aphrody-labs/bun`, tant qu'aucun nouveau dépôt ne reprend ce nom.
- **Binaire `yolo`** : collision avec le CLI Bun `yolo` du monorepo (`apps/yolo/cli/package.json` `bin.yolo`, PLAN §5 « un seul CLI `yolo` »). C'est une décision à prendre : soit le fork devient l'hôte du CLI `yolo`, soit les deux noms sont séparés.
- **26 fichiers du monorepo** citent `aphrody-labs/bun`, notamment :
  - `config/vendor.json:8`, `config/bun-forge.json` (`repository`), `config/bun-absorb.json` ;
  - `apps/yolo/forge/src/{plan,main}.ts`, `apps/yolo/cli/src/{index,package-commands}.ts` ;
  - `scripts/tools/vendor/bun_upstream_{sync,tracker}.ts`, `scripts/audit/workspace/bun-absorb.ts` ;
  - les docs.
- Le remote `origin` de `vendor/bun` pointe aussi vers ce nom.

### 6.2 Doit rester `bun` (compatibilité)

- Global `Bun`, module `bun`, spécifiers `bun:*` et `node:*`, `process.versions.bun` (`src/jsc/bindings/BunProcess.cpp:266`).
- User-Agent `Bun/<version>`, utilisé par défaut dans fetch et pour le registre npm (`src/bun_core/Global.rs:825-832`, `src/http/lib.rs:991-998`, `src/install/npm.rs:88,123`).
- `npm_config_user_agent = "bun/<ver> npm/? node/v…"` (`src/runtime/cli/run_command.rs:701-708`) : les outils s'en servent pour détecter le gestionnaire de paquets.
- Variables `BUN_*` (101 lignes dans `src/bun_core/env_var.rs`), `bunfig.toml`, `bun.lock`, `~/.bun` / `BUN_INSTALL`.
- `bunx` reconnu par argv0 (`src/runtime/cli/mod.rs:821-839,909`).
- Version semver amont `1.4.3` (`package.json` racine), pour les contrôles `engines.bun`.
- Paquets de types `bun-types` / `@types/bun`, si l'on veut que l'écosystème les accepte.

### 6.3 Peut porter `yolo`

- Le nom du dépôt.
- Le nom du fichier binaire ou un lien symbolique. Le build produit `bun-profile` + `bun` (`scripts/build/config.ts:1610-1620`, `bun.ts:499`), et rien ne teste `argv0 == "bun"` : un lien `yolo` → binaire se comporte comme `bun`.
- Les artefacts de release.
- Les espaces de modules `bun:yolo/*` ou `yolo:*`.
- Une identité supplémentaire (`process.versions.yolo`, `Bun.revision` = sha git).
- Les paquets npm `@aphrody/*` (déjà en place).

### 6.4 À rediriger, sinon le fork est remplacé ou mal tracé

- **`bun upgrade`** télécharge les releases `oven-sh/bun` (`src/runtime/cli/upgrade_command.rs:163,624`) et écraserait le fork par le binaire officiel.
- **`bun build --compile --target=<autre>`** télécharge `@oven/bun-<os>-<arch>` depuis npm (`src/options_types/compile_target.rs:150-153`). La cible hôte réutilise l'exécutable courant (`:197-206`). Un exécutable compilé pour une autre plateforme n'embarquerait donc pas les modules du fork.
- **Rapports de crash** vers `https://bun.report` (`src/crash_handler/lib.rs:569`) : révisions inconnues de l'amont. On peut les surcharger par `BUN_CRASH_REPORT_URL` (`:1462`).
- **Bundles `--target=bun`** : les alias absorbés (`uuid`, `picocolors`, …) et `bun:yolo/*` restent **externes** (`src/resolver/resolver.rs:1134-1147`). Un bundle produit par le fork ne tourne donc que sur le fork, à moins que `node_modules` soit présent.

---

## Lacunes et incertitudes

- Rien n'a été compilé ni exécuté. Le comportement des options §1.4 et §3.3 est déduit du code, non testé.
- Le temps de 7 min 10 s provient de `PLAN.md` ; le matériel n'est pas connu.
- La couverture CDP d'Obscura par rapport aux besoins de `Bun.WebView` n'a pas été vérifiée.
- La visibilité (publique ou privée) de `aphrody-labs/aphrody` pour une dépendance git n'a pas été vérifiée.
- Le surcoût de compilation et de taille d'un ajout `obscura-net`/`obscura-dom` n'est pas mesuré.
- Docs du monorepo périmées sur le fork : `docs/BUN-BUILD.md:8,93` (« branche `yolo` = pin ») contredit `docs/BUN_FORK.md:24` (branche unique `main`). Non corrigé (lecture seule).
