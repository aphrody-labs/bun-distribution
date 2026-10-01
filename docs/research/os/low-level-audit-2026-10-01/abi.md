# Audit bas niveau — axe `abi` : contrat C-ABI de libaphrody (2026-10-01)

Niveau de preuve global : **P1 (statique)**. Aucun cargo / rustc / bun test lancé. Outils : rg, sed, git show/archive,
nm -D, readelf, objdump, python3 (analyse de texte), lecture des sources `~/.cargo/registry/src` (reqwest 0.13.5, mimalloc).
Niveaux par constat : **[V]** vérifié dans le code/l'artefact, **[P]** plausible, non reproduit.

Fichiers de travail (hors dépôt, hors ce dossier) : `/tmp/abi_scratch/` (scan.py, closure.py, crossref.py, threeway.py,
nm_T.txt, externs*.json, threeway.json, head/ = `git archive HEAD` des crates FFI). Supprimables ; non requis pour lire ce rapport.
(Incident : j'ai d'abord écrit `nm_T.txt` dans `/tmp/audit-low-level/`, déplacé aussitôt vers `/tmp/abi_scratch/`.)

## 0. Périmètre réellement lu

- `crates/interop/ffi` : `Cargo.toml` (81 l.), `src/lib.rs` (1216 l., intégral), `src/web/{mod,ffi_util,dom,jobs,index,embed,native_http,media,cookies,extract}.rs`
  intégraux ; `net.rs` 1-235 + 236-440 (corps), `net_aliases.rs` (ordre des arguments vérifié par script + fin de fichier),
  `text.rs` 1-200 + signatures des 2 derniers exports ; `include/aphrody.h` (383 l.), `include/aphrody-tooling.h` (41 l.),
  `README.md` 1-80, `bun/*.ts` (index.ts, agent.ts 1-80, example.ts, media.test.ts). `bin/` et `var/mirror/` : **vides** (rien à lire).
- Wrappers FFI hors crate : `crates/ui/bun/src/{lib,icons_ffi,render,reproduce,svg}.rs` (+ `icons/mod.rs`, `icons/svg.rs` : include_*, panics),
  `crates/compat/n2b-native/src/lib.rs` 1-260, `crates/compat/oxc-bridge/src/lib.rs` 1-200, `crates/os/stdio-capture/src/lib.rs` 1-200,
  `crates/web/web-index/src/ffi_api.rs` 1-200, `crates/ui/m3-reproduce/src/fetch.rs`, `crates/web/web-chromium/src/lib.rs` (extraits), `apps/cli/src/lib.rs:2280-2420`.
- Chargeur TS : `packages/interop/native/src/{library,engine,native-artifact,icons,manga,n2b,oxc,render,reproduce,svg,shenron,cli,web,native,native-response,index}.ts`
  intégraux ; `test-native-artifact.test.ts` (219 l.), `test-library.test.ts`, `test-cli-only.ts`, `test-ffi.ts` 1-60, `fixtures/bun-fork-native.ts` 1-50, `package.json`.
- Grille : `agents/ffi-architect.md`, `skills/rust-bun/SKILL.md`, `skills/rust-best-practices-2026/SKILL.md` (§unsafe/2024).
- Artefact : `target/release/libaphrody_ffi.so` (mtime 04:25, **antérieur** aux fusions de 07:21-07:26) : `nm -D`, `readelf -dlrSV`, `objdump -T`.

## 1. Dérive à trois voies (Rust exporté / en-têtes C / library.ts)

Méthode : `scan.py` extrait toutes les `extern "C" fn` de `crates/` + `apps/` (258 `extern "C" fn` dans 41 fichiers ; 993 occurrences de
`extern "C"` dans 46 fichiers = + blocs `extern`, pointeurs de fonction) ; 218 définitions nommées, **141 exportées** (`no_mangle`/`export_name`)
dans 24 fichiers. `closure.py` calcule la fermeture de dépendances de `aphrody-ffi` (Cargo.toml + features par défaut + cfg linux/x86_64, 112 paquets)
→ **117 exports first-party réellement compilés**. Les 24 autres : 18 faux positifs = gabarits `r#"…"#` de `crates/compat/n2b/src/{linux_cmd,rust_cmd,win32_cmd_templates,bin_cmd_templates}.rs`
(`add`, `page_size`, `tick_count`… « doublons » apparents), + spacedrive-sdk (4), `aphrody-drive` macos (1), koharu `mallinfo` (1) : hors cdylib.
Validation croisée : **les 117 sont dans `nm -D` et rien d'autre de first-party** (0 écart dans les deux sens).

| Groupe | Rust (cdylib) | aphrody.h + -tooling.h | `SYMBOLS` library.ts |
|---|---|---|---|
| `aphrody_*` (cœur) | 7 | 7 | 7 |
| `aphrody_oxc_*` | 5 | 5 | 5 |
| `aphrody_web_*` | 52 | 52 | 52 |
| `shenron_*` | 11 | 11 | 11 |
| `manga_*` | 8 | **5** | 8 |
| `node2bun_*` | 4 | 4 | 4 |
| `find_newlines_u16` | 1 | 1 | 1 |
| `bun_rs_*` | 22 | **0** | 22 |
| `web_internal_*` (legacy exportés) | 7 | **0** | **0** |
| **Total** | **117** | **85** | **110** |

`nm -D --defined-only … | grep ' T '` = **464** symboles : 117 first-party + **347 tiers** (temporal_rs_* 302, v8__*/v8_inspector__* 27, diplomat_* 9, crdtp_* 6,
rusty_v8_* 3 ; provenance Cargo.lock : obscura-js → deno_core → v8 150.4.0 → temporal_capi).

- **Exportés non déclarés dans l'en-tête** (32) : 22 `bun_rs_*` (aucun en-tête C ; seul library.ts les décrit), `manga_scanlate_{cdn,chapter,databook}` (aphrody.h:279-308 ne déclare que
  detect/typeset/pipeline/free/abi), 7 `web_internal_{extract_title,strip_tags,html_to_markdown,extract_links,extract_text,normalize_url,get_chromium_cookies}`
  (`text.rs:9,51,89,115,226,…`, `cookies.rs:7` ; **aucun consommateur** dans le dépôt, hors en-tête, hors TS). [V]
- **Déclarés mais inexistants** : aucun (en-tête∖Rust = ∅ ; TS∖Rust = ∅ ; TS∖nm = ∅). [V]
- **Signatures divergentes** (arité + classe de type, Rust↔en-tête↔TS) : **0 divergence** sur les 85 entrées d'en-tête et les 110 entrées TS. `u64` vs `u64_fast` (library.ts:92 vs 88) :
  même ABI fil ; bun-types 1.4.2 accepte `number | bigint` pour `uint64_t`. Limite : le script ne contrôle ni la constness ni la sémantique des pointeurs. [V]
- **Doublons / collisions** : 0 nom `no_mangle` en double dans la fermeture ; 0 intersection avec les 681 exports dynamiques de Bun 1.4.2 (`nm -D bun`) ; les 52 518 symboles C++ `_ZN2v8*` de libv8
  sont **locaux** (0 dans `.dynsym`) → pas d'interposition avec le shim V8 que Bun exporte. [V]
- **Doublons sémantiques** (même rôle, noms/signatures différents) : `web_internal_html_to_markdown(html)` (1 arg, text.rs:97) vs `aphrody_web_html_to_markdown(html, base)` ; `web_internal_get_chromium_cookies`
  vs `aphrody_web_get_chromium_cookies` ; `web_internal_extract_title` vs `aphrody_web_extract_title` ; 8 destructeurs pour un seul allocateur (`aphrody_string_free`, `shenron_string_free`,
  `manga_string_free`, `aphrody_web_free_string`, `node2bun_string_free`, `aphrody_oxc_free`, `bun_rs_free_string`, + `bun_rs_render_free(ptr,len)` qui, lui, est un `Box<[u8]>`).
- **Consommateurs hors scope avec leurs propres déclarations** : `py/aphrody-train/src/aphrody_train/shenron_ffi.py` (ctypes ; aucun contrôle d'ABI à la construction, cherche `~/src/target/{release,debug}`),
  `scripts/smoke-bxc-ffi.ts:5-11` (attend `bxc_bridge_abi_version == 3` dans `libaphrody_web_ffi.so` : symbole **absent** de libaphrody_ffi, version actuelle = 4), builtin `bun:aphrody` du fork (non lu).

### Fusions récentes (icons → aphrody-bun, web-media → web-extract, x-algorithm → x)

- Jeu de symboles **HEAD (`git archive`) = arbre de travail = artefact** : 117 = 117 = 117, aucune différence de signature (script `threeway.py` + diff de signatures HEAD/WT). [V]
- `aphrody_web_media_extract` / `aphrody_web_media_resolve_submit` : `media.rs:88-125` (`#[unsafe(no_mangle)]`), signatures inchangées ; imports désormais `aphrody_web_extract::media::{MediaRequest,MediaResponse,MediaTransport,ResolveOptions}`,
  `extract_media_candidates`, `extract_poster`, `resolve_embed` (existent : `web-extract/src/media/{resolver.rs:14,37,44,48,165 ; extract.rs:103,145}`, `lib.rs:37 pub mod media`). [V]
- `aphrody_web_x_algorithm_rank` : `net_aliases.rs:291` → `net.rs:423` → `aphrody_x::algorithm::rank_posts_json` (`x/src/algorithm.rs:273`, `lib.rs:38 pub mod algorithm`). [V]
- `bun_rs_icon_svg` / `bun_rs_icon_names` : même nom, déplacés de `icons.rs` (supprimé) vers `icons_ffi.rs:67,87` ; réexportés `bun/src/lib.rs:16-17` (`pub use icons_ffi::{…}`) puis `pub use bun_rs::*` côté ffi → atteignables. [V]
- Les 19 `include_bytes!/include_str!` de `icons/{mod,svg}.rs` pointent des fichiers présents sous `crates/ui/bun/icons/` (existence vérifiée) ; `Cargo.lock` régénéré, aucune entrée résiduelle
  `aphrody-icons|web-media|x-algorithm` ; plus aucune référence aux anciens crates hors commentaires/docs. [V] **Rien n'est prouvé compilable** (non compilé).

## 2. Sûreté aux frontières

**Panics** (`profile` : aucun `[profile.*]` dans le Cargo.toml racine → `panic = "unwind"` par défaut ; `catch_unwind` effectif). Depuis Rust 1.81 une panique qui sort d'un `extern "C"`
**abort le processus** (pas d'UB, mais le runtime Bun meurt). Protégés : `aphrody_run*`, `shenron_*` (sauf `persona_prompt`), `manga_*` (`catch_unwind`, lib.rs), tout `aphrody_web_*` non trivial (helper `guard`, ffi_util.rs:7 ; exceptions triviales : `free_string`, `bridge_abi_version`, `job_completed_seq`),
`aphrody_oxc_*` (`oxc-bridge:82,132`), `node2bun_scan*` (`n2b-native:147`), sass (2 fonctions, mais voir F-01). **Non protégés** (aucun `catch_unwind` ni `guard`) : 15 des 22 `bun_rs_*` non triviaux
(`icon_svg`, `icon_names`, `m3_css`, `validate_spec`, `derive_scheme`, `render_png`, `render3d_png`, `m3_reproduce`, `m3_seed_from_image`, `svg`, `hct_to_argb`, `argb_to_hct`, `hct_tones`, + 2 sass partiels),
et `shenron_persona_prompt` (lib.rs:468-474 : `OnceLock::get_or_init` lit le FS et parse). La garantie « every entry point catches Rust panics » (lib.rs:33-34, aphrody.h:21-22, README.md:20-21) est donc **fausse** pour ces symboles.

**Pointeurs** : null contrôlé partout (`collect_args` lib.rs:936-956, `parse_json_args` :962, `f32_slice` index.rs:56, `borrow_str` ffi_util.rs:15, bun_rs_* `is_null`). Longueurs non vérifiables par construction :
`from_raw_parts(ptr, len)` fait confiance à l'appelant ; `aphrody_web_index_add_batch` forme `count*dim` floats **avant** de comparer `dim` à l'index (index.rs:180-181 ; `(2^32-1)^2*4 > isize::MAX` = UB formel si le
paramètre est incohérent, bénin en pratique car `add_batch_flat` rejette ensuite). Buffers de sortie à taille implicite sans paramètre de capacité : `bun_rs_hct_tones` (13 u32), `bun_rs_derive_scheme` (49 u32) (voir F-08).

**Chaînes retournées** : toutes `CString::into_raw` (ou `Box<[u8]>` pour PNG) avec allocateur global mimalloc unique → libération croisée aujourd'hui sans effet (même `CString::from_raw`). Les chaînes statiques (`aphrody_version`, `shenron_persona_prompt`,
`bun_rs_version`) ne doivent pas être libérées : contrat documenté. TS : un seul `free` par pointeur, dans `finally` (engine.ts:54-64, native-response.ts:12-22, icons.ts:34-38, svg.ts) ; PNG : copie `slice(0)` avant `bun_rs_render_free` (render.ts:24-31). Pas de double free côté TS.
`into_c_string` supprime silencieusement les NUL (ffi_util.rs:22-30) ; `json_result` échappe (pas de NUL) → `string_to_c` ne renvoie jamais NULL en pratique malgré « NULL only on allocation failure » (aphrody.h:187-189).

**UTF-8 invalide** : `aphrody_run_json` rejette (to_str, lib.rs:968) mais `aphrody_run`/`shenron_run` convertissent **avec perte** (`to_string_lossy`, lib.rs:953) contrairement à aphrody.h:14-16 ; `target_lang` invalide → `unwrap_or("fr")` silencieux (lib.rs:658,732,785,841) ; `kind` invalide ignoré (lib.rs:397-403).

**Handles asynchrones submit/poll** (jobs.rs) : identifiants monotones `AtomicU64` (non réutilisés) ; `take` = lecture+suppression sous un même verrou (jobs.rs:152-164) → pas de course poll/free ni de double free ; `complete()` sur job annulé = no-op (jobs.rs:62-68) ; `submit` : fenêtre `Pending(None)`→abort handle (jobs.rs:94,116) sans conséquence (id pas encore rendu). Les `*_submit` **copient** leurs entrées avant de retourner (net.rs `owned()`, embed.rs, media.rs) → pas de pointeur JS conservé. **Défauts** : (a) résultats `Done(String)` conservés jusqu'à `take` sans TTL ni plafond (jobs.rs:35,59-69) ;
côté TS `liveJobIds` n'est vidé que par take/cancel (engine.ts:47,70-75,378,386) ; (b) `timeout_ms == 0` = illimité (jobs.rs:82,97) et le TS ne valide pas `timeoutMs` des `*Submit` (NaN → 0 = sans timeout) ;
(c) `take` renvoie NULL pour « en cours » **et** pour une panique dans `guard` ; `{"error":"unknown job id N"}` non NULL pour un id inconnu → un second `take` ou un `take` après `cancel` ressemble à un résultat (engine.ts:374-380 le traite comme terminé).
Index HNSW : registre `u64`→`Arc<Handle>` (index.rs:22-40,267) : handle périmé = code `-2`, jamais UAF ; `close` pendant `search` protégé par `Arc`. **DOM** : `Box::into_raw` brut (dom.rs:55-75, mod.rs:86-102) sans registre : double `tree_destroy` ou destroy concurrent d'une requête = UAF ; la garde n'existe que dans le wrapper TS (`WebDomTree`, engine.ts:124-164) dont le constructeur est public.

**Runtime tokio global** (lib.rs:894-902) : `OnceLock<Runtime>` multi-thread, créé au premier appel, jamais détruit ; `expect` si échec (couvert par `catch_unwind`/`guard`). `block_on` depuis un thread Bun (principal ou Worker) : correct (aucun contexte runtime sur ces threads) mais **bloque le thread JS sans annulation ni timeout** pour toute la famille `aphrody_run*`/`shenron_*`/`manga_*`/`*_obscura_fetch`/sync web.
Fork-safety : le `Bun.spawn` utilise posix_spawn → sans objet ; aucun `fork()` direct lu [P]. Appel depuis un thread tokio (re-entrance) : `block_on` panique, couvert mais non testé.

**mimalloc / TLS dans un dlopen** : `#[global_allocator]` mimalloc + feature `local_dynamic_tls` (Cargo.toml:64-65 ; feature présente dans mimalloc-0.1.52 `Cargo.toml:50`). Artefact : **0 relocation TPOFF, pas de `DF_STATIC_TLS`** (FLAGS = BIND_NOW), TLS 0x710 octets en modèle dynamique → [V] correct. `.init_array` (6 entrées, symbolisées) : `ARGV_INIT_ARRAY::init_wrapper` (std), `_GLOBAL__I_000100`,
`frame_dummy`, `_GLOBAL__sub_I_binding.cc` (V8), `mi_process_attach`, `do_library_init` (aws-lc). Aucun `DF_1_NODELETE`, aucun `SONAME`.

**État global mutable** : `RUNTIME`, `CAPTURE_LOCK`, `SOUL` (persona figée au 1er appel), registres jobs/index, 2 `LAST_ERROR` thread-locals distincts (lib.rs:104, index.rs:42), worker embed (processus enfant `aphrody-embed`, embed.rs:33-56), `PIPELINES` globaux (render.rs:85), plateforme V8 (obscura-js/v8_flags.rs). Tous protégés par Mutex/OnceLock/atomics [V].
Mais les commandes hébergées ont des effets globaux : `std::env::set_var` (commands.rs:411, :780, commentaires « short-lived process / single-threaded » **faux** dans un hôte multi-thread), état relatif au cwd (`/var/mirror` → `var/mirror`, `crates/os/base/src/lib.rs:38` : d'où les dossiers vides `crates/interop/ffi/var/mirror` et `packages/interop/native/var/mirror`),
`tokio::signal::ctrl_c` (exec_cmd.rs:442, commands.rs:1944, ai_sync_cmd.rs:117) installant un handler SIGINT process-wide dans Bun [P].

**Capture stdio** (`aphrody_run_captured`, `shenron_*captured`, `rag_*`, `persona_ask`) : `dup2` sur fd 1/2 **pour tout le processus** (stdio-capture lib.rs:20-23,44-70), sérialisé seulement entre appels capturés (`capture_lock`, lib.rs:908-911, tenu pendant tout le `block_on`) :
la sortie d'un Worker Bun, d'un job tokio concurrent (tracing/eprintln) ou d'un `aphrody_run` non capturé est aspirée dans le résultat / perdue pour l'hôte [V mécanisme, P impact] ; une commande qui ne rend pas la main verrouille tous les captures suivants ; si le `dup2` échoue, la commande tourne quand même avec `stdout=""` (« best-effort », `stdio-capture/src/lib.rs:42-44`).

## 3. Versionnage

- Sept entiers indépendants, comparés par **égalité stricte** après `dlopen` (library.ts:357-368, fermeture du handle puis erreur) : aphrody=1 (`lib.rs:86`), web=4 (`web/mod.rs:33`), shenron=1 (**même constante** `ABI_VERSION`, lib.rs:268), manga=1 (littéral, lib.rs:532), bun_rs=1 (littéral, ui/bun lib.rs:33), node2bun=2 (littéral, n2b-native:87), oxc=1 (littéral, oxc-bridge:24).
  Copies : `NATIVE_ABI_VERSIONS` (native-artifact.ts:13-21), manifest.json (`abi`, vérifié par `parseNativeArtifactManifest` :112-114 avant dlopen), en-têtes (`APHRODY_ABI_VERSION 1u` aphrody.h:45 ; N2B 2u / OXC 1u dans aphrody-tooling.h:7-8 ; **web, shenron, manga, bun_rs : aucun `#define`**), docs.
- Seul test source↔en-tête : `header_abi_version_matches` (lib.rs:1013-1031) et **uniquement** pour `APHRODY_ABI_VERSION`. Seul garde-fou des 7 valeurs : le test d'étape `packages/infra/workspace/src/bun-native.ts:98-104` (dlopen de l'artefact construit, comparaison à `NATIVE_ABI_VERSIONS`) — à garder. Aucun test ne compare symboles Rust / en-têtes / SYMBOLS.
- Pas de négociation : ni plage min/max, ni détection de capacités (`aphrody_features`), ni hash de signatures. `dlopen(path, SYMBOLS)` exige **les 110 symboles** : un .so plus ancien échoue sur « symbol not found » (message dlopen) avant d'atteindre le contrôle de version ; un .so plus récent mais « même numéro » charge sans erreur ; une signature modifiée sans bump = UB silencieux (hors manifest).
  Les ajouts de symboles (shenron, manga, ~52 web) n'ont jamais bumpé l'ABI aphrody (=1) : acceptable pour de l'additif mais invisible pour l'hôte. Le build « gpu » (`package.json` script `build`, `--features gpu`) et `native-stealth` changent le comportement sans changer l'ABI (`obscura_fetch(stealth=1)` → erreur à l'exécution si absent, native_http.rs:44-55).
- Slot partagé `globalThis[Symbol.for("aphrody.ffi.library.v1")]` (library.ts:284-290,343) : si `owner === "@aphrody/bun"`, la 2e copie du paquet (autre version, autre `SYMBOLS`) reçoit le handle de la 1re **sans** recontrôler ABI/symboles → `symbols.x` indéfini à l'usage [P].
- **`APHRODY_FFI_DEV=1` protège exactement** (égalité stricte à `"1"`, native-artifact.ts:66-68) : (1) l'ajout de `target/{release,debug}` (et `CARGO_TARGET_DIR`) aux candidats (library.ts:325-330) ; (2) le chargement **sans manifest** donc sans hash/taille/provenance (native-artifact.ts:183-188) ;
  (3) `consumerSmoke: "pending"` accepté (:133) ; (4) la levée de l'exigence « release propre » (profil release, `buildSourceHead` non nul, arbre non sale, head construit = head observé) (:135-142). Il **ne** protège **pas** `APHRODY_FFI_LIB`/`SHENRON_FFI_LIB` (library.ts:293-310 : accepté sans DEV tant qu'un `manifest.json` voisin existe) :
  le manifest est **co-localisé et auto-attesté** (hash calculé par celui qui fournit le .so) → contrôle d'intégrité contre la corruption accidentelle, pas contre un fournisseur hostile. Fenêtre TOCTOU entre `hashNativeArtifact` et `dlopen(path)` (library.ts:350-352, ré-ouverture par chemin). Bun charge `.env` du cwd → `APHRODY_FFI_LIB` pilotable par un dépôt non fiable [P].
- Portabilité du binaire : `readelf -V` → VERNEED `GLIBC_2.38` (symbole fort `__isoc23_sscanf`) et `GLIBC_2.39` (`pidfd_spawnp`/`pidfd_getpid`, faibles mais entrée VERNEED « Flags: none ») ; NEEDED `libstdc++.so.6` + `libgcc_s.so.1` (Bun 1.4.2 : seulement libc/ld/pthread/dl/m). Le manifest ne code que `libc: "gnu"|"musl"` (native-artifact.ts:60-64) → un .so construit sur glibc 2.39 est livré comme « gnu » à
  Debian 12 (2.36) / Ubuntu 22.04 (2.35) / RHEL 9 (2.34) où `dlopen` échouera [P]. Artefact 257 Mo, « not stripped ».

## 4. Erreurs : conventions de retour (cohérence)

| Famille | Succès | Échec | Canal d'erreur |
|---|---|---|---|
| `aphrody_run`, `_json`, `shenron_run*` | code de sortie commande | 64 (usage) / 70 (panique) | `aphrody_last_error()` (thread-local, ptr statique, **jamais effacé**) |
| `*_run_captured`, `shenron_rag_*`, `shenron_auth_status`, `persona_ask` | JSON `{code,stdout,stderr}` | idem dans le JSON ; NULL « jamais » | `last_error` posé **seulement** sur panique (lib.rs:225), pas sur usage (lib.rs:220) |
| `manga_*` | `{code:0,stdout:"<JSON sérialisé>",stderr:""}` (double encodage) | `code` 64/70 + message dans `stderr` | NULL possible (TS : `ownedResult` « returned NULL ») |
| `aphrody_web_*` sync | payload JSON/chaîne | **NULL** (UTF-8 invalide, `extract_title`, `html_to_markdown`) **ou** `{"error":…}` **ou** `"[]"` (liens, cookies, dns avec pointeur nul) | aucun ; panique → NULL silencieux (`guard`) |
| `aphrody_web_*_submit` | id `u64 > 0` | id 0 (panique) ; validation → job résolu `{"error":…}` | résultat de job |
| `aphrody_web_index_*` | 0 / handle>0 | −1 / −2 / 0 / NULL selon la fonction | `aphrody_web_index_last_error()` : **chaîne allouée à libérer**, JSON `{"error":…}` (2e canal) |
| `bun_rs_icon/m3_css/svg/m3_reproduce` | `{ok:true,…}` | `{ok:false,error}` | enveloppe |
| `bun_rs_compile_sass*` | CSS brut | message brut + `*mut bool` | drapeau out |
| `bun_rs_render*_png` | ptr + `*out_len` | NULL, `*out_len=0` | aucun |
| `bun_rs_m3_seed_from_image` | ARGB | **couleur de repli** `0xFF4285F4` | aucun |
| `node2bun_*`, `aphrody_oxc_*` | `{ok:true,…}` | `{ok:false,error}` | enveloppe |

Au moins **huit conventions** dans un seul .so ; côté TS, seule une partie des wrappers contrôle `.error` (cookies, media) — `webObscuraFetch`, `webXUser`, `webDnsRecon`, `webEmbedInfo` renvoient le JSON brut (engine.ts:174-253,452-457).

## 5. Constats numérotés

### F-01 — HAUTE — Panique → abort de l'hôte Bun sur des exports non protégés, contre la garantie documentée
- `crates/ui/bun/src/{lib.rs:281,499,223 ; render.rs:23,122 ; reproduce.rs:63,95 ; svg.rs:244 ; icons_ffi.rs:67,87}` : aucun `catch_unwind`/`guard`. Garantie contraire : `ffi/src/lib.rs:33-34`, `aphrody.h:21-22`, `README.md:20-21`. [V]
- Déclencheurs concrets lus : (a) `bun_rs_m3_reproduce(kind=0)` → `reqwest::blocking::Client::builder().build()` (`m3-reproduce/src/fetch.rs:19-26`) ; reqwest est en `rustls-no-provider` (Cargo.toml:228) et **panique** sans provider (`reqwest-0.13.5/src/async_impl/client.rs:2495-2503`), le thread interne meurt, l'appelant exécute `event_loop_panicked()` (`blocking/client.rs:1479,1576`) → abort. Aucun `install_default` dans `bun_rs`/`m3-reproduce` (seulement `ffi/web/media.rs:31`, `run_async` lib.rs:2309, obscura-net, x client) : dépend de l'ordre des appels dans le processus [P] ;
  (b) `bun_rs_compile_sass*` : `CString::new(css).unwrap()` / `CString::new(format!("Sass error: {e}")).unwrap()` **hors** `catch_unwind` (lib.rs:371,380 et 468,477 ; les `unwrap` de messages statiques :321,335,419,433,501 sont sûrs) → panique si NUL dans le CSS ou dans le message d'erreur grass [P] ; (c) `bun_rs_derive_scheme` : `Role::from_name(name).expect(...)` (lib.rs:213) ; (d) `bun_rs_render_png` : `Canvas::new(width,height)` = `vec![0; w*h*4]` sans plafond, w/h issus du JSON (raster.rs:31,99) → OOM = abort [V] ; (e) `shenron_persona_prompt` (lib.rs:468-474).
- Reco : macro unique `ffi_guard!` (catch_unwind + `last_error`) appliquée à **tous** les exports, `ensure_rustls_provider()` idempotent appelé dans chaque chemin réseau (bun_rs, gemini), plafonds de dimensions, test « panic injectée ».

### F-02 — MOYENNE — Fuite non bornée du registre de jobs et du suivi TS
- `jobs.rs:35,59-69,84-120,152-176` ; `engine.ts:47,70-75,378,386,391-410`. Un résultat terminé reste en mémoire (jusqu'à 64 Mo par job embed, embed.rs:22) tant que `take`/`cancel` n'a pas été appelé ; aucun plafond de jobs, aucun TTL, aucun `FinalizationRegistry` ; `timeout_ms=0` = pas de délai ; en plus `close()` (engine.ts:818-825) refuse définitivement si un id fuit. [V]
- Reco : TTL/plafond côté Rust (+ code d'erreur « registre plein »), `FinalizationRegistry` → `cancel`, valider `timeoutMs > 0` côté TS.

### F-03 — MOYENNE — Dérive de contrat : en-têtes incomplets, versions non couvertes, aucun test de dérive
- 32 symboles exportés absents de tout en-tête (§1) ; `web/shenron/manga/bun_rs` sans `#define` de version ; un seul test source↔en-tête (lib.rs:1013) ; table TS écrite à la main (library.ts:22-280). Les 7 exports `web_internal_*` sont annoncés « legacy retained for existing clients » (extract.rs:211-213) alors que 40+ autres noms `web_internal_*` ne sont **pas** exportés ; aucun consommateur. [V]
- Reco : source unique (JSON de symboles ou cbindgen) → génère en-tête + `SYMBOLS` + test ; ajouter `bun_rs_*`, `manga_scanlate_*` ; retirer ou déclarer `web_internal_*` ; exécuter mon `threeway.py` comme garde CI.

### F-04 — MOYENNE — Capture stdio globale au processus et verrou tenu pendant toute la commande
- `lib.rs:908-911,217-218` ; `stdio-capture/src/lib.rs:20-23,44-70`. Cf. §2. [V mécanisme / P impact]
- Reco : documenter le contrat « un seul appel capturé à la fois, hôte muet » ou exécuter les commandes capturées dans un sous-processus ; ne jamais exposer de commande longue (serve/daemon) via `*_captured`.

### F-05 — MOYENNE — Handle DOM = pointeur brut, sans registre (contraste avec l'index)
- `dom.rs:55-75`, `web/mod.rs:86-102`, `engine.ts:124-171`. Double destroy / destroy concurrent = UAF ; le contrat « exact live pointer… once » repose sur l'hôte. L'index (index.rs:22-40) montre le bon modèle. [V]
- Reco : registre `u64` + `Arc` comme pour l'index ; constructeur TS privé.

### F-06 — MOYENNE — Intégrité du chargeur : manifest co-localisé auto-attesté ; `APHRODY_FFI_DEV` n'est pas une frontière de sécurité
- `library.ts:293-310,343,349-352` ; `native-artifact.ts:66-68,133,135-142,178-201`. Détails §3. [V code / P exploitation]
- Reco : ancrer le hash dans le paquet (pas à côté du .so), ignorer `APHRODY_FFI_LIB` hors DEV ou exiger un chemin allow-listé, ouvrir par fd (`/proc/self/fd`) après hash, versionner le slot global (version + liste de symboles).

### F-07 — MOYENNE — Plancher glibc 2.39 non exprimé dans le manifest ; dépendance libstdc++ dynamique
- `readelf -V` / `objdump -T` (§3) ; `native-artifact.ts:60-64`. [V artefact / P effet]
- Reco : construire sur une base glibc ancienne ou muslc, ajouter `glibcMin` au manifest et le comparer à `process.report.header.glibcVersionRuntime`.

### F-08 — MOYENNE — Buffers de sortie à taille implicite, sans capacité
- `ui/bun/src/lib.rs:134-151` (`bun_rs_hct_tones` : 13 u32), `:222-235` (`bun_rs_derive_scheme` : 49 u32, table `DERIVE_SCHEME_ROLES` :155-205, commentaire pointant l'ancien `packages/bun/src/index.ts`) ; TS `index.ts:107-110,114-117` (constantes 13 / 49 dupliquées). Toute évolution d'un côté = écriture hors bornes dans la mémoire de Bun (contraste : `find_newlines_u16` a `out_cap`). [V]
- Reco : ajouter `out_cap` et retourner le nombre requis.

### F-09 — MOYENNE — Huit conventions d'erreur, `last_error` jamais effacé, deux canaux
- Table §4 ; `lib.rs:104-117,254-259,220` ; `index.rs:65-76` ; `engine.ts:773-778,803` (une erreur périmée peut être rapportée pour un NULL sans lien). [V]
- Reco : enveloppe unique `{ok,code,error}`, `aphrody_last_error_clear()`, `index_last_error` aligné sur `aphrody_last_error`.

### F-10 — MOYENNE — Effets de bord globaux des commandes hébergées
- `apps/cli/src/commands.rs:411,780` (`set_var`), `crates/os/base/src/lib.rs:38` (état relatif au cwd), `exec_cmd.rs:442`/`commands.rs:1944`/`ai_sync_cmd.rs:117` (ctrl_c). `run_async` expose **toute** la CLI (lib.rs:2301-2310) à l'hôte. [V code / P impact]
- Reco : interdire ces commandes en mode FFI (liste blanche) ou les rendre sans effet global.

### F-11 — MOYENNE — Export de cookies Chromium déchiffrés par l'ABI générale
- `web/cookies.rs:7-57`, `web/mod.rs:196-206`, `web-chromium/src/lib.rs:174-218` (`value` en clair, `host_key` = sous-chaîne : `""` renvoie tout, HttpOnly inclus). Secrets d'entrée (`auth_token`, `ct0`) copiés en `String` non zéroïsés (net.rs:163-168). La règle du dépôt dit que les secrets restent dans leurs magasins protégés. [V]
- Reco : flag de build/permission explicite, filtre d'hôte non vide, zéroïsation.

### F-12 — MOYENNE — Index : `rebuild_if_corrupt` figé à 1 côté TS, remplacement sans sauvegarde
- `engine.ts:277` ; `index.rs:101-112` ; `ffi_api.rs:create` (« atomically replaced on the next save »). Un faux positif « corrupt » (version, fichier tronqué) efface l'index au prochain `save()`. [V]
- Reco : paramètre exposé, copie `.corrupt` avant remplacement.

### F-13 — BASSE — Injection d'argument (positionnel sans `--`)
- `lib.rs:388-396,512` ; `shenron_cmd.rs:76-80,181-184` : une question/requête commençant par `-` est lue comme option clap (`--help`, `--json`, `-x`). Pas d'escalade (flags sans effet fichier), mais comportement faux. [V]

### F-14 — BASSE — Dépendances d'ordre d'initialisation TLS, transport média sans garde SSRF, binaire par PATH
- Gemini (`net.rs:93-125`, `gemini-web/src/transport.rs:55-60` « the provider must already be installed ») : premier appel du processus → panique rattrapée → `NULL`/« native job panicked » [P]. `media.rs:25-39` : `reqwest` sans garde SSRF alors qu'`obscura-net` a `SsrfGuardResolver` (`obscura-net/src/lib.rs:20-23`) ; `bun_rs_m3_reproduce` idem. `embed.rs:38-42` : binaire `aphrody-embed` résolu par PATH / `APHRODY_WEB_EMBED_BIN`. [P]

### F-15 — BASSE — Tests, scripts et docs obsolètes
- `test-native-artifact.test.ts:133` : `import("./src" + name + ".ts")` (**slash manquant**, cf. `test-library.test.ts:17` correct) → le test « imports every public entry » ne peut pas passer ; `test-cli-only.ts:4` : variable morte `APHRODY_BUN_FFI_LIB` ; `scripts/smoke-bxc-ffi.ts:5-11` : symbole/ABI inexistants ; `docs/reference/infra/APHRODY-BUN-PLATFORM.md:19,57-58` et `docs/reference/upstream-bun/APHRODY-FORK.md:11` décrivent encore des bibliothèques séparées / `N2B_NATIVE_LIB`, `APHRODY_OXC_LIB` ; `docs/products/ai/crates/aphrody-ffi/README.md` en retard sur `crates/interop/ffi/README.md`. [V]

### F-16 — BASSE/[P] — `close()` = `dlclose` d'une cdylib à runtime/threads/TLS
- `engine.ts:818-825`, `library.ts:381-384`, test de rechargement `test-library.test.ts:44-70` (avant toute utilisation du runtime). Threads tokio non joints, destructeur de clé pthread mimalloc dans l'objet, aucun `NODELETE` ; en pratique glibc diffère le déchargement tant que des destructeurs TLS (`__cxa_thread_atexit_impl`, symbole faible présent) sont en attente → le « reload » peut renvoyer le même mapping avec état conservé. À ne pas supposer sûr.

## 6. Correct et à garder

1. Jeu de symboles Rust = `nm` = table TS, 0 divergence d'arité/type ; noms `aphrody_web_media_*` et `aphrody_web_x_algorithm_rank` **inchangés** après fusions.
2. `catch_unwind` + codes 64/70 sur la famille run/shenron/manga ; `guard` généralisé côté web ; oxc/n2b encapsulés.
3. Modèle de handles de l'index (registre, `Arc`, −2) ; ids de jobs monotones, `take` atomique ; `*_submit` copient leurs entrées.
4. TS : `cstr()` rejette les NUL (engine.ts:39-42) ; `free` unique en `finally` ; copie avant `render_free` ; chargement paresseux ; manifest + hash **avant** `dlopen` ; `loaded.close()` sur mismatch d'ABI ; garde `close()` contre ressources vivantes.
5. `mimalloc` `local_dynamic_tls` effectif (0 TPOFF, pas de STATIC_TLS) ; symboles libv8 C++ non exportés ; 0 collision avec Bun 1.4.2.
6. `run_async` : `try_parse_from` (clap ne quitte pas), provider rustls installé, aucun `process::exit` hors `main.rs` dans `apps/cli` ni dans les crates atteignables (grep).
7. Test d'étape `bun-native.ts` comparant les 7 ABI sur l'artefact réel.

## 7. Écart à la grille

`ffi-architect.md` (zéro-allocation côté natif, mémoire allouée en JS, types primitifs) vs implémentation : la quasi-totalité des retours sont des JSON/chaînes **allouées par Rust** avec `*_free` associé (8 destructeurs) ; seuls `find_newlines_u16`, `bun_rs_hct_*`, `bun_rs_derive_scheme`, `bun_rs_argb_to_hct` suivent le modèle « tampon fourni par l'appelant ». Pas un défaut en soi (APIs JSON), mais la classe « fuite / mauvais free » n'existe que par ce choix ; des variantes `_into(buf,cap)` la supprimeraient pour les chemins chauds.
`rust-best-practices-2026` : `unsafe_op_in_unsafe_fn = "deny"` actif (Cargo.toml:481), `#[unsafe(no_mangle)]` partout, pas de `static mut` ; manque `clippy::undocumented_unsafe_blocks` au niveau workspace (présent seulement dans `bun_rs`).

## 8. Recommandations priorisées

1. **Confinement des paniques** (F-01) : `ffi_guard!` sur 100 % des exports + `ensure_rustls_provider()` + plafonds de taille ; test d'injection de panique par symbole.
2. **Source unique d'ABI** (F-03) : un manifeste de symboles génère en-tête(s), `SYMBOLS`, test de dérive (reprendre `threeway.py`) ; version-script/`--exclude-libs` pour n'exporter que les 117 symboles documentés (masque les 347 tiers) ; `#define` des 7 versions + capacités.
3. **Handles et ressources bornés** (F-02, F-05, F-08, F-12) : TTL/plafond des jobs, DOM en registre, `out_cap` explicite, sauvegarde avant rebuild d'index.
4. **Chaîne d'intégrité du chargeur** (F-06, F-07, F-16) : hash ancré hors du dossier du .so, ouverture par fd, slot versionné, plancher glibc dans le manifest, `-Wl,-z,nodelete` ou `close()` documenté comme no-op.
5. **Erreurs et effets globaux** (F-04, F-09, F-10, F-13) : enveloppe d'erreur unique + effacement de `last_error`, capture stdio non globale (ou contrat « un appel, hôte muet »), liste blanche des commandes hébergées, `--` avant le texte utilisateur.

## 9. NON EXAMINÉ

- Aucune exécution : pas de dlopen réel, pas de test de panique/abort, pas de compilation de `aphrody.h` (C17/C23/C++17 `-Werror` annoncé par le README), pas de mesure de latence/mémoire de dlopen (257 Mo, 230 443 relocations RELATIVE).
- Le builtin `bun:aphrody` du fork (`upstream/bun`) et sa table de symboles ; `docs/migration/BUN-FORK-UNIFIED-NATIVE.md`.
- Interaction V8 embarqué (obscura-js) ↔ JSC/Bun : handlers de signaux (trap handler wasm : symbole faible `TrapHandlerGuard::is_active_` présent), threads, isolates multiples.
- Corps de `aphrody::run_async`/`dispatch` au-delà du point d'entrée ; chaque sous-commande réellement exposée ; `aphrody-manga`/koharu (feature `koharu` non construite dans l'artefact), pipeline GPU (`--features gpu`, wgpu sous WSL2/Wayland/X11).
- Index HNSW interne (`Index::add` valide-t-il `dim` ? mmap/SIGBUS si le fichier est tronqué par un tiers) ; sémantique de `strip_tags`/`extract_title` (heuristiques naïves vs DOM, non ABI).
- Windows (SetStdHandle, `aphrody_ffi.dll`) et macOS (`dylib`, TLS) : lu seulement dans le code, aucune vérification d'artefact.
- Reproduction effective de F-01(a) : dépend de la résolution de features (aws-lc est lié : `do_library_init`/`tree_jitter_*` dans `.init_array`/symtab) et de l'ordre d'appel.
- `packages/infra/workspace/src/bun-native.ts` au-delà des lignes 90-125 ; génération des manifests.
