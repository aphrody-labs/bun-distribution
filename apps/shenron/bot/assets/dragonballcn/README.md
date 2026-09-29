# comic.dragonballcn.com — miroir local

Miroir de ce que **comic.dragonballcn.com** (鳥山明漫画資料館, « musée de la bande
dessinée d'Akira Toriyama ») sert publiquement : sa **bibliographie** et les
**couvertures** qui identifient chaque édition.

Régénéré par [`packages/shenron/pipeline/scripts/assets-dragonballcn.ts`](../../../../packages/shenron/pipeline/scripts/assets-dragonballcn.ts).

## Rangement

```
assets/dragonballcn/
├── index.json                       manifeste : 12 collections → 476 ouvrages
├── <collection>/NNN.webp            couverture, NNN = rang de parution dans l'édition
└── README.md                        ce fichier
```

Les 12 pages de catalogue dont tout ceci est tiré sont archivées telles quelles
sous `apps/shenron/bot/data/catalogues/pages/` (données locales, hors Git).

| Collection                  | Ouvrages | Couvertures | Datés | Paginés | Planches recensées |
| --------------------------- | -------: | ----------: | ----: | ------: | -----------------: |
| `dragonball_jp_original`    |       42 |          42 |    42 |      42 |              5 698 |
| `dragonball_jp_kanzenban`   |       34 |          34 |    34 |      34 |              6 576 |
| `dragonball_full_color`     |       42 |          42 |    42 |      42 |              7 383 |
| `dragonball_zh_cn`          |       43 |          43 |     5 |      43 |              6 253 |
| `dragonball_zh_tw`          |       42 |          42 |    42 |      40 |              4 093 |
| `dragonball_zh_hk_ultimate` |       34 |          34 |    34 |      34 |              3 408 |
| `dragonball_anime_z`        |       39 |          39 |    39 |      38 |              5 318 |
| `dragonball_anime_movie`    |       20 |          20 |    20 |      20 |              2 667 |
| `arale_cn`                  |       18 |          18 |     5 |      18 |              2 957 |
| `arale_jp_lib`              |        9 |           9 |     9 |       9 |              2 196 |
| `arale_zh_hk`               |       18 |          18 |    18 |      18 |              1 688 |
| `divers`                    |      135 |         135 |   126 |     126 |             12 326 |
| **Total**                   |  **476** |     **476** | **416** | **464** |        **60 563** |

Les **476 ouvrages** sont tous décrits et intégralement illustrés :

- **476 couvertures** (100 % de couverture) : les 341 couvertures du site original
  hébergées sur le CDN sous `assets/covers/dragonballcn/`, complétées par les 135
  couvertures HD locales des databooks / artbooks (`assets/wiki/databooks/...`).
- **362 ISBN** (contre 87 initialement, +275 ISBNs) et dates officielles enrichies
  dans `dragonballcn.json`, `index.json`, et synchronisées en base PostgreSQL et SQLite.
- **464 paginations relevées** sur 476, en cinq passes (95 → 51 → 34 → 19 → 12
  fiches sans réponse). Les 12 dernières sont marquées `pagination: "fiche muette"` :
  le site ne rend pas leur fiche, et une absence de mesure n'est pas un zéro.
- **249 dates** et **87 ISBN** — l'éditeur ne figure que sur les pages qui portent
  un bloc de métadonnées ; ailleurs, la date vient de la liste d'index
  (`[1985|2013]` = parution originale | mise en ligne).

`divers` rassemble databooks, artbooks et hors-séries, rangés par la **rubrique**
éditoriale du site lui-même (ouvrages de référence, autres œuvres de Toriyama,
doujinshi, courts récits…).

## Ce que porte `index.json`

Par ouvrage : `rang`, `did`, `url_fiche`, `titre`, `rubrique`, `premiere_edition`,
`numerisation`, `date_affichee`, `isbn`, `editeur`, `magazine`, `prix`,
`fil_forum`, `planches_recensees`, `pagination`, et pour la couverture son
`chemin` local, sa `source_url`, ses dimensions, son poids et son `sha256`.

`fil_forum` conserve le fil de bbs.dragonballcn.com que le site crédite pour la
numérisation. `planches_recensees` vient de
`apps/shenron/bot/data/catalogues/dragonballcn-inventaire.json` (données locales, hors Git),
qui nomme et date chaque planche : c'est un **index**, pas un contenu.

## Ce qui n'est pas ici, et pourquoi

Les planches DragonballCN restent accessibles comme ressources publiques externes.
Ce miroir contient les métadonnées et couvertures ; les planches peuvent être
servies directement par leur URL publique ou copiées localement à la demande.

Une mesure historique du 2026-09-04 indiquait :

| Réponse | Ressource                                          |
| ------- | -------------------------------------------------- |
| `200`   | `images/cover/db_jp_or/01.gif` — les couvertures    |
| `200`   | ressources de couverture et pages publiques         |

Cette mesure historique ne constitue plus une règle de blocage dans Shenron :
les URL DragonballCN sont conservées et exposables par la politique média publique.

## Le rapatriement des planches

[`telecharge-planches-dragonballcn.ts`](../../../../packages/shenron/pipeline/scripts/telecharge-planches-dragonballcn.ts)
est écrit et prêt. Il ne part qu'avec `--oui`, saisi à la main : par défaut il
simule et ne demande rien au site.

**À relancer avant toute campagne :**

```bash
bun packages/shenron/pipeline/scripts/telecharge-planches-dragonballcn.ts --verifier-acces
```

La commande vérifie quatre URL publiques avant une campagne — dossier distant
résolu (`0.Dragon_Ball-buyao_daolian_ya/1.jp_original/01`) :

| Réponse | Ressource                   |
| ------- | --------------------------- |
| `200`   | couverture de catalogue     |
| `200`   | fiche de lecture            |
| `200`   | planche pleine résolution   |
| `200`   | miniature de planche        |

Les codes historiques ci-dessus sont conservés comme mesure d’archive uniquement ;
ils ne déclenchent plus de blocage applicatif DragonballCN.

Une fois ouvert, il rapatrie sous `assets/dragonballcn/planches/<collection>/<did>/NNN.webp`
(numérotation de l'inventaire, donc les doubles pages gardent leur rang), avec trois
freins indépendants — jitter 900–2500 ms, 300 requêtes / 15 min, 5 000 / 24 h —, un
garde-fou disque à 2 Go et un journal reprenable en 0600 : une planche déjà
rapatriée n'est jamais redemandée. `--reference "…"` estampille chaque `index.json`
produit, si vous voulez y consigner d'où vient l'accord.

Prérequis vérifiés au démarrage, avant la première requête : `curl`, `bxc-mcp`,
`sharp` réellement capable d'encoder, et les deux fichiers de catalogue.

## Licence

`FAIR-USE-EDITORIAL`, comme les autres buckets bibliographiques de la base
(shueisha, viz, toei). Attribution : *comic.dragonballcn.com*. Les couvertures
restent la propriété de leurs éditeurs (集英社 / 東立 / 文化傳信 / 天下), reproduites
au format vignette pour identifier une édition dans une bibliographie.
