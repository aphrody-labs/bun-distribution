# Audit bas niveau — axe ARTEFACT (libaphrody_ffi.so : construction, déploiement, durcissement)

Date : 2026-10-01. Niveau de preuve global : P1 (statique). Lecture seule, aucun cargo/rustc/bun exécuté.
Légende : [V] vérifié dans le fichier ou l'artefact (sortie d'outil citée) ; [P] plausible / non reproduit.
Grille : agents security-engineer / performance-engineer / deployment-engineer / cargo-auditor, skills deploy /
rust-best-practices-2026 / best-stack-2026 (config/ai/plugins/aphrody/...).

## 0. Périmètre réellement lu

Artefact : /home/aphro/aphrody/target/release/libaphrody_ffi.so — 257 004 880 octets, `file` : ELF64 x86-64 DYN,
« not stripped », BuildID 5d6ee692…, sha256 `09ccea30fbc61e56d2f49864060e1cc9f813aeaf753ca7d81690d871edfaae7b`
(sha256sum : 0,157 s, cache chaud). Outils : readelf (-d -lW -SW -V -rW -n -p .comment), nm -D / nm -C -S, objdump -T,
ldd, file, strings ciblé (comptages par motif, pas de dump), python3 (analyse de sections, entropie par bloc de 1 Mo,
signatures PNG/ICU), lecture de target/release/.fingerprint/aphrody-ffi-*/lib-aphrody_ffi.json.

Sources lues : Cargo.toml racine (grep `profile` : AUCUN `[profile.*]`), crates/interop/ffi/Cargo.toml (1-81),
crates/interop/ffi/src/lib.rs (1-80, 888-912), src/web/ffi_util.rs, apps/cli/build.rs, ~/.cargo/config.toml,
rust-toolchain.toml, crates/os/drive/Cargo.toml:103-146 (profil comparatif), upstream/simdutf-rio/Cargo.toml:69,
scripts/build-aphrody-stack-release.sh (1-240), scripts/atomic-deploy-aphrody-stack.sh (1-359),
scripts/smoke-bxc-systemd.sh (1-37), scripts/smoke-bxc-ffi.ts (1-15), systemd/*.service(.example) (matrice complète des
directives), config/systemd/user/*.service|timer, artifacts/live-audit/aphrody-web-api.service,
docs/operations/infra/IMMUTABLE-RELEASES.md (extraits 1-15, 74-145, 255-275), docs/migration/BUN-NATIVE-PACKAGE.md (1-40),
BUN-NATIVE-BUILDER.md (1-75), packages/interop/native/src/library.ts (1-397), src/native-artifact.ts (1-201),
test-native-artifact.test.ts (1-215), packages/infra/workspace/src/bun-native.ts (1-384),
crates/os/systemd/src/{lib,unit,manager}.rs, crates/web/web-bridge/src/resolve.rs (1-520),
py/aphrody-train/src/aphrody_train/shenron_ffi.py (1-80), registre ~/.cargo/registry/src/*/v8-150.4.0/build.rs,
image-0.25.10/Cargo.toml.

## 1. Anatomie de l'artefact

### 1.1 Dynamique, durcissement (readelf)

| Élément | Valeur observée | Verdict |
|---|---|---|
| NEEDED | libstdc++.so.6, libc.so.6, ld-linux-x86-64.so.2, libgcc_s.so.1, libm.so.6 | libstdc++ n'est requis que pour 2 symboles (`std::__throw_logic_error`, `std::__cxx11::basic_string::_M_create`) [V objdump -T] |
| RPATH / RUNPATH / SONAME | aucun / aucun / **aucun** | pas de détournement par rpath [V] ; pas de SONAME : deux chemins distincts = deux chargements (état V8/tokio dupliqué) [P] |
| RELRO / BIND_NOW | GNU_RELRO (0x394f90) + FLAGS BIND_NOW + FLAGS_1 NOW | RELRO complet [V] |
| GNU_STACK | `RW` (flags sans E) | pile non exécutable [V] |
| Segments LOAD | R / RX (0x6a48670 = 111 Mo) / RW / RW ; aucun RWX | W^X au niveau ELF respecté [V] |
| DT_TEXTREL | absent | [V] |
| DT_FLAGS STATIC_TLS | absent ; PT_TLS memsz 0x710 (1 808 o), filesz 0x178 ; relocs TLS = 32 × R_X86_64_DTPMOD64 (general-dynamic) ; 0 × TPOFF | TLS sûr pour dlopen : pas d'initial-exec (cohérent avec Cargo.toml:64-65 `mimalloc local_dynamic_tls`) [V] |
| CET (IBT/SHSTK) | aucune section `.note.gnu.property` ; `_init` contient `endbr64` (crt GCC) | binaire non marqué CET : le process perd le shadow stack si activé (glibc.cpu.x86_shstk) [V pour l'absence de note, P pour l'effet] |
| SSP / FORTIFY | `__stack_chk_fail`, `__memcpy_chk`, `__fprintf_chk`… importés | seulement le code C/C++ (V8, deps C) ; Rust sans SSP [V] |
| Débogage | aucune section `.debug_*` ; `.symtab` 9,18 Mo (381 675 symboles) + `.strtab` 42,97 Mo conservés | « not stripped » : 52,2 Mo de noms Rust/C++ [V] |
| .comment | LLD 22.1.8, rustc 1.98.1 (48a229cea 2026-09-01), GCC 13.3.0 Ubuntu 24.04, clang 22.1.0-rc2 | toolchain du build non épinglé côté C (GCC hôte) [V] |

### 1.2 Versions de symboles (plancher glibc)

`readelf -V` : libc.so.6 requiert jusqu'à GLIBC_2.39 ; libm GLIBC_2.35 ; libstdc++ GLIBCXX_3.4.21 ; libgcc_s GCC_4.2.0.
Tous les `Flags: none` (aucun VER_FLG_WEAK).
- `__isoc23_sscanf@GLIBC_2.38` : référence **forte** (`U`) [V nm -D --undefined-only].
- `pidfd_spawnp@GLIBC_2.39`, `pidfd_getpid@GLIBC_2.39` : références faibles (`w`) mais l'entrée verneed GLIBC_2.39
  n'est pas marquée faible [V] ; le chargeur glibc refuse une version verneed absente même si les symboles sont faibles [P,
  connaissance glibc]. Plancher effectif : **glibc ≥ 2.39** (Ubuntu 24.04 ; la machine auditée est 2.39-0ubuntu8.9).
  Incompatible Ubuntu 22.04 (2.35), Debian 12 (2.36), RHEL/Alma 9 (2.34) [P].
- Imports sensibles : `dlopen/dlsym`, `fork`, `execvp`, `posix_spawnp`, `pidfd_spawnp`, `chroot`, `setuid`, `memfd_create`,
  `mprotect`, `mmap`, `prctl`, `syscall`, `shm_open`, `openpty` [V] → `~@privileged` et NoNewPrivileges sont utiles.

### 1.3 Symboles exportés (`nm -D --defined-only`) : 464

| Famille | Nb | Part |
|---|---|---|
| `aphrody_*` (contrat, en-tête aphrody.h) | 64 | 13,8 % |
| autres familles du contrat chargeur (`bun_rs_` 22, `node2bun_` 4, `manga_` 8, `shenron_` 11, `find_newlines_u16` 1) + `web_internal_*` 7 (anciens noms, net_aliases.rs:1-2) | 53 | 11,4 % |
| **`temporal_*` (temporal_rs C API tirée par V8)** | **302** | **65,1 %** |
| `v8__*`, `v8_inspector__*`, `crdtp__*`, `rusty_v8_*` (callbacks `#[no_mangle]` du crate `v8`) | 36 | 7,8 % |
| `diplomat_*` | 9 | 1,9 % |

Soit **347 / 464 = 74,8 %** de symboles qui ne font pas partie du contrat. Aucun `.map`, `.ld`, `build.rs` ni
`rustc-cdylib-link-arg` dans crates/interop/ffi/ (ls + grep) : aucune version script. Pas de symbole `mi_*` ni `malloc`
exporté (bon : mimalloc n'interpose pas la libc) [V].

### 1.4 Constructeurs / destructeurs

`.init_array` (6 entrées, résolues via R_X86_64_RELATIVE) : `std::sys::args::unix::imp::ARGV_INIT_ARRAY::init_wrapper`,
« global constructors keyed to 000100 », `frame_dummy`, `_GLOBAL__sub_I_binding.cc` (V8/rusty_v8), `mi_process_attach`
(mimalloc), `do_library_init` (profil aws-lc [P]). `.fini_array` (4) : `__do_global_dtors_aux`, `mi_process_detach`,
`rand_thread_local_state_clear_all`, `tree_jitter_free_global_drbg` (aws-lc [P]). Tout s'exécute au `dlopen`, donc AVANT
le contrôle ABI de library.ts:357-368.

### 1.5 Sections (readelf -SW)

| Section | Taille | Part de 257 Mo |
|---|---|---|
| .text | 111,44 Mo | 43,4 % |
| .rodata | 64,28 Mo | 25,0 % |
| .strtab | 42,97 Mo | 16,7 % |
| .eh_frame | 11,47 Mo | 4,5 % |
| .symtab | 9,18 Mo | 3,6 % |
| .gcc_except_table | 5,97 Mo | 2,3 % |
| .rela.dyn | 5,54 Mo (230 443 R_X86_64_RELATIVE) | 2,2 % |
| .data.rel.ro | 3,60 Mo | 1,4 % |
| .eh_frame_hdr | 1,68 Mo | 0,7 % |

Relocations : 230 443 RELATIVE + 261 GLOB_DAT + 519 JUMP_SLOT + 32 DTPMOD64 + 23 R_X86_64_64 ; ≈ 814 symboles non définis.

### 1.6 Chemins absolus et secrets embarqués

`strings -a -n 8` : 2 733 occurrences de `/home/aphro` (2 214 `.cargo/registry/src/...`, 453 `.cargo/git/checkouts/oxc-…/31d5266`,
63 `.rustup/toolchains/1.98.1-.../lib/rustlib/src/rust/library/`), 84 `/rustc/<hash>/`, 1 `/checkout/` (chemin de build LLD),
`/tmp/aphrody-os-`, `/tmp/__v8_gc__`. Motifs de secrets (AIza, ghp_, github_pat_, sk-, xox*, AKIA, postgres://user:pass@,
Bearer) : 0 occurrence. Seule détection : 8 occurrences du jeton « bearer public du client web X » =
crates/web/x/src/client.rs:56 `WEB_BEARER` (constante publique connue, pas un secret de l'organisation) [V].

## 2. Pourquoi 257 Mo (estimation, mesures marquées)

Mesures : somme des symboles de .text = 111,3 Mo ; partition de .rodata par entropie (blocs de 1 Mo) + signatures + analyse
des « trous » entre symboles. Les parts de .text par famille sont des **sommes de tailles de symboles par préfixe C++/Rust**
(approximatives, la monomorphisation attribue beaucoup à `core/alloc/serde_json/hashbrown`).

### 2.1 .text 111,4 Mo (43 %)

| Famille | Mo | Source |
|---|---|---|
| V8 + libc++ hermétique + ICU + absl (C++) | ≈ 27,1 | `v8::` 19,8 Mo ; `Builtins_*` 2,16 ; libc++ `__Cr` 3,4 ; icu_77 1,5 [V] — prébuilt `librusty_v8.a` 186 Mo (target/release/gn_out/obj/) |
| génériques `core/alloc/std/serde/hashbrown` | ≈ 24,6 | monomorphisation, toutes crates confondues |
| first-party `aphrody_*` | ≈ 10,4 | CLI complet (`aphrody::Commands::augment_subcommands` 0,14 Mo, aphrody_ssh, app_server…) |
| oxc_* (linter, react_compiler 1,2, formatter, minifier…) | ≈ 7,1 | contrat `aphrody_oxc_*` |
| codecs image : rav1e (AV1) 1,9 + exr 0,9 + tiff + webp + zune-jpeg + png | ≈ 5,6 | voir coupe n°4 |
| obscura/deno_core/taffy | ≈ 5,3 | |
| pile réseau (tokio, hyper, h2, reqwest, rustls, ring) | ≈ 4,8 | |
| ssh/git/GitHub/dbus (russh, gix, octocrab, zbus/zvariant) | ≈ 2,8 | |
| wgpu/naga/vello (feature `gpu`) | ≈ 2,1 | |
| sqlite (bundled) 1,0 ; simdutf 0,9 | ≈ 1,9 | |

### 2.2 .rodata 64,3 Mo (25 %) — la moitié est de la donnée embarquée, mesurée

| Contenu | Mo | Preuve |
|---|---|---|
| Material Symbols WOFF2 (rounded 5,31 + outlined 3,93 + sharp 3,48) | 12,72 | crates/ui/bun/src/icons/mod.rs:26-33 `include_bytes!` ; blocs rodata+49..58 Mo à entropie 1,0 [V] |
| Noto Color Emoji | 10,67 | obscura-render/src/inline.rs:56 ; 3 985 PNG 136×128 = 10,54 Mo dans rodata+16..26 Mo [V] |
| ICU `icudt77_dat` (V8) | 10,82 | symbole sans taille, écart jusqu'au symbole suivant [V] |
| Google Sans Flex variable | 4,15 | ui/render/src/text.rs:19 et m3-tokens/google_sans_flex.rs:148 (présent 1 fois : fusionné) [V] |
| DejaVu/Liberation (obscura-render/assets) | ≈ 4 | `dejavu-sans.ttf` présent 2 fois [V] |
| Material Icons ×5 (regular/outlined/round/sharp/two-tone) | ≈ 2,1 | icons/mod.rs:36-51, présence non mesurée [P] |
| V8 snapshot `v8::internal::blob_data` 0,42 + embedded blob data 0,10 | 0,5 | [V] |

Total identifié ≈ 45 Mo ; reste ≈ 19 Mo : chaînes, tables Unicode/psl/encoding_rs, bootstrap JS obscura (0,73 Mo).

### 2.3 Hors code : 52,2 Mo (.symtab+.strtab) + 19,1 Mo d'unwind (.eh_frame + hdr + gcc_except_table) + 5,5 Mo de .rela.dyn

L'unwind (7,4 %) n'est pas supprimable : `panic = "unwind"` est requis par les `catch_unwind` de l'ABI (§3).

### 2.4 Coupes proposées (sans casser les contrats)

| # | Coupe | Gain estimé | Contrat |
|---|---|---|---|
| 1 | Retirer `.symtab`/`.strtab` : `-Wl,--strip-all` via `cargo:rustc-cdylib-link-arg` dans un `build.rs` de crates/interop/ffi, ou `[profile.release.package.aphrody-ffi] strip = "symbols"` ; conserver la copie non strippée + BuildID dans le dépôt de symboles | −52,2 Mo (→ ≈ 205 Mo) [V pour la taille des sections ; .dynsym/.dynstr intacts] | aucun (exports dans .dynsym) |
| 2 | DT_RELR : `-Wl,-z,pack-relative-relocs` | ≈ −5 Mo sur .rela.dyn, moins de pages RW touchées au dlopen [P] | glibc ≥ 2.36 requise ; plancher déjà 2.39 |
| 3 | Externaliser Material Symbols (12,7), Noto Color Emoji (10,7), Google Sans Flex (4,2) : fichiers de données à côté du .so, hachés dans manifest.json, chargés à la demande ; ou features Cargo (obscura-render charge déjà l'emoji à la demande : `text_may_need_emoji_font`, lib.rs:147) | −27,5 Mo | `bun_rs_icon_*`/`bun_rs_m3_css` : mêmes signatures, chargement différé |
| 4 | `image = "0.25.10"` (Cargo.toml:188) garde ses features par défaut (`default-formats` = avif, exr, tiff, hdr, qoi, dds…) car les membres héritent via `workspace = true` ; aucun usage AVIF/EXR dans les crates du graphe ffi (grep) → `default-features = false` à la racine + formats déclarés par crate | ≈ −4 à −5 Mo de .text (rav1e, exr, tiff, ravif) [P] | aucun si les formats utilisés sont listés |
| 5 | 26 crates présentes en 2 à 4 versions dans le binaire (hashbrown ×4, phf ×3, skrifa/read-fonts ×2, fontdb ×2, rand, aes/cipher, curve25519-dalek 4.1.3+5.0.0…) : aligner | quelques Mo [P] | |
| 6 | `opt-level = "s"`/LTO : le profil de crates/os/drive/Cargo.toml:141-146 (opt-level s, lto, cgu 1) montre la voie ; à mesurer, ne pas promettre | −10 à −20 % de .text [P] | |
| 7 | ICU 10,8 Mo : seulement via build V8 depuis les sources (`V8_FROM_SOURCE`, ICU externe/réduit) | −10 Mo, coût élevé [P] | |

Cible réaliste sans changer de V8 : 257 → ≈ 170 Mo (coupes 1+2+3+4). Un découpage en deux cdylib est exclu : la
doctrine du dépôt est « artefact unique » (lib.rs:56-69, README).

## 3. Profil de build

- **Il n'y a pas de `[profile.*]` dans le Cargo.toml racine** (grep `profile` : 0 ; vérifié aussi dans `git show HEAD:Cargo.toml`).
  Le seul `[profile.release]` du dépôt (hors upstream) est dans crates/os/drive/Cargo.toml:141-146 (`codegen-units = 1`,
  `lto = true`, `opt-level = "s"`, `panic = "unwind"` avec le commentaire « we need unwind to avoid unexpected crashes on third
  party crates », `strip = true`) — crate exclue du workspace (Cargo.toml:5-9), donc inopérant pour le .so. upstream/simdutf-rio :
  `lto = "fat"` seul.
- Le .so est donc compilé avec les **défauts Cargo release** : opt-level 3, lto false (thin-local seulement), codegen-units 16,
  strip « debuginfo » (aucun .debug_*, mais .symtab conservé), debug false, overflow-checks off, **panic = unwind (par défaut
  implicite)**. Fingerprint : `features ["default","gpu"]`, `rustflags []`, profil release [V].
- `panic = unwind` est **cohérent** avec le FFI : lib.rs:33-35 documente « every entry point catches Rust panics
  (catch_unwind) » ; 16 appels `catch_unwind(` dans lib.rs + helper `guard` (web/ffi_util.rs:8-10) ; 68 occurrences de
  `guard(`/`ffi_util::` dans web/*.rs. Avec
  `panic = "abort"`, ces gardes deviendraient inopérants et toute panique tuerait le processus hôte Bun. Le risque est la
  **dépendance à un défaut non épinglé** : un `[profile.release] panic = "abort"` ajouté pour gagner de la taille casserait
  silencieusement le contrat de robustesse. Aucun test n'asserte la stratégie (non vérifié par ELF : présence de
  `_Unwind_RaiseException` dans les imports [V] = unwind actif aujourd'hui).
  Précision : 16 appels `catch_unwind(` dans lib.rs (l.154…837), pas 18.
- Reproductibilité [V] : (a) aucune `--remap-path-prefix` (rustflags vides), 2 733 chemins `/home/aphro` + 84 `/rustc/` dans le
  binaire ; (b) apps/cli/build.rs:22-25 écrit `APHRODY_BUILD_UNIX = SystemTime::now()` (pas de SOURCE_DATE_EPOCH) et le sha git
  sans marqueur « dirty » (build.rs:14-19) ; (c) la config de build (sccache, jobs) vit dans ~/.cargo/config.toml, hors dépôt ;
  (d) le builder passe seulement `--release --locked -p aphrody-ffi --lib` (bun-native.ts:203,249,253) ; (e) les C-deps sont compilées avec le
  GCC 13.3 de l'hôte ; (f) le prébuilt V8 `librusty_v8_simdutf_release_x86_64-unknown-linux-gnu.a.gz` est téléchargé depuis GitHub
  (v8-150.4.0/build.rs:704-770, 871-879) et le « checksum » `librusty_v8.sum` ne contient que l'URL (build.rs:769,862) : aucune
  empreinte cryptographique (aucun RUSTY_V8_ARCHIVE/MIRROR dans le dépôt). Toolchain Rust épinglé (rust-toolchain.toml 1.98.1) :
  point positif.
- Comparaison : le profil du dépôt qui fait LTO/strip/size est celui de crates/os/drive ; le crate qui produit 257 Mo n'en a aucun.
  Le nom de profil `release` est un contrat (native-artifact.ts:31,94 `profile: "debug"|"release"`, library.ts:326 cherche
  `target/<triple>/release`) : ne pas créer de profil nommé autrement ; utiliser `[profile.release]` racine, un
  `[profile.release.package.aphrody-ffi]`, ou un `build.rs` d'arguments de lien.

## 4. Déploiement et unités systemd

### 4.1 Le pipeline n'est pas celui de cet artefact [V]

- scripts/build-aphrody-stack-release.sh construit `libaphrody_web_ffi.so` et `libbxc_render.so` depuis des sous-modules
  (`$super/aphrody-web`, `aphrody-ai`, … l.72, 99-117) ; garde-fous l.46-47 : `[[ "$infra_repo" = "$super/aphrody-infra" ]]` et
  `.gitmodules` requis — ce dépôt n'a ni `.gitmodules` ni ces répertoires (ls) : le script **ne peut pas s'exécuter ici**.
- atomic-deploy-aphrody-stack.sh:74 exige `lib/{libaphrody_web_ffi.so,libbxc_render.so}` ; aucune mention de `libaphrody_ffi`.
- smoke-bxc-ffi.ts:7,11 attend `bxc_bridge_abi_version == 3` (symbole absent de notre .so, qui exporte
  `aphrody_web_bridge_abi_version == 4`, native-artifact.ts:15) ; smoke-bxc-systemd.sh charge `libaphrody_web_ffi.so` (l.16, 18).
- Toutes les unités `systemd/aphrody-*.service.example` portent « Retired 2026-09-25 » (l.2). Grep de `libaphrody_ffi|APHRODY_FFI_LIB|
  APHRODY_FFI_DEV` hors docs/tests : aucune unité, aucun script de déploiement, aucun config/ ; seuls les consommateurs UI
  (@aphrody/m3*, canvas…) et le builder importent @aphrody/bun. Aujourd'hui l'artefact n'est utilisé qu'en dev
  (`APHRODY_FFI_DEV=1` + target/release) : pas de manifest.json à côté (ls), pas de `packages/interop/native/native/`.
- L'arbre est sale (git status : Cargo.lock, nombreux M) : un manifest « release propre » est impossible
  (native-artifact.ts:135-142 exige `buildSourceHead === observedSourceHead` et arbre propre). Le hash documenté
  (BUN-NATIVE-PACKAGE.md:30 `bed77451…`) n'est plus celui de l'artefact courant (`09ccea30…`).

### 4.2 Directives de durcissement (matrice sur 37 unités ; extrait pertinent)

| Unité | NoNewPriv | ProtectSystem | ProtectHome | PrivateTmp | RestrictAF | CapBound | SyscallFilter | MDWE | MemoryMax | User |
|---|---|---|---|---|---|---|---|---|---|---|
| aphrody-web-api (.example:24-28, live-audit identique) | oui | strict | true | oui | — | — | — | — | — | ubuntu |
| aphrody-a2a / site / site-immutable | oui | strict | read-only | oui | — | — | — | — | — | ubuntu |
| aphrody-ai-http / shenron-embed | oui | strict | read-only | oui | — | — | — | — | — | aphrody |
| aphrody-discord-dev.service:20-29 | oui | strict | read-only | oui | — | — | — | **false (explicite)** | — | ubuntu |
| shenron-site.service:75-91 (modèle du dépôt) | oui | strict | read-only | oui | — | `CapabilityBoundingSet=` | `@system-service`, `~@obsolete @privileged` | — (non posé) | 12 Go | ubuntu |
| rg-bot/rg-cron/rg-website | oui | strict | read-only | oui | partiel | Ambient vide | `@system-service` | **interdit, commenté** (rg-bot:75, rg-cron:71, rg-website:45) | oui | ubuntu |
| user: aphrody-web.service (CDP, V8) | oui | — | — | — | — | — | — | — | 4G + TasksMax 512 | (user) |
| user: aphrody-agent-{domain-sync@,live,session-sync} | — | — | — | — | — | — | — | — | — | (user) |

- **MemoryDenyWriteExecute** : absent partout où tourne V8 ou JSC, et explicitement `false` / « INTERDIT » dans les unités Bun :
  **cohérent**. MDWE (PR_SET_MDWE ou seccomp) interdit mmap RW→mprotect RX, donc le JIT de V8 et de JSC ; ne pas l'activer pour
  un processus qui charge cet artefact. Piste de durcissement alternative [P] : V8 en `--jitless` (obscura-js/src/v8_flags.rs
  expose `set_v8_flags`) pour un profil MDWE, au prix des performances ; non mis en œuvre.
- Absents sur les unités du stack aphrody : PrivateDevices, ProtectKernel*, RestrictAddressFamilies, CapabilityBoundingSet=,
  SystemCallFilter/SystemCallArchitectures, LockPersonality, RestrictNamespaces, RestrictSUIDSGID, MemoryMax/TasksMax/LimitNOFILE.
  aphrody-web-api héberge V8 et un scraper d'URL arbitraires sous `User=ubuntu` (l'utilisateur interactif) sans plafond mémoire.
  L'artefact importe `chroot`, `setuid`, `fork`, `execvp`, `posix_spawnp` : `~@privileged` + capabilities vides sont pertinents.
- Positifs [V] : loopback uniquement (`127.0.0.1`), env files 0600 dans /etc/aphrody (atomic-deploy:99-106), aucun secret en clair
  dans les unités/scripts (grep de motifs token/secret/password : 0), `curl --config -` pour ne pas exposer le jeton en argv
  (atomic-deploy:338-340, 347-348), lecture des .env par `sed -n` et non `source`, .env racine en 0600 et gitignoré (.gitignore:89).
  Défaut mineur : smoke-bxc-systemd.sh:36 passe le jeton éphémère en argv de curl.
- smoke-bxc-systemd.sh teste un sous-ensemble du sandbox via `systemd-run --user` (l.21-24 : ProtectSystem=strict,
  ProtectHome=true, ReadWritePaths, NoNewPrivileges, PrivateTmp), pas l'unité réelle (User, WorkingDirectory, chemins /srv).

### 4.3 Bascule atomique, rollback, intégrité (atomic-deploy-aphrody-stack.sh)

Correct et à garder [V] : bascule `ln -sfn` + `mv -Tf` (l.219-220) ; sauvegarde unités/vhost/env/previous-release avant
activation (l.175-195) ; `trap rollback EXIT` (l.203-211) et `--restore` (l.60-69) ; releases jamais supprimées ; vérification
post-démarrage de `ExecStart`, de `/proc/PID/exe` et de son sha256 contre la release (l.227-244) ; refus si `SMOKE.json` ne
correspond pas à `SHA256SUMS` (l.80-94) ; contrôle 0600 des env files, DSN loopback (l.99-153).
Manques / défauts :
1. La vérification post-démarrage ne couvre que `bin/*` ; les `.so` chargés dynamiquement (`lib/libaphrody_web_ffi.so`,
   `libbxc_render.so`, futur `libaphrody_ffi.so`) ne sont jamais comparés (aucun contrôle de /proc/PID/maps) [V].
2. Les unités référencent `BXC_RUST_BRIDGE_LIB=/srv/aphrody/current/lib/...` (web-api.example:18-19) : chemin passant par le
   lien symbolique `current`, ré-résolu à chaque `dlopen`. Un chargement tardif après la bascule mélange deux générations
   (fenêtre brève ici, mais le chargeur Bun de libaphrody_ffi charge paresseusement) [P].
3. Racine de confiance auto-attestée : `SHA256SUMS` et `SMOKE.json` sont dans l'arbre qu'ils attestent ; l'archive voyage
   avec son `.sha256` par le même canal (IMMUTABLE-RELEASES.md:260-265) ; aucune signature (gpg/minisign/cosign) [V].
4. Propriété/mode de l'arbre de release non vérifiés ni forcés (`[[ -r ]]` seulement ; `tar` en root restitue les uid de
   l'archive, uid 1000 = souvent `ubuntu`, utilisateur d'exécution) ; `ProtectSystem=strict` limite l'écriture à l'exécution [P].
5. Aucune rétention (« Nothing is ever deleted ») : chaque release future embarque ≥ 200 Mo de .so [P].
6. La compatibilité glibc de l'hôte cible n'est pas testée (ldd au build, build-aphrody-stack-release.sh:128-130, sur l'hôte de
   build seulement).

### 4.4 crates/os/systemd (périmètre demandé)

C'est un modèle en mémoire, pas un superviseur : `start_unit` (manager.rs:219-239) passe l'état à `Active`/`running` et journalise
« Started » sans lancer `exec_start` (aucun `Command`/spawn dans le crate) ; `main_pid` est `std::process::id()` (l.80, 93).
`Unit::parse_ini` (unit.rs:147-175) ignore silencieusement (`_ => {}`) toutes les directives hors Description/After/Requires/
Wants/ExecStart/ExecStop/WorkingDirectory/Restart/RestartSec/Environment/WantedBy : NoNewPrivileges, ProtectSystem, User,
EnvironmentFile… disparaissent sans avertissement ; `Environment=` n'accepte qu'une paire par ligne (unit.rs:161-168). 0 symbole
`aphrody_systemd` dans le .so (nm -C). Risque : un état « active » forgé et des durcissements affichés comme pris en compte.

## 5. Chargeur Bun (library.ts, native-artifact.ts)

Ordre de résolution [V, library.ts:293-332] :
1. `APHRODY_FFI_LIB`, sinon `SHENRON_FFI_LIB` (les deux différents → erreur ; l.293-299). **Honorés aussi hors mode dev** ; seul
   `existsSync` est exigé, puis `resolve(override)` (l.302-309) : pas de contrôle du type, du propriétaire ni du mode.
2. `<packageRoot>/native/<triple>/libaphrody_ffi.so`, puis `<packageRoot>/native/libaphrody_ffi.so` (basés sur `import.meta.dir`,
   pas sur le cwd : bon).
3. Seulement si `APHRODY_FFI_DEV=1` : `target/<triple>/{release,debug}` puis `target/{release,debug}`, où `target` provient de
   `CARGO_TARGET_DIR` (variable d'environnement, chemin absolu accepté) (l.314-331).
Garde dev : `nativeDevelopmentEnabled()` = `process.env.APHRODY_FFI_DEV === "1"` (native-artifact.ts:66-68). Effets [V] :
manifest absent → chargement **sans aucune vérification** (l.183-184, testé comme voulu : test-native-artifact.test.ts, dernier
`isolated` avec DEV) ; smoke « pending », profil debug, provenance `existing-debug`, arbre sale acceptés (l.133-142).
Intégrité [V] :
- Contrôle = manifest.json voisin (schéma, triple/libc, versions d'ABI, `consumerSmoke`, sha256+taille en flux, instabilité
  pendant le hachage détectée : l.147-175). **Bon contre la corruption et les mauvaises associations** (testé) ; le doc l'admet :
  « checks establish internal artifact consistency, not publisher authentication » (BUN-NATIVE-PACKAGE.md:14-15). Mais le
  manifest réside dans le même répertoire que le .so : qui peut écrire l'un écrit l'autre (aucune signature, aucun hash épinglé
  dans le paquet ou le lockfile).
- **Non-atomicité vérification → chargement** : `verifyNativeArtifact(path)` (library.ts:350) puis `dlopen(path)` (l.352) rouvrent
  le chemin ; entre les deux, un remplacement (rename) est possible. Le builder publie par `rename` successifs de l'artefact puis du
  manifest (bun-native.ts:361,363) : fenêtre où le nouvel artefact voit l'ancien manifest (échec fermé, indisponibilité).
- Les constructeurs du .so (§1.4) s'exécutent avant la vérification d'ABI (l.357-368) : l'ABI n'est pas un contrôle de sécurité.
- Vecteur d'environnement [P] : Bun charge automatiquement un `.env` du cwd ; un `.env` hostile peut poser `APHRODY_FFI_LIB` +
  `APHRODY_FFI_DEV=1` (le dépôt a lui-même un `.env` racine et lance des services avec WorkingDirectory sur le dépôt, p.ex.
  config/systemd/user/aphrody-agent-live.service:7).
- `close()` (engine.ts:812-820) refuse seulement si index/DOM/jobs sont vivants ; le runtime tokio multi-thread est un `static OnceLock`
  jamais arrêté (lib.rs:894-901), V8 crée ses threads ; le .so n'a pas DF_1_NODELETE (FLAGS_1 = NOW seul) : un `dlclose` effectif
  laisse des threads exécuter du code démappé [P]. Mitigation d'artefact : `-Wl,-z,nodelete`.
Coût : hachage de 257 Mo à chaque démarrage de processus Bun : 0,157 s à chaud (sha256sum, SHA-NI) ; lecture disque complète à froid
(cache de vérification par (dev, ino, size, mtime, ctime) non implémenté) [P].
Autres chargeurs du même .so : py/aphrody-train/src/aphrody_train/shenron_ffi.py:15-33,49 — aucune vérification d'intégrité,
cherche d'abord `libshenron_ffi.so` (legacy), puis `~/src/target/{release,debug,...}` (chemin que build-aphrody-stack-release.sh:42
déclare interdit), repli `home = Path(".")` si HOME/USERPROFILE sont absents (l.23) [V]. crates/web/web-bridge/src/resolve.rs
(ordre : override, ~/.local/bin, ~/.aphrody/runtimes, target/ du dépôt trouvé depuis le cwd/l'exe, **PATH**) ne fait que **localiser**
pour des rapports (ffi.rs:36-45, `Bridge::load` = l'exécutable courant) : pas de dlopen, donc pas de détournement [V].

## 6. Constats (détail)

| ID | Sév. | Emplacement | Constat | Preuve |
|---|---|---|---|---|
| ART-01 | HAUTE | packages/interop/native/src/library.ts:293-299,350-352 ; src/native-artifact.ts:66-68,133-142,177-201 | Intégrité du chargeur contournable : manifest auto-attesté voisin du .so, sans signature ni hash épinglé ; contrôle puis dlopen non atomique (TOCTOU) ; `APHRODY_FFI_DEV=1` (simple variable) supprime toute vérification ; `APHRODY_FFI_LIB` honoré hors dev sans contrôle de propriétaire/mode ; contrôle d'ABI après exécution des constructeurs. Documenté comme « cohérence interne » (BUN-NATIVE-PACKAGE.md:14-15) | [V] code lu ; vecteur `.env` Bun [P] |
| ART-02 | HAUTE | Cargo.toml (racine, aucun `[profile]`) ; crates/interop/ffi/src/lib.rs:33-35 | Aucun profil de release : défauts Cargo (lto off, 16 CGU, strip « debuginfo ») ; `panic = unwind` indispensable aux `catch_unwind` mais seulement implicite (un `panic = "abort"` futur rendrait les gardes inopérantes, crash de l'hôte Bun) ; aucun test ne l'épingle | [V] grep profile, fingerprint, imports `_Unwind_*` |
| ART-03 | HAUTE | target/release/libaphrody_ffi.so (.symtab/.strtab) | 52,2 Mo (20 %) de symboles Rust/C++ non strippés dans l'artefact « release » ; expose la structure interne ; aucun .debug_* | [V] readelf -SW |
| ART-04 | MOYENNE | libaphrody_ffi.so `.dynsym` ; crates/interop/ffi (pas de build.rs/version script) | 347/464 (74,8 %) des exports hors contrat : 302 `temporal_*`, 36 `v8__*/v8_inspector__*/crdtp__*/rusty_v8_*`, 9 `diplomat_*` ; surface appelable par `dlsym`/bun:ffi et risque d'interposition ; 7 `web_internal_*` hors en-tête (anciens noms) | [V] nm -D |
| ART-05 | MOYENNE | libaphrody_ffi.so (verneed) ; native-artifact.ts:46-58 | Plancher glibc effectif 2.39 (`__isoc23_sscanf@2.38` forte ; verneed 2.39 non faible) : dlopen impossible sur Ubuntu 22.04/Debian 12/RHEL 9 ; ni le manifest ni le chargeur ne portent de `minGlibc` (seulement gnu/musl) ; NEEDED libstdc++ pour 2 symboles | [V] readelf -V, nm -D ; effet loader [P] |
| ART-06 | MOYENNE | scripts/build-aphrody-stack-release.sh:46-47,72,99-117 ; atomic-deploy-aphrody-stack.sh:74 ; smoke-bxc-ffi.ts:7,11 ; systemd/*.example:2 | Chaîne de build/déploiement/smoke/unités = ancien superprojet (libaphrody_web_ffi/libbxc_render, ABI BXC 3) ; inexécutable dans ce monorepo ; unités « Retired » ; **aucun chemin de déploiement, de rollback ni de smoke systemd pour libaphrody_ffi.so** ; aucune release qualifiée possible (arbre sale, manifest absent, hash documenté périmé) | [V] |
| ART-07 | MOYENNE | libaphrody_ffi.so ; apps/cli/build.rs:22-25 ; v8-150.4.0/build.rs:769,862 | Build non reproductible et fuite de chemins : 2 733 `/home/aphro/...`, 84 `/rustc/`, horodatage `SystemTime::now()` embarqué, pas de `--remap-path-prefix` ni SOURCE_DATE_EPOCH ; V8 prébuilt 186 Mo téléchargé sans empreinte (le `.sum` contient l'URL) | [V] strings, code lu |
| ART-08 | MOYENNE | lib.rs:894-901 ; engine.ts:812-820 ; ELF FLAGS_1 | Pas de DF_1_NODELETE alors que le runtime tokio global et V8 ont des threads vivants ; `close()` ne les compte pas → `dlclose` possible sous threads actifs | [V] absence du flag ; crash [P] |
| ART-09 | MOYENNE | systemd/aphrody-web-api.service.example:10-28 ; aphrody-a2a/site/ai-http/shenron-embed | Durcissement partiel : pas de CapabilityBoundingSet/SystemCallFilter/RestrictAddressFamilies/RestrictNamespaces/LockPersonality/PrivateDevices ni MemoryMax pour un service hébergeant V8 + scraper, web-api/a2a/site sous `User=ubuntu` (utilisateur interactif) ; le profil du dépôt (shenron-site.service:75-91) est plus strict. MDWE absent = cohérent avec le JIT | [V] matrice |
| ART-10 | MOYENNE | atomic-deploy-aphrody-stack.sh:79-94,227-244 ; IMMUTABLE-RELEASES.md:260-265 | Vérifications post-démarrage limitées à bin/* (les .so chargés non comparés) ; chemins `.so` via le lien `current` ; SHA256SUMS/SMOKE.json non signés (même canal que l'archive) ; propriété de l'arbre non contrôlée | [V] ; propriété [P] |
| ART-11 | MOYENNE | crates/os/systemd/src/manager.rs:219-239 ; unit.rs:147-175 | Modèle d'état : `start_unit` marque Active sans lancer ExecStart ; directives de durcissement/User/EnvironmentFile ignorées sans avertissement | [V] |
| ART-12 | BASSE | libaphrody_ffi.so (notes ELF) | Pas de `.note.gnu.property` (CET/IBT/SHSTK), pas de SONAME, SSP uniquement côté C ; RELRO complet/BIND_NOW/pile non exécutable/pas de RPATH ou TEXTREL/TLS sûr = corrects | [V] readelf |
| ART-13 | BASSE | Cargo.toml:188 ; libaphrody_ffi.so | `image` en features par défaut → rav1e/ravif/exr/tiff dans l'artefact sans usage first-party ; 26 crates en doubles versions ; ni `deny.toml` ni `supply-chain/` suivis (cargo-auditor attend `deny.toml` avec la règle `tar < 0.4.45`) ; Cargo.lock : tar 0.4.46 (OK) | [V] ; gain [P] |
| ART-14 | BASSE | py/aphrody-train/src/aphrody_train/shenron_ffi.py:15-33 | Chargeur Python sans intégrité, chemins `~/src/...` obsolètes, repli `home="."` (cwd) | [V] |
| ART-15 | BASSE | docs/migration/BUN-NATIVE-BUILDER.md:7-8 ; BUN-NATIVE-PACKAGE.md:5,30 ; packages/interop/native/test-native-artifact.test.ts:133 | Dérive : chemins périmés (`crates/ai/aphrody-ffi`, `packages/bun/aphrody`, `packages/aphrody-workspace`), hash documenté ≠ artefact courant ; `import("./src" + name + ".ts")` sans « / » (le test d'import des entrées publiques ne peut pas résoudre `./srcindex.ts`) | [V] statique |

## 7. À garder (correct)

- RELRO complet + BIND_NOW, pile non exécutable, aucun segment RWX, pas de RPATH/RUNPATH/TEXTREL, TLS en general-dynamic
  (aucune relocation TPOFF) : l'artefact est `dlopen`-sûr (fix `local_dynamic_tls` effectif).
- Plancher d'ABI : sept `*_abi_version` vérifiés, version de paquet, triple/libc, hachage en flux avec détection de modification
  (native-artifact.ts:147-175), échec fermé sans manifest hors dev, tests de corruption.
- Chemin de recherche de production restreint à `native/` du paquet via `import.meta.dir` (pas de cwd, pas de PATH).
- builder : `--locked`, smoke dans un répertoire isolé sans APHRODY_FFI_LIB, publication par rename (bun-native.ts).
- Toolchain Rust épinglé (rust-toolchain.toml 1.98.1), `oxc` épinglé par `rev` (Cargo.toml:40-44), `Cargo.lock` utilisé.
- Déploiement : bascule atomique par lien, sauvegarde + `--restore`, vérification du hash de `/proc/PID/exe`, env 0600, jetons
  hors argv, loopback.
- MemoryDenyWriteExecute volontairement non activé pour V8/JSC (commentaires rg-*.service, `=false` discord-dev).

## 8. Recommandations priorisées

1. **Fermer l'intégrité du chargeur** (ART-01) : ancre de confiance hors du répertoire (signature minisign/cosign du manifest, ou
   sha256 épinglé dans le paquet), ouvrir le fichier une fois (fd) et charger `/proc/self/fd/N` ou une copie memfd vérifiée,
   contrôler propriétaire/mode (non inscriptible par groupe/autres), ne plus honorer `APHRODY_FFI_LIB` hors dev, exiger en plus de
   `APHRODY_FFI_DEV=1` un second signal (avertissement visible), documenter `bunfig env = false` pour les services.
2. **Épingler le profil et le lien** (ART-02/03/04/07/08) : `[profile.release]` explicite à la racine (ou
   `[profile.release.package.aphrody-ffi]`) avec `panic = "unwind"` commenté + test d'épinglage, et un `build.rs` dans
   crates/interop/ffi émettant `cargo:rustc-cdylib-link-arg` : `--strip-all`, `-z nodelete`, `-z pack-relative-relocs`, version
   script limitée aux familles du contrat (à valider sur un lien d'essai : rustc passe déjà sa propre version script) ; ajouter
   `--remap-path-prefix`, SOURCE_DATE_EPOCH (apps/cli/build.rs) ; conserver le nom de profil `release` (contrat du loader et du manifest).
3. **Réduire la taille** (§2.4) : `image` sans features par défaut, externaliser/gater Material Symbols + Noto Color Emoji + Google
   Sans Flex (−27 Mo) avec leurs hash dans manifest.json, dédupliquer les crates ; cible ≈ 170 Mo ; mesurer opt-level/LTO avant de s'engager.
4. **Créer (ou déclarer inexistant) le chemin de déploiement de libaphrody_ffi.so** (ART-06/09/10) : release immuable issue de ce
   monorepo, SHA256SUMS signé, contrôle post-démarrage des `.so` via /proc/PID/maps, chemins de bibliothèque en realpath de release,
   unité durcie sur le modèle shenron-site.service:75-91 (sans MDWE, avec `MemoryMax`, `~@privileged`, `RestrictAddressFamilies`, utilisateur dédié),
   smoke systemd de l'unité réelle ; retirer ou marquer les scripts à sous-modules comme hérités.
5. **Rendre le plancher glibc explicite** (ART-05) : champ `minGlibc` dans manifest.json calculé depuis `readelf -V` au build,
   contrôle `process.report` avant le dlopen, test CI ; décider de la cible 2.39 ou construire dans un conteneur manylinux/Debian 12.
   Corriger la dérive documentaire et le test d'import (ART-15), ajouter `deny.toml` (tar < 0.4.45) et un gate `cargo deny` côté lead (ART-13).

## 9. NON EXAMINÉ

- Toute exécution : `dlopen` réel, démarrage de Bun, comportement de `dlclose` sous threads, temps de chargement (relocations,
  constructeurs), RSS, coût du hachage à froid ; aucun test, aucun cargo (règle du brief).
- Drapeaux réels de `dlopen` de Bun (RTLD_LOCAL/GLOBAL) : source Bun absente du dépôt (upstream/ ne contient pas bun).
- État réel du VPS : propriétaires/modes de /srv/aphrody, version d'OS, units installées ; nginx ; config/service-catalog.json ;
  atomic-deploy-shenron/rg/bundle/discord, provision-aphrody-stack-env.sh, smoke-aphrody-stack-local.py.
- Artefacts Windows (.dll, MSVC) et macOS (.dylib), builds musl, autres combinaisons de features (koharu, magika, forensics…) :
  un seul build (`default`+`gpu`) est inspecté.
- Attribution exacte des constructeurs aws-lc (déduite des noms de fonctions et de 32 chaînes), du `malloc_hook`/`__lcxx_override`
  (sections exécutables de 366/194 octets issues du prébuilt V8, non analysées), et origine du `__isoc23_sscanf` (dépendance C non identifiée).
- Contenu du `.env` racine (non lu), contenu des env files /etc, secrets réels ; advisories RustSec (cargo audit/deny interdits).
- Correction fonctionnelle de l'ABI (en-tête aphrody.h, signatures, propriété mémoire) : autres axes.
- Manifests des crates koharu/Tauri, `config/pipeline.json`, `crates/web/web-bridge` au-delà de resolve.rs/ffi.rs:1-60.
- Présence réelle des 5 Material Icons (≈ 2,1 Mo) dans le binaire : seuls les 3 Material Symbols et l'emoji sont confirmés.
