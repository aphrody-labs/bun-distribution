---
name: aphrody-pet
description: "Charger, valider et extraire les frames du pet Codex Aphrody v2 (atlas RGBA 8×11, crate Rust aphrody-identity), ou retrouver ses références 3D IEVR. Utiliser pour afficher ou diagnostiquer le pet 2D. Pas un modèle Level-5."
---

# Runtime Aphrody v2

> **S'applique quand :** le monorepo Aphrody est le répertoire de travail (crate `crates/ui/identity`, paquet `aphrody-identity`) ; la dernière section (référence 3D) exige en plus le checkout IECODE (racine contenant `crates/nie/`), dont les chemins sont préfixés `iecode:`. **Sinon :** ne pas inventer de chemin de sprite ni de code de personnage ; décrire le contrat 2D ci-dessous et dire que la vérification n'a pas pu être faite.

Le package Aphrody est un asset 2D Codex, pas un modèle Level-5. Le point d'entrée Rust canonique
est `aphrody-identity` (`crates/ui/identity`). Il charge `pet.json`, `animations.json` et
`sprites/spritesheet.png`, puis vérifie la géométrie 8×11, les hashes RGBA, les rectangles et les
statistiques alpha avant toute extraction.

Le paquet validé est vendored dans `crates/ui/identity/assets/aphrody/`
(`pet.json`, `animations.json`, `sprites/spritesheet.png`, `sprites/spritesheet.webp`). La voie stable
est `Pet::bundled()` : elle embarque ces quatre fichiers au build et ne dépend donc ni du répertoire
courant ni d'un chemin machine. Diagnostic en ligne de commande : `crates/ui/identity/examples/diagnose.rs`.

## Contrat

- atlas RGBA 1536×2288, 8 colonnes × 11 lignes, cellules 192×208 ;
- 9 animations standard, `look-neutral`, et 16 directions `look-directions` ;
- extraction par `Pet::extract(&frame)` sans rééchantillonnage ;
- direction par `Pet::direction(degrees)` avec distance angulaire circulaire ;
- diagnostic complet par `Pet::diagnose()`, qui doit rendre `ok() == true`.

## Exemple Rust

```rust
use aphrody_identity::Pet;

let pet = Pet::bundled()?;
let frame = pet.animation("idle").and_then(|animation| animation.frames.first()).ok_or("idle absent")?;
let rgba = pet.extract(frame)?;
let gaze = pet.direction(90.0).ok_or("directions absentes")?;
assert!(pet.diagnose().ok());
```

Ne jamais copier ou vendorer les sprites depuis un run non validé : `animations.json` référence
les artefacts QA du pipeline `hatch-pet` (dont `qa/run-summary.json`) ; sans eux, ne rien importer.
Ne pas confondre ce spritesheet avec G4TX (texture Level-5), G4MD/G4MG/G4SK (modèle 3D) ou GLB.
Contrôle : `cargo test -p aphrody-identity` vérifie le paquet embarqué et ses hashes.

## Référence 3D Aphrody (checkout IECODE requis)

Pour la variante 3D IE1, le code canonique est `c01001900` (`chara_id 0x37D7ACFB`, fiche
primaire `0x9E23A289`), constantes vérifiées dans
`iecode:crates/nie/aphrody-nie-identity-source/src/gisement.rs`. Les chemins VFS des pièces sont
figés dans `iecode:crates/nie/aphrody-nie-identity-source/src/modele3d.rs` : le visage
`data/common/chr/_face/01_IE1/c01001900/c01001900.g4md` + `.g4mg` (casse `01_IE1` à respecter) et la
texture visage `data/dx11/chr/_face/01_IE1/c01001900/c01001900.g4tx`. Le corps profil 0 vient de
`data/common/chr/_face/20_EDIT/_base/base_normal_00.{g4md,g4mg}` et le squelette partagé de
`common/chr/c000101/c000101.g4sk`
(`iecode:crates/nie/aphrody-nie-model-serve/src/main.rs`, `iecode:crates/nie/aphrody-nie-formats/src/objbin.rs`).
La tenue Zeus est `u011001`, texture `_uniform/u011001/u011001_10.g4tx`, CRC fielder `0xF0006501`
(`crc32("u011001_10")`, `iecode:crates/nie/aphrody-nie-model-serve/src/catalog.rs`) ; `0xE17C3465` est
le `uniformId` qui sert de garde de forme aux titulaires Zeus dans
`iecode:crates/nie/aphrody-nie-trace/recettes/solaria.txt`.

La production 3D passe par le service `aphrody-nie-model-serve` (`GET /model-full/c01001900.glb`) ;
elle reste distincte du runtime 2D. Avant de promettre un GLB, vérifier que le service répond sur cette
route et que ses entrées existent (GLB pré-convertis dans `<game-dir>/data/dx11/model`, manifeste
`var/uniform-model-map.ndjson` généré par `nie uniform-map`) ; sans elles, dire que la voie 3D n'est
pas démontrée plutôt que de la décrire comme disponible.
