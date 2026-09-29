# Scans manga — self-hosting & ingestion

Architecture et outils des scans manga de DBFR. **Objectif : zéro hotlink** — toutes
les planches sont téléchargées sur le VPS et servies depuis `bot.dragonballfr.com`
(plus de « renvoi sur un autre site »).

## Hébergement & service

- **Sur disque** : `apps/bot/assets/manga/<SÉRIE>/...` (gitignored — VPS-only,
  régénérable par les scripts). Converti en **WebP**.
- **Servi** par le bot : route `/assets/*` (`apps/bot/src/api/server.ts` →
  `serveAsset`) → `bot.dragonballfr.com/assets/manga/...`.
- **En base (Neon)** : `bot.db_manga_chapters.pages` (jsonb, **Neon-only**) stocke
  des chemins relatifs `./assets/manga/...`. Le site lit Neon en direct et résout
  via `assetUrl()` (`apps/site/src/lib/assets.ts`). Le lecteur =
  `apps/site/src/components/manga/MangaReader.tsx`.
- Schéma de chemin : `assets/manga/<SÉRIE>/<sous-dossier>/<NNN>.webp`. Ex. :
  - DBS N&B : `assets/manga/DBS/ch<id>/NNN.webp`
  - DB original VF : `assets/manga/DB/regular/vol<N>/NNN.webp`
  - Couleur : `assets/manga/DBFC/ch<chapter_number>/NNN.jpg`

## Contenu disponible

| Série                             | État                               | Source                      | Planches |
| --------------------------------- | ---------------------------------- | --------------------------- | -------: |
| **Dragon Ball original VF** (N&B) | **complet — 42 tomes**             | Sushi Scan → CDN anime-sama |    7 965 |
| **Dragon Ball Super** (N&B)       | **complet (103 chapitres)**        | scan-vf.net → self-host     |    4 355 |
| **Dragon Ball Full Color** (DBFC) | **complet — 520 chapitres**        | scan-db forum → CDN         |    7 954 |

Total : **20 274 planches self-hostées** et servies directement via `https://cdn.dragonballfr.com`.

### comic.dragonballcn.com — bibliographie, couvertures & métadonnées

`comic.dragonballcn.com` (鳥山明漫画資料館) a été **miroité et enrichi** :
ses **476 ouvrages sont tous décrits** : 12 collections (les 42 tomes japonais, la
kanzenban, la Full Color, les éditions chinoises, les anime comics, Arale, les
databooks et hors-séries), **476 couvertures** (100 % des ouvrages ont désormais
leur couverture hébergée sur le CDN, les 135 databooks/hors-séries étant reliés aux
assets HD de `bot.db_databooks`), **362 ISBN** (contre 87 initialement) et leurs dates
de parution officielles. Les 341 couvertures originales du site sont hébergées sous
`apps/bot/assets/covers/dragonballcn/`. Rangé sous `apps/bot/assets/dragonballcn/`
(cf. son [README](../apps/bot/assets/dragonballcn/README.md)) ; les 12 pages de
catalogue sont archivées sous `apps/bot/data/catalogues/pages/`.

**464 ouvrages sur 476 ont leur pagination relevée**, soit **60 563 planches
recensées** — nommées et datées dans `dragonballcn-inventaire.json`. Il a fallu
cinq passes (95 → 51 → 34 → 19 → 12 fiches sans réponse) ; les 12 dernières sont
marquées `pagination: "fiche muette"` plutôt que comptées à zéro.

Les planches DragonballCN sont des ressources publiques référencées par le wiki.
La politique média du site les accepte directement ; un miroir local reste
optionnel et sert uniquement à améliorer la disponibilité ou les performances.

Le script de rapatriement `telecharge-planches-dragonballcn.ts` reste disponible
pour constituer un miroir local, avec simulation par défaut et journal de reprise.

## Scripts d'ingestion (`apps/bot/scripts/`)

Tous prennent `DATABASE_URL` (Neon) et ont un **garde-fou disque** (stop sous un
seuil de Go libres) + conversion WebP (`sharp`).

- **`ingest-dragonball-volumes.ts`** — Dragon Ball original VF (42 tomes) depuis
  Sushi Scan (`sushiscan.fr/dragon-ball-volume-N-vf/` → parse `ts_reader.run({…})`
  → CDN `s22.anime-sama.me/.../Dragon Ball/N/...`). Niveau de gris + resize 1280 +
  WebP q55 (manga N&B compresse bien). 1 chapitre lisible par tome, rattaché au
  volume existant `Dragon Ball Vol. N`. `--from --to --force --dry-run`.
- **`ingest-fullcolor-manga.ts`** — édition couleur (parse `ts_reader`, images déjà
  WebP, pas de reconversion). Crée des chapitres `chapter_number` 90x.
- **`selfhost-manga-pages.ts`** — rapatrie les planches N&B externes (scan-vf,
  lelscanfr) déjà référencées : download + WebP + réécrit `pages` en chemins locaux.
  **Referer par hôte** (anti-hotlink). ⚠️ **Ne PAS envoyer de Referer `mangadex.org`**
  (mangadex renvoie du HTML/bloque) ; mangadex marche sans Referer mais bloque le
  VPS de façon intermittente → ses chapitres ont été retirés.
- **`crawl-dragonballcn.ts`** / **`volumetrie-dragonballcn.ts`** /
  **`enrichit-divers-dragonballcn.ts`** / **`assets-dragonballcn.ts`** — le quatuor
  comic.dragonballcn.com : relevé du catalogue, inventaire de pagination (via
  `bxc-mcp`, seul client que les fiches servent — **relançable, il ne redemande que
  les fiches muettes**), récupération des rubriques/dates/fils de forum que les
  listes d'index portent pour les 135 hors-séries, puis constitution du miroir sous
  `assets/dragonballcn/` (couvertures WebP + `index.json`). Aucune planche : cf. la
  section ci-dessus.
- **`clean-fullcolor-promos.ts`** — retire par **OCR** (tesseract fra+eng) les
  planches non-contenu : pubs « SUSHISCAN.FR » (texte « lisez … chapitres »), pages
  de crédits staff, pages blanches. Garde-fou : abort si > 18 % d'un tome retiré.

## UI (`apps/site/src/components/manga/`)

- `MangaVolumeGrid.tsx` — onglets DBS / **Dragon Ball (édition couleur)** / Scans /
  Succès. **Zéro placeholder** : seuls les tomes/chapitres ayant des scans sont
  affichés ; badge « Couleur » (`isColorChapter`).
- `VolumeChaptersList.tsx` — n'affiche que les chapitres disponibles (le « Bientôt
  disponible » a été supprimé).
- Routes : `/wiki/manga` (index ISR), `/wiki/manga/[id]` (lecteur, `generateStaticParams`),
  `/wiki/manga/volume/[id]`.

## Pièges

- **Disque** : le VPS est tendu — convertir en WebP, honorer le garde-fou.
- **`db_manga_chapters` est wiki-éditorial** (reverse-syncé Neon→SQLite) mais la
  colonne `pages` est Neon-only (exclue par intersection de colonnes).
- **Pubs scanlation** : Sushi Scan/anime-sama insèrent des pages pub/crédits → passer
  `clean-fullcolor-promos.ts` après toute ingestion couleur. Le DB régulier (Sushi
  Scan) n'a pas de pub aux bords.
- À venir : **OCR des planches → markdown** (cf. [`docs/ocr-manga.md`](ocr-manga.md)).
