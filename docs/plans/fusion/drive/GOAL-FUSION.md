<!-- SPDX-License-Identifier: Apache-2.0 -->
# GOAL — directive de fusion (décision du 2026-10-05)

Deux textes : le `GOAL.md` du nouveau monorepo `aphrody-labs/yolo`, puis l'amendement à placer dans le `GOAL.md` d'`aphrody-labs/aphrody`.

## A. `aphrody-labs/yolo/GOAL.md`

### 1. Rôle

`yolo` est le monorepo du runtime : le noyau (portage Rust de Bun, crates `crates/core/*`
préfixées `aphrody-`), le navigateur Obscura porté sur JavaScriptCore (`crates/browser/*`,
code première partie), et les plugins natifs N-API (`crates/plugins/*`, paquets
`@aphrody/plugin-*`). Il produit un binaire unique, `yolo` (alias `bun` posé par
l'installateur), et publie l'ABI de plugin `v1`. Il ne connaît pas `aphrody` : `aphrody`
consomme `yolo`, jamais l'inverse.

### 2. Règles non négociables

- Un seul binaire, un seul moteur JavaScript : JavaScriptCore. V8 et deno_core sont absents
  du dépôt. Le runtime de page d'Obscura tourne dans un realm JSC par page, dans un Worker,
  derrière l'hôte de realm du noyau (`aphrody-realm-host`). La parité anti-détection est
  mesurée (`just bench`), pas prérequise.
- Une seule implémentation par capacité d'E/S, celle du noyau : `aphrody-http` (H1/H2/H3,
  SOCKS5), BoringSSL avec profil ClientHello Chrome, `aphrody-dns` + SSRF,
  libdeflate/brotli/zstd, `aphrody-event-loop` + `ConcurrentTask`, mimalloc,
  `aphrody-output`, `aphrody-clap`, `yolo:sqlite` / `Yolo.sql` / `Yolo.redis`, `Yolo.YAML`,
  WebCrypto. Bannis partout : tokio, reqwest, hyper, rustls, ring, wreq, tungstenite,
  tracing, clap, rusqlite, deno_core, v8, tout second SQLite ou simdutf.
- Pins, pas de copies : C/C++ par `scripts/build/deps/*.ts` ; Rust des forks par
  `[workspace.dependencies]` `git = …, rev = …` sur `aphrody-labs/{tauri,wry,tao,next.js}` ;
  wgpu depuis crates.io. Tauri, CEF, Turbopack/SWC ne sont jamais recopiés dans ce dépôt.
- Trois niveaux de code : 0 logique pure (wasm32, sans E/S), 1 capacités par traits
  (`aphrody-io`, implémentation noyau unique + Mock), 2 liaisons (JSC, N-API, Tauri,
  wasm-bindgen, pyo3, C ABI ; zéro logique métier). `just tiers` tient
  `docs/architecture/tiers.toml` ; la CI refuse les régressions de niveau.
- Le démarrage du noyau est un budget : `yolo -e 1` mesuré par `hyperfine` à chaque patch du
  noyau ; +0,5 ms ou +1 Mo = refus ou déplacement en plugin. Les plugins (obscura, crawl,
  tauri, next, cef, wgpu, ml, google, x, discord) se chargent paresseusement, signés
  Ed25519, depuis `~/.yolo/plugins`.
- Le service `yolo crawl daemon` tourne 24/7 (systemd `Type=notify`, SQLite autonome,
  Postgres ou Redis par URL) ; le même binaire passe en `yolo crawl --gui` (feature `gui`,
  wry/tao par pins, jamais CEF par défaut) ; tout site crawlé devient une app Tauri
  assemblée, jamais compilée, par `yolo crawl app`.
- Toolchain unique : nightly `2026-09-15` (épinglé par le `rust-toolchain.toml` du fork Bun), `-Zbuild-std` pour le binaire,
  lien ninja + WebKit `autobuild` (archive précompilée : défaut `webkit: "prebuilt"` du fork à `c439b6fbd`) ; `default-members` = noyau ; un seul `Cargo.lock`.
- Divergence assumée avec oven-sh/bun et h4ckf0r0day/obscura ; les forks Tauri/wry/tao/next
  restent rebasables (ce sont des pins).

### 3. Conventions pour agents

- Six recettes et rien d'autre : `just build`, `just plugin <nom>`, `just check`,
  `just smoke`, `just bench`, `just tiers`. `just bump <dep>` ouvre la PR de mise à jour.
- `CLAUDE.md` ≤ 100 lignes ; chaque crate a un `README.md` de dix lignes (rôle, niveau,
  dépendances autorisées, propriétaire, test isolé) ; décisions dans `docs/decisions/`,
  état cassé dans `BROKEN.md`, prompts de session dans `.claude/prompts/`.
- Scripts `scripts/fusion/*.ts` idempotents ; worktrees et Cargo parallèle autorisés ;
  intégration dans l'ordre B → C → A → E → D ; stubs `Err("non porté : …")` plutôt que
  dépassement, jamais `todo!()` / `unimplemented!()`.
- Chaque chantier est un one shot : J0 par scripts, chantiers parallèles, intégration,
  fumigation écrite d'avance, `BROKEN.md` exhaustif. On livre à l'heure ; la qualité vient
  du one shot suivant.

> **Écart constaté (2026-10-05)** : le `Cargo.lock` du fork Bun (`c439b6fbd`, 282 paquets) ne contient ni tokio, hyper, rustls, reqwest, tracing, rusqlite, v8 ni deno_core, mais il contient `clap` 4.6.1, tiré par `criterion` (dev), à côté de la crate interne `bun_clap` : la preuve `cargo tree` du ban de `clap` doit exclure les dev-dépendances (`--edges normal`). La crate `aphrody-io` visée pour le niveau 1 entre en collision avec `bun_io` (boucle epoll/kqueue du fork) renommé en `aphrody-io`.

## B. Amendement au `GOAL.md` d'`aphrody-labs/aphrody` (section 1, précision du 2026-10-05)

Le runtime précompilé est produit par le monorepo `aphrody-labs/yolo` (noyau Bun-Rust,
Obscura sur JSC, plugins). Aphrody ne contient plus de moteur : `crates/tauri/*`,
`crates/web/obscura-*`, `crates/engine/*`, `crates/ui/render` (gpu) et
`crates/native/gpu-backend` sont supprimés au profit de pins git sur `yolo` et sur les forks
`aphrody-labs/{tauri,wry,tao}`, du runtime installé dans `~/.yolo` et des paquets
`@aphrody/plugin-*`. La directive « V8 conservé jusqu'à la parité Obscura/JSC » est
abrogée. Les crates d'Aphrody suivent les mêmes trois niveaux (0 pure, 1 traits, 2 liaisons)
que `yolo` ; une crate de niveau 0 migre vers `yolo` dès qu'un plugin ou le noyau l'importe.
Aucune dépendance de `yolo` vers `aphrody`.

> **Écart constaté (2026-10-05)** : la directive « V8 conservé jusqu'à la parité Obscura/JSC » figure aujourd'hui dans `GOAL.md:27`, `CLAUDE.md:19` et `AGENTS.md:19` d'`aphrody`, et le `GOAL.md` a déjà une « Précision propriétaire du 2026-10-05 » en section 1 (décharger la compilation lourde vers Yolo) : l'amendement ci-dessus s'y ajoute et doit remplacer ces trois endroits. V8 est encore chargé dans les processus Bun d'`aphrody` (via `obscura-js` → `deno_core` → `v8 150.4.0`).


## Journal de vérification (2026-10-05)

Statut : V = vérifié conforme, C = corrigé ou complété, N = non vérifiable ici. Sources : fork Bun `c439b6fbd` lu par `git show` dans `vendor/bun`, dépôt `aphrody` `1c2cbf1ed`, API GitHub (GET).

| Affirmation | Valeur vérifiée | Statut | Source |
| --- | --- | --- | --- |
| Nightly `2026-09-15` « fork rust de Bun » | `channel = "nightly-2026-09-15"` dans le `rust-toolchain.toml` du fork Bun (nightly rustup, pas un fork de rustc) | C | `vendor/bun/rust-toolchain.toml` |
| `-Zbuild-std`, WebKit `autobuild` | `-Zbuild-std=core,alloc,std,proc_macro,panic_abort` ; défaut `webkit: "prebuilt"` | V | `scripts/build/rust.ts:127`, `config.ts:1295` |
| Pins C/C++ par `scripts/build/deps/*.ts` | 24 dépendances (+ `index.ts`) (boringssl, mimalloc, lolhtml, sqlite, webkit, …) | V | `git ls-tree` du fork |
| Forks `aphrody-labs/{tauri,wry,tao,next.js}` | Existent, publics, branche `yolo` : tauri `890a4e241`, wry `cab3eace9`, tao `3fcda65f3`, next.js `d2f222004` | V | API GitHub |
| Crates à supprimer d'`aphrody` (`crates/tauri/*`, `crates/web/obscura-*`, `crates/engine/*`, `crates/ui/render`, `crates/native/gpu-backend`) | Toutes présentes | V | `cargo metadata` |
| Directive V8 « conservée jusqu'à la parité » | Présente dans `GOAL.md:27`, `CLAUDE.md:19`, `AGENTS.md:19` ; `GOAL.md` a déjà une précision du 2026-10-05 | C | fichiers d'`aphrody` |
| Interdits : tokio, reqwest, hyper, rustls, tracing, rusqlite, v8, deno_core | Absents du `Cargo.lock` du fork (282 paquets) ; `ring`, `wreq`, `tungstenite` non recherchés | V | `Cargo.lock` du fork |
| Interdit : clap | `clap` 4.6.1 présent via `criterion` (dev) ; `bun_clap` interne | C | `Cargo.lock` du fork |
| Une implémentation noyau : `aphrody-http`, `aphrody-dns`, `aphrody-event-loop`, `aphrody-output`, `aphrody-clap`, BoringSSL, mimalloc, `Yolo.YAML` | Crates sources `bun_http`, `bun_dns`, `bun_event_loop`, `bun_output`, `bun_clap`, `bun_boringssl`, `bun_mimalloc_sys`, `src/parsers/yaml.rs` présentes (renommage à faire) | V | `Cargo.toml` du fork |
| Crate `aphrody-io` (niveau 1) | Nom en collision avec `bun_io` renommé | C | `src/io/lib.rs` |
| `aphrody-realm-host`, `just tiers`, `~/.yolo/plugins`, signature Ed25519, `hyperfine` < 0,5 ms | Conception, pas d'état à vérifier | N | — |
