---
name: formats-level5
description: "Level-5/Criware formats of Inazuma Eleven Victory Road (CPK, cfg.bin RDBN/T2B, G4TX/G4MD/G4MG/G4SK, NAVM, PXCL, HCA/ACB/AWB, USM, @UTF). Use when reading, decoding, writing or porting one, or identifying a file by its magic."
---

# Formats Level-5 / Criware

> **S'applique quand :** la copie IECODE (racine contenant le dossier crates/nie) est le répertoire de travail ; les chemins préfixés `iecode:` sont relatifs à cette racine. **Sinon :** n'identifier un fichier que par ses octets de tête, ne citer aucun offset ni nom de module non relu, et dire que la vérification dans le parseur n'a pas pu être faite.

Le parseur de référence est toujours `iecode:crates/nie/aphrody-nie-formats/src/<format>.rs` (crate `aphrody-nie-formats`). Ce skill dit
lequel ouvrir et ce qui s'y cache ; **il ne remplace pas la lecture du module**, qui seul fait
foi sur la disposition des octets.

## Identifier un fichier

L'extension ne suffit pas — `.g4nv` porte le magic `NAVM`, et deux formats très différents
partagent `.cfg.bin`. Détecter par les octets de tête, sans écrire de code : `nie vfs stat <chemin>` (format détecté
par magic, CPK conteneur, taille) ou l'outil MCP `vfs_stat`. Depuis Rust : `FileFormat` dans
`iecode:crates/nie/aphrody-nie-formats/src/lib.rs` ; depuis le navigateur : `detect_format` dans
`iecode:crates/nie/aphrody-nie-wasm/src/lib.rs`.

## Décoder

| Voie | Quand | Comment |
|---|---|---|
| MCP `asset_get` | Explorer, inspecter | `decode: "cfg" \| "tex" \| "audio" \| "raw"` en process (`source: "rust-native"`) ; `"model"` passe par le service `aphrody-nie-model-serve` |
| Crate Rust | Depuis Rust | `aphrody_nie_formats::<module>` |
| CLI | En ligne de commande | `nie vfs cat <chemin>` (décodage structuré, repli hexdump ; `--help` pour les sorties PNG/WAV) |
| Probes | Explorer une famille cfg.bin | exemples `iecode:crates/nie/aphrody-nie-game/examples/probe_rdbn.rs` et `probe_t2b.rs` (argument : préfixe de nom de fichier) |

## Familles

- **Conteneurs** : CPK, CRILAYLA, @UTF → `references/conteneurs.md`
- **Configuration** : cfg.bin (RDBN et T2B), OBJBIN, MEVBIN → `references/configuration.md`
- **Modèles 3D et animation** : G4MD, G4MG, G4SK, G4MT, G4MA, G4CM, G4LA, G4VS, G4PK, G4RA, G4PKM →
  `references/modeles-animation.md`
- **Textures et rendu 2D** : G4TX, DXBC, font, raster2d → `references/textures.md`
- **Monde** : NAVM/g4nv, COL, NXTCH → `references/monde.md`
- **Audio et vidéo** : HCA, ACB, AWB, USM → `references/audio-video.md`

Chaque fiche donne, par format : le magic réel, l'extension, le module Rust, ce que le format
contient, et les pièges connus.

## Règles qui valent pour tous

- **Vérifier le magic, pas l'extension.** Les deux divergent dans le VFS.
- **Ne jamais inventer un offset.** Si la disposition n'est pas dans le module, la lire dans le
  fichier (`nie vfs cat`, hexdump) avant d'écrire du code.
- **Un décodage qui « marche » peut être faux** : un `.cfg.bin` lu avec la mauvaise branche
  (RDBN au lieu de T2B) rend des valeurs plausibles et fausses. Contrôler contre le jeu ou un
  golden.
- **Écriture** : seuls quelques formats ont un encodeur (`cpk_encode`, `g4tx_encode`, patchs
  `rdbn_patch`/`t2b_patch`). Pour les autres, l'aller-retour n'est pas garanti — le vérifier
  avant de proposer une écriture.
- **Golden tests** : `cargo test -p aphrody-nie-data --test <fam>_golden` (fichiers
  `iecode:crates/nie/aphrody-nie-data/tests/*_golden.rs`). Une famille portée sans golden n'est
  pas portée.

## Porter une nouvelle famille de données

La quasi-totalité est déjà portée. Avant d'en ajouter une, **chercher par marqueur, pas par nom
de fichier** — les modules de `aphrody-nie-data` sont nommés par concept :

```bash
grep -rl "<MARKER_LIST>" crates/nie/aphrody-nie-data/src/   # depuis la racine IECODE
```
