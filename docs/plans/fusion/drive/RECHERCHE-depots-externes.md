# Dépôts, issues et PR externes utiles au plan de fusion Obscura × Bun (`yolo`)

Recherche en lecture seule du 2026-10-05. Toutes les sources ont été consultées le 2026-10-05 : API GitHub en lecture (`aphrody git api`), pages web, et `Cargo.lock` local d'`aphrody`. Aucun fichier de dépôt n'a été modifié.

Légende utilisée dans tout le rapport :

- **[V] fait vérifié** : lu dans la source primaire (fichier, PR, release, manifeste) le 2026-10-05.
- **[A] annoncé** : chiffre ou affirmation publiés par le projet, non mesurés ici.
- **[D] déduction** : conclusion tirée de faits vérifiés, à confirmer par une mesure ou un essai.

Plan lu : partie 1 (« Décision finale », état des lieux), partie 2 (tableau des chantiers J0 à J2), partie 3 (« Points techniques délicats », desktop, risques, validation), partie 4 (audits).

---

## 0. Ce qui change le plan (à lire en premier)

| # | Constat | Statut | Effet sur le plan |
| --- | --- | --- | --- |
| 1 | **L'amont `oven-sh/bun` est lui-même en Rust.** La PR #30412 « Rewrite Bun in Rust » a été fusionnée le 2026-05-14 (1 009 257 lignes ajoutées, 6 755 commits ; « No async rust »). Bun v1.4.0, sortie le 2026-08-20, est la première version stable en Rust ; la dernière release est v1.4.2 (2026-09-05). Le fork `aphrody-labs/bun` est donc l'amont plus 6 commits, et non un portage Aphrody | [V] | La « divergence totale » renonce à un amont très actif (dizaines de PR par jour). Mieux vaut garder la synchro amont pour le noyau et ne diverger que dans `crates/browser` et `crates/plugins` [D] |
| 2 | **Bun compile désormais JSC et ICU depuis les sources** dans son graphe ninja, sur toutes les cibles (PR #41330, fusionnée le 2026-09-06). L'archive précompilée ne reste disponible qu'en opt-in (`--webkit=prebuilt`) ; `--local-deps=WebKit=<clone>` permet de patcher JSC ; LTO par défaut en release | [V] | Les mentions « WebKit précompilé » et « préchauffer WebKit `autobuild` » sont périmées. Il faut préchauffer le cache ninja/ccache des objets JSC, ou choisir explicitement `--webkit=prebuilt` [D] |
| 3 | **L'empreinte TLS Chrome complète existe déjà, sous forme de PR amont.** `oven-sh/bun` PR #40275 (ouverte ; 17 fichiers, +1 650 lignes) ajoute à `fetch` les options `tls.{ja3, grease, permuteExtensions, certificateCompression, applicationSettings, echGrease, ocspStapling, signedCertificateTimestamps, sessionTickets}`. Le ClientHello de Chrome est reproduit en entier : groupes `X25519MLKEM768:X25519:P-256:P-384`, deux key shares, compression de certificat brotli, ALPS, ECH GREASE, extensions permutées. La CI était verte (181/181) sur une tête précédente | [V] | Le chantier A n'a plus à renvoyer la permutation, ALPS et la compression de certificat dans `BROKEN.md` : un cherry-pick suffit [D] |
| 4 | **Le BoringSSL de Bun expose nativement tous les réglages utilisés par Chrome** : `SSL_CTX_set_permute_extensions`, `SSL_CTX_set_grease_enabled`, `SSL_set_enable_ech_grease`, `SSL_add_application_settings`, `SSL_set_alps_use_new_codepoint`, `SSL_CTX_add_cert_compression_alg`, `SSL_CTX_set1_group_ids`, `SSL_GROUP_X25519_MLKEM768`, `SSL_SIGN_ML_DSA_*`, ancres de confiance, SCT et OCSP. Il manque seulement `SSL_CTX_set_extension_order` et la limite de taille d'enregistrement (patches `btls`, utiles pour Firefox et Safari, pas pour Chrome) | [V] (`include/openssl/ssl.h` d'`oven-sh/boringssl`) | Une seule BoringSSL suffit pour l'empreinte Chrome [V] |
| 5 | **Deno sait déjà faire tourner `deno_core` sans V8.** La PR denoland/deno #36194 (fusionnée le 2026-08-04) ajoute la façade `deno_v8` (dans `libs/deno_v8`), qui pointe soit vers `v8` 150.4, soit vers `v8x` `=149.4.0-rc.4` (QuickJS-ng). Le `Cargo.lock` d'`aphrody` contient déjà `deno_core 0.412 → deno_v8 0.4.0 → {v8, v8x}` | [V] | Il existe une étape intermédiaire « Obscura sans V8 » qui ne touche ni les 70 ops ni `bootstrap.js` : `deno_core` en `default-features = false` + `quickjs` [D, à essayer]. C'est un moteur sans JIT, mais il suffit pour retirer V8 d'`aphrody` en 2 bis |
| 6 | **`Bun.WebView` sait se connecter à un serveur CDP existant** (`backend: { url: "ws://…" }`). En revanche, son backend Chrome est réservé au thread principal : sa construction dans un `Worker` lève une exception | [V] (`docs/runtime/webview.mdx`) | Le backend `"obscura"` hors processus est atteignable sans transport pipe, en pointant vers `yolo browser serve`. Le trou « pas de `--remote-debugging-pipe` » de la partie 4 n'est donc pas bloquant [D]. La contrainte « thread principal seulement » reste à lever pour le modèle « une page par Worker » |
| 7 | **Un plugin ne peut pas atteindre JSC directement.** Le script de lien de Bun (`src/linker.lds`) n'exporte que `napi*`, `node_api_*`, 317 symboles `uv_*` et environ 203 symboles de la cale V8 de Bun ; aucun symbole `JS*` de l'API C de JSC. De plus, `bun_jsc` dépend du runtime entier (bundler, install, http) | [V] | Confirme la partie 1 : l'hôte de realm doit vivre dans le noyau et être publié par une table C versionnée [V/D] |
| 8 | **Bun possède déjà les briques d'un hôte de realm.** `NodeVM.cpp` et `NodeVMGlobalObject` donnent des global objects isolés dans la même VM ; `NodeVMScript.cpp` gère `produceCachedData`/`cachedData` (bytecode) ; `vm/NodeVMRunTermination.cpp` interrompt via `notifyNeedTermination` ; `src/jsc/CachedBytecode.rs` gère le cache | [V] | « L'hôte de realm de ~500 lignes » peut être un emballage de `node:vm` plutôt que du code neuf [D]. On peut même faire un essai en JS pur (voir chantier B) |
| 9 | **Un concurrent permissif obtient de bien meilleurs scores qu'Obscura.** `lexmount/moli` (Rust, MIT OR Apache-2.0, 8 986★, créé le 2026-08-10, v1.1.14) annonce 81,9 % sur Lexbench-Headless-Browser (1 308 tâches), contre 44,9 % pour Obscura, 53,3 % pour Lightpanda et 99,85 % pour Chrome | [A] | Avant d'investir 60 € dans le port d'Obscura (chantier B), il faut décider : base Obscura, ou emprunt de composants à Moli (types CDP, conformité WPT, mise en page à la demande) [D]. Moli est couplé à V8 (`moli-webidl` dépend de `v8 = "152.2.0"`), donc pas plus simple à porter sur JSC [V] |
| 10 | **Versions de `wreq`.** La copie locale épingle `wreq =6.0.0-rc.31`, `wreq-util =3.0.0-rc.14` et `btls 0.5.6` (pas rc.29). En amont, la ligne `6.0.0-rc.*` est devenue `wreq 0.16` (réinitialisation de numérotation, 2026-08-22) : TLS passé sur `btls`, MSRV 1.98, tokio par défaut ou compio | [V] | Sans conséquence si la pile Bun remplace `wreq`. Sinon, prévoir un saut de version [D] |

---

## 1. JSC depuis Rust (realms isolés, watchdog, cache de bytecode)

| Projet | Lien | État (2026-10-05) | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| Bun `src/jsc` (`bun_jsc`, `jsc_macros`, `*_jsc`) | https://github.com/oven-sh/bun/tree/main/src/jsc | Actif ; 120 fichiers ; `#[bun_jsc::host_fn]`, `JsClass`, `JSRef`, `Strong`, `Weak`, `CachedBytecode.rs`, `VM.rs` [V] | MIT (Bun) ; JSC/WebKit LGPL-2.1/BSD | Seule liaison JSC Rust de production ; modèle des fonctions hôtes (`html_rewriter.rs`) [V] | Ne s'extrait pas : dépend de `bun_bundler`, `bun_install`, `bun_http`… ; aucun export JSC pour les plugins [V] |
| Bun `node:vm` (C++) | `src/jsc/bindings/NodeVM*.cpp`, `vm/NodeVMRunTermination.cpp` | Activement corrigé : PR #44518 (realm d'un accesseur natif inliné), #44410, #42347, #41769, #32839 (cachedData invalide), #39994 (DeferredWorkTimer par realm) [V] | MIT | Global object isolé par contexte, cache de bytecode, timeout ou terminaison : les trois besoins de l'hôte de realm [V] | Bugs de « mauvais realm » encore ouverts : un DOM complet par realm en déclenchera d'autres [D] |
| `oven-sh/WebKit` | https://github.com/oven-sh/WebKit | Fork actif ; release `autobuild-5718a6ec…` (2026-10-04) ; consommé depuis les sources depuis la PR #41330 [V] | LGPL/BSD | Patch JSC local par `--local-deps=WebKit=` [V] | Un patch JSC rend le fork plus coûteux à resynchroniser [D] |
| `LingXia-Dev/Rong` | https://github.com/LingXia-Dev/Rong | v0.6.0 (2026-07-19), poussé le 2026-10-01, 3★ [V] | Apache-2.0 (badge MIT OR Apache-2.0) | Interruption dure multi-moteurs (PR #28, `InterruptHandle`, `call_with_timeout`) ; la construction JSCOnly exige `JSContextGroup{Set,Clear}ExecutionTimeLimit` et les en-têtes privés de bytecode ; pools de workers « pinned » [V] | Embarque sa propre JSC : modèle à suivre, pas dépendance [D] |
| `kevincaicedo/rust-jsc` | https://github.com/kevincaicedo/rust-jsc | v0.5.0 (2026-02-28), 14★ [V] | MIT | API haut niveau sur l'API C, modules ES, modules synthétiques (`#[module_resolve]`, `#[module_evaluate]`) : modèle de chargeur [V] | Petit projet ; lie une JSC externe [V] |
| `wasmerio/rusty_jsc` | https://github.com/wasmerio/rusty_jsc | Inactif depuis le 2023-08-10 [V] | MIT | Exemple de macro `#[callback]` | Abandonné |
| `endoli/javascriptcore.rs` | https://github.com/endoli/javascriptcore.rs | v0.0.6 (2024), poussé le 2025-02 [V] | Apache-2.0 | Liaisons brutes de l'API C | Peu maintenu |
| `tauri-apps/javascriptcore-rs` | https://github.com/tauri-apps/javascriptcore-rs | v2.0.0 (2026-09-22) [V] | MIT | Valeurs JSC GObject renvoyées par WebKitGTK (wry) [V] | Ne sert pas à embarquer JSC : liée à `javascriptcoregtk` [V] |
| `Brooooooklyn/jsc-rs` (Týr) | https://github.com/Brooooooklyn/jsc-rs | Poussé le 2026-08 [V] | **Aucune licence** | Lecture seule | Inutilisable juridiquement |
| `blackboardsh/jsc` | https://github.com/blackboardsh/jsc | Release `jsc-WebKit-7624.2.5.10.6` (2026-07-13) [V] | **Aucune licence** | Référence : SDK JSCOnly statiques pour 5 cibles (dont Windows ARM64), JIT complet, test « embedder » (callbacks, bytecode paresseux, contextes concurrents) [V] | Lecture seule |
| `mbbill/JavaScriptCore-rs` | https://github.com/mbbill/JavaScriptCore-rs | Réécriture expérimentale de JSC en Rust, 0★ [V] | Aucune | — | Jouet |

---

## 2. Compatibilité deno_core/V8 au-dessus d'un autre moteur

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| `denoland/deno` `libs/deno_v8` (façade) + PR #36194 | https://github.com/denoland/deno/pull/36194 | Fusionnée le 2026-08-04 ; `deno_v8` 0.4.0 (2026-09-16) ; features `v8` (défaut) et `quickjs`, mutuellement exclusives ; `deno compile --engine quickjs`, `denort` QuickJS publiés [V] | MIT | **Obscura sans V8 sans toucher aux ops** : `deno_core` en `default-features = false` + `quickjs` ; snapshots enregistrés puis rejoués côté QuickJS (v8x PR #57, 13/13) [V/D] | QuickJS sans JIT (pages lourdes lentes) [V] ; des retours d'erreurs à la compilation et à l'exécution existent dans la PR [V] ; les 164 appels `v8::` directs d'`obscura-js` doivent passer par `deno_core::v8` [D] |
| `denoland/v8x` (nom interne `v82jsc`, origine `littledivy/v8x`) | https://github.com/denoland/v8x | v149.4.0-rc.4 (2026-08-05), poussé le 2026-08-21, 44★ ; le backend `jsc` est **macOS seulement** (WebKit JSCOnly vendorisé ou framework système) ; `quickjs` sur tous les OS [V] | MIT OR Apache-2.0 | Table de correspondance V8 → JSC : `src/jsc/` implémente environ 570 symboles C `v8__*` sur l'API C de JSC [V]. Snapshot remplacé par le cache de bytecode (`docs/snapshots-and-esm.md`) [V] | Rapport du 2026-08-05 : `deno_core` passe **382/429 sur jsc**, 385/429 sur JSC système, 429/429 sur quickjs ; `rusty_v8` 46/268 sur jsc [V]. Le backend jsc embarque sa propre WebKit (~48 Mo statiques [A]), donc une seconde JSC à côté de celle de Bun [D] |
| Cale V8 de Bun | https://github.com/oven-sh/bun/tree/main/src/jsc/bindings/v8 | 82 fichiers (`V8Isolate`, `V8Context`, `V8FunctionTemplate`, `V8HandleScope`, `MakeWeak`…), symboles C++ `v8::` exportés [V] | MIT | Correspondance concept par concept (Global, HandleScope, Template) dans la VM de Bun [V] | Sous-ensemble destiné aux addons natifs Node, pas l'ABI `v8__*` de rusty_v8 [V] |
| `krishn03id/obscura-android-port` | https://github.com/krishn03id/obscura-android-port | 2026-07-08/09, 0★ [V] | Apache-2.0 | **Précédent direct** : `obscura-js` porté de `deno_core` vers `rquickjs` ; table `JsRuntime → Runtime+Context`, `#[op2] → fonctions + enveloppes JS`, snapshot → `include_str!` + eval, `IsolateHandle → JS_SetInterruptHandler`, ops async par file de promesses côté JS ; `porting/deno_core-to-rquickjs.md`, `ops-inventory.md` [V] | Obscura ancien (22 ops contre 70) ; maturité faible [V] |
| `DelSkayn/rquickjs` | https://github.com/DelSkayn/rquickjs | Actif (2026-10-05) [V] | MIT | Repli sans JIT | Inutile si JSC (Bun couvre Android, FreeBSD, Windows ARM64) [D] |
| `boa-dev/boa` | https://github.com/boa-dev/boa | v0.22 (2026-08-28) [V] | MIT | Moteur pur Rust (utilisé par oxibrowser) | Sans JIT, conformité inférieure [D] |
| `trynova/nova`, `tryandromeda/andromeda` | https://github.com/trynova/nova | Nova 0.3.0 (2025-08) ; Andromeda 0.1.14 (2026-06) [V] | MPL-2.0 | — | Expérimentaux |
| `denoland/deno_core` | https://github.com/denoland/deno_core | **Archivé** : fusionné dans `denoland/deno` [V] | MIT | Les issues et PR `deno_core` se suivent dans `denoland/deno` | — |
| Deno 1.13 (plugins natifs → FFI) | https://deno.com/blog/v1.13 | Plugins Rust (`Deno.openPlugin`) remplacés par `Deno.dlopen` [V] | — | Leçon : l'ABI Rust instable a tué les plugins d'ops Rust [V] | Confirme « ABI C seulement » pour `aphrody_plugin_abi` [D] |

---

## 3. Navigateurs et moteurs headless de référence

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| `lexmount/moli` | https://github.com/lexmount/moli | v1.1.14 (2026-10-05), 8 986★, 90 crates ; V8 via `rusty_v8` 152.2 vendorisé, Stylo (fork), Taffy + Parley, AnyRender/Vello CPU, libcurl ; CDP, WebDriver Classic et BiDi sur un seul point d'accès ; `panic = "abort"` [V] | MIT OR Apache-2.0 (workspace) [V] | `moli-protocol-cdp` (types CDP en serde pur) ; rendu à la demande (`FrozenLayoutTree`) ; `moli-wpt-compat` ; dérive WebIDL ; jeu de tâches Lexbench [V] | Lié à V8 (`moli-webidl` → `v8`) [V] ; projet de deux mois ; scores publiés par l'éditeur [A] |
| `lexmount/Lexbench-Headless-Browser` | https://github.com/lexmount/Lexbench-Headless-Browser | 1 928 tâches : CDP brut, 13 outils (Playwright, Puppeteer, Selenium…), sémantique web [A] | Apache-2.0 | Suite de validation n° 4 (compatibilité clients) plus comparable que la seule doc Obscura [D] | Harnais Python : à lancer via `uv` [V] |
| `lightpanda-io/browser` | https://github.com/lightpanda-io/browser | 1.0.0 (2026-10-02), 36 009★ ; Zig + V8 (snapshot) + libcurl + html5ever (staticlib Rust) ; CDP (21 fichiers de domaines : target, page, runtime, dom, network, fetch, input, emulation, storage, accessibility…), WebDriver Classic et BiDi, MCP, sortie Markdown, WPT publiés chaque jour [V] | **AGPL-3.0** | Référence en boîte noire : liste des domaines CDP, comportement Puppeteer, harnais WPT (fork `lightpanda-io/wpt` + `testharnessreport.js`) [V] | AGPL : aucune copie de code [V]. Annonces : 9× plus rapide et 16× moins de mémoire que Chrome sur 933 pages [A] |
| `servo/servo` | https://github.com/servo/servo | v0.6.0 (2026-09-29), base de la prochaine LTS (SpiderMonkey ESR 153) ; crates publiées [V] | MPL-2.0 | Stylo, html5ever, API d'embarquement | WebDriver, pas CDP ; SpiderMonkey [V] |
| `DioxusLabs/blitz` | https://github.com/DioxusLabs/blitz | Bêta, sans JS ; `blitz-dom` = Stylo + Taffy + Parley ; `anyrender` v0.13 [V] | MIT/Apache-2.0 (`stylo_taffy` aussi MPL) | Piste à long terme pour la cascade d'`obscura-render` [D] | Pas de JS ; API mouvante |
| `LadybirdBrowser/ladybird` | https://github.com/LadybirdBrowser/ladybird | Actif ; LibWeb, LibJS ; `Cargo.toml` à la racine (Rust en introduction) ; `LibDevTools` (protocole Firefox), WebDriver [V] | BSD-2 | Référence d'algorithmes DOM fidèles à la spec | Pas de CDP [V] |
| `project-oxi/oxibrowser` | https://github.com/project-oxi/oxibrowser | v0.25.0 (2026-09-30), 29★ ; Boa + Blitz/Stylo/Taffy/Parley + `btls` ; 12 domaines CDP [V] | MIT | Exemple de `btls` dans un navigateur Rust | Faible maturité ; chiffres annoncés (44 Mo, 50 ms) [A] |
| `yfedoseev/browser_oxide` | https://github.com/yfedoseev/browser_oxide | v0.1.3 (2026-07-28) ; `deno_core` 0.403 + `boring2` ; « research-grade » [V] | MIT OR Apache-2.0 [V] | Stealth BoringSSL + V8, `PagePool` chaud [V] | Pas de CDP ; pré-1.0 |
| `koloss777/nokk` | https://github.com/koloss777/nokk | v0.1.35-alpha [V] | Apache-2.0 | V8 + empreinte TLS/HTTP Chrome + CDP | Alpha |
| `mattsse/chromiumoxide` (+ `chromiumoxide_cdp`, `_pdl`) | https://github.com/mattsse/chromiumoxide | v0.9.1 (2026-02-25) [V] | MIT/Apache-2.0 | Types CDP générés depuis le PDL pour typer le serveur CDP ; client de test Rust [D] | Rythme lent |
| `spider-rs/chromey` | https://github.com/spider-rs/chromey | Fork maintenu de chromiumoxide, v2.46.39 [V] | Apache-2.0 | Même usage, plus à jour | — |
| `rust-headless-chrome` | https://github.com/rust-headless-chrome/rust-headless-chrome | 1.0.22 (2026-06-11) [V] | MIT | Client de test | — |
| `salamaashoush/ferridriver` | https://github.com/salamaashoush/ferridriver | Canary (2026-09) ; API compatible Playwright, napi-rs pour Node et Bun [V] | **Aucune licence** | Lecture seule | — |
| `h4ckf0r0day/obscura` (amont) | https://github.com/h4ckf0r0day/obscura | v0.2.4 (2026-10-04), 28 501★, 180 issues ouvertes ; PR #1031 : `deno_core` 0.412 / V8 150.4 [V] | Apache-2.0 | — | Écarts ouverts : #1001 (interfaces HTML = alias d'`Element`), #807 (Playwright fill/click qui bloquent), #1103 (suivi Playwright), #1123/#1117 (motifs `Fetch.enable`), #1093 (IndexedDB), #1151 (sous-ressources en série) [V] |

---

## 4. Bun et plugins natifs

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| Réécriture Rust de Bun (PR #30412) | https://github.com/oven-sh/bun/pull/30412 | Fusionnée le 2026-05-14 ; v1.4.0 (2026-08-20) ; v1.4.2 (2026-09-05) [V]. Article InfoQ : 535 496 lignes de Zig, 4 mois, 64 instances Claude [A] | MIT | Base du noyau | Rythme amont très élevé ; une divergence coûte cher [D] |
| PR #41330 (JSC depuis les sources) | https://github.com/oven-sh/bun/pull/41330 | Fusionnée le 2026-09-06 [V] | MIT | `--local-deps=WebKit=`, `--webkit=prebuilt`, LTO par défaut [V] | +1 à 2,5 min par cible ; LTO croisé Rust/C++ sauté sur macOS et Windows natifs quand le LLVM de rustc est plus récent [V] |
| `Bun.WebView` (PR #28185) | https://github.com/oven-sh/bun/pull/28185 | Fusionnée le 2026-03-20 ; Windows Chrome (#39423) fusionnée le 2026-08-18 [V] | MIT | `backend: {url: "ws://…"}`, `cdp()`, événements CDP en `EventTarget` [V] | Chrome sur le thread principal seulement [V]. PR ouvertes : #43430 (contexte de navigateur par vue, proxy), #42222, #43431 (`status`, `userAgent`), #29953 (`backend.detached`). Issues : #44478, #44134, #43412, #42342, #29204 (BiDi Firefox) [V] |
| N-API dans Bun | https://bun.com/docs/runtime/node-api | `src/linker.lds` exporte `napi*`, `node_api_*`, `uv_*` (317), cale V8 (~203) [V]. PR ouvertes : #39652 et #39892 (handles libuv POSIX), #40260 (cycle de vie en Rust sûr), #44378 (payloads tsfn à la fin d'un Worker), #43940, #40909 [V] | MIT | ABI des plugins (napi-rs) [V] | Issue #40211 : SIGSEGV quand un addon Rust démarre tokio (Android) [V] ; issue #35995 (ouverte) : pas d'accès natif à `Server`/`Request`/`Response` pour les plugins [V] |
| Addons dans `--compile` | PR #30033 et #30036 | Ouvertes : emplacements `.node` injectables après compilation (ELF/Mach-O) ; fusion PE statique sous Windows avec fuzzer [V] | MIT | Distribuer `yolo` + plugins en un binaire [D] | Non fusionnées [V] |
| PR #44059 (`--include` paresseux) | https://github.com/oven-sh/bun/pull/44059 | Ouverte [V] | MIT | Fichiers embarqués chargés à la demande | — |
| `packages/bun-native-plugin-rs` | https://github.com/oven-sh/bun/tree/main/packages/bun-native-plugin-rs | Crate `bun-native-plugin` ; seul hook : `onBeforeParse` du bundler [V] | MIT | Ce n'est pas un mécanisme de plugin runtime [V] | — |
| `Bun.plugin().module()` | https://bun.com/docs/runtime/plugins | Modules virtuels paresseux ; loaders `object` et `napi` [V] | MIT | Modules `yolo:*` résolus vers un plugin [V] | — |
| `napi-rs/napi-rs` | https://github.com/napi-rs/napi-rs | v3.14.1 (2026-10-05) [V] | MIT | Plugins `.node` | Issue #3443 : arrêt du runtime tokio en concurrence avec le déchargement du module à la sortie des Workers ; PR #3393 : runtime async partagé [V] |
| Node : permissions et SEA | https://nodejs.org/api/permissions.html , https://nodejs.org/api/single-executable-applications.html | `--allow-addons` sinon `ERR_DLOPEN_DISABLED` ; addons SEA en assets écrits en fichier temporaire puis `dlopen` ; `codesign` après injection [V] | — | Modèle de permission du chargeur | — |
| Signature : updater Tauri (minisign) | https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater | `plugins/updater` utilise minisign [V] | Apache-2.0/MIT | Format Ed25519 éprouvé pour signer les plugins [D] | — |
| `jedisct1/rust-minisign-verify` | https://github.com/jedisct1/rust-minisign-verify | Actif (2026-09-25) [V] | Licence à confirmer (l'API GitHub renvoie NOASSERTION) | Vérification minimale sans dépendances | — |
| `sigstore/sigstore-rs` | https://github.com/sigstore/sigstore-rs | v0.14.0 [V] | Apache-2.0 | Signature avec provenance (à terme) | Lourd |

---

## 5. Desktop JS sans Electron, sur moteur système

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| `blackboardsh/electrobun` | https://github.com/blackboardsh/electrobun | v2.0.3-beta.9 (2026-10-02), 12 879★ [V] | MIT | Processus principal sur **Cottontail** (runtime Zig sur JSC, par défaut) ou Bun ; couche native Zig/ObjC/C++ ; WKWebView, WebView2, WebKitGTK, CEF optionnel [V]. RPC typé `defineRPC` sur un transport loopback chiffré (AES-256-GCM, clé par webview : `package/src/sdks/main/core/hostTransportEncryption.ts`, `package/src/preload/encryption.ts`), avec un pont natif en repli [V]. Bundle auto-extractible zstd, correctifs bsdiff (Zig), mises à jour depuis un stockage statique avec rollback [V]. `<electrobun-webview>`, `<electrobun-wgpu>` [V] | v2 en bêta ; CLI Hutch neuve ; Zig [V] |
| `blackboardsh/cottontail` | https://github.com/blackboardsh/cottontail | Poussé le 2026-10-02 ; binaires macOS arm64, Linux x64/arm64, Windows x64/arm64 [V] | **Aucune licence** | Preuve qu'un runtime JSC hors Bun suffit pour le desktop | Lecture seule |
| `blackboardsh/zig-bsdiff`, `zig-zstd` | https://github.com/blackboardsh/zig-bsdiff | Actifs [V] | MIT | Format des correctifs de mise à jour | Zig (hors politique Bun/Rust côté outillage) |
| `versotile-org/tauri-runtime-verso` | https://github.com/versotile-org/tauri-runtime-verso | Poussé le 2026-09-10, 141★ [V] | MIT | **Précédent du « processus hôte »** : implémente les traits `tauri-runtime` par proxy vers un exécutable externe (`versoview`, Servo) déclaré en `externalBin` [V] | Tauri 2 (`tauri-utils =2.6.0`) ; Verso archivé [V] |
| `webviewjs/webview` | https://github.com/webviewjs/webview | v1.0.0-rc.2 (2026-10-03), testé avec Bun 1.4.2 ; N-API + tao/wry **dans le processus**, via `pump_events` [V] | MIT | API JS de fenêtres sur wry [V] | Issue #52 : gel Linux/X11/GTK3 dans `set_bounds` pendant `pump_events` (corrigé en 0.4.5), problèmes de fermeture résiduels [V]. Argument de plus pour le processus hôte [D] |
| `nativewindow/webview` | https://github.com/nativewindow/webview | v1.0.6 (2026-04), bêta [V] | MIT | IPC typé par schéma pour Bun, Deno et Node | Jeune |
| `tauri-apps/tauri`, `wry`, `tao` | https://github.com/tauri-apps/tauri | Tauri v3.0.0-alpha.4 (2026-10-01) ; wry 0.57.0 (2026-09-08) ; tao 0.37.1 (2026-09-26) [V] | Apache-2.0/MIT | Pins du plan | — |
| `webview/webview` | https://github.com/webview/webview | Actif (2026-03) [V] | MIT | Webview C/C++ minimale (utilisée par `webview-bun`) | — |
| `HuakunShen/tauri-plugin-js` | https://github.com/HuakunShen/tauri-plugin-js | 2026-07 [V] | Aucune | Patron inverse : Bun en sidecar via kkrpc sur stdio | — |

---

## 6. Empreintes TLS et stealth sur BoringSSL

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| **`oven-sh/bun` PR #40275** | https://github.com/oven-sh/bun/pull/40275 | Ouverte (2026-08-24) ; `src/http/tls_fingerprint.rs` (+543 lignes), `SSLConfig.rs`, `ProxyTunnel.rs`, `NodeTLS.cpp` (cale `SSL_set_aes_hw_override_for_testing`), 40 tests ClientHello [V] | MIT | **Chantier A, TLS : à cherry-picker.** JA3 strict, toutes les options Chrome, tunnels CONNECT couverts, empreinte prise en compte dans le cache de `SSL_CTX` [V] | Hors périmètre (assumé par la PR) : ordre exact des extensions, `delegated_credentials`, `record_size_limit`, FFDHE (Firefox, Safari) et **empreinte HTTP/2** [V] |
| `oven-sh/boringssl` | https://github.com/oven-sh/boringssl | Fork de google/boringssl, tête `525782a54` (2026-09-26) [V] | Apache-2.0 (+ ISC/OpenSSL) | API de la ligne 4 du §0 [V] | — |
| `0x676e67/wreq` | https://github.com/0x676e67/wreq | v0.16.1 (2026-08-27) [V] | Apache-2.0 | Référence d'intégration | tokio ou compio : exclu du noyau [V] |
| `0x676e67/wreq-util` | https://github.com/0x676e67/wreq-util | v0.2.0 (2026-08-22) ; profils Chrome, Firefox, Safari, Opera, OkHttp ; Chrome 150+ avec ML-DSA, 152+ avec GREASE sur les sigalgs et `trust_anchors` vide [V] | Apache-2.0 | Profils (suites, groupes, ALPS, ordre des en-têtes) convertibles en options `tls` de Bun [D] | Attribution Apache à conserver |
| `0x676e67/btls` | https://github.com/0x676e67/btls | v0.5.6 ; 20 patches BoringSSL : ffdhe, chiffrements anciens, `SSL_OP_NO_PSK_DHE_KE`, ordre des extensions, record size limit, delegated credentials, préférences de chiffrement, sigalgs, compression zstd… ; base google/boringssl `f1f2556a` [V] | Apache-2.0 | Patches à appliquer seulement pour Firefox ou Safari [D] | Seconde BoringSSL si la crate est liée telle quelle [V] |
| `0x676e67/http2` | https://github.com/0x676e67/http2 | v0.5.20 [V] | Apache-2.0 | Ordre des SETTINGS, ordre des pseudo-en-têtes (empreinte Akamai) : modèle pour le `h2_client` de Bun [D] | — |
| `0x676e67/pingly` | https://github.com/0x676e67/pingly | v0.2.0 ; JA3, JA4, Akamai HTTP/2, HTTP/3, TCP passif ; serveur autohébergeable [V] | Apache-2.0 | **Validation n° 5 sans tls.peet.ws** (outil Rust conforme à la politique d'outillage) [D] | — |
| `FoxIO-LLC/ja4` | https://github.com/FoxIO-LLC/ja4 | v1.0.1 [V] | JA4 : BSD-3 ; **JA4+ (JA4H, JA4X…) : FoxIO License 1.1, monétisation interdite** [V] | Calcul JA4 | Ne pas intégrer JA4+ dans un produit [V] |
| `lexiforest/curl-impersonate` | https://github.com/lexiforest/curl-impersonate | v2.2.3 (2026-09-16) [V] | MIT | Profils et patches de référence | C/Shell |
| `apify/impit` | https://github.com/apify/impit | Actif [V] | Apache-2.0 | Approche rustls patchée | Autre pile TLS |
| `0xMassi/webclaw-tls` | https://github.com/0xMassi/webclaw-tls | Archivé [V] | MIT | Leçon : rustls patché incompatible avec certains serveurs ; retour à BoringSSL via `wreq` [V] | — |
| Bun SOCKS | issue #16812 (ouverte), PR #21223 (Zig, fermée sans fusion) [V] | https://github.com/oven-sh/bun/issues/16812 | MIT | Spécification de `socks5`/`socks5h` à reporter dans `ProxyTunnel.rs` [D] | Code Zig obsolète [V] |

---

## 7. Crawl et index 24/7 en Rust (one shot 2)

| Projet | Lien | État | Licence | Réutilisable pour | Risques |
| --- | --- | --- | --- | --- | --- |
| `spider-rs/spider` | https://github.com/spider-rs/spider | Crate 2.54.0 ; features `priority_frontier`, `adaptive_concurrency`, `auto_throttle`, `etag_cache`, `warc`, `disk` (sqlx SQLite), `decentralized` (`spider_worker`), `cron`, `wreq`, `chrome` (chromey), `webdriver` [V] | MIT | Algorithmes : frontier à priorités, politesse adaptative, cache ETag, écriture WARC, crawl « smart » HTTP d'abord [V/D] | tokio + reqwest : référence, pas dépendance du noyau [V] |
| `apalis-dev/apalis` | https://github.com/apalis-dev/apalis | v1.0.0-rc.10 (2026-09-15) ; backends Redis, PostgreSQL, SQLite [V] | MIT | Patron du trait `Storage` à trois backends pour `FrontierStore` [D] | Centré sur tokio |
| `crawler-commons/url-frontier` | https://github.com/crawler-commons/url-frontier | 2.6 (2026-08-19) ; API gRPC neutre (récupérer et mettre des URL, débit par hôte, statistiques) + suite de tests [V] | Apache-2.0 | Vocabulaire et sémantique de `FrontierStore` ; tests de conformité [D] | Implémentation de référence en Java |
| `Smerity/texting_robots` | https://github.com/Smerity/texting_robots | 2024 [V] | Apache-2.0 | Parseur robots.txt testé | Peu actif |
| `Folyd/robotstxt` | https://github.com/Folyd/robotstxt | 2021 [V] | Apache-2.0 | Port du parseur Google | Inactif |
| `jedireza/warc` | https://github.com/jedireza/warc | 2024 [V] | MIT | Lecture et écriture WARC | Peu actif |
| `fastcrw/crw` | https://github.com/fastcrw/crw | v0.37.2 [V] | **AGPL-3.0** | Forme d'API compatible Firecrawl (référence) | AGPL |
| `let4be/crusty` | https://github.com/let4be/crusty | Inactif depuis 2021 [V] | GPL-3.0 | Conception d'un crawler large (ClickHouse) | GPL |

---

## Recommandations pour le plan

### J0 (orchestrateur)

1. **[V→D] Ne pas couper l'amont du noyau.** `aphrody-labs/bun` est l'amont plus 6 commits. On garde la fusion `upstream/main → main` pour `crates/core` et on limite la divergence à `crates/browser` et `crates/plugins` ; le renommage `aphrody-*` s'applique aux crates nouvelles. Renommer les ~105 crates de Bun rendrait chaque synchro amont conflictuelle [D].
2. **[V] Mettre à jour la checklist de build.** JSC est compilé depuis les sources par défaut (PR #41330). Choisir entre `--webkit=prebuilt` (rapide) et la compilation depuis les sources avec cache ninja/ccache. Si l'hôte de realm exige un patch JSC, passer par `--local-deps=WebKit=`.
3. **[V] Cherry-picks amont à intégrer dès J0** : PR #40275 (empreinte TLS, chantier A) ; éventuellement #43430 et #42222 (contextes et événements CDP de `Bun.WebView`, chantier D) ; suivre #30033 et #30036 (addons dans `--compile`) pour la distribution des plugins.

### Chantier A (transport)

- **[V] TLS** : cherry-pick de la PR #40275. Les profils de `wreq-util` (Apache-2.0, avec attribution) fournissent les chaînes `ja3` et les options. La sous-section TLS de `BROKEN.md` se réduit à l'ordre exact des extensions et aux extensions Firefox [D].
- **[D] HTTP/2** : l'empreinte Akamai (ordre et valeurs des SETTINGS, WINDOW_UPDATE, ordre des pseudo-en-têtes `m,a,s,p`) n'est couverte par rien. Il faut la reprendre dans `h2_client` sur le modèle de `0x676e67/http2`.
- **[D] SOCKS5** : reporter le protocole de la PR #21223 (dont `socks5h`) dans `ProxyTunnel.rs`. La demande est ouverte en amont (#16812), donc une PR amont est possible.
- **[D] Mesure** : `pingly` autohébergé (JA3, JA4, Akamai) remplace tls.peet.ws dans la validation n° 5. Utiliser JA4 seul, sous BSD-3, et éviter JA4+.

### Chantier B (runtime de page sur JSC), chemin critique

1. **[D] Essai d'une heure avant tout Rust** : dans `yolo`, `vm.createContext()` + `new vm.Script(bootstrapJs, { cachedData })` + un objet `Deno.core.ops` fourni par un addon N-API placé dans le contexte. On valide ainsi que `bootstrap.js` tourne sur JSC (fumigation `document.title`, `querySelector`) et on mesure le coût de démarrage, avec ou sans cache de bytecode.
2. **[V→D] Hôte de realm = emballage de `node:vm`.** Le C++ existe déjà : `NodeVMGlobalObject` pour l'isolation, `produceCachedData` pour le bytecode, `NodeVMRunTermination` pour le watchdog. Le noyau publie une table C versionnée `(create_realm, install_host_fn, eval_cached, terminate)`, puisque les plugins n'ont accès à aucun symbole JSC [V].
3. **[V] Méthode de portage des ops** : suivre la table de `obscura-android-port` (`#[op2]` devient une fonction plus une enveloppe JS ; ops async par file de promesses ; watchdog par interruption) et le modèle d'interruption de Rong (préemptive, à portée limitée, nettoyée avant réutilisation du worker).
4. **[D] Filet de sécurité « sans V8 » sans port** : construire `obscura-js` avec `deno_core` en `default-features = false, features = ["quickjs"]` (façade `deno_v8`, PR Deno #36194). Cela donne un état vert sans V8 pour `aphrody` (one shot 2 bis, directive « V8 jusqu'à la parité ») et une base de comparaison des tests. Ce n'est pas la cible : QuickJS n'a pas de JIT.
5. **[V] Ne pas compter sur `v8x` + JSC pour Linux** (macOS seulement, `deno_core` à 382/429) : il sert de table de correspondance `v8__*` → API C de JSC, pas de dépendance.
6. **[V] Risques à tester en premier** : bugs de realm de `node:vm` (#44518, #44410, #39994) et `Error.stackTraceLimit` différent dans un contexte (#42602, #42604).

### Chantier C (moteur de navigation, sans tokio)

- **[V]** Bun n'utilise pas d'async Rust (PR #30412) ; tokio dans un addon pose des problèmes connus (Bun #40211 ; napi-rs #3443). La règle « pas de tokio dans les plugins » est justifiée.
- **[D]** Modèle de référence : un seul processus avec un ordonnanceur partagé par CDP et WebDriver (Moli, « 1 processus / 24 threads » [A]).

### Chantier D (surfaces : CDP, CLI, MCP, `Bun.WebView`)

- **[V→D] Backend `"obscura"` de `Bun.WebView` sans travail moteur** : `backend: { url: "ws://127.0.0.1:9222/devtools/browser/…" }` vers `yolo browser serve` (hors processus). Seul obstacle connu : le backend Chrome est réservé au thread principal (doc officielle), à lever pour les Workers.
- **[V] Typage CDP** : `chromiumoxide_cdp` (MIT/Apache, généré depuis le PDL) ou `moli-protocol-cdp` (serde pur), plutôt que des structures écrites à la main. La liste des domaines de Lightpanda sert de référence, sans copie (AGPL).
- **[D] Validation n° 4** : ajouter Lexbench (Apache-2.0) aux suites Puppeteer et Playwright, pour un chiffre comparable à Moli, Lightpanda et Obscura V8. Échecs attendus d'après les issues Obscura #807, #1103 et #1123.

### Chantier E (DOM et rendu)

- **[V]** L'amont est à `taffy` 0.14.0 et `cosmic-text` 0.19.0, quand Obscura vendorise 0.12 et `=0.14.2`. On garde les vendors pendant le one shot ; la mise à jour vient après.
- **[D]** À long terme, la cascade sur Stylo (Blitz, Moli : Stylo + Taffy + Parley) est la voie éprouvée, mais Stylo est sous MPL-2.0 (au niveau du fichier). Les écarts DOM connus d'Obscura (#1001, #1021) sont à inscrire dans `BROKEN.md` dès J0.

### One shot 2 (crawl, stores, release)

- **[D]** `FrontierStore` reprend le vocabulaire d'URL Frontier (récupérer et mettre des URL, débit par hôte, statistiques), avec sa suite de tests comme contrat. Le patron « un trait, trois backends » vient d'apalis ; l'implémentation passe par `Bun.sql` et `Bun.redis`.
- **[V]** Algorithmes à reprendre de `spider` (MIT) : frontier à priorités, auto-throttle, cache ETag, WARC, « HTTP d'abord, navigateur si nécessaire » (`crawl_smart`). Robots.txt : `texting_robots` (Apache-2.0).
- **[V→D] Signature et chargement des plugins** : utiliser le format minisign (Ed25519, celui de l'updater Tauri) ; une ABI C seulement, conformément à la leçon des plugins Rust de Deno 1.13 ; une permission explicite « addons » comme `--allow-addons` dans Node.

### One shot 3 (desktop)

- **[V] Processus hôte confirmé** : `tauri-runtime-verso` implémente les traits `tauri-runtime` en proxy vers un exécutable externe, ce qui est exactement le modèle de la partie 3. À l'inverse, l'intégration dans le processus via `pump_events` a gelé sous GTK (webviewjs #52).
- **[V→D] IPC et mises à jour** : reprendre d'Electrobun le chiffrement par webview (AES-256-GCM sur loopback), les correctifs bsdiff et le bundle zstd. Electrobun montre aussi qu'un runtime JSC hors Bun suffit au desktop (Cottontail).

### Décision stratégique à trancher avant le one shot 1 [D]

Obscura (V8, 44,9 % sur Lexbench [A]) est la base retenue. Moli (Apache/MIT, 81,9 % [A]) est meilleur mais tout aussi lié à V8. Aucun des deux n'est plus simple à porter sur JSC. La recommandation est de garder Obscura pour le one shot 1, ce qui suffit pour la fumigation, mais de mesurer les deux sur Lexbench avant le chantier « fiabilisation », et d'emprunter à Moli des composants découplés de V8 (types CDP, conformité WPT, mise en page à la demande).

---

## Sources (toutes consultées le 2026-10-05)

- Bun : https://github.com/oven-sh/bun/pull/30412 , https://github.com/oven-sh/bun/pull/41330 , https://github.com/oven-sh/bun/pull/40275 , https://github.com/oven-sh/bun/pull/28185 , https://github.com/oven-sh/bun/pull/39423 , https://github.com/oven-sh/bun/pull/43430 , https://github.com/oven-sh/bun/pull/42222 , https://github.com/oven-sh/bun/pull/43431 , https://github.com/oven-sh/bun/pull/29953 , https://github.com/oven-sh/bun/pull/30033 , https://github.com/oven-sh/bun/pull/30036 , https://github.com/oven-sh/bun/pull/44059 , https://github.com/oven-sh/bun/pull/21223 , https://github.com/oven-sh/bun/issues/16812 , https://github.com/oven-sh/bun/issues/35995 , https://github.com/oven-sh/bun/issues/40211 , https://github.com/oven-sh/bun/pull/44378 , https://github.com/oven-sh/bun/pull/44518 , https://github.com/oven-sh/bun/pull/39994 , https://github.com/oven-sh/bun/issues/42602 , https://github.com/oven-sh/bun/blob/main/src/linker.lds , https://github.com/oven-sh/bun/blob/main/src/symbols.txt , https://github.com/oven-sh/bun/tree/main/src/jsc , https://github.com/oven-sh/bun/tree/main/src/jsc/bindings/v8 , https://github.com/oven-sh/bun/blob/main/docs/runtime/webview.mdx , https://github.com/oven-sh/bun/tree/main/packages/bun-native-plugin-rs , https://bun.com/docs/runtime/node-api , https://bun.com/docs/runtime/plugins , https://github.com/oven-sh/bun/releases
- InfoQ, « Bun Rewrites 535K Lines of Zig into Rust » : https://www.infoq.com/news/2026/09/bun-AI-rewrite-zig-rust-4-months/
- BoringSSL : https://github.com/oven-sh/boringssl/blob/main/include/openssl/ssl.h , https://github.com/google/boringssl/blob/main/include/openssl/ssl.h , https://github.com/0x676e67/btls (patches `btls-sys/patches/*`)
- Écosystème wreq : https://github.com/0x676e67/wreq/releases , https://github.com/0x676e67/wreq-util , https://github.com/0x676e67/http2 , https://github.com/0x676e67/pingly
- Empreintes : https://github.com/FoxIO-LLC/ja4 , https://github.com/lexiforest/curl-impersonate , https://github.com/apify/impit , https://github.com/0xMassi/webclaw-tls
- v8x et Deno : https://github.com/denoland/v8x (README, `CLAUDE.md`, `Cargo.toml`, `docs/snapshots-and-esm.md`, `tests/status/report.json`, issues #65, #70, #73) , https://github.com/denoland/deno/pull/36194 , https://github.com/denoland/deno/blob/main/libs/deno_v8/Cargo.toml , https://crates.io/api/v1/crates/deno_v8 , https://github.com/denoland/deno_core , https://deno.com/blog/v1.13
- JSC Rust : https://github.com/LingXia-Dev/Rong (+ PR #28, `javascriptcore/sys/README.md`) , https://github.com/kevincaicedo/rust-jsc , https://github.com/wasmerio/rusty_jsc , https://github.com/endoli/javascriptcore.rs , https://github.com/tauri-apps/javascriptcore-rs , https://github.com/Brooooooklyn/jsc-rs , https://github.com/blackboardsh/jsc , https://github.com/oven-sh/WebKit
- Portage Obscura : https://github.com/krishn03id/obscura-android-port , https://github.com/h4ckf0r0day/obscura (issues #807, #1001, #1021, #1093, #1103, #1117, #1123, #1151 ; PR #1031)
- Navigateurs : https://github.com/lexmount/moli (README, `Cargo.toml`, `moli-webidl`, `moli-protocol-cdp`) , https://github.com/lexmount/Lexbench-Headless-Browser , https://github.com/lightpanda-io/browser (README, release 1.0.0, `src/server/cdp/domains`) , https://github.com/servo/servo/releases , https://github.com/DioxusLabs/blitz , https://github.com/LadybirdBrowser/ladybird , https://github.com/project-oxi/oxibrowser , https://github.com/yfedoseev/browser_oxide , https://github.com/koloss777/nokk , https://github.com/mattsse/chromiumoxide , https://github.com/spider-rs/chromey , https://github.com/rust-headless-chrome/rust-headless-chrome , https://github.com/salamaashoush/ferridriver
- Desktop : https://github.com/blackboardsh/electrobun , https://framework.blackboard.sh/electrobun/guides/architecture/overview , https://framework.blackboard.sh/electrobun/apis/browser/electroview-class/ , https://github.com/blackboardsh/electrobun/blob/main/package/src/sdks/main/core/hostTransportEncryption.ts , https://github.com/blackboardsh/cottontail , https://github.com/versotile-org/tauri-runtime-verso , https://github.com/webviewjs/webview (issue #52) , https://github.com/nativewindow/webview , https://github.com/tauri-apps/tauri/releases , https://github.com/tauri-apps/wry , https://github.com/tauri-apps/tao , https://github.com/tauri-apps/plugins-workspace (updater/minisign) , https://github.com/HuakunShen/tauri-plugin-js
- Plugins et runtimes : https://github.com/napi-rs/napi-rs (issue #3443, PR #3393) , https://nodejs.org/api/permissions.html , https://nodejs.org/api/single-executable-applications.html , https://github.com/jedisct1/rust-minisign-verify , https://github.com/sigstore/sigstore-rs
- Crawl : https://github.com/spider-rs/spider (`spider/Cargo.toml`) , https://github.com/apalis-dev/apalis , https://github.com/crawler-commons/url-frontier , https://github.com/Smerity/texting_robots , https://github.com/Folyd/robotstxt , https://github.com/jedireza/warc , https://github.com/fastcrw/crw , https://github.com/let4be/crusty
- Local (lecture seule) : `/home/aphro/aphrody/Cargo.lock` (`deno_core 0.412.0 → deno_v8 0.4.0 → {v8 150.4.0, v8x 149.4.0-rc.4}` ; `wreq 6.0.0-rc.31`, `wreq-util 3.0.0-rc.14`, `btls 0.5.6`), `crates/web/obscura-net/Cargo.toml`, plan `docs/plans/fusion/drive/PLAN-FUSION-APHRODY (1 de 3).md` à `(4 de 4).md`.
