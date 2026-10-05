# Plan de fusion Obscura × Bun

Oct 5, 2026 · @aphrody-dev — copie du document de travail (version vivante : [https\://claude.ai/code/artifact/107724ae-da88-44f8-8b84-e9bb3c5afbb8](https://claude.ai/code/artifact/107724ae-da88-44f8-8b84-e9bb3c5afbb8) ; version Markdown intégrale : `PLAN-FUSION-APHRODY.md` dans ce dossier).

## Résumé exécutif

Décision : le workspace unifié est **`aphrody-labs/aphrody`**, qui a déjà absorbé Obscura (`crates/web/obscura-*`), Tauri 3 alpha avec wry, tao et ses plugins (`crates/tauri/*`) et les crates d'indexation (`crates/web/web-*`). On y **ajoute les \~105 crates de Bun-Rust** (fork `aphrody-labs/bun`, branche `yolo`) sous `crates/bun/*`, toutes préfixées `aphrody-` et référencées par `workspace = true`, et on **retire V8** en portant le runtime de page d'Obscura sur JavaScriptCore. La fusion est exécutée en one shot par un workflow dynamique Opus 5.5 plafonné à 200 €, en 1 à 2 jours, casse assumée, divergence définitive avec les upstreams. Conséquence à accepter dès J0 : tout le dépôt `aphrody` passe du stable 1.98.1 au nightly `2026-09-15` exigé par Bun, et le binaire `bun` est produit par le script de build de Bun (ninja \+ WebKit précompilé) porté dans `scripts/build/bun/`, pas par un simple `cargo build`.

Résultat attendu : un binaire `bun` qui est aussi le navigateur headless, exposé nativement dans Bun (`bun:browser` et `Bun.Browser` dans les scripts, sous-commande `bun browser` en CLI) sans installation ni dépendance externe. Obscura gagne JSC, les Workers, `aphrody-http` (H1/H2/H3), BoringSSL, c-ares et mimalloc ; Bun gagne un DOM, un moteur de rendu, un serveur CDP compatible Puppeteer/Playwright et un serveur MCP.

Point de départ (5 octobre 2026\) : Obscura \= 10 crates, \~172 000 lignes de Rust, 16 900 lignes de `bootstrap.js`, V8 via `deno_core`, tokio, reqwest/rustls, `wreq` ; Bun-Rust (branche `yolo`) \= \~105 crates, 1 528 fichiers Rust, 576 fichiers C++ de liaison WebKit, nightly `2026-09-15`, `-Zbuild-std`, `panic = "abort"`. 126 paquets communs, une dizaine de piles en double (HTTP, TLS, DNS, compression, boucle d'événements, crypto, WebSocket, CLI, logs, codecs image).

Les cinq choix qui rendent le one shot possible :

1. **Divergence totale assumée.** Plus aucun suivi d'`oven-sh/bun` ni de `h4ckf0r0day/obscura`. Renommage mécanique par script, lints de Bun désactivées sur les crates importées, tests existants laissés en l'état tant qu'ils ne compilent pas.  
2. **JSC direct.** `bootstrap.js` repris tel quel ; un objet `Deno.core.ops` servi par `aphrody-jsc` ; seuls les 164 appels `v8::` directs, le snapshot et le chargeur de modules sont réécrits. V8, `deno_core` et une seconde ICU n'entrent jamais dans le binaire.  
3. **Infrastructure Bun imposée d'emblée.** tokio, reqwest, hyper, rustls, ring, wreq, tungstenite, tracing, clap ne sont pas portés : chaque usage est remplacé, ou neutralisé par un stub qui renvoie une erreur explicite, pendant la vague d'intégration.  
4. **Parallélisme d'agents.** Cinq chantiers sur des chemins disjoints réservés dans .coord/claims le jour 1 (règle du CLAUDE.md d'Aphrody : pas de worktree ni de clone), une vague d'intégration et de compilation le jour 2 ; chaque agent n'a qu'une ou deux crates en portée ; seul l'intégrateur lance Cargo, en série, par `cargo check -p`.  
5. **Budget protégé.** 200 € répartis par chantier avec plafond et condition d'arrêt ; ce qui n'entre pas dans le budget est consigné dans `BROKEN.md`, pas rattrapé.

Ce qui sera très probablement cassé à la livraison : empreinte TLS stealth incomplète, tests Obscura non portés, Linux x86\_64 seul, domaines CDP partiels, performances non mesurées. Le détail est dans la section Risques.

## Simplification retenue : Obscura est aussi un plugin natif

Le noyau `bun` reste le Bun-Rust d'origine, avec son démarrage de quelques millisecondes ; Obscura (DOM, rendu, transport, CDP, MCP, runtime de page) devient `@aphrody/plugin-obscura`, chargé à la demande, et le crawl `@aphrody/plugin-crawl` par-dessus. Cette décision prime sur les passages du plan qui plaçaient ces crates dans le binaire ; les chantiers, budgets et dates du one shot restent les mêmes, seul l'endroit où le code atterrit change.

| Ce qui entre dans le noyau `bun` (patches, petits) | Ce qui vit dans les plugins (gros) |
| :---- | :---- |
| **Hôte de realm** (`aphrody-realm-host`, \~500 lignes dans `crates/bun/jsc`) : créer un global object JSC isolé par page dans un Worker, y installer des fonctions hôtes fournies par un plugin (table de pointeurs C `(name, fn, arity)`), évaluer un script avec cache de bytecode, interrompre (watchdog), lire/écrire des valeurs par JSON ou buffers partagés. C'est le `Deno.core.ops` générique : il ne sait rien du DOM | `@aphrody/plugin-obscura` : `aphrody-page-runtime` (`bootstrap.js` \+ 70 ops branchés sur l'hôte de realm), `aphrody-dom`, `aphrody-render`, `aphrody-browser`, `aphrody-browser-transport`, `aphrody-cdp`, `aphrody-browser-mcp` ; expose `bun:browser`, `Bun.Browser`, `bun browser …` |
| **Chargeur de plugins** : manifeste, signature Ed25519, cache `~/.bun/plugins`, `bun plugin add/remove/list`, enregistrement de sous-commandes CLI et de modules `bun:*` virtuels résolus vers un plugin ; chargement **paresseux** : rien n'est `dlopen` tant qu'une commande ou un `import` ne le demande pas | `@aphrody/plugin-crawl` : `aphrody-web-crawl`, `-extract`, `-index`, `-detect`, daemon TS, `FrontierStore` SQLite/Postgres/Redis ; expose `bun crawl …` et `bun:web` |
| **Points d'extension déjà présents ou à élargir** : `Bun.WebView` accepte un backend fourni par plugin (`backend: "obscura"` \= socket vers le CDP du plugin) ; `Bun.serve` et `uws` accessibles aux plugins par N-API pour le serveur CDP ; `aphrody-http` exporté aux plugins par une table de fonctions C stable (`aphrody_http_v1`) pour que le transport Obscura n'embarque pas sa propre pile réseau | `@aphrody/plugin-tauri`, `plugin-next`, `plugin-cef`, `plugin-wgpu`, `plugin-ml`, `plugin-x`, `plugin-discord` (sections suivantes) |
| **Budget de démarrage** gardé par mesure : `bun -e 1` et `bun run` d'un script vide comparés avant/après chaque patch du noyau (`hyperfine`, 100 exécutions) ; tout patch qui ajoute plus de 0,5 ms au démarrage ou 1 Mo au binaire est refusé ou déplacé dans un plugin | Les plugins payent leur propre démarrage : `plugin-obscura` précharge `bootstrap.js` depuis son cache de bytecode, et garde une réserve de realms prêts pour les pages suivantes |

Conséquences pratiques :

- Le workspace `aphrody` garde les mêmes crates aux mêmes endroits ; ce qui change est le `crate-type` des crates de tête (`cdylib` N-API sous `crates/plugins/obscura` et `crates/plugins/crawl`) et le fait que `bun run build:bun` ne les compile pas.  
- L'ABI entre noyau et plugins est versionnée (`aphrody_plugin_abi = 1`) et testée par un plugin témoin minuscule dans la CI ; N-API couvre les objets JS, les tables C couvrent les chemins chauds (ops DOM, HTTP, realm).  
- Les tests Obscura et la suite anti-détection tournent contre `bun` \+ plugin, jamais contre un binaire spécial.  
- La sortie du one shot 1 devient : noyau `bun` patché (hôte de realm \+ chargeur) et `@aphrody/plugin-obscura` qui passe la fumigation en cinq points ; les chantiers A–E ne changent pas de contenu, le chantier B gagne une première heure pour écrire l'hôte de realm dans le noyau avant de porter les ops dessus.  
- Mode service et mode graphique restent `bun crawl daemon` et `bun crawl --gui` : la commande vient du plugin, le binaire reste le même `bun`.

## État des lieux : Obscura

Obscura est un workspace de 10 crates (plus `test-support`), \~172 000 lignes de Rust, organisé en couches strictes : chaque crate n'appelle que la couche du dessous. Le fork `aphrody-labs/obscura` (commit `0cdd42e`, 1er octobre) n'a aucune modification propre ; il est 62 fichiers derrière l'upstream `h4ckf0r0day/obscura` (commits des 2 au 4 octobre).

| Crate | Rôle | Lignes Rust | Dépendances structurantes | Features |
| :---- | :---- | :---- | :---- | :---- |
| `obscura-cli` | Binaires `obscura` et `obscura-worker` : `fetch`, `serve`, `scrape`, `mcp` | 4 710 | clap 4, tokio, tracing-subscriber | `render`, `stealth` |
| `obscura-cdp` | Serveur Chrome DevTools Protocol (WebSocket, dispatch, domaines Page/Runtime/DOM/Network/Fetch/Input) | 23 588 | tokio-tungstenite 0.26, uuid, image/png/jpeg-encoder/fast\_image\_resize | `render`, `stealth` |
| `obscura-mcp` | Serveur Model Context Protocol (stdio et HTTP) | 3 556 | tokio, serde\_json | `render`, `stealth` |
| `obscura` | API Rust embarquable : `Browser`, `Page`, `Element`, `CookieStore`, interception | 2 284 | tokio `rt` | `api`, `render`, `stealth` |
| `obscura-browser` | Type `Page`, navigation, cycle de vie, capture écran/PDF, interception | 12 319 | tokio, futures, image | `render`, `stealth` |
| `obscura-js` | Runtime V8 : `bootstrap.js` (16 918 lignes) \+ 71 ops `#[op2]`, snapshot V8 généré au build, chargeur de modules, watchdog | 36 228 (dont \~18 000 de tests) | deno\_core 0.412 (V8 150.4), RustCrypto (sha1/sha2/hmac/aes-gcm/pbkdf2/hkdf), getrandom 0.2, psl | `render`, `stealth` |
| `obscura-net` | Client HTTP, client stealth, jarre à cookies, cache robots.txt, liste de 3 520 traqueurs | 6 711 | reqwest 0.12 \+ rustls \+ ring, wreq `=6.0.0-rc.29` \+ wreq-util `=3.0.0-rc.12` (BoringSSL), encoding\_rs, async-trait, tempfile | `stealth` |
| `obscura-dom` | Arbre DOM, sélecteurs CSS | 5 782 | html5ever 0.39, selectors 0.26, cssparser 0.34, servo\_arc | — |
| `obscura-render` | Cascade CSS, mise en page retenue (taffy), façonnage du texte, peinture CPU, SVG, PDF | 77 036 | taffy 0.12 (vendorisé), cosmic-text `=0.14.2` (vendorisé), swash, tiny-skia, resvg/usvg 0.47, ureq 2 (chargeur synchrone), image | `paint` |
| `obscura-ssrf` | Liste de refus SSRF partagée, opt-in réseau privé | 139 | aucune | — |

Points qui pèsent sur la fusion :

- **Toolchain** : Rust stable 1.75+, edition 2021, `resolver = "2"`, deux `[patch.crates-io]` (taffy, cosmic-text dans `vendor/`). Profil `release-dist` en `opt-level = "s"`, LTO fat, `strip`.  
- **`panic = "unwind"` est requis** : les ops enveloppent leur corps dans `catch_unwind` pour qu'une panique dégénère en erreur au lieu de traverser le cadre FFI de V8. Bun compile tout en `panic = "abort"`.  
- **Un seul isolate V8 par processus**, mono-thread par conception. Un `tokio::sync::Mutex` global (`v8_lock`, acquis par le dispatcher CDP) sérialise tout le travail JS ; le `scrape` parallèle passe par des processus `obscura-worker`. Plusieurs `ObscuraJsRuntime` peuvent néanmoins coexister sur un même thread (test `multi_isolate_teardown`).  
- **Snapshot V8 au build** : `build.rs` exécute V8 sur la machine hôte pour sérialiser `bootstrap.js` ; en compilation croisée il faut un `mksnapshot` produit par le build GN de V8.  
- **Trois piles TLS** selon les features : rustls \+ ring (reqwest), BoringSSL via wreq (`prefix-symbols` sur Linux/Android seulement, pour éviter les collisions avec un OpenSSL système), et `ureq` pour le chargeur synchrone du rendu.  
- **Doublons internes** déjà présents dans son `Cargo.lock` : getrandom 0.2/0.3/0.4, thiserror 1 et 2, rustix 0.38 et 1.1, quatre versions de windows-sys, deux de phf, rand, hashbrown, bindgen.  
- **Tests** : tests unitaires lourds dans `obscura-js` (runtime, ops), tests d'intégration CDP et CLI, alias `cargo test-js` (nextest, `RUST_TEST_THREADS=1`), suite de conformité WPT, parcours d'obstacles et corpus réel dans le dépôt séparé `obscura-benchmark`.  
- **Pont JS ↔ Rust étroit** : `bootstrap.js` n'accède à Rust que par `globalThis.Deno.core` (70 ops distincts, un seul alias en tête de fichier). C'est ce qui rend un portage vers JSC envisageable.

## État des lieux : Bun-Rust (`aphrody-labs/bun`, branche `yolo`)

Le fork n'est plus le Bun Zig/C++ d'upstream : c'est un portage complet en Rust (commit `954db0c`, 5 octobre), avec un workspace de \~105 crates sous `src/` dont `bun_runtime` est la racine, et 576 fichiers C++ qui restent la colle vers WebKit/JavaScriptCore. Tout ce dont Obscura a besoin comme infrastructure y existe déjà, sauf le proxy SOCKS5.

| Domaine | Ce que le fork fournit | Conséquence pour la fusion |
| :---- | :---- | :---- |
| Moteur JS | JavaScriptCore (WebKit `autobuild`), liaison par `bun_jsc`, `sys_jsc`, `jsc_macros` ; Workers WebCore \= une VM JSC par thread | Un runtime de page par Worker devient possible ; V8 n'a pas d'équivalent natif ici |
| Convention de binding | 11 crates `*_jsc` séparées des crates métier, 31 définitions `*.classes.ts` générées en `generated_classes`, `NativePromiseContext` pour les promesses natives ; `HTMLRewriter` (`src/runtime/api/html_rewriter.rs`) enveloppe la crate Rust `lol_html` | Modèle direct pour `bun_browser` \+ `bun_browser_jsc` |
| Boucle d'événements | `bun_event_loop` sur uSockets ; `ConcurrentTask` et `enqueue_task_concurrent` pour poster du travail depuis un autre thread | Remplace tokio ; le moteur de page tourne hors du thread JS et notifie par `ConcurrentTask` |
| Client HTTP | `bun_http` : H1, H2 (`h2_client`), H3 (`h3_client`, lsquic), thread HTTP dédié, `ProxyTunnel` (CONNECT), décompression, client WebSocket, cache de sessions TLS | Remplace reqwest, hyper, ureq ; **SOCKS5 à ajouter** (Obscura l'accepte via `--proxy socks5://`) |
| TLS | BoringSSL, fork `oven-sh/boringssl` (commit `41bf9b5`), crates `bun_boringssl` et `bun_boringssl_sys` | Même bibliothèque que `wreq` : le profil ClientHello Chrome se réécrit dessus, sans seconde copie |
| DNS | `bun_dns` sur c-ares | Remplace le résolveur de hyper ; accueille la politique SSRF |
| Compression | zlib, libdeflate, brotli, zstd vendorisés en C (`scripts/build/deps/*.ts`) | Remplacent flate2, miniz\_oxide, brotli 8, zstd 0.13 |
| Codecs image | libjpeg-turbo, libspng, libwebp vendorisés | Remplacent `image`, `png`, `jpeg-encoder` pour l'encodage des captures |
| Serveur WebSocket | `uws` (`Bun.serve`) | Remplace tokio-tungstenite pour le serveur CDP |
| HTML / CSS | `lol_html` 2.7.2 (branche `bun`, réécriture en flux), `bun_css` (cssparser 0.36, selectors 0.33) | `lol_html` ne remplace pas un DOM : html5ever reste ; les versions cssparser/selectors sont à aligner |
| Allocateur, threads, logs, CLI | mimalloc (`bun_alloc`), `bun_threading`, `bun_output`/`bun_perf`, `bun_clap` | Remplacent l'allocateur système, parking\_lot, tracing, clap |
| Build | `scripts/build.ts` (ninja) ; `rust.ts` planifie `cargo build -p bun_runtime --unit-graph` avec `-Zbuild-std=core,alloc,std,proc_macro,panic_abort`, `-Clinker-plugin-lto`, `-Ctarget-cpu` dérivé de `-march` ; le lien final est fait par ninja avec les objets C++ | Toute crate ajoutée passe par ce plan ; une bibliothèque précompilée (V8) doit être déclarée comme dépendance `deps/*.ts` |
| Toolchain | `nightly-2026-09-15`, edition 2024, 11 cibles préinstallées \+ aarch64-freebsd via build-std, `panic = "abort"` en dev et release, `lto = "off"` \+ `codegen-units = 1` (ThinLTO au lien) | Obscura doit compiler sur ce nightly et vivre sans `catch_unwind` |
| Lints | `[workspace.lints]` : `warnings`, `dead_code`, `unreachable_pub`, `unused_*` en `deny` ; `clippy.toml` interdit `std::fs`, `std::sync::Mutex`, `HashMap` std, `println!`, `str::find`, `std::thread::spawn`, `std::process::Command`… | Les crates Obscura n'y passent pas en l'état ; adoption crate par crate |
| Tests et revue | 2 007 fichiers `*.test.ts` (runner `bun test`), 77 fichiers Rust avec `#[test]`, `rust:check`, `rust:clippy`, `rust:check-all` (toutes cibles), lints de source dans `test/internal/source-lints`, `REVIEW.md` et `.claude/docs/landing-prs.md` comme critères de merge | Les tests Obscura (Rust) et la suite anti-détection s'ajoutent à ce dispositif |

Deux faits de build conditionnent le pont V8 de la phase 1 :

- `lol_html` montre la voie : une crate Rust externe est compilée comme rlib du workspace (pas de `staticlib`, qui dupliquerait `std`), récupérée dans `vendor/` par un script `deps/*.ts` et exclue des `members`. Les crates Obscura, elles, deviennent des membres à part entière.  
- La crate `v8` (rusty\_v8) télécharge une archive statique précompilée par cible et embarque sa propre ICU ; la matrice CI de rusty\_v8 v150.4.0 la publie pour Linux gnu et musl (x86\_64, aarch64), riscv64, macOS (x86\_64, arm64) et Windows x86\_64 MSVC ; rien pour Android, FreeBSD ni Windows ARM64, trois cibles de Bun. Le pont V8 est donc une feature de build (`browser`) activée par cible, jamais une dépendance inconditionnelle de `bun_runtime`.

## Doublons, goulots d'étranglement et choix d'architecture

Onze fonctions existent deux fois ; pour chacune la cible est la pile de Bun, renommée `aphrody-*`, sauf trois cas où Obscura garde la sienne (DOM, rendu, URL). Chaque ligne est un ordre de travail du one shot, affecté à une vague (J1 \= chantiers parallèles, J2 \= intégration).

| Fonction | Obscura aujourd'hui | Bun-Rust aujourd'hui | Cible unifiée | Vague |
| :---- | :---- | :---- | :---- | :---- |
| Moteur JS de page | V8 150.4 \+ deno\_core 0.412, snapshot au build | JavaScriptCore (`bun_jsc`) | `aphrody-jsc` expose `Deno.core.ops` ; V8 et deno\_core jamais importés | J1 · chantier B |
| Client HTTP | reqwest 0.12 \+ hyper 1 ; ureq 2 pour le rendu | `bun_http` (H1/H2/H3, thread dédié, CONNECT) | `aphrody-http` ; SOCKS5 \= stub `Err("socks5: non porté")` si hors budget | J1 · chantier A |
| TLS | rustls \+ ring ; wreq rc.29 \+ BoringSSL (stealth) | BoringSSL `oven-sh` | BoringSSL de Bun ; profil ClientHello Chrome \= meilleur effort (suites \+ ALPN \+ GREASE), le reste dans `BROKEN.md` | J1 · A |
| DNS et SSRF | résolveur de hyper ; `obscura-ssrf` | `bun_dns` (c-ares) | `aphrody-dns` \+ module `private_network` | J1 · A |
| Compression | flate2, miniz\_oxide, brotli 8, zstd 0.13 | libdeflate, brotli, zstd (C) | piles C de Bun (`aphrody-zlib`, `aphrody-brotli`, `aphrody-zstd`) | J1 · A |
| Boucle d'événements | tokio 1.52 (`LocalSet`, `Mutex` global), futures, async-trait | `bun_event_loop`, `ConcurrentTask` | `aphrody-event-loop` ; moteur de page sur thread Worker, `async fn` d'Obscura réduits à des fonctions bloquantes sur ce thread | J1 · C |
| Serveur WebSocket (CDP) | tokio-tungstenite 0.26 | `uws` | `aphrody-uws` | J1 · D |
| Crypto de page (`crypto.subtle`) | RustCrypto (sha1, sha2, hmac, aes-gcm, pbkdf2, hkdf), getrandom 0.2 | WebCrypto de Bun sur BoringSSL | WebCrypto de Bun injectée dans le realm de page | J1 · B |
| Codecs image | image 0.25, png 0.18, jpeg-encoder, fast\_image\_resize | libjpeg-turbo, libspng, libwebp | codecs de Bun ; `image` toléré en J2 si le temps manque | J1 · E |
| CLI | clap 4.6 | `bun_clap` | `aphrody-clap`, sous-commande `bun browser` | J1 · D |
| Logs, métriques | tracing, tracing-subscriber | `bun_output`, `bun_perf` | `aphrody-output` (macro `tracing::*` → `debug_warn!` par script) | J0 |
| Allocateur, threads, fichiers | allocateur système, parking\_lot, std::fs, tempfile | mimalloc, `bun_threading`, `bun_sys` | ceux de Bun ; `std::fs` toléré jusqu'à adoption des lints | J2 |
| ICU | copie embarquée dans V8 | copie de WebKit | WebKit seule, par construction | J1 · B |
| Analyse HTML / CSS | html5ever 0.39, selectors 0.26, cssparser 0.34 | lol\_html 2.7, `bun_css` (cssparser 0.36, selectors 0.33) | html5ever conservé ; cssparser 0.36 et selectors 0.33 partout | J0 |
| URL | `url` 2.5, idna, percent-encoding | `bun_url` | `url` conservé (ancré dans le DOM et la jarre à cookies) | — |
| Mise en page et peinture | taffy, cosmic-text, swash, tiny-skia, resvg | — | conservés dans `aphrody-render` | — |
| Versions croisées | getrandom 0.2/0.3/0.4, thiserror 1/2, rustix 0.38/1.1, strum 0.27, itertools 0.13, derive\_more 0.99 | getrandom 0.4, thiserror 2, rustix 0.38, strum 0.26, itertools 0.10, derive\_more 2 | une version par crate, celle de Bun, imposée par `[workspace.dependencies]` | J0 |

Goulots d'étranglement levés par construction :

1. **Le verrou V8 global** (un isolate par processus, `Mutex` dans le dispatcher CDP, processus `obscura-worker` pour `scrape`) disparaît : un realm de page par Worker JSC, N pages en parallèle dans un processus.  
2. **Deux boucles d'événements** : tokio n'est pas importé ; le moteur de page tourne sur un thread Worker et notifie le thread JS par `ConcurrentTask`.  
3. **Trois piles TLS et deux ICU** : une seule BoringSSL, une seule ICU, celles de WebKit et de Bun.  
4. **Le snapshot V8 au build** (`build.rs` exécutant V8 sur l'hôte, `mksnapshot` en compilation croisée) : remplacé par l'évaluation de `bootstrap.js` à la création du realm, avec cache de bytecode JSC si le budget le permet, sinon évaluation à chaque page (coût de démarrage accepté à la livraison).

Choix d'architecture retenu : **JSC direct, divergence totale, infrastructure Bun imposée**. Les alternatives écartées : garder V8 comme pont (deux moteurs, deux ICU, archive rusty\_v8 à intégrer au build ninja, `panic = "abort"` contre le protocole `catch_unwind` d'Obscura ; incompatible avec « un seul binaire » et inutile si l'on accepte la casse) ; vendoring \+ adaptateur mince (rien n'est dédupliqué) ; port progressif en mois (contraire au one shot).

Sur « Bun-Rust peut-il être compatible avec deno\_core ? » : pas au sens littéral, `deno_core` est V8 (`JsRuntime`, ops, snapshots, `v8::` partout). Ce qui est fait ici : `aphrody-jsc` fournit à `bootstrap.js` le même objet `globalThis.Deno.core` (70 ops en fonctions hôtes, `#[op2]` → `host_fn`). Les 164 appels `v8::` directs d'`obscura-js` (contextes, `Global`, `TryCatch`, compilation de scripts, watchdog `IsolateHandle`) sont la partie réécrite, pas les 70 ops ni le JS.

## Architecture cible

 bun:browser         CLI bun browser …     Serveur CDP         Serveur MCP

 aphrody-browser-jsc aphrody-cli           aphrody-cdp (uws)   aphrody-browser-mcp

        └───────────────┴──────────┬────────┴───────────────────┘

          aphrody-browser — Browser, Page, cycle de vie, interception, capture

                                   │

   aphrody-page-runtime — bootstrap.js (16 900 lignes) \+ 70 ops sur JSC

   (façade Deno.core.ops exposée par aphrody-jsc ; ni V8, ni deno\_core, ni snapshot)

                  │                                    │

   aphrody-dom — html5ever, selectors       aphrody-render — taffy, cosmic-text, tiny-skia

                  │                                    │

   Infrastructure partagée (crates aphrody-\*, une seule copie de chaque) :

   aphrody-http (H1/H2/H3) · BoringSSL \+ profil ClientHello Chrome · aphrody-dns \+ SSRF

   libdeflate · brotli · zstd · libjpeg-turbo · libspng · libwebp · WebCrypto

   event loop \+ ConcurrentTask · threading · mimalloc · output · clap

                                   │

   JavaScriptCore / WebKit — un seul moteur, une seule ICU

Les quatre surfaces (module JS, CLI, CDP, MCP) ne parlent qu'à `aphrody-browser` ; le moteur de page est un realm JavaScriptCore par page, exécuté dans un Worker ; tout ce qui est sous la ligne DOM/rendu est l'infrastructure existante de Bun, renommée.

Règle de nommage, appliquée par script à tout le workspace : nom de paquet `aphrody-<nom>` (tirets), nom de bibliothèque `aphrody_<nom>` (soulignés, ce que `use` voit), dossier `src/<nom>`, déclaration unique dans `[workspace.dependencies]` et `aphrody-<nom>.workspace = true` partout. `bun_http` devient donc `aphrody-http` (`use aphrody_http::`), `bun_jsc` devient `aphrody-jsc`, et ainsi de suite pour les \~105 crates ; le binaire reste `bun`.

Correspondance des crates Obscura :

| Crate Obscura | Crate unifiée | Ce qui change |
| :---- | :---- | :---- |
| `obscura` \+ `obscura-browser` | `aphrody-browser` (`crates/web/browser`) | Fusionnées ; `async fn` tokio → fonctions bloquantes sur le thread du Worker |
| `obscura-js` | `aphrody-page-runtime` (`crates/web/page_runtime`) | Realm JSC par page, `Deno.core.ops` servi par `aphrody-jsc`, ops `#[op2]` → fonctions hôtes, snapshot supprimé |
| `obscura-dom` | `aphrody-dom` | cssparser 0.36, selectors 0.33 |
| `obscura-render` | `aphrody-render` | `ureq` → `aphrody-http` ; encodage image par les codecs de Bun (ou `image` toléré en J2) |
| `obscura-net` | `aphrody-browser-transport` | Ne garde que jarre à cookies, cache robots, liste de traqueurs, profil stealth ; transport \= `aphrody-http` |
| `obscura-ssrf` | module `private_network` d'`aphrody-dns` | Politique partagée par `fetch`, `Bun.serve` et le navigateur |
| `obscura-cdp` | `aphrody-cdp` | Serveur WebSocket sur `aphrody-uws` ; une cible \= un Worker |
| `obscura-mcp` | `aphrody-browser-mcp` | Transport HTTP sur `Bun.serve` |
| `obscura-cli` | sous-commande `browser` d'`aphrody-cli` | `clap` → `aphrody-clap` ; `obscura-worker` supprimé |
| — | `aphrody-browser-jsc` (nouveau) | Classes `Browser`, `Page`, `Element` en `*.classes.ts`, promesses via `NativePromiseContext`, module `bun:browser` et global `Bun.Browser` |

Surface JavaScript (`bun:browser`), calquée sur l'API Rust d'Obscura et le vocabulaire Puppeteer :

import { Browser } from "bun:browser"; // ou Bun.Browser, sans import

const browser \= await Browser.launch({

  stealth: true,

  proxy: "http\://127.0.0.1:8080",

  storageDir: "./profile",

  allowPrivateNetwork: false,

});

const page \= await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on("response", (req, res) \=\> { /\* capture des XHR/fetch de la page \*/ });

page.route(/\\/ads\\//, route \=\> route.abort());

await page.goto("https\://example.com", { waitUntil: "networkidle0", timeout: 10\_000 });

const title \= await page.evaluate("document.title");

const html \= page.content();

await page.waitForSelector("h1", { timeout: 5\_000 });

await page.screenshot({ path: "page.png", fullPage: true });

await page.pdf({ path: "page.pdf", format: "A4", printBackground: true });

await browser.close();

CLI : chaque commande Obscura devient une sous-commande `bun browser`, flags inchangés (`fetch`, `serve`, `scrape`, `mcp`, `--proxy`, `--stealth`, `--allow-private-network`) ; `--v8-flags` disparaît. Aucune installation : le navigateur est dans le binaire `bun` que l'utilisateur a déjà.

Modèle d'exécution : un moteur de page vit sur un thread Worker (une VM JSC dédiée), jamais sur le thread JS principal ; les appels depuis `bun:browser` sont des promesses résolues par `ConcurrentTask`. `scrape --concurrency 25` lance 25 Workers dans le processus. Le serveur CDP garde la sémantique actuelle (une session par cible) mais route chaque cible vers un Worker. Le code asynchrone d'Obscura (tokio) devient synchrone sur le thread du Worker : c'est la simplification qui rend le portage faisable en un jour, au prix d'un `fetch()` de page qui bloque son Worker le temps de la réponse.

## Plan d'exécution one shot (2 jours, 200 €, Opus 5.5)

Trois vagues : J0, deux heures d'orchestrateur seul qui prépare le terrain par scripts ; J1, cinq chantiers en parallèle sur des chemins disjoints, un agent chacun, périmètre d'une à deux crates ; J2, intégration dans un ordre fixe, compilation complète, fumigation, gel et `BROKEN.md`. Le résultat est livré à l'heure, pas à la qualité.

Ajustements imposés par la cible `aphrody` et son `CLAUDE.md` : le dépôt de travail est `aphrody-labs/aphrody` (branche autorisée, checkout existant, pas de worktree ni de clone) ; les agents J1 réservent des chemins disjoints dans `.coord/claims` et **ne lancent jamais Cargo** ; l'orchestrateur-intégrateur exécute `scripts/build/rust/cargo-serial.sh check -p <crate>` après chaque lot et renvoie les erreurs au chantier concerné ; les commits sont signés `aphrody-dev <contact@aphrody.com>` sans co-auteur ; le J0 comprend en plus le passage du dépôt au nightly `2026-09-15`, l'import des crates Bun sous `crates/bun/*`, le port de `scripts/build.ts` \+ `rust.ts` de Bun dans `scripts/build/bun/` et le cache WebKit `autobuild`. `default-members` du workspace exclut `aphrody-tauri-runtime-cef`, les exemples et les plugins mobiles pour que `cargo check --workspace` reste tenable.

 heures agent    0   2                  10                 18   20

 Orchestrateur   \[J0\]                   \[fusion B→C→A→E→D · 25 €\]\[gel\]

 A · Transport       \[2h→8h · 30 €\]

 B · Runtime JSC     \[2h→10h · 60 € · chemin critique\]

 C · Navigation      \[2h→8h · 25 €\]

 D · Surfaces        \[2h→8h · 25 €\]

 E · DOM et rendu    \[2h→6h · 15 €\]

 2 agents intégr.                       \[10h→18h · lots d'erreurs, fumigation\]

                 |─── J1 · chantiers parallèles ───|─── J2 · intégration et gel ───|

Le chantier B (runtime de page sur JSC) est le chemin critique : il consomme 30 % du budget et c'est lui qui décide si la fumigation passe. Les heures sont du temps d'agent, pas du temps calendaire : les cinq chantiers J1 tournent en même temps.

Ordres de travail et budget :

| Vague | Chantier (agent) | Périmètre | Produit attendu | Condition d'arrêt | Budget |
| :---- | :---- | :---- | :---- | :---- | :---- |
| J0 | Orchestrateur | Branche `aphrody/fusion` ; fast-forward du fork Obscura et patches Aphrody extraits ; passage au nightly `2026-09-15` ; import des crates Bun sous `crates/bun/*` par le script de renommage `bun_x` → `aphrody-x` (`Cargo.toml`, `use`, scripts de build, codegen) ; crates Obscura déjà dans `crates/web/` renommées ; `[workspace.dependencies]` fusionnées, une version par crate ; `default-members` sans CEF ni plugins ; `[lints] workspace = false` \+ `#![allow(clippy::all)]` sur les crates importées ; `tracing::*` → macros `aphrody_output` par script ; squelette `crates/plugins/obscura`, `aphrody-io`, `aphrody-realm-host` ; `FUSION.md` (conventions, interdits, stubs) lu par chaque agent ; cache WebKit `autobuild` et codegen générés une fois | Workspace qui résout (`cargo metadata` sans erreur), noyau `bun` reconstruit avec démarrage mesuré \= base, claims A–E posés dans `.coord/claims`, base commune poussée | 2 h ou 15 € | 15 € |
| J1 | A · Transport | `aphrody-browser-transport` sur `aphrody-http` : trait `Transport` (navigation, sous-ressources, `fetch()` de page), décompression par les piles C, jarre à cookies, robots, traqueurs ; SSRF dans `aphrody-dns` ; profil ClientHello Chrome sur BoringSSL (suites, ALPN, GREASE) ; SOCKS5 \= stub explicite | `cargo check -p aphrody-browser-transport` vert, 3 tests unitaires (cookies, SSRF, décompression) | 30 € ou 6 h ; au-delà, stubs \+ `BROKEN.md` | 30 € |
| J1 | B · Runtime de page JSC | `aphrody-page-runtime` : realm JSC par page (global object dédié), objet `Deno.core.ops` servi par `aphrody-jsc` avec les 70 ops en fonctions hôtes (`ops.rs` 7 900 lignes → signatures `host_fn`), `execute_script`/`evaluate`/`run_event_loop` sur l'event loop du Worker, timers et microtâches, watchdog par interruption JSC, `crypto.subtle` déléguée à WebCrypto de Bun, chargeur de modules sur celui de Bun, `bootstrap.js` évalué au démarrage du realm | `cargo check -p aphrody-page-runtime` vert ; `evaluate("1+1")`, `document.title` après `set_html`, `setTimeout` qui tire | 60 € ou 8 h ; ops non portés \= `throw` explicite listé dans `BROKEN.md` | 60 € |
| J1 | C · Moteur de navigation | `aphrody-browser` : fusion `obscura` \+ `obscura-browser`, retrait de tokio (`async fn` → fonctions bloquantes sur le thread du Worker, `tokio::sync` → `aphrody-threading`), cycle de vie, interception, capture ; thread Worker par `Browser`, réponses par `ConcurrentTask` | `cargo check -p aphrody-browser` vert avec les stubs A et B | 25 € ou 6 h | 25 € |
| J1 | D · Surfaces | `aphrody-browser-jsc` (`Browser.classes.ts`, `Page.classes.ts`, `Element.classes.ts`, `bun:browser`, `Bun.Browser`) ; sous-commande `bun browser {fetch,serve,scrape,mcp}` dans `aphrody-cli` ; `aphrody-cdp` sur `aphrody-uws` (domaines Target, Page, Runtime, DOM, Network d'abord) ; `aphrody-browser-mcp` sur `Bun.serve` | `cargo check` vert ; `bun browser fetch` et `Browser.launch()` câblés jusqu'au moteur | 25 € ou 6 h ; Fetch/IO/Storage/Input CDP et MCP HTTP en option | 25 € |
| J1 | E · DOM et rendu | `aphrody-dom` : cssparser 0.36, selectors 0.33 ; `aphrody-render` : `ureq` → `aphrody-http`, encodage PNG/JPEG par libspng/libjpeg-turbo (`image` toléré si le temps manque), vendors `taffy` et `cosmic-text` déplacés dans `vendor/` | `cargo check -p aphrody-dom -p aphrody-render` vert | 15 € ou 4 h | 15 € |
| J2 | Intégration (orchestrateur \+ 2 agents) | Fusion dans l'ordre J0 → B → C → A → E → D ; `bun run build:debug` complet ; correction par lots d'erreurs (un agent par lot de crates) ; fumigation : `bun browser fetch https://example.com --dump text`, `Browser.launch` depuis un script, `puppeteer.connect` sur `bun browser serve` ; `BROKEN.md` et tag `fusion-oneshot-1` | Binaire `bun` qui démarre et rend `example.com` ; liste exhaustive de ce qui est cassé | 25 € ou 8 h ; à l'échéance on livre l'état tel quel | 25 € |
| — | Réserve | Reprise d'un chantier interrompu | — | — | 5 € |

Règles du workflow dynamique, écrites dans `FUSION.md` et dans le prompt de chaque agent :

- Un agent, un chemin réservé dans .coord/claims, une ou deux crates ; il ne touche pas aux autres, il consomme leurs API via des stubs déclarés en J0 (`aphrody-browser-transport::Transport`, `aphrody-page-runtime::PageRuntime`).  
- Boucle de vérification \= `cargo check -p <crate>` ; jamais `cargo build` complet, jamais de build WebKit (l'`autobuild` précompilé est dans le cache dès J0), jamais de tests de bout en bout avant J2.  
- Interdits : importer tokio, reqwest, hyper, rustls, ring, wreq, tungstenite, tracing, clap, deno\_core, v8 ; réécrire `bootstrap.js` (seul l'alias `Deno.core` compte) ; reformater des fichiers non modifiés.  
- Ce qui ne passe pas dans le budget devient un stub qui renvoie `Err("non porté : <quoi>")` ou un `throw` JS explicite, plus une ligne dans `BROKEN.md` (quoi, où, pourquoi, piste). Pas de `todo!()` ni de `unimplemented!()` : ils sont `deny` dans les lints de Bun et abortent en `panic = "abort"`.  
- Un commit par heure au moins, message préfixé par le chantier ; l'orchestrateur relève les plafonds, pas les agents.  
- Les tests Obscura sont copiés mais placés sous `#[cfg(feature = "legacy-tests")]` : ils ne bloquent ni la compilation ni le budget ; leur réactivation est le premier travail d'après one shot.

Fumigation minimale qui définit « livré » :

1. `bun browser fetch https://example.com --dump text` affiche le texte de la page.  
2. `bun -e 'const b = await Bun.Browser.launch(); const p = await b.newPage(); await p.goto("https://example.com"); console.log(await p.evaluate("document.title"))'` affiche `Example Domain`.  
3. `bun browser serve --port 9222` accepte `puppeteer.connect` et `page.goto` \+ `page.evaluate` sur une page statique.  
4. `bun browser fetch https://news.ycombinator.com --dump links` renvoie des liens (scripts inline exécutés).  
5. Capture d'écran PNG d'`example.com` non vide (si E a abouti ; sinon dans `BROKEN.md`).

## Le dépôt `aphrody` comme cible : remise à niveau d'Obscura, ajout de Bun, retrait de V8

`aphrody-labs/aphrody` contient déjà presque tout : 265 manifests Cargo, \~1,17 million de lignes de Rust, resolver 3, edition 2024, les crates Obscura (`crates/web/obscura-*`, paquet racine `aphrody-obscura`), Tauri 3.0.0-alpha.4 complet (`aphrody-tauri`, `aphrody-tauri-runtime`, `-runtime-wry`, `-runtime-cef`, `aphrody-wry`, `aphrody-tao`, 30 plugins, CLI, bundler) et les crates d'indexation `aphrody-web-*`. Il ne lui manque que Bun ; il a en trop V8 et un stable incompatible avec Bun.

| Composant | État dans `aphrody` au 5 octobre | Action | Quand |
| :---- | :---- | :---- | :---- |
| Obscura | Copie plus ancienne que l'upstream et patchée localement : 144 entrées différentes par rapport au fork `aphrody-labs/obscura`, `obscura-js` 29 500 lignes contre 36 200 upstream ; tokio 1.53, reqwest 0.13 | 1\) fast-forward du fork sur `h4ckf0r0day/obscura` (`1fccab2`, aucun commit local : `merge --ff-only`) ; 2\) diff trois voies copie / commit d'import / fork à jour, les hunks Aphrody vont dans `patches/obscura/` ; 3\) la copie est remplacée par le fork à jour \+ patches rejoués (`git apply --3way`), renommage `aphrody-browser`, `aphrody-page-runtime`, `aphrody-dom`, `aphrody-render`, `aphrody-browser-transport`, `aphrody-cdp`, `aphrody-browser-mcp` | J0 (étapes 1-2), J1 (étape 3 par chantier) |
| Bun-Rust | Absent ; vit dans `aphrody-labs/bun` branche `yolo` (105 crates, nightly `2026-09-15`, `-Zbuild-std`, lien ninja \+ WebKit) | Import sous `crates/bun/<nom>` avec le préfixe `aphrody-` (script de renommage), `[workspace.dependencies]` fusionnées, `scripts/build.ts` \+ `scripts/build/rust.ts` \+ `scripts/build/deps/*.ts` de Bun portés dans `scripts/build/bun/` ; le binaire `bun` est produit par ce script (profil `panic = "abort"` injecté par variables `CARGO_PROFILE_*`, pas par le profil du workspace) | J0 |
| Toolchain | Stable 1.98.1, `profile = "minimal"`, cibles Windows/macOS/wasm | Passage de tout le dépôt au nightly `2026-09-15` avec `rust-src`, `miri`, `llvm-tools` et les 11 cibles de Bun ; `cargo check --workspace` d'Aphrody rejoué avant tout autre changement, nouveaux lints corrigés par `#[allow]` ciblés | J0, première heure, condition de poursuite |
| V8 / deno\_core | Dans `obscura-js` (snapshot au build) et, selon `GOAL.md`, « moteur des surfaces applicatives, conservé jusqu'à la parité Obscura/JSC » | Retrait par le chantier B (runtime de page sur `aphrody-jsc`) ; `GOAL.md` et `PLAN.md` mis à jour en J0 pour consigner la décision ; aucune autre crate d'`aphrody` ne dépend de `v8` ou `deno_core` (à confirmer par `cargo tree -i v8` en J0) | J1 · B |
| Tauri 3 alpha | Complet, y compris `aphrody-tauri-runtime-cef` (20 400 lignes, build CEF lourd) et 30 plugins | Conservé tel quel ; `default-members` exclut CEF, les exemples, les plugins mobiles (barcode, biometric, haptics, nfc, geolocation) et `aphrody-tauri-cli` du build par défaut ; `aphrody-tauri-runtime` devient l'abstraction du mode graphique (section suivante) | J0 |
| Crates d'indexation `aphrody-web-*` | Présentes (`web-crawl` 4 795 lignes avec `crawl_daemon` 24/7 et frontier SQLite, `web-extract` 6 767, `web-index` HNSW 4 234, `web-detect`, `web-frames`, `web-chromium`, `x`) ; tokio, reqwest, rusqlite | Inchangées pendant le one shot 1 ; leur bascule sur `aphrody-http`, `aphrody-event-loop` et les stores natifs de Bun est le one shot 2 (section Service d'indexation) ; `web-engine` et `web-bridge` sont supprimées à la fin du one shot 1 (remplacées par `bun browser` et `bun:browser`) | One shot 2 |
| `aphrody-sql` (`crates/infra/sql`) | Postgres par tokio-postgres \+ deadpool \+ rustls, SQLite par rusqlite | Collision de nom avec `bun_sql` renommée : la crate de Bun (`Bun.sql`, native) prend `aphrody-sql`, `infra/sql` devient `aphrody-sql-legacy` puis disparaît au one shot 2 | J0 (renommage), one shot 2 (retrait) |
| Lints | `[workspace.lints]` d'Aphrody ; Bun apporte `clippy.toml` (interdits `std::fs`, `HashMap`, `println!`…) et `unreachable_pub`/`dead_code` en `deny` | Un seul `clippy.toml` : celui de Bun, mais ses `disallowed_*` passent en `allow` dans `[workspace.lints]` et en `deny` dans les `[lints]` propres des crates `crates/bun/*` ; les crates Obscura importées restent en `#![allow(clippy::all)]` | J0 |

Deux conséquences de structure à assumer : `cargo check --workspace` d'Aphrody devient nettement plus lourd (Bun ajoute 1 528 fichiers Rust et des crates `*_sys` qui compilent du C via `cc`) ; `default-members` et sccache (déjà en place via `cargo-serial.sh`) sont la seule parade. Et le binaire `bun` n'est pas une cible `cargo` ordinaire : sa production reste un script (`bun run build:bun` à ajouter au `package.json` racine, recette `just bun`), ce qui est cohérent avec le modèle Yolo « runtime précompilé » de `GOAL.md`, à ceci près que le producteur devient le dépôt `aphrody` lui-même.

## Service d'indexation 24/7 (one shot 2\)

Le binaire `bun` fusionné tourne en service système autonome, `bun crawl daemon`, qui indexe le web en continu vers SQLite, Postgres ou Redis par les API natives de Bun (`bun:sqlite`, `Bun.sql`, `Bun.redis`), sans autre processus (Bun.sql parle aussi MySQL, en bonus) : avec SQLite il n'a besoin de rien d'autre que le disque (« full serverless ») ; Postgres et Redis sont des URL optionnelles. Le cœur existe déjà dans `aphrody-web-crawl` (`crawl_daemon`, frontier, revisites, robots, sitemaps) ; le one shot 2 le débranche de tokio, reqwest et rusqlite et le branche sur le moteur fusionné et les stores de Bun.

| Couche | Aujourd'hui (`aphrody-web-*`) | Cible | Travail |
| :---- | :---- | :---- | :---- |
| Transport des pages | `CrawlTransport` implémenté par `ObscuraTransport` sur `obscura-net` \+ reqwest | `CrawlTransport` sur `aphrody-browser` : mode statique (HTTP seul, `aphrody-http`) et mode rendu (realm JSC, scripts exécutés) choisi par règle d'hôte ou détection `aphrody-web-detect` | A2 |
| Boucle | `crawl_daemon` async tokio (`idle_poll_ms` 1 s, maintenance 10 s) | Même algorithme, exécuté par un script TS interne compilé dans le binaire (`src/js/crawl/daemon.ts`, comme les modules internes de Bun) qui orchestre N Workers `bun:browser` ; les fonctions Rust (score de frontier, revisite, robots, sitemaps, extraction de liens) sont exposées dans un module natif `bun:web` | B2 |
| Frontier et pages | Tables `requests`, `hosts`, `pages` dans SQLite via rusqlite (second SQLite embarqué) | Trait `FrontierStore` (`lease`, `complete`, `fail`, `add`, `stats`, `maintenance`) avec trois implémentations TS : `bun:sqlite` (même schéma, WAL, `VACUUM INTO` pour les sauvegardes), `Bun.sql` (Postgres, `SKIP LOCKED` pour les baux, `pgvector` pour les plongements), `Bun.redis` (listes triées par score, `SET NX` pour les baux, hash par page) | C2 |
| Extraction et index | `aphrody-web-extract` (Markdown, chunks, SimHash), `aphrody-web-index` (HNSW int8 mmap) | Inchangés, exposés dans `bun:web` ; l'index HNSW reste un fichier mmap à côté de la base, Postgres garde en plus `pgvector` | B2 |
| Service système | `config/host/systemd/aphrody/aphrody-web-api.service` existe pour l'API ; rien pour le crawl | Unité `aphrody-crawl.service` : `Type=notify` (sd\_notify par écriture directe sur `NOTIFY_SOCKET`), `Restart=always`, `WatchdogSec=120`, `MemoryMax`, `IOWeight`, `DynamicUser`, `StateDirectory=aphrody-crawl` ; arrêt propre sur SIGTERM (baux rendus, WAL checkpoint) ; déclarée dans le catalogue Infra (`config/host/`), pas à la main | D2 |
| Gouvernance | `CrawlOptions` (concurrence, profondeur, nofollow) | Budget par hôte (délai de politesse, `Crawl-delay`), plafonds globaux (requêtes/s, bande passante, pages/jour, octets sur disque), quotas par famille de domaines, liste de refus SSRF partagée, `User-Agent` déclaré avec URL de contact ; tout dans `bunfig.toml` `[crawl]` et surchargeable par variables d'environnement | B2 |
| Observabilité | logs | `Bun.serve` local (`127.0.0.1:9333`) : `/healthz`, `/metrics` (format Prometheus : pages/s, taille de frontier, erreurs par classe, latence par hôte), `/frontier/top` ; journal structuré via `aphrody-output` | D2 |
| Reprise et intégrité | Verrous périmés récupérés par la maintenance | Idempotence par `content_hash` \+ SimHash, baux avec expiration, redémarrage sans perte (SQLite WAL, transactions Postgres, `AOF` conseillé côté Redis), sauvegarde périodique `VACUUM INTO` vers `StateDirectory/backups` | C2 |

Commande et configuration visées :

\# SQLite seul, aucun service externe

bun crawl daemon \--store sqlite:///var/lib/aphrody-crawl/frontier.db \--seeds seeds.txt \--workers 16

\# Postgres ou Redis par URL

bun crawl daemon \--store postgres://crawl@db/aphrody \--render auto

bun crawl daemon \--store redis://127.0.0.1:6379/2

\# Installation comme service (écrit l'unité depuis le catalogue Infra)

bun crawl install-service \--user aphrody-crawl

\[crawl\]

store \= "sqlite:///var/lib/aphrody-crawl/frontier.db"

workers \= 16

render \= "auto"            \# static | render | auto (détection SPA)

max\_pages\_per\_day \= 2\_000\_000

max\_bandwidth\_mbps \= 200

max\_disk\_gb \= 500

per\_host\_delay\_ms \= 1\_000

user\_agent \= "AphrodyBot/1.0 (+https\://aphrody.com/bot)"

respect\_robots \= true

allow\_private\_network \= false

Format du one shot 2 : même méthode (J0 \+ 4 chantiers A2–D2 \+ intégration), budget à fixer (ordre de grandeur 100 à 150 € : les crates existent, c'est un rebranchement), fumigation \= 1 h de crawl continu sur 50 domaines de test avec SQLite, redémarrage brutal au milieu, aucune page perdue ni dupliquée, `/metrics` cohérent avec la base. Prérequis : one shot 1 livré (le `CrawlTransport` rendu dépend du realm JSC).

## Mode crawl graphique (one shot 3\)

Le même binaire bascule en `bun crawl --gui` : une fenêtre Tauri (les crates `aphrody-tauri-runtime` \+ `aphrody-tauri-runtime-wry` \+ `aphrody-wry` \+ `aphrody-tao` déjà dans `aphrody`) affiche en direct ce que le moteur Obscura/JSC crawle, avec les commandes du daemon. Règle de sélection stricte : **un seul moteur de page, un seul système de fenêtres, aucun second moteur de rendu web**, pour que le mode graphique n'ajoute aucun build lourd.

| Brique | Retenue | Écartée (et pourquoi) |
| :---- | :---- | :---- |
| Moteur de page | Obscura sur JSC, dans le process, le même qu'en mode service | `aphrody-tauri-runtime-cef` (20 400 lignes, téléchargement et lien de CEF : le build lourd par excellence) ; Chrome externe (`ChromeBackend`) |
| Fenêtre et webview | `aphrody-tauri-runtime-wry` : WKWebView, WebView2, webkit2gtk (bibliothèques système, aucune compilation de moteur) | Toute webview embarquée ; `Bun.WebView` WKWebView en process hôte reste pour l'automatisation macOS seulement |
| Affichage des pages crawlées | Flux `Page.startScreencast` d'`aphrody-cdp` (JPEG/PNG par frame) affiché dans une page locale de la webview ; pas de rendu de la page distante par la webview système | Charger l'URL distante dans la webview (second moteur, seconde pile réseau, fuite de cookies hors de la jarre Obscura) |
| IPC | Commandes Tauri (`invoke`) vers le daemon : pause, reprise, priorité d'un hôte, injection de graines, inspection d'une page (DOM, Markdown extrait, liens), capture ; forme `IpcMessage` du `tauri.d.ts` existant | Serveur HTTP local pour l'UI (une seconde surface à sécuriser) |
| Interface | `m3/packages/app-ui` (canonique selon le `CLAUDE.md` d'Aphrody), servie en `bun://localhost` par le bundler du binaire | Un nouveau front ou un framework supplémentaire |
| Plugins Tauri | `window-state`, `single-instance`, `dialog`, `opener`, `os`, `log`, `process` (déjà `workspace.dependencies`) | Les 23 autres restent hors `default-members` ; plugins mobiles jamais compilés |
| Build | Feature `gui` du binaire, **off par défaut** ; `bun run build:bun --gui` ajoute wry/tao et les plugins retenus ; le service 24/7 est livré sans | Lier wry/tao dans le binaire serveur (dépendances GTK sur un serveur Linux sans affichage) |

Architecture d'exécution : le daemon ne change pas (Workers `bun:browser`, `FrontierStore`), la GUI est un client de plus. Le process hôte de webview existant (`BUN_INTERNAL_WEBVIEW_HOST`) exécute la boucle tao sur son thread principal ; le script `bun crawl --gui` lance le daemon puis l'hôte, et les deux parlent par le protocole `ipc_protocol.h` étendu aux `invoke`. Sur un poste sans webkit2gtk (Linux minimal), `--gui` échoue proprement avec le message d'installation au lieu de retomber sur un moteur embarqué : c'est le prix de la règle « aucun build lourd ».

Ce que l'utilisateur voit : grille des Workers avec la frame courante de chaque page (screencast à 2 images/s, réglable), file de frontier par hôte avec scores, courbes `/metrics` (pages/s, erreurs, latence), inspecteur d'une page (Markdown extrait, liens, SimHash, voisins HNSW), boutons pause/reprise/priorité, et un mode « pilotage » où un clic dans la frame envoie `Input.dispatchMouseEvent` à la page (le même CDP que Puppeteer).

Format du one shot 3 : même méthode, budget à fixer (ordre de grandeur 100 à 200 €), prérequis : one shot 1 (CDP in-process) et one shot 2 (daemon). Fumigation : `bun crawl --gui` ouvre une fenêtre sur Linux x86\_64 avec webkit2gtk, affiche 4 Workers en direct, une pause/reprise, un clic piloté ; taille du binaire `--gui` mesurée contre le binaire serveur (attendu : quelques Mo d'écart, pas des dizaines).

## Tout site crawlé devient une app Tauri complète

`bun crawl app <domaine>` transforme ce que le daemon a déjà indexé en application de bureau Tauri installée, signée et empaquetée, sans ligne de code écrite par l'utilisateur. Tout le nécessaire existe dans `aphrody` : `mirror_site` et la frontier de `aphrody-web-crawl` (contenu et graphe de liens), `aphrody-web-extract` (Markdown, médias), `aphrody-web-index` (recherche locale), `aphrody-create-tauri-app` (génération de projet), `aphrody-tauri-bundler` (installateurs), `aphrody-tauri-wrap` (plugin web-to-tauri existant : fenêtre Tauri 3 autour d'un site avec politique de navigation, téléchargements, serveur loopback et sidecar) et les plugins Tauri déjà présents.

| Étape du générateur | Source dans le workspace | Résultat dans l'app |
| :---- | :---- | :---- |
| Capture du site | `mirror_site` \+ table `pages` de la frontier (HTML, Markdown, `content_hash`, SimHash), médias résolus par `web-extract` | Miroir hors ligne servi en `bun://localhost`, mis à jour par le daemon selon la politique de revisite |
| Identité | `<title>`, manifeste web, favicon et icônes `apple-touch-icon`, couleur de thème, langue | `tauri.conf.json` généré (`productName`, `identifier` dérivé du domaine, icônes converties par les codecs de Bun, fenêtre initiale aux dimensions observées) |
| Mode d'exécution | Choix par site, modifiable : **hors ligne** (miroir seul), **hybride** (miroir \+ rafraîchissement par le moteur Obscura/JSC avec la jarre à cookies et le mode stealth), **en direct** (navigateur dédié au site, type « site-specific browser », navigation confinée au domaine et à sa liste d'autorisation) | Toujours le même moteur de page ; la webview système n'affiche que le miroir local ou le screencast, jamais le site distant directement |
| Fonctions natives | Plugins déjà dans `crates/tauri/*` : `window-state`, `single-instance`, `deep-link` (le domaine devient un schéma ou un gestionnaire d'URL), `notification` (changement détecté par la revisite), `global-shortcut`, `clipboard-manager`, `opener`, `updater` | Fenêtre persistante, instance unique, ouverture des liens du domaine dans l'app, notifications, raccourcis, mises à jour de l'app elle-même |
| Recherche et lecture | `aphrody-web-index` (HNSW) sur les chunks du site, Markdown de `web-extract` | Recherche instantanée hors ligne, mode lecture, historique local, tout en `bun:sqlite` dans le dossier de l'app |
| IPC et permissions | Commandes `invoke` (`search`, `refresh`, `open`, `history`, `export`) ; liste `commands` dans la config générée, `allow-*`/`deny-*` implicites comme Tauri 3 ; CSP restreinte au domaine et à `bun://localhost` | Pages distantes sans accès privilégié à Bun ou à l'hôte (règle du `CLAUDE.md` d'Aphrody) |
| Empaquetage | `aphrody-tauri-bundler` appelé dans le process (`.deb`, `.rpm`, AppImage, `.msi`/NSIS, `.dmg`/`.app`), `aphrody-tauri-macos-sign` si certificat | Installateur par plateforme ; sans toolchain Rust côté utilisateur : l'app embarque le binaire `bun --gui` précompilé et le miroir, le générateur n'invoque jamais `cargo` |

Le point qui évite les builds lourds : une app générée n'est pas compilée, elle est **assemblée**. Le binaire `bun --gui` (wry/tao, feature `gui`) est le même pour toutes les apps ; seuls changent le miroir, la configuration, les icônes et l'identifiant. `aphrody-create-tauri-app` sert de modèle de projet pour ceux qui veulent ensuite personnaliser l'app en vrai projet Tauri (`bun crawl app <domaine> --eject` écrit le projet Rust \+ `m3/packages/app-ui`).

bun crawl app docs.example.com \--mode hybrid \--out ./apps/docs-example

bun crawl app news.example.com \--mode live \--allow "\*.example.com" \--notify changes

bun crawl app wiki.example.org \--mode offline \--bundle deb,appimage

Limites assumées : les sites qui exigent une connexion gardent la session dans la jarre à cookies chiffrée de l'app (`stronghold` ou `Bun.secrets`), pas dans le miroir ; les contenus sous DRM ou pay-wall ne sont pas capturés ; les termes d'utilisation du site restent à la charge de l'utilisateur et `respect_robots` reste actif par défaut. Place dans le temps : one shot 3 bis, après le mode graphique (il en réutilise la feature `gui` et l'IPC).

## Plugins natifs : un noyau `bun` léger, les chaînes lourdes à côté

Le binaire `bun` fusionné ne contient que ce qui doit tourner 24/7 : runtime JSC, moteur de page Obscura, crawl, stores natifs, CDP/MCP. Tout ce qui est une **chaîne de build** (Tauri complet, Next.js 16 avec Turbopack et SWC, CEF, signature macOS…) vit dans des plugins natifs versionnés, chargés à la demande par le même binaire, sans jamais le saturer. Aphrody a déjà le précédent : `aphrody-bun` (`crates/ui/bun`, rendu M3, SVG, polices) est un plugin Rust pour Bun via `bun:ffi`, avec sa façade TS dans `packages/interop/native`.

| Décision | Choix | Pourquoi |
| :---- | :---- | :---- |
| Frontière noyau / plugin | Dans le noyau : ce qui sert à l'exécution et au crawl. En plugin : toute chaîne de compilation, tout moteur optionnel, toute intégration tierce lourde | Taille et temps de build du binaire serveur constants ; un plugin cassé ne casse pas le daemon |
| ABI de plugin | N-API (modules `.node` produits par `napi-rs`), que Bun charge nativement, plutôt que `bun:ffi` | ABI stable entre versions de Bun, types riches (promesses, buffers, callbacks), même mécanisme que l'écosystème Node ; `bun:ffi` reste pour les petites fonctions C comme aujourd'hui dans `aphrody-bun` |
| Forme d'un plugin | Une crate `crates/plugins/<nom>` (`cdylib` \+ `napi`) et un paquet `@aphrody/plugin-<nom>` (façade TS, types, binaire par plateforme en `optionalDependencies`, comme `bun-build-mdx-rs` déjà présent dans le fork Bun) | Distribution par le registre npm privé d'Aphrody ou par fichier ; versionné indépendamment du noyau |
| Chargement | `bun plugin add tauri` télécharge l'artefact signé (Ed25519, clé Aphrody) dans `~/.bun/plugins/<nom>/<version>/` ; `bun tauri …` et `import { build } from "@aphrody/plugin-tauri"` le chargent ; mode hors ligne par cache local ou `--plugin-dir` | Pas d'installation système, pas de dépendance externe au binaire ; vérification d'intégrité avant `dlopen` |
| Contrat | `aphrody_plugin_manifest()` : nom, version, ABI (`v1`), version minimale de `bun`, commandes CLI exposées, permissions demandées (réseau, fichiers, sous-processus) | Le noyau refuse un plugin dont l'ABI ou les permissions ne correspondent pas ; même logique `allow-*`/`deny-*` que Tauri 3 |
| Build | `crates/plugins/*` hors `default-members` ; chaque plugin a sa recette `just plugin::<nom>` et son cache sccache ; jamais compilé par `bun run build:bun` | Un `cargo check --workspace` qui reste tenable ; les chaînes lourdes (Turbopack, CEF) ne se construisent que quand on les publie |

Premiers plugins, par ordre de valeur :

| Plugin | Contenu (déjà dans le workspace) | Ce qu'il apporte à `bun` | Poids évité dans le noyau |
| :---- | :---- | :---- | :---- |
| `@aphrody/plugin-tauri` | `aphrody-tauri-cli` (27 900 lignes), `aphrody-tauri-build`, `-codegen`, `-bundler` (10 300), `-macos-sign`, `-schema-generator`, `aphrody-create-tauri-app` | `bun tauri init / dev / build / bundle / sign`, `bun crawl app … --eject` ; construit une app Tauri complète depuis un projet Bun sans Rust installé côté utilisateur (runtime wry précompilé fourni par le plugin) | \~45 000 lignes et leurs dépendances (handlebars, zip, signature, icns) |
| `@aphrody/plugin-next` | Turbopack \+ SWC depuis le fork `aphrody-labs/next.js` (crates `turbopack-*`, `swc_core`), `aphrody-oxc-bridge` pour le pont avec le transpileur de Bun | `bun next dev / build` pour Next.js 16 avec Turbopack natif, sans `node_modules/@next/swc-*` | Turbopack et SWC comptent parmi les plus gros graphes Rust de l'écosystème ; jamais dans le noyau |
| `@aphrody/plugin-cef` | `aphrody-tauri-runtime-cef` (20 400 lignes) \+ téléchargement de CEF | Runtime Chromium embarqué pour les apps qui l'exigent | Le build CEF, exclu partout ailleurs |
| `@aphrody/plugin-ml` | `crates/ml/*`, `crates/ai/*` (inférence locale, plongements pour `aphrody-web-index`) | Plongements et classification des pages crawlées, en option | Modèles et noyaux d'inférence |
| `@aphrody/plugin-x`, `@aphrody/plugin-discord` | `aphrody-x`, `crates/discord/*` | Connecteurs spécialisés | Clients d'API tiers |

Le schéma se répète à l'identique pour toute nouvelle chaîne : une crate `cdylib` N-API sous `crates/plugins/`, une façade `@aphrody/plugin-*`, une recette `just plugin::*`, une entrée dans le manifeste. Le noyau n'apprend rien de nouveau : il charge, vérifie, expose la commande. Place dans le temps : le mécanisme (chargeur, manifeste, signature, `bun plugin add`) entre dans le one shot 2 ; `plugin-tauri` dans le one shot 3 ; `plugin-next` quand le fork `next.js` est aligné sur le nightly de Bun.

### Plugin `@aphrody/plugin-wgpu` : rendu 3D web et desktop depuis un seul fichier Bun

Un plugin N-API complet autour de wgpu, pour qu'un unique `scene.ts` exécuté par `bun` rende la même scène 3D dans une fenêtre native, hors écran (image, vidéo, serveur) ou dans un navigateur par WebGPU. Aphrody a déjà la base : `wgpu 30.0.1` en `workspace.dependencies`, `aphrody-gpu-backend` (instance, adaptateur, device et configuration de surface partagés), la feature `gpu` d'`aphrody-render` (pipeline wgpu hors écran), `glam`, et `aphrody-wry` qui traîne un `wgpu 23` à aligner.

| Aspect | Choix | Détail |
| :---- | :---- | :---- |
| API exposée à JS | **L'API WebGPU standard** (`navigator.gpu`, `GPUDevice`, `GPUBuffer`, `GPUShaderModule` en WGSL, `GPURenderPipeline`, `GPUCanvasContext`), implémentée sur wgpu | Le même fichier tourne tel quel dans Chrome/Safari (WebGPU natif) et dans `bun` (plugin) ; pas d'API propriétaire à apprendre ; les bibliothèques three.js/Babylon en mode WebGPU fonctionnent sans adaptateur |
| Surfaces | `GPUCanvasContext` branché sur : une fenêtre tao (`raw-window-handle`, via `aphrody-tauri-runtime` ou direct), une texture hors écran (lecture en `Uint8Array`, encodage PNG/JPEG/WebP par les codecs de Bun, flux vidéo), ou une webview Tauri par partage de texture quand la plateforme le permet (DMA-BUF, IOSurface, DXGI) sinon par blit | Un seul code de scène ; la cible est un paramètre (\`createSurface({ kind: "window" |
| Noyau commun | `aphrody-gpu-backend` devient l'unique point de création d'instance/device, partagé par le plugin, `aphrody-render --features gpu`, `aphrody-wry` (bump 23 → 30\) et IECODE | Une seule version de wgpu dans le workspace, un seul device par process, adaptateurs énumérés une fois |
| Boucle de rendu | `requestAnimationFrame` fourni par le plugin, cadencé sur la vsync de la fenêtre ou sur une horloge fixe hors écran ; entrées (souris, clavier, redimensionnement) remontées comme `Event` DOM standard | Les scènes écrites pour le navigateur gardent leur boucle |
| Shaders | WGSL natif (naga dans wgpu) ; SPIR-V et GLSL acceptés par naga en entrée ; compilation et validation hors ligne : `bun wgpu check shader.wgsl` | Mêmes erreurs que le navigateur, plus tôt |
| Calcul | `GPUComputePipeline` complet : plongements pour `aphrody-web-index`, traitement d'images des pages crawlées, inférence légère avec `plugin-ml` | Le GPU sert aussi au crawl, pas seulement à l'affichage |
| Backends | Vulkan, Metal, DX12, GL (repli), et le backend WebGPU de wgpu pour la cible wasm des mêmes crates | Linux serveur sans GPU : repli logiciel lavapipe si présent, sinon erreur claire ; jamais de blocage du daemon |
| Poids et build | Hors du noyau `bun` : wgpu \+ naga \+ backends pèsent plusieurs Mo et compilent longtemps ; crate `crates/plugins/wgpu` (`cdylib` N-API), hors `default-members` | Le binaire serveur n'embarque rien du GPU ; `bun plugin add wgpu` suffit |

Un seul fichier, trois cibles :

// scene.ts — tourne dans bun (plugin wgpu) et dans un navigateur WebGPU

import { createSurface } from "@aphrody/plugin-wgpu"; // no-op dans le navigateur : renvoie le \<canvas\>

const surface \= await createSurface({ kind: Bun.argv.includes("--window") ? "window" : "offscreen", width: 1280, height: 720 });

const adapter \= await navigator.gpu.requestAdapter();

const device \= await adapter\!.requestDevice();

const ctx \= surface.getContext("webgpu")\!;

ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });

const pipeline \= device.createRenderPipeline({ layout: "auto", vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs" }, fragment: { module: device.createShaderModule({ code: wgsl }), entryPoint: "fs", targets: \[{ format: ctx.getCurrentTexture().format }\] } });

function frame() {

  const enc \= device.createCommandEncoder();

  const pass \= enc.beginRenderPass({ colorAttachments: \[{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }\] });

  pass.setPipeline(pipeline); pass.draw(3); pass.end();

  device.queue.submit(\[enc.finish()\]);

  requestAnimationFrame(frame);

}

frame();

// bun scene.ts \--window        → fenêtre native

// bun scene.ts \> frame.png     → hors écran (surface.readPixels())

// bun build scene.ts \--target=browser → WebGPU dans la page

Liens avec le reste du plan : la GUI du crawl (`bun crawl --gui`) peut afficher ses frames de screencast dans une texture wgpu au lieu d'une balise `<img>`, et `aphrody-render --features gpu` donne à Obscura un chemin de peinture GPU pour les captures lourdes. Place dans le temps : plugin propre (one shot « wgpu », ordre de grandeur 100 à 150 €), après le mécanisme de plugins du one shot 2 ; prérequis technique à régler en premier : une seule version de wgpu dans le workspace (bump d'`aphrody-wry`).

## Base commune du monorepo : scripts, CI, Docker, documentation

Aphrody est refactorisé sur une base unique qui prend à chacun des quatre dépôts ce qu'il fait le mieux : à Bun le système de build et de dépendances épinglées, à Obscura la CI de PR en trois étages et l'image Docker distroless, à Tauri la gestion des versions multi-crates, à wgpu la tâche unique `xtask` et la matrice par backend. Aphrody n'a aujourd'hui que deux workflows (`update.yml` hebdomadaire, `inline-interpreters.yml`), aucun Dockerfile, des scripts par domaine et une doc riche mais dispersée (`docs/*.md` racine \+ `docs/<domaine>`).

| Brique | Pris à | Ce qui est repris | Où dans `aphrody` |
| :---- | :---- | :---- | :---- |
| Build natif | Bun | `scripts/build.ts` \+ `scripts/build/{config,profiles,flags,rust,deps/*.ts}` : chaque dépendance C/C++ épinglée par commit et récupérée au build, profils `debug`/`release`/`release-asan`, `--lto`, `--pgo-*`, plan cargo par `--unit-graph`, ninja pour le lien | `scripts/build/bun/` (noyau) et `scripts/build/plugins/` (une entrée par plugin) ; `cargo-serial.sh` reste le garde-fou de sérialisation |
| Dépendances vendorisées | Bun | `vendor/` hors `members`, scripts `deps/*.ts`, bots `update-<dep>.yml` qui ouvrent une PR par bump | `vendor/{lolhtml,taffy,cosmic-text,…}` \+ `config/upstream-sources.json` existant comme registre de provenance |
| Toolchain | Bun | `rust-toolchain.toml` nightly épinglé, fork `rust` `nightly-2026-09-15-bun` PGO/BOLT (`BUN_TOOLCHAIN_RUST`), `rust:check-all` sur toutes les cibles | Un seul `rust-toolchain.toml` à la racine ; `just rust::check-all` |
| Lints | Bun \+ Obscura | `clippy.toml` (interdits), `rust-lints.yml`, `source-lints.yml`, `format.yml` (oxfmt/oxlint/clang-format) ; `deny.toml` d'Obscura (licences, advisories, doublons) | `clippy.toml`, `deny.toml`, `oxlint.json` à la racine ; `xtask lint` les enchaîne |
| Tâche unique | wgpu | `cargo xtask` : une crate `xtask/` qui porte `lint`, `deny`, `docs`, `test --backend`, `bench`, au lieu de scripts shell épars | `xtask/` ; `just` délègue à `xtask` et à `scripts/build/bun/` |
| CI de PR | Obscura | Trois étages : `PR / Policy` (règles de PR, `scripts/ci/pr_policy.py`), `PR / Core` (build \+ tests), `PR / Performance` (`perf_smoke`, comparaison d'obstacles avec artefacts et commentaire de PR) | `.github/workflows/ci.yml` ; Performance publie taille du binaire (`binary-size.ts` de Bun), temps de démarrage (`hyperfine`), latence `fetch` |
| Matrice de release | Obscura \+ Bun | Obscura : matrice `x86_64/aarch64 linux`, `x86_64/aarch64 macOS`, `x86_64 windows`, variantes par features, profil `release-dist`, archives \+ checksums ; Bun : signature GPG, publication npm par plateforme (`packages-ci.yml`), `freebsd-smoke.yml` | `release.yml` : noyau `bun` par cible \+ un artefact par plugin et par cible \+ installateur `install.sh`/`install.ps1` déjà décrit dans `docs/DISTRIBUTION.md` (vérification SHA-256, `~/.yolo`) |
| Versions multi-crates | Tauri | Changesets `covector` : un fichier par changement, versions et changelogs par crate générés, publication groupée | `.changes/` \+ `covector.config.json` ; remplace `scripts/changelog.config.mjs` |
| Docker | Obscura \+ Bun | Obscura : builder `rust:1-slim-bookworm` avec cache des manifests (stubs `lib.rs`), image finale `distroless/cc:nonroot` (\~57 Mo, uid 65532, port publié sur loopback) ; Bun : variantes `debian`, `debian-slim`, `alpine`, `distroless` avec `docker-entrypoint.sh`, publication buildx multi-arch (`docker.yml`, QEMU) | `docker/` : `Dockerfile.build` (noyau \+ plugins), images `aphrody/bun` (noyau), `aphrody/crawl` (noyau \+ plugins obscura et crawl, `StateDirectory` montée), `aphrody/gui` jamais (desktop hors Docker) |
| Documentation | Bun \+ Obscura | Bun : `docs/` en MDX avec `docs.json`, guides par tâche, `AGENTS.md`/`CLAUDE.md` à la racine ; Obscura : `SUMMARY.md` GitBook, un fichier par tâche (`Your-first-fetch.md`, `Use-with-Puppeteer.md`), `Architecture-overview.md`, `Environment-variables.md` | `docs/` unique en MDX : `docs/runtime` (Bun), `docs/browser` (Obscura), `docs/crawl`, `docs/desktop` (Tauri), `docs/gpu` (wgpu), `docs/architecture` (existant) ; les `docs/*.md` datés de la racine passent sous `docs/architecture/history/` |
| Agents et conventions | Les quatre | `AGENTS.md`, `CLAUDE.md`, `REVIEW.md` de Bun ; `AGENTS.md` d'Obscura ; `CLAUDE.md` d'Aphrody (claims, Cargo sérialisé, identité des commits) | Un `AGENTS.md` racine fusionné, `CLAUDE.md` qui le référence, `REVIEW.md` repris pour les critères de merge |

Arborescence cible :

aphrody/

├─ Cargo.toml                 \# workspace unique, default-members \= noyau \+ crates légères

├─ rust-toolchain.toml        \# nightly-2026-09-15 (fork rust de Bun)

├─ clippy.toml  deny.toml  oxlint.json  covector.config.json

├─ Justfile                   \# just bun / plugin::\<nom\> / ci / docker

├─ xtask/                     \# lint, deny, docs, test \--backend, bench

├─ crates/

│  ├─ bun/        aphrody-runtime, \-jsc, \-http, \-event-loop, … (ex bun\_\*)

│  ├─ web/        aphrody-browser, \-page-runtime, \-dom, \-render, \-cdp, web-crawl, …

│  ├─ tauri/      aphrody-tauri\*, \-wry, \-tao, plugins

│  ├─ gpu/        aphrody-gpu-backend, aphrody-render (feature gpu)

│  ├─ plugins/    obscura, crawl, tauri, next, cef, wgpu, ml … (cdylib N-API, hors default-members)

│  └─ ai/ os/ ui/ … (inchangés)

├─ vendor/                    \# pins récupérés par scripts/build/deps/\*.ts, hors members

├─ scripts/

│  ├─ build/bun/   build.ts, config.ts, profiles.ts, flags.ts, rust.ts, deps/\*.ts

│  ├─ build/plugins/\<nom\>.ts

│  ├─ build/rust/  cargo-serial.sh (garde-fou existant)

│  ├─ ci/          pr\_policy, perf\_smoke, compare\_obstacle, binary-size, startup-time

│  └─ release/     sign, checksums, install.sh, install.ps1

├─ docker/        Dockerfile.build, bun/, crawl/ (debian, slim, alpine, distroless), entrypoint.sh

├─ .github/workflows/  ci.yml  rust-lints.yml  source-lints.yml  format.yml  release.yml  docker.yml  packages-ci.yml  update-vendor.yml  freebsd-smoke.yml

├─ .changes/      changesets covector

├─ docs/          runtime/ browser/ crawl/ desktop/ gpu/ architecture/ (MDX \+ docs.json)

└─ AGENTS.md  CLAUDE.md  REVIEW.md  FUSION.md  BROKEN.md

Workflows retenus et ce qu'ils gardent :

| Workflow | Hérité de | Déclencheur | Contenu |
| :---- | :---- | :---- | :---- |
| `ci.yml` | Obscura `ci.yml` | PR, push `main` | Policy → Core (`xtask lint`, `cargo-serial.sh check/test` sur `default-members`, `bun test` scoped) → Performance (démarrage, taille, `fetch`, obstacles) avec commentaire de PR |
| `rust-lints.yml`, `source-lints.yml`, `format.yml` | Bun | PR | clippy strict sur `crates/bun/*`, lints de source, formatage |
| `release.yml` | Obscura \+ Bun | tag `v*` | Matrice 5 cibles × (noyau, plugins), signature, checksums, GitHub Release, npm `@aphrody/*` |
| `docker.yml` | Obscura \+ Bun `dockerhub` | tag `v*` | buildx multi-arch, images `aphrody/bun` et `aphrody/crawl` en 4 variantes |
| `packages-ci.yml` | Bun | PR touchant `packages/` | Tests des paquets TS et des façades de plugins |
| `update-vendor.yml` | Bun `update-*.yml` | cron hebdomadaire (fusionne l'`update.yml` actuel) | Bump des pins `deps/*.ts`, PR automatique |
| `freebsd-smoke.yml` | Bun | nightly | Fumée du noyau sur FreeBSD (`-Zbuild-std`) |

Ordre de mise en place : le squelette (arborescence, `xtask`, `ci.yml` à trois étages, `docker/`, `docs/` MDX) se fait pendant le J0 du one shot 1 par script, puisque le renommage et l'import des crates Bun touchent déjà tous les chemins ; `release.yml`, `docker.yml` et covector arrivent avec le one shot 2 (première release du binaire \+ plugin crawl) ; `packages-ci.yml` et `update-vendor.yml` avec les premiers plugins publiés. Règle de dedupe appliquée aux scripts comme au code : un seul script par fonction, celui de Bun pour construire, celui d'Obscura pour mesurer, `xtask` pour vérifier ; les scripts par domaine d'Aphrody (`scripts/build/{desktop,discord,os,shell,ui,web}`) sont réduits à des recettes `just` qui appellent ces trois-là.

## Convergence de toute la logique pure d'Aphrody

Inventaire au 5 octobre : 237 crates et \~929 000 lignes de Rust dans `crates/` et `apps/` (hors Bun à importer). 82 crates sont déjà de la logique pure (ni tokio, ni reqwest, ni rusqlite, ni tauri, ni wasm-bindgen, ni pyo3) ; 115 dépendent de tokio, 55 de reqwest, 77 de tracing, 48 d'async-trait, 13 de rusqlite, 44 de tauri. La convergence consiste à classer chaque crate dans un des trois niveaux ci-dessous et à n'autoriser qu'une implémentation par capacité d'E/S : celle de Bun.

| Niveau | Définition | Règle | Exemples déjà conformes |
| :---- | :---- | :---- | :---- |
| 0 · Logique pure | Aucune E/S, aucun runtime async, compile en `wasm32` ; types, parseurs, algorithmes, protocoles | Pas de tokio, reqwest, rusqlite ni tracing ; testable par `cargo test` seul ; c'est le code partagé entre plugin Bun, app Tauri, WASM et Python | `aphrody-rag-core`, `aphrody-web-index`, `aphrody-a2a`, `aphrody-app-protocol`, `aphrody-m3-tokens`, `aphrody-search`, `aphrody-re`, `aphrody-shell-vfs`, `aphrody-terminal-core` |
| 1 · Capacités par traits | E/S exprimées par des traits (`Transport`, `Store`, `Clock`, `Fs`, `Process`, `Log`) définis dans une crate `aphrody-io` ; une seule implémentation « Bun » sur `aphrody-http`, `bun:sqlite`/`Bun.sql`/`Bun.redis`, `aphrody-sys`, `aphrody-spawn`, `aphrody-output` ; une implémentation `Mock` pour les tests | Aucune crate de niveau 1 n'ouvre une socket ou un fichier elle-même ; tokio disparaît (fonctions synchrones sur un thread Worker, réponses par `ConcurrentTask`) | à migrer : `aphrody-web-crawl`, `aphrody-memory`, `aphrody-rag`, `aphrody-jobs`, `aphrody-fsindex`, `aphrody-model-client`, `aphrody-gateway`, `aphrody-messaging`, `aphrody-git`, `aphrody-ssh` |
| 2 · Liaisons | Expose les niveaux 0 et 1 à un hôte : fonctions hôtes JSC (`*_jsc`), plugins N-API (`crates/plugins/*`), commandes Tauri (`*-tauri`), `wasm-bindgen`, `pyo3`, C ABI (`aphrody-ffi`, `yolo-runtime`) | Zéro logique métier : conversion de types et erreurs seulement ; une liaison par hôte, pas de duplication entre `aphrody-ffi`, `aphrody-command` et `aphrody-mcp` | `aphrody-shell-tauri`, `aphrody-n2b-native`, `yolo-pyo3`, `aphrody-shell-web` |

Carte par domaine et cible de convergence :

| Domaine | Crates | Lignes | Ce qu'il contient | Cible |
| :---- | :---- | :---- | :---- | :---- |
| `tauri` | 55 | 218 900 | Tauri 3 alpha complet, wry, tao, CEF, 30 plugins, CLI, bundler, specta | Niveau 2 (hôte desktop) ; CLI, bundler, CEF dans `@aphrody/plugin-tauri` et `plugin-cef` ; runtime wry \= feature `gui` |
| `web` | 18 | 178 700 | Obscura (copie), crawl, extract, index, detect, frames, X, engine, bridge | `@aphrody/plugin-obscura` \+ `plugin-crawl` ; `web-index` et `web-extract` niveau 0 ; `web-engine` et `web-bridge` supprimés |
| `ai` | 54 | 156 200 | MCP unifié (13 700), clients de modèles, mémoire, RAG, embeddings, gateway OpenAI, skills, sessions, messagerie, inférence mistral.rs | `rag-core` et protocoles niveau 0 ; clients et stores niveau 1 sur `aphrody-io` ; MCP \= fonctions hôtes du noyau (`bun mcp`) ; inférence dans `@aphrody/plugin-ml` |
| `ml` | 9 | 86 200 | Liaisons dynamiques LibTorch (70 000), llama.cpp, stable-diffusion.cpp, runtime de paquets | Intégralement `@aphrody/plugin-ml` (chargement dynamique déjà prévu) |
| `os` | 33 | 78 700 | WinClean (18 300), reverse engineering, control plane, A2A serveur/client/gRPC/coord, jobs SQLite, fsindex, recherche, DAG runner, systemd en Rust, capture écran | Niveau 0 : `re`, `search`, `a2a-pb` ; niveau 1 : `jobs`, `fsindex`, `task-runner`, `kernel` ; A2A serveur sur `Bun.serve` ; `aphrody-systemd` fusionne avec le service `bun crawl` |
| `compat` | 9 | 61 300 | serde-saphyr (36 700, YAML), n2b (Node vers Bun), oxc-bridge, toolchains | serde-saphyr dédoublonné avec `Bun.YAML` ; n2b niveau 0/1 ; oxc-bridge vers le transpileur du noyau |
| `ui` | 16 | 50 200 | Tokens M3, renderer unifié (wgpu), plugin Bun existant, app desktop, identité, drive, SVG, tauri-wrap, gui-core, softraster | `m3-tokens`, `svg`, `softraster`, `identity` niveau 0 ; `render` \+ `gpu-backend` dans `@aphrody/plugin-wgpu` ; `aphrody-bun` absorbé par les plugins N-API ; `tauri-wrap` \= base de `bun crawl app` |
| `infra` | 8 | 48 700 | `aphrody-command` (25 200, dispatch CLI/FFI), infra, git, ssh, yolo, sql, ovh, vpn | `command` \= la seule table de commandes (CLI `bun`, MCP, FFI) ; `sql` retiré au profit de `Bun.sql` et `bun:sqlite` ; git, ssh, ovh, vpn niveau 1 |
| `google` | 8 | 16 900 | Antigravity, Gemini (CLI, web, NotebookLM), GCS, MCP Gemini | Niveau 1 sur `aphrody-http` ; connecteurs dans `@aphrody/plugin-google` |
| `shell` | 14 | 9 600 | Terminal natif, TUI, shell WASM, Nushell, VFS, sandbox E2B | VFS et terminal-core niveau 0 ; PTY et WebSocket sur `aphrody-spawn` et `Bun.serve` ; `shell-tauri` niveau 2 |
| `engine` | 4 | 7 000 | `yolo-runtime` (C ABI du runtime précompilé), `yolo-core`, `yolo-desktop`, `yolo-pyo3` | `yolo-runtime` devient l'ABI de plugin `v1` ; `yolo-desktop` fusionne avec `aphrody-app` |
| `contracts` | 3 | 6 500 | A2A, app-protocol, agent-proto | Niveau 0, inchangés, modèle de référence |
| `interop` | 1 | 5 200 | `aphrody-ffi` (C ABI du CLI complet pour Bun) | Remplacé par les plugins N-API côté Bun ; conservé pour Python et .NET |
| `native` | 3 | 3 300 | simdutf, topologie matérielle, gpu-backend | simdutf dédoublonné avec `aphrody-simdutf-sys` de Bun ; gpu-backend vers le plugin wgpu |
| `discord`, `apps` | 2 | 1 600 | Compilateur de bots Discord, CLI `aphrody` | CLI `aphrody` \= `bun` avec les plugins Aphrody préchargés ; Discord en plugin |

Mécanique de convergence, exécutable par agent et mesurable :

1. `xtask tiers` lit chaque `Cargo.toml`, classe la crate (0, 1 ou 2\) d'après ses dépendances et écrit `docs/architecture/tiers.toml` ; la CI refuse une crate de niveau 0 qui gagne tokio, reqwest ou rusqlite, et une crate de niveau 2 qui dépasse 500 lignes hors tests.  
2. Doublons fonctionnels à éliminer, dans l'ordre : trois piles HTTP (reqwest 0.13, `obscura-net`, `aphrody-http`) ; trois SQLite (rusqlite bundled, celui d'Obscura, `bun:sqlite`) ; deux YAML (serde-saphyr, `Bun.YAML`) ; deux simdutf ; deux journaux (tracing, `aphrody-output`) ; deux tables de commandes (`aphrody-command`, `aphrody-mcp`) ; deux systemd (`aphrody-systemd`, unités de `config/host/systemd`).  
3. tokio sort par vagues de domaine (`web`, puis `infra`, `ai`, `os`, `google`), chaque vague fermée par un `cargo tree -i tokio` qui ne liste plus le domaine ; `async-trait` et `futures` tombent avec lui.  
4. Les 82 crates déjà pures reçoivent `[lints] workspace = true` et la cible `wasm32-unknown-unknown` dans `rust:check-all` dès le one shot 1 : elles sont le socle que tout le reste rejoint.

## Plan définitif : la séquence des one shots

Six one shots enchaînés, chacun livrable seul, chacun au même format (J0 par scripts, chantiers parallèles sur chemins disjoints, intégration sérialisée, fumigation, `BROKEN.md`). Le premier est le seul chiffré ferme (200 €, 2 jours) ; les suivants reprennent sa méthode et ses plafonds.

| \# | One shot | Prérequis | Livrable | Fumigation | Budget indicatif |
| :---- | :---- | :---- | :---- | :---- | :---- |
| 1 | **Noyau \+ plugin Obscura** : import des crates Bun dans `aphrody`, nightly, renommage `aphrody-*`, hôte de realm JSC \+ chargeur de plugins dans le noyau, Obscura porté sur JSC en `@aphrody/plugin-obscura`, V8 et tokio hors du chemin, squelette monorepo (xtask, `ci.yml`, `docker/`, `docs/` MDX) | Accès push, cache WebKit, nightly installé | `bun` noyau \+ plugin Obscura, `bun browser fetch`, `bun:browser`, CDP Puppeteer | 5 commandes de la section Plan | 200 € · 2 jours |
| 2 | **Crawl, stores et release** : `@aphrody/plugin-crawl` (daemon 24/7, `FrontierStore` SQLite/Postgres/Redis), mécanisme de plugins complet (signature, `bun plugin add`), unité systemd via le catalogue Infra, `release.yml`, `docker.yml`, covector, première release | 1 | Service `bun crawl daemon` installé, images Docker, release signée | 1 h de crawl sur 50 domaines, redémarrage brutal, 0 perte, `/metrics` cohérent | 100 à 150 € |
| 3 | **Desktop** : feature `gui` (wry/tao), `bun crawl --gui`, `@aphrody/plugin-tauri` (CLI, bundler, create-tauri-app), `bun crawl app <domaine>` sur `aphrody-tauri-wrap`, IPC `Bun.tauri` | 1, 2 | Fenêtre de pilotage du crawl, app Tauri générée depuis un site | GUI 4 Workers en direct ; app `.deb`/AppImage d'un site de test qui s'ouvre hors ligne | 150 à 250 € |
| 4 | **GPU** : `@aphrody/plugin-wgpu` (API WebGPU sur wgpu 30, surfaces fenêtre/hors écran/webview), unification des versions wgpu, `aphrody-render --features gpu` | 2 | `scene.ts` identique en fenêtre, PNG hors écran et navigateur | Triangle \+ calcul GPU sur les trois cibles | 100 à 150 € |
| 5 | **Convergence de la logique pure** : `aphrody-io`, `xtask tiers`, sortie de tokio par domaine (`web`, `infra`, `ai`, `os`, `google`), dédoublonnage HTTP/SQLite/YAML/simdutf/journaux/commandes/systemd, `aphrody-command` table unique | 2 | `tiers.toml` complet, `cargo tree -i tokio` vide hors plugins qui l'assument | Gates Bun et Rust verts, mesures avant/après (taille, démarrage) | 3 à 5 sessions de 150 € |
| 6 | **Plugins de chaînes lourdes** : `plugin-next` (Turbopack \+ SWC du fork next.js), `plugin-ml`, `plugin-cef`, `plugin-google`, `plugin-x`, `plugin-discord` | 2, 5 | Un paquet `@aphrody/plugin-*` signé par chaîne | `bun next build` d'une app Next 16 de test ; inférence locale d'un modèle de test | 100 à 200 € par plugin |

Invariants valables du début à la fin : un seul binaire `bun` ; un seul moteur JS (JSC) ; une seule pile par capacité (HTTP, TLS, DNS, compression, SQLite, YAML, journal, commandes) ; démarrage du noyau mesuré et inchangé ; tout ce qui est une chaîne de build vit en plugin ; `BROKEN.md` tenu à jour ; commits `aphrody-dev <contact@aphrody.com>` ; aucune publication publique sans autorité du propriétaire.

## Prompts prêts à l'emploi

Deux textes à copier tels quels, fournis en fichiers séparés dans ce dossier : `GOAL-FUSION.md` (remplace la section « Rôle » de `GOAL.md` dans `aphrody`) et `PROMPT-ONESHOT-1.md` (prompt de la session d'exécution du one shot 1 pour l'orchestrateur Opus 5.5).

## Points techniques délicats

Douze sujets concentrent le risque d'échec du one shot ; chacun a une décision prise d'avance pour que les agents ne la redécouvrent pas.

| Sujet | Le problème | Décision pour le one shot | Chantier |
| :---- | :---- | :---- | :---- |
| Realm de page sur JSC | Obscura crée un `v8::Context` par frame à partir d'un snapshot ; JSC n'a pas de snapshot de tas | Un global object JSC par page, `bootstrap.js` évalué à la création (coût accepté) ; cache de bytecode seulement si B a du budget restant | B |
| `Deno.core.ops` | 70 ops `#[op2]` typés par deno\_core (`JsBuffer`, `OpState`, `#[string]`, `#[serde]`) | Objet `Deno.core` installé sur le global avant `bootstrap.js` ; chaque op devient une fonction hôte `aphrody-jsc` qui décode ses arguments à la main comme `html_rewriter.rs` ; `OpState` → `Rc<RefCell<PageState>>` capturé par la fonction | B |
| Appels `v8::` directs | 164 usages : `Global`, `TryCatch`, `script_compiler`, `Context::from_snapshot`, `IsolateHandle::terminate_execution`, `HeapStatistics` | `Global` → `JsRef`/`GlobalRef` ; `TryCatch` → `JsResult` ; compilation → `execute_script` d'`aphrody-jsc` ; snapshot supprimé ; watchdog → interruption JSC depuis le thread de garde ; statistiques de tas → stub | B |
| `panic = "abort"` | Le protocole `catch_unwind` d'Obscura ne fonctionne plus : toute panique dans un op tue le processus | Passage par script des `unwrap()`/`expect()` des ops en `?` ou en `return null` quand l'op le permet ; le reste est accepté (le `crash_handler` de Bun donne la trace) | B, J2 |
| Retrait de tokio | `async fn` partout dans browser, cdp, mcp, net ; `tokio::sync::Mutex`, `mpsc`, `time::timeout`, `LocalSet` | Le moteur d'une page vit sur un thread Worker : les `async fn` deviennent synchrones, `mpsc` → canaux d'`aphrody-threading`, `timeout` → délais du transport ; le thread JS principal ne bloque jamais, il attend un `ConcurrentTask` | C, A, D |
| Transport HTTP | `obscura-net` est écrit contre reqwest (`Client`, `Response`, flux) et wreq ; `aphrody-http` a sa propre API orientée `AsyncHTTP` \+ thread HTTP | Trait `Transport` minimal défini en J0 (`send(Request) -> Result<Response>` bloquant, `stream_body`) ; une impl sur `aphrody-http`, une impl `MockTransport` pour les tests ; SOCKS5 stub | A |
| Empreinte TLS stealth | wreq configure BoringSSL (suites, extensions permutées, GREASE, ALPS, compression de certificats) ; Bun expose BoringSSL par `aphrody-boringssl` mais sans ces réglages | J1 : suites \+ ALPN \+ GREASE sur le `SSL_CTX` du client ; permutation d'extensions, ALPS et compression de certificats dans `BROKEN.md` si non faits ; la mesure ja4 vient après le one shot | A |
| Empreinte moteur JS | Les détecteurs distinguent V8 de JSC (messages d'erreur, format des piles, précision de `Math`, `Function.prototype.toString`) ; Obscura promet une empreinte Chrome | Hors périmètre du one shot ; noté comme régression connue ; Bun formate déjà les piles à la V8 (`Error.captureStackTrace`, `prepareStackTrace`) ce qui couvre une partie | — |
| Lints et conventions de Bun | `warnings = deny`, `unreachable_pub`, `dead_code`, `clippy.toml` interdisant `std::fs`, `HashMap`, `println!`, `str::find` | Crates importées : `[lints] workspace = false`, `#![allow(clippy::all)]`, `#![allow(dead_code, unreachable_pub)]` en tête de `lib.rs` ; `cargo clippy` de la CI exclut ces crates par `--exclude` jusqu'à adoption | J0 |
| Nightly, edition, build-std | Obscura cible stable 1.75 ; Bun compile `std` lui-même avec `panic_abort` ; `-Clinker-plugin-lto` sur toutes les crates | Les crates Obscura restent en edition 2021 (mélange autorisé par crate) ; aucune `build.rs` exécutant un moteur ; `taffy` et `cosmic-text` vendorisés copiés dans `vendor/` et exclus des `members` comme `lolhtml` | J0, E |
| Renommage de masse | \~105 crates `bun_*` → `aphrody-*` touche chaque `Cargo.toml`, chaque `use`, les scripts de build (`rust.ts` planifie `-p bun_runtime`), le codegen et les lints de source | Script unique en J0 qui réécrit `Cargo.toml`, `*.rs`, `scripts/build/*.ts`, `src/codegen/*.ts`, `test/internal/source-lints` ; un seul commit ; `cargo metadata` comme preuve ; les chaînes utilisateur (`bun`, messages, `BUN_*`) ne changent pas | J0 |
| Cibles et binaire | `obscura-render` embarque des polices et `tiny-skia` ; `bootstrap.js` passé en clair | Linux x86\_64 seul pour le one shot ; taille et RSS mesurés en J2 sans objectif ; la feature `browser` existe mais est activée par défaut | J2 |

Licences : Obscura est Apache-2.0, Bun MIT, WebKit LGPL/BSD. Apache-2.0 dans un binaire MIT impose de conserver les mentions de licence et le `NOTICE` ; un fichier `LICENSES/obscura-APACHE-2.0` et une ligne dans `LICENSE.md` suffisent, à faire en J0 par l'orchestrateur.

## WebView et application desktop native Bun

Le fork a déjà un `Bun.WebView` (9 500 lignes dans `src/runtime/webview/`, 6 fichiers de tests) : c'est une vue de navigateur **headless** pour l'automatisation, pas une fenêtre d'application. Sur macOS elle pilote une `WKWebView` dans un process hôte (le binaire `bun` réexécuté avec `BUN_INTERNAL_WEBVIEW_HOST`, socket Unix, protocole binaire `ipc_protocol.h`) ; sur Linux et Windows elle pilote un Chrome, Chromium, Edge ou Brave **installé sur la machine** par CDP (`--remote-debugging-pipe` ou WebSocket). Le fichier `packages/bun-types/tauri.d.ts` (`Bun.tauri`, `IpcMessage { cmd, callback, error, payload }`, `getDisplayConfig`) n'a aucune implémentation Rust ou C++ derrière lui : c'est un stub de types.

Comparaison avec Tauri 3 (guide de migration depuis Tauri 2\) et avec Obscura :

| Critère | `Bun.WebView` (fork) | Tauri 3 alpha | Obscura |
| :---- | :---- | :---- | :---- |
| Moteur | WKWebView (macOS) ; Blink d'un Chrome installé ailleurs | Au choix par crate de runtime : `tauri-runtime-wry` (webkit2gtk / WebView2 / WKWebView) ou `tauri-runtime-cef` (Chromium embarqué) | Moteur propre dans le binaire : V8 aujourd'hui, JSC après fusion, rendu CPU `tiny-skia` |
| Dépendance externe à l'exécution | Aucune sur macOS ; Chrome requis sur Linux et Windows | Webview système (webkit2gtk à installer sur Linux, WebView2 présent sur Windows) ou CEF embarqué (+100 Mo) | Aucune, partout |
| Fenêtre visible | Non (headless seulement) | Oui : `Window`, `Webview`, multi-fenêtres, menus, tray (ksni sur Linux) | Non |
| Sélection du runtime | Option `backend: "webkit" | "chrome"` par vue | `tauri::Builder::runtime(…)` obligatoire, `DynRuntime` par défaut, traits d'extension `AppHandleWryExt` | — |
| IPC application ↔ page | Aucun (seulement `evaluate`, `navigate`, entrées natives, `screenshot`) | `invoke(cmd, payload)` avec `callback`/`error`, permissions `allow-*`/`deny-*` résolues à la demande depuis la liste `commands` du manifeste | Interception réseau, `evaluate`, `add_preload_script` |
| Schéma d'actifs | `http(s)` seulement | `tauri://localhost` (wry sauf Windows/Android : `http://tauri.localhost`), défini par le runtime | `http(s)`, `data:` |
| Isolation | Un process hôte ou un Chrome par process Bun, une cible par vue | Un process par app, webviews en process du runtime | Un process, un isolate partagé (un realm par Worker après fusion) |
| Entrées `isTrusted` | Oui (événements natifs) | Oui | Oui, émulé (`event.isTrusted = true` en stealth) |
| Empaquetage | `bun build --compile` | `tauri-build` \+ CLI, bundles natifs | Binaire unique |

Ce que la comparaison impose au plan :

1. **Le backend Chrome de `Bun.WebView` est le point d'entrée gratuit d'Obscura.** `ChromeBackend.cpp` parle CDP sur un pipe ou un WebSocket ; `aphrody-cdp` est un serveur CDP. Un troisième backend `"obscura"` connecte `ChromeBackend` à `aphrody-cdp` dans le même process (socketpair ou boucle en mémoire) : `new Bun.WebView()` fonctionne alors sur Linux et Windows **sans Chrome installé**, et devient le défaut là où il n'y a pas de WKWebView. C'est l'équivalent du choix de runtime de Tauri 3, mais dans le binaire. Ajouté au chantier D du one shot comme objectif prioritaire après `bun browser fetch` (coût estimé : 5 € de la réserve ; sinon premier item d'après one shot).  
2. **Deux API, un moteur, une convergence.** `Bun.WebView` (vue, entrées natives, captures) et `bun:browser` (pages, interception, CDP, MCP) partagent le même moteur après fusion ; `bun:browser` reste l'API riche, `Bun.WebView` l'API courte. Pas de troisième API.  
3. **Le modèle de runtime de Tauri 3 est repris pour le desktop.** Une crate `aphrody-webview-runtime` avec trois implémentations : `wkwebview` (le process hôte existant, à rendre visible : `NSWindow` \+ `WKWebView` au lieu d'une vue hors écran), `webview2` (Windows, runtime Edge préinstallé, chargement dynamique de `WebView2Loader`), `webkitgtk` (Linux, `dlopen` de webkit2gtk si présent) ; et un repli `obscura` sans dépendance qui peint les pixmaps `tiny-skia` dans une fenêtre (`softbuffer` \+ `winit`), lent mais universel. Sélection par option, pas par feature Cargo, comme `Builder::runtime()`.  
4. **IPC et permissions à la Tauri 3, implémentés derrière `Bun.tauri` déjà typé.** `Bun.Window` expose `commands({ name: handler })` ; la page appelle `window.__BUN__.invoke(cmd, payload)` ; le message garde la forme `IpcMessage` du `tauri.d.ts` pour réutiliser les clients Tauri existants (`@tauri-apps/api` pointable sur le pont). Permissions : liste `commands` dans `bunfig.toml` (`[desktop] commands = [...]`) avec `allow-*`/`deny-*` implicites résolues à la demande, comme le manifeste d'app de Tauri 3, pas de fichiers générés.  
5. **Schéma et empaquetage.** Actifs servis sous `bun://localhost` par le bundler (équivalent de `tauri://localhost`), ressources résolues depuis les sources en dev (comme Tauri 3\) et embarquées par `bun build --compile` en release ; une app desktop \= un binaire `bun` compilé avec ses actifs, zéro installation, ce que Tauri n'offre qu'avec CEF.

Précision après lecture du dépôt Tauri (branche `dev`, workspace 2.12.1, edition 2024, Rust 1.90) : on ne réinvente pas l'abstraction de runtime, on reprend celle de Tauri. Cela remplace le détail du point 3 ci-dessus (`winit` \+ `dlopen`).

| Crate Tauri | Taille et dépendances | Usage dans le workspace `aphrody` |
| :---- | :---- | :---- |
| `tauri-runtime` | 2 874 lignes : traits `Runtime`, `RuntimeHandle`, `WebviewDispatch` (navigate, eval\_script, cookies, bounds, devtools), `WindowDispatch`, `WindowBuilder`, `PendingWebview`/`PendingWindow`, `RunEvent`, DPI, moniteurs, permissions webview. Dépendances : serde, serde\_json, thiserror 2, `tauri-utils`, http 1, raw-window-handle 0.6, url 2, dpi 0.1, cookie 0.18 ; plateformes via webview2-com 0.39, gtk 0.18 \+ webkit2gtk 2.0, objc2 | Copiée telle quelle en `aphrody-webview-runtime` (licence Apache-2.0 OR MIT) ; `tauri-utils` réduit aux types de config et de fenêtre dont les traits ont besoin |
| `tauri-runtime-wry` | wry 0.57 \+ tao 0.37 ; macOS objc2-app-kit, Windows windows 0.62 \+ softbuffer 0.4, Linux gtk \+ webkit2gtk ; features `devtools`, `x11`, `dbus` | Copiée en `aphrody-runtime-wry` : la seule implémentation « fenêtre visible », dans le process hôte (voir ci-dessous) |
| `tauri` (cœur) | IPC `invoke`, ACL, plugins, bundler ; dépend de tokio et reqwest 0.13 | **Non repris** : tokio et reqwest sont exclus du binaire ; l'IPC est réécrit sur `Bun.tauri` (forme `IpcMessage`) et les permissions sur `bunfig.toml` |
| `tauri-runtime-cef` (3.0 alpha) | Chromium embarqué | Non repris : le rôle « moteur embarqué sans dépendance » est tenu par le moteur Obscura |

Trois implémentations des traits `aphrody-webview-runtime`, choisies par option à l'exécution comme `Builder::runtime()` en Tauri 3 :

- `aphrody-runtime-obscura` : headless, dans le process, moteur fusionné ; c'est aussi ce que `Bun.WebView({ backend: "obscura" })` et `bun:browser` utilisent. Fenêtre visible possible par peinture des pixmaps `tiny-skia` dans une fenêtre tao via `softbuffer` (déjà dépendance de `tauri-runtime-wry` sur Windows), lent mais sans aucune bibliothèque système.  
- `aphrody-runtime-wry` : fenêtres natives (WKWebView, WebView2, webkit2gtk) ; webkit2gtk et gtk sont des bibliothèques système sur Linux, à charger dynamiquement pour que le binaire démarre sans elles et tombe sur `obscura`.  
- `aphrody-runtime-cdp` : l'actuel `ChromeBackend` (Chrome installé), conservé pour la compatibilité de `Bun.WebView`, plus jamais par défaut.

Décision d'architecture qui conditionne tout le desktop : **le process hôte existant reste le modèle.** tao exige de posséder le thread principal (surtout sur macOS) et le thread principal de Bun est celui de la VM JS. Plutôt que de déplacer la VM, on étend le hôte `BUN_INTERNAL_WEBVIEW_HOST` (`host_main.cpp`, aujourd'hui macOS seulement) pour qu'il exécute la boucle tao \+ wry sur toutes les plateformes ; le process Bun implémente `RuntimeHandle`/`WebviewDispatch`/`WindowDispatch` comme des proxys sur le protocole `ipc_protocol.h` existant, étendu aux fenêtres (création, événements `RunEvent`, `invoke`). Coût : une latence IPC par `invoke` ; gain : aucun changement du modèle de threads de Bun, et un crash de la webview ne tue pas le script.

Points de friction connus : `cookie 0.18` (réexporté par `tauri-runtime`) est la version dont Obscura a dû se passer pour une erreur de cohérence de `From` sur certaines toolchains (issue Obscura \#295), à vérifier sur le nightly de Bun ; `http 1` et `url 2` entrent dans le workspace (déjà nécessaires à Obscura) ; `tracing` est une feature optionnelle de wry, laissée éteinte.

Surface proposée :

import { Window } from "bun:desktop"; // ou Bun.Window

const win \= new Window({

  title: "Aphrody",

  width: 1200, height: 800,

  runtime: "auto",            // wkwebview | webview2 | webkitgtk | obscura

  url: "bun://localhost/index.html",

  commands: {

    greet: ({ name }) \=\> \`Bonjour \${name}\`,

    readConfig: async () \=\> Bun.file("config.json").json(),

  },

});

win.on("close", () \=\> process.exit(0));

// côté page : const r \= await window.\_\_BUN\_\_.invoke("greet", { name: "Yohan" });

Placement dans le temps : l'item 1 entre dans le one shot (chantier D, réserve) ; les items 3 à 5 forment le **one shot bis « desktop »**, même format (2 jours, budget à fixer, ordre de grandeur 150 à 250 €), après stabilisation du moteur fusionné : il dépend de `aphrody-cdp` et du realm JSC, pas l'inverse. Les fenêtres visibles sur Linux sans webkit2gtk installé ne seront disponibles que par le repli `obscura`, dont la vitesse de peinture est inconnue tant que le moteur fusionné n'est pas mesuré.

## Risques et mitigations

Le risque dominant n'est pas technique mais budgétaire : le chantier B peut absorber le budget sans que la fumigation passe. Tout le reste est de la casse assumée et listée.

| Risque | Probabilité | Impact | Mitigation | État attendu à la livraison |
| :---- | :---- | :---- | :---- | :---- |
| Le portage des 70 ops sur JSC dépasse 60 € / 8 h | élevée | fumigation 2 et 4 échouent | Ordre de portage imposé : `op_dom`, `op_eval`, timers, `op_fetch`, puis le reste ; ops hors budget \= `throw` explicite ; réserve de 5 € affectée à B en priorité | `document.title` et `querySelector` fonctionnent ; `IndexedDB`, Workers de page, `crypto.subtle` peuvent manquer |
| Le workspace ne compile pas en entier à J2 (erreurs en cascade) | élevée | pas de binaire | J1 validé par `cargo check -p` par crate avec stubs ; J2 en lots par crate, `--keep-going` ; un stub remplace toute crate qui bloque | Binaire produit, parfois avec des stubs à la place de A ou E |
| `panic = "abort"` fait aborter le navigateur sur une page réelle | élevée | crash sur certaines pages | Script J0 qui remplace les `unwrap()`/`expect()` des ops ; pages de fumigation choisies simples | `example.com` et HN passent ; des SPA lourdes peuvent tuer le process |
| Renommage de masse casse les scripts de build (`rust.ts` plan `-p bun_runtime`, codegen, lints de source) | moyenne | J0 dépasse 2 h | Script de renommage testé sur une copie, `cargo metadata` \+ `bun run build:debug --dry-run` comme preuve avant push | J0 à l'heure ou report de 1 h pris sur la réserve |
| Empreinte TLS stealth incomplète (permutation d'extensions, ALPS, compression de certificats) | certaine | sites protégés par anti-bot détectent | Accepté ; suites \+ ALPN \+ GREASE seulement ; mesure ja4 après one shot | `--stealth` existe mais ne vaut pas celui d'Obscura |
| Empreinte moteur JS (JSC vs V8) détectable | certaine | idem | Hors périmètre ; piles formatées à la V8 par Bun couvrent une partie | Régression connue, documentée |
| Perte des tests Obscura (18 000 lignes dans `runtime.rs`, intégration CDP) | certaine | régressions silencieuses | Tests copiés sous feature `legacy-tests`, réactivation \= premier travail post one shot | 0 test Obscura exécuté à la livraison |
| Démarrage de page lent sans snapshot (évaluation de 16 900 lignes par realm) | élevée | latence `fetch` \> 85 ms d'Obscura | Cache de bytecode JSC si B a du budget ; sinon accepté | Probablement 20 à 100 ms de plus par page, non mesuré |
| `cookie 0.18`, `cssparser 0.36`, `selectors 0.33` cassent `aphrody-dom`/`render` | moyenne | chantier E dépasse | E garde les anciennes versions en doublon si la migration dépasse 1 h ; doublon noté | Au pire deux versions de cssparser dans le lock |
| Linux x86\_64 seul | certaine | pas de macOS/Windows/ARM | Accepté ; aucune cible croisée dans le one shot | Build Linux x86\_64 uniquement |
| Divergence définitive avec les upstreams | certaine | plus de correctifs gratuits | Choix assumé ; `FUSION.md` conserve la table de correspondance crate → origine pour cherry-pick manuel | — |
| Dépassement du budget total | moyenne | livraison partielle | Plafonds par chantier, l'orchestrateur seul peut puiser dans la réserve, arrêt à 200 € quoi qu'il arrive | Livraison de l'état courant \+ `BROKEN.md` |

## Validation

Pendant le one shot, la seule validation est la fumigation en cinq points de la section Plan ; tout le reste vient après, dans l'ordre ci-dessous, et chaque étape produit un chiffre comparable à la base relevée en J0.

| Ordre | Validation | Outil | Référence de comparaison |
| :---- | :---- | :---- | :---- |
| 1 | Fumigation (5 commandes) | shell, script Bun, `puppeteer-core` | binaire démarre, `Example Domain`, liens HN, PNG non vide |
| 2 | Réactivation des tests Obscura par crate (`legacy-tests`) | `cargo test -p aphrody-page-runtime` puis dom, browser, cdp | nombre de tests verts / total, publié dans `BROKEN.md` |
| 3 | Conformité web | suite WPT et parcours d'obstacles d'`obscura-benchmark` | score Obscura V8 au 1er octobre |
| 4 | Compatibilité clients | suites Puppeteer et Playwright de la doc Obscura contre `bun browser serve` | 100 % sur Obscura |
| 5 | Empreinte réseau | ja4 / tls.peet.ws, comparaison avec Chrome 145 | identique avec `wreq` |
| 6 | Anti-détection | CreepJS, challenges Cloudflare/DataDome de test | score Obscura V8 |
| 7 | Performance | `scripts/ci/perf_smoke.py` porté ; RSS par page ; taille du binaire ; débit `scrape --concurrency 25` sur Workers | 85 ms de chargement, 30 Mo RSS, \~70 Mo de binaire Obscura ; `bun` seul avant fusion |
| 8 | Tests Bun existants | `bun test` complet (2 007 fichiers) | zéro régression hors `test/js/bun/webview` |

Les résultats 2 à 8 décident du contenu du second one shot (« fiabilisation ») et du one shot « desktop ».

## Checklist de démarrage

À faire avant de lancer l'orchestrateur ; tout ce qui manque ici se paie en budget d'agent.

- [ ] Décider le préfixe pour les crates Bun existantes : `aphrody-*` partout (hypothèse du plan) ou seulement pour les crates importées d'Obscura  
- [ ] Créer la branche `aphrody/fusion` sur `aphrody-labs/aphrody` et donner l'accès push à la session d'exécution  
- [ ] Préchauffer le cache de build sur la machine d'exécution : WebKit `autobuild`, dépendances `scripts/build/deps`, un `bun run build:debug` vert avant toute modification  
- [ ] Installer le nightly `2026-09-15` avec `rust-src`, `clippy`, `rustfmt` ; vérifier que `cargo check --workspace` passe sur le fork vierge  
- [ ] Cloner `aphrody-labs/obscura` à côté et relever la base de mesures (latence `fetch`, RSS, taille, score parcours d'obstacles)  
- [ ] Écrire `FUSION.md` : règle de nommage, interdits, politique de stubs, format de `BROKEN.md`, ordre de fusion J2, les cinq commandes de fumigation  
- [ ] Préparer les six prompts d'agents (orchestrateur, A, B, C, D, E) avec plafond en euros et en heures, périmètre de fichiers, condition d'arrêt  
- [ ] Configurer les plafonds de dépense du workflow dynamique (200 € au total, alertes à 50 %, 80 %, 100 %)  
- [ ] Choisir les pages de fumigation (`example.com`, `news.ycombinator.com`, une page de test locale avec `fetch()` et `setTimeout`)  
- [ ] Prévoir 30 minutes humaines à la fin de J0 (revue du renommage) et à la fin de J2 (lecture de `BROKEN.md`, tag)  
- [ ] Ajouter `LICENSES/obscura-APACHE-2.0` et la mention dans `LICENSE.md`

## Sources

Dépôts et fichiers lus le 5 octobre 2026\.

- h4ckf0r0day/obscura (commit `1fccab2`) : `Cargo.toml`, `crates/*/Cargo.toml`, `Cargo.lock`, `docs/Architecture-overview.md`, `docs/Use-as-a-Rust-library.md`, `crates/obscura-js/src/*.rs`, `crates/obscura-js/js/bootstrap.js`, `crates/obscura-js/build.rs`, `.cargo/config.toml` — [https\://github.com/h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)  
- aphrody-labs/obscura (commit `0cdd42e`, branche `main`) : diff complet contre l'upstream — [https\://github.com/aphrody-labs/obscura](https://github.com/aphrody-labs/obscura)  
- aphrody-labs/bun (commit `954db0c`, branche `yolo`) : `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `scripts/build/rust.ts`, `scripts/build/deps/*.ts`, `src/runtime/Cargo.toml`, `src/runtime/api/html_rewriter.rs`, `src/event_loop/*.rs`, `src/http/*`, `src/runtime/webview/*`, `docs/runtime/webview.mdx`, `packages/bun-types/bun.d.ts`, `packages/bun-types/tauri.d.ts`, `REVIEW.md`, `package.json` — [https\://github.com/aphrody-labs/bun](https://github.com/aphrody-labs/bun)  
- tauri-apps/tauri (branche `dev`) : `Cargo.toml`, `crates/tauri-runtime` (`lib.rs`, `webview.rs`, `window.rs`, `Cargo.toml`), `crates/tauri-runtime-wry/Cargo.toml`, `crates/tauri/Cargo.toml` — [https\://github.com/tauri-apps/tauri/tree/dev/crates](https://github.com/tauri-apps/tauri/tree/dev/crates)  
- Guide de migration Tauri 3 depuis Tauri 2 — [https\://v3.tauri.app/fr/start/migrate/from-tauri-2/](https://v3.tauri.app/fr/start/migrate/from-tauri-2/)  
- Cloudflare, « Kitesurf », cité par le README d'Obscura pour le contexte — [https\://blog.cloudflare.com/kitesurf/](https://blog.cloudflare.com/kitesurf/)  
- aphrody-labs/aphrody (privé, commit `32284a6`, 5 octobre) : `Cargo.toml`, `rust-toolchain.toml`, `Justfile`, `CLAUDE.md`, `GOAL.md`, `crates/web/*/Cargo.toml`, `crates/web/web-crawl/src/{frontier,runner}.rs`, `crates/web/web-engine/src/main.rs`, `crates/tauri/*/Cargo.toml`, `crates/infra/sql/Cargo.toml`, `config/host/systemd/`

Chiffres calculés dans cette session : lignes par crate (`wc -l`), recouvrement des `Cargo.lock` (126 paquets communs, 95 à version identique, 31 en écart), 71 `#[op2]`, 164 références `v8::`, 70 ops distincts appelés par `bootstrap.js`.

Vérifications faites le 5 octobre contre les sources primaires (GitHub et documentation à jour via Context7) : matrice de cibles précompilées de rusty\_v8 v150.4.0 (`.github/workflows/ci.yml`) et variables `RUSTY_V8_MIRROR` / `RUSTY_V8_ARCHIVE` / `V8_FROM_SOURCE` de son README ; champs `TlsOptions` de wreq (`cipher_list`, `alpn_protocols`, `alps_protocols`, `permute_extensions` / `extension_permutation`, `grease_enabled`, `enable_ech_grease`, `certificate_compressors` ZLIB/BROTLI/ZSTD) qui fondent le profil ClientHello à reproduire sur BoringSSL ; Node-API dans Bun (`.node` importés ou `require`), Bun.sql (PostgreSQL, MySQL, SQLite), Bun.redis ; dans le fork `yolo` : `src/jsc/CachedBytecode.rs` (cache de bytecode JSC), watchdog JSC dans `src/jsc/bindings/bindings.cpp`, `Error.captureStackTrace` et `prepareStackTrace` dans `src/jsc/bindings/ErrorStackTrace.cpp` et `FormatStackTraceForJS.cpp`, adaptateurs `src/sql/{postgres,mysql}`. Les chiffres de lignes et de versions viennent des manifests et des `wc -l` de la session ; les durées et budgets restent des estimations.