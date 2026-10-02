# Données wiki — ingestion éditoriale

Comment grossir les données de l'encyclopédie (personnages, planètes, arcs…) avec
des **vraies données** (images self-hostées, infobox, descriptions) et **zéro
placeholder**.

## Architecture (rappel)

Les tables wiki-éditoriales (`db_characters`, `db_planets`, `db_arcs`, `db_sagas`,
`db_techniques`, `db_transformations`, …) vivent dans **PostgreSQL** (source de
vérité), reverse-syncées PG→SQLite toutes les 15 min (`shenron-neon-pull`, liste
dans `apps/shenron/bot/scripts/_wiki-editorial.ts`). Le **site lit PG en direct** ; le
**bot Discord + le RAG lisent le réplica SQLite**.

## Le pipeline Fandom a été retiré (2026-09-10)

Les scripts `ingest-fandom-*.ts`, `enrich-fandom-descriptions.ts`,
`crawl-fandom-rag.ts`, `fandom-scrape.ts`, `scrape-dbz-fandom-frames.ts`,
`fix-character-images.ts` et `src/db/seed-techniques.ts` ont été **supprimés** :
Fandom est une source interdite (cf. `CLAUDE.md`). Dans le même mouvement, les
2 250 citations Fandom des `article_sources` ont été purgées (script rejouable
`apps/shenron/bot/scripts/purge-fandom-sources.ts`) et les ~29 300 chunks Fandom du RAG
retirés de l'index.

Ce qu'il reste à faire, et qui ne s'automatise pas : **ré-ancrer** sur le manga
et les databooks les articles hérités de cet import. Les fiches qui n'ont plus
aucune source se listent avec :

```bash
bun apps/bot/scripts/wiki-articles.ts list characters --sans-sources
```

## Sources éditoriales admises

Manga et databooks hébergés en propre, catalogues d'éditeurs (Shueisha, Toei,
Viz, Bandai), site officiel Dragon Ball, guides Kanzenshuu, et les APIs publiques
AniList / Jikan / Kitsu / dragonball-api pour les **métadonnées** (dates, staff,
numéros d'épisode) — jamais pour la rédaction. Détail de la doctrine :
[`docs/products/shenron/wiki-editorial.md`](../../products/shenron/wiki-editorial.md).

## Zéro placeholder (mandat)

- Pas de « Bientôt disponible » / « Inconnu » / image-logo.
- Champs absents → NULL → masqués gracieusement par les pages détail (qui testent
  `field && …`).
- `CharacterGrid` rend en **progressif** (« Voir plus ») pour encaisser 1300+ entrées.

## Piège critique — reverse-sync & NULL NOT-NULL

Le SQLite du bot a des colonnes **NOT NULL** que PG autorise NULL. Un NULL en PG
casse la reverse-sync (`SQLITE_CONSTRAINT_NOTNULL`, qui rollback toute la
transaction et fige la data du bot). Colonnes vues : `db_planets.is_destroyed`
(bigint 0/1), `db_assets.source_id|license_key|created_at`. **Toujours poser une
valeur par défaut en PG** (jamais NULL) pour ces colonnes. Vérif après ingestion :
`systemctl start shenron-neon-pull.service` puis `systemctl is-active` (≠ failed).

## Flux complet

1. Écrire dans PG (`bot.*`) depuis un ingest licite ou l'éditeur du site.
2. `systemctl start shenron-neon-pull.service` (→ bot SQLite à jour)
3. Le site montre la data (lecture PG directe) ; redeploy pour figer l'ISR.
4. RAG : cf. [`docs/architecture/shenron/rag-enrichment.md`](../../architecture/shenron/rag-enrichment.md).

## Crawl BXC Dragon Ball (état 2026-09-15)

Le relevé du crawl public BXC du 2026-09-14 n'est pas versionné dans ce checkout.
Il contenait les chemins SQLite/JSONL, les sources autorisées, les gaps
Toei Kai (épisodes 1–98), les candidats officiels à dédupliquer et les commandes de
reprise. Les pages issues du crawl doivent conserver leur URL source, leur date et
leur profil BXC ; les assets binaires ne doivent pas être ingérés comme articles wiki.
