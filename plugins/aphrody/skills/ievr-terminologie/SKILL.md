---
name: ievr-terminologie
description: "Verify any Inazuma Eleven Victory Road term (format, extension, character/technique code, reversed symbol, virtual address, VFS path, table name) before stating it or writing it in code, a commit or docs. Use whenever an IEVR identifier appears."
---

# Terminologie IEVR — ne jamais deviner un nom

> **S'applique quand :** le dépôt IECODE (sa racine contient un dossier `iecode:crates/nie`) est le répertoire de travail ; les chemins préfixés `iecode:` sont relatifs à cette racine.
> **Sinon :** dire que la source de vérité n'est pas accessible, donner la commande qui trancherait, et ne citer aucun identifiant IEVR de mémoire.

Les identifiants d'Inazuma Eleven: Victory Road sont opaques et se ressemblent : `G4MD` et
`G4MG` désignent deux choses différentes, `.g4nv` porte le magic `NAVM`, un code personnage
comme `c01000010` n'a aucune structure devinable. Un nom inventé traverse ensuite le code, les
commits et la base de connaissance sans que rien ne le signale.

**Règle : aucun identifiant IEVR ne s'écrit de mémoire. Chacun se vérifie contre une source du
dépôt, et la vérification est bon marché.**

## Ce qui doit être vérifié

Extensions et magics · noms de formats · codes de personnage et de technique · symboles reversés
et adresses virtuelles · chemins VFS · noms de tables `.cfg.bin` · noms de crates et de familles
`nie-data`.

## Où vérifier, par nature de terme

| Terme | Source de vérité | Comment |
|---|---|---|
| Format, magic, extension | `iecode:crates/nie/aphrody-nie-formats/src/lib.rs` (`enum FileFormat`) et un module par format | `Grep` sur l'enum ; le module `<fmt>.rs` porte le parseur réel |
| Chemin VFS, existence d'un fichier | Le VFS lui-même (installation du jeu) | outil MCP `vfs_search` / `vfs_stat` (serveur `aphrody-nie-mcp`), ou `nie vfs find <sous-chaîne> -j` |
| Personnage, technique | Miroir wiki (`aphrody-nie-wiki`) | `nie vfs chara <nom\|id\|code>` · `nie vfs waza <nom\|id\|code>` |
| Symbole reversé, adresse | `var/nie.sqlite` (locale, absente sans les données privées) | outil MCP `re_function` (par nom ou vaddr) ou `re_query` (SELECT) |
| Table / clé d'un `.cfg.bin` | Le fichier décodé | outil MCP `asset_get` avec `decode: "cfg"`, ou les exemples `probe_rdbn` / `probe_t2b` de `iecode:crates/nie/aphrody-nie-game/examples/` |
| Famille de données portée | `iecode:crates/nie/aphrody-nie-data/src/` | `grep -rl "<MARKER_LIST>" crates/nie/aphrody-nie-data/src/` — **les modules portent des noms de concept, pas de format** |
| Crate, chemin du dépôt | `cargo metadata --no-deps` | ne jamais déduire un chemin de crate de son nom : le package s'appelle `aphrody-nie-<x>` |

Tables du schéma de `var/nie.sqlite` (lecture seule, `SELECT` uniquement ; source :
`iecode:crates/nie/aphrody-nie-index/src/schema.sql` et `camera.sql`) : `meta`, `binary`, `section`,
`function`, `glob`, `func_str_ref`, `func_const`, `xref`, `str`, `rtti_class`, `rtti_base`,
`pdata_func`, `symbol`, `format`, `format_field`, `hash_name`, `anchor`, `hypothesis`, `coverage`,
`forge_unit`, et la famille `cam_*` (caméra).

## Comment répondre quand la vérification est impossible

Si la source est indisponible (VFS non monté, KB absente), **le dire** et donner la commande qui
trancherait — jamais une réponse plausible non vérifiée. « Je n'ai pas pu vérifier X, la commande
est `…` » est une bonne réponse ; un nom inventé n'en est pas une.

Quand une vérification contredit une hypothèse de départ, c'est la vérification qui gagne, y
compris contre `CLAUDE.md`, une mémoire ou un commentaire du code : ces textes ont été écrits à
une date, le VFS et la KB sont l'état présent.

## Pièges avérés

- **`.g4nv` a le magic `NAVM`** : l'extension ne prédit pas le magic. Vérifier les deux.
- **`G4MD` (métadonnées de modèle) ≠ `G4MG` (mesh)** : deux modules distincts.
- **Deux formats derrière `.cfg.bin`** : RDBN à listes (`cfgbin::is_rdbn` → `parse` +
  `read_values`) et T2B en arbre (`cfgbin::cfgbin_parse`, `CfgEntry`). Tout
  `common/property/**` est T2B. Se tromper de branche donne un parseur qui « marche » et rend
  des valeurs fausses.
- **Routes `/tex`** : les formes valides sont dans l'en-tête de
  `iecode:crates/nie/aphrody-nie-model-serve/src/main.rs` (`/tex/<chemin>.png` et
  `/tex/<chemin>.g4tx/<nom>.png`) ; les relire plutôt que les reconstituer.
- **`Vfs::init` prend le dossier `data` de l'installation** (celui qui contient `cpk_list.cfg.bin`),
  pas la racine du jeu (`iecode:crates/nie/aphrody-nie-formats/src/vfs.rs`).
- **`nie.exe`** : `game_launch` le résout depuis `NIE_GAME_EXE`, sinon la racine du dépôt
  (`NIE_REPO`). La base image `0x140000000` apparaît dans
  `iecode:crates/nie/aphrody-nie-forge/src/lift.rs` ; la revérifier avant de la citer.
- **Un retour conditionnel n'est pas une constante** : porter un `sete al` / `found ? 1 : 0`
  comme `return 1` est une source classique de faux portages.

## Précision numérique

Adresses virtuelles en hexadécimal avec le préfixe `0x` et la base image réelle. Les colonnes
d'adresse de la KB (`vaddr`, `from_addr`, `to_addr`) sont déjà rendues en hexadécimal par les
outils MCP. Ne jamais arrondir ni « corriger » une adresse, un offset ou une taille : les
reproduire tels quels, ou ne pas les citer.
