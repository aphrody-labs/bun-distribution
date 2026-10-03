# `chr` — assets personnages IEVR (référence complète)

Référence canonique des deux arbres d'assets personnages d'**Inazuma Eleven: Victory Road** :
`common/chr` (géométrie/modèles) et `dx11/chr` (textures). Distillée d'un scan **via l'index**
(rien inventé ; tout compte adossé à une commande réelle) et du matching 3D reversé
(`niers/crates/nie-formats/src/assemble.rs`).

> **Constat capital** : `common/chr` et `dx11/chr` ont **0 fichier loose sur disque**. Les deux
> arbres vivent **intégralement dans les CPK chiffrés** (clé `0x1717E18E`), accessibles **uniquement
> via l'index**. Les GLB pré-convertis (faces) vivent à part dans `data/dx11/model/` (not in repo) (6028 fichiers),
> **absents** de l'index fichiers.

## 1. L'index (source de vérité)

| Index | Accès | Rôle | Métrique |
| --- | --- | --- | --- |
| **Redis db3 `iev:file:index`** | `redis-cli -n 3 HGETALL iev:file:index` (HASH path→cpk) | Index maître de l'arbre du jeu | **250 800** entrées |
| **`iev:tex:<path>`** | HASH (W/H/format/mips/textures) | Dimensions des g4tx | 2002 clés (792 sous `dx11/chr`) |
| **`iev:cpk:<id>:toc`** | HASH | TOC déchiffré par CPK | 921 TOC |
| **`var/model-crc-manifest.ndjson` (not in repo)** | CRC32→cpk→path | Index des **modèles** g4md/g4mg | 24 624 (18 457 sous `common/chr`, 2621 g4md uniforme) |
| **`var/g4tx-xval.ndjson` (not in repo)** | cross-val dims (Rust↔C#) | Validation g4tx | 1038 (271 `chr/_face`) |
| Miroir SQLite (`apps/website/data/mirror.sqlite` (not in repo)) | `inagle_characters.internal_code`, `inagle_uniforms`, `inagle_teams` | Roster + liaison | 6148 perso |

`niers.sqlite` = index RE du **binaire** nie.exe (functions/rtti/xref), **PAS** un index d'assets.
Le streaming live g4tx→png passe par `iecode-cdn:8788` (cf. `docs/` CDN).

## 2. `common/chr` — géométrie/modèles (20 580 fichiers)

Extensions : `.g4mg` 9526 (géométrie : positions/normales/UV/indices), `.g4md` 8931 (modèle :
sous-mailles + attributs + materials), `.objbin` 772, `.g4pkm` 655, `.g4pk` 359, `.mevbin` 213,
`.bin` 49, **`.g4sk` 48 (squelettes)**, `.g4mt` 10 (matériaux), `.clobin` 7 (cloth/physique).

Sous-dossiers, partitionnés par **ère** (`01_ie1`, `02_ie2`, `03_ie3`, `04_go1`, `05_go2`, `06_go3`,
`07_ares`, `08_orion`, `11_victory`, `20_edit` = créateur de perso, `21_mannequin`, `22_combo`) :

| Dossier | Fichiers | Contenu | Codes distincts |
| --- | --- | --- | --- |
| `_face` | 12 482 | têtes/visages `c<NNNNNNNN>` | **5617** internalCodes |
| `_uniform` | 5 255 | uniformes : préfixes `u`(fielder)/`sk`(keeper)/`n`/`m`/`f`/`g`/`s` | 1870 |
| `_waza` | 833 | effets de techniques | — |
| `_item` | 766 | accessoires/ballons `i`/`d`/`b` | — |
| `_keshin` | 370 | **100 esprits/Keshin** `k…` | 100 |
| `_armd` | 281 | **89 armures** `ka…` | 89 |
| corps partagés | ~219 | `c000101` (56), `c000201` (54), `c000301` (55), `c000401` (54) — mailles corps réutilisées par `type_idx`, variantes `_pNNN` | 4 |
| `_test`/`_animal`/`_rig`/`_common` | — | divers | — |

## 3. `dx11/chr` — textures (9 722 fichiers)

`.g4tx` 9703 (textures, DDS/BC compressées) + `.col` 19. **Miroir-textures de `common/chr`**, même
partition : `_face` 6304 (5612 c-codes), `_uniform` 2637 (893 u-codes), `_item` 277, `_waza` 272,
`_keshin` 100, `_armd` 89, `_test`, `shader`. Dimensions via `iev:tex:` (ex `c02026080.g4tx` =
2048×1024, mips 9, 8 sous-textures ; faces typiquement 1024² ou 2048×1024).

## 4. Formats (lus par `nie-formats`)

- **g4md** — métadonnées modèle : sous-mailles, attributs vertex, materials. Pilote le g4mg.
- **g4mg** — géométrie : positions/normales/UV0/indices.
- **g4tx** — texture (NXTCH/Tegra-swizzle ou DDS/BC) → décodable en RGBA/PNG (validé croisé Rust↔C#).
- **g4sk** — squelette (joints + bind poses) — **clé du skinning/animation**.
- **g4mt** — matériau. `objbin`/`mevbin` — sous-formats Level-5 (objets/événements waza).

## 5. Pipeline de matching 3D (`assemble.rs`, reversé sur data réelle)

Modèle complet d'un joueur = **CORPS + VISAGE + UNIFORME** (+ textures, + skinning) :

1. **Corps** (mesh PARTAGÉ) : `internalCode → modelInfoId → bodyInfoId → type_idx → base_<classe>_NN.glb`.
   Table `TYPE_IDX_TO_GLB` ; **18 base-GLB** (`base_normal_00..03`, `base_tall_*`, `base_big*`,
   `base_bigman/woman`, `base_small_*`, `base_elderly*`). 4 mailles corps sources (`c000101/201/301/401`).
   Sources cfg.bin : `chara_base_*.cfg.bin.json` (CHARA_BASE_INFO), `chara_model_*.cfg.bin.json`
   (CHARA_MODEL_INFO + CHARA_BODY_INFO).
2. **Visage** : `dx11/model/<internalCode>.glb` (GLB pré-converti, 98 % directs) ; sinon le g4md
   `common/chr/_face/<ère>/<code>/<code>.g4md`. ⚠ l'`internalCode` désigne la **TÊTE**, pas le corps.
3. **Uniforme** : `series → season_key (ie/go/v) → inagle_teams.kits[season] = kit_id →
   uniform_config.m_UniformInfoList[kit_id] → uniformFielderModelIdCrc` (ou `…Keeper…` si poste GK)
   → CRC qui résout dans les CPK `common/chr/_uniform/` via `model-crc-manifest.ndjson`.
   `inagle_uniforms` (384, col `models` = JSON shoes/glove/uniform CRC par poste), `inagle_teams` (208, `kits`).
   ⚠ le CRC = identifiant **CRI ResourceManager**, pas un CRC32 de chemin → résolution finale via le manifeste.
4. **Keshin** (100) / **Armures** (89) : modèles `_keshin`/`_armd` propres, à exposer comme `Model` générique.

## 6. Couverture perso ↔ assets

Roster : 6148 perso, **5710 internal_codes** non-nuls distincts, **5644 au format `c…`**.

| Couverture | Compte | % |
| --- | --- | --- |
| Perso avec **face-model** (`common/chr/_face` g4md/g4mg) | 5369 | **95,1 %** |
| Perso avec **face-texture** (`dx11/chr/_face` g4tx) | 5368 | 95,1 % |
| Perso avec **GLB face pré-converti** (`dx11/model/c*.glb`) | 5365/5485 | **97,8 %** |
| SANS face-model | 275 (dont 140 alt-skins `_5000/_5100` qui matchent leur base ; **135 vrais gaps**) | |
| Face-models SANS perso (test/edit/NPC/mannequin) | 248 | |

## 7. Exploitation niers + azalee

**niers** (`nie-formats/src/assemble.rs` + serving) :
- `assemble_character_model` : fusion corps+face+uniforme → GLB. **À compléter** (en cours) :
  textures g4tx→materials (fini le matériau « Default »), uniformes voie brute G4MD+G4MG depuis CPK
  (seulement 2 GLB uniforme pré-convertis sur ~1870), keshin/armures, **skinning g4sk** (les 48
  squelettes non exploités → modèles statiques aujourd'hui).
- Serving : endpoint `/model-full/<internalCode>.glb` (assemblage live depuis les CPK + cache disque,
  philosophie du streaming g4tx) ou batch.

**azalee** :
- `components/wiki/CharacterModelViewer.tsx` : affiche le **modèle complet** (corps+face+uniforme+
  textures) sur la fiche perso, fallback GLB face. Viewer keshin/armures sur les fiches dédiées.

## 8. À exploiter (roadmap)

1. **Skinning** (plus gros gain) — parser les **48 `.g4sk`** + bind poses → joints/weights GLB
   (aujourd'hui : mailles statiques, 0 animation).
2. **Uniformes habillés** — convertir/streamer les ~1870 g4md/g4mg uniforme des CPK (manifeste CRC).
3. **Textures liées** — 9703 g4tx indexées (dims `iev:tex:`) → baseColorTexture sur les UV0 (vs « Default »).
4. **Keshin (100) + Armures (89)** — hors pipeline, modèles+textures présents dans les CPK.
5. **135 gaps de face-model** + liaison explicite des **140 alt-skins `_5000`** à leur base.
6. `.mevbin`/`.g4mt`/`.clobin` (matériaux/animations waza/cloth) non exploités.

## 9. Recettes

```bash
# Enumérer common/chr via l'index maître
redis-cli -n 3 HGETALL iev:file:index | grep -i 'common/chr' | head
# Dimensions d'une texture de face
redis-cli -n 3 HGETALL 'iev:tex:data/dx11/chr/_face/11_victory/c02026080/c02026080.g4tx'
# Résoudre un CRC de modèle (uniforme) → cpk/path
grep '"crc":<CRC>' ~/nie/var/model-crc-manifest.ndjson
# Assembler un modèle complet (niers)
cargo run -p nie-formats --example assemble -- <internalCode>   # (selon l'API d'assemble.rs)
```
