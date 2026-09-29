# Données Dragon Ball Xenoverse 2

Assets et données extraits du jeu **Dragon Ball Xenoverse 2** (v1.25.02, FR) via le
toolkit `dbxv2`, pour enrichir le wiki/économie de Shenron.

## Contenu

- `<CODE>.png` — 145 portraits de visages (atlas UI `CHARA01.emb`), 1 par code perso XV2 3 lettres.
- `xv2-portraits.json` — manifest brut des portraits (code → costume de base).
- `../xv2-catalog.json` — **source de vérité** : noms FR exacts du jeu (`.msg`) :
  - `characters` : 164 codes → noms (Son Goku, Krilin, Bulma…).
  - `skills` : 4 catégories — `super`, `ultimate`, `awoken`, `evasive` (~730 noms uniques) + descriptions.
- `../xv2-skillsets.json` — loadout par perso (code → super/ultimate/evasive/awoken),
  décodé de `custom_skill.cus` + `char_model_spec.cms` (chaîne CMS→CUS→.msg validée :
  Goku ressort avec Kamehameha/Genkidama, Vegeta avec Big Bang/Final Flash…).
- `_QA.png` — planche-contact des portraits posés (vérification visuelle).

## Seeds (catalogue-driven)

Tout est piloté par `xv2-catalog.json` (noms factuels du jeu = vérité), **pas** par un
mapping en dur. Le catalogue est produit par un **parser `.msg` robuste** (lecture des
valeurs par position via la table d'entrées — un parser naïf désaligne les noms, ex.
`G13` confondu avec "Bulma" alors que c'est "C-13"). L'appariement se fait par **nom
normalisé + synonymes**.

| Script                            | Effet                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun db:seed-xv2-portraits`       | Pose `db_characters.portrait_xv2` sur les persos existants appariés par nom.                        |
| `bun db:seed-xv2-characters`      | Ajoute les persos XV2 absents qui ont un portrait (forme de base, hors transfos/NPC/grands singes). |
| `bun db:seed-xv2-transformations` | Lie les formes (« X (Super Saiyen…) ») au perso de base dans `db_transformations`.                  |
| `bun db:seed-xv2-techniques`      | Importe les compétences XV2 dans `db_techniques` (type + description d'effet).                      |
| `bun db:seed-xv2-char-techniques` | Lie chaque perso à son loadout XV2 dans `db_character_techniques`.                                  |

Tous additifs/idempotents (dédup par nom canonique ; purge des lignes XV2 avant ré-insert).

## Couverture obtenue

- **db_characters : 58 → 108** persos (81 avec portrait XV2).
- **db_techniques : 120 → 825** (705 ajoutées : super 428, ultime 211, esquive 50, awoken 16 ; **747 avec description d'effet**).
- **db_transformations : 43 → 81** (formes de puissance liées aux persos).
- **db_character_techniques : +1206 liens** (130 persos liés à leur moveset XV2 réel).

`/wiki` (`Wiki.ts`) affiche `portrait_xv2` en priorité, fallback `image`.

## Régénérer depuis le jeu

Côté toolkit `dbxv2` (jeu possédé légalement) :

- `_bridge_portraits.py` → ré-extrait les portraits + manifest depuis `CHARA01.emb.unpacked`.
- `_xv2_catalog.py` → ré-extrait `xv2-catalog.json` (parser `.msg` maison : clés + valeurs FR).

**Ne pas redistribuer les assets du jeu hors de ce dépôt privé.**
