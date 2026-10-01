# Audit binaires-compat — aphrody-re, compat, coreutils (surface d'exécution), toolchains, oxc-bridge, bun-docs, n2b*, backend

Date : 2026-10-01. Niveau de preuve global : P1 (statique). Aucun cargo/rustc exécuté. Les sources goblin lues l'ont été
dans `~/.cargo/registry/cache/*/goblin-0.10.7.crate` via `tar -O` (le répertoire `registry/src` a été vidé pendant l'audit).
Marqueurs : [V] vérifié dans le code lu, [P] plausible/non reproduit.

## 0. Cadre retenu (correction du propriétaire)

Lu : `docs/reference/os/YOLO-AUTHORITY.md`. Aphrody est un OS YOLO : domaine de confiance = un utilisateur OS ; pas de sandbox,
pas d'approbation. Ce rapport ne recommande donc NI confinement NI politique restrictive. Chaque constat est classé :

- **FIABILITÉ** : défaut de robustesse (panic, dépassement d'entier, allocation pilotée par l'en-tête = crash/OOM de l'hôte, perte de données).
- **ALIGNER** : revendication (doc, skill, CLI, README, description de crate) non tenue par le code.
- **YOLO** : comportement voulu (exécution sans confinement, confiance dans PATH/env, `bun install` dans le projet cible…).
- **LACUNE** : fonctionnalité absente.
- **GARDER** : correct.

Aucun détail d'exploitation n'est donné : les points sont décrits au niveau fiabilité et provenance.

## 1. Périmètre réellement lu

| Zone | Lu |
|---|---|
| `crates/os/re/src` | `lib.rs` 1-1480 (tests exclus), `asar.rs` 1-470, `golang.rs` 36-860, `minidump.rs` 205-270, 407-460, 585-790 (+ grep), `electron.rs` 150-330, `adobe.rs` 205-300 et 535-700, `leveldb.rs` 112-200, `yara.rs` 1-215, `headers.rs` 1-60 et 190-260, `google.rs` 1-60 + greps, `magika.rs` greps ; `Cargo.toml` |
| consommateurs de re | `crates/ai/mcp/src/main.rs` 1393-1700, `crates/os/winclean/src/dispatch.rs` 1295-1410, `apps/cli/src/re_auto.rs` 1-783, `apps/cli/src/lib.rs` 1835-1990 |
| `crates/os/compat` | tout (`lib.rs`, `wine_proton.rs`, `pwsh.rs`, `dotnet.rs`, `subsystem.rs`) ; enregistrement `kernel/src/main.rs:111`, `ui/app/src/lib.rs:86` |
| `crates/os/coreutils` | `subsystem.rs` 56-150, 268-392 (surface d'exécution seulement) |
| `crates/compat/toolchains` | `lib.rs`, `discover.rs`, `pin.rs` (tout) |
| `crates/compat/oxc-bridge` | tout (211 lignes) + en-tête `aphrody-tooling.h:31-36` + `nm -D` du .so |
| `crates/compat/bun-docs` | greps + 186-210, 306-322, 340-402 |
| `crates/compat/n2b*` | `n2b-core/run.rs` 1-320, `manifest.rs` 15-200, `audit.rs` 56-200, `report_card.rs` 215-260, `llmstxt/{mod,crawl,summarize}.rs`, `n2b-github/lib.rs`, `n2b-ai/lib.rs` 1-140, `n2b-report/lib.rs` 140-182, 335-400, 460-527, `n2b-scanners/{env_file,npmrc,source}.rs`, `package_json.rs` 418-490, 688-767, `n2b-util/edits.rs`, `n2b-native/lib.rs` 15-200, `n2b/src/{commands/migrate,commands/scan,cli/dispatch,subprocess/bun,patch,analyze}.rs` (parties), `app_cmd.rs`, `rust_cmd.rs` 85-140, `bin_cmd.rs` 190-213, `bunpp_cmd.rs` 195-260 |
| `crates/os/backend` | `lib.rs`, `main.rs`, `README.md`, `benches` 1-60 |
| plugin | `skills/{pe-symbol-recovery,auto-re,aphrody-cmd-re-forensics,n2b}/SKILL.md`, `agents/{asm-lowlevel-engineer,cpp-c-engineer}.md`, extraits de `rust-engineer.md` et `rust-best-practices-2026` |
| `packages/compat` | `n2b-client/src/cli.ts` (tout) + greps |
| goblin 0.10.7 (tarball) | `pe/import.rs`, `pe/section_table.rs`, `pe/options.rs`, `elf/mod.rs` (symtab/hash), `strtab.rs` |

## 2. Robustesse des parseurs face à un fichier hostile — les 8 pires endroits

Contexte transversal [V] : aucun `[profile.*]` dans le `Cargo.toml` racine (grep) → build release avec `overflow-checks = false`,
`panic = unwind` ; `workspace.lints` n'interdit ni l'indexation (`clippy::indexing_slicing`) ni l'arithmétique non checkée.
`aphrody-re` est `#![forbid(unsafe_code)]` (lib.rs:55, golang.rs:36, minidump.rs:20) : pas de corruption mémoire possible dans le
crate lui-même ; les risques sont panics, wrap silencieux, CPU et mémoire. Aucun répertoire `fuzz/` dans le dépôt ;
`libfuzzer-sys` et `proptest` sont dans `Cargo.lock` mais aucun harnais n'existe pour `aphrody-re` (seul `n2b-core` a du proptest).

| # | Sév. | Chemin:ligne | Constat | Preuve | Classe |
|---|---|---|---|---|---|
| 1 | HAUTE | `crates/os/re/src/lib.rs:448` + goblin `pe/section_table.rs:114-121` | `triage_pe` appelle `s.data(bytes)` pour chaque section. Quand `virtual_size > size_of_raw_data` et que la plage brute est dans le fichier, goblin alloue un `Vec` de `virtual_size` octets (u32, jusqu'à ~4 GiB), le zéro-padde, puis `shannon_entropy` le parcourt. Coût par section ; un fichier de quelques Ko suffit. L'entropie rapportée est calculée sur le tampon paddé (biais vers 0) alors que `size` rapporte `size_of_raw_data`. | [V] code lu des deux côtés ; [P] exécution | FIABILITÉ |
| 2 | HAUTE | `lib.rs:452` + goblin `pe/import.rs:437-500, 330-395` | `pe.imports` est collecté en entier dans `Vec<String>` sans plafond. goblin lit chaque descripteur d'import jusqu'au terminateur et, pour chacun, construit une table ILT et une table IAT lues jusqu'à zéro, sans compteur. Des descripteurs distincts peuvent désigner les mêmes RVA : coût et mémoire O(descripteurs × entrées), quadratique en la taille du fichier. | [V] boucles lues ; [P] amplification | FIABILITÉ |
| 3 | HAUTE | `lib.rs:480-492` (+ `triage_elf` 495-509) + goblin `strtab.rs:225-238` | ELF : l'entropie est calculée par section sur `bytes[sh_offset..sh_offset+sh_size]` sans contrôle de chevauchement : O(e_shnum × taille du fichier) (e_shnum jusqu'à 65 535, plus avec la numérotation étendue). `get_at` de goblin renvoie le suffixe de la chaîne contenant l'offset, puis `.to_owned()` copie ce suffixe pour chaque section/symbole : copies quadratiques si la strtab contient une longue chaîne sans NUL. | [V] code ; [P] ampleur | FIABILITÉ |
| 4 | HAUTE | `crates/os/re/src/golang.rs:667` (fn `parse_pclntab_12`, 637-690) | `func_off` est un `u64` de l'en-tête converti en `usize` ; `func_off + ptr_size + 4 > tab.len()` n'est pas protégé. En release le calcul wrap en silence (le test passe, lecture à un autre offset) ; en debug/test c'est un panic. La magie `0xfffffffb` est cherchée n'importe où dans le fichier (`find_pclntab_by_magic`, golang.rs:~395-420), donc tout fichier peut atteindre ce chemin. Les layouts 1.18/1.20 testent `func_data_off >= tab.len()` avant d'additionner (correct). | [V] | FIABILITÉ |
| 5 | HAUTE | `apps/cli/src/re_auto.rs:612-627` (+ 185, 202, 667-680) | Batch dossier : `std::thread::spawn` pour CHAQUE exécutable (le sémaphore ne borne que l'exécution, pas la création : `spawn` panique si l'OS refuse) ; chaque tâche fait `std::fs::read` complet (jusqu'à 4 fichiers entiers en mémoire) ; `let _ = h.join()` avale les panics : un échantillon qui fait paniquer l'analyse DISPARAÎT du JSON sans entrée d'erreur (fail-open). Le parcours `walk_dir_recursive` utilise `path.is_dir()` (suit les liens ; profondeur 8 mais pas de borne en largeur). | [V] | FIABILITÉ |
| 6 | MOYENNE | `lib.rs:381-388` (doc 344-348) | `triage` est fail-open : toute erreur goblin (mode `ParseMode::Strict` par défaut, goblin `pe/options.rs:34`) devient `Ok(unknown_report)`. `ReError::Parse` n'est jamais construit par `triage`, contrairement à la doc. Un PE atypique mais chargeable est rapporté `Unknown` sans sections ni imports. `ParseOptions::with_parse_mode(Permissive)`, `with_parse_resources(false)`, `with_parse_tls_data(false)` existent et ne sont pas utilisés. | [V] | FIABILITÉ + ALIGNER |
| 7 | MOYENNE | `lib.rs:631, 918, 1023, 1166, 1305` ; `golang.rs scan_file` ; `asar.rs:365` ; `re_auto.rs:202` ; `apps/cli/src/lib.rs:1851-1891` ; MCP `crates/ai/mcp/src/main.rs:1411-1432, 1471-1499, 1542-1564, 1615-1643` ; `minidump.rs:712-745` ; `yara.rs:159-160` | Lecture intégrale `std::fs::read` sans plafond dans la bibliothèque et le CLI. Le MCP a un plafond (100/200 Mo) mais basé sur `metadata().len()` puis `std::fs::read` non borné : un fichier spécial (périphérique, FIFO, `/proc`) de taille 0 le contourne (blocage ou OOM de l'hôte). `analyze_pe_file` lit le fichier 2 fois et parse le PE 2 fois (lib.rs:1166-1172). `Minidump::scan_many` accumule des `Hit` sans plafond (`scan_limited` existe, 748) ; `yara::scan` n'a pas de timeout. Le skill auto-re affirme « binaires > 1 GB : OOM évité » : faux. | [V] | FIABILITÉ + ALIGNER |
| 8 | MOYENNE | `lib.rs:1025, 1030, 1051` ; `headers.rs:207-211` ; `lib.rs:632-717, 1403-1409` | Arithmétique non checkée sur offsets d'en-tête (`offset + size`, `pe + 24`, `opt_off + 2`) : sûre sur usize 64 bits, wrap/panic sur 32 bits (le crate se dit compatible wasm32, headers.rs:8-12). `section_count.min(96)` tronque en silence alors que `section_count` rapporté est brut. Strings : `extract_strings_file` copie chaque plage imprimable entière (valeur non bornée) ; `extract_strings` fait `with_capacity(limit)` piloté par l'appelant (CLI `--limit` non plafonné, apps/cli lib.rs:1865) ; le balayage UTF-16LE ne regarde que les offsets pairs (lib.rs:673-707, 1431-1452) alors que `google.rs:46-58` traite les deux alignements. | [V] arithmétique ; [P] cible 32 bits | FIABILITÉ |
| (9) | MOYENNE | `asar.rs:320-352, 373` | `collect_winclean_files` (sortie `asar_list`) n'applique pas la validation de noms de `walk` (asar.rs:207-231 refuse `/`, `.`, `..`, vide) : chemins relatifs non assainis dans le DTO. L'offset de base `16 + json_len` diffère de `data_start` de `parse_envelope` (8 + payload_size) du padding (0-3 octets). Les entrées sans `size` sont ignorées en silence. Récursion bornée par serde_json (128, pas de `unbounded_depth` dans les Cargo.toml). | [V] | FIABILITÉ + ALIGNER |

## 3. Exécution, émulation, chargement par `aphrody-re` ?

- **Non, pour `crates/os/re`** [V] : grep `Command|libloading|dlopen|LoadLibrary|emulat|spawn|ptrace` → aucun usage hors commentaires et chaînes de bench ;
  `golang.rs:24` interdit explicitement `unicorn-engine`. `disasm` (lib.rs:293-336) décode des octets, n'exécute rien ; `section_dump_file`, `xor_file`, `aes_ctr_file` écrivent des fichiers, n'exécutent rien.
- **`apps/cli/src/re_auto.rs` (hors crate)** : `--deep` lance Ghidra `analyzeHeadless -import <fichier> -deleteProject -analysisTimeoutPerFile 120` (416-420) ; `re go --deep` lance `redress info|packages` (564). Ces outils chargent/analysent le fichier, ne l'exécutent pas. Aucun `-postScript` : la « sortie Ghidra » est le journal tronqué à 4096 caractères (re_auto.rs:426-440), pas une décompilation. Classe : YOLO (pas de confinement voulu) + ALIGNER (le skill promet « décompilation + symboles »).
- **Provenance des outils lancés** [V] : Ghidra via `$GHIDRA_INSTALL_DIR` > `$GHIDRA_HOME` > PATH (re_auto.rs:463-486) ; `which_in_path` (489-500) accepte toute entrée `exists()` (pas de test fichier/exécutable) et une entrée PATH vide donne un chemin relatif ; redress via `$REDRESS_BIN`, PATH, `$GOPATH/bin`, `$HOME/go/bin` (re_auto.rs:~520-545). YOLO : résolution par environnement voulue ; seul l'affichage du chemin réellement lancé manque dans le rapport (provenance).
- **`compat` exécute ce qu'on lui donne** (c'est son rôle) : voir §4.

## 4. compat : Wine / Proton / pwsh / .NET

Classe YOLO (voulu) : exécution sans sandbox, préfixe Wine partagé (`WINEPREFIX` hérité ou `~/.wine`), variables d'environnement passées telles quelles (`custom_env`, wine_proton.rs:115-117), `pwsh -Command` avec le script brut (pwsh.rs:54), aucune élévation (grep `sudo|runas|elevat` → seulement des messages d'installation dans les gabarits n2b), aucune politique par défaut (le kernel ne charge une politique que si `--exec-policy` est donné, kernel/main.rs:96-98 ; aucun fichier de politique livré ne mentionne `compat_*`). Je ne le qualifie pas de défaut.

Défauts de fiabilité et revendications à aligner [V sauf mention] :

1. Pas de timeout, sortie entière en mémoire, pas de `kill_on_drop` : `wine_proton.rs:119-120`, `pwsh.rs:60`, `dotnet.rs:74` (`cmd.output().await`). Un appel annulé laisse le processus. À comparer à `coreutils/subsystem.rs:287-327` (timeout, `read_capped`, `kill_on_drop(true)`, arrêt + reap) : le modèle existe dans le dépôt (GARDER) et sert de référence d'alignement, sans rien restreindre.
2. `compat_runtimes_status` est `.read_only()` (subsystem.rs:42) mais lance `pwsh -Version` (pwsh.rs:22) et trois fois `dotnet` (dotnet.rs:46-56) sans timeout : étiquette à aligner.
3. Détection ≠ exécution : `which("wine")` trouve un chemin (wine_proton.rs:40-47, test `is_file` seulement) mais l'exécution fait `Command::new("wine")` (97) ; le chemin rapporté peut ne pas être le binaire lancé (provenance).
4. Proton (wine_proton.rs:51-70, 91-95) : premier dossier `Proton*` dans l'ordre de `read_dir` (non trié) ; l'existence du script `proton` n'est jamais vérifiée (des dossiers Steam « Proton … Runtime » existent sans script) ; `proton run` exige `STEAM_COMPAT_DATA_PATH` et `STEAM_COMPAT_CLIENT_INSTALL_PATH`, or seul `WINEPREFIX` est positionné (110-112) : chemin Proton nominal [P : non exécuté].
5. « .NET 10 » n'apparaît que dans une description (subsystem.rs:29) ; aucun contrôle de version, aucun NativeAOT (grep négatif) ; chemins dotnet codés en dur (dotnet.rs:21-32), `DOTNET_ROOT` et `~/.dotnet` ignorés ; `windows_powershell` renvoie la version « 5.1 » en dur (pwsh.rs:40).
6. Wine détecté via `wine` seulement (pas `wine64`, `WINE`, Flatpak, `umu-run`, `compatibilitytools.d`) ; `prefix` n'est ni validé ni créé.
7. Le sous-système est enregistré dans le kernel et dans l'app de bureau (`ui/app/src/lib.rs:86`).

## 5. n2b (analyseur et codemod Node → Bun)

### 5.1 Écritures sur disque
- **GARDER** : le parcours `n2b-core/run.rs:121-172` (`ignore::WalkBuilder`, `follow_links` par défaut = faux, `file_type().is_file()`) ne suit pas les liens symboliques ; plafond 2 MiB par fichier (257-263) ; les chemins écrits viennent du parcours, pas du contenu.
- **FIABILITÉ** : `run.rs:315-317` écrit sur place, non atomique (troncature puis écriture), sans sauvegarde ni test d'arbre propre. `--fix` et `--aggressive` (scan.rs:21-27) écrivent ainsi ; seul `--check` (défaut) n'écrit pas. Pas de `--dry-run` sur le scan principal (il existe sur `patch` et `bunpp sync`).
- **FIABILITÉ** : les réécritures de sources sont des remplacements regex sur texte brut (`n2b-rules/bun_apis.rs:108`, `n2b-util/edits.rs:27-49` `replace_range`) sans nouvelle analyse syntaxique avant écriture (`scanners/source.rs:24-41`). `replace_range` panique hors frontière UTF-8 ; un panic dans un thread du parcours ne laisse aucune trace de ce qui a déjà été écrit.
- **FIABILITÉ** : fichiers > 2 MiB, non UTF-8 ou illisibles ignorés sans compteur (run.rs:257-267) : une exécution « verte » ne dit pas sa couverture.
- **FIABILITÉ (perte de données)** : `n2b rust new <name> --force` fait `remove_dir_all(base.join(name))` (rust_cmd.rs:92-103) avec un `name` non validé (`..`, chemin absolu, `.`). `valid_name` existe (bin_cmd.rs:203) mais est `#[allow(dead_code)]` et n'a aucun appelant. Les autres scaffolders font `dir.join(&name)` sans validation (app_cmd.rs:83-86, même motif ailleurs).
- **FIABILITÉ** : le chemin relatif au rapport (`rel`) est réutilisé comme chemin du système de fichiers relatif au CWD dans `n2b-scanners/package_json.rs:429-435` et `688-712` (`src/`, `pnpm-workspace.yaml`) : mauvais arbre quand `root != cwd` (aussi pour `n2b analyze` multi-dépôts et pour le FFI `node2bun_scan_*`). Le même fichier suit les liens et n'a ni profondeur ni ensemble de visite (package_json.rs:440-460, `is_dir()`).

### 5.2 `--migrate` et rollback
- `commands/migrate.rs` : `BackupGuard` (subprocess/bun.rs:119-203) sauvegarde `package.json`, `pnpm-workspace.yaml` et les lockfiles (migrate.rs:59-70) sous `<fichier>.n2b-bak`, pas les sources réécrites par `run::run` ; en cas d'échec de `bun install` les sources restent migrées (112-120). Le commentaire de tête (migrate.rs:9-11) parle de « rollback transactionnel » : **ALIGNER**. Un arrêt brutal laisse les `.n2b-bak`.
- Les lockfiles concurrents sont supprimés AVANT `bun install` (migrate.rs:104-115) : Bun ne peut plus importer les versions épinglées, la résolution repart de zéro (provenance des versions). **FIABILITÉ**.
- `bun install`, `bun patch`, `bun add` s'exécutent dans le projet cible (subprocess/bun.rs:47-63, 91-107 ; patch.rs:120-124, 183-187) et migrate.rs:87-90 recopie `onlyBuiltDependencies` de pnpm dans `trustedDependencies`. **YOLO** (voulu) ; à documenter comme « exécute les hooks d'installation du projet ».
- `package.json` est réécrit via `serde_json::Value` (package_json.rs:758, migrate.rs:91-99) : l'ordre des clés dépend de `preserve_order` (indexmap figure dans la liste de dépendances de `serde_json` dans `Cargo.lock`, donc activé par unification de features ; non déclaré par n2b, donc non garanti en `cargo install`). **FIABILITÉ [P]**.

### 5.3 `.env`, tokens, rapports
- `n2b-github/lib.rs:32-73` : `GH_TOKEN`/`GITHUB_TOKEN`, sinon un `.env` cherché en remontant du CWD jusqu'à la racine du système de fichiers ; première clé trouvée dans l'ordre du fichier (pas l'ordre de `TOKEN_KEYS`), pas de gestion des commentaires en fin de ligne. Le jeton n'est envoyé qu'à l'API octocrab par défaut. **YOLO**.
- `n2b/src/bunpp_cmd.rs:199-216` : autre résolveur (variables d'environnement seulement) qui accepte `GITHUB_API_URL` comme `base_uri` sans contrôle de schéma ni d'hôte. Deux implémentations divergentes pour la même fonction : **ALIGNER** (une seule, dans `n2b-github`). Provenance : le jeton suit l'hôte configuré.
- `n2b-scanners/npmrc.rs:42-50` : le finding `npmrc/auth-token` stocke la ligne `.npmrc` brute (jeton compris) dans `original` ; `original` et le contexte sont sérialisés dans JSON/JSONL (`n2b-report/lib.rs:147-175`) et dans `render_prompt` (489-512) destiné à un LLM. Aucune rédaction dans les crates n2b (grep). SARIF n'embarque pas `original` (lib.rs:335-400). **FIABILITÉ/ALIGNER** : décider si les rapports doivent masquer la valeur. `render_prompt` insère le contenu du dépôt dans des blocs ``` sans neutralisation : sortie corruptible, BASSE.
- `manifest.rs:~170-180` : `n2b.json` cherché dans tous les ancêtres jusqu'à `/` ; le rapport ne dit pas quel manifeste a été chargé. **YOLO** + provenance.
- `n2b analyze --apply` écrit dans plusieurs dépôts et interroge GitHub (analyze.rs:202-300) ; avec `--features ai`, `fastembed` télécharge un modèle au premier usage (n2b/Cargo.toml:32-37, analyze.rs:~165) : provenance du modèle non épinglée visible [P].
- `llmstxt` n'est qu'un enrobage de `siteone-crawler` trouvé dans PATH (crawl.rs:22-26) ; `summarize` envoie 2 000 caractères de chaque page crawlée à l'API Anthropic via `ANTHROPIC_API_KEY` (summarize.rs:36-80) et n'imprime que le résultat (non destructif).
- `--timeout` de `n2b wasm spec testsuite` : accepté (cli/args.rs:745), transmis (`wasm_spec/mod.rs:52, 80-81`), jamais lu : **ALIGNER** (argument CLI = contrat).

### 5.4 Autres crates du périmètre
- `oxc-bridge` (211 lignes) : liaison C-ABI en-processus vers le fork Oxc pinné (format, minify, lint). Exports `aphrody_oxc_{abi_version,format,minify,lint,free}` présents dans `aphrody-tooling.h:31-36` et dans `nm -D` du .so (5 symboles). Tous les points d'entrée sont sous `catch_unwind` ; null/UTF-8 invalide testés. Réserves : `catch_unwind` ne rattrape pas un débordement de pile sur source très imbriquée [P] ; `run` est une `fn` sûre qui déréférence des pointeurs bruts (oxc-bridge/lib.rs:81-100) ; `lint` duplique la logique ; `license = "MIT"` (Cargo.toml) alors que le dépôt est Apache-2.0 (héritage du fork, à vérifier). GARDER pour le reste.
- `n2b-native` : FFI C (`find_newlines_u16`, `node2bun_*`) ; `node2bun_scan_with_options_json` peut écrire (`mode` fix/aggressive sans `dry_run`) alors que `node2bun_scan_json` est en lecture seule (doc exacte, lib.rs:101-135) ; `find_newlines_u16` hors `catch_unwind`.
- `toolchains` : GARDER. Découverte sans shell (`discover.rs:41-67`), entrée PATH vide ignorée (`find_in`, 83-88), pins lus dans le dépôt (`pin.rs:54-63`). Réserves : `Toolchain::command()` (lib.rs:~160-175) utilise `Command::new(nom)` (résolution par l'OS) alors que `discover()` a ses propres règles ; `pin::find` remonte jusqu'à `/` et une erreur de parse d'un `pyproject.toml`/`mise.toml` d'un ancêtre fait échouer la résolution (`pin.rs:95-100`, `?`).
- `packages/compat/n2b-client/src/cli.ts:36-44` : ordre de résolution `bin` explicite > `N2B_BIN` > PATH > `target/debug/n2b` du workspace > `n2b` : un binaire debug périmé peut être choisi ; la logique ne réutilise pas `aphrody-toolchains`.
- `bun-docs` : parcours sans suivre les liens (`file_type().is_dir()`, lib.rs:310-322, GARDER) ; racine résolue par env > chemins installés > `current_dir()` et ancêtres (`third_party/bun/docs`, `docs/reference/upstream-bun`) > chemin de build (340-402) : le contenu servi comme « docs Bun officielles » peut venir du répertoire courant (provenance) ; `max_chars` accepte `usize::MAX`.
- `os/coreutils` : surface d'exécution saine (nom d'utilitaire validé, sans shell, timeout, sortie bornée, `kill_on_drop`). `APHRODY_COREUTILS_BIN` (subsystem.rs:101) = confiance dans l'environnement (YOLO). Les utilitaires qui lancent d'autres programmes (`env`, `timeout`, `nohup`, `xargs`, `find`) rendent « sans shell » non équivalent à « sans exécution » : à documenter.
- `os/backend` : le crate se décrit « forensics and backend logic » mais `src/lib.rs` (69 lignes) ne contient que `Md3Mirror` (miroir de 2 assets HTTP). Le README documente `dns::DnsRecon`, `chromium::ChromiumParser` (DPAPI + AES-GCM) et une inspection de processus absents du code ; les benchmarks mesurent encore la logique de modules retirés. **ALIGNER**. Les briques Chromium/DPAPI vivent ailleurs (`crates/os/base/src/lib.rs:114`, `crates/web/web-chromium`, `crates/interop/ffi/src/web/cookies.rs`), hors périmètre.
- `os/winclean` (angle binaires) : `analyze_pe`, `binary_*`, `asar_list`, `golang_scan`, `aob_scan` sont de simples répartiteurs vers `aphrody-re` (dispatch.rs:1317-1403 ; registry.rs:551) ; aucune résolution de symboles Windows (aucun usage de DbgHelp/PDB). `binary_xor_decrypt`, `binary_aes_ctr_decrypt`, `binary_section_dump` écrivent à un chemin choisi par l'appelant ; `File::create(output)` après ouverture de l'entrée tronque l'entrée si les deux chemins sont identiques (lib.rs:759-760, 850-851) ; chemin par défaut de `section_dump_file` : `temp_dir()/<stem>_<section>.bin` (lib.rs:969), nom prévisible. FIABILITÉ BASSE ; l'exposition sans politique est YOLO.

## 6. Natif first-party ou enrobage ? (par domaine)

| Domaine / fonction | Nature | Détail |
|---|---|---|
| `aphrody-re` triage PE/ELF | Natif (code first-party) **sur** goblin 0.10.7 (tiers) | `lib.rs` ; features goblin `pe32 pe64 elf32 elf64 endian_fd` (Cargo.toml racine:302), pas de Mach-O |
| `aphrody-re` en-têtes PE maison | Natif dupliquant goblin | `parse_pe_header_file`, `section_dump_file` (lib.rs:918-1107) |
| `aphrody-re` désassemblage | Enrobage de iced-x86 1.21.0 (x86-64 seul, `with_ip(64` lib.rs:300) | pas de 32 bits, ARM64, RISC-V |
| `aphrody-re` asar, Go (pclntab/buildinfo), minidump, Electron, Google, Adobe, `headers.rs` | Natif first-party (parseurs maison) | `headers.rs` : zéro consommateur hors crate (grep) |
| `aphrody-re` YARA, Magika, LevelDB | Enrobage de yara-x 1.7.0, magika 1.1.0 (+ ort/ONNX), rusty-leveldb 4.0.1 (features optionnelles) | |
| `re auto --deep` | Enrobage de Ghidra headless (journal seulement) | re_auto.rs:374-460 |
| `re go --deep` | Enrobage de `redress` (Go) | re_auto.rs:548-580 |
| compat Wine/Proton/pwsh/dotnet | Enrobage de processus externes (aucune implémentation de compat propre) | |
| coreutils | Enrobage du multicall uutils épinglé (artefact externe construit à part) | subsystem.rs |
| toolchains | Découverte/pins first-party ; lance Bun/uv/nu externes | |
| oxc-bridge | Enrobage en-processus (bibliothèque Oxc forkée) | |
| n2b analyse (imports) | Natif sur oxc_parser ; règles API en regex first-party | |
| n2b scaffolds, wasm, llmstxt | Enrobage de cargo, wasm-pack, wasm-opt, twiggy, wat2wasm, bun, siteone-crawler | |
| n2b GitHub | Enrobage d'octocrab | |
| backend | Natif minimal (HTTP reqwest) | |

### Briques mûres pour le parsing d'exécutables (marquées « à évaluer »)

| Crate | Licence déclarée | Dans `Cargo.lock` | Usage proposé |
|---|---|---|---|
| goblin 0.10.7 | MIT | oui (utilisé) | Activer `ParseMode::Permissive`, couper resources/TLS pour le triage ; activer `mach32 mach64 archive` si Mach-O voulu |
| object 0.37.3 | Apache-2.0 OR MIT | oui (0.37.3 ; 0.36.7 en cache) | API uniforme ELF/PE/Mach-O/COFF/Wasm, lecture paresseuse ; candidat pour remplacer les en-têtes maison (lib.rs:918-1107) et l'itération des sections |
| iced-x86 1.21.0 | MIT | oui (utilisé) | Ajouter le choix de bitness 16/32/64 selon `Format`/`arch` |
| gimli 0.26.2 / 0.32.3, addr2line 0.25.1 | MIT OR Apache-2.0 | oui | DWARF pour les symboles ELF |
| wasmparser 0.214/0.236 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | oui | combler « WebAssembly non câblé » (lib.rs:21) |
| cfb 0.7.3 / 0.14.0 | MIT | oui | conteneurs OLE/MSI |
| rustc-demangle 0.1.28 | MIT/Apache-2.0 | oui | noms Rust |
| yara-x 1.7.0 | BSD-3-Clause | oui (optionnel) | déjà là ; ajouter timeout de scan |
| capstone (capstone-rs 0.14 dans `iecode`) | MIT (moteur BSD-3-Clause) | non | ARM64/RISC-V ; dépendance C (`capstone-sys`) en tension avec « Pure Rust, no C » (Cargo.toml description) |
| yaxpeax-x86 / yaxpeax-arm | ISC (à revérifier) | non | alternative pure Rust pour ARM |
| pelite | MIT (à revérifier) | non | PE strict/lazy, ressources |
| pdb | Apache-2.0 OR MIT (à revérifier) | non | symboles PDB (le skill pe-symbol-recovery les suppose) |
| minidump (rust-minidump) | MIT (à revérifier) | non | remplacerait `minidump.rs` (970 lignes maison, par ailleurs bien durci) |
| cpp_demangle / msvc-demangler | à revérifier | non | noms C++/MSVC (RTTI) |

Dépôts frères : `/home/aphro/iecode/crates/nie/aphrody-nie-re` (7 261 lignes : RTTI MSVC, `.pdata`, graphe d'appels, récupération x86 ; dépend de `aphrody-re`, goblin, iced-x86) porte la vraie récupération de symboles que le skill `pe-symbol-recovery` décrit ; `iecode` utilise aussi capstone 0.14 (x86, riscv, arm64) et object. `cosmic-epoch` : aucun crate d'analyse de binaires (grep négatif).

## 7. Revendications contre code

| Revendication | Réalité | Réf. |
|---|---|---|
| `Cargo.toml` aphrody-re : « PE/ELF/Mach-O triage » | Mach-O → `Format::Unknown` (le doc lib.rs:20 le dit) | Cargo.toml description ; lib.rs:20 |
| skill auto-re : « PE/ELF/Mach-O » | idem | SKILL.md ligne 11 |
| skill auto-re : `--deep` = « décompilation + symboles » | `-import` seul, journal tronqué à 4096 caractères | re_auto.rs:413-440 |
| skill auto-re : « binaires > 1 GB : OOM évité » ; « concurrence = 4 threads » | lecture complète ; un thread par fichier, 4 actifs | re_auto.rs:202, 612 |
| skill pe-symbol-recovery : 7 stratégies, API `pe.ExportedFunctions`, PeNet, Iced C# | `recovered_symbols` = exports seulement (source « ExportTable ») ; `entry_point_asm` toujours vide ; `is_signed` toujours faux | lib.rs:1195-1240 |
| `triage` « Returns ReError::Parse » | jamais ; fail-open `Unknown` | lib.rs:344-348, 381-388 |
| DTO `entry_point` « virtual address » | RVA pour PE (`pe.entry`), VA pour ELF ; `resolve_va_to_file_offset` le traite comme offset de fichier : désassemblage d'entrée PE sur de mauvais octets | lib.rs:~439, 477 ; re_auto.rs:334-362 |
| CLI `re disasm` | pas d'offset : décode depuis l'octet 0 du fichier (MCP `re_disasm` a `offset`) | apps/cli/src/lib.rs:1890-1891 ; mcp main.rs:1653 |
| grille asm-lowlevel-engineer (x86_64, ARM64, RISC-V) | x86-64 seulement | lib.rs:300 |
| `list_cpk_file(_max_entries)` | paramètre ignoré | lib.rs:1248 |
| subsystem compat « .NET 10 » | non vérifié, pas de NativeAOT | subsystem.rs:29 |
| `compat_runtimes_status` `.read_only()` | lance des sous-processus | subsystem.rs:42 |
| migrate « rollback transactionnel » | partiel | migrate.rs:9-11 |
| `n2b wasm spec testsuite --timeout` | sans effet | args.rs:745 |
| README backend : DnsRecon, ChromiumParser, inspection de processus | absents du crate | backend/src/lib.rs |

## 8. Correct et à garder

- `#![forbid(unsafe_code)]` dans `aphrody-re` et ses parseurs ; pas d'exécution ni de chargement dynamique du fichier analysé.
- `minidump.rs` : `checked_span`, `checked_table_len`, plafonds (`MAX_STREAM_COUNT` 4096, `MAX_MODULE_COUNT`, `MAX_MEMORY_RANGE_COUNT`), plages de mémoire séquentielles bornées par la taille du fichier, lecture par `seek`/`read_exact` sans mmap, test « rejects_untrusted_byte_ranges_without_panicking ».
- `asar.rs` `parse_envelope` : arithmétique `checked_add` partout, validations de coherence ; `read_file` avec `try_from`/`checked_add`.
- `adobe.rs` : `follow_links(false)`, plafond de hachage 8 Mo, plafond PE 32 Mo ; `leveldb.rs` : copie superficielle sans suivre les liens (`file_type().is_file()`), source jamais modifiée.
- `golang.rs` 1.18/1.20 : garde `func_data_off >= tab.len()` ; `MAX_FUNCS`, `MAX_TYPES_SAMPLE`.
- `google.rs` : balayage UTF-16 aux deux alignements ; regex du crate `regex` (temps linéaire).
- MCP : plafonds `CAP_LIMIT` sur strings/disasm (main.rs:1470-1480, 1615-1620).
- n2b : parcours sans liens, plafond 2 MiB, `deny_unknown_fields` sur le manifeste, registre embarqué (`include_str!`) sans réseau, `catch_unwind` dans le FFI.
- `toolchains`, `coreutils` (voir §5.4).

## 9. Recommandations priorisées (compatibles YOLO)

1. **Bornes de fiabilité dans `aphrody-re::triage`** : remplacer `s.data()` par la plage brute (sans zéro-padding), plafonner/dédupliquer `imports`/`exports` et sections, calculer l'entropie par section avec un budget global, utiliser `ParseMode::Permissive` et rendre l'erreur visible (`Ok(Unknown)` → champ `parse_error`). Corriger `golang.rs:667` (`checked_add`) et les additions de `lib.rs:1025-1051`. Évaluer `object` pour le parcours des sections.
2. **Harnais de fuzz** `cargo-fuzz` (libfuzzer-sys déjà dans le lock) sur `triage`, `asar::list`, `golang::analyze_go`, `Minidump::from_bytes`, `extract_strings`, avec variantes `&[u8]` des fonctions `*_file` (aujourd'hui seulement fichier) ; ajouter un plafond d'entrée unique (`read` borné par `Read::take`) commun au CLI, au MCP et à winclean.
3. **n2b** : valider `name` (réutiliser `valid_name`, bin_cmd.rs:203) avant `remove_dir_all` ; écriture atomique (`tempfile` + rename) et revalidation syntaxique avant d'écrire ; étendre `BackupGuard` aux sources ou aligner la doc ; ne pas supprimer les lockfiles avant `bun install` ; utiliser le chemin absolu (`root.join(rel)`) dans `package_json.rs` ; rédiger les valeurs `_authToken` dans `original`/prompt si on veut des rapports partageables ; fusionner les deux résolveurs de token.
4. **Aligner les revendications** (§7) : Mach-O, `--deep`, OOM 1 GB, `ReError::Parse`, `.NET 10`, `--timeout`, README backend, skill `pe-symbol-recovery` (pointer vers `aphrody-nie-re` ou y copier les capacités) ; décider si `entry_point` PE doit être une VA (`image_base + rva`) et ajouter le décalage de fichier dans `Section`.
5. **compat** : reprendre dans `execute_binary`/`eval_script`/`execute_assembly` le schéma de `coreutils` (timeout, sortie bornée, `kill_on_drop`) ; faire exécuter le chemin détecté ; vérifier l'existence de `proton` et fournir les variables `STEAM_COMPAT_*` ; corriger l'étiquette `read_only`. Ajouter un décodeur ARM64/32 bits via une brique pure Rust (à évaluer) pour couvrir la grille asm-lowlevel-engineer.

## 10. NON EXAMINÉ

- `aphrody-re` : `google.rs` 60-1348 (hors greps), `adobe.rs` 1-205 et 300-535, `electron.rs` 1-150 et 330-518, `magika.rs` (corps), `benches/triage.rs`, `minidump.rs` 270-405 et 460-585 (lecture par grep), `golang.rs` tests.
- `crates/os/winclean` hors dispatch RE (outils `mem_*` mémoire de processus distant : couverts par l'axe windows).
- `crates/os/base` (injecteur, déchiffrement) : non lu, déjà signalé par `os.md`.
- n2b : `wasm_cmd.rs`, `wasm_spec/{codegen,validator}.rs`, `bunpp_cmd.rs` hors 195-260, `win32_cmd*.rs`, `linux_cmd.rs`, `bin_cmd*.rs`, `rust_cmd.rs` hors 85-140 (≈ 6 000 lignes de gabarits/outillage), `n2b-registry` (données), `n2b-types/schema.rs`, la plupart des scanners (`next_config`, `tsconfig`, `cargo_toml`, `docker_compose`, `workflows`…), `n2b-rules` (corps), `n2b-core/{llmstxt/{parse,generate},report_card}` hors extraits.
- Aucun test dynamique, Miri, ASAN, fuzz ; aucune exécution de Wine, Proton, pwsh, dotnet, Ghidra, n2b ; `cargo deny/audit` non lancés ; versions de crates tierces prises dans le tarball de cache (goblin 0.10.7) et `Cargo.lock`.
- Les licences des briques absentes du lock sont données de mémoire (« à revérifier »).
- Les ampleurs de BC-01 à BC-03 (temps, mémoire) sont déduites du code, non mesurées.
