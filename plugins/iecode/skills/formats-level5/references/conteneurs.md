# Conteneurs et compression

Modules dans `iecode:crates/nie/aphrody-nie-formats/src/` (racine IECODE, cf. `../SKILL.md`).

| Format | Magic | Module | Contenu |
|---|---|---|---|
| CPK | `CPK ` (avec espace) | `cpk.rs`, `cpk_encode.rs` | Archive Criware — les packs du jeu |
| @UTF | `@UTF` | `cpk.rs` | Table de métadonnées Criware, structure interne des CPK et ACB |
| CRILAYLA | `CRILAYLA` | `crilayla.rs` | Compression Criware appliquée aux entrées de CPK |

## Le VFS plutôt que les CPK

Ne pas ouvrir les CPK à la main pour lire un fichier : le VFS (`aphrody_nie_formats::vfs`)
présente tous les fichiers des packs comme une arborescence, résout le pack conteneur et
décompresse. Le nombre exact dépend de l'installation : le mesurer, ne pas le citer.

```rust
let vfs = Vfs::init(game_dir.join("data"))?;   // <racine>/data, PAS la racine
```

En ligne de commande : `nie vfs ls`, `nie vfs find <sous-chaîne>`, `nie vfs stat <chemin>`,
`nie vfs cat <chemin>`, `nie vfs extract <chemin|préfixe> -o …` (voir `nie vfs --help`).
Extraire un préfixe sans filtre d'extension sort tout son contenu : filtrer (`--help`).

## Écriture

`cpk_encode.rs` produit un CPK **autonome, non chiffré, non compressé** (cf. l'en-tête du
module). Ce n'est pas un CPK identique à ceux du jeu.

## Pièges

- Le magic est `CPK ` avec un **espace** final.
- `Vfs::init()` prend `<racine>/data`, pas la racine — sinon « impossible d'ouvrir
  cpk_list.cfg.bin », message qui n'indique pas la vraie cause.
- Certains CPK sont **absents de `cpk_list.cfg.bin`** (films, sound_asset) : le VFS les découvre
  séparément (`discover_extra_cpks`, compté par `extra_count()`).
- Des fichiers « loose » (CPK vide dans la liste) sont lus depuis le disque, pas depuis un pack.
