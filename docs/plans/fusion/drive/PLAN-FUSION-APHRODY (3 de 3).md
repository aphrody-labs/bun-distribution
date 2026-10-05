# Plan de fusion Obscura × Bun — partie 3 de 3

> Suite de la partie 2. Rappel : la section « Décision finale » (partie 1) prime : cible `aphrody-labs/yolo`, binaire `yolo` (alias `bun`).

> **Mise à jour du 5 octobre (soir)** : la partie 4 (« audits et contexte vérifiés ») corrige les états et chiffres de cette partie (branche `main` unique du fork Bun à `c439b6fbd`, nom `aphrody-labs/yolo` déjà pris, fork Obscura à 107 commits de l’amont avec une branche `yolo` propre, V8 déjà présent dans `aphrody`, base glibc) et liste les décisions ouvertes. Elle ne change pas la Décision finale.

Workflows retenus et ce qu'ils gardent :

| Workflow | Hérité de | Déclencheur | Contenu |
| --- | --- | --- | --- |
| `ci.yml` | Obscura `ci.yml` | PR, push `main` | Policy → Core (`just check`, `cargo test` sur `default-members`, `bun test` scoped) → Performance (démarrage, taille, `fetch`, obstacles) avec commentaire de PR |
| `rust-lints.yml`, `source-lints.yml`, `format.yml` | Bun | PR (`source-lints` aussi push `main`) | clippy strict sur `crates/core/*`, lints de source, formatage |
| `release.yml` | Obscura + Bun | tag `v*` | Matrice 5 cibles × (noyau, plugins), signature, checksums, GitHub Release, npm `@aphrody/*` |
| `docker.yml` | Obscura + Bun `dockerhub` | tag `v*` | buildx multi-arch, images `aphrody/yolo` et `aphrody/crawl` en 4 variantes |
| `packages-ci.yml` | Bun | PR touchant `packages/` | Tests des paquets TS et des façades de plugins |
| `update-vendor.yml` | Bun `update-*.yml` | cron hebdomadaire | Bump des pins `deps/*.ts` et des pins git, PR automatique |
| `freebsd-smoke.yml` | Bun | nightly | Fumée du noyau sur FreeBSD (`-Zbuild-std`) |

> **Écart constaté (2026-10-05)** : dans le fork Bun (`c439b6fbd`), `release.yml` se déclenche sur `release: published`, un cron quotidien et `workflow_dispatch`, et ses jobs sont `sign`, `npm`, `npm-types`, `definitelytyped`, `docker`, `homebrew`, `notify-sentry` : il ne construit pas de matrice de cibles (les builds viennent de Buildkite). `update-vendor.yml` ne bumpe que `test/vendor.json` (paquet `elysia`) ; les pins `scripts/build/deps/*.ts` sont bumpés par les neuf `update-<dep>.yml` (cron hebdomadaire, gardés par `github.repository == 'oven-sh/bun'`, donc inertes sur un fork). `freebsd-smoke.yml` est un `workflow_dispatch` manuel qui prend l'URL d'un artefact Buildkite (pas un nightly, pas de `-Zbuild-std` dans le workflow). Côté Obscura (`1fccab2c1`), `ci.yml` (jobs `policy`, `core`, `performance`, sur PR et push `main`), `docker.yml` et `release.yml` (tag `v*`, matrice de cibles dont deux macOS natifs à cause du snapshot V8) existent : le déclencheur `v*` et la matrice viennent d'Obscura, pas de Bun. `rust-lints.yml` (PR + `merge_group`), `source-lints.yml`, `format.yml` (`autofix.ci`) et `packages-ci.yml` (push `main` + PR sur `packages/**`) existent bien.

Ordre de mise en place : le squelette (arborescence, `xtask`, `ci.yml` à trois étages, `docker/`, `docs/`) se fait pendant le J0 du one shot 1 par script ; `release.yml`, `docker.yml` et covector arrivent avec le one shot 2 (première release du binaire + plugin crawl) ; `packages-ci.yml` et `update-vendor.yml` avec les premiers plugins publiés. Règle de dedupe appliquée aux scripts comme au code : un seul script par fonction, celui de Bun pour construire, celui d'Obscura pour mesurer, `xtask` pour vérifier.

## Convergence de toute la logique pure d'Aphrody

Inventaire au 5 octobre (recompté le soir : `cargo metadata --no-deps --offline` sur `aphrody` `1c2cbf1ed`, lignes de `*.rs` par répertoire de crate, tests et fixtures compris) : 235 crates membres du workspace (`crates/` et `apps/`) et 950 969 lignes de Rust. 74 crates sont de la logique pure (ni tokio, ni reqwest, ni rusqlite, ni tauri, ni wasm-bindgen, ni pyo3, toutes dépendances confondues ; 80 si l'on ignore les `dev-dependencies`) ; 114 dépendent de tokio (104 hors `dev-dependencies`), 55 de reqwest, 76 de tracing, 48 d'async-trait, 13 de rusqlite, 41 de `aphrody-tauri` (le crate `tauri` renommé ; 51 avec le reste de la famille runtime/plugins/wry/tao), 4 de wasm-bindgen, 2 de pyo3.

> **Écart constaté (2026-10-05)** : le plan annonçait 237 crates, ~929 000 lignes, 82 pures, 115 tokio, 77 tracing, 44 tauri ; ces valeurs ne se reproduisent pas (méthode de comptage d'origine inconnue). Les 235 membres excluent `crates/os/drive` (workspace Spacedrive, 25 paquets `sd-*`), `aphrody-tauri-plugin-sql` et les fixtures de `aphrody-tauri-cli`, exclus du workspace racine. La convergence consiste à classer chaque crate dans un des trois niveaux ci-dessous et à n'autoriser qu'une implémentation par capacité d'E/S : celle du noyau `yolo`. Les mêmes règles s'appliquent dans les deux dépôts ; une crate de niveau 0 migre vers `yolo` quand un plugin ou le noyau l'importe.

| Niveau | Définition | Règle | Exemples déjà conformes |
| --- | --- | --- | --- |
| 0 · Logique pure | Aucune E/S, aucun runtime async, compile en `wasm32` ; types, parseurs, algorithmes, protocoles | Pas de tokio, reqwest, rusqlite ni tracing ; testable par `cargo test` seul ; c'est le code partagé entre plugin, app Tauri, WASM et Python | `aphrody-rag-core`, `aphrody-web-index`, `aphrody-a2a`, `aphrody-app-protocol`, `aphrody-m3-tokens`, `aphrody-re`, `aphrody-shell-vfs`, `aphrody-terminal-core` (`aphrody-search` retiré : il dépend de tokio et tracing, c'est un niveau 1) |
| 1 · Capacités par traits | E/S exprimées par des traits (`Transport`, `Store`, `Clock`, `Fs`, `Process`, `Log`) définis dans `aphrody-io` ; une seule implémentation « noyau » sur `aphrody-http`, `yolo:sqlite`/`Yolo.sql`/`Yolo.redis`, `aphrody-sys`, `aphrody-spawn`, `aphrody-output` ; une implémentation `Mock` pour les tests | Aucune crate de niveau 1 n'ouvre une socket ou un fichier elle-même ; tokio disparaît (fonctions synchrones sur un thread Worker, réponses par `ConcurrentTask`) | à migrer : `aphrody-web-crawl`, `aphrody-memory`, `aphrody-rag`, `aphrody-jobs`, `aphrody-fsindex`, `aphrody-model-client`, `aphrody-gateway`, `aphrody-messaging`, `aphrody-git`, `aphrody-ssh` |
| 2 · Liaisons | Expose les niveaux 0 et 1 à un hôte : fonctions hôtes JSC (`*_jsc`), plugins N-API (`crates/plugins/*`), commandes Tauri (`*-tauri`), `wasm-bindgen`, `pyo3`, C ABI (`aphrody-ffi`, `aphrody-plugin-abi`) | Zéro logique métier : conversion de types et erreurs seulement ; une liaison par hôte, pas de duplication entre `aphrody-ffi`, `aphrody-command` et `aphrody-mcp` | `aphrody-shell-tauri`, `aphrody-n2b-native`, `yolo-pyo3`, `aphrody-shell-web` |

> **Écart constaté (2026-10-05)** : `aphrody-io`, `aphrody-http`, `aphrody-sys`, `aphrody-spawn`, `aphrody-output` n'existent pas dans `aphrody` ; ce sont les noms après renommage de crates du fork Bun (`bun_io`, `bun_http`, `bun_sys`, `bun_spawn`, `bun_output`, présentes dans `src/` à `c439b6fbd`). `bun_io` est déjà la boucle epoll/kqueue de `Bun.write`/`Bun.file` (`src/io/lib.rs`) : le renommage `bun_io` → `aphrody-io` entre en collision avec la crate de traits `aphrody-io` (`Transport`, `Store`, `Clock`, `Fs`, `Process`, `Log`) prévue pour le niveau 1 ; l'une des deux doit changer de nom avant J0.

Carte par domaine et cible de convergence (crates et lignes recomptées le 5 octobre au soir) :

| Domaine | Crates | Lignes | Ce qu'il contient | Cible |
| --- | --- | --- | --- | --- |
| `tauri` | 55 | 218 000 | Tauri 3 alpha complet, wry, tao, CEF, 30 plugins, CLI, bundler, specta | Supprimé d'`aphrody` → pins git sur les forks `aphrody-labs/{tauri,wry,tao}` ; CLI, bundler, CEF dans `@aphrody/plugin-tauri` et `plugin-cef` ; runtime wry = feature `gui` de `yolo` |
| `web` | 19 | 197 000 | Obscura (copie : 9 crates dont `obscura-ssrf`), crawl, extract, index, detect, frames, X, engine, bridge, chromium, service | `@aphrody/plugin-obscura` + `plugin-crawl` dans `yolo` ; `web-index` et `web-extract` niveau 0 ; `web-engine` et `web-bridge` supprimés |
| `ai` | 54 | 156 400 | MCP unifié (13 800), clients de modèles, mémoire, RAG, embeddings, gateway OpenAI, skills, sessions, messagerie, inférence mistral.rs | `rag-core` et protocoles niveau 0 ; clients et stores niveau 1 sur `aphrody-io` ; MCP = fonctions hôtes du noyau (`yolo mcp`) ; inférence dans `@aphrody/plugin-ml` |
| `ml` | 9 | 86 200 | Liaisons dynamiques LibTorch (70 000), llama.cpp, stable-diffusion.cpp, runtime de paquets | Intégralement `@aphrody/plugin-ml` (chargement dynamique déjà prévu) |
| `os` | 33 | 79 400 | WinClean (18 300), reverse engineering, control plane, A2A serveur/client/gRPC/coord, jobs SQLite, fsindex, recherche, DAG runner, systemd en Rust, capture écran | Niveau 0 : `re`, `search`, `a2a-pb` ; niveau 1 : `jobs`, `fsindex`, `task-runner`, `kernel` ; A2A serveur sur `Yolo.serve` ; `aphrody-systemd` fusionne avec le service `yolo crawl` |
| `compat` | 9 | 61 300 | serde-saphyr (36 700, YAML), n2b (Node vers Bun), oxc-bridge, toolchains | serde-saphyr dédoublonné avec `Yolo.YAML` ; n2b niveau 0/1 ; oxc-bridge vers le transpileur du noyau (migre vers `yolo`) |
| `ui` | 15 | 51 000 | Tokens M3, renderer unifié (wgpu), plugin Bun existant, app desktop, identité, drive, SVG, tauri-wrap, gui-core, softraster | `m3-tokens`, `svg`, `softraster`, `identity` niveau 0 ; `render` + `gpu-backend` dans `@aphrody/plugin-wgpu` ; `aphrody-bun` absorbé par les plugins N-API ; `tauri-wrap` = base de `yolo crawl app` |
| `infra` | 8 | 52 300 | `aphrody-command` (25 400, dispatch CLI/FFI), infra, git, ssh, yolo, sql, ovh, vpn | `command` = la seule table de commandes (CLI, MCP, FFI) ; `sql` retiré au profit de `Yolo.sql` et `yolo:sqlite` ; git, ssh, ovh, vpn niveau 1 |
| `google` | 8 | 16 900 | Antigravity, Gemini (CLI, web, NotebookLM), GCS, MCP Gemini | Niveau 1 sur `aphrody-http` ; connecteurs dans `@aphrody/plugin-google` |
| `shell` | 13 | 9 600 | Terminal natif, TUI, shell WASM, Nushell, VFS, sandbox E2B | VFS et terminal-core niveau 0 ; PTY et WebSocket sur `aphrody-spawn` et `Yolo.serve` ; `shell-tauri` niveau 2 |
| `engine` | 3 | 6 400 | `yolo-runtime` (C ABI du runtime précompilé), `yolo-core`, `yolo-pyo3` (`yolo-desktop` est déjà absorbé par `aphrody-app`) | `yolo-runtime` devient `aphrody-plugin-abi` (ABI `v1`) dans `yolo` |
| `contracts` | 3 | 6 500 | A2A, app-protocol, agent-proto | Niveau 0, inchangés, modèle de référence |
| `interop` | 1 | 5 200 | `aphrody-ffi` (C ABI du CLI complet pour Bun) | Remplacé par les plugins N-API côté runtime ; conservé pour Python et .NET |
| `native` | 3 | 3 300 | simdutf, topologie matérielle, gpu-backend | simdutf dédoublonné avec `aphrody-simdutf-sys` du noyau ; gpu-backend vers le plugin wgpu |
| `discord`, `apps` | 2 | 1 600 | Compilateur de bots Discord, CLI `aphrody` | CLI `aphrody` = `yolo` avec les plugins Aphrody préchargés ; Discord en plugin |

Mécanique de convergence, exécutable par agent et mesurable :

1. `just tiers` (`xtask tiers`) lit chaque `Cargo.toml`, classe la crate (0, 1 ou 2) d'après ses dépendances et écrit `docs/architecture/tiers.toml` ; la CI refuse une crate de niveau 0 qui gagne tokio, reqwest ou rusqlite, et une crate de niveau 2 qui dépasse 500 lignes hors tests. Tourne dans `yolo` et dans `aphrody`.
2. Doublons fonctionnels à éliminer, dans l'ordre : trois piles HTTP (reqwest 0.13, `obscura-net`, `aphrody-http`) ; deux SQLite (rusqlite 0.40 bundled d'`aphrody`, `bun:sqlite` du fork ; la copie d'Obscura n'embarque aucun SQLite, vérifié dans ses `Cargo.toml`) ; deux YAML (serde-saphyr, `Yolo.YAML`) ; deux simdutf ; deux journaux (tracing, `aphrody-output`) ; deux tables de commandes (`aphrody-command`, `aphrody-mcp`) ; deux systemd (`aphrody-systemd`, unités de `config/host/systemd`).
3. tokio sort par vagues de domaine (`web`, puis `infra`, `ai`, `os`, `google`), chaque vague fermée par un `cargo tree -i tokio` qui ne liste plus le domaine ; `async-trait` et `futures` tombent avec lui.
4. Les 74 crates déjà pures (80 hors `dev-dependencies`) reçoivent `[lints] workspace = true` et la cible `wasm32-unknown-unknown` dans la CI dès le one shot 1 : elles sont le socle que tout le reste rejoint.

## Plan définitif : la séquence des one shots

Six one shots enchaînés, chacun livrable seul, chacun au même format (J0 par scripts, chantiers parallèles en worktrees, intégration dans l'ordre fixe, fumigation, `BROKEN.md`). Le premier est le seul chiffré ferme (200 €, 2 jours) ; les suivants reprennent sa méthode et ses plafonds.

| # | One shot | Prérequis | Livrable | Fumigation | Budget indicatif |
| --- | --- | --- | --- | --- | --- |
| 1 | **Monorepo `yolo` + noyau + plugin Obscura** : création du dépôt depuis le fork Bun (branche `main`, `c439b6fbd`), renommage `aphrody-*`, import d'Obscura sous `crates/browser`, hôte de realm JSC + chargeur de plugins dans le noyau, Obscura porté sur JSC en `@aphrody/plugin-obscura`, V8 et tokio hors du chemin, `Justfile`, `CLAUDE.md`, `BROKEN.md`, `docs/decisions` | Accès push, cache WebKit, nightly installé (`nightly-2026-09-15` l'est déjà dans WSL) | Binaire `yolo` + plugin Obscura, `yolo browser fetch`, `yolo:browser`, CDP Puppeteer, tag `oneshot-1` | 5 commandes de la section Plan | 200 € · 2 jours |
| 2 | **Crawl, stores et release** : `@aphrody/plugin-crawl` (daemon 24/7, `FrontierStore` SQLite/Postgres/Redis), mécanisme de plugins complet (signature, `yolo plugin add`), unité systemd via le catalogue Infra d'`aphrody`, `release.yml`, `docker.yml`, covector, première release | 1 | Service `yolo crawl daemon` installé, images Docker, release signée | 1 h de crawl sur 50 domaines, redémarrage brutal, 0 perte, `/metrics` cohérent | 100 à 150 € |
| 2 bis | **Nettoyage d'`aphrody`** (sous les règles de son `CLAUDE.md`) : suppression de `crates/tauri/*`, `crates/web/obscura-*`, `crates/web/{crawl,extract,index,detect}`, `crates/engine/*` ; pins git sur `yolo` et les forks ; amendement `GOAL.md` ; `just tiers` activé | 2 | `aphrody` sans moteur, gates verts | `cargo check --workspace` d'`aphrody` vert et plus rapide (mesuré) | 50 à 100 € |
| 3 | **Desktop** : feature `gui` (wry/tao par pins), `yolo crawl --gui`, `@aphrody/plugin-tauri` (CLI, bundler, create-tauri-app par pins), `yolo crawl app <domaine>` sur `aphrody-tauri-wrap`, IPC `Yolo.tauri` | 1, 2 | Fenêtre de pilotage du crawl, app Tauri générée depuis un site | GUI 4 Workers en direct ; app `.deb`/AppImage d'un site de test qui s'ouvre hors ligne | 150 à 250 € |
| 4 | **GPU** : `@aphrody/plugin-wgpu` (API WebGPU sur wgpu 30, surfaces fenêtre/hors écran/webview), `aphrody-gpu-backend` et `aphrody-render --features gpu` migrés dans `yolo` | 2 | `scene.ts` identique en fenêtre, PNG hors écran et navigateur | Triangle + calcul GPU sur les trois cibles | 100 à 150 € |
| 5 | **Convergence de la logique pure** : `aphrody-io`, `just tiers` dans les deux dépôts, sortie de tokio par domaine (`web`, `infra`, `ai`, `os`, `google`), dédoublonnage HTTP/SQLite/YAML/simdutf/journaux/commandes/systemd, `aphrody-command` table unique | 2, 2 bis | `tiers.toml` complet, `cargo tree -i tokio` vide hors plugins qui l'assument | Gates verts, mesures avant/après (taille, démarrage) | 3 à 5 sessions de 150 € |
| 6 | **Plugins de chaînes lourdes** : `plugin-next` (Turbopack + SWC du fork next.js, pins), `plugin-ml`, `plugin-cef`, `plugin-google`, `plugin-x`, `plugin-discord` | 2, 5 | Un paquet `@aphrody/plugin-*` signé par chaîne | `yolo next build` d'une app Next 16 de test ; inférence locale d'un modèle de test | 100 à 200 € par plugin |

> **Écart constaté (2026-10-05)** : « cache WebKit » (prérequis du one shot 1). Au pin `c439b6fbd`, `scripts/build/config.ts:1295` garde `webkit: partial.webkit ?? "prebuilt"` (archive `oven-sh/WebKit` `autobuild-5718a6ec…`) ; la PR amont #41330 (JSC/ICU compilés depuis les sources, fusionnée le 2026-09-06, `ae7b8f4ab`) n'est **pas** un ancêtre de ce commit, et `config.ts` de `oven-sh/bun:main` a encore le défaut `"prebuilt"`. L'affirmation de la partie 4 (§10.3) « JSC/ICU compilés depuis les sources par défaut » est donc à confirmer avant de retirer le préchauffage.

Invariants valables du début à la fin : un seul binaire `yolo` (alias `bun`) ; un seul moteur JS (JSC) ; une seule pile par capacité (HTTP, TLS, DNS, compression, SQLite, YAML, journal, commandes) ; démarrage du noyau mesuré et inchangé ; tout ce qui est une chaîne de build vit en plugin ; pins, pas de copies ; `yolo` ne dépend jamais d'`aphrody` ; `BROKEN.md` tenu à jour ; commits `aphrody-dev <contact@aphrody.com>` ; aucune publication publique sans autorité du propriétaire.

## Prompts prêts à l'emploi

Deux textes à copier tels quels, réécrits pour la cible `yolo` : `GOAL-FUSION.md` (A. le `GOAL.md` du nouveau monorepo ; B. l'amendement au `GOAL.md` d'`aphrody`) et `PROMPT-ONESHOT-1.md` (le prompt de la session d'exécution du one shot 1, à donner à l'orchestrateur Opus 5.5). Ils accompagnent ce plan dans le même dossier.

## Points techniques délicats

Douze sujets concentrent le risque d'échec du one shot ; chacun a une décision prise d'avance pour que les agents ne la redécouvrent pas.

| Sujet | Le problème | Décision pour le one shot | Chantier |
| --- | --- | --- | --- |
| Realm de page sur JSC | Obscura crée un `v8::Context` par frame à partir d'un snapshot ; JSC n'a pas de snapshot de tas | Un global object JSC par page, `bootstrap.js` évalué à la création (coût accepté) ; cache de bytecode (`CachedBytecode.rs` existe dans le noyau) seulement si B a du budget restant | B |
| `Deno.core.ops` | 74 ops distincts appelés par `bootstrap.js`, 76 `#[op2]` dans `ops.rs` (copie `d21e0f54a`, amont v0.2.4 : 73 selon la partie 4 ; l'ancien « 70 » est périmé), typés par deno_core (`JsBuffer`, `OpState`, `#[string]`, `#[serde]`) | Objet `Deno.core` installé sur le global avant `bootstrap.js` ; chaque op devient une fonction hôte servie par `aphrody-realm-host` qui décode ses arguments à la main comme `html_rewriter.rs` ; `OpState` → `Rc<RefCell<PageState>>` capturé par la fonction | B |
| Appels `v8::` directs | 183 occurrences dans les crates Obscura de la copie locale (164 sur la base antérieure ; surtout `obscura-js` : `runtime.rs` 105, `ops.rs` 42) : `Global`, `TryCatch`, `script_compiler`, `Context::from_snapshot`, `IsolateHandle::terminate_execution`, `HeapStatistics` | `Global` → `JsRef`/`GlobalRef` ; `TryCatch` → `JsResult` ; compilation → `execute_script` d'`aphrody-jsc` ; snapshot supprimé ; watchdog → interruption JSC depuis le thread de garde ; statistiques de tas → stub | B |
| `panic = "abort"` | Le protocole `catch_unwind` d'Obscura ne fonctionne plus : toute panique dans un op tue le processus | Passage par script des `unwrap()`/`expect()` des ops en `?` ou en `return null` quand l'op le permet ; le reste est accepté (le `crash_handler` de Bun donne la trace) | B, J2 |
| Retrait de tokio | `async fn` partout dans browser, cdp, mcp, net ; `tokio::sync::Mutex`, `mpsc`, `time::timeout`, `LocalSet` | Le moteur d'une page vit sur un thread Worker : les `async fn` deviennent synchrones, `mpsc` → canaux d'`aphrody-threading`, `timeout` → délais du transport ; le thread JS principal ne bloque jamais, il attend un `ConcurrentTask` | C, A, D |
| Transport HTTP | `obscura-net` est écrit contre reqwest (`Client`, `Response`, flux) et wreq ; `aphrody-http` a sa propre API orientée `AsyncHTTP` + thread HTTP | Trait `Transport` minimal défini en J0 (`send(Request) -> Result<Response>` bloquant, `stream_body`) ; une impl sur `aphrody-http`, une impl `MockTransport` pour les tests ; SOCKS5 stub | A |
| Empreinte TLS stealth | wreq configure BoringSSL (suites, extensions permutées, GREASE, ALPS, compression de certificats) ; Bun expose BoringSSL par `aphrody-boringssl` mais sans ces réglages | J1 : suites + ALPN + GREASE sur le `SSL_CTX` du client ; permutation d'extensions, ALPS et compression de certificats dans `BROKEN.md` si non faits ; la mesure ja4 vient après le one shot | A |
| Empreinte moteur JS | Les détecteurs distinguent V8 de JSC (messages d'erreur, format des piles, précision de `Math`, `Function.prototype.toString`) ; Obscura promet une empreinte Chrome | Hors périmètre du one shot ; noté comme régression connue ; Bun formate déjà les piles à la V8 (`Error.captureStackTrace`, `prepareStackTrace`) ce qui couvre une partie | — |
| Lints et conventions de Bun | `warnings = deny`, `unreachable_pub`, `dead_code`, `clippy.toml` interdisant `std::fs`, `HashMap`, `println!`, `str::find` | Crates importées : `[lints] workspace = false`, `#![allow(clippy::all)]`, `#![allow(dead_code, unreachable_pub)]` en tête de `lib.rs` ; `cargo clippy` de la CI exclut ces crates par `--exclude` jusqu'à adoption | J0 |
| Nightly, edition, build-std | Obscura cible stable 1.75 (non vérifiable ici : aucune `rust-version` dans la copie, edition 2021 confirmée) ; Bun compile `std` lui-même avec `-Zbuild-std=core,alloc,std,proc_macro,panic_abort` (`scripts/build/rust.ts:127`) ; `-Clinker-plugin-lto` sur toutes les crates | Les crates Obscura restent en edition 2021 (mélange autorisé par crate) ; aucune `build.rs` exécutant un moteur ; `taffy` et `cosmic-text` vendorisés copiés dans `vendor/` et exclus des `members` comme `lolhtml` | J0, E |
| Renommage de masse | 99 crates `bun_*` (et non ~105) → `aphrody-*` touche chaque `Cargo.toml`, chaque `use`, les scripts de build (`rust.ts` planifie `-p bun_runtime`), le codegen et les lints de source | Script unique `scripts/fusion/rename.ts` en J0 qui réécrit `Cargo.toml`, `*.rs`, `scripts/build/*.ts`, `src/codegen/*.ts`, `test/internal/source-lints` ; un seul commit ; `cargo metadata` comme preuve ; les chaînes utilisateur (`bun`, messages, `BUN_*`) ne changent pas | J0 |
| Cibles et binaire | `obscura-render` embarque des polices et `tiny-skia` ; `bootstrap.js` passé en clair | Linux x86_64 seul pour le one shot ; taille et RSS mesurés en J2 sans objectif | J2 |

Licences : Obscura est Apache-2.0, Bun MIT, WebKit LGPL/BSD. Apache-2.0 dans un binaire MIT impose de conserver les mentions de licence et le `NOTICE` ; un fichier `LICENSES/obscura-APACHE-2.0` et une ligne dans `LICENSE.md` suffisent, à faire en J0 par l'orchestrateur.

## WebView et application desktop native Bun

Le fork a déjà un `Bun.WebView` (9 495 lignes dans `src/runtime/webview/`, 17 fichiers Rust/C++/en-têtes ; `test/js/bun/webview/` : 5 fichiers `*.test.ts` et 1 fixture, 3 572 lignes, ~130 `test(` par décompte textuel, non exécutés ici) : c'est une vue de navigateur **headless** pour l'automatisation, pas une fenêtre d'application. Sur macOS elle pilote une `WKWebView` dans un process hôte (le binaire réexécuté avec `BUN_INTERNAL_WEBVIEW_HOST=3`, `socketpair` `SOCK_STREAM` avec trames préfixées par leur longueur, protocole binaire `ipc_protocol.h`) ; sur Linux et Windows elle pilote un Chrome, Chromium, Edge ou Brave **installé sur la machine** par CDP (`--remote-debugging-pipe` ou WebSocket). Le fichier `packages/bun-types/tauri.d.ts` (`Bun.tauri`, `IpcMessage { cmd, callback, error, payload }`, `getDisplayConfig`) n'a aucune implémentation Rust ou C++ derrière lui : c'est un stub de types.

Comparaison avec Tauri 3 (guide de migration depuis Tauri 2) et avec Obscura :

| Critère | `Bun.WebView` (fork) | Tauri 3 alpha | Obscura |
| --- | --- | --- | --- |
| Moteur | WKWebView (macOS) ; Blink d'un Chrome installé ailleurs | Au choix par crate de runtime : `tauri-runtime-wry` (webkit2gtk / WebView2 / WKWebView) ou `tauri-runtime-cef` (Chromium embarqué) | Moteur propre dans le binaire : V8 aujourd'hui, JSC après fusion, rendu CPU `tiny-skia` |
| Dépendance externe à l'exécution | Aucune sur macOS ; Chrome requis sur Linux et Windows | Webview système (webkit2gtk à installer sur Linux, WebView2 présent sur Windows) ou CEF embarqué (« +100 Mo » non vérifié ; la seule mesure publiée est ~1 Go de SDK par plateforme) | Aucune, partout |
| Fenêtre visible | Non (headless seulement) | Oui : `Window`, `Webview`, multi-fenêtres, menus, tray (ksni sur Linux) | Non |
| Sélection du runtime | Option `backend: "webkit" \| "chrome"` par vue | `tauri::Builder::runtime(…)` obligatoire, `DynRuntime` par défaut, traits d'extension `AppHandleWryExt` | — |
| IPC application ↔ page | Aucun canal applicatif (`evaluate`, `navigate`, entrées natives, `screenshot` ; CDP brut en backend Chrome) | `invoke(cmd, payload)` avec `callback`/`error`, permissions `allow-*`/`deny-*` résolues à la demande depuis la liste `commands` du manifeste | Interception réseau, `evaluate`, `add_preload_script` |
| Schéma d'actifs | `http(s)`, `data:` et `file://` (exemples de `docs/runtime/webview.mdx`) ; aucun schéma d'application | `tauri://localhost` (wry sauf Windows/Android : `http://tauri.localhost`), défini par le runtime | `http(s)`, `data:` |
| Isolation | Un process hôte ou un Chrome par process Bun, une cible par vue | Un process par app, webviews en process du runtime | Un process, un isolate partagé (un realm par Worker après fusion) |
| Entrées `isTrusted` | Oui (événements natifs) | Oui | Oui, émulé (`event.isTrusted = true` en stealth) |
| Empaquetage | `bun build --compile` | `tauri-build` + CLI, bundles natifs | Binaire unique |

Ce que la comparaison impose au plan :

1. **Le backend Chrome de `Bun.WebView` est le point d'entrée gratuit d'Obscura.** `ChromeBackend.cpp` parle CDP sur un pipe ou un WebSocket ; `aphrody-cdp` est un serveur CDP. Un troisième backend `"obscura"` connecte `ChromeBackend` à `aphrody-cdp` dans le même process (socketpair ou boucle en mémoire) : `new Bun.WebView()` fonctionne alors sur Linux et Windows **sans Chrome installé**, et devient le défaut là où il n'y a pas de WKWebView. C'est l'équivalent du choix de runtime de Tauri 3, mais dans le binaire. Ajouté au chantier D du one shot comme objectif prioritaire après `bun browser fetch` (coût estimé : 5 € de la réserve ; sinon premier item d'après one shot).
2. **Deux API, un moteur, une convergence.** `Bun.WebView` (vue, entrées natives, captures) et `bun:browser` (pages, interception, CDP, MCP) partagent le même moteur après fusion ; `bun:browser` reste l'API riche, `Bun.WebView` l'API courte. Pas de troisième API.
3. **Le modèle de runtime de Tauri 3 est repris pour le desktop.** Les traits de `tauri-runtime` (pin) avec trois implémentations : `wry` (fenêtres natives), `obscura` (repli sans dépendance qui peint les pixmaps `tiny-skia` dans une fenêtre via `softbuffer`), `cdp` (Chrome installé, compatibilité). Sélection par option, pas par feature Cargo, comme `Builder::runtime()`.
4. **IPC et permissions à la Tauri 3, implémentés derrière `Bun.tauri` déjà typé.** `Bun.Window` expose `commands({ name: handler })` ; la page appelle `window.__BUN__.invoke(cmd, payload)` ; le message garde la forme `IpcMessage` du `tauri.d.ts` pour réutiliser les clients Tauri existants (`@tauri-apps/api` pointable sur le pont). Permissions : liste `commands` dans `bunfig.toml` (`[desktop] commands = [...]`) avec `allow-*`/`deny-*` implicites résolues à la demande, comme le manifeste d'app de Tauri 3, pas de fichiers générés.
5. **Schéma et empaquetage.** Actifs servis sous `bun://localhost` par le bundler (équivalent de `tauri://localhost`), ressources résolues depuis les sources en dev (comme Tauri 3) et embarquées par `bun build --compile` en release ; une app desktop = un binaire compilé avec ses actifs, zéro installation, ce que Tauri n'offre qu'avec CEF.

Précision après lecture du dépôt Tauri (la cible est la branche `v3` : crates en `3.0.0-alpha.3` à `alpha.5`, MSRV 1.95, edition 2024, vérifié dans `crates/tauri/*` ; la branche `dev` est la ligne 2.12.1, et le « Rust 1.90 » d'origine n'est pas vérifiable) : on ne réinvente pas l'abstraction de runtime, on reprend celle de Tauri, par pin git sur le fork `aphrody-labs/tauri`.

| Crate Tauri | Taille et dépendances | Usage dans `yolo` |
| --- | --- | --- |
| `tauri-runtime` (3.0.0-alpha.3) | 6 156 lignes de `src/` (6 164 d'après le rapport v3 ; l'ancien « 2 874 » est faux), dont `dynamic.rs` 2 954 : traits `Runtime`, `RuntimeHandle`, `WebviewDispatch` (navigate, eval_script, cookies, bounds, devtools), `WindowDispatch`, `WindowBuilder`, `PendingWebview`/`PendingWindow`, `RunEvent`, DPI, moniteurs, permissions webview. Dépendances : serde, serde_json, thiserror 2, `tauri-utils`, http 1, raw-window-handle 0.6, url 2, dpi 0.1, cookie (workspace `=0.18.2`) ; plateformes : windows 0.62, jni, objc2 (plus de gtk, webkit2gtk ni webview2-com : ils sont passés dans `tauri-runtime-wry`) | Pin git (licence Apache-2.0 OR MIT) ; `tauri-utils` réduit aux types de config et de fenêtre dont les traits ont besoin |
| `tauri-runtime-wry` (3.0.0-alpha.4) | wry 0.57.0 + tao 0.37.1 + **`tauri` (feature `gtk3`)** ; macOS objc2-app-kit, Windows windows 0.62 + softbuffer 0.4, Linux gtk + webkit2gtk ; features `devtools`, `x11`, `dbus` (webview2-com 0.39 sous Windows ; 7 491 lignes) | Pin git : la seule implémentation « fenêtre visible », dans le process hôte (voir ci-dessous), feature `gui` |
| `tauri` (cœur, 3.0.0-alpha.4, 37 085 lignes) | IPC `invoke`, ACL, plugins, bundler ; dépend de tokio et reqwest 0.13 (non optionnels) ; tray-icon avec `ksni` sous Linux | **Non repris** : tokio et reqwest sont exclus du binaire ; l'IPC est réécrit sur `Bun.tauri` (forme `IpcMessage`) et les permissions sur `bunfig.toml` |
| `tauri-runtime-cef` (3.0.0-alpha.5, 20 445 lignes) | Chromium embarqué | `plugin-cef` seulement : le rôle « moteur embarqué sans dépendance » est tenu par le moteur Obscura |

> **Écart constaté (2026-10-05)** : la décision « `tauri` (cœur) non repris, `tauri-runtime-wry` en pin, tokio et reqwest exclus du binaire » ne tient pas en l'état : `crates/tauri/aphrody-tauri-runtime-wry/Cargo.toml` dépend de `tauri` (`aphrody-tauri`, feature `gtk3`), qui tire `tokio` et `reqwest 0.13` non optionnels (`aphrody-tauri/Cargo.toml:51,91`). Le pin de `tauri-runtime-wry` fait donc entrer tokio, sauf correctif de dépendance optionnelle dans le fork `aphrody-labs/tauri` (voir partie 4, §10.2).

Trois implémentations des traits `tauri-runtime`, choisies par option à l'exécution comme `Builder::runtime()` en Tauri 3 :

- `aphrody-runtime-obscura` : headless, dans le process, moteur fusionné ; c'est aussi ce que `Bun.WebView({ backend: "obscura" })` et `bun:browser` utilisent. Fenêtre visible possible par peinture des pixmaps `tiny-skia` dans une fenêtre tao via `softbuffer` (déjà dépendance de `tauri-runtime-wry` sur Windows), lent mais sans aucune bibliothèque système.
- `tauri-runtime-wry` (pin) : fenêtres natives (WKWebView, WebView2, webkit2gtk) ; webkit2gtk et gtk sont des bibliothèques système sur Linux, à charger dynamiquement pour que le binaire démarre sans elles et tombe sur `obscura`.
- `aphrody-runtime-cdp` : l'actuel `ChromeBackend` (Chrome installé), conservé pour la compatibilité de `Bun.WebView`, plus jamais par défaut.

Décision d'architecture qui conditionne tout le desktop : **le process hôte existant reste le modèle.** tao exige de posséder le thread principal (surtout sur macOS) et le thread principal de Bun est celui de la VM JS. Plutôt que de déplacer la VM, on étend le hôte `BUN_INTERNAL_WEBVIEW_HOST` (`host_main.cpp`, aujourd'hui macOS seulement) pour qu'il exécute la boucle tao + wry sur toutes les plateformes ; le process principal implémente `RuntimeHandle`/`WebviewDispatch`/`WindowDispatch` comme des proxys sur le protocole `ipc_protocol.h` existant, étendu aux fenêtres (création, événements `RunEvent`, `invoke`). Coût : une latence IPC par `invoke` ; gain : aucun changement du modèle de threads de Bun, et un crash de la webview ne tue pas le script.

Points de friction connus : `cookie 0.18` (réexporté par `tauri-runtime`, épinglé `=0.18.2` dans le workspace d'`aphrody`) : l'affirmation « Obscura a dû s'en passer (issue #295) » est contredite par `obscura-net/Cargo.toml`, qui hérite du workspace `cookie =0.18.2` (l'issue #295 d'`h4ckf0r0day/obscura` est un échec de build Windows `--features stealth` avec V8 137, fermée le 2026-06-13, sans lien établi avec `cookie`) ; à vérifier sur le nightly de Bun ; `http 1` et `url 2` entrent dans le workspace (déjà nécessaires à Obscura) ; `tracing` est une feature optionnelle de wry, laissée éteinte.

Surface proposée :

```ts
import { Window } from "bun:desktop"; // ou Bun.Window

const win = new Window({
  title: "Aphrody",
  width: 1200, height: 800,
  runtime: "auto",            // wkwebview | webview2 | webkitgtk | obscura
  url: "bun://localhost/index.html",
  commands: {
    greet: ({ name }) => `Bonjour ${name}`,
    readConfig: async () => Bun.file("config.json").json(),
  },
});
win.on("close", () => process.exit(0));

// côté page : const r = await window.__BUN__.invoke("greet", { name: "Yohan" });
```

Placement dans le temps : l'item 1 entre dans le one shot (chantier D, réserve) ; les items 3 à 5 forment le one shot 3 « desktop », même format (2 jours, budget à fixer, ordre de grandeur 150 à 250 €), après stabilisation du moteur fusionné : il dépend de `aphrody-cdp` et du realm JSC, pas l'inverse. Les fenêtres visibles sur Linux sans webkit2gtk installé ne seront disponibles que par le repli `obscura`, dont la vitesse de peinture est inconnue tant que le moteur fusionné n'est pas mesuré.

## Risques et mitigations

Le risque dominant n'est pas technique mais budgétaire : le chantier B peut absorber le budget sans que la fumigation passe. Tout le reste est de la casse assumée et listée.

| Risque | Probabilité | Impact | Mitigation | État attendu à la livraison |
| --- | --- | --- | --- | --- |
| Le portage des 70 ops sur JSC dépasse 60 € / 8 h | élevée | fumigation 2 et 4 échouent | Ordre de portage imposé : `op_dom`, `op_eval`, timers, `op_fetch`, puis le reste ; ops hors budget = `throw` explicite ; réserve de 5 € affectée à B en priorité | `document.title` et `querySelector` fonctionnent ; `IndexedDB`, Workers de page, `crypto.subtle` peuvent manquer |
| Le workspace ne compile pas en entier à J2 (erreurs en cascade) | élevée | pas de binaire | J1 validé par `cargo check -p` par crate avec stubs ; J2 en lots par crate, `--keep-going` ; un stub remplace toute crate qui bloque | Binaire produit, parfois avec des stubs à la place de A ou E |
| `panic = "abort"` fait aborter le navigateur sur une page réelle | élevée | crash sur certaines pages | Script J0 qui remplace les `unwrap()`/`expect()` des ops ; pages de fumigation choisies simples | `example.com` et HN passent ; des SPA lourdes peuvent tuer le process |
| Renommage de masse casse les scripts de build (`rust.ts` plan `-p bun_runtime`, codegen, lints de source) | moyenne | J0 dépasse 2 h | Script de renommage testé sur une copie, `cargo metadata` + `just build --dry-run` comme preuve avant push | J0 à l'heure ou report de 1 h pris sur la réserve |
| Empreinte TLS stealth incomplète (permutation d'extensions, ALPS, compression de certificats) | certaine | sites protégés par anti-bot détectent | Accepté ; suites + ALPN + GREASE seulement ; mesure ja4 après one shot | `--stealth` existe mais ne vaut pas celui d'Obscura |
| Empreinte moteur JS (JSC vs V8) détectable | certaine | idem | Hors périmètre ; piles formatées à la V8 par Bun couvrent une partie | Régression connue, documentée |
| Perte des tests Obscura (~20 000 lignes de `mod tests` dans `runtime.rs`, 334 `#[test]`, soit la ligne 4 298 à 24 448 du fichier ; intégration CDP) | certaine | régressions silencieuses | Tests copiés sous feature `legacy-tests`, réactivation = premier travail post one shot | 0 test Obscura exécuté à la livraison |
| Démarrage de page lent sans snapshot (évaluation de 17 932 lignes de `bootstrap.js` par realm) | élevée | latence `fetch` > 85 ms d'Obscura | Cache de bytecode JSC si B a du budget ; sinon accepté | Probablement 20 à 100 ms de plus par page, non mesuré |
| `cookie 0.18`, `cssparser 0.36`, `selectors 0.33` cassent `aphrody-dom`/`render` | moyenne | chantier E dépasse | E garde les anciennes versions en doublon si la migration dépasse 1 h ; doublon noté | Au pire deux versions de cssparser dans le lock (la copie Obscura `d21e0f54a` est sur selectors 0.38 / cssparser 0.37, le fork Bun sur 0.33 / 0.36 : l'alignement est une **rétrogradation**) |
| Linux x86_64 seul | certaine | pas de macOS/Windows/ARM | Accepté ; aucune cible croisée dans le one shot | Build Linux x86_64 uniquement |
| Divergence définitive avec les upstreams | certaine | plus de correctifs gratuits | Choix assumé et borné (pins rebasables) ; `FUSION.md` conserve la table de correspondance crate → origine pour cherry-pick manuel | — |
| Dépassement du budget total | moyenne | livraison partielle | Plafonds par chantier, l'orchestrateur seul peut puiser dans la réserve, arrêt à 200 € quoi qu'il arrive | Livraison de l'état courant + `BROKEN.md` |

## Validation

Pendant le one shot, la seule validation est la fumigation en cinq points de la section Plan ; tout le reste vient après, dans l'ordre ci-dessous, et chaque étape produit un chiffre comparable à la base relevée en J0.

| Ordre | Validation | Outil | Référence de comparaison |
| --- | --- | --- | --- |
| 1 | Fumigation (5 commandes) | `just smoke`, `puppeteer-core` | binaire démarre, `Example Domain`, liens HN, PNG non vide |
| 2 | Réactivation des tests Obscura par crate (`legacy-tests`) | `cargo test -p aphrody-page-runtime` puis dom, browser, cdp | nombre de tests verts / total, publié dans `BROKEN.md` |
| 3 | Conformité web | suite WPT et parcours d'obstacles d'`obscura-benchmark` | score Obscura V8 au 1er octobre |
| 4 | Compatibilité clients | suites Puppeteer et Playwright de la doc Obscura contre `yolo browser serve` | 100 % sur Obscura |
| 5 | Empreinte réseau | ja4 / tls.peet.ws, comparaison avec Chrome 145 | identique avec `wreq` |
| 6 | Anti-détection | CreepJS, challenges Cloudflare/DataDome de test | score Obscura V8 |
| 7 | Performance | `just bench` ; `scripts/ci/perf_smoke.py` porté ; RSS par page ; taille du binaire ; débit `scrape --concurrency 25` sur Workers | 85 ms de chargement, 30 Mo RSS (chiffres du README Obscura, non vérifiables ici), ~70 Mo de binaire Obscura (profil `release-dist`, amont #965) ; noyau seul avant fusion |
| 8 | Tests Bun existants | `bun test` complet (2 205 fichiers `*.test.*` sous `test/`, 2 212 avec `.spec.`/`.mts`/`.cts`) | zéro régression hors `test/js/bun/webview` |

Les résultats 2 à 8 décident du contenu du second one shot (« fiabilisation ») et du one shot « desktop ».

## Checklist de démarrage

À faire avant de lancer l'orchestrateur ; tout ce qui manque ici se paie en budget d'agent.

- [x] Préfixe `aphrody-` pour toutes les crates, y compris les ~105 crates Bun (tranché dans la Décision finale)
- [ ] Créer le dépôt privé `aphrody-labs/yolo` (il existe déjà : privé, branches `main`, `dev`, `vendor`, voir partie 4 §1) ; archiver l'actuel `yolo` en `yolo-legacy` ; donner l'accès push à la session d'exécution
- [ ] Préchauffer le cache de build sur la machine d'exécution : WebKit `autobuild`, dépendances `scripts/build/deps`, un build debug vert du fork `bun` branche `main` avant toute modification
- [ ] Installer le nightly `2026-09-15` avec `rust-src`, `clippy`, `rustfmt` (`nightly-2026-09-15` figure déjà dans `rustup toolchain list` de WSL ; les composants ne sont pas vérifiés) ; vérifier que `cargo check --workspace` passe sur le fork vierge
- [ ] Cloner `aphrody-labs/obscura` à côté et relever la base de mesures (latence `fetch`, RSS, taille, score parcours d'obstacles)
- [ ] Écrire `FUSION.md` : règle de nommage, interdits, politique de stubs, format de `BROKEN.md`, ordre de fusion J2, les cinq commandes de fumigation
- [ ] Préparer les six prompts d'agents (orchestrateur, A, B, C, D, E) avec plafond en euros et en heures, périmètre de fichiers, condition d'arrêt
- [ ] Configurer les plafonds de dépense du workflow dynamique (200 € au total, alertes à 50 %, 80 %, 100 %)
- [ ] Choisir les pages de fumigation (`example.com`, `news.ycombinator.com`, une page de test locale avec `fetch()` et `setTimeout`)
- [ ] Prévoir 30 minutes humaines à la fin de J0 (revue du renommage) et à la fin de J2 (lecture de `BROKEN.md`, tag)
- [ ] Ajouter `LICENSES/obscura-APACHE-2.0` et la mention dans `LICENSE.md`

## Sources

Dépôts et fichiers lus le 5 octobre 2026.

- [h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura) (commit `1fccab2`) : `Cargo.toml`, `crates/*/Cargo.toml`, `Cargo.lock`, `docs/Architecture-overview.md`, `docs/Use-as-a-Rust-library.md`, `crates/obscura-js/src/*.rs`, `crates/obscura-js/js/bootstrap.js`, `crates/obscura-js/build.rs`, `.cargo/config.toml`
- [aphrody-labs/obscura](https://github.com/aphrody-labs/obscura) (5 octobre au soir : `main` = amont v0.2.4 `1fccab2c1`, branche `yolo` `dbea8a7c1` ; l'ancien commit `0cdd42e` est périmé) : diff complet contre l'upstream
- [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (5 octobre au soir : branche `main`, commit `c439b6fbd` ; la branche `yolo` et son ancienne tête `954db0c` n'existent plus) : `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `scripts/build/rust.ts`, `scripts/build/deps/*.ts`, `src/runtime/Cargo.toml`, `src/runtime/api/html_rewriter.rs`, `src/event_loop/*.rs`, `src/http/*`, `src/runtime/webview/*`, `docs/runtime/webview.mdx`, `packages/bun-types/bun.d.ts`, `packages/bun-types/tauri.d.ts`, `REVIEW.md`, `package.json`
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri/tree/dev/crates) (branche `dev` pour les liens ci-dessous ; les chiffres de ce plan portent sur la branche `v3`, lue dans `crates/tauri/*` et le rapport `research-tauri-v3.md`) : [`Cargo.toml`](https://github.com/tauri-apps/tauri/blob/dev/Cargo.toml), [`crates/tauri-runtime`](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-runtime) (`lib.rs`, `webview.rs`, `window.rs`, `Cargo.toml`), `crates/tauri-runtime-wry/Cargo.toml`, `crates/tauri/Cargo.toml`
- [Guide de migration Tauri 3 depuis Tauri 2](https://v3.tauri.app/fr/start/migrate/from-tauri-2/)
- [Cloudflare, « Kitesurf »](https://blog.cloudflare.com/kitesurf/) cité par le README d'Obscura pour le contexte
- [aphrody-labs/aphrody](https://github.com/aphrody-labs/aphrody) (privé, commit `32284a6` lu en début de journée ; `main` = `1c2cbf1ed` au soir) : `Cargo.toml`, `rust-toolchain.toml`, `Justfile`, `CLAUDE.md`, `GOAL.md`, `PLAN.md`, `docs/DISTRIBUTION.md`, `crates/web/*/Cargo.toml`, `crates/web/web-crawl/src/{frontier,runner}.rs`, `crates/web/web-engine/src/main.rs`, `crates/tauri/*/Cargo.toml`, `crates/infra/sql/Cargo.toml`, `config/host/systemd/`

Chiffres calculés dans cette session : lignes par crate (`wc -l`), recouvrement des `Cargo.lock` (126 paquets communs, 95 à version identique, 31 en écart : reproduit le soir entre le `Cargo.lock` du fork Bun et celui du fork Obscura), 71 `#[op2]`, 164 références `v8::`, 70 ops distincts appelés par `bootstrap.js` (valeurs recomptées sur la copie `d21e0f54a` : 76, 183, 74).

Vérifications faites le 5 octobre contre les sources primaires (GitHub et documentation à jour via Context7) : matrice de cibles précompilées de [rusty_v8 v150.4.0](https://github.com/denoland/rusty_v8/blob/v150.4.0/.github/workflows/ci.yml) et variables `RUSTY_V8_MIRROR` / `RUSTY_V8_ARCHIVE` / `V8_FROM_SOURCE` de son README ; champs `TlsOptions` de [wreq](https://github.com/0x676e67/wreq) (`cipher_list`, `alpn_protocols`, `alps_protocols`, `permute_extensions` / `extension_permutation`, `grease_enabled`, `enable_ech_grease`, `certificate_compressors` ZLIB/BROTLI/ZSTD) qui fondent le profil ClientHello à reproduire sur BoringSSL ; [Node-API dans Bun](https://github.com/oven-sh/bun/blob/main/docs/runtime/node-api.mdx) (`.node` importés ou `require`), [Bun.sql](https://github.com/oven-sh/bun/blob/main/docs/runtime/sql.mdx) (PostgreSQL, MySQL, SQLite), [Bun.redis](https://github.com/oven-sh/bun/blob/main/docs/runtime/redis.mdx) ; dans le fork `yolo` : `src/jsc/CachedBytecode.rs` (cache de bytecode JSC), interruption JSC (`JSC__VM__notifyNeedTermination` dans `src/jsc/bindings/bindings.cpp:5157`, `src/jsc/VM.rs:132`, `src/jsc/bindings/vm/NodeVMRunTermination.cpp`), `Error.captureStackTrace` et `prepareStackTrace` dans `src/jsc/bindings/ErrorStackTrace.cpp` et `FormatStackTraceForJS.cpp`, adaptateurs `src/sql/{postgres,mysql}`. Les chiffres de lignes et de versions viennent des manifests et des `wc -l` de la session ; les durées et budgets restent des estimations.

## Journal de vérification (2026-10-05)

Statut : V = vérifié conforme, C = corrigé dans le texte, N = non vérifiable ici. Sources : `cargo metadata --no-deps --offline` (toolchain 1.98.1) sur `aphrody` `1c2cbf1ed` + `Bun.Glob` (lignes de `*.rs` par répertoire de crate) ; fork Bun lu par `git show`/`git ls-tree` dans `vendor/bun` (`c439b6fbd`) ; crates locales `crates/tauri/*`, `crates/web/obscura*` ; `aphrody git api` (GET) ; rapports `research-*.md`/`prep-*.md`.

| Affirmation | Valeur vérifiée | Statut | Source |
| --- | --- | --- | --- |
| 237 crates | 235 membres (27 paquets hors workspace : `crates/os/drive`, plugin-sql, fixtures) | C | `cargo metadata` |
| ~929 000 lignes | 950 969 lignes `*.rs` (tests et fixtures compris) | C | `Bun.Glob` |
| 82 crates pures | 74 (toutes dépendances), 80 (hors dev) | C | `cargo metadata` |
| 115 tokio | 114 (104 hors dev) | C | idem |
| 55 reqwest | 55 | V | idem |
| 77 tracing | 76 | C | idem |
| 48 async-trait | 48 (47 hors dev) | V | idem |
| 13 rusqlite | 13 | V | idem |
| 44 tauri | 41 dépendent de `aphrody-tauri` (51 avec la famille runtime/plugins/wry/tao) ; le crate `tauri` est renommé, donc `tauri` exact = 0 | C | idem |
| wasm-bindgen, pyo3 (cités dans la définition de « pure ») | 4 et 2 crates | V | idem |
| `tauri` : 55 crates, 218 900 lignes | 55, 217 964 | C | `crates.tsv` |
| `web` : 18, 178 700 | 19, 197 019 | C | idem |
| `ai` : 54, 156 200 ; MCP 13 700 | 54, 156 412 ; 13 807 | C | idem |
| `ml` : 9, 86 200 ; LibTorch 70 000 | 9, 86 153 ; 70 004 | V | idem |
| `os` : 33, 78 700 ; WinClean 18 300 | 33, 79 376 ; 18 256 | C/V | idem |
| `compat` : 9, 61 300 ; serde-saphyr 36 700 | 9, 61 253 ; 36 734 | V | idem |
| `ui` : 16, 50 200 | 15, 51 049 | C | idem |
| `infra` : 8, 48 700 ; `aphrody-command` 25 200 | 8, 52 257 ; 25 428 | C | idem |
| `google` : 8, 16 900 | 8, 16 920 | V | idem |
| `shell` : 14, 9 600 | 13, 9 613 | C | idem |
| `engine` : 4, 7 000 (avec `yolo-desktop`) | 3, 6 385 (`yolo-desktop` absent) | C | idem |
| `contracts` 3 / 6 500 ; `interop` 1 / 5 200 ; `native` 3 / 3 300 ; `discord`+`apps` 2 / 1 600 | 3 / 6 493 ; 1 / 5 202 ; 3 / 3 281 ; 2 / 1 592 | V | idem |
| Exemples niveau 0 (9 crates) | 8 sont sans tokio/reqwest/rusqlite ; `aphrody-search` dépend de tokio et tracing | C | `cargo metadata` |
| Crates niveau 1 « à migrer » (10) et niveau 2 (4) | Toutes existent et portent bien tokio/reqwest/rusqlite/tauri/wasm-bindgen/pyo3 attendus (`aphrody-fsindex` : rusqlite sans tokio ; `aphrody-git` : tokio en dev seulement) | V | idem |
| `aphrody-io`, `aphrody-http`, `aphrody-sys`, `aphrody-spawn`, `aphrody-output` | Absents d'`aphrody` ; équivalents `bun_io`/`bun_http`/`bun_sys`/`bun_spawn`/`bun_output` dans le fork ; `bun_io` = boucle epoll/kqueue (collision de nom) | C | `src/io/lib.rs`, `Cargo.toml` du fork |
| Doublons : simdutf ×2, YAML ×2, commandes ×2, systemd ×2 | `crates/native/simdutf` + `bun_simdutf_sys` ; `serde-saphyr` + `src/parsers/yaml.rs` ; `aphrody-command` + `aphrody-mcp` ; `crates/os/systemd` + `config/host/systemd` | V | idem |
| Trois SQLite (dont un dans Obscura) | Deux : rusqlite 0.40 et `bun:sqlite` ; aucun SQLite dans les `Cargo.toml` d'Obscura | C | `cargo metadata`, `src/js/bun/sqlite.ts` |
| Deux journaux (tracing, `aphrody-output`) | tracing : 76 crates ; `bun_output` existe ; absence de tracing dans le lock du fork | V | `Cargo.lock` du fork |
| `ci.yml` Obscura (policy, core, performance) | Présent (`PR checks`, PR + push `main`) | V | API `h4ckf0r0day/obscura@1fccab2c1` |
| `rust-lints.yml`, `source-lints.yml`, `format.yml`, `packages-ci.yml` (Bun) | Présents ; déclencheurs PR (+ push `main` pour source-lints et packages-ci) | V | `.github/workflows/` du fork |
| `release.yml` « hérité de Bun », matrice 5 cibles | Bun : `release: published`/cron/dispatch, jobs sign/npm/docker/homebrew sans matrice ; matrice + tag `v*` = Obscura | C | idem |
| `docker.yml` Obscura + `dockerhub` Bun | `docker.yml` présent chez Obscura ; répertoire `dockerhub/` présent chez Bun | V | idem |
| `update-vendor.yml` bumpe `deps/*.ts` | Bumpe `test/vendor.json` (elysia) ; les `update-<dep>.yml` bumpent `deps/*.ts` ; tous gardés `oven-sh/bun` | C | idem |
| `freebsd-smoke.yml` nightly `-Zbuild-std` | `workflow_dispatch` manuel, artefact Buildkite | C | idem |
| Nightly `2026-09-15`, `-Zbuild-std`, `panic_abort` | `channel = "nightly-2026-09-15"` ; `-Zbuild-std=core,alloc,std,proc_macro,panic_abort` | V | `rust-toolchain.toml`, `scripts/build/rust.ts:127` |
| Branche `yolo` du fork Bun (`954db0c`) | Absente ; `main` = `c439b6fbd` (6 en avance, 1 en retard sur `oven-sh/bun:main`) | C | API GitHub |
| « cache WebKit » préchauffé (one shot 1) | Défaut `webkit: "prebuilt"` au pin ; PR #41330 non ancêtre (contredit partie 4 §10.3) | C | `scripts/build/config.ts:1295` |
| `aphrody-labs/yolo` à créer | Existe (privé, `main`, `dev`, `vendor`) ; `yolo-legacy` absent | C | API GitHub |
| 70 ops / 71 `#[op2]` | 74 ops distincts, 76 `#[op2]` | C | `bootstrap.js`, `ops.rs` |
| 164 références `v8::` | 183 | C | `rg` sur `crates/web/obscura*` |
| `bootstrap.js` 16 900 lignes | 17 932 | C | `Bun.file` |
| `runtime.rs` ~18 000 lignes de tests | 24 448 lignes, `mod tests` dès la ligne 4 298, 334 `#[test]` | C | `rg` |
| `CachedBytecode.rs`, `html_rewriter.rs`, `event_loop`/`ConcurrentTask`, `src/sql/{postgres,mysql}` | Présents | V | `git ls-tree` du fork |
| Watchdog JSC dans `bindings.cpp` | `JSC__VM__notifyNeedTermination` (`bindings.cpp:5157`, `VM.rs:132`, `NodeVMRunTermination.cpp`) | C | `git grep` |
| `Error.captureStackTrace`/`prepareStackTrace` dans `ErrorStackTrace.cpp`, `FormatStackTraceForJS.cpp` | Présents | V | idem |
| `clippy.toml` interdit `std::fs`, `HashMap`, `println!`, `str::find` ; lints `warnings`/`unreachable_pub`/`dead_code` en deny | Confirmé | V | `clippy.toml`, `Cargo.toml:179-200` |
| ~105 crates `bun_*` | 99 membres, tous `bun_*` (workspace virtuel) | C | `Cargo.toml` du fork |
| `rust.ts` planifie `-p bun_runtime` | `rust.ts:276` | V | idem |
| Obscura stable 1.75 | Edition 2021 confirmée ; aucune `rust-version` locale | N | `Cargo.toml` Obscura |
| Recouvrement des `Cargo.lock` 126/95/31 | Reproduit : 126 communs, 95 identiques, 31 en écart (lock du fork Bun vs lock du fork Obscura) | V | `lockcmp.ts` |
| cssparser 0.36 / selectors 0.33 | Valeurs du lock du fork Bun ; copie Obscura en 0.37 / 0.38 (rétrogradation) | C | `Cargo.lock`, `obscura-dom/Cargo.toml` |
| `bun test` : 2 007 fichiers | 2 205 `*.test.{ts,tsx,js,jsx,mjs,cjs}` (2 212 avec spec/mts/cts) | C | `git ls-tree test` |
| 85 ms, 30 Mo RSS, scripts `perf_smoke.py`, ja4/tls.peet.ws, CreepJS | Chiffres du README Obscura et outils amont | N | — |
| ~70 Mo de binaire Obscura | 70 MiB avec `release-dist` (amont #965) | N | `research-obscura-v3.md` |
| `Bun.WebView` 9 500 lignes, 6 fichiers de tests | 9 495 lignes (17 fichiers) ; 5 tests + 1 fixture, 3 572 lignes, ~130 `test(` | V/C | `git show` |
| WKWebView en process hôte `BUN_INTERNAL_WEBVIEW_HOST`, `host_main.cpp` (macOS), `ipc_protocol.h`, `ChromeBackend.cpp` (CDP pipe/WebSocket), option `backend` | Confirmé ; transport = `socketpair` `SOCK_STREAM`, pas un socket Unix nommé | V/C | `src/runtime/webview/`, `docs/runtime/webview.mdx` |
| `tauri.d.ts` / `Bun.tauri` sans implémentation | Types seuls ; `IpcMessage {cmd, callback, error, payload}`, `getDisplayConfig` ; aucune autre occurrence de `tauri` dans `src/`, `scripts/`, `packages/` | V | `git grep` |
| Schéma d'actifs WebView « `http(s)` seulement » | `data:` et `file://` aussi | C | `docs/runtime/webview.mdx:190-192` |
| Colonne Obscura : `http(s)`, `data:` ; `isTrusted` émulé en stealth | — | N | — |
| `tauri-runtime` 2 874 lignes | 6 156 (`src/`), `dynamic.rs` 2 954 | C | `crates/tauri/aphrody-tauri-runtime` |
| `tauri-runtime` dépend de webview2-com, gtk, webkit2gtk | Non : windows 0.62, jni, objc2 ; ces dépendances sont dans `tauri-runtime-wry` | C | `Cargo.toml` des deux crates |
| wry 0.57, tao 0.37, features `devtools`/`x11`/`dbus`, softbuffer 0.4, webview2-com 0.39 | wry 0.57.0, tao 0.37.1 ; features et versions confirmées | V | `aphrody-tauri-runtime-wry/Cargo.toml` |
| `cookie 0.18` | `=0.18.2` (workspace) | V | `Cargo.toml:195` |
| `tauri` : tokio et reqwest 0.13, tray `ksni` | Confirmé (non optionnels) | V | `aphrody-tauri/Cargo.toml:51,91,194` |
| `tauri-runtime-wry` ne tire pas `tauri` | Dépend de `tauri` (feature `gtk3`) | C | `aphrody-tauri-runtime-wry/Cargo.toml` |
| `tauri-runtime-cef` alpha | 3.0.0-alpha.5 ; CEF « +100 Mo » non vérifié | V/N | `Cargo.toml` ; `research-tauri-v3.md` |
| `tauri://localhost` / `http://tauri.localhost` | Confirmé dans le code | V | `aphrody-tauri/src/manager/mod.rs:363` |
| Tauri « branche `dev`, 2.12.1, Rust 1.90 » | Cible v3, MSRV 1.95, edition 2024 ; « 1.90 » non retrouvé | C/N | `Cargo.toml` locaux |
| Issue Obscura #295 (cookie) | Échec de build Windows, fermée le 2026-06-13 ; Obscura utilise déjà `cookie =0.18.2` | C | API GitHub |
| ~30 plugins Tauri | 30 répertoires `aphrody-tauri-plugin-*` (29 membres, plugin-sql exclu) | V | `crates.tsv` |
| Matrice `rusty_v8` v150.4.0 et variables `RUSTY_V8_MIRROR`/`RUSTY_V8_ARCHIVE`/`V8_FROM_SOURCE` | Confirmés | V | API `denoland/rusty_v8@v150.4.0` |
| Champs `TlsOptions` de wreq (`cipher_list`, `alpn_protocols`, `alps_protocols`, `permute_extensions`, `extension_permutation`, `grease_enabled`, `enable_ech_grease`, `certificate_compressors`, Zlib/Brotli/Zstd) | Présents sur `main` de wreq | V | API `0x676e67/wreq` |
| Docs `node-api.mdx`, `sql.mdx`, `redis.mdx`, adaptateurs `src/sql/*` | Présents | V | fork Bun |
| Sources : fork Obscura `0cdd42e`, aphrody `32284a6` | `main` Obscura `1fccab2c1`, `yolo` `dbea8a7c1` ; aphrody `1c2cbf1ed` | C | API GitHub |
| Licences Obscura Apache-2.0, Bun MIT, WebKit LGPL | Confirmées (`Cargo.toml` Obscura, `LICENSE.md` du fork) | V | idem |
| Guide de migration Tauri 3, billet Cloudflare « Kitesurf », Context7 | Pages externes non rouvertes | N | — |
