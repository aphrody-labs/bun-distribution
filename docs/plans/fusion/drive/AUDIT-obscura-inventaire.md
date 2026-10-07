# Préparation : inventaire et absorption d'Obscura dans le fork Bun (`yolo`)

Date : 2026-10-05. Analyse en lecture seule de `/home/aphro/aphrody` (HEAD `70541b5a2`) et `vendor/bun`
(HEAD `c439b6fbd`, merge upstream 2026-10-05). Outils : `rg`, `fd`, `bat`, `eza`, `git` (lecture), `bun -e`,
`cargo metadata --no-deps --offline`. Aucune compilation : tout ce qui touche au graphe de features résolu,
aux tailles ou aux temps est **statique (manifests/lockfile)** et doit être confirmé sur la fabrique
(`cargo tree -e features`, mesures).

## 0. Constats clés

1. **V8 n'entre que par `obscura-js`** : `obscura-js` → `deno_core 0.412` → `deno_v8 0.4.0` → `v8 150.4.0`
   (rusty_v8) (`crates/web/obscura-js/Cargo.toml:21,26` ; Cargo.lock : `deno_core <- obscura-js` seul).
   Aucun autre crate du workspace ne dépend de `deno_core`/`v8`.
2. **V8 est déjà dans les processus Bun** : `aphrody-ffi` (cdylib chargée par `bun:ffi`) → `aphrody-command`
   → `aphrody-mcp` (feature par défaut `native-browser` → `aphrody-web-service/render`,
   `crates/ai/mcp/Cargo.toml:21,27`) et → `aphrody-web-engine` (défaut `render`,
   `crates/web/web-engine/Cargo.toml:10,13`) → `obscura-mcp`/`obscura-browser` → `obscura-js` → V8. Donc
   `libaphrody_ffi`, le binaire multi-call `aphrody` et le noyau embarquent V8 + le rendu
   (`crates/os/kernel/core/build.rs:5-10` le documente). JSC (Bun) et V8 cohabitent déjà en processus ;
   le correctif `simdutf-rio` existe précisément pour ça (`tools/config/upstream-sources.json`, entrée
   `simdutf-rio` : « does not collide with V8's own simdutf in the same process »).
3. **`Bun.WebView` existe dans le fork** (`vendor/bun/packages/bun-types/bun.d.ts:9553-9990`,
   `vendor/bun/src/runtime/webview/*`, ~119 tests dans `vendor/bun/test/js/bun/webview/`). Backend
   `"webkit"` (macOS) ou `"chrome"` = **client CDP natif** (pipe ou `ws://`). Les **21 méthodes/événements
   CDP** émis par `ChromeBackend.cpp` sont tous présents dans `obscura-cdp` (comparaison lexicale, à
   valider en exécution) : `new Bun.WebView({backend:{type:"chrome",url:"ws://127.0.0.1:9222/devtools/browser"}})`
   devrait piloter Obscura **sans V8 dans le processus Bun**. Deux trous : pas de transport pipe côté
   Obscura, pas d'en-tête `Authorization` côté Bun (`ChromeBackend.cpp:482`
   `WebCore::WebSocket::create(*ctx, wsUrl)`).
4. **Aucun système de modules `yolo:*` n'existe encore** : `HardcodedModule.rs` n'expose que
   `bun:app|ffi|jsc|main|test|wrap|sqlite` + les paquets npm absorbés (`vendor/bun/src/resolve_builtins/HardcodedModule.rs:769`).
   La doc `docs/reference/upstream-bun/APHRODY-FORK.md` décrit un `bun:aphrody` **absent** du fork
   (`fd -i aphrody vendor/bun/src vendor/bun/packages vendor/bun/test` = vide) : doc périmée.
   Mécanismes réutilisables : `src/js/bun/*.ts` + `HardcodedModule.rs` + classes générées
   (`*.classes.ts`, 31 fichiers ; `src/codegen/generate-classes.ts`) + `host_fn` Rust (173 fichiers).
5. **Découverte `v8x`** : `deno_v8 0.4.0` (déjà dans Cargo.lock) sait basculer sur `v8x 149.4.0-rc.4`
   (littledivy/v8x), qui réimplémente l'ABI C `v8__*` de rusty_v8 sur **JSC ou QuickJS** (README :
   « deno_core compiles unchanged »). Mais dans cette version le backend JSC est **macOS seulement**
   (`v8x build.rs:120-126` panique ailleurs) et embarque son propre WebKit, pas celui de Bun.
   Sous Linux seul QuickJS est possible (`deno_core` feature `quickjs`). C'est un gabarit d'API V8→JSC
   (`v8x/src/jsc/{isolate,terminate,module,bytecode}.rs`), pas une solution prête. Jamais mentionné dans les docs du dépôt.
6. **Provenance incomplète** : Obscura est absent de `tools/config/upstream-sources.json` (intégrés :
   mcp-bridge, simdutf-rio, dialog, serde-saphyr, koharu-ml-base) et de `THIRD-PARTY.md`.
   Seule trace : `docs/reference/web/crates/aphrody-obscura/OBSCURA-UPSTREAM.txt:1-3`
   (h4ckf0r0day/obscura @ `1a3169da276d7720732c7b20535474942917fb83`), qui affirme « Upstream code otherwise
   unmodified » et « every obscura crate is `publish = false` ». Les deux affirmations sont fausses aujourd'hui :
   19 commits locaux touchent `crates/web/obscura*`, des versions de dépendances ont été portées
   ((removed import receipt)), et `5bde43dad` a rendu les crates publiables.
   Polices Liberation/DejaVu sans provenance (`crates/web/obscura-render/assets/FONT-PROVENANCE.md` ne couvre que Noto).
7. **Directive JSC/V8 orpheline** : `AGENTS.md:19` renvoie aux contrats de PLAN, mais la directive du
   2026-10-05 (« Bun conserve JSC/WebKit, Obscura apporte le fournisseur V8/headless… Qualifier : DOM, GC,
   exceptions, promesses, microtasks, modules, workers, timers, interruptions et destruction ») n'existe plus
   que dans `git show adec4dd67:PLAN.md` (l. 40-45) ; `MEMORY.md:111` le constate. Le plan final doit la réintégrer.

## 1. Inventaire des crates

LOC Rust non vides et hors commentaires, comptées par `Bun.Glob` ; « inline » = modules `#[cfg(test)] mod … {`
en fin de fichier ; « ext » = `tests/` + `examples/`. Tests = attributs `#[test]`/`#[tokio::test]`.

| Crate (package, lib) | Rôle | Prod | Tests inline | Ext | #tests (inline/ext) |
|---|---|---:|---:|---:|---|
| `crates/web/obscura` (`aphrody-obscura`, lib `obscura`) | Façade Rust : `Browser`, `Page`, `CookieStore`, interception | 370 | 0 | 1 323 | 0 / 33 |
| `obscura-browser` | `BrowserContext`, `Page` (84 fn pub), lifecycle `WaitUntil`, profils, PDF raster (`render`) | 4 462 | 4 379 | 218 | 104 / 4 |
| `obscura-cdp` | Serveur CDP WebSocket (tokio-tungstenite), ~15 domaines | 7 208 | 4 169 | 5 601 | 147 / 88 (4 ignorés) |
| `obscura-dom` | DOM Rust (html5ever + selectors + cssparser), shadow roots, sérialisation | 2 764 | 1 333 | 0 | 82 / 0 |
| `obscura-js` | Runtime JS V8/deno_core, 59 ops, realms iframes, watchdog, WebCrypto | 7 440 | 17 988 | 44 | 527 / 3 |
| `obscura-mcp` | Bibliothèque d'outils MCP (`browser_*`, 35 + 2 `render`), `aphrody::{tools,call}` | 1 883 | 366 | 0 | 10 / 0 |
| `obscura-net` | Client HTTP (reqwest/rustls), SSRF, cookies, robots, HAR, encodage, DNS OSINT, stealth (wreq) | 4 634 | 928 | 0 | 122 / 0 |
| `obscura-render` | Layout (taffy fork) + paint CPU (tiny-skia, athena-text, swash, resvg) | 38 485 | 17 746 | 4 321 | 486 / 121 (1 ignoré) |
| **Total** | | **67 246** | **46 909** | **11 507** | **1 478 / 249 = 1 727** |

Plus `crates/web/obscura-js/js/bootstrap.js` : 16 332 lignes, 734 KB, 51 classes DOM/Web (Node, Element,
Document, CSSStyleSheet, History, CustomElementRegistry, HTMLCanvasElement, SVG*, CryptoKey, Worker shim…),
57 `op_*` référencés. Lignes brutes Rust : 145 536 (dont `obscura-render` 68 810, `obscura-js` 29 534).
Fichiers les plus gros : `obscura-render/src/dom.rs` 19 730, `obscura-js/src/runtime.rs` 19 804 (dont
tests à partir de la l. 4097), `obscura-render/src/paint.rs` 16 326, `obscura-browser/src/page.rs` 8 895.

### 1.1 Dépendances clés et features (Cargo.toml + `cargo metadata --no-deps --offline`)

| Crate | Dépendances moteur | Features |
|---|---|---|
| `obscura-dom` | `html5ever 0.40` (workspace, `Cargo.toml:210`), `selectors 0.38`, `cssparser 0.37`, `precomputed-hash` (`obscura-dom/Cargo.toml:10-13`) | aucune |
| `obscura-net` | `reqwest 0.13.5`, `rustls 0.23` (provider ring), `cookie =0.18.2`, `psl 2`, `encoding_rs`, `chrono`, `tempfile` ; stealth : `wreq =6.0.0-rc.31` (+`prefix-symbols` Linux/Android seulement), `wreq-util =3.0.0-rc.14` (`obscura-net/Cargo.toml:38,50-58`) | `stealth` |
| `obscura-js` | **`deno_core 0.412`** (+ build-dep pour le snapshot), `deno_error`, `reqwest`, `html5ever`, RustCrypto (`hmac/aes/aes-gcm/cbc/ctr/pbkdf2/hkdf`, `sha1/sha2 0.11`), `getrandom`, `psl` | `stealth` (→ net), `render` (→ `obscura-render/paint`) (`Cargo.toml:14,18`) |
| `obscura-render` | `taffy 0.12` remplacé par `[patch.crates-io]` → `ssh://git@github-dev/aphrody-labs/taffy.git` rev `ed38f5bb…` (`Cargo.toml:475`), `cssparser 0.37` ; `paint` : `tiny-skia 0.12`, `athena-text =0.14.2` (alias `cosmic-text`), `swash =0.2.10`, `ab_glyph`, `resvg/usvg 0.48`, `image 0.25`, `ureq 3`, `wuff` | `paint` |
| `obscura-browser` | dom, net, js, tokio, futures, `image` (opt.) | `stealth`, `render` |
| `obscura-cdp` | browser, js, dom, net, `tokio-tungstenite 0.30`, `uuid`, `image`/`png` (opt.), `libc` (gnu) | `stealth`, `render` |
| `obscura-mcp` | browser, dom, net, `aphrody-web-extract` | `stealth`, `render` |
| `aphrody-obscura` | browser, net (opt.) | `default=["api"]`, `stealth`, `render` |

Absents : **stylo, wgpu, Servo layout, lol-html** (aucun crate Obscura ne les tire ; `wgpu` existe dans le
workspace mais pour d'autres propriétaires). Le style CSS est maison (`obscura-render/src/{css,style}.rs`,
~20 k lignes). Holds de versions liés : `tools/config/deps/rust-holds.json:27,31` (cssparser 0.37 / selectors 0.38
bloqués par `obscura-dom/src/selector.rs` et `obscura-render/src/{css,style}.rs`).

Toutes les crates portent `[lints.rust] warnings="allow"` + clippy `all/pedantic=allow` (code « vendored »),
exemptées aussi dans `tools/config/update/rust-doctor.json:11`.

### 1.2 V8 : où et pourquoi

- Chaîne : `obscura-js` → `deno_core 0.412.0` (défauts : `v8`, `v8_use_custom_libcxx`, `reactor-tokio`)
  → `deno_v8 0.4.0` (défaut `v8` → `rusty_v8 150.4.0` ; `quickjs` → `v8x`) → `v8 150.4.0` (MIT, V8 BSD-3 en
  archive statique précompilée). `v8x 149.4.0-rc.4` apparaît dans Cargo.lock (lock indépendant des features),
  non compilé sans `quickjs`.
- Usages : `runtime.rs` (prod l. 1-4096) : 112 `v8::`, 78 `deno_core::`, 138 `JsRuntime`, 17 `v8::Global`,
  21 `v8::Local`, 9 `terminate_execution`, 13 `run_event_loop`, 1 `add_near_heap_limit_callback` ;
  `ops.rs` : 59 `#[op2]` (`op_dom` = l. 1389, « hottest op », l. 679).
- **Snapshot V8** : `build.rs` exécute `bootstrap.js` dans un isolate et sérialise le tas
  (`OBSCURA_SNAPSHOT_PATH`, `runtime.rs:49`), avec un contournement `mksnapshot` croisé Android arm64.
- **Realms iframes** : un `v8::Context` supplémentaire par iframe dans l'isolate de la page, restauré depuis le
  snapshot (`obscura-js/src/frame.rs:1-20`).
- **Interruption** : watchdog partagé qui termine via `IsolateHandle` thread-safe, un isolate par connexion CDP
  et par thread OS (`obscura-js/src/cdp_watchdog.rs:1-13`).
- **Flags** : `set_v8_flags` one-shot avant la première isolate (`obscura-js/src/v8_flags.rs`), exposé par
  `aphrody-web-engine` (`crates/web/web-engine/src/lib.rs:291`).
- Pourquoi V8 : moteur d'Obscura amont (README `crates/web/obscura/README.md` « real V8 + DOM browser ») et
  empreinte Chrome pour le mode stealth (le format de `Error.stack`, `Function.prototype.toString`, etc. font
  partie de l'empreinte d'un navigateur Chrome).
- Contraintes d'hôte : isolate `!Send` → thread dédié + runtime tokio current-thread, pile 64 MiB
  (`crates/ai/mcp/src/browser_tools.rs:13-15,27`) ; MSVC `/OPT:NOICF` sinon abort au démarrage
  (`crates/os/kernel/core/build.rs:5-10`).

### 1.3 Licences et provenance

| Élément | Licence | Provenance enregistrée |
|---|---|---|
| Obscura (8 crates) | Apache-2.0 (`LICENSE` seulement dans `obscura-dom`) | `OBSCURA-UPSTREAM.txt` (commit `1a3169da…`) ; **absent** de `tools/config/upstream-sources.json` et `THIRD-PARTY.md` |
| `deno_core`, `deno_v8`, `serde_v8`, `v8` | MIT (V8 lui-même BSD-3 dans l'archive) | crates.io |
| `v8x` | MIT OR Apache-2.0 | crates.io (dans le lock seulement) |
| `html5ever` | MIT OR Apache-2.0 | crates.io |
| `selectors 0.38`, `cssparser 0.37` | **MPL-2.0** (copyleft par fichier) | crates.io |
| `tiny-skia 0.12` | BSD-3-Clause | crates.io |
| `athena-text`, `swash`, `resvg`, `usvg` | MIT/Apache | crates.io |
| `ab_glyph` | Apache-2.0 | crates.io |
| `tokio-tungstenite` | MIT | crates.io |
| `taffy` (fork) | MIT | dépôt privé SSH `aphrody-labs/taffy` (`Cargo.toml:475`), non décrit dans `upstream-sources.json` |
| `wreq`/`wreq-util` (+ BoringSSL) | non vérifié (absents du registre local) | crates.io, versions rc exactes |
| Polices embarquées (15 MB) | Noto Color Emoji OFL-1.1 (`LICENSE-NOTO-COLOR-EMOJI.txt`) ; Liberation (OFL), DejaVu (Bitstream Vera) **non documentées** | `FONT-PROVENANCE.md` couvre Noto seulement |

Collision de nom : `obscura` est déjà pris sur crates.io (`PLAN.md:180`).

## 2. Consommateurs dans le monorepo

### 2.1 Crates Rust (dépendances directes, `cargo metadata`)

| Consommateur | Dépend de | API Obscura utilisée (preuve) |
|---|---|---|
| `aphrody-web-engine` (`crates/web/web-engine`) | browser, cdp, dom, js, net ; défaut `render` | serveur `obscura_cdp::start_with_host_and_security` / `start_with_options` (`src/lib.rs:323,419`), `obscura_js::set_v8_flags` (`:291`), `BrowserContext/Page` (`src/lib.rs:19`, `worker.rs:5`, `crawl.rs:16`), `WaitUntil` (`:638`, `crawl.rs:209`), `ObscuraHttpClient::with_full_options`, `CookieJar` (`:343,702,1147`) |
| `aphrody-web-service` | dom, mcp ; `render`, `stealth` | `obscura_mcp::BrowserState`, `aphrody::tools()/call()` (`src/lib.rs:181-205`), `obscura_dom::parse_html` (`:50`) |
| `aphrody-web-bridge` | `aphrody-obscura`, dom, net, `aphrody-web-service{render}` (`Cargo.toml:21`) | `obscura::Browser::builder()` (`src/fetch.rs:410`), `parse_html` (`ffi.rs:88-112`, `cli.rs:611`), `DnsRecon` (`ffi.rs:131`), `ensure_rustls_crypto_provider` (`cli.rs:411,520`) |
| `aphrody-web-crawl` | dom, net | `parse_html`, `parse_fragment`, `NodeData`, `ObscuraHttpClient`, `ResourceRequest` (`runner.rs:10-11`, `mirror.rs:13-14`, `wiki_page.rs:8-9,483,777`, `blocking.rs:44,119`) |
| `aphrody-web-extract` | dom | `DomTree/NodeData/NodeId`, `parse_html` (`dom.rs:6,580`, `media/streaming.rs:8`) |
| `aphrody-command` | `aphrody-obscura`, net (+ `aphrody-mcp`, `aphrody-web-engine`, `aphrody-web-bridge`, `aphrody-google`) | `ObscuraHttpClient::new/with_options`, `obscura::Browser::builder` (`src/pillars_cmd/web.rs:857-1384`) |
| `aphrody-google` | `aphrody-obscura`, dom | `obscura::Browser` (`src/search/network.rs:382`), `parse_html` SERP (`serp.rs:6`) |
| `aphrody-ffi` (cdylib) | dom, net (+ `aphrody-command`, `yolo-runtime`) | C ABI `aphrody_web_parse_html/tree_destroy/query_selector*` sur `obscura_dom::DomTree` (`src/web/mod.rs:116-147`, `web/dom.rs:10,57,449`), `ObscuraHttpClient`/`StealthHttpClient` (`web/native_http.rs:13-15`), `DnsRecon` (`web/net.rs:47`) |
| `yolo-runtime` | browser{render}, net (opt., feature `browser`) | fournisseur R4 : `BrowserContext/Page/WaitUntil`, `RequestInterceptor`, `is_forbidden_ip` (`src/browser.rs:1-12,111-112`) ; ABI `yolo_browser_create/call_start/close` |
| `aphrody-agent-tools` | net | `ensure_rustls_crypto_provider` seul (`src/web_tools.rs:349`) |
| `aphrody-mcp` (indirect) | `aphrody-web-service` (opt., défaut) | outils `aphrody_browser_*` servis en processus (`src/browser_tools.rs:2-15`) |
| `aphrody-kernel` | indirect | proxy MCP : noms `browser_*`/`aphrody_browser_*` réservés au sous-système navigateur (`src/mcp_proxy.rs:402-409`) |

Consommateurs transitifs (reverse deps) : `aphrody-web-bridge` ← agent-tools, mcp-client, command, tools, mcp,
messaging ; `aphrody-command` ← `aphrody-ffi`, `aphrody` (CLI) ; `aphrody-web-engine` ← `aphrody-command`.
`crates/ui/app/src/web_subsystem.rs:7` a déjà retiré Obscura/V8 de l'app desktop.

### 2.2 Paquets Bun, MCP, Python

| Consommateur | API utilisée |
|---|---|
| `packages/web/agent-browser` (`@aphrody/agent-browser`) | Client CDP TS maison (`src/cdp.ts`, 291 l., `DEFAULT_OBSCURA_CDP_URL = ws://127.0.0.1:9222/devtools/browser` l. 2), cycle de vie du binaire `aphrody-web` (`src/engine.ts:84`), client service (`src/service.ts:320-330`), `OBSCURA_ALLOW_PRIVATE_NETWORK` (`src/config.ts:169`). `PLAN.md:156` : « à absorber dans Aphrody Web (Rust) ». |
| `packages/web/aphrody-web-test` (`@aphrody/web-test`) | Runner « Playwright-compatible » sur le même client (`src/cdp.ts:2` réexporte `@aphrody/agent-browser/cdp`), `TestPage` sur cible CDP (`src/page.ts:6-150`). |
| `packages/engine/runtime` (SDK) | Extension navigateur précompilée : `yolo_browser_*` via `bun:ffi` (`src/browser.ts:1-60`), capacités `browser.navigate/dom/capture/contexts`. |
| `packages/interop/native` (`@aphrody/bun`) | 56 symboles `aphrody_web_*` dont `aphrody_web_parse_html`, `query_selector*`, `aphrody_web_obscura_fetch(_submit)` (`src/library.ts:97-101`, `src/engine.ts:258-573`). |
| `packages/web/x` | `webObscuraFetchSubmit` (`src/tools/web-recon.ts:4,36`). |
| `packages/engine/yolo` | `yolo browser …` : une commande CDP sur l'endpoint Obscura (`src/index.ts:121`, `src/package-commands.ts:114`). |
| MCP | `obscura-mcp` : 37 noms `browser_*` (`crates/web/obscura-mcp/src/lib.rs`) publiés `aphrody_browser_*` par `aphrody-mcp` ; clients `crates/ai/mcp-client/src/{bxc,web}.rs`. |
| Python | `py/packages/aphrody/src/aphrody/web_browser.py:251` (« `render` uses Obscura »). |
| Config / docs | `tools/config/web.json` (`engine.port 9222`, `allowPrivateNetwork:false`, env `OBSCURA_*` l. 35-36, 54, 88-94), `tools/config/live-audit.json:7`, `docs/architecture/web/ARCHITECTURE.md:20-60` (règle « Obscura/V8 renders remote pages », l. 36), `docs/reference/web/web/obscura-integration-spec.md`, `docs/APHRODY-RUST-TAURI-OBSCURA-BUN.md` (inventaire lexical). |

## 3. Recouvrement avec Bun (fork `vendor/bun`)

| Capacité | Bun (fork) | Obscura | Verdict |
|---|---|---|---|
| Moteur JS | JSC (WebKit d'oven-sh), `bun:jsc` | V8 (deno_core) | Cible JSC ; parité requise avant retrait V8 (`AGENTS.md:19`) |
| HTTP client | `fetch` natif (Rust `src/http`, BoringSSL, uSockets) | `ObscuraHttpClient` (reqwest/rustls-ring), SSRF guard, cookie jar RFC 6265bis, robots, HAR, encodages, stealth wreq | Pas de remplacement direct : `fetch` de Bun n'a ni garde SSRF ni jar par contexte ni émulation TLS. Garder `obscura-net` comme crate ; candidat ultérieur : transport sur le client HTTP de Bun |
| WebSocket | client + serveur (`Bun.serve`, `globals.d.ts:215-256`) | serveur CDP `tokio-tungstenite` | Le serveur CDP pourrait passer sur uWS de Bun à terme |
| HTML streaming | `HTMLRewriter` (`lol_html 2.7.2`, `src/runtime/api/html_rewriter.rs`) | — | Complémentaire (pas d'arbre DOM) |
| Parseur HTML/arbre DOM | **absent** | `obscura-dom` (html5ever) | Manque → `yolo:dom` |
| Sélecteurs CSS | via lol_html (`selectors 0.33`, `cssparser 0.36`) | `selectors 0.38`, `cssparser 0.37` | Doublon de versions à arbitrer |
| Parseur CSS | `src/css` (port LightningCSS, 90 fichiers, 61 364 l.) | `obscura-render/src/css.rs` maison | Recouvrement partiel, migration non triviale (cascade/calcul de style Obscura maison) |
| DOM complet + Web APIs de page | absent (pas de `document`) | `bootstrap.js` (51 classes) + 71 commandes `op_dom` | Manque |
| Layout / rendu | absent (hors `Bun.WebView` qui délègue à WebKit/Chrome) | `obscura-render` (taffy + tiny-skia), screenshots, PDF raster | Manque → `yolo:render` |
| CDP | **client** natif dans `Bun.WebView` (`ChromeBackend.cpp`, 79 KB) + `view.cdp()` (`bun.d.ts:9946`) | **serveur** CDP (~130 commandes / 15 domaines : Page 22, Target 13, Network 13, Runtime 12, DOM ~14, Fetch 7, Browser 7, Input 5, Emulation 4, Storage 4, IO 2, DOMSnapshot 2, Accessibility 2, `LP.getMarkdown`) | Complémentaires : Obscura peut être un backend de `Bun.WebView` |
| Navigation multi-pages / contextes | `Bun.WebView` (une instance Chrome par processus, `Target.createTarget`) | `BrowserContext` isolés (cookies/stockage), onglets, historique, iframes (realms) | Manque côté moteur intégré |
| Workers | `Worker` = VM JSC par thread | shim `Worker` même thread dans la page (`bootstrap.js:13968`) | Modèle d'isolation par page : VM/thread façon Worker |
| Realms isolés | `node:vm` (`src/jsc/bindings/NodeVM*.cpp`) + terminaison `vm/NodeVMRunTermination.cpp` | `v8::Context` par iframe | Gabarit possible, mais `vm` n'est pas une frontière de sécurité |
| WebCrypto, URL, TextDecoder, structuredClone, MessageChannel, timers | natifs (WebCore) | ops Rust : `op_subtle_*` (7), `op_random_bytes`, `op_url_*` (3), `op_url_encode_query`, `op_encoding_for_label`, `op_text_decode`, `op_sleep`, `op_posted_task*` (2) | ~17 des 59 ops remplaçables par les built-ins JSC/WebCore dans un realm de page |
| Plugins natifs | `Bun.plugin` / `onBeforeParse` (napi, `bun.d.ts:6359,6467`), builtins `HardcodedModule.rs`, classes générées, `host_fn` | — | Base du futur système `yolo:*` |
| Event loop | boucle Bun (uws/libuv) ; **pas de tokio** dans `vendor/bun/Cargo.lock` (282 paquets) | tokio partout | Point d'architecture majeur |

## 4. Analyse d'absorption

### 4.1 Découpage proposé

| Module | Contenu | Dépend de V8 ? | Exposition |
|---|---|---|---|
| `yolo:dom` | `obscura-dom` : `parseHTML`, `parseFragment`, arbre, `querySelector(All)`, sérialisation, texte/markdown via `aphrody-web-extract` si voulu | Non | Module natif (classes générées + `host_fn`) ; remplace les symboles FFI `aphrody_web_parse_html/query_selector*` |
| `yolo:render` | `obscura-render` : layout + paint d'un `DomTree` statique → PNG/PDF raster | Non (dépend seulement d'`obscura-dom`) | Module natif ; feature de build séparée (polices 15 MB) |
| `yolo:net` (interne d'abord) | `obscura-net` : SSRF, cookies, robots, HAR, stealth | Non | Crate externe consommée par le fork ; pas d'API publique au début (Bun `fetch` reste l'API JS) |
| `yolo:cdp` | `obscura-cdp` : serveur CDP ; ajout d'un transport pipe compatible `--remote-debugging-pipe` | Oui tant qu'`obscura-js` est V8 | Binaire/sidecar d'abord ; serveur sur uWS à terme |
| `yolo:browser` | `obscura-browser` : contextes, pages, navigation, interception, PDF | Oui (via js) | **Troisième backend de `Bun.WebView`** (`WebViewBackend`, `src/runtime/webview/JSWebView.h:18`) plutôt qu'une nouvelle API : `navigate/evaluate/click/type/press/scroll/screenshot/cdp` existent déjà |
| realm de page (`obscura-js` sur JSC) | ops + `bootstrap.js` sur un `JSGlobalObject` dédié | — | Interne au backend `yolo:browser` ; jamais exposé aux scripts Bun |

`obscura-mcp` et `aphrody-obscura` restent côté Aphrody (outils MCP, façade Rust) et ne vont pas dans le fork.

### 4.2 Ordre conseillé

0. **Préalables** (sans code moteur) : entrée Obscura + taffy dans `tools/config/upstream-sources.json`, NOTICE/`THIRD-PARTY.md`
   (Apache NOTICE, MPL-2.0, BSD-3, OFL/Vera), corriger `OBSCURA-UPSTREAM.txt` ; mesurer la ligne de base (§4.7) ;
   rendre V8 optionnel dans les chemins par défaut (`aphrody-mcp` `native-browser`, `aphrody-web-engine` `render`,
   `aphrody-web-bridge` → `aphrody-obscura` défaut `api`) pour que `libaphrody_ffi` puisse être chargée par Bun sans V8.
1. `yolo:dom` (risque faible, pas de JS de page, recouvrement immédiat avec 3 consommateurs FFI/TS).
2. `yolo:render` sur DOM statique (aucune exécution de JS distant ; vérifie taille/polices/temps de build dans le fork).
3. Backend `Bun.WebView` → **Obscura hors processus** : `backend:{type:"chrome",url}` vers `aphrody-web`
   (V8 reste dans son processus, frontière processus = isolation des pages distantes) ; puis transport pipe pour que
   Bun lance Obscura comme il lance Chrome. Ferme le point `playwright* → Bun.WebView` (`PLAN.md:137`) et permet de
   retirer le client CDP TS d'`agent-browser` (`src/cdp.ts`) au profit du client natif.
4. Abstraction moteur dans `obscura-js` (trait couvrant `evaluate`, `call_function_on`, `store/release_object`,
   `run_event_loop`, `terminate`, realms) avec V8 comme seule implémentation : sans changement de comportement,
   les 1 727 tests restent verts.
5. Implémentation JSC de ce trait dans le fork (realm de page isolé), qualifiée par la parité (§4.4).
6. Seulement après la parité : backend `Bun.WebView` « obscura » **en processus** (JSC) et retrait du chemin V8
   pour les rôles qualifiés ; garder V8 pour le mode stealth tant que l'empreinte JSC n'est pas acceptable.

### 4.3 Ce qui passe de V8 à JSC (`obscura-js`)

- À porter : `runtime.rs` (l. 1-4096), `ops.rs` (l. 1-3705, 59 ops), `frame.rs` (1 236), `module_loader.rs` (317),
  `import_map.rs` (432), `cdp_watchdog.rs` (109), `v8_flags.rs` (76), `build.rs` (snapshot, ~230 l.). Soit
  ~7 400 lignes de prod, dont ~250 points d'API V8/deno_core.
- Peu couplé au moteur : `bootstrap.js` n'utilise le moteur que via `globalThis.Deno.core.ops`
  (`bootstrap.js:8,90,135`) ; le DOM passe par **une seule op string→string** `op_dom(cmd,a1,a2,frameId)`
  (71 commandes, `ops.rs:1389-1412`). Il suffit de fournir un objet `Deno.core.ops` équivalent dans le realm JSC.
- Équivalences : snapshot V8 → cache de bytecode JSC (pas de snapshot de tas : coût d'évaluation de 734 KB par
  realm, **à mesurer**) ; `v8::Context` par iframe → `JSGlobalObject` par realm dans une même VM (modèle `NodeVM`) ;
  `IsolateHandle::terminate_execution` → terminaison de VM JSC (modèle `NodeVMRunTermination`) ;
  `v8::Global` (RemoteObject CDP) → valeurs JSC protégées ; `add_near_heap_limit_callback` → limites de tas JSC ;
  `set_v8_flags` → options `BUN_JSC_*` ; ops async (`op_fetch_url`) → promesses JSC résolues depuis la boucle Bun.
- Remplaçables par des built-ins JSC/WebCore : ~17 ops (WebCrypto, aléa, URL, encodage, timers, postMessage).
- Non portables tels quels : contournement `mksnapshot` croisé ; `deno_core` (on le remplace, on ne l'adapte pas,
  sauf voie `v8x`, cf. §0.5).

### 4.4 Ce qu'exigerait la « parité JSC »

Grille de la directive (`git show adec4dd67:PLAN.md` l. 40-45), traduite en critères Obscura :

| Contrat | Critère mesurable |
|---|---|
| DOM | Mêmes verdicts sur les 455 tests de `runtime.rs` (408 via `evaluate`, 25 spécifiques V8 à réécrire), 39 tests de `ops.rs`, 33 de `obscura/tests`, 108 de `obscura-browser` |
| Protocole | Les 235 tests `obscura-cdp` (dont 88 sur le fil, agnostiques moteur) contre un serveur adossé à JSC |
| Exceptions | `Runtime.evaluate` `exceptionDetails`/`stackTrace` au format CDP (formats de pile V8 et JSC différents) |
| Promesses / microtasks | `obscura-browser/tests/unhandled_rejection.rs`, ordre microtasks/timers/événements |
| Modules | `module_loader.rs` + `import_map.rs` (scripts `type=module`, import maps) |
| Workers | Shim `Worker` de page (`bootstrap.js:13968`) ; choix explicite : vrai thread ou shim |
| Timers / interruptions | Watchdog CDP : commande bornée et interruptible sans tuer le processus ; tests `max_connections_cap`, `control_plane_unblocked` |
| GC / destruction | `multi_isolate_teardown`, `concurrent_isolate_teardown`, `execution_context_pruned_on_navigation` ; pas de fuite RSS sur N navigations |
| Isolation | Realm de page sans `Bun`, `process`, `require`, `import.meta`, `bun:*` (test : `typeof Bun === "undefined"` dans la page) ; même politique d'origines que `yolo-runtime` (`src/browser.rs:24-35,58,182,343`, tests l. 926 et 974) |
| Stealth | Empreinte : surface `navigator`, format de `Error.stack`, `Function.prototype.toString`, Intl. Sous JSC, le format de pile diffère de Chrome ; le mode stealth doit rester V8 jusqu'à décision |

API à geler côté fork : interface du backend (`WebViewBackend`) et ABI interne des ops (`Deno.core.ops` → objet
d'ops du realm), versionnées comme l'ABI `yolo_*` (`docs/RUNTIME-ABI.md`).

### 4.5 Ce qui reste un crate externe consommé par le fork

`obscura-dom`, `obscura-net`, `obscura-render` (+ fork taffy), le cœur `obscura-browser` et le serveur `obscura-cdp`
restent des crates Cargo (publiables), consommées par le fork via `Cargo.toml` ; le fork n'ajoute que les liaisons
(`*.classes.ts`/`host_fn`) et le backend WebView. `obscura-mcp`, `aphrody-obscura`, `aphrody-web-*`, `yolo-runtime`
restent dans Aphrody. Pas de copie du code dans `vendor/bun` (règle « no copied Yolo engine »).

### 4.6 Risques

- **Deux moteurs JS dans un processus** (déjà le cas, cf. §0.2) : symboles (simdutf déjà renommé), libc++
  personnalisée de V8 (`v8_use_custom_libcxx` par défaut), gestionnaires de signaux, allocateurs, MSVC ICF
  (`kernel/build.rs:5-10`). Déjà listés dans `docs/plans/web/apps/bxc/MEGA-PLAN.md:546-550`.
- **Deux boucles d'événements** : tokio (Obscura) et Bun (absent du lock de Bun). Un thread tokio dédié par
  contexte, plus un pont de tâches vers la boucle Bun.
- **Deux piles TLS** : rustls/ring (`obscura-net`) et BoringSSL (Bun). En stealth, `wreq` apporte une deuxième
  BoringSSL, avec `prefix-symbols` sur Linux/Android seulement (`obscura-net/Cargo.toml:50-58`).
- **Taille binaire** : V8 statique (~40 MB selon le README de v8x, non vérifié ici), polices `include_bytes!`
  15 MB (`obscura-render/src/inline.rs:42-56`, `paint.rs:20-26` ; Noto Color Emoji 10,67 MB), snapshot.
  Le build `render` doit rester une feature séparée.
- **Graphe et temps de build** : fermetures Cargo.lock (bornes hautes, toutes features) : `obscura-dom` 74
  paquets (40 déjà dans le lock de Bun), `obscura-net` 337, `obscura-render` 377, `obscura-js`/`-cdp` ~600
  (124 déjà chez Bun) contre 282 paquets dans le lock de Bun. Taffy via **SSH privé** : la fabrique du fork doit y
  accéder, et la publication est bloquée. Archive V8 téléchargée au build. Ligne de base du fork : 7 min 10 s
  (`PLAN.md:135`).
- **Sécurité** : un realm `node:vm` n'est pas une frontière ; une page distante doit tourner dans un global sans
  liaisons Bun, idéalement sur une VM/un thread dédié, voire dans un processus séparé tant que la parité n'est pas
  acquise. Serveur CDP : boucle locale par défaut (`server.rs:214`), refus des en-têtes `Origin` (`:136-150`),
  Bearer ≥ 32 octets obligatoire si joignable publiquement (`:59-64,86-90,339-341`). `Bun.WebView` en WS n'envoie
  pas d'`Authorization`, d'où le patch requis ou une restriction à la boucle locale.
- **Versions** : cssparser/selectors en double (0.36/0.33 chez Bun, 0.37/0.38 chez Obscura) ; `wreq` en rc exacte.
- **Lints** : code « vendored » en allow-all, à confronter aux règles de lint du fork.
- **Dérive amont** : 19 commits locaux non tracés ; la resynchronisation avec h4ckf0r0day/obscura est non vérifiée
  (aucune lecture réseau ici).

### 4.7 Métriques à mesurer avant/après (machines et profils identiques)

- Taille (strippée) : binaire du fork, `libaphrody_ffi.so`, `aphrody`, `aphrody-web`, chacun avec et sans
  `render`/`stealth` ; part de V8 et des polices (`bloaty`/`cargo bloat` sur la fabrique).
- Build : propre et incrémental du fork (reçu `bun-forge`), `aphrody-web-engine` ; nombre de crates et doublons de
  versions.
- Exécution : démarrage à froid page/realm (snapshot V8 vs bytecode JSC), navigation p50/p95 sur les 18
  `render-repros` + `aphrody-web-test/test/sites`, latence d'aller-retour `evaluate`, débit `op_dom`, RSS par
  page/contexte et après N navigations, pages concurrentes max, pauses GC, temps de capture/PDF, latence par
  commande CDP.
- Conformité : verdicts par suite (§5), plus un sous-ensemble WPT à créer (aucun harnais WPT aujourd'hui ;
  seulement des cas inspirés de WPT, ex. `obscura-net/src/client.rs:1543,2236`, `bootstrap.js:15738`).
- Sécurité : SSRF/origines, absence de globals Bun dans la page, refus CDP.

## 5. Tests et gates existants

- Rust : 1 727 tests (§1 ; 5 `#[ignore]`). `tests/` : `obscura` 11 fichiers, `obscura-cdp` 32 cibles (connexion, cibles,
  contextes d'exécution, entrées, réseau, isolation concurrente), `obscura-browser` 3, `obscura-js` 1
  (`multi_isolate_teardown`), `obscura-render` 2 (`layout_test`, `text_decoration`) + 18 fixtures
  `render-repros/*.html` + `tests/fonts/PROVENANCE.txt`. `yolo-runtime/src/browser.rs` : 8 tests (politique d'origines).
- Bun : `@aphrody/agent-browser` 9 fichiers, ~48 tests (`cdp.test.ts` sur le CDP Rust) ; `@aphrody/web-test`
  ~37 ; SDK runtime ~34 ; scripts web ~20 (`web-smoke`, `web-verify`, `web-crawlability`). Fork :
  `vendor/bun/test/js/bun/webview/*` ~119.
- Gates : `bun run web:verify` (`package.json:182`) : étapes config, bun (typecheck/lint/test des 2 paquets + tests
  de scripts), build (`cargo build -p aphrody-web-engine --bins --locked`), smoke loopback (`scripts/audit/web-smoke.ts`),
  crawlability ; `web:verify:rust` (`:183`) ajoute check/clippy `-D warnings`/test sur `WEB_CRATES`
  (`scripts/audit/web-verify.ts:16-35,142-173`). `cargo-serial.sh` refuse Cargo lourd sous WSL
  (`scripts/build/rust/cargo-serial.sh:20-24`) : passer par `bun scripts/build/rust/vps-cargo.ts run -- …` ou
  la fabrique. Audit live : `tools/config/live-audit.json:7`.
- Rejouer côté Bun :
  1. Suites TS existantes inchangées contre l'endpoint (`APHRODY_WEB_TEST_CDP_URL`).
  2. Tests `Bun.WebView` du fork (`bun bd test test/js/bun/webview/webview-chrome-ws.test.ts`) pointés sur Obscura :
     le test lit `DevToolsActivePort` (l. 23-58), il faut donc un petit adaptateur d'URL d'endpoint.
  3. Tests Rust de conformité DOM (`runtime.rs`, ~408 via `evaluate`) exécutés sur les deux backends via une feature
     de moteur (`cargo test -p obscura-js --features engine-jsc`, sur la fabrique), ou portés en `bun test` qui
     appellent `evaluate` sur le backend WebView avec les mêmes assertions.
  4. Tests fil `obscura-cdp/tests` (88) inchangés contre un serveur adossé à JSC.
  5. Gate d'isolation nouveau : page distante sans `Bun`/`process`/`require`, refus des origines non permises, refus
     du réseau privé.
