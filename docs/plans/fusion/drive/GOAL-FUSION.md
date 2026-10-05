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
- Toolchain unique : nightly `2026-09-15` (fork rust de Bun), `-Zbuild-std` pour le binaire,
  lien ninja + WebKit `autobuild` ; `default-members` = noyau ; un seul `Cargo.lock`.
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
