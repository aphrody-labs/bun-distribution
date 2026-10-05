# Plan de fusion Obscura × Bun — partie 1 de 3

Oct 5, 2026 · @aphrody-dev

> Fichier découpé en trois parties pour l'envoi sur Drive. Lire dans l'ordre 1 → 2 → 3, puis 4 (audits et contexte vérifiés). La section « Décision finale » prime sur toute phrase antérieure ou postérieure qui dirait le contraire (cible `aphrody-labs/yolo`, binaire `yolo` alias `bun`).

> **Mise à jour du 5 octobre (soir)** : la partie 4 (« audits et contexte vérifiés ») corrige les états et chiffres de cette partie (branche `main` unique du fork Bun à `c439b6fbd`, nom `aphrody-labs/yolo` déjà pris, fork Obscura à 107 commits de l’amont avec une branche `yolo` propre, V8 déjà présent dans `aphrody`, base glibc) et liste les décisions ouvertes. Elle ne change pas la Décision finale.

## Résumé exécutif

Décision : le workspace unifié est **`aphrody-labs/aphrody`**, qui a déjà absorbé Obscura (`crates/web/obscura-*`), Tauri 3 alpha avec wry, tao et ses plugins (`crates/tauri/*`) et les crates d'indexation (`crates/web/web-*`). On y **ajoute les ~105 crates de Bun-Rust** (fork `aphrody-labs/bun`, branche `yolo`) sous `crates/bun/*`, toutes préfixées `aphrody-` et référencées par `workspace = true`, et on **retire V8** en portant le runtime de page d'Obscura sur JavaScriptCore. La fusion est exécutée en one shot par un workflow dynamique Opus 5.5 plafonné à 200 €, en 1 à 2 jours, casse assumée, divergence définitive avec les upstreams. Conséquence à accepter dès J0 : tout le dépôt `aphrody` passe du stable 1.98.1 au nightly `2026-09-15` exigé par Bun, et le binaire `bun` est produit par le script de build de Bun (ninja + WebKit précompilé) porté dans `scripts/build/bun/`, pas par un simple `cargo build`.

Résultat attendu : un binaire `bun` qui est aussi le navigateur headless, exposé nativement dans Bun (`bun:browser` et `Bun.Browser` dans les scripts, sous-commande `bun browser` en CLI) sans installation ni dépendance externe. Obscura gagne JSC, les Workers, `aphrody-http` (H1/H2/H3), BoringSSL, c-ares et mimalloc ; Bun gagne un DOM, un moteur de rendu, un serveur CDP compatible Puppeteer/Playwright et un serveur MCP.

Point de départ (5 octobre 2026) : Obscura = 10 crates, ~172 000 lignes de Rust, 16 900 lignes de `bootstrap.js`, V8 via `deno_core`, tokio, reqwest/rustls, `wreq` ; Bun-Rust (branche `yolo`) = ~105 crates, 1 528 fichiers Rust, 576 fichiers C++ de liaison WebKit, nightly `2026-09-15`, `-Zbuild-std`, `panic = "abort"`. 126 paquets communs, une dizaine de piles en double (HTTP, TLS, DNS, compression, boucle d'événements, crypto, WebSocket, CLI, logs, codecs image).

Les cinq choix qui rendent le one shot possible :

1. **Divergence totale assumée.** Plus aucun suivi d'`oven-sh/bun` ni de `h4ckf0r0day/obscura`. Renommage mécanique par script, lints de Bun désactivées sur les crates importées, tests existants laissés en l'état tant qu'ils ne compilent pas.
2. **JSC direct.** `bootstrap.js` repris tel quel ; un objet `Deno.core.ops` servi par `aphrody-jsc` ; seuls les 164 appels `v8::` directs, le snapshot et le chargeur de modules sont réécrits. V8, `deno_core` et une seconde ICU n'entrent jamais dans le binaire.
3. **Infrastructure Bun imposée d'emblée.** tokio, reqwest, hyper, rustls, ring, wreq, tungstenite, tracing, clap ne sont pas portés : chaque usage est remplacé, ou neutralisé par un stub qui renvoie une erreur explicite, pendant la vague d'intégration.
4. **Parallélisme d'agents.** Cinq chantiers sur des chemins disjoints réservés dans .coord/claims le jour 1 (règle du CLAUDE.md d'Aphrody : pas de worktree ni de clone), une vague d'intégration et de compilation le jour 2 ; chaque agent n'a qu'une ou deux crates en portée ; seul l'intégrateur lance Cargo, en série, par `cargo check -p`.
5. **Budget protégé.** 200 € répartis par chantier avec plafond et condition d'arrêt ; ce qui n'entre pas dans le budget est consigné dans `BROKEN.md`, pas rattrapé.

Ce qui sera très probablement cassé à la livraison : empreinte TLS stealth incomplète, tests Obscura non portés, Linux x86_64 seul, domaines CDP partiels, performances non mesurées. Le détail est dans la section Risques.

## Décision finale, tranchée pour une exécution par Claude Code

**Verdict : nouveau monorepo frais, créé depuis le fork Bun, avec vendors épinglés et système de plugins. On n'absorbe pas tout dans `aphrody`.** Le monorepo s'appelle `aphrody-labs/yolo` (le nom que `GOAL.md` donne déjà au producteur du runtime ; l'actuel dépôt `yolo` est archivé en `yolo-legacy` et son contenu utile repris par cherry-pick). Toutes ses crates portent le préfixe `aphrody-`. Le binaire s'appelle `yolo` (c'est déjà le nom installé par `docs/DISTRIBUTION.md` dans `~/.yolo/bin`), et l'installateur pose un alias `bun` pour la compatibilité des scripts ; partout où ce plan écrit `bun browser`, `bun crawl`, `bun:browser`, lire `yolo browser`, `yolo crawl`, `yolo:browser` (les modules `bun:*` restent acceptés comme alias). `aphrody` reste le dépôt des produits et se vide de ses moteurs. Cette section prime sur toute phrase antérieure du plan qui dit le contraire.

Pourquoi ce choix et pas l'absorption dans `aphrody` :

| Critère décisif pour un agent | Monorepo frais depuis Bun | Absorption dans `aphrody` |
| --- | --- | --- |
| État au commit 0 | Build vert, 2 007 tests, CI, Docker, docs MDX hérités de Bun : chaque session part d'un dépôt qui compile et peut vérifier | J0 déplace 1,17 M de lignes sur un nightly et fusionne deux systèmes de build avant que quoi que ce soit compile : le pas le plus risqué du plan, et une ambiguïté « ça compile ? » héritée par toutes les sessions suivantes |
| Taille du contexte | Noyau Bun + Obscura + plugins ≈ 2 000 fichiers Rust ; `CLAUDE.md` court ; `cargo check` en minutes | 2 M+ de lignes, 14 domaines sans rapport avec le runtime (ML 86 000 lignes, WinClean 18 000, Discord, Google) dans le même `cargo check` et le même `Cargo.lock` |
| Vendoring | Les dépendances lourdes sont des pins (`deps/*.ts`, `git = … rev = …` sur les forks `aphrody-labs/{tauri,wry,tao,next.js}`), jamais des copies ; une mise à jour = un bump | `aphrody` a copié Tauri en entier (55 crates, 219 000 lignes) : c'est ce qui l'a fait grossir ; l'absorption de Bun ajouterait une troisième copie de piles déjà copiées |
| Conventions pour agents | `REVIEW.md`, lints, `scripts/build`, worktrees autorisés, Cargo parallèle : les règles de Bun sont faites pour des PR automatisées | `CLAUDE.md` d'`aphrody` interdit worktrees, clones et Cargo aux chantiers (`cargo-serial.sh`, `.coord/claims`) : juste pour un dépôt produits partagé, bloquant pour un portage de moteur |
| Propriété | Une frontière nette : `yolo` = moteur + plugins, `aphrody` = produits qui consomment le runtime précompilé et le SDK, exactement ce que `GOAL.md` et `PLAN.md` d'`aphrody` décrivent déjà | Une seule frontière floue où un correctif de produit peut reconstruire le moteur, ce que `GOAL.md` interdit explicitement |
| Divergence upstream | Assumée, mais bornée : les pins restent rebasables, le code première partie est petit (Obscura porté, plugins) | Tout devient première partie, rien n'est plus rebasable |

Ce qui va où (définitif) :

| Élément | Dans `yolo` | Dans `aphrody` | Comment |
| --- | --- | --- | --- |
| Bun-Rust (branche `yolo` du fork) | `crates/core/*` (ex `src/*`), renommé `aphrody-*` ; `scripts/build/*`, `.github/workflows/*`, `dockerhub/` → `docker/`, `docs/`, `test/` repris tels quels | — | `git push` de la branche `yolo` comme `main` du nouveau dépôt, puis script de renommage |
| Obscura | `crates/browser/*` : code **première partie** (le port JSC le rend non rebasable), importé depuis le fork remis à jour + patches de la copie `aphrody` | Copie `crates/web/obscura-*` supprimée dès que `plugin-obscura` passe la fumigation | Fast-forward du fork, diff trois voies, import, port JSC (chantier B) |
| Crawl, extraction, index | `crates/plugins/crawl` + `crates/web/{crawl,extract,index,detect}` (niveau 0/1) | Supprimés d'`aphrody` après le one shot 2 ; `aphrody-web-service` consomme `yolo:web` | Déplacement de répertoires + retrait de tokio/reqwest/rusqlite |
| Tauri 3, wry, tao | **Pins git** sur `aphrody-labs/tauri` (`crates/tauri-runtime`, `tauri-runtime-wry`), `aphrody-labs/wry`, `aphrody-labs/tao`, compilés uniquement par la feature `gui` et `plugin-tauri` (CLI, bundler, create-tauri-app : pins eux aussi) | `crates/tauri/*` (55 crates) supprimé ; les apps Tauri d'`aphrody` dépendent des mêmes pins | Les patches locaux d'`aphrody` sur Tauri sont poussés dans les forks `aphrody-labs/*`, pas gardés en copie |
| wgpu | `crates/plugins/wgpu` + `aphrody-gpu-backend` ; wgpu 30 depuis crates.io | `crates/ui/render` (feature `gpu`) et `crates/native/gpu-backend` migrent vers `yolo` | Une seule version de wgpu, imposée par `yolo` |
| Next.js 16 / Turbopack / SWC | `crates/plugins/next` : pins git sur le fork `aphrody-labs/next.js` (crates `turbopack-*`, `swc_core`) | `crates/compat/oxc-bridge` migre vers `yolo` | Jamais de copie du dépôt next.js |
| CEF | `crates/plugins/cef` : pin git sur `aphrody-tauri-runtime-cef` déplacé dans le fork `aphrody-labs/tauri` | Supprimé d'`aphrody` | Build lourd confiné au plugin |
| ABI runtime | `crates/core/plugin-abi` (ex `yolo-runtime` d'`aphrody`, ABI `v1`) | `crates/engine/*` supprimé | `yolo` publie l'ABI, `aphrody` la consomme |
| Logique pure d'`aphrody` (82 crates de niveau 0) | Celles dont le moteur a besoin (`web-index`, `web-extract`, `m3-tokens`, `svg`, `softraster`, `search`) | Toutes les autres restent dans `aphrody`, mais sous les mêmes règles de niveau (`xtask tiers` tourne dans les deux dépôts) | Critère : une crate migre vers `yolo` quand un plugin ou le noyau l'importe ; sinon elle reste produit |
| Produits, IA, OS, infra, Google, Discord | — | Restent, et consomment `yolo` par le runtime précompilé (`~/.yolo`), les paquets `@aphrody/plugin-*` et des pins git sur les crates `aphrody-*` de `yolo` | Pas de dépendance inverse : `yolo` ne connaît jamais `aphrody` |

Conventions du dépôt `yolo`, pensées pour Claude Code :

1. **Un point d'entrée par action, et un seul** : `just build` (noyau), `just plugin <nom>`, `just check` (`cargo check` sur `default-members`), `just smoke` (les cinq commandes de fumigation, sortie comparée à `smoke/expected/`), `just bench` (`hyperfine` démarrage + taille), `just tiers` (classement 0/1/2 et refus de régression). Aucune commande n'existe hors du `Justfile`.
2. **`CLAUDE.md` de 100 lignes maximum** : arborescence, les six recettes `just`, les interdits (crates bannies, `todo!`, build WebKit), la politique de stubs et de `BROKEN.md`, l'identité de commit. Tout le reste vit dans `docs/` et est référencé, pas recopié.
3. **Chaque crate a un `README.md` de dix lignes** : rôle, niveau (0/1/2), dépendances autorisées, propriétaire (noyau ou plugin), comment la tester seule. `xtask tiers` vérifie que le README et le `Cargo.toml` sont d'accord.
4. **Les décisions vivent dans le dépôt** : `docs/decisions/NNNN-*.md` (ADR courts), `BROKEN.md` (état cassé connu, une ligne par item, fermé par un commit), `.claude/prompts/*.md` (les prompts de session versionnés, dont celui du one shot 1).
5. **Scripts idempotents et rejouables** : `scripts/fusion/*.ts` (renommage, import d'Obscura, génération des stubs) se relancent sans effet de bord ; un agent qui doute relance le script au lieu de corriger à la main.
6. **Worktrees et Cargo parallèle autorisés** : un worktree par chantier, `cargo check -p` par l'agent lui-même, sccache partagé ; l'intégrateur fusionne dans l'ordre B → C → A → E → D. Les contraintes de `.coord/claims` et `cargo-serial.sh` restent propres à `aphrody`.
7. **Pins, pas de copies** : `scripts/build/deps/*.ts` pour le C/C++ (modèle Bun), `[workspace.dependencies]` avec `git = …, rev = …` pour le Rust des forks ; `just bump <dep>` ouvre la PR de mise à jour ; `cargo deny` refuse deux versions d'une même crate hors liste blanche.
8. **Un seul `Cargo.lock`, un seul `rust-toolchain.toml`** (nightly `2026-09-15`, fork rust de Bun), `default-members` = noyau ; les plugins ne se compilent que par leur recette.

Conséquences immédiates sur le reste du plan : le J0 du one shot 1 devient la création du dépôt (push du fork, renommage, import d'Obscura, squelette `crates/plugins`, `Justfile`, `CLAUDE.md`, `BROKEN.md`) au lieu de la migration d'`aphrody` vers le nightly ; les chantiers A–E et la fumigation sont inchangés ; les sections « Le dépôt `aphrody` comme cible » et « Base commune du monorepo » se lisent désormais comme la description de `yolo` ; le nettoyage d'`aphrody` (suppression de `crates/tauri`, `crates/web/obscura-*`, `crates/engine`, bascule des pins) est un one shot à part, après le one shot 2, exécuté sous les règles du `CLAUDE.md` d'`aphrody`. Les prompts `GOAL-FUSION.md` et `PROMPT-ONESHOT-1.md` sont réécrits pour cette cible.

## Simplification retenue : Obscura est aussi un plugin natif

Le noyau `bun` reste le Bun-Rust d'origine, avec son démarrage de quelques millisecondes ; Obscura (DOM, rendu, transport, CDP, MCP, runtime de page) devient `@aphrody/plugin-obscura`, chargé à la demande, et le crawl `@aphrody/plugin-crawl` par-dessus. Cette décision prime sur les passages du plan qui plaçaient ces crates dans le binaire ; les chantiers, budgets et dates du one shot restent les mêmes, seul l'endroit où le code atterrit change.

| Ce qui entre dans le noyau `bun` (patches, petits) | Ce qui vit dans les plugins (gros) |
| --- | --- |
| **Hôte de realm** (`aphrody-realm-host`, ~500 lignes dans `crates/bun/jsc`) : créer un global object JSC isolé par page dans un Worker, y installer des fonctions hôtes fournies par un plugin (table de pointeurs C `(name, fn, arity)`), évaluer un script avec cache de bytecode, interrompre (watchdog), lire/écrire des valeurs par JSON ou buffers partagés. C'est le `Deno.core.ops` générique : il ne sait rien du DOM | `@aphrody/plugin-obscura` : `aphrody-page-runtime` (`bootstrap.js` + 70 ops branchés sur l'hôte de realm), `aphrody-dom`, `aphrody-render`, `aphrody-browser`, `aphrody-browser-transport`, `aphrody-cdp`, `aphrody-browser-mcp` ; expose `bun:browser`, `Bun.Browser`, `bun browser …` |
| **Chargeur de plugins** : manifeste, signature Ed25519, cache `~/.bun/plugins`, `bun plugin add/remove/list`, enregistrement de sous-commandes CLI et de modules `bun:*` virtuels résolus vers un plugin ; chargement **paresseux** : rien n'est `dlopen` tant qu'une commande ou un `import` ne le demande pas | `@aphrody/plugin-crawl` : `aphrody-web-crawl`, `-extract`, `-index`, `-detect`, daemon TS, `FrontierStore` SQLite/Postgres/Redis ; expose `bun crawl …` et `bun:web` |
| **Points d'extension déjà présents ou à élargir** : `Bun.WebView` accepte un backend fourni par plugin (`backend: "obscura"` = socket vers le CDP du plugin) ; `Bun.serve` et `uws` accessibles aux plugins par N-API pour le serveur CDP ; `aphrody-http` exporté aux plugins par une table de fonctions C stable (`aphrody_http_v1`) pour que le transport Obscura n'embarque pas sa propre pile réseau | `@aphrody/plugin-tauri`, `plugin-next`, `plugin-cef`, `plugin-wgpu`, `plugin-ml`, `plugin-x`, `plugin-discord` (sections suivantes) |
| **Budget de démarrage** gardé par mesure : `bun -e 1` et `bun run` d'un script vide comparés avant/après chaque patch du noyau (`hyperfine`, 100 exécutions) ; tout patch qui ajoute plus de 0,5 ms au démarrage ou 1 Mo au binaire est refusé ou déplacé dans un plugin | Les plugins payent leur propre démarrage : `plugin-obscura` précharge `bootstrap.js` depuis son cache de bytecode, et garde une réserve de realms prêts pour les pages suivantes |

Conséquences pratiques :

- Le workspace `aphrody` garde les mêmes crates aux mêmes endroits ; ce qui change est le `crate-type` des crates de tête (`cdylib` N-API sous `crates/plugins/obscura` et `crates/plugins/crawl`) et le fait que `bun run build:bun` ne les compile pas.
- L'ABI entre noyau et plugins est versionnée (`aphrody_plugin_abi = 1`) et testée par un plugin témoin minuscule dans la CI ; N-API couvre les objets JS, les tables C couvrent les chemins chauds (ops DOM, HTTP, realm).
- Les tests Obscura et la suite anti-détection tournent contre `bun` + plugin, jamais contre un binaire spécial.
- La sortie du one shot 1 devient : noyau `bun` patché (hôte de realm + chargeur) et `@aphrody/plugin-obscura` qui passe la fumigation en cinq points ; les chantiers A–E ne changent pas de contenu, le chantier B gagne une première heure pour écrire l'hôte de realm dans le noyau avant de porter les ops dessus.
- Mode service et mode graphique restent `bun crawl daemon` et `bun crawl --gui` : la commande vient du plugin, le binaire reste le même `bun`.

## État des lieux : Obscura

Obscura est un workspace de 10 crates (plus `test-support`), ~172 000 lignes de Rust, organisé en couches strictes : chaque crate n'appelle que la couche du dessous. Le fork `aphrody-labs/obscura` (commit `0cdd42e`, 1er octobre) n'a aucune modification propre ; il est 62 fichiers derrière l'upstream `h4ckf0r0day/obscura` (commits des 2 au 4 octobre).

| Crate | Rôle | Lignes Rust | Dépendances structurantes | Features |
| --- | --- | --- | --- | --- |
| `obscura-cli` | Binaires `obscura` et `obscura-worker` : `fetch`, `serve`, `scrape`, `mcp` | 4 710 | clap 4, tokio, tracing-subscriber | `render`, `stealth` |
| `obscura-cdp` | Serveur Chrome DevTools Protocol (WebSocket, dispatch, domaines Page/Runtime/DOM/Network/Fetch/Input) | 23 588 | tokio-tungstenite 0.26, uuid, image/png/jpeg-encoder/fast_image_resize | `render`, `stealth` |
| `obscura-mcp` | Serveur Model Context Protocol (stdio et HTTP) | 3 556 | tokio, serde_json | `render`, `stealth` |
| `obscura` | API Rust embarquable : `Browser`, `Page`, `Element`, `CookieStore`, interception | 2 284 | tokio `rt` | `api`, `render`, `stealth` |
| `obscura-browser` | Type `Page`, navigation, cycle de vie, capture écran/PDF, interception | 12 319 | tokio, futures, image | `render`, `stealth` |
| `obscura-js` | Runtime V8 : `bootstrap.js` (16 918 lignes) + 71 ops `#[op2]`, snapshot V8 généré au build, chargeur de modules, watchdog | 36 228 (dont ~18 000 de tests) | deno_core 0.412 (V8 150.4), RustCrypto (sha1/sha2/hmac/aes-gcm/pbkdf2/hkdf), getrandom 0.2, psl | `render`, `stealth` |
| `obscura-net` | Client HTTP, client stealth, jarre à cookies, cache robots.txt, liste de 3 520 traqueurs | 6 711 | reqwest 0.12 + rustls + ring, wreq `=6.0.0-rc.29` + wreq-util `=3.0.0-rc.12` (BoringSSL), encoding_rs, async-trait, tempfile | `stealth` |
| `obscura-dom` | Arbre DOM, sélecteurs CSS | 5 782 | html5ever 0.39, selectors 0.26, cssparser 0.34, servo_arc | — |
| `obscura-render` | Cascade CSS, mise en page retenue (taffy), façonnage du texte, peinture CPU, SVG, PDF | 77 036 | taffy 0.12 (vendorisé), cosmic-text `=0.14.2` (vendorisé), swash, tiny-skia, resvg/usvg 0.47, ureq 2 (chargeur synchrone), image | `paint` |
| `obscura-ssrf` | Liste de refus SSRF partagée, opt-in réseau privé | 139 | aucune | — |

Points qui pèsent sur la fusion :

- **Toolchain** : Rust stable 1.75+, edition 2021, `resolver = "2"`, deux `[patch.crates-io]` (taffy, cosmic-text dans `vendor/`). Profil `release-dist` en `opt-level = "s"`, LTO fat, `strip`.
- **`panic = "unwind"` est requis** : les ops enveloppent leur corps dans `catch_unwind` pour qu'une panique dégénère en erreur au lieu de traverser le cadre FFI de V8. Bun compile tout en `panic = "abort"`.
- **Un seul isolate V8 par processus**, mono-thread par conception. Un `tokio::sync::Mutex` global (`v8_lock`, acquis par le dispatcher CDP) sérialise tout le travail JS ; le `scrape` parallèle passe par des processus `obscura-worker`. Plusieurs `ObscuraJsRuntime` peuvent néanmoins coexister sur un même thread (test `multi_isolate_teardown`).
- **Snapshot V8 au build** : `build.rs` exécute V8 sur la machine hôte pour sérialiser `bootstrap.js` ; en compilation croisée il faut un `mksnapshot` produit par le build GN de V8.
- **Trois piles TLS** selon les features : rustls + ring (reqwest), BoringSSL via wreq (`prefix-symbols` sur Linux/Android seulement, pour éviter les collisions avec un OpenSSL système), et `ureq` pour le chargeur synchrone du rendu.
- **Doublons internes** déjà présents dans son `Cargo.lock` : getrandom 0.2/0.3/0.4, thiserror 1 et 2, rustix 0.38 et 1.1, quatre versions de windows-sys, deux de phf, rand, hashbrown, bindgen.
- **Tests** : tests unitaires lourds dans `obscura-js` (runtime, ops), tests d'intégration CDP et CLI, alias `cargo test-js` (nextest, `RUST_TEST_THREADS=1`), suite de conformité WPT, parcours d'obstacles et corpus réel dans le dépôt séparé `obscura-benchmark`.
- **Pont JS ↔ Rust étroit** : `bootstrap.js` n'accède à Rust que par `globalThis.Deno.core` (70 ops distincts, un seul alias en tête de fichier). C'est ce qui rend un portage vers JSC envisageable.

## État des lieux : Bun-Rust (`aphrody-labs/bun`, branche `yolo`)

Le fork n'est plus le Bun Zig/C++ d'upstream : c'est un portage complet en Rust (commit `954db0c`, 5 octobre), avec un workspace de ~105 crates sous `src/` dont `bun_runtime` est la racine, et 576 fichiers C++ qui restent la colle vers WebKit/JavaScriptCore. Tout ce dont Obscura a besoin comme infrastructure y existe déjà, sauf le proxy SOCKS5.

| Domaine | Ce que le fork fournit | Conséquence pour la fusion |
| --- | --- | --- |
| Moteur JS | JavaScriptCore (WebKit `autobuild`), liaison par `bun_jsc`, `sys_jsc`, `jsc_macros` ; Workers WebCore = une VM JSC par thread | Un runtime de page par Worker devient possible ; V8 n'a pas d'équivalent natif ici |
| Convention de binding | 11 crates `*_jsc` séparées des crates métier, 31 définitions `*.classes.ts` générées en `generated_classes`, `NativePromiseContext` pour les promesses natives ; `HTMLRewriter` (`src/runtime/api/html_rewriter.rs`) enveloppe la crate Rust `lol_html` | Modèle direct pour `bun_browser` + `bun_browser_jsc` |
| Boucle d'événements | `bun_event_loop` sur uSockets ; `ConcurrentTask` et `enqueue_task_concurrent` pour poster du travail depuis un autre thread | Remplace tokio ; le moteur de page tourne hors du thread JS et notifie par `ConcurrentTask` |
| Client HTTP | `bun_http` : H1, H2 (`h2_client`), H3 (`h3_client`, lsquic), thread HTTP dédié, `ProxyTunnel` (CONNECT), décompression, client WebSocket, cache de sessions TLS | Remplace reqwest, hyper, ureq ; **SOCKS5 à ajouter** (Obscura l'accepte via `--proxy socks5://`) |
| TLS | BoringSSL, fork `oven-sh/boringssl` (commit `41bf9b5`), crates `bun_boringssl` et `bun_boringssl_sys` | Même bibliothèque que `wreq` : le profil ClientHello Chrome se réécrit dessus, sans seconde copie |
| DNS | `bun_dns` sur c-ares | Remplace le résolveur de hyper ; accueille la politique SSRF |
| Compression | zlib, libdeflate, brotli, zstd vendorisés en C (`scripts/build/deps/*.ts`) | Remplacent flate2, miniz_oxide, brotli 8, zstd 0.13 |
| Codecs image | libjpeg-turbo, libspng, libwebp vendorisés | Remplacent `image`, `png`, `jpeg-encoder` pour l'encodage des captures |
| Serveur WebSocket | `uws` (`Bun.serve`) | Remplace tokio-tungstenite pour le serveur CDP |
| HTML / CSS | `lol_html` 2.7.2 (branche `bun`, réécriture en flux), `bun_css` (cssparser 0.36, selectors 0.33) | `lol_html` ne remplace pas un DOM : html5ever reste ; les versions cssparser/selectors sont à aligner |
| Allocateur, threads, logs, CLI | mimalloc (`bun_alloc`), `bun_threading`, `bun_output`/`bun_perf`, `bun_clap` | Remplacent l'allocateur système, parking_lot, tracing, clap |
| Build | `scripts/build.ts` (ninja) ; `rust.ts` planifie `cargo build -p bun_runtime --unit-graph` avec `-Zbuild-std=core,alloc,std,proc_macro,panic_abort`, `-Clinker-plugin-lto`, `-Ctarget-cpu` dérivé de `-march` ; le lien final est fait par ninja avec les objets C++ | Toute crate ajoutée passe par ce plan ; une bibliothèque précompilée (V8) doit être déclarée comme dépendance `deps/*.ts` |
| Toolchain | `nightly-2026-09-15`, edition 2024, 11 cibles préinstallées + aarch64-freebsd via build-std, `panic = "abort"` en dev et release, `lto = "off"` + `codegen-units = 1` (ThinLTO au lien) | Obscura doit compiler sur ce nightly et vivre sans `catch_unwind` |
| Lints | `[workspace.lints]` : `warnings`, `dead_code`, `unreachable_pub`, `unused_*` en `deny` ; `clippy.toml` interdit `std::fs`, `std::sync::Mutex`, `HashMap` std, `println!`, `str::find`, `std::thread::spawn`, `std::process::Command`… | Les crates Obscura n'y passent pas en l'état ; adoption crate par crate |
| Tests et revue | 2 007 fichiers `*.test.ts` (runner `bun test`), 77 fichiers Rust avec `#[test]`, `rust:check`, `rust:clippy`, `rust:check-all` (toutes cibles), lints de source dans `test/internal/source-lints`, `REVIEW.md` et `.claude/docs/landing-prs.md` comme critères de merge | Les tests Obscura (Rust) et la suite anti-détection s'ajoutent à ce dispositif |

Deux faits de build conditionnent le pont V8 de la phase 1 :

- `lol_html` montre la voie : une crate Rust externe est compilée comme rlib du workspace (pas de `staticlib`, qui dupliquerait `std`), récupérée dans `vendor/` par un script `deps/*.ts` et exclue des `members`. Les crates Obscura, elles, deviennent des membres à part entière.
- La crate `v8` (rusty_v8) télécharge une archive statique précompilée par cible et embarque sa propre ICU ; la matrice CI de rusty_v8 v150.4.0 la publie pour Linux gnu et musl (x86_64, aarch64), riscv64, macOS (x86_64, arm64) et Windows x86_64 MSVC ; rien pour Android, FreeBSD ni Windows ARM64, trois cibles de Bun. Le pont V8 est donc une feature de build (`browser`) activée par cible, jamais une dépendance inconditionnelle de `bun_runtime`.

## Doublons, goulots d'étranglement et choix d'architecture

Onze fonctions existent deux fois ; pour chacune la cible est la pile de Bun, renommée `aphrody-*`, sauf trois cas où Obscura garde la sienne (DOM, rendu, URL). Chaque ligne est un ordre de travail du one shot, affecté à une vague (J1 = chantiers parallèles, J2 = intégration).

| Fonction | Obscura aujourd'hui | Bun-Rust aujourd'hui | Cible unifiée | Vague |
| --- | --- | --- | --- | --- |
| Moteur JS de page | V8 150.4 + deno_core 0.412, snapshot au build | JavaScriptCore (`bun_jsc`) | `aphrody-jsc` expose `Deno.core.ops` ; V8 et deno_core jamais importés | J1 · chantier B |
| Client HTTP | reqwest 0.12 + hyper 1 ; ureq 2 pour le rendu | `bun_http` (H1/H2/H3, thread dédié, CONNECT) | `aphrody-http` ; SOCKS5 = stub `Err("socks5: non porté")` si hors budget | J1 · chantier A |
| TLS | rustls + ring ; wreq rc.29 + BoringSSL (stealth) | BoringSSL `oven-sh` | BoringSSL de Bun ; profil ClientHello Chrome = meilleur effort (suites + ALPN + GREASE), le reste dans `BROKEN.md` | J1 · A |
| DNS et SSRF | résolveur de hyper ; `obscura-ssrf` | `bun_dns` (c-ares) | `aphrody-dns` + module `private_network` | J1 · A |
| Compression | flate2, miniz_oxide, brotli 8, zstd 0.13 | libdeflate, brotli, zstd (C) | piles C de Bun (`aphrody-zlib`, `aphrody-brotli`, `aphrody-zstd`) | J1 · A |
| Boucle d'événements | tokio 1.52 (`LocalSet`, `Mutex` global), futures, async-trait | `bun_event_loop`, `ConcurrentTask` | `aphrody-event-loop` ; moteur de page sur thread Worker, `async fn` d'Obscura réduits à des fonctions bloquantes sur ce thread | J1 · C |
| Serveur WebSocket (CDP) | tokio-tungstenite 0.26 | `uws` | `aphrody-uws` | J1 · D |
| Crypto de page (`crypto.subtle`) | RustCrypto (sha1, sha2, hmac, aes-gcm, pbkdf2, hkdf), getrandom 0.2 | WebCrypto de Bun sur BoringSSL | WebCrypto de Bun injectée dans le realm de page | J1 · B |
| Codecs image | image 0.25, png 0.18, jpeg-encoder, fast_image_resize | libjpeg-turbo, libspng, libwebp | codecs de Bun ; `image` toléré en J2 si le temps manque | J1 · E |
| CLI | clap 4.6 | `bun_clap` | `aphrody-clap`, sous-commande `bun browser` | J1 · D |
| Logs, métriques | tracing, tracing-subscriber | `bun_output`, `bun_perf` | `aphrody-output` (macro `tracing::*` → `debug_warn!` par script) | J0 |
| Allocateur, threads, fichiers | allocateur système, parking_lot, std::fs, tempfile | mimalloc, `bun_threading`, `bun_sys` | ceux de Bun ; `std::fs` toléré jusqu'à adoption des lints | J2 |
| ICU | copie embarquée dans V8 | copie de WebKit | WebKit seule, par construction | J1 · B |
| Analyse HTML / CSS | html5ever 0.39, selectors 0.26, cssparser 0.34 | lol_html 2.7, `bun_css` (cssparser 0.36, selectors 0.33) | html5ever conservé ; cssparser 0.36 et selectors 0.33 partout | J0 |
| URL | `url` 2.5, idna, percent-encoding | `bun_url` | `url` conservé (ancré dans le DOM et la jarre à cookies) | — |
| Mise en page et peinture | taffy, cosmic-text, swash, tiny-skia, resvg | — | conservés dans `aphrody-render` | — |
| Versions croisées | getrandom 0.2/0.3/0.4, thiserror 1/2, rustix 0.38/1.1, strum 0.27, itertools 0.13, derive_more 0.99 | getrandom 0.4, thiserror 2, rustix 0.38, strum 0.26, itertools 0.10, derive_more 2 | une version par crate, celle de Bun, imposée par `[workspace.dependencies]` | J0 |

Goulots d'étranglement levés par construction :

1. **Le verrou V8 global** (un isolate par processus, `Mutex` dans le dispatcher CDP, processus `obscura-worker` pour `scrape`) disparaît : un realm de page par Worker JSC, N pages en parallèle dans un processus.
2. **Deux boucles d'événements** : tokio n'est pas importé ; le moteur de page tourne sur un thread Worker et notifie le thread JS par `ConcurrentTask`.
3. **Trois piles TLS et deux ICU** : une seule BoringSSL, une seule ICU, celles de WebKit et de Bun.
4. **Le snapshot V8 au build** (`build.rs` exécutant V8 sur l'hôte, `mksnapshot` en compilation croisée) : remplacé par l'évaluation de `bootstrap.js` à la création du realm, avec cache de bytecode JSC si le budget le permet, sinon évaluation à chaque page (coût de démarrage accepté à la livraison).

Choix d'architecture retenu : **JSC direct, divergence totale, infrastructure Bun imposée**. Les alternatives écartées : garder V8 comme pont (deux moteurs, deux ICU, archive rusty_v8 à intégrer au build ninja, `panic = "abort"` contre le protocole `catch_unwind` d'Obscura ; incompatible avec « un seul binaire » et inutile si l'on accepte la casse) ; vendoring + adaptateur mince (rien n'est dédupliqué) ; port progressif en mois (contraire au one shot).

Sur « Bun-Rust peut-il être compatible avec deno_core ? » : pas au sens littéral, `deno_core` est V8 (`JsRuntime`, ops, snapshots, `v8::` partout). Ce qui est fait ici : `aphrody-jsc` fournit à `bootstrap.js` le même objet `globalThis.Deno.core` (70 ops en fonctions hôtes, `#[op2]` → `host_fn`). Les 164 appels `v8::` directs d'`obscura-js` (contextes, `Global`, `TryCatch`, compilation de scripts, watchdog `IsolateHandle`) sont la partie réécrite, pas les 70 ops ni le JS.

## Architecture cible

```text
 bun:browser         CLI bun browser …     Serveur CDP         Serveur MCP
 aphrody-browser-jsc aphrody-cli           aphrody-cdp (uws)   aphrody-browser-mcp
        └───────────────┴──────────┬────────┴───────────────────┘
          aphrody-browser — Browser, Page, cycle de vie, interception, capture
                                   │
   aphrody-page-runtime — bootstrap.js (16 900 lignes) + 70 ops sur JSC
   (façade Deno.core.ops exposée par aphrody-jsc ; ni V8, ni deno_core, ni snapshot)
                  │                                    │
   aphrody-dom — html5ever, selectors       aphrody-render — taffy, cosmic-text, tiny-skia
                  │                                    │
   Infrastructure partagée (crates aphrody-*, une seule copie de chaque) :
   aphrody-http (H1/H2/H3) · BoringSSL + profil ClientHello Chrome · aphrody-dns + SSRF
   libdeflate · brotli · zstd · libjpeg-turbo · libspng · libwebp · WebCrypto
   event loop + ConcurrentTask · threading · mimalloc · output · clap
                                   │
   JavaScriptCore / WebKit — un seul moteur, une seule ICU
```

Les quatre surfaces (module JS, CLI, CDP, MCP) ne parlent qu'à `aphrody-browser` ; le moteur de page est un realm JavaScriptCore par page, exécuté dans un Worker ; tout ce qui est sous la ligne DOM/rendu est l'infrastructure existante de Bun, renommée.

Règle de nommage, appliquée par script à tout le workspace : nom de paquet `aphrody-<nom>` (tirets), nom de bibliothèque `aphrody_<nom>` (soulignés, ce que `use` voit), dossier `src/<nom>`, déclaration unique dans `[workspace.dependencies]` et `aphrody-<nom>.workspace = true` partout. `bun_http` devient donc `aphrody-http` (`use aphrody_http::`), `bun_jsc` devient `aphrody-jsc`, et ainsi de suite pour les ~105 crates ; le binaire reste `bun`.

Correspondance des crates Obscura :

| Crate Obscura | Crate unifiée | Ce qui change |
| --- | --- | --- |
| `obscura` + `obscura-browser` | `aphrody-browser` (`crates/web/browser`) | Fusionnées ; `async fn` tokio → fonctions bloquantes sur le thread du Worker |
| `obscura-js` | `aphrody-page-runtime` (`crates/web/page_runtime`) | Realm JSC par page, `Deno.core.ops` servi par `aphrody-jsc`, ops `#[op2]` → fonctions hôtes, snapshot supprimé |
| `obscura-dom` | `aphrody-dom` | cssparser 0.36, selectors 0.33 |
| `obscura-render` | `aphrody-render` | `ureq` → `aphrody-http` ; encodage image par les codecs de Bun (ou `image` toléré en J2) |
| `obscura-net` | `aphrody-browser-transport` | Ne garde que jarre à cookies, cache robots, liste de traqueurs, profil stealth ; transport = `aphrody-http` |
| `obscura-ssrf` | module `private_network` d'`aphrody-dns` | Politique partagée par `fetch`, `Bun.serve` et le navigateur |
| `obscura-cdp` | `aphrody-cdp` | Serveur WebSocket sur `aphrody-uws` ; une cible = un Worker |
| `obscura-mcp` | `aphrody-browser-mcp` | Transport HTTP sur `Bun.serve` |
| `obscura-cli` | sous-commande `browser` d'`aphrody-cli` | `clap` → `aphrody-clap` ; `obscura-worker` supprimé |
| — | `aphrody-browser-jsc` (nouveau) | Classes `Browser`, `Page`, `Element` en `*.classes.ts`, promesses via `NativePromiseContext`, module `bun:browser` et global `Bun.Browser` |

Surface JavaScript (`bun:browser`), calquée sur l'API Rust d'Obscura et le vocabulaire Puppeteer :

```ts
import { Browser } from "bun:browser"; // ou Bun.Browser, sans import

const browser = await Browser.launch({
  stealth: true,
  proxy: "http://127.0.0.1:8080",
  storageDir: "./profile",
  allowPrivateNetwork: false,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on("response", (req, res) => { /* capture des XHR/fetch de la page */ });
page.route(/\/ads\//, route => route.abort());

await page.goto("https://example.com", { waitUntil: "networkidle0", timeout: 10_000 });
const title = await page.evaluate("document.title");
const html = page.content();
await page.waitForSelector("h1", { timeout: 5_000 });
await page.screenshot({ path: "page.png", fullPage: true });
await page.pdf({ path: "page.pdf", format: "A4", printBackground: true });

await browser.close();
```

CLI : chaque commande Obscura devient une sous-commande `bun browser`, flags inchangés (`fetch`, `serve`, `scrape`, `mcp`, `--proxy`, `--stealth`, `--allow-private-network`) ; `--v8-flags` disparaît. Aucune installation : le navigateur est dans le binaire `bun` que l'utilisateur a déjà.

Modèle d'exécution : un moteur de page vit sur un thread Worker (une VM JSC dédiée), jamais sur le thread JS principal ; les appels depuis `bun:browser` sont des promesses résolues par `ConcurrentTask`. `scrape --concurrency 25` lance 25 Workers dans le processus. Le serveur CDP garde la sémantique actuelle (une session par cible) mais route chaque cible vers un Worker. Le code asynchrone d'Obscura (tokio) devient synchrone sur le thread du Worker : c'est la simplification qui rend le portage faisable en un jour, au prix d'un `fetch()` de page qui bloque son Worker le temps de la réponse.

*(Suite dans la partie 2 : Plan d'exécution one shot, dépôt cible, service 24/7, mode graphique, apps Tauri, plugins, base commune du monorepo.)*
