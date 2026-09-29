# iecode → inagle → Supabase → azalee — référence unifiée du pipeline data IEVR

Document de référence consolidé pour la chaîne de traitement des données du jeu **Inazuma Eleven: Victory Road (IEVR)** dans le monorepo `rg`. Il agrège trois audits lecture-seule (iecode, inagle, Supabase) réalisés le 2026-06-04, harmonisés et recoupés. Tout est ancré au réel (parsers, schéma DB live, comptes `COUNT(*)`) ; les incertitudes sont signalées explicitement. Les garde-fous ajoutés depuis l'audit sont indiqués dans les sections d'état et dans `docs/decision-archi-donnees-azalee.md`.

Références connexes existantes : `docs/inagle.md`, `docs/database.md`, `docs/wiki-filters.md`, `docs/lvl5.md`.

> **Chemins périmés** : cet audit date d'avant la fusion du wiki dans Website
> (`c8713476`) et la suppression de l'app autonome (`d74cee35`). Chaque
> occurrence de `apps/azalee/...` ci-dessous doit se lire comme
> `apps/website/...` (`wiki-service.ts`, `sqlite-client.ts`, etc. ont migré
> vers `packages/azalee/src/**`, cf. `docs/azalee-lib.md` et `docs/azalee.md`
> pour la table de correspondance et l'état courant).

PII : aucun email/nom réel de membre n'est exposé ; le handle public reste `yoyo` / `@yoyo__goat`. Les backups `apps/website/data/backups/*.sqlite` (emails membres, gitignorés comme tout `*.sqlite`) n'ont pas été lus ni touchés.

## Pipeline end-to-end

Le flux part des binaires bruts du jeu (extraits de Steam via iecode) et finit dans le wiki azalee servi sur le VPS. Chaque étage est découplé : iecode fait la RE/extraction d'assets en C#/.NET, inagle parse et calcule les entités typées en Bun/TS, cli-push projette vers Supabase, et azalee lit via un miroir SQLite embarqué. Le cron systemd orchestre push, backup et RAG.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ iecode (C# .NET 10 + pont Bun)  — RE / extraction d'assets                     │
│  Steam (App ID 2799860) ──download/dump──▶ CPK clair ──▶ cfg.bin / G4* / NXTCH │
│  IECODE.Core/Formats (CRILAYLA, @UTF, G4MD/G4MG/G4TX, cfg.bin/RDBN, HCA/ADX)   │
│  FormatCatalog.cs (31 formats, magics + offsets) ──export-knowledge──▶ niers   │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                 │ corpus parsé → /home/ubuntu/nie/data (DATA_PATH)
                                 │ (cfg.bin.json + JSON pré-traités, PAS un dump brut)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ inagle (@rosegriffon/inagle, Bun/TS) — parse / join / calcul des données      │
│  src/parsers/* ──▶ src/entities/* ──▶ stat-calculator ──▶ PostgreSQL projections │
│  createInagleService()  : characters / skills / items / auras / teams / …      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                 │ src/cli-push.ts  (commande `inagle push`)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Supabase Postgres  — stockage + RAG pgvector                                   │
│  tables inagle_* (projection, pas de FK entre elles)                           │
│  inagle_rag_chunks : embedding halfvec(1024) HNSW + content_tsv GIN            │
│  RPC rag_hybrid_search (vecteur + lexical fusionnés par RRF)                    │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                 │ `nie-miroir.timer` (publisher niers) → miroir SQLite
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ azalee (Next 16, apps/website, self-host VPS :3004) — wiki + cron              │
│  /home/ubuntu/nie/var/mirror.sqlite  (miroir canonique, chemin épinglé)      │
│  packages/azalee/src/db/sqlite-client.ts + apps/website/src/lib/wiki-service.ts ──▶ SSR wiki │
│  cron rg-cron : inagle push → publisher miroir → RAG (ie-crawl/zukan remap)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Orchestration cron (systemd `rg-cron.service`, **pas** pg_cron côté DB) : `packages/cron/src/tasks/db.ts` enchaîne `runInaglePush()` (= `bun run --filter @rosegriffon/inagle push`) puis `runSQLiteBackup()` (= `niers/scripts/donnees/miroir-inagle.sh`, validation et publication atomique du miroir). Le cron lit/écrit aussi `inagle_rag_chunks` pour le RAG et remappe l'ordre zukan via les subpaths leaf `@rosegriffon/inagle/zukan/order`.

Idempotence Steam : le pipeline iecode est gardé par le **buildid Steam** (`.build-snapshot.json`) ; côté RAG, la clé de dédup est `(source_id, content_hash)`.

---

## 1. iecode — RE / extraction des assets

Toolkit de reverse-engineering pour IEVR. Cœur **C# .NET 10 cross-platform** (`iecode/src/IECODE.{Core,CLI}`) exposé en totalité à Bun via un pont `node-api-dotnet`, plus 8 packages TS workspace (5 sous `iecode/packages/`, 3 first-class sous `packages/`). App ID Steam IEVR canonique : **2799860** (LEVEL5) ; `3593770` est un decoy (collision de nom, à ne jamais utiliser).

### 1.1 Lib C# `IECODE.Core/Formats` — formats Level-5 / Criware

Arborescence clé (`iecode/src/IECODE.Core/`) :
- `Formats/Criware/` — `UtfTable/UtfParser/UtftableParser` (@UTF), `AcbReader`, `AwbReader`, `UsmDemuxer`, et le sous-arbre **`CriFs/`** (port de CriFsLib : `CpkReader`, `AsyncCpkReader`, `Compression/CriLayla.cs`, `Encryption/{CpkDecryptionStream,CriwareCrypt,TableDecryptor,Game/P5RCrypto}`, `Utilities/Parsing/{CpkHelper,TocFinder,TocReader,TableContainerReader}`).
- `Formats/Level5/` — `G4mdParser`, `G4mgParser`, `G4txParser`, `NxtchParser`, `G4skParser`, `G4pkParser`, `G4mtParser`, `G4raParser`, `NavmParser`, `PxclParser`, `DdsParser`, `TextureSwizzler`, `AgiParser`, `P3lipParser`, `MevbinDocument`, `FxbinParser`, et le sous-arbre **`CfgBin/`** (`CfgBin.cs` 1068 l., `Rdbn/{RdbnReader,RdbnStructures}`, `Tools/{BinaryDataReader/Writer,Crc32}`, `Encryption/CriwareCrypt`).
- `Formats/Menu/` (`ObjbParser` 790 l., `G4pkmLayout`, `G4pkmMotion`), `Formats/Shader/DxbcReader`, `Formats/Lua/{LuaParser,LuaDisassembler,LuaModel,LuaConstants}`.
- `Audio/{HcaDecoder,AdxDecoder}`, `Archives/CpkService` (339 l.), `Crypto/{CriCryptoService,Crc32,Level5/XorShift}`, `Native/{NativeCrypto,NativeBinaryIO}`, `Graphics/TextureConverter`, `Converters/` (export GLB/PNG/vidéo).
- **`Formats/FormatCatalog.cs`** — registre machine-readable (voir §1.6).

**Magics et offsets documentés** (extraits des parsers réels, vérifiés octet par octet) :

| Format | Magic (LE u32 / octets) | Endianness | Notes header |
| --- | --- | --- | --- |
| CPK | `0x204B5043` `"CPK "` | mixte | suivi d'une table @UTF (CpkHeader/TOC/ETOC/ITOC), fichiers compressés CRILAYLA |
| @UTF | `0x46545540` `"@UTF"` | **Big** | table colonne/ligne CRIWARE ; magic chiffré `0xF5F39E1F` (TableDecryptor) |
| ACB | `"@UTF"` | Big | Audio Cue Bank (table @UTF racine) |
| AWB | `0x32534641` `"AFS2"` | Little | header : version, offset_size, align `@0x0C` ; blocs HCA/ADX concaténés alignés |
| CRILAYLA | `0x414C59414C495243` (8 o.) | — | LZSS ; 0x100 d'en-tête non compressé en fin de fichier ; tailles `@+8`/`@+12` |
| G4MD | `0x444D3447` `"G4MD"` | **Big→LE au load** | RE de `nie.exe FUN_14056d530` : `SubmeshInfo@0x04`, `SubmeshCount@0x20`, `MaterialCount@0x22`, `BoneCount@0x24`, `VLayoutCount@0x26`, `IndexOffset@0x3C`, `FaceDataBase@0x5C` ; record sous-maille 0x50 o. ; stride `@+0x3E` |
| G4MG | **aucun magic / headerless** | — | géométrie pure (offset 0 = float vertex) ; **indécodable seul**, requiert le `.g4md` compagnon de même basename |
| G4TX | `0x58543447` `"G4TX"` | LE | header 0x60 o. ; entries 0x30 o. (NxtchOffset/Size, Width/Height), sub-entries atlas 0x18 o. |
| NXTCH | `"NXTCH"` (5 o.) | LE | Nintendo Switch Texture Chunk ; header 44 o. ; formats BC1-BC7/RGBA8 (BC1=0x01…BC7=0x07, RGBA8=0x1F) |
| G4SK | `0x4B533447` `"G4SK"` | LE | squelette/os (parse heuristique, offsets partiels) |
| G4PK / G4PKM | `0x4B503447` `"G4PK"` (+`@`/`M`) | LE | conteneur pack ; variante M = menu layout |
| G4RA | `0x41523447` `"G4RA"` (+`` ` ``) | LE | animation |
| G4MT | `0x544D3447` `"G4MT"` | LE | matériau |
| G4NV | `0x4D56414E` `"NAVM"` | — | navmesh |
| PXCL | `0x4C435850` `"PXCL"` | — | collision |
| XFSA / XPCK | `0x41534658` / `0x4B435058` | — | archives Level-5 |
| cfg.bin (T2B) | **pas de magic** | LE | détecté par footer `01 74 32 62 [FE]` (`t2b`) dans les 32 derniers o. ; porte la quasi-totalité des données du jeu |
| RDBN | `0x4E424452` `"RDBN"` | LE | variante moderne de cfg.bin avec magic explicite |
| MEVBIN / FXBIN | footer `t2b` | LE | événements / effets |
| OBJB | `0x626A626F` `"objb"` | — | menu objects |
| DDS / DXBC | `0x20534444` / `0x43425844` | LE | texture standard / shader bytecode |
| AGI / P3LIP | `0x4147492E` `".AGI"` / `"lip\0"` | — | |
| LUA | `0x61754C1B` `"\x1bLua"` | — | bytecode Lua (désassemblé par LuaDisassembler) |
| HCA | `"HCA\0"` (`0x48434100` BE, octets masqués `0x7F`) | Big | CRI audio ; chunks fmt/comp/ciph/loop ; cipher 0=none/1=static/56=key56 |
| ADX | `0x80 0x00` | Big | décodage PCM16 natif type 0x02 implémenté |
| USM | `0x44495243` `"CRID"` | Big | conteneur vidéo (démux @SFV/@SFA) |

**Crypto CRIWARE/Level-5 (constantes réelles, exploitables)** : `NativeCrypto.IEVRCriKey = 0x1717E18E` (clé XOR par défaut IEVR) ; clé dérivée par fichier via CRC32 (`Crc32Polynomial = 0xEDB88320`, init `0xFFFFFFFF`) sur le **basename** (`CalculateKeyFromFilename`) ; déchiffrement position-based seekable (`CpkDecryptionStream`). Table @UTF chiffrée : magic `0xF5F39E1F`, XOR `0x655F` × multiplicateur `0x4115` (SIMD AVX2/SSE dans `TableDecryptor`).

### 1.2 Automatisation Steam (download/dump natif, SANS steamcmd)

`IECODE.Core/Steam/Content/` sur **SteamKit2 3.4.0** : `Steam3Session` (login CM + 2FA), `SteamDepotResolver` (logique pure testée), `SteamDepotDownloader` (manifests + chunks CDN + déchiffrement, écrit au format d'install Steam), `CdnClientPool`, `SteamTokenStore` (cache refresh token → runs suivants non-interactifs ; défaut `~/.local/share/iecode/steam-tokens.json`). `GetBuildIdAsync()` = check d'update rapide (login + app info, aucun download). Identifiants via `.secrets/steam.env` (`STEAM_USER`/`STEAM_PASSWORD`), `STEAM_GUARD_CODE` au 1er login. Modules Windows-only (`EOS/`, Steam EncryptedAppTicket) gardés `[SupportedOSPlatform("windows")]`.

### 1.3 Pont Bun ↔ .NET

`@rosegriffon/iecode-core` (`iecode/packages/core/src/index.ts`) : `loadIecode()` charge `IECODE.Core.dll` (Release net10.0) via `node-api-dotnet` et **fusionne tous les namespaces** → `dotnet.IECODE.Core.*` + `dotnet.System.*` accessibles depuis Bun (pas de `bun:ffi`). Pièges baked-in : pose `DOTNET_ROLL_FORWARD=LatestMajor` avant l'init CLR (le host cible net8/9), résolution des assemblies dépendantes (ImageSharp/EF/SharpGLTF) via listener `resolving` sur le dossier de build, `CopyLocalLockFileAssemblies=true` requis sinon échec de résolution. Typedefs générés par `gen:types` (assainit le TS invalide des constructs C#).

### 1.4 CLI `iecode` (`IECODE.CLI/Program.cs`, System.CommandLine)

~40 sous-commandes. Acquisition/data : `info`, `download <appId> [-o] [--list] [--branch] [--os] [--depot] [--token-store]`, `steam-build`, `sync` (download+dump), `dump` (extraction CPK sélective, `--preset --smart`), `extract`, `pack`, `pipeline`, `dump-gamedata`, `generate-gamedata-classes`. Formats : `g4tx`, `g4pk`, `g4md`, `g4mg`, `g4ra`, `utf`, `audio`, `usm`, `convert`, `format`, `shader`, `lua`, `menu`, `mevbin`, `p3lip`, `agi`, `scene`, `crypto`, `config`/`cfg`, `analyze`, `search`, `mem`, `cdn`, `benchmark`, `passive-skill`, **`export-knowledge`** (→ JSON catalogue pour niers).

### 1.5 Flow data headless (`@rosegriffon/iecode-pipeline`)

Unifie **acquire** (steam-sync : download depots + dump CPK) + **parse/serve** (délégué à `@rosegriffon/inagle`, ~50 cfg.bin, 12 domaines, 6000+ persos / 2900+ skills — **non dupliqué en C#**), gardé par le **buildid Steam** (idempotence via `.build-snapshot.json`). API : `accumulate()` (check build → download+dump si update → corpus), `exportCorpus()` (chaque domaine → `<domaine>.json` + `corpus.json`), `serve()` (HTTP inagle headless), `getRemoteBuildId()`. CLI `iecode-data accumulate|export|serve|version`. Données de dev : `/home/ubuntu/nie/data` (corpus parsé, **PAS** un dump Steam brut). `@rosegriffon/iecode-steam-sync` pilote le CLI natif (`syncApp`/`listDepots`) + scrape store via `@aphrody-code/bxc`. Packages annexes : `iecode-cdn` (résolveur G4TX→PNG lossless pour `cdn.rosegriffon.fr/dx11/menu/**`), `iecode-runtime-harness` (exécution live headless — RE mémoire uniquement, **pas requis** par le pipeline data), `menu-render` (renderer React pixel-perfect des écrans menu depuis menu-layout.json), `iecode-inagle`, `iecode-config`.

### 1.6 Capacités réelles vs gaps, et exploitable par niers

**`FormatCatalog.cs` = artefact d'interop canonique vers niers** : 31 formats documentés (`CPK @UTF ACB AWB G4PK G4PKM G4RA XFSA XPCK G4MD G4MG G4MT G4SK G4NV PXCL G4TX NXTCH DDS DXBC AGI P3LIP cfg.bin RDBN MEVBIN FXBIN OBJB LUA CRILAYLA HCA ADX USM`), schéma JSON versionné (`SchemaVersion=1`, AOT source-generated), avec par format : nom, catégorie, extensions, magic ASCII + `MagicHex` u32, endianness, header size, description FR, **chemin du parser de référence** et layout des champs. Exporté via `iecode export-knowledge --out <fichier>`. Conçu explicitement comme « ancres de vérité » pour niers. **Aucun JSON pré-généré n'est commité** (à régénérer via la CLI).

**Capacités C# confirmées** : CPK **clair** (TOC @UTF + décompression CRILAYLA + déchiffrement XOR position-based), @UTF/ACB/AWB(AFS2), audio HCA (parsing header réel ; **décodage PCM délégué à vgmstream-cli en sous-process**, le port MDCT C# n'est pas fait) + ADX (PCM16 natif), géométrie G4MD+G4MG (positions float3, normales SNORM16 vtype=2, UV0 vtype=10/14, indices u16/u32), textures G4TX→NXTCH→DDS/PNG (BCn deswizzle), G4SK (heuristique), cfg.bin/RDBN, OBJB/PXCL/XFSA/XPCK, shaders DXBC, navmesh/collision, Lua disasm.

**Gaps / NON_FAIT (iecode)** :
- **CPK chiffré** : `P5RCrypto` (Persona 5 Royal, offset `0x20`, `0x400` o.) est présent mais c'est un crypto **spécifique à un autre jeu** — pas un déchiffreur CPK chiffré générique IEVR validé.
- **HCA** : pas de codec PCM pur C# (MDCT inverse) — dépendance externe vgmstream pour le WAV.
- **G4MG sans `.g4md`** : impossible par construction (headerless) ; `ParseMeshes` lève `NotSupportedException` explicite.
- **G4SK** : offsets « unknown/confusing », parse heuristique (hiérarchie d'os partielle).
- **`dump-gamedata`** ne couvre que ~7 types (inagle couvre tout le reste).
- Les binaires bruts (`.cpk`/`.g4mg`) sont **ABSENTS du VPS** (`/home/ubuntu/nie/data` = corpus parsé) → tout RE additionnel sur G4MG/Player champs interdit de stub spéculatif à l'aveugle.

**Incertitudes signalées** : G4MG n'expose que le 1er layout vertex quand `VLayoutCount` > attributs de la 1re table (limite assumée dans le code) ; plusieurs champs de headers G4TX/G4SK restent `Unknown*`.

**Déjà exploité côté niers** (`/home/ubuntu/nie/crates/nie-formats/`) : crates Rust pour `crilayla, cpk, cfgbin, g4md, g4mg, g4pk, g4sk, g4tx, nxtch` ; `nie-seed/src/formats.rs` réimplémente le catalogue iecode en table `FormatDef` (magic + doc path) sourcée sur `FormatDetector.cs` et les parsers Level-5/Criware. La boucle RE est donc déjà câblée — le décodeur CRILAYLA (bitstream fibonacci LZSS, copie depuis la fin), les offsets G4MD/G4TX/NXTCH et la clé `0x1717E18E` sont directement portables (cf. §4 Recoupements).

Fichiers de référence (absolus) : `/home/ubuntu/rg/iecode/src/IECODE.Core/Formats/FormatCatalog.cs`, `.../Formats/Criware/CriFs/Compression/CriLayla.cs`, `.../Formats/Level5/G4mgParser.cs`, `.../Formats/Level5/G4mdParser.cs`, `.../Native/NativeCrypto.cs` (clé `0x1717E18E`), `.../Steam/Content/SteamDepotDownloader.cs`, `/home/ubuntu/rg/iecode/packages/core/src/index.ts` (pont Bun), `/home/ubuntu/rg/iecode/src/IECODE.CLI/Program.cs` (CLI), `/home/ubuntu/rg/iecode/packages/pipeline/src/index.ts`, et côté niers `/home/ubuntu/nie/crates/nie-formats/` + `/home/ubuntu/nie/crates/nie-seed/src/formats.rs`.

---

## 2. inagle — parse / calcul des données

API universelle de données de jeu pour IEVR. Package `@rosegriffon/inagle` v1.2.0 (`packages/inagle`), **package émetteur** (`tsc` → `dist/` + subpath exports `./*`, son `dist/` doit exister sinon `rg-cron` et `azalee-web` cassent). Bun-natif (`Bun.file`, `Bun.Glob.scanSync`, `bun:sqlite`). Rôle : transformer le dump cfg.bin du jeu (`/home/ubuntu/nie/data`) en entités typées, puis pousser vers Supabase d'où azalee lit via un miroir SQLite embarqué.

### 2.1 Flux de données global

```
/home/ubuntu/nie/data (DATA_PATH)              cfg.bin.json + JSON pré-traités
   └─ common/gamedata/<cat>/*.cfg.bin.json    (sources brutes du dump)
   └─ common/text/<locale>/*.cfg.bin.json     (localisation)
   └─ all-gamedata/*.json                      (JSON pré-extraits : growth_tables, exp_table, starSignCharaInfo…)
   └─ zukan/*.json                             (mapping/ordre officiel zukan.inazuma.jp)
        │
        ▼   src/parsers/*  → src/entities/*  (parse + join + stats)
   createInagleService()  (src/service.ts)     service en mémoire : characters/skills/items/auras/teams/drops/quests…
        │
        ▼   src/cli-push.ts  (cron `--run` → push)
   Supabase Postgres  (tables inagle_*)
        │
        ▼   `nie-miroir.timer` / `miroir-inagle.sh`
   /home/ubuntu/nie/var/mirror.sqlite  (MIROIR SQLite canonique, publié atomiquement)
        │
        ▼   packages/azalee/src/db/sqlite-client.ts + apps/website/src/lib/wiki-service.ts
   Wiki azalee (SSR Next 16, apps/website, :3004)
```

`DATA_ROOT` est résolu dans `src/core/paths.ts` : `DATA_PATH` env (azalee `.env` = `/home/ubuntu/nie/data`) → sinon `packages/inagle/data` → sinon `cwd/data`. Les chemins par catégorie sont dans `PATHS` ; les fichiers connus (versionnés) dans `FILES`. `resolveGameDataFile(relDir, baseName)` choisit la **version la plus haute** par tri numérique segment-par-segment (regex `^<base>_\d[\d.]*\.cfg\.bin\.json$`, qui empêche les collisions de préfixe comme `chara_param` captant `chara_param_table_config`).

Option `cfgbin-db` (`src/core/cfgbin-db.ts`) : une DB SQLite `~/data/cache/cfgbin.sqlite` (~2.3 Go, produite par le toolkit iecode) remplace les loose `.cfg.bin.json` pour l’extraction/dev. Le runtime tente PostgreSQL puis SQLite ; la lecture de fichiers JSON libres est désactivée par défaut et ne s’active qu’avec `IEVR_ALLOW_LOOSE_JSON=1`. Les fichiers texte restent soumis au garde-fou `IEVR_CFGBIN_DB_TEXT=1` tant que le parseur SQLite local n’est pas corrigé.

### 2.2 Parseurs (`src/parsers/`)

Format source : nœuds `ConfigNode { name, variables[], children[] }` issus du cfg.bin décodé. Chaque variable a `{ type: "Int"|"String"|"Float", value: string }`. Les hash sont des int 32 bits signés convertis en hex via `toHex()` (négatif → `>>> 0`, MAJUSCULE, padStart 8). Convention de clé : `0x` minuscule + corps MAJUSCULE (ex. `0x0F8C620D`).

- **chara-param.ts** — parse `CHARA_PARAM_INFO_*` (exclut `LIST`/`BEG`). Indices validés sur persos connus :
  - `[0]` charaParamId (hash variante), `[1]` charaBaseId, `[2]` element (1=Vent, 2=Forêt, 3=Feu, 4=Montagne), `[3]` mainPosition (1=GK, 2=FW, 3=MF, 4=DF), `[4]` subPosition, `[8]` growthPattern (0/1).
  - **Skills : 9 slots, LEVEL-FIRST depuis l'index 10** : `[10]` niveau slot1 (pairs 10..26), `[11]` hash slot1 (impairs 11..27). Piège corrigé : l'ancienne lecture 6 slots hash-first @9 tronquait/désalignait pour TOUTES les versions (normale/héros/basara). La validation se fait sur le **niveau** (0..99), pas sur le hash.
  - `charaRank` n'est **PAS** ici : il vient de `starSignCharaInfo`.
  - Détection format V2 (8 variables, `[6]==[0]`) → `charaBaseId = charaParamId`.
  - Helpers exposés : `positionIdToCode`, `elementIdToNames`, `rarityCodeToName`.
- **chara-base.ts** — `CHARA_BASE_(INFO|BATTLE)_\d+`. Offsets : `[0]` charaId, `[1]` internalCode (String, ex `c01000100`/`npc0010`), `[3]` nameHash (prénom), `[4]` lastNameHash (nom de famille), `[11]` gender (1=M, 2=F), `[15]` seriesId, `[16]` belongTeamId, `[19]` descriptionHash.
- **skill-config.ts** — techniques actives. Charge et **fusionne TOUS** les `skill_config_*.cfg.bin.json` triés (v4 base + v5 supplément DLC Orion), via `m_skillInfoList`. Les versions **antérieures sont prioritaires** (`byId.has → skip`). Mappings : element `1=Vent/2=Forêt/3=Feu/4=Montagne`, category `1=Tir/2=Défense/3=Dribble/4=Arrêt/5=Spécial`. Power `{power_min, power_max}`, `consumeTp`, `difficulty`. Versions sync dépréciées (throw).
- **passive-skill-config.ts** — passifs joueur (`PASSIVE_SKILL_INFO_*`) + passifs d'équipe (`m_soccerTeamPassiveDataList` dans `soccer_team_passive_config`). Pass 1 collecte `PASSIVE_SKILL_EFFECT_*` (effectId → params), pass 2 join skills. Offsets passif : `[0]` passiveId, `[1]` effectId, `[2]` nameId, `[3]` descId, `[4]` rarity. `scope: "player"|"team"`. Texte via `skill` + `soccer_passive`.
- **chara-exp-table.ts** — `m_charaExpTableList` (level, needExp) + `m_expRarityRateList` (rarity 0-8 = growthRank → rate ; 0-3 → ×1, 4-8 → ×3). API : `getExpForLevel`, `getCumulativeExp`, `getRarityRate`.
- **item-config.ts** — items via `CATEGORY_MAP` (préfixe → catégorie). Offsets : `[0]` itemId, `[2]` nameId, `[3]` descId, `[4]` prix d'achat, `[5]/[6]` stat_boost (shoes/misanga/accessory/special/fashion), `[11]` internalCode, dernier var = uniformId (fashion). Shops natifs depuis `shop_config`.
- **star-sign.ts** — rareté depuis `players_universe_config` (`m_starSignCharaInfoList`), fallback `starSignCharaInfo.json`. Codes gacha : 0=Normal, 2=Expérimenté, 5/6/7=Légendaire ; BASARA (code 20) **injecté** depuis `basaraBuildInfo.json`. Expose `rarityCodeToName` et `rarityToGrowthRank` (variante propre, voir §2.4).
- Autres parseurs (~70) : `growth-table-config`, `ctrl-chara-config`, `hero-config`, `constellation`, `belong-team` (team + series), `chara-description`, `chara-text`, `chara-details`, `change-aura-skill-config`, `override-skill-config`, `uniform-config`, `gallery/capsule/costume/opponent-team/quest/trick/...`, plus le décodeur binaire `binary/cfgbin-parser.ts` et `binary/g4tx-parser.ts`.

### 2.3 Entité Character (`src/entities/character.ts`) et mapping

`loadAllCharacters()` est le join central :
1. `parseAllCharaBase()` → maps charaId → {nameHash, lastNameHash, descHash, internalCode, gender, seriesId, belongTeamId}.
2. `parseAllCharaParams()` → une entrée par variante (charaParamId).
3. `buildAllNameMaps()` (chara_text) résout les noms localisés ; nom complet = `prénom + nom` par locale.
4. `buildStarSignMap()` donne `charaRank` (rareté). `buildConstellationMapping`, `buildTeamMapping`, `buildSeriesMapping`, `loadZukanMapping/Order`, `loadHeroConfig`, `parseCharaDetails`, `loadCtrlCharaConfig`.
5. `buildCharacter(param, …)` produit le `Character` : position, element (EN), rareté (`rarityCodeToName`), gender (chara_base 2→1, sinon 0), stats multi-niveaux, slug (`<nom>-<charaParamId>`).

Enrichissements : variantes héros (Fire/Black/Pink) taggées → rareté "Héros" (code 10) ; controllables (`ctrl_chara_config`) ; pronouns/personnalité (chara_details) ; **backfill stats lv99 depuis le Zukan** (`chara.json`) si lv99.kick==0 ; `zukanHash`/`zukanOrder` ; series (field[15] cfg.bin **autoritaire**, fallback préfixe code `c01..c12/npc`). `preloadCharacterEnrichment()` (appelé par le service) charge ctrl-chara + growth lv1 dans des caches sync avant le build.

`loadBaseCharacters()` regroupe par charaId puis **fusionne par nom** (formes de Mark Evans réunies), trie variantes par âge (zukanOrder), tri final par meilleure rareté.

### 2.4 Stat-calculator (`src/stat-calculator.ts`)

Pur (découplé du FS). Stats : `Kc Cr Tc Pr Ps Ag It` (Kick/Control/Technique/Power/Pressure/Agility/Intelligence).

- **3 tables de croissance** : `lv1` (par mainPosition/subPosition/playStyle), `lv30` (+ growthPattern + charaRank), `main` (lv50 + lv99 par mainPosition/growthPattern/charaRank).
- **Interpolation** `calculateSingleStat` : paliers 1→30 (`(lvl-1)/29`), 30→50 (`(lvl-30)/20`), 50→99 (`(lvl-50)/49`), `lerp` avec `Math.floor`.
- **Lookups avec fallbacks en cascade** : pattern exact → si pattern≥2 retombe sur pattern 0 → subPosition 0 → charaRank 0 (Normal) → mainPosition seul. La growth table ne contient que **patterns 0 et 1**.
- **`rarityToGrowthRank(code)`** : 0→0, 2→2, 3→3, 4→4, 5→5, **6/7/20→5** (LR/Legend/BASARA utilisent les stats UR). Piège : **deux implémentations** coexistent — `stat-calculator.ts` ET `parsers/star-sign.ts` (les entités importent celle de star-sign). Idem `rarityCodeToName` triple (chara-param, star-sign, et inline cli-push) avec mappings légèrement différents (ex. `chara-param` mappe 5/6/7→"Normal", `star-sign`→"Légendaire") — incohérence préexistante à connaître, non corrigée (lecture seule).

### 2.5 Résolution auras/hissatsu depuis SQL JSONB

Les configurations d’aura sont importées une fois dans les projections PostgreSQL (`inagle_auras`, `inagle_keshins`, `inagle_souls`, `inagle_miximax`, `inagle_awakenings`, `inagle_mode_changes`). Les lectures runtime utilisent les colonnes et le JSONB `data/sheet_data`, jamais les fichiers JSON du dump.

**Hissatsu SQL** : la projection conserve `{ skillId, skillIdStr, name, type, element, power{min,max} }` dans `data/sheet_data`. Les champs absents restent `undefined` : aucune valeur n’est inventée et le runtime ne relit aucun fichier de configuration.

La séparation skills/auras est dérivée des mêmes projections SQL par `service.skills.auraAll()`. L’ensemble des identifiants est partagé par le CLI et le renderer, sans mapper JSON dédié.

### 2.6 Service (`src/service.ts`)

`createInagleService()` (async) : `preloadCharacterEnrichment()` puis assemble les sous-APIs `basara/characters/items(async)/skills/teams/menu/drops/quests/images/search` + `parsers` (lazy : gallery, capsules, costumes, expTable, growthTable, tricks, opponents, ctrlChara) + `evolution`. C'est l'objet consommé par `cli-push` et par le test d'intégration. Images via `NEXT_PUBLIC_ASSET_URL` (CDN `azalee.rosegriffon.fr`).

### 2.7 cli-push.ts (push vers Supabase)

Commande `inagle push` (`registerPushCommand`). Deux adapters : `SupabaseAdapter` (API, génère un token service_role depuis `JWT_SECRET` si besoin) et `PostgresAdapter` (DB directe, upsert chunké 50, `ON CONFLICT DO UPDATE`). Garde-fous env : rejette les blobs scellés (`startsWith("eyJ2Ijo")`). Importeurs : characters, skills, items, passives, auras, teams, formations, quests, drops, gallery, costumes, opponent-teams, capsules, exp-table, growth-tables, + export story-text.

Points sensibles :
- **Préservation des colonnes curatées hors-pipeline** : avant `delete+reinsert`, snapshot de `sheet_data` + `zukan_order` (characters) et `sheet_data` (items), réinjectés par id pour ne pas écraser la donnée communautaire/officielle. Les movesets natifs sont fusionnés dans `sheet_data`.
- **Séparation skills/auras** dans chara_param : l’ensemble issu de `service.skills.auraAll()` sépare les slots ; on retire aussi `0x00000002` (sentinelle). `data` JSONB porte `{...c, skills, auras}`.
- **Auras** : les projections SQL sont la source unique ; `sheet_data.hissatsu` est conservé et consommé par `getAura`, réparti par sous-type vers les tables `inagle_*`.
- Skills filtrés : exclut catégories passif (6/"Passive") et stat-boost (9). Vidéos depuis `skill-videos.json` (`.wmv`→`.webm`).

Déclenché par cron : `packages/cron/src/tasks/db.ts` → `runInaglePush()` = `bun run --filter @rosegriffon/inagle push`, puis `runSQLiteBackup()` = `niers/scripts/donnees/miroir-inagle.sh`, qui valide et republie le miroir SQLite canonique. `backup:supabase` reste disponible pour fabriquer un snapshot local de secours, hors chemin de production.

### 2.8 Consommation par azalee + cron

- **azalee n'importe PAS le runtime de parsing** (`createInagleService`) — il importe seulement les **types** et constantes (`apps/website/src/lib/wiki-service.ts` : `import type { BaseCharacter, Item, Skill, Team }`, `ElementNames`, `CATEGORY_NAMES`, et le JSON `change_aura_skills.json`). La donnée vient des **tables `inagle_*`** lues via `packages/azalee/src/db/sqlite-client.ts` (miroir canonique `/home/ubuntu/nie/var/mirror.sqlite`, override `SQLITE_DB_PATH`) ou Supabase. `wiki-service.ts` est la couche d'accès (listes/filtres/getAura/getSkill…).
- **cron** consomme inagle de deux façons : (a) exécute le push (`db.ts`) ; (b) importe des subpaths leaf (`@rosegriffon/inagle/zukan/order` pour `buildOrderMap`/`crawlZukanOrderPages`) et lit/écrit les tables `inagle_characters/inagle_skills/inagle_rag_chunks` pour le RAG et le remap zukan. Le `dist/` d'inagle doit exister (subpath exports) sinon `rg-cron` crash-loop.

**Piège NULL `category_id`/`element_id`** : sur `inagle_skills`, `category_id` et `element_id` sont à **NULL** en base. La résolution se fait via les **colonnes texte FR** : `wiki-service.ts` filtre `query.eq("category", searchCat)` (ligne ~1497) après mapping `shoot/block/dribble/catch` → nom FR via `CATEGORY_NAMES`. À noter : pour les **auras** (`inagle_auras` etc.), `element_id` **est** peuplé et filtré via `.eq/.in("element_id", …)` avec `getElementIds()` (Néant mappe 0 ET 5) — spécifique aux auras, pas aux skills. Voir `docs/wiki-filters.md`.

### 2.9 Test d'intégration unifié

`src/azalee-inagle-integration.test.ts` (`bun test packages/inagle/src/azalee-inagle-integration.test.ts`), timeout 120 s (parse réel ~50 cfg.bin, 6000+ persos). 5 tests, ancrés au **réel** :
1. `chara_base` existe via `Bun.file` (>100 Ko, `entries`, BEG node >1000 enfants).
2. Miroir SQLite le plus récent existe (>10 Mo).
3. `service.characters.all()` >1000 et trouve Mark Evans + Axel Blaze par nom FR/EN.
4. Alignement parse ↔ SQLite : `COUNT(*) inagle_characters` ≥ parsed, skills >0.
5. Lance la suite native `azalee test` via `Bun.spawn` et exige `"TOUTES LES SUITES DE TESTS NATIVES ONT RÉUSSI"`.

### 2.10 Pièges connus (synthèse inagle)

- chara_param skills = **9 slots level-first @10** (jamais hash-first @9).
- `rarityToGrowthRank` / `rarityCodeToName` **dupliqués** entre `stat-calculator`, `star-sign`, `chara-param`, inline cli-push — mappings non strictement identiques (préexistant).
- charaRank vient de **starSignCharaInfo**, pas de chara_param ; BASARA injecté depuis `basaraBuildInfo.json`.
- skill_config/passive : **fusion multi-versions, antérieures prioritaires** (override skip).
- text cfgbin-db reste **explicitement activable** via `IEVR_CFGBIN_DB_TEXT=1`; aucun fallback JSON libre n’est utilisé par défaut.
- skills/auras **partagent les slots** chara_param → séparation par l’ensemble des identifiants de `service.skills.auraAll()`.
- cli-push **préserve** `sheet_data`/`zukan_order` avant delete+reinsert (donnée curatée communautaire/officielle).
- `inagle_skills.category_id`/`element_id` = **NULL** → filtrer via colonne texte FR `category` ; les auras, elles, utilisent `element_id`.
- ne jamais committer `apps/website/data/backups/*.sqlite` (PII emails, gitignoré).

Fichiers clés : `packages/inagle/src/parsers/{chara-param,chara-base,skill-config,passive-skill-config,chara-exp-table,item-config,star-sign}.ts`, `src/entities/character.ts`, `src/stat-calculator.ts`, `src/service.ts`, `src/cli-push.ts`, `src/core/{paths,data-loader,cfgbin-db}.ts`, `src/azalee-inagle-integration.test.ts` ; consommateurs : `apps/website/src/lib/wiki-service.ts`, `packages/azalee/src/db/sqlite-client.ts`, `packages/cron/src/tasks/db.ts`.

---

## 3. Supabase (DB) — stockage + RAG

Audit lecture seule de la base Postgres Supabase du monorepo `rg`, réalisé via MCP `mcp__supabase__*` (live, 2026-06-04). Counts = `COUNT(*)` réels. Aucune donnée membre (email/nom) lue : schéma + comptes uniquement. Handle public = `yoyo` / `@yoyo__goat`.

Note : la colonne `rows` de `list_tables` est une estimation de l'optimiseur (parfois 0 ou périmée) ; les comptes ci-dessous proviennent de `COUNT(*)` explicites. C'est pourquoi `inagle_tactics` apparaît à 0 dans `list_tables` mais contient bien 70 lignes.

### 3.1 Tables clés et schéma

Schéma `public`, **~95 tables**, RLS activé sur toutes. Quatre domaines : données de jeu `inagle_*` (poussées par le CLI inagle), CMS/articles, e-commerce `orders` + `patreon_*`, auth better-auth + profils/Discord.

#### inagle_characters — 6 148 lignes (55 jouables `is_controllable=true`)
PK `id text`. Colonnes principales : `chara_id`, `internal_code`, noms `name_fr/en/ja`, descriptions `description_fr/en/ja`, `rarity` + `rarity_code int` + `rarity_label`, `element_id int` + `element text`, `position_id int` + `position text`, `gender`, `image_url`, `series`, `slug`/`base_slug`, `team_id`, `model_id`, `zukan_hash`/`zukan_order`, `constellation`(+`_index`), `control_type`, `hero_type`, `is_primary`, `game_appearances text[]`.
Stats à plat : `stat_frappe/controle/technique/pression/physique/agilite/intelligence` (+ `stat_total`) et la variante `stat_lv1_*`. Blobs : `sheet_data`, `stats`, `skills`, `teams`, `data` (tous `jsonb`). Index btree sur `element`, `gender`, `is_controllable`, `position`, `rarity_label`, `series`, `zukan_order`, `internal_code`, + index d'expression `(sheet_data->>'playstyle')`.

#### inagle_skills — 1 002 lignes
PK `id text`. `internal_code`, noms/descriptions tri-langue, `category_id int` + `category text`, `element_id int` + `element text`, `power_min/max`, `tension_cost`, `tp_cost`, `recast_time`, `foul_rate`, `partner_count`, `is_hyper bool`, `is_eldorado bool`, `evolution_type`, `growth_type`, `skill_effect_bit_flag`, `hash_id`, `has_telop bool NOT NULL` (migration `20260603185240`), `tags text[]`, médias `image_url/video_url/poster_url`, blobs `sheet_data`/`data` jsonb.
Confirmation du piège CLAUDE.md : **`category_id` et `element_id` sont NULL sur les 1 002 lignes** (`skills_null_catid=1002`). Filtrer impérativement via les colonnes textuelles FR `category`/`element`.

#### inagle_tactics — 70 lignes
**PK = `name text`** (pas `id`). Colonnes : `id text` (nullable, non-PK), `internal_code`, `name_fr`/`name_ja`, descriptions tri-langue, `element_id`+`element`, `power`, `effect1/2/3`, `duration`, `cooldown`, `recast_time`, `partner_count`, `partner_ids jsonb`, `shop`, `image_url`.

#### inagle_rag_chunks — 8 815 lignes (store RAG, détaillé §3.3)
PK `id text`. `source_id`, `source_kind`, `title`, `url`, `lang`, `content text NOT NULL`, `content_tsv tsvector`, `embedding halfvec(1024)`, `meta jsonb NOT NULL`, `content_hash text NOT NULL`, `buildid int8`, `created_at`.

#### inagle_game_assets — 40 471 lignes (annexe assets, peuplée)
PK `path text`. `cpk`, `kind`, `sha256`, `size int8`, `buildid int8`, `bucket`, `exists bool NOT NULL`. Tous `exists=true`. Répartition `bucket` : `icon_chr` 36 664, `220_img` 2 389, `200_icon` 1 375, `210_minimap` 41, `movie` 2. Index btree sur `bucket` et `exists`.

#### articles / news — `articles` 3 lignes
PK `id uuid`, `slug` unique. `title`, `excerpt`, `content NOT NULL`, `featured_image_url`/`_alt`, `category`, `tags text[]`, `meta_title`/`meta_description`, `status`, `published_at`/`scheduled_at`, `author_id uuid`, `co_authors jsonb`, `series_id uuid`+`series_order`, `view_count`, `share_count`, `pinned`, `app text NOT NULL` (sépare website/azalee, migration `add_app_column_to_articles`), `search_vector tsvector`. Index sur `app`, `(series_id, series_order)`, `(status, published_at DESC)`.
Écosystème CMS associé (tous 0 sauf indiqué) : `article_categories`, `article_series`, `article_comments`, `article_reactions` (2), `article_bookmarks`, `comment_reports`, `chronicles`, `patch_notes`, `topics`, `reading_history` (2), `share_tracking`, `events`, `stream_schedules`, `team_members` (129), `tweets` (3 154).

#### orders (shop Stripe) — 0 ligne
PK `id uuid`, `stripe_session_id NOT NULL`. Montants en centimes `amount_subtotal/discount/shipping/tax/total_cents`, `patron_discount_applied bool`, `promotion_code`, `items jsonb NOT NULL`, `status NOT NULL`, livraison `shipping_address jsonb`/`shipping_name/email/phone`, suivi `tracking_number/carrier`, jalons `paid_at/shipped_at/delivered_at/refunded_at`. Commentaire DB : miroir local des Checkout Sessions Stripe, source de vérité = Stripe. (Migrations `create_orders_table_shop_stripe_mirror` + doublon `20260517_create_orders`.)

#### Tables auth (better-auth) + profils membres
- `user` (33) : `id text`, `name NOT NULL`, `email NOT NULL`, `email_verified`, `image`, `two_factor_enabled` + `two_factor_secret`/`two_factor_backup_codes`. **PII** (non lue).
- `account` (8) : liaison provider OAuth — `access_token`/`refresh_token`/`id_token`/`password` (secrets, non lus).
- `session` (57) : `token`, `expires_at`, `ip_address`, `user_agent`.
- `verification` (0) : `identifier`/`value`/`expires_at`.
- `profiles` (0 peuplées) : PK `id uuid`, `username`, `email`, `full_name`, `avatar_url`/`banner_url`, `bio`, `role`, `website`, adresse postale (`address_line1/2`, `city`, `postal_code`, `country`), `discord_id`, `twitter_handle`, `patreon_id`, `badges text[]`. **PII** (non lue).
- `discord_members` (2 137) : `discord_id` PK, `username`, `display_name`, `nickname`, `avatar_url`, `joined_at`, `premium_since`, `roles text[]`, `is_bot`. Sync cron Discord. **PII membre** (non lue). Complété par `discord_roles` (93), `discord_sync_logs` (127).
- Patreon : `patreon_oauth_tokens` (2, tokens chiffrés AES-256-GCM), `patreon_memberships` (11), `patreon_post_events` (34), `patreon_post_images` (26), `patreon_webhook_state` (1), + `patreon_legacy_members/tiers`, `patreon_webhook_events`, `patreon_admin_owners` (0).
- Agent/IA (better-auth agent plugin) : `agent`, `agentHost`, `agentCapabilityGrant`, `approvalRequest` (0 chacune).

### 3.2 Extensions

`installed_version` non-NULL = réellement activées :

| Extension | Version | Schéma | Rôle |
| --- | --- | --- | --- |
| **vector** (pgvector) | **0.8.0** | `public` | type `vector`/`halfvec`, index ivfflat + **HNSW** (sous-tend le RAG) |
| pg_trgm | 1.6 | `public` | similarité trigram |
| pgcrypto | 1.3 | `extensions` | fonctions crypto |
| uuid-ossp | 1.1 | `extensions` | génération UUID |
| pg_stat_statements | 1.11 | `extensions` | stats requêtes |
| supabase_vault | 0.3.1 | `vault` | secrets Supabase |
| pgsodium | 3.1.8 | — | libsodium |
| plpgsql | 1.0 | `pg_catalog` | PL/pgSQL |

Toutes les autres (postgis, pg_cron, pgmq, pg_graphql, http, etc.) sont **disponibles mais non installées** (`installed_version=null`). À noter : **pg_cron n'est pas activé** — l'ordonnancement cron du monorepo passe par systemd (`rg-cron.service`), pas par la DB.

### 3.3 Store RAG

Migrations `20260603120209 unified_rag_pgvector` + `20260603185129 enable_rls_readonly_inagle_rag_chunks_game_assets`.

- **Colonne embedding** : `embedding halfvec(1024)` — pgvector half-precision, dimension **1024**. Les 8 815 lignes sont embeddées (`rag_embedded=8815`, aucun NULL).
- **Full-text** : `content_tsv tsvector`, peuplée sur 100% des lignes.
- **Index** :
  - `inagle_rag_chunks_emb_hnsw` : **HNSW** sur `embedding` avec `halfvec_cosine_ops` (cosinus).
  - `inagle_rag_chunks_tsv_gin` : GIN sur `content_tsv` (lexical).
  - `inagle_rag_chunks_meta_gin` : GIN `jsonb_path_ops` sur `meta`.
  - `inagle_rag_chunks_kind` : btree sur `source_kind`.
  - `inagle_rag_chunks_dedup` : UNIQUE `(source_id, content_hash)` — déduplication idempotente du push.
- **RPC** : `public.rag_hybrid_search(q_text text, q_emb halfvec, k int, kinds text[], rrf_k int)` → `TABLE(id, source_id, source_kind, title, url, lang, content, meta, score double precision)`. Recherche **hybride** (vecteur HNSW + tsvector GIN) fusionnée par RRF (Reciprocal Rank Fusion, d'où `rrf_k`), filtrable par `kinds`.
- **kinds présents** (`source_kind`, tous 100% embeddés + tsv) : `sqlite` 6 962, `tweet` 1 328, `json` 410, `doc` 85, `lua` 18, `ts` 9, `cfg` 3. Le gros du corpus vient du miroir SQLite inagle ; le reste mélange tweets, JSON de jeu, docs, scripts Lua/TS et configs.
- Réserve : `buildid` est NULL sur toutes les lignes (`rag_distinct_builds=0`) — le rattachement au build Steam n'est pas renseigné dans le RAG.

### 3.4 Relations clés

- **Tables `inagle_*` = pas de contraintes FK Postgres déclarées entre elles** ; ce sont des tables de projection peuplées/écrasées par le CLI push inagle (inagle → wiki-service → Supabase), corrélées par champs métier (`internal_code`, `team_id`, `model_id`, `partner_ids`, `source_id`) plutôt que par intégrité référentielle DB. Cohérent avec le pipeline (miroir SQLite embarqué côté azalee, Supabase = backend de vérité pour le push).
- `inagle_rag_chunks.source_id` / `meta` référencent logiquement les entités jeu (characters/skills/tweets/docs) sans FK ; clé de dédup `(source_id, content_hash)`.
- Côté app : chaîne better-auth classique `user` ← `account`/`session`/`verification` (par `user_id text`) ; `orders.user_id`, `profiles.discord_id` → `discord_members.discord_id`, `articles.author_id`/`series_id` corrélés logiquement. PK notable atypique : `inagle_tactics` clé sur `name`, `inagle_game_assets` clé sur `path`.

### 3.5 Row counts (tables clés, COUNT(*) réel)

| Table | Lignes | Note |
| --- | --- | --- |
| inagle_game_assets | 40 471 | annexe assets (tous exists=true) |
| inagle_rag_chunks | 8 815 | 100% embeddés halfvec(1024) + tsv |
| inagle_characters | 6 148 | dont 55 jouables (is_controllable) |
| tweets | 3 154 | corpus social |
| discord_members | 2 137 | PII (non lu) |
| inagle_items | 1 668 | |
| inagle_skills | 1 002 | category_id/element_id = NULL partout |
| inagle_capsules | 740 | |
| inagle_costumes | 576 | |
| inagle_gallery | 360 | |
| inagle_keshins | 282 | |
| inagle_growth_tables | 276 | |
| inagle_teams | 208 | |
| inagle_quests | 182 | |
| team_members | 129 | |
| inagle_passives | 128 | |
| inagle_exp_table | 100 | |
| inagle_miximax | 70 | |
| inagle_tactics | 70 | PK = name (list_tables affiche 0 à tort) |
| inagle_souls | 56 | |
| user | 33 | auth, PII (non lu) |
| session | 57 | auth, PII (non lu) |
| inagle_auras | 9 | |
| account | 8 | secrets OAuth (non lu) |
| articles | 3 | CMS |
| orders | 0 | miroir Stripe, source = Stripe |
| profiles | 0 | PII (non lu) |

Nombreuses tables `inagle_*` vides **volontairement** (features non livrées / sources gamedata non extraites des CPK), documentées par commentaires DB datés `db-1 (2026-06-03)` : `inagle_formations`, `inagle_heroes`, `inagle_basara`, `inagle_awakenings`, `inagle_drops_tables/treasures`, etc.

---

## 4. Recoupements & cohérence

Liens inter-étages vérifiés entre les trois audits :

- **iecode `FormatCatalog.cs` → niers `nie-seed/src/formats.rs`** : niers re-porte le catalogue iecode (magics + chemins de parser de référence) en table Rust `FormatDef`, sourcée sur `FormatDetector.cs` et les parsers Level-5/Criware. La clé XOR `0x1717E18E`, le décodeur CRILAYLA et les offsets G4MD/G4TX/NXTCH sont directement portables. `iecode export-knowledge` est le canal d'interop (JSON régénérable, non commité). La boucle RE niers est donc câblée sur les ancres de vérité iecode.
- **iecode (extraction) → inagle (`/home/ubuntu/nie/data`)** : ce que iecode dump (cfg.bin clair issu des CPK) est exactement ce qu'inagle attend dans `DATA_PATH`. `/home/ubuntu/nie/data` est un **corpus parsé**, pas un dump Steam brut — cohérent des deux côtés (iecode §1.5 le dit, inagle §2.1 le confirme). L'option `cfgbin-db` d'inagle (`~/data/cache/cfgbin.sqlite`, ~2.3 Go) est **produite par le toolkit iecode** : pont concret entre les deux étages.
- **inagle (cli-push) → Supabase (tables `inagle_*`)** : les tables `inagle_*` sont des projections écrasées par `cli-push.ts` (delete+reinsert) ; cohérent avec l'absence totale de FK Postgres entre elles (audit Supabase §3.4) et avec leur corrélation par champs métier (`internal_code`, `team_id`, `partner_ids`). Le piège `category_id`/`element_id = NULL` est constaté des deux côtés : décrit dans inagle (`wiki-service.ts` filtre via texte FR) et **mesuré** dans Supabase (`skills_null_catid=1002` sur 1 002 lignes). Triple confirmation avec CLAUDE.md.
- **inagle (auras SQL) → PostgreSQL répartition** : `sheet_data.hissatsu` et les colonnes normalisées alimentent la répartition par sous-type (`inagle_keshins`, `inagle_souls`, `inagle_miximax`, `inagle_awakenings`, `inagle_mode_changes`, `inagle_auras`).
- **cron ie-crawl → `inagle_rag_chunks`** : le RAG est alimenté par le cron, pas par cli-push. La répartition `source_kind` le prouve : `sqlite` 6 962 (miroir inagle embarqué côté azalee re-chunké), `tweet` 1 328, `json/doc/lua/ts/cfg` (sources iecode/docs). La dédup `(source_id, content_hash)` rend le crawl idempotent. La RPC `rag_hybrid_search` (HNSW + GIN fusionnés par RRF) est consommée par azalee.
- **Supabase → azalee (miroir SQLite)** : `nie-miroir.timer` publie atomiquement `/home/ubuntu/nie/var/mirror.sqlite` depuis les tables `inagle_*`; azalee le lit via `lib/supabase/sqlite-client.ts` avec détection d'inode. Le test d'intégration inagle §2.9 vérifie l'alignement `COUNT(*) inagle_characters` (SQLite) ≥ parsé : cohérence bout-en-bout testée.
- **Idempotence par buildid** : iecode garde le pipeline par buildid Steam (`.build-snapshot.json`). Réserve cohérente des deux côtés : ce buildid **n'est pas propagé** jusqu'au RAG (`inagle_rag_chunks.buildid = NULL` partout, `rag_distinct_builds=0`).

## 5. Gaps / NON_FAIT agrégés

iecode :
- CPK **chiffré** IEVR : pas de déchiffreur générique validé (seul `P5RCrypto`, spécifique Persona 5 Royal, présent).
- HCA : pas de codec PCM pur C# (MDCT inverse) → dépendance externe vgmstream-cli pour le WAV.
- G4MG sans `.g4md` compagnon : impossible par construction (headerless), `NotSupportedException` explicite.
- G4SK : parse heuristique, hiérarchie d'os partielle (offsets `unknown/confusing`).
- `dump-gamedata` ne couvre que ~7 types ; le reste est délégué à inagle.
- Binaires bruts (`.cpk`/`.g4mg`) **absents du VPS** (`/home/ubuntu/nie/data` = corpus parsé) → pas de RE additionnel possible à l'aveugle.
- G4MG n'expose que le 1er layout vertex si `VLayoutCount` > attributs de la 1re table (limite assumée) ; champs `Unknown*` résiduels dans G4TX/G4SK.

inagle :
- `rarityToGrowthRank` / `rarityCodeToName` **dupliqués** entre `stat-calculator`, `star-sign`, `chara-param`, inline cli-push — mappings non strictement identiques (incohérence préexistante, non corrigée, lecture seule).
- Fichiers texte cfgbin-db désactivés par défaut (le parser corrompt les chaînes localisées).
- ~159/387 auras sans hissatsu natif résoluble (228/387 résolues) — laissé `undefined`, aucune invention.

Supabase :
- `inagle_skills.category_id` / `element_id` = **NULL** sur 100% des lignes (filtrer via texte FR `category`/`element`).
- Nombreuses tables `inagle_*` vides **volontairement** : `inagle_formations`, `inagle_heroes`, `inagle_basara`, `inagle_awakenings`, `inagle_drops_tables/treasures`, etc. (features non livrées / sources gamedata non extraites des CPK).
- `inagle_rag_chunks.buildid` = NULL partout (`rag_distinct_builds=0`) : rattachement au build Steam non renseigné dans le RAG.

Incertitudes signalées (non résolues par l'audit, à confirmer si besoin) :
- FK applicatives exactes (better-auth / `articles` / `orders`) non extraites via `information_schema.table_constraints` — corrélations déduites du schéma.
- Corps complet de la RPC `rag_hybrid_search` (logique RRF interne) non dumpé — seules signature et table de retour vérifiées.
- iecode G4MG : limite 1er layout vertex assumée dans le code, non validée sur un échantillon multi-layout réel (binaires absents du VPS).
