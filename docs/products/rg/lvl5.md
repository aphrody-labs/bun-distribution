# Cartographie des outils de reverse-engineering Level-5 / IEVR

Cartographie exhaustive et vérifiée des outils de reverse-engineering et de
datamining publics ciblant les formats **Level-5**, avec un focus sur
**Inazuma Eleven: Victory Road** (IEVR). Chaque affirmation forte est adossée à
une source réelle (URL de dépôt vérifiée via l'API GitHub, ou `fichier:ligne`
du monorepo local).

## Périmètre

- **Jeu cible** : Inazuma Eleven: Victory Road (IEVR), version PC/Steam.
  **App ID Steam = 2799860** (éditeur LEVEL5). ⚠️ `3593770` est un autre jeu
  homonyme (« Victory Road » / We Draw Straws) — piège de collision à éviter
  (`iecode/CLAUDE.md`, section Steam).
- **Famille Level-5** : IEVR partage une lignée de formats avec les autres jeux
  Level-5 (Inazuma Eleven GO, Yo-Kai Watch, Dragon Ball Fusions…), mais IEVR
  marque une **rupture de génération** de formats : les jeux 3DS utilisent
  `XPRM/XPCK/XMTN/IMGC/MBN/RES` (gérés par l'écosystème Tiniifan/Kuriimu),
  tandis qu'IEVR (PC) utilise une nouvelle famille préfixée **`G4*`**
  (`G4MG`, `G4MD`, `g4tx`, `g4sk`, `g4pkm`, `G4NV`, `G4RA`…), des archives
  **CPK CRIWARE** chiffrées, des shaders **DXBC/FXBIN**, et un format de
  configuration **`cfg.bin`** modernisé. **Conséquence majeure** : la plupart
  des outils Level-5 historiques ne lisent PAS les formats `G4*` d'IEVR.
- **Distinction importante** : « outil de RE de formats binaires » (parse les
  fichiers du jeu) vs « API/wiki de données » (scrape un site ou réexpose un
  dataset déjà extrait). Les seconds sont listés à part car ils ne font pas de
  RE de format.

## Tableaux par langage

Légende **Pertinence IEVR** :
- **Directe** : lit/écrit réellement des formats d'IEVR (PC, `G4*`/CPK/cfg.bin).
- **Indirecte** : gère la famille Level-5 mais sur la génération 3DS (formats
  différents) — utile comme référence de RE, pas comme outil prêt à l'emploi.
- **Transverse** : format middleware (CRIWARE) commun à de nombreux jeux, donc
  applicable à IEVR pour l'audio/CPK.

Les licences notées « aucune (pas de fichier) » signifient qu'aucun fichier
`LICENSE` n'est déclaré sur le dépôt (au sens GitHub `license.spdx_id`) — le
code est public mais sans licence open-source explicite (tous droits réservés
par défaut). Vérifié via `gh api repos/<owner>/<repo>`.

### C\#

| Outil | Repo | Formats | État | Licence | Pertinence IEVR |
| --- | --- | --- | --- | --- | --- |
| **Kuriimu2** | `FanTranslatorsInternational/Kuriimu2` | Archives + textures + texte multi-jeux, plugins Level-5 (XPCK, IMGC, cfg.bin, T2B…) | Actif (commit 2026-06) | déclarée côté dépôt | Indirecte (3DS Level-5) |
| **Kuriimu (v1)** | `IcySon55/Kuriimu` | Idem v1, large parc de plugins Level-5 hérités | Actif (2026-05) | déclarée | Indirecte |
| **StudioElevenLib** | `Tiniifan/StudioElevenLib` | XPCK, XFSP, ARC0, IMGC, MBN, MTRC, XMPR/XPVB/XPVI (mesh), RES/XRES, CMR1/CMR2, T2B, CfgBin, compressions LZ10/Huffman/RLE/ZLib | Actif (2026-05) | MIT | Indirecte (back-end du Blender addon 3DS) |
| **Viola** | `SuperTavor/Viola` | Dump/repack des filesystems CPK des LEVEL5 « modernes », via `cpk_list.cfg.bin` ; logique CPK chiffré (skythebro) | Actif (2026-04) | aucune (pas de fichier) | **Directe** (cité comme base de IEVR-Toolbox) |
| **CriFsV2Lib** | `Sewer56/CriFsV2Lib` | Extraction CPK CRIWARE (minimal, perfs) | Actif (2026-05) | aucune (pas de fichier) | **Transverse** (CPK IEVR) |
| **SonicAudioTools** | `blueskythlikesclouds/SonicAudioTools` | ACB, AWB, AFS2, CPK, HCA (formats CRIWARE) | Actif (2026-05) | déclarée | **Transverse** (audio IEVR) |
| **SonicAudioToolsCLI** | `alexankitty/SonicAudioToolsCLI` | Idem, CLI cross-platform | Actif (2026-04) | déclarée | **Transverse** |
| **VGAudio** | `Thealexbarney/VGAudio` | Encode/décode audio jeux (HCA, ADX, BRSTM, DSP…) | Actif (2026-05) | déclarée | **Transverse** (HCA/ADX IEVR) |
| **YACpkTool** | `Brolijah/YACpkTool` | Extract/pack/patch CPK CRIWARE | Actif (2026-05) | déclarée | **Transverse** (CPK IEVR) |
| **VGMToolbox** | `Manicsteiner/VGMToolbox` (fork actif) | Boîte à outils audio jeux (extraction/build de nombreux formats stream) | Actif (2026-05) | déclarée | Transverse (audio) |
| **CfgBinEditor** | `Tiniifan/CfgBinEditor` | Éditeur GUI cfg.bin Level-5 | Actif (2026-04) | aucune | Indirecte→partielle (cfg.bin générique) |
| **Nyanko** | `Tiniifan/Nyanko` | Éditeur de texte Level-5 (T2B/strings) | Actif (2025-12) | aucune | Indirecte |
| **Pingouin** | `Tiniifan/Pingouin` | Gestionnaire d'archives Level-5 | Actif (2026-04) | aucune | Indirecte |
| **Level5ResourceEditor** | `Tiniifan/Level5ResourceEditor` | RES.bin (table de ressources) | Actif (2026-04) | aucune | Indirecte |
| **XCMAConverter** | `Tiniifan/XCMAConverter` | Caméra Level-5 (XCMA) | Actif (2026-04) | aucune | Indirecte |
| **Lynx** | `Tiniifan/Lynx` | Éditeur IE GO Light & Shadow (3DS) | Actif (2026-04) | aucune | Indirecte |
| **InazumaElevenSaveEditor** | `felizabuelo/InazumaElevenSaveEditor` (origine `Tiniifan`) | Saves de la série principale (IEGOCS/Galaxy…) | Actif (2026-03) | déclarée | Indirecte (saves, pas formats jeu IEVR) |
| **Inazuma-Eleven-Toolbox** | `SwareJonge/Inazuma-Eleven-Toolbox` | Saves + stats des 3 premiers IE (NDS) | Actif (2026-04) | déclarée | Indirecte (NDS) |
| **iecode** (maison) | local `iecode/` | voir section « État maison » | Actif (privé) | — | **Directe** |

### Rust

| Outil | Repo | Formats | État | Licence | Pertinence IEVR |
| --- | --- | --- | --- | --- | --- |
| **IEVR-Toolbox** | `Telmo26/IEVR-Toolbox` | Dump/repack du filesystem CPK d'IEVR, déchiffrement CPK + `cpk_list.cfg.bin`, dump partiel par regex ; portage Rust parallèle de Viola + CriFsV2Lib | Actif (2026-04) | aucune (pas de fichier) | **Directe** |
| **ievr_cfg_bin_editor** | `Telmo26/ievr_cfg_bin_editor` | Lib + GUI de lecture/édition des `cfg.bin` Level-5 (crate `ievr_cfg_bin_editor_core`) | Actif (2026-04) | aucune | **Directe** |
| **ievr_dataminer** | `Telmo26/ievr_dataminer` | Datamine perso (élément, position, archétype, stats) + texte multi-langue d'IEVR → SQLite ; s'appuie sur IEVR-Toolbox (extraction) + `ievr_cfg_bin_editor_core` (parse cfg.bin) | Actif (2026-02) | aucune | **Directe** |
| **IEVR-Database** | `Telmo26/IEVR-Database` | Full-stack d'affichage des données minées (consomme le dataminer) | Actif (2026-04) | aucune | Directe (front data, pas RE) |
| **inazugle-scraper** | `Telmo26/inazugle-scraper` | Scrape la base Inazugle (données, pas binaire) | Actif (2025-12) | aucune | Indirecte (scraper) |

Détails vérifiés : `ievr_dataminer/Cargo.toml` déclare la dépendance
`ievr_cfg_bin_editor_core = { git = "…/Telmo26/ievr_cfg_bin_editor.git" }`, et
le README pointe IEVR-Toolbox comme couche d'extraction. Le README d'IEVR-Toolbox
indique explicitement « heavily based on both Viola and CriFsV2Lib, re-written in
Rust for performance » (vérifié via `gh api`).

### Python

| Outil | Repo | Formats | État | Licence | Pertinence IEVR |
| --- | --- | --- | --- | --- | --- |
| **studio_eleven** | `Tiniifan/studio_eleven` | Blender addon : XPRM (mesh 3D), XPCK (archive), XMTN/XIMA/XMTM (anims), XCMA (caméra) — jeux **3DS** | Actif (2026-05) | déclarée | Indirecte (3DS, formats ≠ G4* IEVR) |
| **studio26** | `Tiniifan/studio26` | Successeur WIP du Blender addon Level-5 | Actif (2026-05) | aucune | Indirecte |
| **IEVR Noesis Script** | `AFGRocha/Inazuma-Eleven-Victory-Road-Noesis-Script` | Script Noesis d'import des modèles IEVR (G4* / mesh PC) | Actif (2026-02) | aucune | **Directe** (mesh/textures IEVR via Noesis) |
| **PyCriCodecs** | `Youjose/PyCriCodecs` | CPK, ACB, AWB, HCA, ADX, USM, UTF (front Python, back C++) | Actif (2026-04) | déclarée | **Transverse** (CRIWARE IEVR) |
| **InazumaElevenGoMapenv** | `Tiniifan/InazumaElevenGoMapenv` | Compile/décompile mapenv (IE GO) | 2025-04 | aucune | Indirecte |
| **inz_cond** | `Tiniifan/inz_cond` | Compile/décompile conditions IE | Actif (2026-03) | aucune | Indirecte |
| **level5_material** | `Tiniifan/level5_material` | `.mtr` ↔ JSON | 2025-09 | aucune | Indirecte |
| **Zpidero/InazumaEleven_API** | `Zpidero/InazumaEleven_API` | REST FastAPI ; **scrape** zukan.inazuma.jp + tableur officiel (pas de RE binaire) | Actif (2026-05) | aucune | Indirecte (data scrapée) |
| **nsaadig16/InazumaElevenAPI** | `nsaadig16/InazumaElevenAPI` | API du 1er jeu IE (data, pas RE) | 2026-03 | aucune | Hors périmètre formats |

### C++

| Outil | Repo | Formats | État | Licence | Pertinence IEVR |
| --- | --- | --- | --- | --- | --- |
| **vgmstream** | `vgmstream/vgmstream` | Lecture/décodage de centaines de formats audio jeux : **HCA, ADX, AWB, ACB, USM (audio)**, etc. | Très actif (2026-06) | déclarée | **Transverse** (référence audio IEVR) |
| **PyCriCodecs (back-end)** | `Youjose/PyCriCodecs` | Back-end C++ des codecs CRIWARE (cf. Python) | Actif (2026-04) | déclarée | **Transverse** |
| **vgaudio-cpp** | `hozuki/vgaudio-cpp` | Portage C++ de VGAudio (HCA/ADX…) | 2026-02 | déclarée | Transverse |
| **projectz** | `Tiniifan/projectz` | Toolkit `code.bin` IE GO Light/Shadow (3DS, doc + patches) | Actif (2026-04) | aucune | Indirecte (code, pas assets) |

### TypeScript / JavaScript

| Outil | Repo | Formats | État | Licence | Pertinence IEVR |
| --- | --- | --- | --- | --- | --- |
| **inagle** (maison) | local `packages/inagle` | Parser TS du `cfg.bin` IEVR + g4tx ; ~70 domaines de gamedata, crc32 hash | Actif (privé) | MIT (`packages/inagle/LICENSE`) | **Directe** |
| **CriTools** | `kohos/CriTools` | Extraction audio CRIWARE en JS (ACB/AWB/HCA/USM) | Actif (2026-05) | déclarée | **Transverse** |
| **vitorfdl/game-inazuma-eleven** | `vitorfdl/game-inazuma-eleven` | Wiki + TeamBuilder IEVR (consomme un dataset, pas RE) | 2026-03 | aucune | Indirecte (front data) |
| **SceneScriptData** | `Tiniifan/SceneScriptData` | Extension VS Code : compile/décompile Scene Script Data Level-5 | Actif (2026-04) | aucune | Indirecte→partielle (scène) |
| **realt0w/team-builder** | `realt0w/team-builder` | Team builder web (data) | Actif (2026-05) | aucune | Hors périmètre formats |

## Couverture par format

Matrice format Level-5/IEVR × disponibilité d'un outil **open-source externe**
(hors stack maison). « ✅ » = au moins un outil externe gère réellement le
format pour IEVR ou un format CRIWARE équivalent ; « ~ » = couvert sur une autre
génération Level-5 (3DS) ou partiellement ; « ❌ » = aucun outil externe mûr
identifié pour la variante IEVR.

| Format IEVR | Type | Outils externes | Statut |
| --- | --- | --- | --- |
| **CPK** (archive CRIWARE) | Conteneur | IEVR-Toolbox (Rust), Viola, CriFsV2Lib, YACpkTool, PyCriCodecs, vgmstream | ✅ (dont chiffrement IEVR via Viola/IEVR-Toolbox) |
| **cfg.bin** (gamedata) | Config binaire | ievr_cfg_bin_editor (Rust), ievr_dataminer, CfgBinEditor (C#), Kuriimu | ✅ (générique + IEVR-spécifique) |
| **HCA** | Audio | vgmstream, VGAudio, SonicAudioTools, PyCriCodecs, CriTools | ✅ |
| **ADX** | Audio | vgmstream, VGAudio, PyCriCodecs | ✅ |
| **ACB / AWB / AFS2 (@UTF)** | Banque/conteneur audio | SonicAudioTools, CriTools, PyCriCodecs, vgmstream | ✅ |
| **USM** | Vidéo (FMV) | vgmstream (audio), PyCriCodecs, CriTools | ~ (audio ok ; démux vidéo partiel) |
| **G4TX** (texture) | Texture | AFGRocha Noesis (lecture pour rendu) | ~ (lecture seule via Noesis ; pas d'éditeur dédié) |
| **G4MG** (mesh) | Géométrie | AFGRocha Noesis | ~ (import Noesis ; pas de lib réutilisable) |
| **G4MD** (métadonnées mesh) | Métadonnées | — | ❌ |
| **G4SK** (skeleton) | Squelette | AFGRocha Noesis (partiel) | ~ |
| **G4PKM / g4pkm** (animation) | Anim | — | ❌ |
| **G4NV** (navmesh) | Navmesh | — | ❌ |
| **G4RA** | Ressource/anim | — | ❌ |
| **PXCL / COL** (collision) | Collision | — | ❌ |
| **DXBC** (.vfxo/.pfxo) | Shader | (outils DXBC génériques hors Level-5) | ~ (générique, pas Level-5-aware) |
| **FXBIN** (shader Level-5) | Shader | — | ❌ |
| **OBJB / XPCK / XFSA** (archives IEVR) | Conteneur | XPCK : StudioElevenLib/Kuriimu (3DS) | ~ (XPCK 3DS ≠ variante IEVR ; OBJB/XFSA ❌) |
| **mevbin** (Motion Event Binary) | Anim/event | — | ❌ |
| **P3lip** (lip sync) | Lip sync | — | ❌ |

## État maison (iecode + inagle)

Notre stack couvre un périmètre nettement plus large que l'écosystème externe
sur les formats **G4\*** spécifiques à IEVR, et duplique le périmètre CRIWARE.

### iecode (C# .NET 10) — formats binaires

Parsers présents sous `iecode/src/IECODE.Core/Formats/` (vérifié par listing) :

- **Level5/** : `G4mgParser` + `G4mgReader` (mesh G4MG), `G4mdParser` (G4MD),
  `G4txParser` (g4tx textures), `G4skParser` (skeleton), `G4pkParser` (g4pkm),
  `G4raParser`, `G4mtParser`, `NavmParser` (G4NV navmesh), `PxclParser`
  (PXCL/collision), `MevbinDocument` (mevbin), `P3lipParser` (lip sync),
  `CfgBinGeneric` + `CfgBin/` (cfg.bin), `AgiParser`, `DdsParser`,
  `NxtchParser`, `FxbinParser` (shader FXBIN), `TextureSwizzler`,
  `CfgBinTypesGenerator`.
- **Criware/** : `AcbReader`, `AwbReader`, `UsmDemuxer`, `UtfTable`/`UtfParser`,
  `CriFs/` (CPK). Audio HCA décodé via `iecode/src/IECODE.Core/Audio/HcaDecoder.cs`.
- **Shader/** : `DxbcReader` (DXBC).

CLI (`iecode/src/IECODE.CLI/Commands/`) expose ces capacités :
`G4mg`, `G4md`, `G4tx`, `G4ra`, `G4pk`, `Audio`, `Usm`, `Utf`, `Shader`,
`Scene`, `Mevbin`, `P3lip`, `Config`, `Dump`, `DumpGameData`, etc. plus le
**download/dump Steam natif** (SteamKit2, sans steamcmd : `Download`, `Sync`,
`Dump` — app id 2799860).

D'après `iecode/CLAUDE.md` (section « Gaps parsing C# connus »), les seuls
restes non finalisés côté binaire sont `G4mgParser.cs:253` (TODO mesh) et un
mapping de champs joueur (`Game/Soccer/Player.cs:13`) — bloqués par l'absence
de dump brut `.cpk`/`.g4mg` sur le VPS, donc volontairement non implémentés à
l'aveugle.

### inagle (TypeScript) — gamedata cfg.bin

`packages/inagle` (MIT) est le parser de **vérité terrain** du `cfg.bin` IEVR :
~70 domaines de gamedata (personnages, skills, auras, quêtes, équipes,
items, magasins, dialogues…) listés sous `packages/inagle/src/parsers/` +
parsers binaires `binary/cfgbin-parser.ts`, `binary/g4tx-parser.ts`, et
`hash/crc32.ts`. Le pipeline iecode délègue tout le parsing gamedata complet à
inagle plutôt que de le dupliquer en C#.

### Positionnement vs écosystème

- **Audio/CPK CRIWARE** : iecode réimplémente en C# ce que vgmstream /
  SonicAudioTools / PyCriCodecs font déjà (transverse). Pas de gap ici côté
  écosystème ; l'intérêt maison est l'intégration native (.NET ↔ Bun) et le
  download Steam.
- **G4\* (mesh/texture/skeleton/anim/navmesh/collision/shader/lip/event)** :
  c'est là que iecode est **en avance** sur l'open-source. Hors le script
  Noesis d'AFGRocha (lecture mesh/texture pour rendu), aucun outil externe ne
  couvre G4MD, G4PKM, G4NV, G4RA, PXCL, FXBIN, mevbin, P3lip.
- **cfg.bin** : couvert des deux côtés (inagle TS + iecode C# en maison ;
  Telmo26 en Rust + Tiniifan en C# en externe). C'est le format IEVR le mieux
  outillé publiquement.

## Gaps & opportunités

Formats Level-5/IEVR **sans outil open-source mûr** (candidats prioritaires à
un portage/outillage, p. ex. en Rust pour réutilisabilité et perfs) :

1. **Géométrie et animation G4\* (G4MD, G4PKM, G4RA, G4NV)** — le plus gros
   manque de l'écosystème. Seul le script Noesis d'AFGRocha touche au mesh/texture,
   en lecture, sans bibliothèque réutilisable. Aucun outil externe pour les
   métadonnées (G4MD), les animations packagées (g4pkm), le navmesh (G4NV).
   iecode est ici la référence de facto, mais privé. **Opportunité** : extraire
   une crate Rust `g4*` (lecture + export glTF) — il n'existe rien d'équivalent.
2. **Collision / scène / shaders Level-5 (PXCL, COL, FXBIN, DXBC Level-5-aware)** —
   aucun outil externe. Les shaders sont du DXBC standard mais encapsulé dans
   un conteneur FXBIN propre à Level-5 que rien ne décode publiquement.
3. **Formats « gameplay » de niche d'IEVR (mevbin, P3lip, OBJB/XFSA)** — Motion
   Event Binary, lip-sync et certains conteneurs d'archive IEVR n'ont **aucun**
   outil externe (XPCK n'existe en externe que pour la variante 3DS, pas pour
   la variante PC d'IEVR). USM côté **vidéo** (et pas seulement audio) reste
   aussi mal couvert : vgmstream/CriTools extraient l'audio, mais le démux du
   flux vidéo M2V/H.264 reste partiel.

Note transverse : la grande majorité des dépôts externes Level-5 (Tiniifan,
SwareJonge, felizabuelo) ciblent la **génération 3DS/NDS** (XPRM/IMGC/MBN, saves
des anciens jeux), pas les formats `G4*` PC d'IEVR. Pour IEVR spécifiquement,
l'open-source utile se réduit en pratique à : **Telmo26** (Rust : extraction CPK,
cfg.bin, datamining stats/texte), **AFGRocha** (Noesis : mesh/texture), et les
**outils CRIWARE transverses** (audio/CPK). Tout le reste du domaine `G4*` est un
terrain quasi vierge côté public.
