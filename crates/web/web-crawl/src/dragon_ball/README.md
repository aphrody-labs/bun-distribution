<!-- SPDX-License-Identifier: Apache-2.0 -->
# Module Dragon Ball d’Aphrody Web

Le propriétaire natif est `aphrody-web-crawl::dragon_ball`. Les campagnes, le
catalogue DragonBallCN, les galeries et inventaires, les épisodes Toei, les
classements Jajanken, les traductions de référence, les archives, les catalogues
publics Shenron et leurs assets utilisent les transports et la frontière Web
existants. Le module ne lance aucun programme externe.

## Provenance de la migration

Les sources ont été examinées dans les historiques locaux, sans clone de
recherche. Le BXC intégré à Aphrody, avant `0b2aec6c9`, contient les sources
suivantes sous `apps/bxc` :

| Ancien propriétaire | Propriétaire natif |
| --- | --- |
| `src/sources/dragonball.ts` | `sources.rs`, `plan.json` |
| `src/cli/dragonball.ts` : portail officiel, six séries Toei, Jajanken et biographies | `runner.rs`, `structured.rs`, cibles du plan |
| Catalogue public Shenron et références CDN | pagination JSON native, `shenron-catalogue.json`, `shenron-assets.json` |
| `src/crawler/dragonballfr.ts`, `scripts/train-dragonballfr-links.ts` | `dragonballfr-training-links.json` |
| `src/archive/dragonball-export.ts`, `scripts/export-dragonball-jsonl.ts` | `documents.rs`, `export_bxc`, projection `shenron-documents.jsonl` |
| `scripts/consolidate-dragonball-crawls.ts` | `consolidation.rs`, `consolidate_bxc` |

Le corpus de `8172f535c`, sous
`crates/ai/rag-eval/datasets/dragonball`, fournit la configuration et le registre
des sources. Seuls `crawl.config.json` et `sources.json` sont intégrés ici : les
corpus, questions d’évaluation, jeux de référence et bases restent dans leurs
magasins protégés. Le registre décrit des sources et leur classement historique,
sans certifier leurs assertions comme canon.

Shenron `902432cf4082c227cd71da8155b66e6952abe48e` fournit les contrats de
`packages/pipeline/src/dragonballcn-gallery.ts`, les onze éditions, les
métadonnées d’éditeur et de tableaux hongkongais, les rubriques et dates
publication/numérisation, les poids et dates d’inventaire, les sources
Kanzenshuu/guides/Kanzentai/Neoseeker et les acquisitions de couvertures/planches.
Ces comportements sont intégrés dans `aphrody-web-extract::dragon_ball`
(catalogue, galeries, métriques, entretiens et portail officiel), puis consommés
par `runner.rs` et `assets.rs` sans copie du parseur.
Les notices des snapshots restent présentes ; une notice
« FAIR-USE-EDITORIAL » héritée est une information de provenance, pas une
autorisation donnée par le moteur.

Le `package.json` et le fichier `LICENSE` du BXC historique confirment
Apache-2.0. Les fichiers Shenron cités sont également sous Apache-2.0. Les
mentions SPDX restent dans les modules adaptés. Le module n’embarque aucune
planche, couverture, base éditoriale ou transcription.

## Contrats conservés

`run_dragon_ball` accepte une configuration désérialisable et un transport
injectable. Les captures structurées sont écrites atomiquement avant la
validation d’une page par la frontière. La reprise reconstruit les exports sans
refaire les requêtes déjà terminées ; `force` demande explicitement une
nouvelle acquisition. Le budget de requêtes est global aux cibles choisies.
Les rapports distinguent tentatives, références acquises, erreurs et travail
restant ; `completed` demeure faux si la campagne reste partielle.

Le répertoire choisi contient `report.json`, `captures/`, `frontier/`,
`corpus/*.jsonl`, `shenron-documents.jsonl` et `documents/*.md`. Le schéma corpus
conserve `id`, `name`, `url`, `markdown`, `lang` et `kind`, avec provenance
additionnelle. La projection BXC conserve le SHA-256 du corps, l’identité
canonique, la catégorie, les médias référencés, les champs Toei et le dialogue
Kanzenshuu. `materialize_documents` accepte aussi les JSONL historiques à plat
et fonctionne sans réseau, pour le propriétaire RAG existant.

Les consommateurs du catalogue retrouvent
`assets/dragonballcn/index.json` et
`data/catalogues/dragonballcn-inventaire.json`. Une icône de rubrique ne devient
jamais la couverture d’un livre ; une date, un ISBN, un rang ou une pagination
absents ne sont pas inventés.

`sync_assets` télécharge les couvertures, ou les planches sur option explicite,
avec conservation de l’original, conversion WebP native, empreintes vérifiées,
journal de reprise, limites historiques de 300 requêtes/15 min et 5 000/24 h,
arrêt après cinq refus et seuil de disque libre. Il réutilise les cookies,
proxies et référents du client Obscura. Une acquisition ne supprime pas les
fichiers existants pour repartir de zéro.

`consolidate_bxc` refuse d’écraser une destination et ouvre les bases sources en
lecture seule. Il conserve HTML/JSON, profils, métadonnées originales,
OpenAPI et vecteurs dans le modèle brut privé. Les projections rejettent les
URL avec identifiants et Fandom ; le journal de rejets conserve une empreinte
d’URL, sans recopier d’identifiants. Les anciens magasins restent intacts.

Les projections BXC structurées conservent les articles officiels (tags,
galeries, catégorie et date réellement présentes), les six fichiers Toei,
les biographies, le manifeste d’import et le catalogue Archive.org avec ses
empreintes, ses dimensions et des droits explicitement non vérifiés. Le fil
éditorial français et les assertions canoniques restent au produit Shenron.

Les parseurs purs sont partagés par `aphrody pure html dragon-ball` et le
binding WASM existant : catalogue, galeries, inventaire, Toei, Jump, entretiens,
articles officiels et configuration d’images du lecteur. Le crawler, les
bases et les clients réseau restent natifs. Le plan d’acquisition est lisible
sans réseau ; une sonde limitée comptabilise néanmoins ses requêtes dans le
journal. Les acquisitions filtrent collection/ouvrage, réemploient une réserve
locale explicite, gardent SHA-256/dimensions dans le manifeste et acceptent un
plan d’images générique. `acquire_manga_volume` acquiert les références du lecteur,
convertit en niveaux de gris avec une largeur maximale de 1 280 pixels et produit
le reçu ; OCR, retrait de promotions et insertion éditoriale restent chez Shenron.

## Propriétaires qui restent distincts

Les mutations PostgreSQL/SQLite éditoriales, les dictionnaires factuels d’ISBN,
les arbitrages canoniques et les gels OCR/traduction appartiennent à Shenron.
Les recherches Google et les moteurs de découverte appartiennent au
propriétaire Google ; le produit les raccorde à ce registre, sans dupliquer le
client dans le crawler. L’indexation appartient au RAG natif et à son profil
isolé. Les hôtes, fabriques, services et installations appartiennent à Infra.

La présence des sources ne prouve ni la parité complète, ni l’installation ou
une campagne exhaustive réussie. Les gates de fabrication, la qualification
des consommateurs, la navigation réelle et le rapport de campagne apportent
chacun leur preuve séparée.
