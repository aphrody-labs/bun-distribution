# Configuration et données

Modules dans `iecode:crates/nie/aphrody-nie-formats/src/` (racine IECODE, cf. `../SKILL.md`).

| Format | Magic | Extension | Module | Contenu |
|---|---|---|---|---|
| cfg.bin | RDBN, ou en-tête T2B | `.cfg.bin` | `cfgbin.rs` | **Deux formats distincts** — voir ci-dessous |
| OBJBIN | `OBJB` | `.objbin` | `objbin.rs` | Définitions d'objets-menu |
| MEVBIN | — | `.mevbin` | `mevbin.rs` | Motion Event Binary |

## Le piège central : deux formats derrière `.cfg.bin`

```rust
if cfgbin::is_rdbn(data) {
    let doc = cfgbin::parse(data)?;      // RDBN : listes
    let vals = cfgbin::read_values(&doc, ...);
} else {
    let tree = cfgbin::cfgbin_parse(data)?;  // T2B : arbre de CfgEntry
}
```

- **RDBN** — structure à listes. `is_rdbn` → `parse` + `read_values`.
- **T2B** — arbre de `CfgEntry`. `cfgbin_parse`. **Tout `common/property/**` est T2B.**

Se tromper de branche ne lève pas d'erreur : le décodage rend des valeurs plausibles et fausses.
Toujours passer par `is_rdbn`, jamais deviner d'après le chemin.

## Explorer une famille

Exemples `iecode:crates/nie/aphrody-nie-game/examples/probe_rdbn.rs` (RDBN) et `probe_t2b.rs`
(T2B), un préfixe de nom de fichier en argument. Les exemples `rdbn_dump`, `t2b_roundtrip` et
`corpus_cfgbin` de `aphrody-nie-formats` existent aussi.

Le répertoire du jeu se résout par `NIE_GAME_DIR`, sinon par le répertoire courant ou un de ses
ancêtres (cf. `--game-dir` de `aphrody-nie-game`).

Décodage sans écrire de code : outil MCP `asset_get` avec `decode: "cfg"` — rend le JSON
(`source: "rust-native"` dans la réponse).

## Portage vers `nie-data`

Les modules de `iecode:crates/nie/aphrody-nie-data/src/` sont nommés **par concept**, pas par format ni par
nom de fichier. Chercher par marqueur avant d'en créer un :

```bash
grep -rl "<MARKER_LIST>" crates/nie/aphrody-nie-data/src/   # depuis la racine IECODE
```

Une famille portée se valide par un golden : `cargo test -p aphrody-nie-data --test <fam>_golden`.
