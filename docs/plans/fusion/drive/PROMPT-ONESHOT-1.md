# Prompt de session — one shot 1 : monorepo `yolo`, binaire + plugin Obscura

À coller tel quel comme premier message de la session Claude Code (Opus 5.5, workflow dynamique, plafond 200 €). Il est aussi versionné dans le dépôt sous `.claude/prompts/oneshot-1.md`.

```text
Tu es l'orchestrateur d'un workflow dynamique (Opus 5.5). Budget total : 200 € ; durée : 2 jours de
travail agent (J0 2 h, J1 8 h, J2 8 h, gel 2 h). Référence : le document « Plan de fusion Obscura × Bun »,
section « Décision finale » (qui prime), puis « Plan d'exécution one shot », « Simplification : Obscura en
plugin natif », « Points techniques délicats », « Risques ».

CIBLE : le NOUVEAU monorepo aphrody-labs/yolo, créé en J0 depuis la branche `main` (`c439b6fbd`) du fork
aphrody-labs/bun (la branche `yolo` n'existe plus). Worktrees et Cargo parallèle autorisés (un worktree par chantier, sccache partagé).
Commits `aphrody-dev <contact@aphrody.com>` sans co-auteur ; aucun secret ni sortie de build commités ;
aucune publication publique ; dépôt privé.

OBJECTIF (livrable unique, en une session) : un binaire `yolo` (alias `bun`) construit depuis ce dépôt qui
1) démarre aussi vite que le Bun-Rust d'origine (hyperfine `yolo -e 1`, écart < 0,5 ms),
2) charge le plugin `@aphrody/plugin-obscura` à la demande (lazy, signé),
3) passe `just smoke` : `yolo browser fetch https://example.com --dump text` ;
   `yolo -e 'const b = await Yolo.Browser.launch(); const p = await b.newPage();
   await p.goto("https://example.com"); console.log(await p.evaluate("document.title"))'` affiche
   `Example Domain` ; `yolo browser serve --port 9222` accepte puppeteer.connect + goto + evaluate ;
   `yolo browser fetch https://news.ycombinator.com --dump links` renvoie des liens ; capture PNG non
   vide d'example.com (sinon dans BROKEN.md),
4) ne contient ni v8, ni deno_core, ni tokio, ni reqwest, ni rustls, ni wreq, ni tungstenite, ni clap,
   ni tracing (`cargo tree` en preuve, `just tiers` vert),
5) est accompagné de BROKEN.md (quoi, où, pourquoi, piste), CLAUDE.md (≤ 100 lignes), Justfile (six
   recettes), README par crate, et du tag `oneshot-1`.

J0 (toi seul, 2 h, 15 €) — scripts idempotents dans scripts/fusion/*.ts :
- Créer le dépôt privé aphrody-labs/yolo (le dépôt `yolo` actuel existe : à archiver en `yolo-legacy` avant, voir partie 4) ; pousser la branche `main` du fork bun (`c439b6fbd`) comme `main` ; garder
  .github/workflows, scripts/build, dockerhub (→ docker/), docs/, test/ tels quels.
- rename.ts : `bun_x` → `aphrody-x` (Cargo.toml, use, scripts/build/*.ts, codegen, lints de source),
  `src/*` → `crates/core/*`, binaire `bun` → `yolo` + alias ; preuve : `cargo metadata` sans erreur puis
  `just build` = noyau inchangé, `just bench` = base de démarrage enregistrée dans docs/bench/baseline.json.
- import-obscura.ts : `git fetch upstream && git merge --ff-only` sur aphrody-labs/obscura (`main` est déjà aligné sur l'amont v0.2.4 `1fccab2c1` ; la branche `yolo` `dbea8a7c1` = `main` + 3 commits, à fusionner) ; diff trois
  voies avec la copie aphrody/crates/web/obscura-* (patches Aphrody dans patches/obscura/) ; import sous
  crates/browser/{browser,page_runtime,dom,render,transport,cdp,mcp} (la copie compte 9 crates : `obscura`, `-browser`, `-cdp`, `-dom`, `-js`, `-mcp`, `-net`, `-render`, `-ssrf`) ; crates en `[lints] workspace =
  false` + `#![allow(clippy::all, dead_code, unreachable_pub)]` ; tests Obscura sous feature `legacy-tests`.
- Pins : taffy et cosmic-text dans vendor/ (deps/*.ts) ; `[workspace.dependencies]` fusionnées, une version
  par crate (getrandom 0.4, thiserror 2, rustix 0.38, cssparser 0.36, selectors 0.33 : versions du `Cargo.lock` du fork Bun ; la copie Obscura est sur cssparser 0.37 / selectors 0.38) ; cargo deny actif.
- Squelette : crates/core/realm-host (API vide documentée), crates/core/plugin-abi (ex yolo-runtime,
  ABI v1), crates/core/io (traits Transport, Store, Clock, Fs, Process, Log ; nom déjà pris par `bun_io` renommé, à trancher), crates/plugins/obscura
  (cdylib N-API napi-rs, manifeste), default-members = noyau.
- Fichiers d'agent : CLAUDE.md, Justfile (build, plugin, check, smoke, bench, tiers), BROKEN.md vide,
  docs/decisions/0001-monorepo-yolo.md, .claude/prompts/oneshot-1.md (ce texte), FUSION.md (nommage,
  interdits, stubs, ordre de fusion, fumigation, budgets). LICENSES/obscura-APACHE-2.0. Commit, push,
  cinq worktrees créés.

J1 (5 agents en parallèle, un worktree chacun, `cargo check -p` par l'agent) :
- B · Runtime de page JSC (60 €, 8 h, chemin critique) : d'abord aphrody-realm-host dans crates/core/jsc
  (realm isolé par page dans un Worker, table de fonctions hôtes, execute_script avec CachedBytecode,
  interruption watchdog, échange JSON/buffers) ; puis crates/browser/page_runtime : objet
  globalThis.Deno.core servi par cette table, 74 ops portés (76 `#[op2]`) dans l'ordre op_dom, op_eval, timers, op_fetch,
  le reste ; 183 occurrences de v8:: réécrites (Global → JsRef, TryCatch → JsResult, snapshot supprimé,
  bootstrap.js évalué au démarrage du realm) ; crypto.subtle déléguée à WebCrypto ; unwrap/expect des ops
  convertis en erreurs. Arrêt : evaluate("1+1"), document.title après set_html, setTimeout qui tire.
- A · Transport (30 €, 6 h) : crates/browser/transport sur aphrody-http (navigation, sous-ressources,
  fetch de page, décompression C), jarre à cookies, robots, traqueurs, SSRF dans aphrody-dns ; profil
  ClientHello Chrome 145 sur BoringSSL (suites, ALPN, GREASE ; permutation, ALPS, compression de
  certificats si le temps reste) ; SOCKS5 = stub explicite.
- C · Moteur de navigation (25 €, 6 h) : fusion obscura + obscura-browser en aphrody-browser, async tokio
  → fonctions bloquantes sur le thread du Worker, tokio::sync → aphrody-threading, réponses par
  ConcurrentTask, capture/interception conservées.
- D · Surfaces (25 €, 6 h) : chargeur de plugins dans le noyau (manifeste, signature Ed25519, cache
  ~/.yolo/plugins, sous-commandes CLI et modules `yolo:*` virtuels, chargement paresseux) ; plugin N-API
  (Browser/Page/Element, yolo:browser + alias bun:browser, Yolo.Browser) ; `yolo browser
  {fetch,serve,scrape,mcp}` ; CDP sur aphrody-uws (Target, Page, Runtime, DOM, Network d'abord) ; MCP sur
  Yolo.serve ; backend "obscura" de WebView si réserve disponible.
- E · DOM et rendu (15 €, 4 h) : cssparser 0.36 / selectors 0.33, ureq → aphrody-http, encodage PNG/JPEG
  par les codecs du noyau (image toléré sinon), README par crate importée.
Chaque agent : commit par heure préfixé du chantier, stubs plutôt que dépassement, ligne BROKEN.md par
stub, jamais todo!/unimplemented!, jamais de build WebKit (autobuild en cache dès J0), jamais d'import
d'une crate bannie.

J2 (toi + 2 agents d'intégration, 25 €, 8 h) : fusion B → C → A → E → D ; `just build` ; `just plugin
obscura` ; correction par lots d'erreurs ; `just smoke` ; `just bench` comparé à la base ; `just tiers` ;
BROKEN.md exhaustif ; tag oneshot-1 ; push. Gel (2 h) : rien de nouveau, seulement ce qui fait passer une
commande de fumigation.

Règles d'arrêt : à 200 € ou à l'échéance, tu livres l'état courant ; la réserve de 5 € va d'abord à B ;
tout ce qui n'est pas porté est un stub explicite listé, jamais un panic. Interdits absolus : importer
tokio, reqwest, hyper, rustls, ring, wreq, tungstenite, tracing, clap, deno_core, v8 ; copier Tauri, CEF
ou next.js dans le dépôt (pins seulement) ; réécrire bootstrap.js ; reformater des fichiers non modifiés ;
toucher au dépôt aphrody ; publier quoi que ce soit.

Rapport final attendu : sortie de `just smoke`, `just bench` avant/après, taille du noyau et du plugin,
`cargo tree -i tokio` et `-i v8` vides, `just tiers` vert, lien du tag, BROKEN.md, budget consommé par
chantier, liste des décisions prises sans l'humain (docs/decisions/).
```


## Journal de vérification (2026-10-05)

Statut : V = vérifié conforme, C = corrigé ou complété, N = non vérifiable ici. Sources : fork Bun `c439b6fbd`, forks Obscura et Tauri via l'API GitHub, copie locale `crates/web/obscura*` (`d21e0f54a`).

| Affirmation | Valeur vérifiée | Statut | Source |
| --- | --- | --- | --- |
| Source du dépôt : branche `yolo` du fork bun | Branche absente ; `main` = `c439b6fbd` | C | API GitHub |
| Créer le dépôt privé `aphrody-labs/yolo` | Existe déjà (privé, non archivé, branches `main`/`dev`/`vendor`) ; `yolo-legacy` absent | C | API GitHub |
| Fork Obscura : `merge --ff-only` | `main` = amont v0.2.4 `1fccab2c1` ; `yolo` = `dbea8a7c1` (3 commits propres) | C | API GitHub |
| Import de 7 crates sous `crates/browser` | La copie compte 9 crates (`obscura`, `-browser`, `-cdp`, `-dom`, `-js`, `-mcp`, `-net`, `-render`, `-ssrf`) | C | `cargo metadata` |
| Versions uniques getrandom 0.4, thiserror 2, rustix 0.38, cssparser 0.36, selectors 0.33 | Valeurs du `Cargo.lock` du fork (0.4.2, 2.0.18, 0.38.44, 0.36.0, 0.33.0) ; Obscura est sur cssparser 0.37 / selectors 0.38 | V/C | `Cargo.lock`, `obscura-dom/Cargo.toml` |
| `crates/core/plugin-abi` (ex `yolo-runtime`) | `crates/engine/yolo-runtime` existe dans `aphrody` | V | `cargo metadata` |
| `crates/core/io` | Nom pris par `bun_io` | C | fork Bun |
| `crates/core/jsc` + `execute_script` + `CachedBytecode` | `src/jsc/CachedBytecode.rs` présent ; crate `bun_jsc` | V | `git ls-tree` |
| 70 ops à porter | 74 ops distincts, 76 `#[op2]` | C | `bootstrap.js`, `ops.rs` |
| 164 appels `v8::` | 183 | C | `rg` |
| `ureq` → `aphrody-http` (chantier E) | `obscura-render` utilise `ureq` 3 (workspace) | V | `obscura-render/Cargo.toml:44` |
| WebKit `autobuild` en cache dès J0 | Cohérent avec le défaut `webkit: "prebuilt"` du fork | V | `config.ts:1295` |
| Budget, durées, Opus 5.5, `hyperfine`, `just` | Estimations et consignes | N | — |
