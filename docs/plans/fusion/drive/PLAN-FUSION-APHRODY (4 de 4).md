# Plan de fusion Obscura × Bun — partie 4 de 4 : audits et contexte vérifiés

Oct 5, 2026 (soir) · @aphrody-dev

> Cette partie complète les parties 1 à 3 avec les audits faits le 5 octobre après leur rédaction. Elle ne change pas la « Décision finale » de la partie 1 : elle corrige les faits qui ont bougé, mesure ce qui ne l'était pas et liste les décisions qu'il reste à prendre avant de lancer le one shot 1. Chaque correction indique la section qu'elle amende. Méthode : lecture des dépôts et des manifests, `cargo metadata --no-deps --offline`, API GitHub en lecture, builds réels sur le VPS (`bun-forge`, `vps-cargo`) ; aucune compilation dans WSL.

## 1. État réel au soir du 5 octobre

| Sujet | Ce que disent les parties 1-3 | Fait vérifié | Effet sur le plan |
| --- | --- | --- | --- |
| Branche source du fork Bun | branche `yolo` du fork `aphrody-labs/bun`, commit `954db0c` | Une seule branche de travail Aphrody, **`main`** (branche par défaut sur GitHub) ; le fork garde en plus des centaines de branches héritées d'`oven-sh/bun` (~800 selon l'API) et la branche prototype `aphrody` (`ef75653d0`), sans lien avec le pin. `main` = amont `oven-sh/bun` `9bd19c98e` + 6 commits Aphrody, tête **`c439b6fbd`** ; `yolo` a été avancée dans `main` puis supprimée. Synchro amont : fusion `upstream/main` → `main` (moteur `scripts/tools/vendor/bun_upstream_sync.ts`, jamais de push forcé) | J0 : « pousser `main` du fork (`c439b6fbd` ou le pin qualifié suivant) comme `main` du dépôt `yolo` » au lieu de « la branche `yolo` » (parties 1, 2, prompt) |
| Qualification du fork | « un build debug vert du fork, branche `yolo` » (checklist) | **Fait** : `bun-forge` a construit `c439b6fbd` en release LTO sur le VPS (12 vCPU, 46 Gio) en **902,8 s** de build (15 min 17 s au total), binaire `bun` **80,9 Mo**, `--version` 1.4.3, fumigation du forge verte (reçu `aphrody.bun-forge/1`, sha256 `0358a371…`). Les deux builds précédents (`8b5badd2`, `954db0c0`) avaient échoué | Base mesurée pour `just bench` (taille) ; le temps de build sert de référence au budget de J2 |
| glibc du binaire | non traité | Le VPS est en Ubuntu 26.04 (glibc 2.43), WSL en 24.04 (glibc 2.39). Le `bun` du forge importe `acosf`, `asinf`, `atan2f` en `GLIBC_2.43` : **il ne démarre pas dans WSL**. Même cause et même correctif que pour `aphrody` (commit `a8f0f4211` : définitions `libm` dans l'exécutable, glibc max 2.39, binaire installé et vérifié) | Ajouter au J0 une base glibc de distribution (correctif de symboles ou sysroot), sinon le runtime `~/.yolo` ne s'installe pas sur les postes 24.04 |
| Nom `aphrody-labs/yolo` | « archiver l'actuel `yolo` en `yolo-legacy` » | Le dépôt existe (privé, non archivé, 15,8 Mo, poussé le 5 à 02:20). Il contient encore : 220 commits d'historique jamais fusionnés dans le monorepo, le tag `v0.1.0`, `ci.yml`/`runtime.yml` (matrice 5 cibles), 10 pointeurs de sous-modules, la révision `27403350` lue par `py/config/sibling-checkouts.json:4`. 3 912 de ses 3 977 fichiers sont dans le monorepo | Archiver + renommer, jamais supprimer. **Piège GitHub** : après renommage en `yolo-legacy`, créer un nouveau `yolo` casse la redirection ; toutes les références à l'ancien `yolo` pointeront silencieusement vers le nouveau dépôt (`distribution.ts:18` / `yolo upgrade`, scripts d'installation, générateur de plugins, `sibling-checkouts` qui casse faute de la révision). À repointer **avant** J0 |
| Fork Obscura | `aphrody-labs/obscura` commit `0cdd42e`, « aucune modification propre », 62 fichiers derrière | Le fork a une branche **`yolo`** propre (1 commit du 4 octobre : « strict context SSRF and private-network policy isolation »), **107 commits** derrière `h4ckf0r0day/obscura:main`. La copie du monorepo vient de l'amont `1a3169da` avec ~19 commits locaux ; `OBSCURA-UPSTREAM.txt` est périmé (dit « unmodified » et `publish = false`, faux) | Le `merge --ff-only` du J0 vaut pour `main` du fork, pas pour `yolo` (fusion requise) ; les hunks Aphrody à extraire dans `patches/obscura/` viennent de **deux** sources : le commit SSRF du fork et les ~19 commits de la copie |
| Taille d'Obscura | 10 crates, ~172 000 lignes | Copie du monorepo : **8 crates** (`obscura`, `-browser`, `-cdp`, `-dom`, `-js`, `-mcp`, `-net`, `-render`), **67 246 lignes de prod + 58 416 de tests**, 1 727 tests Rust, `bootstrap.js` 16 332 lignes (51 classes DOM). Le chiffre de 172 000 compte l'amont complet (CLI, ssrf, tests) | Les budgets de B et E restent valables ; la suite de parité existe déjà (voir §3) |
| V8 dans `aphrody` | « aucune autre crate ne dépend de `v8` (à confirmer par `cargo tree -i v8`) » | **Infirmé** : V8 entre par `obscura-js` (`deno_core 0.412` → `deno_v8` → `v8 150.4.0`) et il est déjà chargé dans les processus Bun d'aujourd'hui : `libaphrody_ffi` → `aphrody-command` → `aphrody-mcp` (feature par défaut `native-browser`) et `aphrody-web-engine` (défaut `render`) → V8 | Le one shot 2 bis doit couper ces deux features par défaut (ou basculer sur `yolo:browser`) avant de supprimer `crates/web/obscura-*` |
| Tauri dans `aphrody` | « 55 crates, 219 000 lignes copiées » | 56 répertoires / 55 membres Cargo, ~220 k lignes Rust + 20 k TS + 2,9 k JS + 13,3 k Kotlin/Swift. Import **reproductible** par `yolo import` (`vendor.toml`, `vendor.lock`) depuis les branches `yolo` des forks : tauri `890a4e24`, plugins-workspace `a50a1b7b`, wry `cab3eace`, tao `d19f4c12`, create-tauri-app `c7692bb0` — **identiques aux têtes `yolo` actuelles des forks**. Patches locaux quasi nuls : renommage `aphrody-*`, scope npm `@aphrody`, patch du plugin dialog, préfixe ACL ; aucun patch fonctionnel sur wry ni tao | Passer aux pins git ne perd rien : les seuls patches vivent déjà dans les forks (commits « switch workspace scripts to native Bun », « rename npm scope », « patch wry and tao with Aphrody forks »), sauf le patch dialog et le préfixe ACL à pousser dans `plugins-workspace` |
| Dérive des forks Tauri (5 octobre soir) | non mesurée | tauri `yolo` = amont `v3` + 4 commits, **0 de retard** ; plugins-workspace `yolo` = `v3` + 3 commits, 0 de retard ; wry `yolo` identique à `dev` ; create-tauri-app `yolo` = `dev` + 9 commits, 0 de retard ; **tao `yolo` 2 commits derrière `dev`** (seule dérive) | Bump à faire : tao (avance rapide + réimport) ; Obscura (107 commits). Le reste est à jour |
| Surface unique d'`aphrody` | décrite comme cible | Faite le 5 octobre : un seul CLI Rust `aphrody` multi-call (anciens binaires = liens), un seul MCP (`aphrody kernel mcp`, qui attache `yolo mcp` et le serveur m3 : 317 outils vérifiés), un seul cdylib C-ABI `aphrody_ffi`, une seule app desktop `aphrody-app` (absorbe `yolo-desktop`, `m3-showcase`, `tauri-e2e`), un seul CLI Bun `yolo` (absorbe `ops`, `workspace`, `update`, `google`, `doc-ai`, `browser`, `forge`, outils m3). Toutes les branches fusionnées sur `main` (monorepo, fork Bun, dépôts plugins) | La table « Ce qui va où » reste juste ; le nettoyage 2 bis part d'une base déjà dédoublonnée |

## 2. Mécanismes d'extension du fork Bun (préalable au chargeur de plugins et aux modules `yolo:*`)

Constats sur `main` (`c439b6fbd`), preuves dans le rapport d'audit `prep-bun-mechanisms.md`.

1. **Module intégré** : un module `bun:*` se déclare à trois endroits de `src/resolve_builtins/HardcodedModule.rs` (enum, table, alias), son JS dans `src/js/bun/*.ts` (id attribué par le codegen dans l'ordre A-Z, source embarquée, chargée au premier `require` ; pas de snapshot de tas). Le pont vers Rust passe par `$rust`/`$newRustFunction` avec une entrée dans `rustIdentifierPaths` (`src/codegen/generate-js2native.ts:46`) ; les classes par `*.classes.ts` + `#[bun_jsc::JsClass]`. Les modules natifs « directs » (`NativeModuleList.h`) n'existent qu'en C++.
2. **Coût du préfixe** : `bun:yolo/<nom>` ne demande qu'un fichier `src/js/bun/yolo/<nom>.ts` et réutilise tout le traitement du préfixe `bun:`. Un vrai préfixe `yolo:` touche le scanner, `bundle-modules.ts` et une dizaine de tests de préfixe. **Décision à prendre** : `yolo:*` natif (coût J0 à ajouter) ou `bun:yolo/*` + alias résolveur.
3. **Plugins chargés sans recompiler** : addon N-API `.node` (ABI stable, objets JS) ou bibliothèque Rust par `bun:ffi` `dlopen` (appels simples, plus rapide). Aucun des deux n'accède directement à JSC. `Bun.plugin().module()` avec `loader: "object"` publie un addon sous un nom de module : c'est le mécanisme du chargeur « modules `yolo:*` virtuels résolus vers un plugin » (partie 1). `onBeforeParse` ne sert qu'au bundler ; `cc` compile du C, pas du Rust.
4. **Prototype existant** : la branche distante `aphrody` du fork (commits `94a34b49d4` à `0ba45879b`, 14 tests verts le 30 septembre) implémente `bun:aphrody`, qui charge une bibliothèque Rust par `bun:ffi` et vérifie sa version d'ABI. C'est la base la plus courte du chargeur de plugins (manifeste + ABI `v1`) ; à reprendre en J0 au lieu de repartir de zéro.
5. **Workspace Cargo du fork** : 100 crates, `nightly-2026-09-15`, `--locked`. Son `Cargo.lock` ne contient **ni tokio, ni hyper, ni rustls, ni html5ever** (Bun a sa boucle, son client HTTP, BoringSSL). Lier une crate du monorepo par chemin ne marche que localement : `bun-forge` construit une copie fraîche du seul dépôt du fork, et `/vendor` y est ignoré par git. Voies propres : le patron `scripts/build/deps/lolhtml.ts` (archive GitHub épinglée, impose de toucher `scripts/build/bun.ts:183`), un dépôt dédié par crate importée, ou crates.io. Doublons attendus à l'import d'Obscura : selectors 0.33/0.38, cssparser 0.36/0.37, rustix 0.38/1.x, une seconde pile TLS, une seconde BoringSSL si la feature `stealth` de `wreq` est gardée.
6. **Coût de lien** : en release, tout le Rust passe par la LTO au lien final ; chaque crate ajoutée au binaire allonge ce lien (902,8 s mesurées pour le noyau seul). Argument de plus pour Obscura en plugin plutôt que dans le noyau.
7. **Les 6 commits Aphrody du fork** : `Bun.tauri` typé (`packages/bun-types/tauri.d.ts`) **sans implémentation** (`undefined` à l'exécution) ; renommage npm `@aphrody/*` ; `native-link.ts` (bibliothèques natives des crates au lien final, Linux seulement) ; modules absorbés (picocolors, tiny-invariant, dotenv, uuid) — le patron oublie `isBuiltinModule.cpp` et les déclarations de types ; synchro de `bun.lock` ; fusion amont. Aucun ne fournit de patron de module natif : voir le point 4.
8. **Identité `bun` à garder / `yolo` possible** : doivent rester `bun` le global `Bun`, les spécifiers `bun:*`, l'User-Agent `Bun/<version>` et `npm_config_user_agent`, les variables `BUN_*`, `bunfig.toml`, `bun.lock`, la version semver amont. Peuvent porter `yolo` : le nom du dépôt, le nom de fichier du binaire (rien ne vérifie qu'il s'appelle `bun`), les espaces de modules, les artefacts. **À rediriger sinon le fork s'écrase lui-même** : `bun upgrade` (télécharge la release officielle), `--compile` vers une autre plateforme (télécharge `@oven/bun-*` officiel), rapports de crash vers `bun.report`.

## 3. Obscura : inventaire et absorption (amende « État des lieux : Obscura » et le chantier B)

- **Consommateurs actuels dans `aphrody`** : 10 crates directes, `agent-browser` (client CDP TypeScript de 291 lignes), `web-test`, le SDK runtime (`yolo_browser_*`), `@aphrody/bun` (56 symboles `aphrody_web_*`), `yolo browser`, 37 outils MCP `browser_*`, un module Python. Tous doivent basculer sur `yolo:browser`/`yolo browser` pendant 2 bis.
- **Pont JS ↔ moteur** : le DOM ne parle au moteur que par une op texte → texte (`op_dom`, 71 commandes) et `Deno.core.ops` : confirme la faisabilité du port en façade `Deno.core` (chantier B). Environ 17 des 59 ops sont remplaçables par les API Web déjà fournies par JSC/WebKit (WebCrypto, URL, encodage, timers).
- **V8 sert à quatre choses** : snapshot de `bootstrap.js` (`build.rs`), un realm par iframe (`frame.rs:1-20`), l'interruption des commandes CDP (`cdp_watchdog.rs`), l'empreinte Chrome du mode stealth. Les trois premières ont un équivalent JSC (évaluation au démarrage du realm, global object par frame, watchdog JSC) ; la quatrième est la régression assumée de la partie 3.
- **`Bun.WebView` ↔ `obscura-cdp`** : les 21 méthodes CDP qu'envoie `Bun.WebView` existent toutes dans `obscura-cdp` (comparaison de sources, pas encore exécutée). Le backend `"obscura"` de la partie 3 est donc atteignable **hors processus et sans V8 côté Bun** avant même le port JSC, avec deux trous : Obscura n'a pas de transport pipe (`--remote-debugging-pipe`), et Bun n'envoie pas d'en-tête `Authorization` en WebSocket (`ChromeBackend.cpp:482`).
- **Suite de parité déjà écrite** : ~408 tests de `runtime.rs` et 88 tests `obscura-cdp` ne dépendent pas du moteur ; les 119 tests `Bun.WebView` du fork se rejouent contre Obscura avec un adaptateur d'URL. Il n'existe aucun harnais WPT dans le dépôt (il est dans `obscura-benchmark`). À brancher sous `legacy-tests` dès J0 plutôt qu'après le one shot.
- **Ordre d'absorption qui garde un état vert à chaque étape** (complément au découpage A-E, utile si le budget de B déborde) : 1) `yolo:dom` sans JS de page ; 2) `yolo:render` sur DOM statique ; 3) backend `Bun.WebView` → Obscura hors processus (V8 isolé dans son processus) ; 4) abstraction moteur dans `obscura-js`, V8 seule implémentation ; 5) implémentation JSC dans un realm sans API Bun ; 6) retrait de V8 après parité, stealth en dernier.
- **Provenance à corriger avant import** : Obscura et le fork privé `aphrody-labs/taffy` (dépôt SSH, non-fork) sont absents de `config/upstream-sources.json` et de `THIRD-PARTY.md` ; polices Liberation et DejaVu sans provenance (15 Mo embarqués). `LICENSES/obscura-APACHE-2.0` reste à faire (checklist).
- **Risques chiffrés** : graphe de dépendances jusqu'à ~600 paquets contre 282 pour Bun ; deux piles TLS ; tokio absent du fork ; V8 et JSC dans le même processus si le pont V8 est gardé, même temporairement. Le crate `v8x` (déjà dans le `Cargo.lock` d'`aphrody`) réimplémente l'API rusty_v8 sur JSC/QuickJS, backend JSC macOS seulement : modèle de correspondance V8 → JSC pour B, pas solution prête.
- **Directive V8** : `AGENTS.md:19` renvoie à la directive « V8 conservé jusqu'à la parité », qui n'existe plus que dans l'historique de `PLAN.md` (`adec4dd67`, lignes 40-45). L'amendement B de `GOAL-FUSION.md` doit remplacer explicitement les deux.

## 4. Tauri : inventaire et passage aux pins (amende « Ce qui va où », one shots 2 bis et 3)

- **Usage réel** : `aphrody-app` utilise 61 commandes Tauri, 15 plugins, 5 fenêtres, le tray, `Channel` et le protocole `yolo.desktop/1` ; l'UI m3 (`app-ui`) passe par `@aphrody/api` et `__TAURI__` ; `aphrody-labs/shenron` dépend du fork par git (`df3ff0dd`). Aucun script n'appelle `cargo tauri`, `tauri bundle` ou `tauri-driver` ; la CI ne construit pas Tauri.
- **Sans consommateur aujourd'hui** : 15 plugins (~20 k lignes), `runtime-cef` (20,5 k), `create-tauri-app`, `restart`, les exemples, l'outillage CLI/bundler (~40 k). Ils peuvent sortir d'`aphrody` dès 2 bis ; `@aphrody/plugin-tauri` les reprendra par pins au one shot 3.
- **`Bun.WebView` n'est pas une fenêtre** (headless) ; `bun build --compile` n'a ni cible Android/iOS ni installateurs (deb, MSI, DMG) : le bundler Tauri reste nécessaire pour `yolo crawl app`.
- **Hôte de fenêtres** : `yolo:window` = hôte tao+wry en sous-processus, comme l'hôte WKWebView de Bun (`HostProcess.rs:1-12`) ; le protocole `yolo.desktop/1` d'`aphrody-app --runtime-host` en est une première version déjà en service. Confirme la décision « le process hôte existant reste le modèle » de la partie 3.
- **Ordre proposé pour Tauri** : 0) nettoyage des crates sans consommateur ; 1) façade sur `yolo.desktop/1` ; 2) hôte natif ; 3) m3 ; 4) `aphrody-app` ; 5) shenron.
- **Défauts trouvés à corriger au passage** : chemins morts dans `scripts/build/desktop/artifact.ts:57-61` et `crates/tauri/aphrody-tauri-examples/Cargo.toml:39-75` ; `config/tauri-apps.json:57` cite `aphrody-model-view` (supprimé) ; `config/tauri-upstream.json:21` annonce un pin crates.io alors que le dépôt consomme les forks par chemin ; `vendor.lock` garde des chemins `crates/vendor/*` périmés ; `scripts/tools/vendor/packages_upstream_sync.ts` est mort et `bun_upstream_tracker.ts` visait la branche `yolo` supprimée (corrigé : cible `main`) du fork Bun ; Tauri absent de `config/upstream-sources.json` (règle de provenance du `CLAUDE.md`).

## 5. Collisions du nom `yolo` (décision à prendre avant J0)

Le nom porte aujourd'hui dix sens dans `aphrody` : le CLI Bun `yolo` (`apps/yolo/cli`, qui vient d'absorber `ops`, `workspace`, `update`, `forge`, `m3`…), les crates `yolo-core`, `yolo-runtime`, `yolo-pyo3`, les paquets `@aphrody/yolo-*`, le SDK runtime, `apps/yolo/*`, `yolo.just`, le plugin Claude `yolo`, l'ancien dépôt `aphrody-labs/yolo`, et le runtime `~/.yolo`. Si le binaire du runtime devient `yolo`, ses sous-commandes `create`, `update`, `upgrade`, `help`, `--version` entrent en collision avec celles du CLI Bun actuel, et toute commande intégrée masque un script `package.json` du même nom (comportement de Bun). Options :

1. Le CLI Bun `yolo` devient l'ensemble des commandes de plugins du runtime (`yolo ops`, `yolo forge`… chargés comme plugin JS par le binaire `yolo`) : un seul `yolo`, conforme à « un seul CLI ».
2. Le CLI Bun est renommé (par exemple `aphrody-ops`, ou repli sous `aphrody`) et `yolo` est réservé au runtime.
3. Le runtime garde `bun` comme nom de fichier et `yolo` reste le CLI : contraire à la Décision finale.

Recommandation de l'audit : l'option 1 (elle prolonge la consolidation faite le 5 octobre et la règle « un seul CLI »), en réservant d'emblée dans le binaire les noms `create`, `update`, `upgrade` du runtime et en préfixant les commandes Aphrody (`yolo ops …`).

## 6. Infrastructure de build

- **VPS actuel** (OVH VPS-4, 12 vCPU, 46 Gio, Ubuntu 26.04) : charge soutenue ~25 pendant les builds ; service renouvelé le 5 octobre (commande `260903513`, réglée), **renouvellement automatique activé**, suppression à expiration désactivée ; compte de service OVH OAuth2 opérationnel (IAM `aphrody-automation`).
- **Mesures du 5 octobre** : `aphrody` release (hôte) 27 min 41 s à froid, 4 min 46 s en incrémental ; fork Bun release LTO 15 min 17 s (`bun-forge`, caches chauds) ; `cargo-zigbuild` ciblant glibc 2.39 échoue sur `simdutf` (AVX-512 `evex512` refusé par le clang de zig) : le correctif de symboles libm est la voie retenue pour `aphrody`, à évaluer pour le fork.
- **Recommandation d'hébergement** (rapport `docs/research/infra/hosting-offers-2026-10-05.md`) : serveur dédié OVHcloud **RISE-M** (Ryzen 9 9900X 12c/24t, 64 Go DDR5, 2 × 512 Go NVMe ; 99,99 € HT/mois, ou 94,99 € avec 12 mois payés d'avance) comme fabrique Cargo/WebKit dédiée, le VPS-4 restant production. Gain estimé (non mesuré) : ×1,5 à 2 avec 6 jobs, ×2 à 3 avec 12. Pertinent pour le one shot 1 : J0 et J2 construisent le noyau plusieurs fois, et les cinq chantiers parallèles font du `cargo check` concurrent.
- **Tunnel de build** : `scripts/build/rust/vps-cargo.ts` construit l'état exact du worktree WSL sur le VPS (tmux `vps-tunnel`/`vps-cargo`, verrous de la fabrique, `fetch` des artefacts avec contrôle d'ABI) ; un hook bloque toute compilation Cargo lourde dans WSL. À reprendre tel quel pour `yolo` (worktrees par chantier = un snapshot par chantier).

## 7. Mises à jour amont (« bump sans perdre notre code »), état et méthode

- **Fork Bun** : à jour (fusion du 5 octobre, `main` = amont + patches).
- **Tauri / plugins-workspace / wry / create-tauri-app** : forks `yolo` à jour de leur ligne amont, imports d'`aphrody` identiques.
- **tao** : 2 commits amont à prendre (avance rapide de `yolo`, puis `yolo import` des crates tao).
- **Obscura** : 107 commits amont à intégrer dans la branche `yolo` du fork (qui garde son commit SSRF), puis dans la copie d'`aphrody` par fusion trois voies (base `1a3169da`, ~19 commits locaux préservés). C'est exactement l'étape 1-2 du J0 de la partie 2 ; la faire maintenant raccourcit le J0 et met à jour `OBSCURA-UPSTREAM.txt`.
- **Méthode commune** : branche amont en miroir (avance rapide), branche `yolo` du fork fusionnée avec l'amont (jamais rebasée ni forcée), réimport reproductible (`yolo import` pour Tauri ; script d'import trois voies pour Obscura), puis `cargo check`/tests sur le VPS avant commit.

## 8. Décisions ouvertes à trancher dans le plan final

1. **Nom** : ordre exact archivage `yolo` → `yolo-legacy`, repointage des références (liste du §1), puis création du nouveau `yolo` ; ou nom différent pour éviter la redirection cassée.
2. **CLI** : quelle option du §5 pour la collision `yolo` CLI Bun / binaire runtime.
3. **Préfixe de modules** : `yolo:*` natif (coût J0) ou `bun:yolo/*` + alias.
4. **Branche source d'Obscura** : `yolo` du fork (commit SSRF) + patches de la copie, et date de la remise à niveau (avant J0 recommandé, §7).
5. **Base glibc** du binaire `yolo` distribué (correctif de symboles, sysroot, ou WSL passé en 26.04).
6. **Machine d'exécution du one shot** : VPS actuel (contention avec la production) ou RISE-M dédié.
7. **Patches Tauri restants** (plugin dialog, préfixe ACL) : à pousser dans `aphrody-labs/plugins-workspace` avant la bascule en pins.
8. **V8 dans `aphrody` pendant la transition** : couper `native-browser` et `render` par défaut au 2 bis, ou dès maintenant.

## 10. Résultats des recherches approfondies (5 octobre, sources datées dans les rapports)

Trois recherches sans accès aux dépôts : Obscura (versions, issues, PR), Tauri v3 (changelog, migration, issues), dépôts externes utiles. Les points qui **corrigent ou complètent** les parties 1-3 :

### 10.1 Obscura amont (v0.2.4, `1fccab2`)
- **Pas de v3** : versions 0.x, pas de changelog ni de milestone ; v0.2.4 (4 octobre) suit v0.2.3 (base de notre copie) avec 212 commits en 14 jours, rythme d'une release toutes les deux semaines. Aucune roadmap déclarée ; promesse « Apache-2.0, no feature gating, ever ».
- **Chiffres à jour** (même méthode aux trois révisions) : `bootstrap.js` 17 933 lignes (plan : 16 918), 73 ops (70), 183 occurrences `v8::` (164), 1 035 `tokio::` (+18 %).
- **Correction** : « un seul isolate V8 par processus, verrou `v8_lock` global » est faux depuis juillet (`v8_lock.rs` supprimé le 20/07) : un isolate par page, un thread OS par connexion CDP, un verrou par connexion. Conséquence : le « goulot V8 levé par construction » de la partie 1 est surévalué.
- **Rien d'amont** sur JSC/QuickJS/abstraction moteur, V8 optionnel, runtime sans tokio ou pipe CDP : l'amont renforce V8 (#1031, #1135, #1197). La divergence est définitive ; chaque correctif de `obscura-js` devient un portage manuel.
- **CDP** : WebSocket TCP seulement ; jeton par `Authorization: Bearer` (obligatoire hors loopback) ; toute requête avec en-tête `Origin` refusée (403) : **à vérifier** pour le backend `"obscura"` de `Bun.WebView`. `Target.getTargets` vide pour une nouvelle connexion (#543/#570) : la fumigation Puppeteer doit utiliser `newPage()`.
- **SSRF** : #861 (liste CIDR autorisée) entre en conflit avec notre commit SSRF ; #852/#868 (`198.18.0.0/15` bloquée) casse WSL2 avec Clash fake-ip. **Perf** : le coût du pont JS domine (×3 à ×9, #1155/#1156) : à prendre en compte pour les fonctions hôtes du chantier B. Ouvertes utiles : #1152 (HTTP/2), #1158 (stockage persistant `redb`), #1080 (vrai `WebSocket` de page).
- **Parité avant retrait de V8** : `obscura-benchmark` la chiffre (obstacles 33/33, WPT Core 83,3 %, 69 fixtures de rendu) ; `yolo browser fetch` doit garder la syntaxe de `obscura fetch`.
- **Fait ce jour** : fork `aphrody-labs/obscura` `yolo` = amont `main` + 3 commits propres (SSRF, correctif de test, fusion), `main` aligné ; copie du monorepo remise à niveau (commit `d21e0f54a`, 1757 tests release verts) ; fork privé `aphrody-labs/taffy` `4cd8b38` porte `DetailedGridTracksInfo::end_offset` et les correctifs de mise en page amont. **Reste** : reporter `shape-run-cache` de cosmic-text dans `athena-text` (feature laissée éteinte).

### 10.2 Tauri v3
- **Calendrier** : cinq alphas du 12 septembre au 1er octobre (`tauri` alpha.4) ; ni beta ni stable annoncées, jalon 3.0 avec 12 éléments ouverts (GTK4/WebKitGTK 6.0, refonte des listeners #16077, canal soumis à l'ACL #16037). **Viser une révision épinglée, pas une stable.** Les mainteneurs confirment que `tauri-runtime` casse son API à chaque mineur (#16209) : pins par révision git exacte.
- **Point bloquant pour l'invariant « tokio hors du noyau »** : épingler `tauri-runtime-wry` en v3 fait entrer le crate `tauri` complet (tokio et reqwest 0.13 non optionnels). Le couplage tient à `tauri_ext.rs` (307 lignes), au paramètre par défaut de `WryRuntime` (`lib.rs:2713`) et à deux appels Android : une dépendance optionnelle derrière une feature dans le fork `aphrody-labs/tauri` (~30 lignes) règle le problème.
- **Corrections à la partie 3** : `tauri-runtime` v3 ne dépend plus de gtk/webkit2gtk et fait 6 164 lignes (pas 2 874) ; le message IPC v3 contient aussi `options.headers` et `__TAURI_INVOKE_KEY__`, `@tauri-apps/api` attend `__TAURI_INTERNALS__` (8 membres) : le stub `tauri.d.ts` du fork Bun est incomplet ; le « +100 Mo » de CEF n'est pas vérifié (SDK ≈ 1 Go par plateforme).
- **Permissions** : toute la résolution `allow-*/deny-*` vit dans `tauri_utils::acl` (sans tokio, reprenable par pin) ; seul le contrôle à l'exécution (`RuntimeAuthority`, 2 033 lignes) est dans `tauri`.
- **Hôte de fenêtres obligatoire** : la boucle tao exige le thread principal sous macOS ; wry lie webkit2gtk au lien (pas de chargement dynamique) : le noyau ne démarre sans webkit2gtk que si wry vit à part. **Protocole hôte** : une ABI courte (modèle de la branche amont `feat/bindings` / `tauri-ffi` : file d'événements, poignées `u64`, ACL synthétisée, expérimentale : design, pas code) plutôt qu'un proxy de ~210 méthodes de traits.
- **IPC** : option A (réécrire côté Bun) ou **option B (garder `tauri` complet dans le seul binaire hôte de `@aphrody/plugin-tauri`) : ACL, canaux, plugins officiels et `@tauri-apps/api` marchent tels quels ; recommandée pour le one shot 3.** CEF reste un hôte séparé en fin de séquence (dépend de `tauri`, GTK4 incompatible avec wry dans un processus, sans sandbox sous Windows). `tauri-bundler` est une bibliothèque synchrone sans tokio, utilisable pour `yolo crawl app`.
- **Forks** : le patch tao du fork `tauri` est inopérant (`[[patch.unused]]`, tao reste à crates.io 0.37.0) : `cargo update -p tao` sur le build host ; le patch dialog local = PR amont plugins-workspace#3655 (ouverte), à cherry-picker ; les cinq forks sont publics.

### 10.3 Dépôts externes et faits sur le fork Bun (recommandations par chantier)
- **Amont Bun déjà en Rust** (PR #30412 fusionnée le 2026-05-14, v1.4.0 le 2026-08-20) : le fork = amont + 6 commits. **Ne diverger que dans `crates/browser` et `crates/plugins`** ; couper l'amont du noyau coûte cher.
- **WebKit précompilé par défaut** sur `c439b6fbd` : `scripts/build/config.ts:1295` fixe `webkit: partial.webkit ?? "prebuilt"` et 15 profils sur 17 de `profiles.ts` sont en `prebuilt` (2 en `local`). La PR #41330 (2026-09-06) n'a pas changé ce défaut dans le checkout : la ligne « WebKit précompilé / préchauffer `autobuild` » (J0, checklist) reste exacte (correction du 2026-10-05, vérifiée sur le code par deux relectures indépendantes).
- **Chantier A (TLS)** : l'empreinte Chrome complète existe en PR amont #40275 (ouverte) : JA3, GREASE, permutation des extensions, ALPS, compression de certificat, ECH GREASE, ML-KEM ; le BoringSSL de Bun expose déjà ces API. Un cherry-pick remplace le travail de A. Reste HTTP/2 (modèle `0x676e67/http2`) et SOCKS5 (amont #16812) ; mesure avec `pingly` (Rust) plutôt que tls.peet.ws.
- **Chantier B (realm JSC)** : `node:vm` de Bun contient déjà global objects isolés, cache de bytecode (`produceCachedData`) et interruption (`NodeVMRunTermination`) : **un essai d'une heure** (`vm.createContext` + ops fournis par N-API) valide `bootstrap.js` sur JSC avant tout Rust. Les plugins n'ont aucun accès direct à JSC (le binaire n'exporte que `napi*`, `uv_*`, une cale V8) : l'hôte de realm doit vivre dans le noyau, exposé par une table C versionnée (confirme la partie 1).
- **Filet « état vert » sans V8** : la façade `deno_v8` de Deno (PR #36194) bascule `deno_core` vers QuickJS par feature Cargo ; le `Cargo.lock` d'`aphrody` contient déjà `deno_core 0.412 → deno_v8 0.4 → v8x`. Pas de JIT : la cible reste JSC. `v8x` en mode JSC ne marche que sur macOS (382/429 tests `deno_core`) : table de correspondance V8 → JSC, pas dépendance ; `obscura-android-port` (méthode de conversion des ops) et Rong (interruption) servent de référence.
- **Chantier D / WebView** : `Bun.WebView` sait se connecter à un serveur CDP existant (`backend.url`) : le backend `"obscura"` hors processus n'exige pas de transport pipe ; le backend Chrome est interdit dans un Worker.
- **Concurrent** : Moli (Rust, Apache/MIT) annonce 81,9 % sur Lexbench contre 44,9 % pour Obscura (chiffres de Moli, non mesurés ici ; lié à V8 aussi) : garder Obscura pour le one shot 1, mesurer les deux, emprunter les composants découplés (types CDP, conformité WPT). Licences : Lightpanda et crw (AGPL), JA4+ (FoxIO, usage commercial interdit) en référence seulement ; JA4 seul est BSD-3 ; Cottontail, `blackboardsh/jsc`, ferridriver sans licence.
- **Desktop** : `tauri-runtime-verso` = précédent du modèle « processus hôte » ; webviewjs (wry dans le processus) gèle sous Linux/GTK (#52). D'Electrobun : IPC chiffré par webview, correctifs bsdiff, bundle zstd ; signature des plugins : format minisign de l'updater Tauri.
- **Crawl (one shot 2)** : algorithmes de `spider` (MIT), API URL Frontier comme contrat du `FrontierStore`, patron « un trait, trois backends » d'apalis sur `Bun.sql`/`Bun.redis`.
- **Versions** : la copie d'Obscura épingle `wreq 6.0.0-rc.31` (pas rc.29) ; en amont la ligne est devenue `wreq 0.16` avec `btls` comme backend TLS.

### 10.4 Décisions ouvertes ajoutées au §8
9. Correctif de dépendance optionnelle dans le fork `aphrody-labs/tauri` (tokio/reqwest derrière feature) : oui/non.
10. IPC desktop : option A (réécrite côté Bun) ou B (`tauri` complet dans l'hôte de plugin) ; recommandation de l'audit : B.
11. Protocole hôte de fenêtres : ABI courte (`tauri-ffi`) ou proxy complet des traits ; recommandation : ABI courte.
12. Rythme des rebases d'ici GTK4/WebKitGTK 6.0 (pins par révision exacte).
13. Chantier A : cherry-pick de la PR Bun #40275 (empreinte TLS) plutôt que réécriture.
14. Chantier B : essai `node:vm` d'une heure avant le portage Rust.
15. Prérequis machine : JSC est téléchargé précompilé par défaut (`local` seulement sur 2 profils) ; ICU et le reste du noyau Bun se compilent ; dbfr rejoint la chaîne de build en secours (`--host auto`, 3 jobs) mais le noyau Bun reste un travail du VPS ou du serveur dédié.

## 9. Checklist de démarrage mise à jour

- [x] Préfixe `aphrody-` pour toutes les crates (Décision finale).
- [x] Build vert du fork avant toute modification : `c439b6fbd`, release LTO, reçu `bun-forge` (§1). Reste le build debug et `cargo check --workspace` sur le fork vierge.
- [x] Fork Bun synchronisé sur l'amont, une seule branche `main`.
- [x] Tauri, plugins-workspace, wry, create-tauri-app : forks à jour, imports identiques.
- [x] tao : 2 commits amont intégrés (fork et monorepo, `1fc288873`).
- [x] Obscura : fork remis à niveau (107 commits) et copie du monorepo fusionnée (`d21e0f54a`) ; reste à relever la base de mesures (latence `fetch`, RSS, taille, obstacles).
- [ ] Repointer les références à l'ancien `yolo` (§1), puis archiver/renommer en `yolo-legacy` ; créer le dépôt privé `yolo` ; accès push de la session.
- [ ] Trancher les décisions du §8.
- [ ] Base glibc de distribution du binaire.
- [ ] Caches de build de la machine d'exécution : WebKit est précompilé par défaut (`local` = compilation des sources, 2 profils) ; les caches `bun-forge` du VPS sont chauds (`/srv/aphrody-build/cache/bun-forge`).
- [ ] `FUSION.md`, prompts des six agents, plafonds de dépense, pages de fumigation, 30 min humaines en fin de J0 et J2.
- [ ] `LICENSES/obscura-APACHE-2.0`, provenance d'Obscura, de taffy et des polices dans `config/upstream-sources.json` et `THIRD-PARTY.md`.

## Sources de cette partie

Rapports d'audit du 5 octobre (lecture seule) : mécanismes d'extension du fork Bun, inventaire et absorption d'Obscura, inventaire Tauri et impact du renommage ; reçu `bun-forge` de `c439b6fbd` ; comparaisons GitHub (`compare`) des forks `aphrody-labs/{bun,obscura,tauri,plugins-workspace,wry,tao,create-tauri-app}` contre leurs amonts ; `vendor.toml`, `vendor.lock`, `config/upstream-sources.json`, `config/tauri-upstream.json`, `docs/reference/web/crates/aphrody-obscura/OBSCURA-UPSTREAM.txt` ; `objdump -T` des binaires ; `PLAN.md`, `MEMORY.md` et `docs/research/infra/hosting-offers-2026-10-05.md` d'`aphrody` (commits `b1af71346` à `a8f0f4211`). Les gains de performance du §6 sont des estimations ; les durées de build et tailles sont mesurées.

## 11. Usage réel de deno_core et de V8 dans le fork Obscura (mesuré le 2026-10-05)

Mesures faites directement sur le fork `aphrody-labs/obscura`, branche `yolo` (`dbea8a7`, amont v0.2.4 + 3 commits), avec `rg` sur les sources ; les comptages sont des lignes ou des occurrences selon l'indication.

### 11.1 « Deno » se réduit à deno_core

| Fait | Mesure |
|---|---|
| Dépendances Deno | `deno_core 0.412` (aussi en build-dependency) et `deno_error 0.7`. **Aucune** extension `deno_web`, `deno_url`, `deno_console`, `deno_webidl` ni `serde_v8` |
| Où | uniquement la crate `obscura-js` : `runtime.rs` (93 lignes citant `deno_core`), `ops.rs` (21), `module_loader.rs` (16), `frame.rs` (7), `build.rs` (7), `import_map.rs` (6). `obscura-dom`, `-net`, `-render`, `-cdp`, `-mcp` n'en dépendent pas |
| Ops | 74 ops distincts (76 `#[op2]` : 46 simples, 27 `fast`, 3 `nofast`), **aucun op asynchrone**, pas de macro `extension!` ; 74 ops appelés depuis `bootstrap.js` par `Deno.core.ops.op_*`, et **aucune autre API `Deno.core`** n'est utilisée |
| Web APIs | tout le DOM et les API web sont du JavaScript maison (`js/bootstrap.js`, 17 932 lignes) au-dessus de ces 74 ops ; deno_core ne fournit ni fetch, ni timers, ni URL |
| Ce que deno_core apporte réellement | `JsRuntime` (isolate + boucle d'événements), `OpState` (62 occurrences : état par page, `RealmStates`), `ModuleLoader` + `load_side_es_module` + `mod_evaluate` (modules ES, 331 lignes + `import_map.rs` 455 lignes), création de snapshot (`build.rs`), `JsError`, `JsBuffer`, `ModuleSpecifier`/`resolve_import` |
| Contraintes tokio | la construction exige un contexte tokio (`enter_tokio_context`, runtime de repli multi-thread) et un verrou global `ISOLATE_CREATE_LOCK` ; `poll_event_loop` est piloté depuis tokio |

**Conséquence** : retirer deno_core ne touche qu'`obscura-js` (≈ 35 000 lignes de Rust dont les tests, 8 428 d'ops) et ne demande de réimplémenter que : l'enregistrement des 74 ops, le chargeur de modules, la boucle d'événements et l'état par page. Les 76 ops sont tous synchrones, donc simples à exposer comme fonctions hôtes.

### 11.2 Surface V8 directe (hors deno_core)

Lignes citant `v8::` : `runtime.rs` 106, `ops.rs` 42, `frame.rs` 2, `v8_flags.rs` 1 ; `obscura-browser/page.rs` n'a que des commentaires. Le nombre varie selon la méthode de comptage (183 occurrences dans la partie 1) ; seule la liste ci-dessous compte pour le portage. Les usages ordinaires (`Local`, `Global`, `String::new`, `Value`, `Object`, `Function`, `scope`/`PinScope`, `TryCatch`) existent dans tout moteur ; les sept capacités **propres à V8** sont :

| # | Capacité V8 | Où | Équivalent JSC (hypothèse à vérifier, non testée) |
|---|---|---|---|
| 1 | Snapshot de démarrage de `bootstrap.js` (`create_snapshot` dans `build.rs`, `startup_snapshot` ; chemin de compilation croisée avec `mksnapshot` ; 52 mentions dans `build.rs`) | `build.rs`, `runtime.rs` | pas d'API publique de snapshot de tas ; repli : évaluer `bootstrap.js` au démarrage avec cache de bytecode |
| 2 | Plusieurs `v8::Context` dans un isolate pour les frames (`Context::from_snapshot`, `frame.rs`) | `runtime.rs`, `frame.rs` | plusieurs `JSGlobalContext` dans un `JSContextGroup` : modèle compatible |
| 3 | Cache de code (`script_compiler` + `CachedData`) | `runtime.rs` | cache de bytecode JSC (existe côté Bun, API privée) |
| 4 | Limite de tas (`add_near_heap_limit_callback`, `HeapStatistics`) et arrêt (`IsolateHandle::terminate_execution`, watchdog `spawn_watchdog`, 122 lignes `cdp_watchdog.rs`) | `runtime.rs` | arrêt par le watchdog de la VM JSC ; pas de rappel équivalent de limite de tas connu : à concevoir |
| 5 | Drapeaux V8 (`set_v8_flags`, `--max-old-space-size`…) | `v8_flags.rs` | sans objet ; mapper vers les options JSC ou retirer |
| 6 | Locale ICU globale (`v8::icu::set_default_locale`, bug #734) | `runtime.rs` | ICU de WebKit : réglage propre à JSC |
| 7 | `Private::for_api`, statut de module privé lu par `mod_evaluate` | `runtime.rs`, `ops.rs` | à réécrire avec le chargeur de modules |

### 11.3 Ce que cela change au plan

1. **Frontière de portage** : définir une interface `JsEngine` d'exactement ces sept capacités plus l'enregistrement de 74 ops synchrones ; tout le reste d'`obscura-js` (DOM, CDP, rendu) est indépendant du moteur. Le portage JSC (chantier du J0 à J3) devient un travail borné à `obscura-js`, pas à Obscura entière.
2. **Retrait de deno_core** : faisable séparément du retrait de V8 (il n'y a que deno_core, aucun paquet `deno_*` d'API web) ; première étape sans risque de parité si on garde V8 : remplacer `JsRuntime` par `rusty_v8` direct. Cette étape est facultative et n'a de valeur que si elle réduit le coût du portage JSC ; ne pas la faire avant la décision JSC.
3. **Règle de dépôt** : `CLAUDE.md` impose de conserver V8 jusqu'à la parité Obscura/JSC requise ; le plan ne supprime donc V8 qu'après réussite de la suite de parité (334 tests de `runtime.rs` et les tests `obscura-cdp`) sur JSC.
4. **Points à mesurer avant décision** (non vérifiés) : coût de démarrage sans snapshot (évaluation de 17 932 lignes de JS à chaque isolate), existence d'un moyen de limiter le tas sous JSC, comportement des modules ES (`import()`, 2 usages dans `bootstrap.js`).
5. **Sécurité** : le watchdog et la limite de tas sont les garde-fous contre les scripts hostiles ; aucun équivalent JSC ne doit manquer au moment de retirer V8.

### 11.4 Équivalence V8 ↔ JSC vérifiée sur les révisions exactes (2026-10-05)

**Révisions figées et forkées** (dépôts `aphrody-labs`, créés le 2026-10-05, branches d'épinglage ajoutées) :

| Composant | Révision exacte | Fork |
|---|---|---|
| WebKit/JSC lié par notre Bun (`WEBKIT_VERSION`, build `c439b6fbd`) | `oven-sh/WebKit` `5718a6ec579b98362ea7276a426deedcc6281ef5` | `aphrody-labs/WebKit`, branche `bun-pin` |
| V8 d'Obscura (`deno_core 0.412` → crate `v8 150.4.0`) | `denoland/rusty_v8` tag `v150.4.0` = `5c15a6995c9bb4bacd3e341b59fff32c909c80bf` | `aphrody-labs/rusty_v8`, branche `obscura-pin-v150.4.0` |

Les en-têtes JSC lus viennent du préconstruit du VPS (`/srv/aphrody-build/cache/bun-forge/build-cache/webkit-5718a6ec579b9836-lto/include`), c'est-à-dire de ce que `bun-forge` lie réellement ; le crate `v8-150.4.0` est dans le registre Cargo du VPS. Les forks sont des miroirs de dépôts publics (WebKit est volumineux : aucun clone local).

**Vérification** : `scripts/audit/engine-equivalence.ts` (sondes `rg` à chaînes fixes : symbole V8 appelé par `obscura-js`, symbole déclaré dans les en-têtes JSC sur le VPS, symbole utilisé par les sources du fork Bun ; reçu `docs/plans/fusion/engine-equivalence-2026-10-05.json`). Un équivalent n'est « couvert » que si les trois côtés sont trouvés.

| Capacité | Résultat | Équivalent trouvé |
|---|---|---|
| Plusieurs contextes dans une VM (frames) | **couvert** | `JSContextGroupCreate`, `JSGlobalContextCreateInGroup` |
| Cache de code compilé | **couvert** | `CachedBytecode` (50 occurrences dans les en-têtes, 66 dans Bun), `generateCachedModuleByteCodeFromSourceCode` |
| Arrêt d'un script (watchdog) | **couvert** | `VM::notifyNeedTermination`, `JSContextGroupSetExecutionTimeLimit` |
| Locale ICU par défaut | **couvert** | `WTF::overrideUserPreferredLanguages`, `defaultLanguage` |
| Chargeur de modules ES | **couvert** | `JSModuleLoader`, `moduleLoaderResolve` |
| Fonctions hôtes (74 ops synchrones) | **couvert** | `JSC_DEFINE_HOST_FUNCTION`, `JSObjectMakeFunctionWithCallback` |
| Microtâches | **couvert** | `drainMicrotasks`, `MicrotaskQueue` |
| Exceptions | **couvert** | `ThrowScope`, `CatchScope` |
| Drapeaux du moteur | **couvert** (traduction) | `Options::initialize`, variables `BUN_JSC_*` ; les chaînes de drapeaux V8 ne se transposent pas 1:1 |
| Snapshot de démarrage | **trou** | aucun symbole `StartupSnapshot`/`SnapshotCreator` ni dans JSC ni dans Bun : `bootstrap.js` (17 932 lignes) est évalué au démarrage, atténué par le cache de bytecode |
| Limite de tas (rappel proche de la limite) | **trou** | aucun en-tête JSC ; la couche de compatibilité V8 de Bun stocke le rappel sans jamais le déclencher (« JSC grows its heap without a near-limit hook ») : sondage du coût mémoire ou correctif WebKit à prévoir |

**Fait nouveau** : le fork Bun contient déjà une couche d'API C++ V8 au-dessus de JSC (`src/jsc/bindings/v8`, 82 fichiers, ≈ 7 400 lignes, pour les addons natifs Node). Elle n'est **pas** une solution de remplacement pour Obscura : `rusty_v8` lie le vrai V8 et appelle son C++, pas cette couche ; et elle n'implémente aucun des appels utilisés par Obscura sauf `FunctionTemplate::New` et `HandleScope` (0 occurrence de `Isolate::TerminateExecution`, `Context::New`, `ScriptCompiler::CachedData`, `SnapshotCreator`, `TryCatch`, `GetHeapStatistics`).

**Remplacement automatique** : la correspondance ci-dessus est lisible par machine (reçu JSON, symbole V8 → symbole JSC → symbole Bun). Aucune réécriture automatique du code d'Obscura n'a été exécutée : elle dépend de l'interface `JsEngine` du §11.3 et des deux trous (snapshot, limite de tas), à trancher avant. Le script se relance après chaque bump du pin WebKit ou de `rusty_v8` pour détecter un équivalent qui disparaît.

## 12. Décisions tranchées (2026-10-05, « tranche tout »)

Chaque décision ouverte du §8 et du §10.4 est tranchée ci-dessous sur la base des faits mesurés dans cette partie. Elles restent révisables par le propriétaire avant J0 ; aucune action externe (renommage de dépôt, création de dépôt, publication) n'est exécutée par ce plan.

| # | Décision | Tranché | Raison (fait vérifié) |
|---|---|---|---|
| 1 | Nom `yolo` | Ordre fixe : (a) renommer l'ancien `aphrody-labs/yolo` en `yolo-legacy` et l'archiver, (b) repointer les références du §1, (c) seulement ensuite créer le nouveau `yolo` depuis `main` du fork Bun | Le dépôt `yolo` existe déjà (privé, 220 commits) ; créer le nouveau avant le renommage casse la redirection. `yolo-legacy` n'existe pas (404) |
| 2 | Collision du CLI | Option 1 : un seul `yolo` ; le CLI Bun actuel devient les commandes de plugin du binaire (`yolo ops …`) ; noms `create`, `update`, `upgrade` réservés au runtime | Prolonge la surface unique du 5 octobre ; l'option 3 contredit la Décision finale |
| 3 | Préfixe de modules | `yolo:*` natif, avec alias de transition `bun:yolo/*` jusqu'à la parité | Les parties 1 à 3 et les one shots utilisent `yolo:*` ; le fork a déjà l'espace `bun:` |
| 4 | Branche source d'Obscura | **Fait** : branche `yolo` du fork (amont v0.2.4 + 3 commits dont SSRF) et copie du monorepo remise à niveau (`d21e0f54a`) | Reste à extraire les patches Aphrody vers `patches/obscura/` à J0 |
| 5 | Base glibc | Reprendre la méthode qui a fonctionné pour `aphrody` : définir `acosf`, `asinf`, `atan2f` depuis libm dans le fork (cfg linux gnu) ; sysroot plus ancien seulement si d'autres symboles @GLIBC_2.43 apparaissent | `bun` 1.4.3 du forge n'importe que ces trois symboles @GLIBC_2.43 ; `cargo-zigbuild` a échoué sur simdutf AVX-512 |
| 6 | Machine d'exécution | VPS sous verrous d'usine (build mesuré : 902,8 s) pour J0 à J2 ; dbfr en secours pour le Rust seul ; pas de serveur dédié pour l'instant | Build complet qualifié sur le VPS ; dbfr n'a que 11 Gio de RAM |
| 7 | Patches Tauri restants | Oui : pousser le patch dialog et le préfixe ACL dans `aphrody-labs/plugins-workspace` avant la bascule en pins | Seuls patches non présents dans les forks (§4) |
| 8 | V8 pendant la transition | **Ne pas couper** `native-browser` et `render` par défaut avant la parité JSC ; la coupure est un livrable du 2 bis, après réussite de la suite de parité | `CLAUDE.md` impose de conserver V8 jusqu'à la parité requise ; §11.3 |
| 9 | Dépendance optionnelle `tauri` | Oui : tokio/reqwest derrière une feature dans le fork `aphrody-labs/tauri` (patch petit, proposable à l'amont) | `tauri-runtime-wry` tire le crate `tauri` complet (§4) |
| 10 | IPC desktop | Option B : `tauri` complet dans l'hôte de plugin | Évite de réécrire l'IPC côté Bun ; recommandation de l'audit |
| 11 | Protocole hôte de fenêtres | ABI courte (`tauri-ffi`) | Cohérent avec l'ABI `yolo-runtime` 1.4 |
| 12 | Rythme des rebases | Pins par révision exacte ; rebase à chaque version amont stable, jamais en flux continu, jusqu'au passage GTK4/WebKitGTK 6.0 | `bun_upstream_sync.ts` fusionne sans pousser en force |
| 13 | PR Bun #40275 (empreinte TLS) | Cherry-pick plutôt que réécriture | Le fork ne contient aucun proxy SOCKS ni cette empreinte |
| 14 | Essai `node:vm` | Oui : essai d'une heure avant le portage Rust du chantier B | Peu coûteux, évite un portage inutile |
| 15 | Prérequis machine | JSC précompilé par défaut ; ICU et le noyau Bun compilés ; dbfr rejoint la chaîne en secours (`--host auto`, 3 jobs) | `config.ts:1295` ; `config/host/vps-cargo.json` |
| 16 | Trous du §11.4 | Snapshot : évaluer `bootstrap.js` au démarrage avec cache de bytecode (mesurer le coût avant le one shot). Limite de tas : sondage du coût mémoire côté hôte, correctif WebKit en dernier recours | Aucun symbole JSC pour ces deux capacités (reçu d'équivalence) |
| 17 | `deno_core` | Le retirer seulement avec le portage JSC (pas d'étape intermédiaire `rusty_v8` direct) | §11.3 : sans gain avant la décision JSC |
| 18 | Runtime Python | **`vu`** (inverse littéral de `uv`), tranché par le propriétaire le 2026-10-05 (la première formulation `ir` est abandonnée) ; le nom reste isolé dans une constante | Plan dans `docs/plans/vu/PLAN.md` (agent en cours, renommage demandé) |
| 19 | dbfr | Ne pas relancer nginx ni privoxy ; dbfr est hôte de build secondaire ; aucune autre suppression ; l'unique copie de `/srv/shenron/shared` est celle du VPS (32 Go) et doit être sauvegardée avant toute opération sur le VPS | Rapport de l'agent de ménage : la suppression sur dbfr n'était pas la sienne |
