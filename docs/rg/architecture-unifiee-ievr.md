# Architecture unifiée du toolkit IEVR

## 1. Vue d'ensemble

Le toolkit IEVR (Inazuma Eleven : Victory Road, moteur Level-5 « Lives », binaire `nie.exe`) n'est pas constitué de trois outils séparés mais d'**un seul pipeline de bout en bout**, du téléchargement Steam jusqu'au wiki et au jeu jouable. Ce pipeline est aujourd'hui implémenté dans trois langages, chacun couvrant une tranche du parcours :

- **iecode** (C# .NET 10, ponté vers Bun via node-api-dotnet) : la **couche basse binaire** — acquisition Steam native (sans steamcmd), déchiffrement et extraction des formats Level-5/Criware bruts (CPK, @UTF, CRILAYLA, G4*, audio, shaders, Lua, menu), plus l'**export du catalogue de formats** vers niers.
- **inagle** (Bun/TypeScript) : la **couche données + serving** — parsing des `cfg.bin` (déjà extraits en JSON) en entités typées, projection dans les tables `inagle_*` de Supabase, et API headless. C'est la **source de vérité des données de jeu** consommée par le wiki azalee.
- **niers** (Rust pur) : le **point de convergence terminal** — reverse-engineering de `nie.exe` puis réécriture intégrale du jeu en Rust, jouable headless et WebAssembly. niers porte byte-à-byte les capacités d'iecode et d'inagle, en s'appuyant sur eux comme oracles de validation.

### Principe directeur

> **niers = la cible de convergence Rust. iecode et inagle = les références de portage validées byte-à-byte ET la production actuelle.**

L'objectif final (documenté dans `niers/docs/PLAN.md`) est de réécrire 100 % d'IEVR en Rust pur, jouable headless + wasm, sans le binaire Windows ni le moteur propriétaire. Dans ce schéma :

- iecode (C#) et inagle (TS) ne sont **pas des dépendances permanentes** : ce sont des **vérités terrain de portage**. À mesure qu'une capacité est portée et validée en Rust, l'oracle correspondant peut être gelé (snapshot figé) plutôt que suivi vivant.
- La **production actuelle** reste néanmoins iecode (extraction d'assets, CDN menu) et inagle (push Supabase, données du wiki azalee). Aucun composant Rust n'écrit encore la DB du wiki ni ne sert les assets de prod.

azalee (le wiki Next.js self-host) n'est pas une couche de ce pipeline : c'est le **consommateur final** des données produites par inagle (via un miroir SQLite embarqué). Le jeu jouable wasm est le consommateur final de niers.

## 2. Le flux de données bout-en-bout

Le pipeline unifié est une chaîne unique. Pour chaque étape, l'implémentation actuelle (C#/TS) et la cible Rust (niers) sont indiquées.

### Étape 1 — Acquisition (téléchargement Steam natif)

- **Entrée** : dépôts Steam de l'app IEVR (**App ID 2799860** ; `3593770` est un decoy par collision de nom).
- **Actuel (iecode, C#)** : `IECODE.Core/Steam/Content/` via SteamKit2 3.4.0 — login CM + 2FA, PICS app info, manifest request codes, depot keys, chunks CDN, déchiffrement, écriture au format d'install Steam. Remplace steamcmd. Cache du refresh token via `SteamTokenStore`. CLI : `download/sync/dump/steam-build`.
- **Cible Rust (niers, FAIT)** : `crate nie-steam` (2124 LOC, 33 tests) — port de `IECODE.Core/Steam/Content/SteamDepotDownloader.cs` sur la fondation `steamroom`/`steamroom-client` (équivalent Rust de SteamKit2). Modules `depot_resolver`/`token_store`/`options`/`session`/`downloader` + CLI `nie-steam`. App ID 2799860 vérifié dans le code.
- **Sortie** : arbre d'install Steam (dépôts téléchargés), incluant `data/packs/*.cpk` et le binaire `nie.exe`.

### Étape 2 — Extraction des assets (CPK / @UTF / CRILAYLA → G4* / audio / shaders / Lua / menu)

- **Entrée** : CPK chiffrés (`data/packs/*.cpk`), conteneurs Level-5.
- **Actuel (iecode, C#)** : lecture des archives CPK + tables @UTF (`Formats/Criware/CriFs/`), décompression CRILAYLA, déchiffrement (`CpkDecryptionStream`/`CriCryptoService`). Parsers Level-5 (`Formats/Level5/`) : G4TX (textures + déswizzle), G4MD, G4MG (mesh, TODO restant `G4mgParser.cs:253`), G4SK, G4PK/G4RA, NXTCH, AGI, FXBIN/shaders, MEVBIN, P3LIP, Navmesh G4NV. Audio Criware (`Audio/`) : ADX PCM16 natif, HCA via vgmstream-cli, ACB/AWB, démux USM. Scripting Lua (`Scripting/Lua/`, `Formats/Lua/`) : désassembleur bytecode, runtime/host. Menu (`Formats/Menu/`) : G4PKM, OBJB. CDN à la demande (`Cdn/`) : sert n'importe quel fichier depuis les CPK sans dump, et exporte le sous-arbre `dx11/menu/**` en PNG lossless (`MenuPngService`) pour `cdn.rosegriffon.fr`.
- **Cible Rust (niers, partiel)** : `crate nie-formats` (6227 LOC) — lecture pure-Rust de RDBN/cfg.bin, @UTF (modèle en bits corrigé), CRILAYLA (off-by-one corrigé, 300/300 g4tx extraits), CPK chiffré, g4tx/g4md/g4mg/g4pk/g4ra/g4sk, nxtch (INCOMPLET, off-by-4). Ports validés croisés Rust↔C#. **Pas encore porté** : audio (HCA/ACB/AWB/ADX), USM, shaders DXBC, Lua, menu G4PKM/OBJB — niers n'a aucun module audio/lua/menu/shaders.
- **Clé de déchiffrement (point de vérité critique)** : la clé des **packs `.cpk` est dérivée du NOM DE FICHIER via CRC32 standard** (`CalculateKeyFromPath`/`CalculateKeyFromFilename`, XOR par position en flux). La constante **`0x1717E18E`** (`NativeCrypto.IEVRCriKey`, dite « découverte par Viola ») est la clé **FIXE des `cfg.bin` chiffrés**, **PAS** celle des packs. niers réfute explicitement la prémisse inverse : `crates/nie-formats/src/cpk.rs:1243` contient `assert_ne!(&buf[..4], b"CPK ", "0x1717E18E ne doit PAS donner 'CPK ' sur un pack")`.
- **Sortie** : dump CPK sélectif (presets inagle/azalee), PNG lossless menu, manifests de textures, et les `cfg.bin` extraits en JSON qui alimentent l'étape 3.

### Étape 3 — Parsing des données (cfg.bin → entités typées → Supabase)

- **Entrée** : `cfg.bin.json` (nœuds `ConfigNode {name, variables[{type, value}], children[]}`) sous `DATA_PATH=/home/ubuntu/nie/data` — corpus de dump réel partagé.
- **Actuel (inagle, TS)** : les parseurs servent l’extraction/import initial, puis le runtime lit les projections PostgreSQL. `service.ts` expose les DTO unifiés et `cli-push.ts` conserve les colonnes curatées `sheet_data`/`zukan_order`; Azalée et le CLI partagent les identifiants d’auras issus de `service.skills.auraAll()`.
- **Cible Rust (niers, partiel)** : `crate nie-data` (2250 LOC, no_std+alloc, wasm-compatible) — port 1:1 explicite d'inagle (chaque module cite son fichier-source TS + lignes). skill/item/growth/exp/passive (5/7 FAIT, validés byte) ; chara_param et aura **INCOMPLET** (hallucinations documentées : pairing off-by-one, aura-cmd 61/1548). `nie-data/cfgbin.rs` lit le JSON déjà parsé (contrat ConfigNode), tandis que `nie-formats/cfgbin.rs` reparse le binaire RDBN brut.
- **Sortie** : tables `inagle_*` Supabase (source de vérité données) ; côté Rust, structs no_std (SkillInfo, CharaParam, AuraCmd…).

### Étape 4 — RE binaire (nie.exe → carte de fonctions → portage gameplay)

- **Entrée** : `nie.exe` (PE32+ x64, 31 Mo, base `0x140000000`), index Ghidra `nie-index.json` (44 Mo), 60 fichiers C décompilés.
- **Actuel** : il n'existe **pas d'équivalent C#/TS** de cette étape — c'est la part propre à niers. Les sources de portage sont les décompilés Ghidra (`refs/iecode-re/research/ghidra-export/decompiled/*.c`).
- **Cible Rust (niers)** : `crate nie-re` — boucle RE autonome seed→rtti→rebuild→disasm→propagate→coverage, persistée en sqlite (`var/niers.sqlite`). Découverte ancrée : l'index Ghidra est désaligné (3,7 % des `FUN_` sont de vrais débuts) ; le `.pdata` (94748 RUNTIME_FUNCTION → 50674 racines) est la vérité terrain. **Couverture honnête mesurée en DB : 48796/52783 = 92,4464 %** (table `coverage`, confirmé par requête réelle). Crates support : `nie-index` (base sqlite 18 tables + frontière redis), `nie-queue` (frontière BFS dédupliquée), `nie-seed` (ingest des ancres).

### Étape 5 — Moteur / gameplay

- **Actuel** : iecode possède un domaine `GameData/`/`Game/` (CharacterDataPipeline, PassiveSkillService, soccer Player) qui **recouvre le domaine d'inagle** ; iecode `CLAUDE.md` reconnaît déléguer le parsing complet à inagle (`dump-gamedata` ne couvre que 7 types). inagle contient la logique de stats/auras. Il n'existe pas de moteur de match en C#/TS.
- **Cible Rust (niers)** : `crate nie-core` (4999 LOC, `forbid(unsafe_code)`, 126 tests + 9 doctests). A grandi à **13 modules** (vérifié : action, aura, ball, command_effect, exp, growth, keeper, match_fsm, match_state, skill, soccer_ctrl, stats, tactics) portés du C décompilé (`ball_component.c`, `soccer_keeper_save.c`, `soccer_tactics_ai.c`, `soccer_ctrl.c`, `soccer_match_state_machine.c`). Formule de score `min*10000+sec` exacte. Les valeurs golden sont recoupées contre inagle (`calculateStats`) et le miroir SQLite prod azalee.

### Étape 6 — Serving (wiki azalee / jeu jouable wasm)

- **Wiki (actuel, prod)** : azalee (Next.js self-host VPS, `apps/website` :3004) lit les tables `inagle_*` via un miroir SQLite embarqué. inagle reste le **seul producteur** de ces tables ; azalee et `rg-cron` dépendent en dur de son `dist/` (subpath exports).
- **Jeu jouable (cible Rust)** : `crate nie-wasm` (1108 LOC) — surface wasm-bindgen (12 exports : `detect_format`, `crilayla_decompress`, `utf_table_json`, `calculate_stats`, `skill_lookup`, `aura_lookup`, `item_lookup`, `match_tick`, `final_score`…), chaque fonction ayant un jumeau natif testable (27 tests). `crate nie-headless` (202 LOC) : runner CLI headless consommant nie-formats.

### Le pont C# → Rust (catalogue de formats)

À cheval sur tout le pipeline, iecode exporte un **catalogue de formats versionné** (`FormatCatalog.ToJson`, `schema_version 1`, `generator "iecode"`) via la commande `export-knowledge`, **explicitement destiné à niers** comme ancres de vérité (magics + layout de champs offset/taille/type). niers l'ingère dans `nie-seed/src/format_catalog.rs` (tables `format`/`format_field`). C'est le **pont officiel C# → Rust** déjà en place.

## 3. Tableau des duplications

### État des premiers garde-fous (2026-09-05)

- Les tables d'éléments et de catégories sont centralisées dans
  `packages/inagle/src/core/game-codes.ts` et réexportées par les adaptateurs.
- Les espaces de rareté gacha (`charaRarity`) et progression (`charaRank`) sont
  nommés séparément afin de ne pas propager une conversion ambiguë entre les
  outils.
- Le contrat TypeScript `ConfigNode` est isolé dans
  `packages/inagle/src/core/config-contract.ts`; il conserve la forme brute
  `{ entries }` et réserve `schema_version`/`buildid` à l'échange versionné.
- Le miroir wiki et l'invalidation ISR sont désormais explicitement séparés :
  `niers` publie le fichier, Azalée invalide ses pages via une route protégée.

| Capacité | Référence actuelle | Portage Rust (niers) | Statut |
| --- | --- | --- | --- |
| Téléchargement Steam natif | iecode `Steam/Content/` (SteamKit2) | `nie-steam` (steamroom) | FAIT (33 tests, fidélité C# vérifiée) |
| CPK / @UTF / CRILAYLA | iecode `Formats/Criware/CriFs/` | `nie-formats` cpk.rs/crilayla.rs | FAIT (validé byte-à-byte, 300/300 g4tx) |
| g4tx/g4md/g4mg/g4pk/g4ra/g4sk | iecode `Formats/Level5/` | `nie-formats` g4*.rs | FAIT (g4mg TODO `G4mgParser.cs:253` côté C#) |
| nxtch deswizzle (Tegra X1 GOB) | iecode `Formats/Level5/` NXTCH | `nie-formats` nxtch.rs | INCOMPLET (off-by-4, hallucination documentée) |
| cfg.bin RDBN (binaire chiffré) | iecode `Formats/Level5/CfgBin` + Rdbn | `nie-formats` cfgbin.rs | FAIT |
| cfg.bin (JSON déjà extrait) | inagle `core/parser.ts`, `cfgbin-db.ts` | `nie-data` cfgbin.rs | port (vues minimales sur JSON) |
| Modèles données (skill/item/growth/exp/passive) | inagle `src/parsers/*` | `nie-data` skill/item/growth/exp/passive.rs | 5/7 FAIT (validés byte) |
| chara_param + aura | projections SQL `inagle_characters` + `inagle_*` aura | `nie-data` chara_param.rs / aura.rs | runtime SQL unifié ; port Rust encore séparé |
| Calcul de stats (croissance 3 segments) | inagle `stat-calculator.ts` | `nie-core` stats.rs/growth.rs/exp.rs **ET** `nie-data` growth.rs/exp.rs | FAIT mais **triple implémentation** (TS + nie-core + nie-data) |
| Logique de match/gameplay | (pas de C#/TS — RE Ghidra) | `nie-core` (13 modules) | partiel (porté du C décompilé) |
| GameData persos/skills/passives | iecode `GameData/`/`Game/` **et** inagle (domaine riche) | `nie-data` | iecode délègue à inagle (reconnu) ; 7 types max en C# |
| Catalogue de formats (magics/champs) | iecode `FormatCatalog` (SOURCE) | `nie-seed` format_catalog.rs (ingest) **+** formats.rs (codé-en-dur redondant) | SOURCE iecode ; doublon à supprimer côté niers |
| Audio Criware (HCA/ACB/AWB/ADX/USM) | iecode `Audio/` | aucun module | NON PORTÉ |
| Shaders DXBC / FXBIN | iecode `Formats/` shaders | aucun module | NON PORTÉ |
| Lua (désasm bytecode, runtime) | iecode `Scripting/Lua/`, `Formats/Lua/` | aucun module | NON PORTÉ |
| Menu G4PKM / OBJB | iecode `Formats/Menu/` | aucun module | NON PORTÉ |
| Export PNG menu pour CDN | iecode `Cdn/MenuPngService` | aucun module | NON PORTÉ (prod C#) |
| Push Supabase (tables inagle_*) | inagle `cli-push.ts` (+ push-categories/lua) | aucun module | NON PORTÉ (prod TS, seul producteur) |

### Duplications internes (à résoudre avant tout schéma partagé)

- `rarityCodeToName` / `rarityToGrowthRank` : **4 copies divergentes à l'intérieur même d'inagle** (`stat-calculator.ts`, `parsers/star-sign.ts`, `parsers/chara-param.ts`, inline `cli-push`) avec mappings incohérents (5/6/7 → « Normal » vs « Légendaire »). Incohérence préexistante propagée telle quelle vers Rust.
- Enums `element` (1=Vent/2=Forêt/3=Feu/4=Montagne/5=Néant) et `category` (1=Tir/2=Défense/3=Dribble/4=Arrêt/5=Spécial) : redéfinis 3× (inagle `skills/types.ts`, nie-data, nie-core).

## 4. Sources de vérité uniques

- **Données de jeu (entités, tables)** → **inagle** : seul producteur des 44 tables `inagle_*` (Supabase), préserve les colonnes curatées (`sheet_data`/`zukan_order`), arbitre des hash→nom. azalee/cron en dépendent en dur. À conserver tel quel.
- **Catalogue de formats (magics + layout de champs)** → **iecode** `FormatCatalog`/`export-knowledge` : déjà le pont canonique C#→Rust (déclaré dans `nie-seed/format_catalog.rs`). Le catalogue codé-en-dur `nie-seed/formats.rs` doit être supprimé.
- **Formats binaires + moteur/gameplay (cible exécutable)** → **niers** : `nie-formats` (extraction Rust) et `nie-core` (moteur). À terme l'unique runtime jouable.
- **Acquisition Steam** → **nie-steam** (Rust, FAIT), iecode `Steam/Content/` devenant l'implémentation de référence/secours.
- **Carte RE de `nie.exe`** → **niers** : `.pdata` + table `coverage` de `var/niers.sqlite` (92,4464 % en DB). Le `.pdata` réfute l'index Ghidra brut.
- **Clé/crypto** → distinction unique à graver : `0x1717E18E` = clé fixe Viola des `cfg.bin` ; clé des packs `.cpk` = CRC32 dérivée du nom de fichier. niers `cpk.rs` et iecode `CLAUDE.md` la documentent en double ; corriger l'amont iecode (`NativeCrypto`/`CriCryptoService` laissent l'ambiguïté).
- **Corpus de dump réel** → `/home/ubuntu/nie/data` (`DATA_PATH` inagle), partagé par les trois (inagle = corpus parsé, niers = golden fixtures, iecode-pipeline = corpus de dev). Combiné au binaire `nie.exe` et au `FormatCatalog`, c'est la vérité terrain commune.

## 5. Plan de convergence vers Rust

### Ordre de portage restant (par `niers/docs/PLAN.md`)

- **P0** — finir le parsing déjà entamé : nxtch deswizzle (off-by-4), corriger chara_param (pairing level-first) et aura-cmd (61/1548). Lever les hallucinations documentées avant d'aller plus loin.
- **P1** — câblage runtime : relier le FSM/slots de `nie-core` aux stats/skills corrigés de `nie-data` dans une boucle de match jouable ; modèle équipe/formation ; test golden match complet ; pipeline assets visuels (g4tx→g4md→g4mg→g4sk → meshes/textures → rendu webgpu).
- **P2** — arêtes RE indirectes (vtables/.rdata) ; **audio Criware (HCA/ACB/AWB/ADX)** ; déchiffrement enveloppe CPK. C'est aussi là que se porteraient shaders, Lua et menu (aujourd'hui sans équivalent Rust).

### Ce qui reste C#/TS, et pourquoi

- **inagle (TS) reste la prod données** : seul producteur des tables `inagle_*`, préserve les colonnes curatées, azalee/cron en dépendent en dur. Convergence possible à terme : les structs no_std wasm de `nie-data` pourraient alimenter le serving azalee via `nie-wasm` (Rust devient la source, TS se retire), mais rien ne remplace encore le push Supabase.
- **iecode (C#) reste référence d'acquisition + RE-amont** : (a) implémentation de référence/secours pour Steam (déjà redondant avec nie-steam) ; (b) seule implémentation des capacités **non encore portées** : codec HCA complet, USM, shaders DXBC, Lua (désasm + runtime), menu G4PKM/OBJB, ADX, et l'export PNG menu pour le CDN. iecode reste aussi la **source unique du catalogue de formats** (`export-knowledge`).
- **iecode `GameData/`/`Game/` à figer ou retirer** : il ré-implémente le domaine d'inagle (déjà reconnu comme délégué). À figer au strict minimum (7 types) ou retirer au profit d'inagle.

### Actions de déduplication structurantes

- Faire de l'export iecode `FormatCatalog` l'**unique amont** : supprimer `nie-seed/formats.rs` (catalogue codé-en-dur redondant).
- **Dédupliquer le stat-calculator** : aujourd'hui en TS (inagle) + nie-core + nie-data. Cible : `nie-core` unique implémentation de growth/stats, `nie-data` en dépend, inagle consomme via `nie-wasm` (`calculate_stats`/`rarity_to_growth_rank`/`single_stat` déjà exposés).
- **Schéma partagé pour codes/enums** (element/category/rarity/position) : généré depuis une source unique, consommé par nie-data/nie-core/iecode — supprime la quadruple redéfinition et l'incohérence `rarityCodeToName`. **Prérequis** : corriger d'abord la dette interne d'inagle (1 seule `rarityCodeToName`, 1 seule `rarityToGrowthRank`) sinon l'incohérence se propage dans le schéma.
- **Contrat ConfigNode versionné** : factoriser `name/variables{type,value}/children` entre parseur binaire (iecode C# / nie-formats Rust) et lecteurs JSON (inagle TS / nie-data Rust), avec le buildid Steam propagé (actuellement NULL dans le RAG).
- **Documenter une seule fois la distinction des clés** dans une source partagée, en corrigeant l'amont iecode.

### État final visé

iecode = « C# de référence d'acquisition + RE » (entrée du savoir, plus l'audio/Lua/menu/shaders non encore portés). inagle = serveur de données du wiki (jusqu'à éventuelle migration vers nie-wasm). niers = moteur d'exécution full-Rust/wasm (sortie jouable). Source de vérité unique commune = le dump réel VPS + `nie.exe` + le `FormatCatalog` exporté.
