# Obscura amont au 2026-10-05 : releases, commits depuis notre base, issues/PR utiles, roadmap

Recherche en lecture seule pour le plan de fusion Obscura × Bun (`docs/plans/fusion/drive/PLAN-FUSION-APHRODY (1 de 3).md` … `(4 de 4).md`). Toutes les sources ont été consultées le **2026-10-05**.

- **Périmètre** : recentré sur consigne du coordinateur. La « v3 » et le guide « v2 → v3 » concernent Tauri et sont couverts par un autre agent. Pour mémoire seulement : Obscura n'a que des versions `0.x`, la dernière étant `v0.2.4`, sans ligne `0.3`, sans milestone et sans branche de version.
- **Méthode** :
  - API GitHub en lecture (`aphrody git api`, `aphrody git graphql`) : 1 182 issues et PR téléchargées (526 issues, 656 PR), 17 releases, tags, branches, milestones et discussions ;
  - clone local `scratchpad/obscura/fork` (remote `upstream` = amont), mesures par `git show`/`git diff` sans checkout ;
  - WebFetch/WebSearch pour le site, le wiki et les articles.
- **Légende** :
  - **[F]** fait vérifié sur la source citée ;
  - **[D]** déduction ou recommandation de cet audit.

---

## 1. Versions, releases et changelog

### 1.1 Faits généraux

- [F] Il n'y a **aucun `CHANGELOG.md`** dans l'arbre (racine de `upstream/main` : `AGENTS.md`, `CONTRIBUTING.md`, `Cargo.toml`, `README.md`, `SECURITY.md`, `docs/`, `render-repros/`, `vendor/`…). Les notes de release GitHub tiennent lieu de changelog.
- [F] Il existe 17 releases, de `v0.1.0` (2026-04-13) à **`v0.2.4` (2026-10-04, tag `1fccab2c1` = tête de `main`)**, chacune avec 20 archives : linux/macos x86_64+aarch64, windows x86_64, combinées avec `{render, stealth, no-render, no-render-stealth}`.
- [F] La version du workspace reste `0.1.0` (`Cargo.toml` `[workspace.package]`). Les binaires annoncent le tag à la release et `0.1.0-dev+<sha>` en build local (notes v0.2.2).
- [F] Branches amont : `main` et `fix/hit-test-sibling-paint-order-20261003` (PR #1182 ouverte). Aucun milestone.
- [F] Activité :
  - le projet a été créé le 2026-04-13 ;
  - 28 501 étoiles et 180 éléments ouverts (92 issues, 88 PR) ;
  - dernier push le 2026-10-04 ;
  - licence Apache-2.0.
- [F] Cadence : environ une release tous les 14 jours (0.2.0 le 08-08, 0.2.1 le 08-23, 0.2.2 le 09-05, 0.2.3 le 09-20, 0.2.4 le 10-04). Entre v0.2.3 et v0.2.4, **212 commits en 14 jours**.

### 1.2 Releases récentes

Seuls les points qui touchent la fusion sont repris.

| Release | Date | Points structurants |
| --- | --- | --- |
| **v0.2.4** (`1fccab2`) | 2026-10-04 | <ul><li>Teardown de frames sans crash sous GC (#1197).</li><li>Workers CDP morts récoltés et relancés (#1198).</li><li>Moins d'attente inutile : polling inactif, latence des réponses CDP, rendu inchangé réutilisé (#1078, #1111, #1131, #1132, #1137).</li><li>Fetch résolu dès les en-têtes (#1146) et annulation `AbortSignal` jusqu'au transport (#1193).</li><li>Sécurité : Teredo (#1098), chargeur du rendu soumis au réseau privé (#1072), réécriture d'URL malformée fermée (#1076), `file://` gardé dans `Page` (#1070), `pushState` même origine (#1057).</li><li>`Runtime.getHeapUsage` lit le tas V8 natif et `HeapProfiler.collectGarbage` collecte réellement (#1135).</li><li>La CI de release exige 33/33 étapes du parcours d'obstacles (#1195).</li><li>Limites déclarées : IndexedDB non persistant (#1093), sessions perdues à la relance d'un worker, corps de réponse bufferisés, service workers et média incomplets.</li></ul> |
| **v0.2.3** (`1a3169da`, base de la copie `aphrody`) | 2026-09-20 | <ul><li>Auth CDP/MCP : jeton bearer de 32 octets ou plus obligatoire hors loopback (`OBSCURA_CDP_TOKEN`, `OBSCURA_MCP_TOKEN`) ; requêtes portant `Origin` et Host étrangers refusées (#1030, #1048).</li><li>`deno_core` 0.350 → 0.412 et V8 137 → 150.4 (#1031 : binaire +7,32 %, RSS +2,39 %).</li><li>Pages concurrentes avec isolates indépendants (#872/#927).</li><li>Rustls RUSTSEC-2026-0285.</li><li>Profil `release-dist` (`opt-level = "s"`, LTO fat ; binaire 100 → 70 MiB, #965).</li></ul> |
| v0.2.2 | 2026-09-05 | <ul><li>Clients CDP générés (chromiumoxide, spider).</li><li>`Input.insertText`.</li><li>Une erreur de script ne bloque plus la boucle (#699).</li><li>SSRF complétée : 6to4/NAT64, CGNAT, plages IANA ; client stealth inclus (#810, #816).</li></ul> |
| v0.2.1 | 2026-08-23 | <ul><li>Un realm V8 par iframe (#600/#621).</li><li>MCP pompe la boucle entre deux appels d'outils.</li><li>`mksnapshot` cible en compilation croisée (#682).</li></ul> |
| v0.2.0 | 2026-08-08 | Rendu natif : layout, peinture, captures, screencast, PDF raster, 4 variantes de build. |
| v0.1.11 | 2026-07-26 | <ul><li>Sessions CDP isolées.</li><li>Un thread OS par connexion CDP (#435) ; le `v8_lock` global devient un verrou par connexion (`9065f38`, 2026-07-20).</li><li>Archives `-stealth` séparées (wreq/BoringSSL).</li></ul> |
| v0.1.9 | 2026-06-24 | API d'interception dans la crate embarquable `obscura` (#306/#326) ; identité Chrome 145 cohérente entre TLS, JS et WebGL. |
| v0.1.7 | 2026-06-06 | Crate `obscura` embarquable, watchdog V8, délai CDP par commande. |

---

## 2. Commits amont depuis notre base (`0cdd42e` → `upstream/main` = `1fccab2` = v0.2.4)

### 2.1 Volume

- [F] `0cdd42e` (2026-10-01, fusion de #1146) descend de v0.2.3. Entre v0.2.3 et `0cdd42e`, 105 commits et 42 PR ; entre `0cdd42e` et `upstream/main`, **107 commits (49 hors fusions, 58 fusions), 40 PR**.
- [F] Diff : 62 fichiers, +10 305/−952 lignes.

| Crate ou zone | Lignes modifiées |
| --- | --- |
| `obscura-js` | `runtime.rs` +2 323, `ops.rs` +558, `bootstrap.js` +1 430/−… (net +1 014 lignes), `frame.rs` +82, `write_stream.rs` |
| `obscura-render` | `paint.rs` +1 838, `dom.rs` +928, `inline.rs` +238, `css.rs`, `lib.rs` |
| `obscura-browser` | `page.rs` +433, nouveau `idle_deadline.rs` (329 lignes) |
| `obscura-cdp` | `server.rs` +264, `domains/page.rs` +200, `domains/input.rs`, `domains/emulation.rs` ; 2 nouveaux tests |
| `obscura-cli` | `main.rs` +107, `worker.rs` ; 3 nouveaux tests |
| `obscura-net` | nouveau `operator_hint.rs` (84 lignes), `client.rs` +20, `wreq_client.rs` +33 |
| `obscura-dom` | `tree.rs` +111, `selector.rs` |
| `vendor/` | `taffy` (`compute/`, `style/`) et `cosmic-text` (`src/font`) patchés |
| Docs | `docs/` (Playwright, Puppeteer, CLI, MCP) |

- [F] **Manifests** :
  - aucune nouvelle dépendance d'exécution ;
  - seulement `tokio` `test-util` en dev-dependency (`obscura-browser`, `obscura-cdp`) et la feature `shape-run-cache` de `cosmic-text =0.14.2` ;
  - **aucun changement de V8/`deno_core`**.
- [F] **API embarquable inchangée** : aucun commit sur `crates/obscura/src` ni `docs/Use-as-a-Rust-library.md` dans l'intervalle. La crate reste une dépendance git, qui exige tokio (`rt`, `macros`) et compile V8.

### 2.2 Couplage moteur mesuré

Même méthode aux quatre révisions : occurrences `v8::` et `tokio::` hors `tests/`, attributs `#[op2]`, lignes de `bootstrap.js`.

| Révision | `v8::` | Fonctions `op_*` | `deno_core::` | `tokio::` | `catch_unwind` | `bootstrap.js` (lignes) | Ops référencés par `bootstrap.js` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `1a3169da` (v0.2.3, copie `aphrody`) | 135 | 56 | 108 | 751 | 9 | 16 332 | 56 |
| `0cdd42e` (base du plan) | 166 | 68 | 109 | 880 | 10 | 16 919 | 69 |
| **`1fccab2` (v0.2.4)** | **183** | **73** | 112 | **1 035** | 15 | **17 933** | 74 |
| `92de223` (notre `yolo`) | 183 | 73 | 112 | 1 039 | 15 | 17 933 | 74 |

- [F] Nouveaux ops depuis la base :
  - `op_fetch_cancel_handle` et `op_abort_signal_state`, avec une marque `v8::Private` « obscura.AbortSignal » (#1193) ;
  - `op_report_browser_exception` (#1174) ;
  - `op_layout_caret` et `op_layout_caret_rect` (#1187).
- [F] Les 17 nouvelles occurrences `v8::` sont toutes dans `obscura-js` : `PinScope`, `Private::for_api`, `scope_with_context!` dans `frame.rs`.
- [F] Croissance de `tokio::` par crate depuis la base (tests en ligne inclus) : `obscura-browser` +73, `obscura-js` +58, `obscura-cdp` +23, `obscura-cli` +10, `obscura-net` +4, `obscura-mcp` +1.
- [F] `idle_deadline.rs` repose sur `tokio::time::timeout_at` et un réveil précis par FFI sous macOS.

### 2.3 Les 40 PR fusionnées depuis la base, par domaine

- **Runtime JS (`obscura-js`)** :
  - #1197 : teardown des contextes de frame empruntés, évite un use-after-free V8 (rusty_v8 #2084, correctif amont #2085 non requis) ;
  - #1163 : n'atteint plus les entrées natives de streaming wasm ;
  - #1174 : exceptions de microtâches ;
  - #1191 : retrait des timers et realms des frames détachées ;
  - #1190 et #1189 : `document.write` et foster-parenting ;
  - #1173 : `Response` ;
  - #1172 : `style.setProperty` sans effet ;
  - #1170 : `offsetParent` ;
  - #1166 : Navigation Timing ;
  - #1112 : interfaces SVG ;
  - #1196 : `new Option` ;
  - #1192 : accès nommé de `Window` ;
  - #1183 : `execCommand` ;
  - #1074 : `history` ;
  - #1081 : `Origin` sur les requêtes non-GET de même origine ;
  - #1088 : accesseurs auteur ;
  - #1028 : `media-query` et `reduced-motion`.
- **Réseau** :
  - #1193 : annulation `AbortSignal` ;
  - #1181 : destinations des ressources dynamiques ;
  - #1160 : en-têtes HTTP/1 repliés, transports normal et stealth ;
  - #1129 : message d'aide sur le réseau privé (`operator_hint.rs`) ;
  - #1175 : doc du skill.
- **CDP** :
  - #1184, #1185, #1186 : `beforeinput`, `keydown` annulé, lecture seule ;
  - #1194 : routes d'observateur pendant une interception attendue ;
  - #1128 : événements réseau vers les sessions observatrices ;
  - #1150 : fichier `--ready-file` portable sous Windows.
- **CLI** :
  - #1198 : récolte et relance des workers ;
  - #1119 : statut HTTP final dans le worker.
- **Rendu** : #1111 (perf : attente inactive « parquée », réutilisation du rendu inchangé), #1164, #1176, #1178, #1179, #1180, #1187, #1188.
- **CI et tests** : #1195 (porte 33/33), #1121.

---

## 3. Notre fork `aphrody-labs/obscura`

### 3.1 Branches

| Branche | Où | Commit |
| --- | --- | --- |
| `main` | distant | `0cdd42e` (non avancée ; 107 commits derrière l'amont) |
| `yolo` | distant | `43ae887` (commit SSRF seul, sur base `0cdd42e`) |
| `sync/upstream-2026-10-05` | distant | `92de223` |
| `yolo` | local | `92de223`, **108 commits devant `origin/yolo`** (non poussé sous ce nom) |

### 3.2 Contenu de `92de223` et de notre commit

- [F] `git diff upstream/main yolo` donne exactement **2 fichiers, +168/−7**, soit le seul commit `43ae887`. La fusion est donc propre : `92de223` = v0.2.4 + notre politique SSRF.
- [F] Contenu de `43ae887` (aphrody-dev, 2026-10-05) :
  - `obscura-net/src/client.rs` :
    - `SsrfGuardResolver::with_environment_policy(allow_private, honor_environment)` ;
    - champ `ObscuraHttpClient::honor_private_network_environment` (défaut `true`) ;
    - `validate_context_url` : en contexte strict, seuls `http(s)` passent, `OBSCURA_ALLOW_PRIVATE_NETWORK` est ignorée et `no_proxy()` est forcé.
  - `obscura-js/src/ops.rs` : `enforce_context_request_policy`, appelée avant chaque requête, preflight et saut de redirection de `op_fetch_url` et de `stealth_fetch_all`.
  - 5 tests.

### 3.3 Recouvrements avec l'amont ouvert

- [D] **#861** (ouverte, `--allow-network <CIDR>`, `NetworkPolicy` dans `obscura-net/src/policy.rs`) touche les mêmes points : `validate_url`, les deux `SsrfGuardResolver`, `validate_fetch_url`. Conflit certain si elle fusionne.
- [D] **#862** (ouverte, porte `file://` au niveau de la primitive `fetch_file_url`) recoupe notre règle « contexte natif = HTTP(S) seulement ».
- [D] Notre contrôle n'agit que si un intercepteur de politique est installé. **#1056** (ouverte : l'URL de remplacement d'un `Continue` qui ne se parse pas échappe au contrôle SSRF) reste donc ouverte hors contexte strict.
- [D] Le message de #1129 conseille `OBSCURA_ALLOW_PRIVATE_NETWORK=1`, variable que notre contexte strict ignore : message trompeur pour un embarqueur.

### 3.4 Copie du monorepo `aphrody`

- [F] `docs/reference/web/crates/aphrody-obscura/OBSCURA-UPSTREAM.txt` annonce toujours la base `1a3169da` (v0.2.3).
- [F] L'arbre de travail d'`aphrody` contient des fichiers amont non suivis (`obscura-browser/src/idle_deadline.rs`, `obscura-net/src/operator_hint.rs`, `crates/web/obscura-ssrf/`, nouveaux tests) et une soixantaine de fichiers modifiés sous `crates/web`. Une remise à niveau est en cours dans une autre session : état non commité, non audité ici.
- [F] La copie utilise reqwest 0.13.5 (dédoublonnage local), l'amont reqwest 0.12.

---

## 4. Issues et PR utiles au plan de fusion

[F] Recherche ciblée sur 1 182 issues et PR, titres et corps :

- **0 occurrence** de JavaScriptCore/JSC, QuickJS/rquickjs, Boa, « engine abstraction », « replace V8 », « no tokio » ou « runtime-agnostic » ;
- **0 occurrence** de `--remote-debugging-pipe` (le mot « pipe » n'apparaît qu'au sens générique) ;
- **0 occurrence** de roadmap ou milestone.

Il n'existe donc **aucune piste amont vers un moteur alternatif ni vers une abstraction du moteur** : tout ce qui suit est du travail propre à notre fusion.

### 4.1 Moteur JS, V8, snapshot

| # | Titre | État | Résumé | Impact sur le plan |
| --- | --- | --- | --- | --- |
| #1031 | upgrade: deno_core 0.412, V8 150.4 | fusionnée 09-19 | V8 maintenu sans vendoring. Contexte tokio global de secours pour les embarqueurs qui créent un runtime hors tokio. Binaire +7,32 % | [D] L'amont consolide V8 ; la divergence est définitive (choix n° 1 de la partie 1) |
| #445 | upgrade deno_core 0.411 / v8 150.4 (`cdylib`) | ouverte (dépassée) | V8 137 cassait le lien en `cdylib` sous Linux (TLS `initial-exec`) ; V8 ≥ 149 corrige. Liste les migrations d'API `deno_core` 0.408+ | [D] Montre qu'Obscura+V8 peut aller dans un `cdylib`. Pertinent seulement pour l'étape « V8 isolé hors processus » de l'ordre d'absorption §3 de la partie 4 |
| #1135 | getHeapUsage natif, collectGarbage | fusionnée 10-01 | Statistiques du tas V8 exposées en CDP | [D] Chantier B/D : équivalent JSC (taille du tas de la VM) ou stub listé dans `BROKEN.md` |
| #1161 → #1197 | use-after-free V8 au teardown (workers zombies) | fermée / fusionnée 10-04 | Panique dans un rappel faible V8 au drop d'isolate ; corrigée côté Obscura | [D] Classe de crash propre à V8 qui disparaît avec JSC. Garder `teardown_under_gc_stress` comme test de parité |
| #1162 → #1163 | `compileStreaming` abort | fusionnée 10-04 | Le callback de streaming wasm de deno_core n'était pas enregistré ; repli bufferisé dans `bootstrap.js` | [D] Avec JSC/Bun, le streaming wasm natif existe ; vérifier que le repli de `bootstrap.js` ne le masque pas |
| #19, #36, #430, #435, #756, #824, #872, #927 | multi-isolate | fermées / fusionnées | Isolates par page, thread OS + runtime `current_thread` + `LocalSet` par connexion CDP, verrou par connexion, construction d'isolate sérialisée par un verrou de processus | [F] **corrige la partie 1** (voir §6). [D] Modèle à reproduire : un Worker JSC par connexion ou par `Browser`, un global object par page |
| #574 | OOM de tas V8 : terminer au lieu d'aborter | ouverte | Plafond de 512 Mo et rappel `near-heap-limit` | [D] Chantier B : prévoir l'équivalent JSC (limite mémoire de la VM et terminaison) ou l'accepter comme abort |
| #858 | `set_v8_flags` tardif aborte | ouverte | `--v8-flags` | [D] Les drapeaux CLI `--v8-flags` n'ont pas de sens sous JSC : les retirer de `yolo browser` |
| #1142 | DOM spec mutations | ouverte | Mesure un snapshot de démarrage plus gros de 3,5 % (+2 ms par page) | [D] Ordre de grandeur utile : le coût de démarrage d'un realm est sensible à la taille de `bootstrap.js`. Sans snapshot sous JSC, le cache de bytecode devient prioritaire (B) |
| #621 | un realm par iframe | fusionnée | Realm = restauration de contexte depuis le snapshot | [D] Sous JSC, chaque iframe réévalue `bootstrap.js` (17 933 lignes) sauf cache de bytecode : à mesurer en J2 |
| #204 | adopter `deno_url`/`deno_web`/`deno_crypto` | fermée sans fusion | Le mainteneur a refusé les extensions Deno | [D] Confirme que les API Web de `bootstrap.js` sont faites maison. Les ~17 ops remplaçables par WebKit (partie 4 §3) restent une décision de fusion |

### 4.2 Pont JS ↔ Rust et performances

| # | Titre | État | Résumé | Impact |
| --- | --- | --- | --- | --- |
| #1155 / #1156 | mutations DOM lentes (3 à 9 µs par appel) | issue ouverte / PR brouillon | Le coût vient du pont et de `bootstrap.js`, pas du natif. La PR ajoute 3 ops composites (`append_child_x`…, `op_dom_nav` en appel rapide), renvoie des chaînes brutes au lieu de JSON, crée `style` à la demande. `createElement` passe de 148 à 45 ms pour 20 000 appels | [D] **Chantier B** : concevoir les fonctions hôtes du realm pour renvoyer nombres et chaînes brutes, et regrouper les mutations. Si #1156 fusionne, 3 ops de plus à porter |
| #1151 / #1152 | chargement sériel des sous-ressources | ouverte | reqwest sans `http2`. La PR active H2, chevauche le chargement des scripts et des feuilles de style (`JoinSet` de 16) et exécute les scripts à l'arrivée. HN 1 213 → 920 ms, react.dev 2 205 → 1 613 ms | [D] **A** : H2 déjà fourni par `aphrody-http`. **C** : reprendre l'ordonnancement chevauché sans tokio |
| #1153 / #1154 | allocations de la mise en page du texte | ouverte | Perf `obscura-render` | E |
| #1122 → #1111 | CPU inactif, rendu inchangé | fusionnée | Attentes inactives « parquées », caches bornés | [D] **C** : modèle d'attente sans polling, transposable sur la boucle d'événements de Bun |
| #783 | fuite RSS jusqu'à 2,3 Go en `serve` (v0.2.1) | ouverte | Long service, macOS | [D] Critère de fumigation du one shot 2 (daemon 24/7) |
| #1201 / #1203 | lot `fetch`/`scrape` : une tâche par URL | ouverte | Ordonnanceur borné | [D] `yolo crawl` (one shot 2) : ne pas reprendre le schéma `spawn` par URL |

### 4.3 Transport, stealth, SSRF

| # | Titre | État | Impact |
| --- | --- | --- | --- |
| #977 / #981 | le stealth n'utilise pas le client natif pour scripts classiques, POST de formulaires et preflights CORS | ouverte | [D] **A** : avec un seul trait `Transport`, ce bug disparaît par construction. À tester explicitement (les 3 chemins) |
| #990 | `--platform` (identité stealth Windows/macOS/Linux, défaut = OS hôte) | ouverte | [D] A : l'identité doit suivre l'OS hôte. `StealthPlatform` dans `BrowserContext` |
| #987 / #1003 | empreinte TCP/IP passive (SYN) dépendante de l'OS | ouverte | [F] Limite du noyau, hors portée d'Obscura. [D] S'applique telle quelle à la fusion : à documenter, pas à corriger |
| #571 / #572 | `setExtraHTTPHeaders` ignoré en stealth | ouverte | A |
| #769 | rustls sans suites CBC (TLS 1.2 ancien) | ouverte | [D] Disparaît avec BoringSSL de Bun (A) |
| #856 / #861 | `--allow-network <CIDR>` au lieu du tout-ou-rien | ouverte | [D] **A** : implémenter la SSRF de `aphrody-dns` avec une `NetworkPolicy` (liste d'autorisation CIDR) au-dessus de `is_forbidden_ip`, et reprendre `obscura-ssrf` (139 lignes, sans dépendance) tel quel comme définition unique |
| #852 / #868 | `198.18.0.0/15` bloquée : casse Clash fake-ip et la NAT WSL2 | ouverte | [D] Nous concerne directement (postes WSL2) : trancher entre retrait de la plage ou CIDR autorisé |
| #1056 | contrôle SSRF sauté si l'URL de `Continue` ne se parse pas | ouverte | [D] A/B : échec fermé dans le port |
| #857 / #862 | porte `file://` dans la primitive | ouverte | [D] A : la porte vit dans le transport, pas chez les appelants |
| #1038 / #1080 | le `WebSocket` de page est un stub (`open` sans connexion) ; la PR ajoute `tokio-tungstenite` et 5 ops | ouverte | [D] **A/B** : adosser le `WebSocket` de page au client WebSocket natif de Bun (gain net), en gardant SSRF et politique de contexte |
| #1157 / #1158 | RFC stockage persistant : localStorage disque, IndexedDB ACID via `redb`, CacheStorage ; 13 ops | ouverte | [D] Si elle fusionne : nouvelle dépendance `redb` et 13 ops. Côté `yolo`, préférer `bun:sqlite` (une pile SQLite) |

### 4.4 CDP, transport pipe, authentification, embarquement

- [F] **Transport CDP** : WebSocket sur TCP uniquement (`obscura-cdp/src/server.rs`). **Pas de pipe** (`--remote-debugging-pipe`), pas d'acceptation des drapeaux Chrome (`--remote-debugging-port`), et aucune issue ni PR n'en parle.
- [F] **Authentification** (`server.rs:58-162`, `356-362`, `docs/Environment-variables.md`) :
  - `OBSCURA_CDP_TOKEN` de 32 octets ou plus, présenté **uniquement** par l'en-tête `Authorization: Bearer` (pas de jeton en paramètre d'URL) ;
  - optionnel sur loopback, obligatoire si le bind est public ;
  - toute requête portant un en-tête **`Origin` est refusée (403)** ;
  - `Host` doit correspondre à l'adresse liée (`localhost` accepté sur loopback).
- [F] **Côté Bun** (`src/runtime/webview/ChromeBackend.cpp`, identique dans `oven-sh/bun` et `aphrody-labs/bun` `main`, 1 805 lignes) :
  - mode WebSocket ouvert par `WebCore::WebSocket::create(*ctx, wsUrl)` sans en-tête personnalisé (l. 459-500) ;
  - mode pipe en JSON délimité par NUL sur socketpair ou pipes, Chrome étant lancé par `ChromeProcess.rs` (l. 82-90, 316-330, 391, 419-443).
- [D] Le backend `"obscura"` de `Bun.WebView` sur loopback ne demande pas de jeton. Il échouera en 403 si le client WebSocket de Bun envoie `Origin` (**à vérifier**).
- [D] Pour le backend en processus (partie 3), le plus court est d'ajouter à `aphrody-cdp` un transport « NUL-delimited » sur paire de descripteurs et de réutiliser le mode Pipe existant de `ChromeBackend` en remplaçant le lancement de Chrome. Fonction nouvelle, sans équivalent amont.

| # | Titre | État | Impact |
| --- | --- | --- | --- |
| #543 / #570 | `Target.getTargets` vide pour une nouvelle connexion (registre de cibles par connexion) | ouverte | [D] D et fumigation 3 (`puppeteer.connect`) : `browser.pages()` vide. Utiliser `newPage()`. Le registre global est une fonction à décider |
| #634 | registre de cibles global, routage entre connexions, persistance des pages (Hermes) | ouverte, « Do not merge until review » | [D] D : modèle utile si `yolo browser serve` sert des agents qui ouvrent une connexion par appel |
| #102 | « Bun support » : Playwright `connectOverCDP` bloqué sous Bun | fermée (05-09) | Le mainteneur l'attribue au WebSocket de Bun. [F] #1093 montre Bun 1.4.0 + puppeteer-core 25.12 fonctionnant contre Obscura. [D] Ajouter Playwright-sur-`yolo` aux tests de D |
| #724 | les crates embarquées n'exposaient pas `stealth` | fermée | [F] Corrigé. [D] La surface embarquable reste tokio + git |
| #169, #247 | API Rust, `settle()` | fermées | [F] `Page::settle` exposé. [D] Sous Bun, la boucle tourne d'elle-même dans le Worker : `settle` devient une attente |
| #144 | crate MCP avec système de plugins | fermée sans fusion | [F] Aucun mode plugin/FFI amont |
| #982 | domaine CDP `Obscura.*` (téléchargements natifs, diagnostics de transport) | ouverte | [D] D : domaine non standard à ne reprendre que si consommé |
| #1127 | modes `waitUntil` par navigation dans le worker JSON | ouverte | [D] Options de `yolo browser fetch` |

### 4.5 Banc d'essai, WPT, compatibilité

- [F] **`h4ckf0r0day/obscura-benchmark`** (Apache-2.0, poussé le 2026-10-04) contient : `crates/wpt-runner`, `crates/triage`, `crates/perf-bench`, `obstacle-course/`, `compare/`, `realworld/`, `stealth-bench/`, `reliability/`.
  - Les harnais se pilotent par `OBSCURA_BIN` et la syntaxe CLI `obscura fetch` ; ils sont écrits en Python pour obstacle-course, compare, realworld et stealth.
  - Dernier passage complet le 2026-09-11 (`01e1caa3`) : WPT **Core 83,3 %** (327 094/392 547 sous-tests), Relevant 86,8 %, Full 67,6 %.
  - Parcours d'obstacles 33/33.
  - Fiabilité 1 432/1 500 pages rendues, 0 crash, 0 panique.
- [F] La CI amont épingle le parcours à `2d08d9a8` (`.github/workflows/ci.yml:171-179`), et la porte de release exige 33/33 (#1195).
- [F] Deux autres suites servent de contrôle :
  - `render-repros/` : 69 fixtures déterministes dans le dépôt principal ;
  - Grafana : sous-ensemble Playwright, 4/4 contre Chromium (#1103, issue de suivi ouverte).
- [D] Gate de parité du plugin (avant retrait de V8) : obstacle course 33/33 au pin `2d08d9a8`, WPT Core par rapport à 83,3 %, `render-repros` 69/69, 2 115 tests de rendu. Il faut un CLI `yolo browser fetch` **compatible avec la syntaxe `obscura fetch`** (`--dump`, `--eval`, `--wait`, `--screenshot`) ou un shim `obscura` pour rejouer le banc sans le modifier. Python passe par `uv` (règle d'Aphrody).
- [F] Discussion #988 : le banc de peterbe affiche Obscura `fetch --dump original` 2,49× plus rapide qu'un script `Bun.WebView`, avec un RSS de 10 Mo contre 17 Mo.
- [D] Valeur faible : `--dump original` n'exécute pas de JS.

---

## 5. Roadmap déclarée

- [F] Aucun `ROADMAP`, aucun milestone, aucune issue épinglée de roadmap, et aucun « Roadmap » dans le README ni dans `docs/`.
- [F] Le wiki (20 pages miroir de `docs/`) a été modifié pour la dernière fois le 2026-06-06 et ne contient pas de roadmap.
- [F] Le site `obscura.sh` n'annonce pas de roadmap (« Book a demo »).
- [F] Discussions épinglées :
  - #110 « Obscura Cloud waitlist is open » (2026-05-04) : *« The open-source engine stays Apache-2.0, fully featured. No feature gating, ever. »* ;
  - #281 : retours demandés sur le tableau de bord Cloud (2026-06-09).
- [F] Roadmap implicite :
  - « Current limitations » de v0.2.4 : IndexedDB (#1093), sessions de worker non restaurées, corps bufferisés sans streaming, service workers, média ;
  - RFC #1157 (stockage persistant) ;
  - issue de suivi #1103 (compatibilité Playwright) ;
  - PR de performance ouvertes #1152, #1154, #1156.
- [D] Prochaine release probable vers le **2026-10-18** (cadence de 14 jours). Rythme d'environ 100 commits par semaine, concentrés sur `obscura-js` et `obscura-render`.

---

## 6. Ce que ça change pour le plan de fusion

### 6.1 Corrections factuelles des parties 1 à 4

1. [F] La base d'import doit être **`92de223` = v0.2.4 (`1fccab2`) + `43ae887`**, et non `0cdd42e`. La remise à niveau des 107 commits de la partie 4 §7 est **faite localement**, mais :
   - `origin/yolo` est encore à `43ae887` ;
   - `92de223` n'existe à distance que sous `sync/upstream-2026-10-05` ;
   - `origin/main` est resté à `0cdd42e`.

   Il reste à pousser `yolo` (avance rapide) et à avancer `main` sur `1fccab2` avant J0. La checklist §9 de la partie 4 (« Obscura : remise à niveau du fork ») peut passer à moitié cochée.
2. [F] Chiffres à mettre à jour dans la partie 1 (« État des lieux : Obscura ») et dans le budget de B :

   | Mesure | Valeur du plan | Valeur à `1fccab2` | Note |
   | --- | ---: | ---: | --- |
   | `bootstrap.js` (lignes) | 16 918 | **17 933** | +6 % |
   | Ops | 70 | **73** | méthode de cet audit |
   | `v8::` | 164 | **183** occurrences | méthode de cet audit |
   | `tokio::` | — | **1 035** occurrences | +18 % depuis la base |
   | `catch_unwind` | — | **15** | contre 10 |

3. [F] **« Un seul isolate V8 par processus » et « `tokio::sync::Mutex` global `v8_lock` » sont faux depuis juillet**. Pourtant `docs/Architecture-overview.md` amont l'affirme encore.
   - `v8_lock.rs` a été supprimé le 2026-07-20 (`9065f38`).
   - Le modèle actuel est :
     - un isolate par `Page` ;
     - un thread OS par connexion CDP, avec runtime tokio `current_thread`, `LocalSet` et thread d'E/S séparé (`server.rs:789-855`) ;
     - un verrou par connexion (`dispatch.rs`) ;
     - un verrou de processus sur la construction des isolates (`runtime.rs:48`) ;
     - des pages concurrentes vivantes sur une même connexion (#927).

   La partie 1 (point « Un seul isolate V8 par processus ») est à amender.
4. [F] Les vendors `taffy` **et `cosmic-text`** restent patchés en amont (`[patch.crates-io]`, modifiés encore dans l'intervalle). La note de la copie (« cosmic-text now resolves from crates.io ») ne vaut que pour la copie `aphrody`. Le chantier E doit garder les deux vendors s'il importe depuis le fork.

### 6.2 J0 (orchestrateur)

- [D] Importer depuis `92de223` et extraire dans `patches/obscura/` deux séries : `43ae887`, et les ~19 commits locaux de la copie `aphrody`, en attendant la fin de la remise à niveau en cours de la copie (§3.4).
- [D] Les seules dépendances nouvelles depuis la base sont des dev-deps. La liste des interdits de la partie 2 (tokio, reqwest, wreq, tungstenite, `deno_core`, v8) ne change pas.
- [D] Licence : Apache-2.0 sans restriction de fonctions (#110). La checklist `LICENSES/obscura-APACHE-2.0` reste la seule obligation.
- [D] Politique de suivi après la divergence :
  - les correctifs amont de `bootstrap.js`, `obscura-dom`, `obscura-render`, `obscura-ssrf` et de la logique de `obscura-net` restent **portables par cherry-pick**, tant que la façade `Deno.core.ops` garde noms et signatures ;
  - les correctifs de `runtime.rs`, `frame.rs` et de la partie V8 de `ops.rs` deviennent un travail de portage manuel.

  À écrire dans `docs/decisions/` dès J0, avec une veille sur les PR ouvertes #1156, #1158, #1080 et #861, qui ajoutent des ops ou touchent la SSRF.

### 6.3 Chantier A : transport

- [D] Comportements nouveaux à reproduire et à tester sur `aphrody-http` :
  - `fetch` résolu aux en-têtes, corps borné (#1146) ;
  - annulation `AbortSignal` jusqu'au socket (#1193) ;
  - en-têtes HTTP/1 repliés acceptés (#1160) : **vérifier le parseur de réponse de Bun** ;
  - `Origin` sur les requêtes non-GET de même origine (#1081) ;
  - destinations des ressources dynamiques (#1181).
- [D] SSRF dans `aphrody-dns` :
  - reprendre `obscura-ssrf` comme source unique ;
  - ajouter une `NetworkPolicy` CIDR (#861) ;
  - trancher `198.18.0.0/15` (#852/#868, impact WSL2) ;
  - échec fermé sur URL de réécriture invalide (#1056) ;
  - porte `file://` dans la primitive (#862) ;
  - garder notre politique stricte de `43ae887` (ignorer l'environnement, HTTP(S) seulement, pas de proxy hérité) comme **défaut du plugin**, avec un message d'aide adapté (pas de renvoi à `OBSCURA_ALLOW_PRIVATE_NETWORK`).
- [D] Un seul transport règle par construction #977/#981 (scripts classiques, POST de formulaire et preflight hors client stealth) et #769 (CBC via BoringSSL). Les écrire comme tests.
- [D] Stealth : prévoir `StealthPlatform` = OS hôte (#990). Documenter l'empreinte SYN comme limite (#987/#1003).
- [D] `WebSocket` de page : l'amont n'a qu'un stub (#1038). Le brancher sur le client WebSocket natif de Bun derrière la politique SSRF est un gain de la fusion. À placer après la fumigation (réserve).

### 6.4 Chantier B : runtime de page sur JSC

- [F] Aucun appui amont : V8 renforcé (#1031, #1135, #1197), aucune abstraction de moteur. [D] Le budget de 60 € reste le chemin critique ; le périmètre a grossi d'environ 7 % (ops et `v8::`) et de 6 % pour `bootstrap.js`.
- [D] Contrat de parité minimal, à reprendre tel quel de l'amont comme tests `legacy-tests` à réactiver en priorité :
  - `multi_isolate_teardown` et `concurrent_isolate_teardown` (#824) ;
  - `teardown_under_gc_stress` (#1197) ;
  - `test_wasm_*` (#1163) ;
  - `fetch_abort*` (#1193) ;
  - `concurrent_page_isolation` (#927).
- [D] Conception des fonctions hôtes : suivre les mesures de #1155/#1156, c'est-à-dire des retours scalaires et des chaînes brutes plutôt que JSON, et des mutations composites. Le surcoût du pont domine le coût natif d'un facteur 3 à 9.
- [D] Snapshot : pas de snapshot sous JSC, donc évaluation de `bootstrap.js` (17 933 lignes) **à chaque realm, iframes comprises** (#621). Le cache de bytecode (`CachedBytecode.rs`) passe de « si budget » à « mesurer en J2, puis premier item post-one shot ». À mesurer : coût de création d'un realm et de l'évaluation de `bootstrap.js` sous JSC, comparés au chiffre amont de #1142 (+2 ms pour +3,5 % de snapshot).
- [D] Points V8 à stubber explicitement :
  - `Runtime.getHeapUsage` / `HeapProfiler.collectGarbage` (#1135) ;
  - `--v8-flags` (#858) ;
  - garde OOM (#574, absente de l'amont, donc pas une régression) ;
  - marque `v8::Private` de `AbortSignal` (#1193), à remplacer par un symbole privé ou un `WeakMap` côté hôte.
- [D] Wasm : sous JSC, le streaming natif existe. Revoir le repli bufferisé que `bootstrap.js` impose depuis #1163.

### 6.5 Chantier C : navigation sans tokio

- [F] L'amont s'enfonce dans tokio (+155 occurrences depuis la base). `idle_deadline.rs` est nouveau (`timeout_at` + FFI macOS). [D] Le portage synchrone sur un Worker est plus gros que prévu dans `obscura-browser` (+73 occurrences).
- [D] Modèle de threads cible confirmé par l'amont : un fil d'exécution par connexion ou `Browser` et des isolats par page. Il correspond au « thread Worker par `Browser` » du plan. Prévoir aussi plusieurs pages vivantes par Worker (#872/#927).
- [D] Ordonnancement à reprendre en conception, pas en code :
  - attente inactive « parquée » (#1111) ;
  - chargement chevauché des scripts et feuilles de style (#1152, ouverte) ;
  - lots bornés (#1203, ouverte).

### 6.6 Chantier D : surfaces

- [D] Le backend `"obscura"` de `Bun.WebView` est atteignable :
  - **hors processus** : WebSocket loopback sans jeton. Vérifier que Bun n'envoie pas d'`Origin`, sinon c'est un 403 (`control_refusal`) ;
  - **en processus** : ajouter à `aphrody-cdp` un transport NUL-délimité et réutiliser le mode Pipe de `ChromeBackend`.

  Ni l'un ni l'autre n'existe en amont : aucune issue sur `--remote-debugging-pipe`. Le trou « Bun n'envoie pas `Authorization` » de la partie 4 §3 n'est bloquant que hors loopback.
- [D] Fumigation 3 (`puppeteer.connect` sur `yolo browser serve`) : `Target.getTargets` est vide pour une nouvelle connexion (#543/#570, ouvertes). Écrire le test avec `browser.newPage()` et non `browser.pages()[0]`. Ajouter un cas Playwright `connectOverCDP` exécuté sous `yolo` (#102).
- [D] CLI : garder la syntaxe `obscura fetch` (`--dump {text,html,links,original,assets,cookies}`, `--eval`, `--wait`, `--screenshot`, `--stealth`, `--allow-private-network`) sous `yolo browser fetch`. C'est ce qui permet de rejouer `obscura-benchmark` sans le modifier.
- [D] Retirer `--v8-flags`. `serve --workers` (récolte et relance, #1198) n'a pas d'équivalent nécessaire dans un plugin mono-processus.

### 6.7 Chantier E : DOM et rendu

- [D] `obscura-render` a pris environ 3 000 lignes depuis la base (`paint.rs`, `dom.rs`, `inline.rs`) et les vendors `taffy`/`cosmic-text` ont encore bougé : réimporter depuis `92de223`, pas depuis la copie `aphrody`.
- [D] Ajouter en `cargo deny` les avis RUSTSEC-2026-0206 (rustybuzz 0.20.1) et RUSTSEC-2026-0192 (ttf-parser), marqués « non maintenus » et toujours requis (#1040).
- [D] Gate : `render-repros` 69/69 et suite de rendu.

### 6.8 J2, fumigation et one shots suivants

- [D] « Livré » reste la fumigation en cinq points. Les **critères de parité avant retrait de V8** (ordre §3 de la partie 4, étape 6) sont désormais chiffrables :
  - obstacle course 33/33 (pin `2d08d9a8`) ;
  - WPT Core ≥ 83,3 % (référence du 2026-09-11) ;
  - `render-repros` 69/69 ;
  - suites amont 2 115 render / 1 123 no-render ;
  - fiabilité 0 crash sur 1 500 pages.
- [D] One shot 2 (daemon de crawl) : intégrer #783 (fuite RSS en service long) et #1201 (ordonnancement borné) aux critères « 1 h de crawl, 0 perte ».
- [D] One shot 2 bis (nettoyage d'`aphrody`) : la remise à niveau de la copie, en cours dans l'arbre de travail (§3.4), devient sans objet si `plugin-obscura` passe la fumigation. Ne pas y investir au-delà de ce qui sert la transition (features `native-browser`/`render`).

---

## 7. Sources

Toutes consultées le 2026-10-05.

**Dépôt amont et releases**

- Dépôt amont (métadonnées, branches, milestones vides) : https://github.com/h4ckf0r0day/obscura
- Releases et tags : https://github.com/h4ckf0r0day/obscura/releases
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.4
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.3
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.2
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.1
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.0
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.1.11
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.1.9
  - https://github.com/h4ckf0r0day/obscura/releases/tag/v0.1.7
- Comparaison base → tête : https://github.com/h4ckf0r0day/obscura/compare/0cdd42e...1fccab2

**Fichiers amont à `1fccab2`**

- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/Cargo.toml
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/AGENTS.md
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/docs/Architecture-overview.md
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/docs/Use-as-a-Rust-library.md
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/docs/Environment-variables.md
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/crates/obscura-cdp/src/server.rs
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/crates/obscura-browser/src/idle_deadline.rs
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/crates/obscura-net/src/operator_hint.rs
- https://github.com/h4ckf0r0day/obscura/blob/1fccab2c1/.github/workflows/ci.yml
- Suppression de `v8_lock.rs` : https://github.com/h4ckf0r0day/obscura/commit/9065f38

**Issues et PR citées** (forme `https://github.com/h4ckf0r0day/obscura/issues/<n>` ou `/pull/<n>`)

18, 19, 36, 102, 144, 169, 204, 247, 430, 435, 445, 543, 570, 571, 572, 574, 621, 634, 724, 756, 769, 776, 783, 824, 852, 856, 857, 858, 861, 862, 868, 872, 927, 977, 981, 982, 987, 990, 1003, 1030, 1031, 1038, 1040, 1048, 1056, 1080, 1093, 1103, 1111, 1122, 1127, 1135, 1142, 1146, 1151, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1161, 1162, 1163, 1193, 1195, 1197, 1198, 1201, 1203.

**Discussions, wiki et site**

- https://github.com/h4ckf0r0day/obscura/discussions/110
- https://github.com/h4ckf0r0day/obscura/discussions/281
- https://github.com/h4ckf0r0day/obscura/discussions/575
- https://github.com/h4ckf0r0day/obscura/discussions/988
- https://github.com/h4ckf0r0day/obscura/discussions/115
- Wiki : https://github.com/h4ckf0r0day/obscura/wiki
- Site : https://obscura.sh

**Bancs d'essai**

- https://github.com/h4ckf0r0day/obscura-benchmark (README, commits, PR #3, #7, #8)
- https://github.com/peterbe/html-scraper-competition

**Forks et Bun**

- Fork : https://github.com/aphrody-labs/obscura (branches `main`, `yolo`, `sync/upstream-2026-10-05`)
- Clone local `scratchpad/obscura/fork` : commits `43ae887`, `92de223`
- `Bun.WebView`, backend Chrome :
  - https://github.com/aphrody-labs/bun/blob/main/src/runtime/webview/ChromeBackend.cpp
  - https://github.com/oven-sh/bun/blob/main/src/runtime/webview/ChromeBackend.cpp

**Articles secondaires** (non utilisés pour des faits)

- https://jacar.es/en/obscura-rust-headless-browser-ai-agents/
- https://agentpedia.codes/blog/obscura-headless-browser-guide

**Fichiers locaux**

- `docs/reference/web/crates/aphrody-obscura/OBSCURA-UPSTREAM.txt`
- `git status` d'`aphrody` (lecture seule)
- Plan `docs/plans/fusion/drive/PLAN-FUSION-APHRODY (1 de 3).md`, `(2 de 3).md`, `(3 de 3).md`, `(4 de 4).md`
