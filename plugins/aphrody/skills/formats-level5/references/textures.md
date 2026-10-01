# Textures, shaders et rendu 2D

Modules dans `iecode:crates/nie/aphrody-nie-formats/src/` (racine IECODE, cf. `../SKILL.md`).

| Format | Magic | Extension | Module | Contenu |
|---|---|---|---|---|
| G4TX | `G4TX` | `.g4tx` | `g4tx.rs`, `g4tx_decode.rs`, `g4tx_encode.rs` | Texture Level-5 |
| DXBC | `DXBC` (chunk `SHEX`) | `.vfxo`, `.pfxo`, `.cfxo`, `.gfxo` | `dxbc.rs` | Shaders compilés DirectX |
| NXTCH | `NXTCH` | — | `nxtch.rs` | Chunk de texture Switch + déswizzle GOB Tegra X1 |
| font | (via `font.cfg.bin`) | — | `font.rs` | Métriques de glyphes + blit de la police bitmap |
| raster2d | — | — | `raster2d.rs` | Rastérisation 2D |

## Décoder une texture

Outil MCP `asset_get` avec `decode: "tex"` (PNG), ou `nie vfs cat <chemin.g4tx>` avec l'option de
sortie PNG de `--help`. Depuis Rust : `g4tx_decode.rs`.

## La convention `/tex` — piège classique

La route HTTP de `aphrody-nie-model-serve` **remplace `.png` par `.g4tx`** : lui passer
`…/x.g4tx.png` est une erreur. L'URL correcte est `…/x.png`, et le service va chercher
`…/x.g4tx`.

En voie process (`asset_get`, CLI), il n'y a pas de substitution : le chemin garde son `.g4tx`.
La réponse de `asset_get` indique la voie qui a servi (`source`, ex. `"rust-native"` ou
`"model-serve"`) — s'y fier plutôt que de supposer.

## Écriture

`g4tx_encode.rs` est un des rares encodeurs du dépôt : l'aller-retour G4TX est possible. Le
vérifier sur un fichier réel avant de s'en servir dans un mod.

## Police

`font.rs` interprète `font.cfg.bin` (métriques) et l'atlas `font.g4tx` ; exemples
`font_render.rs` et `render_text.rs` dans `iecode:crates/nie/aphrody-nie-formats/examples/`.

Il n'y a **pas** de format `.g4tg` à reverser : c'était une hypothèse fausse, levée le
2026-06-16 (cf. l'en-tête de `font.rs`).

## Switch

`nxtch.rs` (magic `NXTCH`) et le déswizzle Block-Linear Tegra X1 concernent les assets de la
version Switch, pas le build PC dx11.
