# Refonte majeure du wiki Dragon Ball — spécification d’architecture

Statut : proposition implémentable, révision 6 — 2026-09-19
Périmètre : PostgreSQL `shenron_site` (schéma `bot`), API/site Next, index RAG et SEO.

Depuis la consolidation du 2026-09-23, l'exploitation (releases, unités,
Nginx, probes et rétention) est détenue par `aphrody-infra`. Ce document et son
registre daté ci-dessous conservent des preuves historiques; leurs anciennes
commandes de déploiement local ne sont plus exécutables. La frontière actuelle
est décrite dans `docs/INFRA-DELEGATION.md`.

Ce document est un contrat d’architecture. Il ne constitue pas une migration exécutable :
toute écriture de contenu doit passer par une migration idempotente, un snapshot et une
validation sur copie. Les lignes existantes restent la source de vérité jusqu’à la fin du
backfill. Une suppression est toujours logique (`visible = false`).

## État observé de l’implémentation

La boucle s’appuie sur des artefacts réellement présents dans le dépôt, vérifiés à chaque tour :

| Artefact | Rôle | Contrôle |
|---|---|---|
| `apps/site/src/db/migrations/0017_wiki_media_publications.sql` | migration PG des publications et redirections | existence + clauses idempotence/visibilité/redirection |
| `apps/bot/src/db/migrations/0017_refonte_media_publications.sql` | miroir de migration côté bot, appliqué par le journal Drizzle | existence + alignement de schéma + journal |
| `apps/site/src/db/migrations/0018_media_works_and_editions.sql` | tables PG des œuvres, éditions, volumes et assets | idempotence, FK et déduplication SHA-256 |
| `apps/bot/src/db/migrations/0018_refonte_media_works_editions.sql` | miroir SQLite de l’ontologie média | présence et alignement des tables miroir |
| `apps/site/src/db/migrations/0019_narrative_graph_and_contributors.sql` | graphe narratif, timelines et contributeurs | idempotence, visibilité et relations référentielles |
| `apps/bot/src/db/migrations/0019_refonte_narrative_contributors.sql` | miroir SQLite du graphe et des crédits | présence et alignement des tables miroir |
| `apps/site/src/components/manga/UnifiedVolumeReader.tsx` | lecteur N&B/Full Color et tiroir des chapitres | type-check + parcours UI |
| `apps/site/tests/databook-features.test.ts` | régression des fonctions databooks/publications | 24 tests ciblés |
| `apps/site/src/app/wiki/staff/page.tsx` | hub « Autour de Dragon Ball » et spotlight | type-check du site |
| `apps/site/tests/page-banners-wiring.test.ts` | contrat des héros configurables, dont le hub staff | 3 tests ciblés |
| `apps/site/src/app/api/wiki/events/route.ts` | API publique des événements narratifs | recherche, facettes et canonicité |
| `apps/site/tests/wiki-events-api.test.ts` | contrat de l’API événements | filtres, pagination et timeline |
| `apps/bot/scripts/_rag-sources-pg.ts` | sources PG des œuvres, timelines, événements et contributeurs | filtres `visible`, entité et rendu de chunks |
| `apps/site/tests/rag-refonte-sources.test.ts` | contrat des quatre sources RAG de la refonte | 4 renderers et schéma de chunks vérifiés |
| `apps/site/tests/refonte-migrations.test.ts` | invariants des migrations média et narratif | tables/index idempotents, aucune suppression physique |
| `scripts/ops/build-site-external.ts` + `scripts/ops/package-site-artifact.ts` | build et scellement hors VPS | manifeste de commit/build, SHA-256 et fichiers Next requis |
| `.github/workflows/site-artifact.yml` | production de l'artefact site | build et upload sans accès SSH ni bascule de service |
| `scripts/ops/observability-snapshot.ts` | sonde read-only du miroir public, services A2A et dépendance RAG | snapshot `shenron-observability/v1`, `siteHealth` requis et `optionalServices.ragSidecar` informatif |
| `scripts/ops/audit-live-site-assets.ts` | audit read-only du sitemap et des assets first-party | échantillon borné ou exhaustif, rapport des 404/5xx |
| `scripts/ops/audit-refonte-api-latency.ts` | sonde read-only des endpoints publics de la refonte | statuts déterministes et p50/p95 par route |
| `apps/bot/scripts/rag-resync-entites.ts --reparer` | contrôle chunks ↔ vecteurs sans écriture par défaut | 0 vecteur orphelin et 0 chunk sans vecteur |
| `docs/architecture-refonte-runtime-report.schema.json` | contrat machine-readable du rapport runtime | validation des champs A2A/CI |
| `scripts/ops/audit-refonte-architecture.ts` | garde-fou structurel de cette spécification | `bun run audit:architecture` |

Cette table ne transforme pas une présence de fichier en validation fonctionnelle : les critères
de migration, d’accessibilité, de données et de production restent ceux des Sprints 2 à 6.

La migration actuellement observée est une étape transitoire : `bot.db_media_publications`
sort les anciens « Jump Anime Comics » et « Light Novel » du catalogue databooks avant leur
normalisation future dans `bot.media_works`. Les anciennes URL sont stockées dans
`public.url_redirects(source_path, target_path, status_code, visible)`. La cible `public.redirects`
mentionnée plus bas est donc un nom conceptuel ; l’implémentation doit conserver le nom réel
`url_redirects` et son schéma jusqu’à la prochaine migration explicite.

### Registre historique de validation — relevés datés du 2026-09-19

Ces résultats ne décrivent ni l'état actuel des services ni les procédures
d'exploitation après la délégation à `aphrody-infra`.

| Commande | Résultat | Portée |
|---|---:|---|
| `bun --filter @shenron/site type-check` | OK (2026-09-19) | types site + tests TypeScript |
| `bun apps/site/scripts/audit-wiki-contract.ts --json` | FAIT : contrat SQL/TypeScript valide (`ok=true`) sur les tables éditoriales observées | vérifie clés primaires et colonnes mutables contre `information_schema` |
| `bun apps/site/scripts/audit-wiki-couverture.ts --json=.coord/wiki-coverage-latest.json` | FAIT : 12 familles, 3 334 entrées visibles auditées (2026-09-19T12:36:12Z) ; champs structurants des épisodes/films/tomes/chapitres couverts, ISBN et métadonnées secondaires restent partiels | audit read-only champ par champ ; ne transforme pas les lacunes éditoriales en données inventées |
| `bun apps/site/scripts/canon-ingest.ts --simuler` | FAIT : corpus lu sans écriture — aphrody 84, databooks 3 870, manga 870 références ; 0 ajout, 0 modification, 0 masquage (2026-09-19T12:37:30Z) | simulation idempotente des sources canoniques ; l’ingestion réelle reste séparée et auditable |
| `bun apps/site/scripts/reancre-canon-references.ts --report=.coord/architecture-refonte-canon-reanchor-latest.json` (simulation) | **INCOMPLET** : 18 fiches article sans source scannées, 1 ancrage canonique exact (Bardock), 17 résiduels listés par table/id/nom ; 0 écriture | rapport JSON natif `--report` conservé pour revue ; les variantes/œuvres dérivées restent à arbitrer, aucune référence n’est ajoutée automatiquement |
| `bun test apps/site/tests/databook-features.test.ts` | 24 pass / 0 fail | données et fonctions databooks, PostgreSQL inclus |
| `bun test apps/site/tests/manga-integration.test.ts` | 7 pass / 0 fail | catalogue DB/DBFC/DBS, variantes et planches du lecteur |
| `bun test apps/site/tests/page-banners-wiring.test.ts` | 3 pass / 0 fail | wiring des héros, hub staff et routes publiques |
| `bun test apps/site/tests/admin-dashboard-live.test.ts` | 3 pass / 0 fail | sonde A2A/DB/Redis après reprise du heartbeat |
| tests ciblés auth et invariants de déploiement local (exécutés le 2026-09-19 avant délégation) | 14 puis 11 pass / 0 fail | preuve historique ; le test de déploiement local a été retiré avec son propriétaire de déploiement |
| `bun test apps/site/tests/wiki-media-api.test.ts apps/site/tests/wiki-timelines-api.test.ts apps/site/tests/wiki-contributors-api.test.ts apps/site/tests/wiki-events-api.test.ts` | 20 pass / 0 fail / 173 assertions | handlers média, timelines, contributeurs et événements validés localement |
| `bun test apps/site/tests/refonte-migrations.test.ts` | 5 pass / 0 fail / 17 assertions | migrations 0017–0019 : idempotence, masquage logique, redirections 301 et absence de `DELETE FROM` |
| `bun test apps/bot/tests/rag-eval.test.ts apps/bot/tests/rag-filter.test.ts --parallel=1` | 33 pass / 0 fail / 78 assertions | matcher, métriques, routage canon, filtres et déduplication RAG validés localement |
| copie PostgreSQL temporaire `shenron_refonte_copy_*` + `pg_dump | pg_restore` + `psql -f` deux fois sur 0017/0018/0019 | FAIT : 11 tables restaurées, second passage sans erreur, deux bases supprimées via `trap` | validation snapshot/restauration et idempotence sur copies isolées ; aucune base de production touchée |
| `bun test apps/site/tests/no-404.test.ts apps/site/tests/og.test.ts apps/site/tests/wiki-launch.test.ts apps/site/tests/databook-features.test.ts` | 43 pass / 2 skip / 0 fail | contrats redirections/canoniques, gating et lecteur ; la sonde no-404 reste ignorée sans `SITE_AUDIT_ORIGIN` |
| `SITE_TEST_LIVE=1 NO_404_CONCURRENCY=12 NO_404_TIMEOUT_MS=8000 bun test apps/site/tests/no-404.test.ts` | **INCOMPLET** : 916 URLs testées, 4 404 (`/api/wiki/media`, `/api/wiki/timelines`, `/api/wiki/contributors`, `/api/wiki/events`) | preuve miroir production ; les routes existent et sont testées localement mais ne sont pas encore déployées |
| `git rev-list --count origin/main..HEAD` + comparaison des commits | **FAIT** : 0 commit local non publié après push (`origin/main=9f261538`, `HEAD=9f261538`) | le dépôt est synchronisé ; les 404 live persistent jusqu’au déploiement bleu/vert |
| `bun run audit:architecture` | 105/105 au 2026-09-19 | ancien ensemble de contrôles ; le script courant vérifie seulement les artefacts applicatifs encore possédés ici |
| `REFONTE_AUDIT_ONCE=1 REFONTE_AUDIT_RUNTIME=1 REFONTE_AUDIT_API=1 bun run audit:architecture:watch` | FAIT : verdict runtime `FAIT`, `runtimeExitCode=0`, `apiExitCode=0`, `failureStreak=0` (tour du 2026-09-19) | boucle officielle exercée en un tour ; les 404 API restent observés mais acceptés comme état déterministe jusqu’au déploiement |
| `git diff --check` | OK | intégrité syntaxique des changements |
| `bun scripts/ops/observability-snapshot.ts --out .coord/architecture-refonte-observability-latest.json` | site, siteHealth, bot et MCP HTTP 200 (2026-09-19T12:31Z) ; `optionalServices.ragSidecar` error/absent ; 0 ligne JSONL invalide ; 5 relectures d’événement identiques ; heartbeat AGY stale | la métrique ignore désormais les transitions normales submitted/working/completed et ne compte que les relectures identiques ; aucune purge A2A destructive |
| `SITE_AUDIT_MAX_PAGES=100 SITE_AUDIT_MAX_ASSETS=500 bun scripts/ops/audit-live-site-assets.ts` | 100 pages + 500 assets, 0 échec (47 732 pages / 2 044 assets découverts) | échantillon public borné ; le rapport expose `pagesDiscovered`, `assetsDiscovered`, audités et échecs |
| `bun run audit:refonte-api --out .coord/architecture-refonte-api-latency-latest.json` | 4 routes, 3/3 réponses déterministes chacune, aucun 5xx ; p95 observé 48–105 ms (2026-09-19T12:38:21Z) | miroir public ; les 404 actuels sont toujours déterministes jusqu’au prochain déploiement des routes |
| `sudo -n nginx -t` + état `shenron-site-b` + manifeste `.next/server/app-paths-manifest.json` | **FAIT** : Nginx actif/activé et configuration valide ; upstream actif `127.0.0.1:3010` (slot B), release `20260918165109-87a65b32` ; le dépôt observé lors de cette mesure était `5c3620b6`, mais les quatre routes refonte étaient absentes du manifeste | cause des 404 isolée : release live antérieure au code poussé ; aucune modification ni redémarrage effectué |
| `bun run clean:vps` + arrêt du processus autonome `python3 -m http.server :8999` | **FAIT** : processus hors systemd arrêté après vérification ; nettoyage borné terminé, espace récupéré `+536M` (7,0 Gio libres, disque à 93 %) | aucun MainPID systemd critique touché ; services Nginx, PostgreSQL, Redis, bot, MCP et slot B restés actifs |
| `bun run bot:build` + `bun --filter @shenron/mcp type-check` + `bun --filter @shenron/site type-check` | **FAIT** : build bot et vérifications TypeScript terminés sans erreur | validation monorepo partielle réussie ; aucun changement de service actif |
| `next build --webpack` borné (`BUILD_CPUS=1`, `BUILD_STATIC_CONCURRENCY=1`) + packaging | **FAIT** : build complet, TypeScript, 1 857 pages statiques et artefact scellé `build-TfctsWXpff2fKS` | fallback webpack validé sur ce VPS ; avertissements i18n préexistants consignés, aucune erreur de build |
| `SHENRON_BUILD_WEBPACK=1 bun scripts/ops/deploy-site.ts --artifact=artifacts/site-build.tar.gz --no-build` | **FAIT** : release `20260919143019-5e0db582`, slot A `:3000`, bascule Nginx sans coupure ; toutes les sondes, dont les quatre APIs refonte, répondent dans les codes attendus | snapshot de dépendances compatible réutilisé (lockfile/Bun/ABI identiques) pour éviter une recopie de 3,8 Gio ; release B précédente conservée pour rollback |
| `systemctl is-active/is-enabled shenron-embed.service` + `curl 127.0.0.1:5007/health` | `inactive`, `disabled`, HTTP 000 | sidecar volontairement hors ligne sur ce VPS ; métrique dense reportée au VPS RAG dédié |
| `bun test apps/site/tests --parallel=1` | 1 153 pass / 2 skip / 0 fail sur 1 155 tests (2026-09-19) | suite complète séquentielle, référence anti-interférence |
| `bun apps/bot/scripts/rag-eval.ts --validate --ci --json=.coord/architecture-refonte-rag-eval-hybrid.json` | 172/172 sources présentes ; sidecar absent, repli lexical Recall@5 **80,2 %**, CI validée | gold set servi avec dégradation contrôlée ; rapport poussé dans Redis, métrique dense toujours à mesurer quand le sidecar revient |
| `bun apps/bot/scripts/rag-resync-entites.ts --reparer` | 59 995 chunks / 59 995 vecteurs ; 0 / 0 orphelin | simulation read-only ; aucune écriture appliquée |
| `bun apps/bot/scripts/rag-resync-entites.ts --toutes --report=.coord/architecture-refonte-rag-resync-latest.json` | **INCOMPLET** : 155 734 ajouts candidats, 3 993 retraits, 56 002 inchangés ; 0 vecteur orphelin / 0 passage sans vecteur | scan exhaustif read-only, rapport `shenron-rag-resync/v1` ; `--appliquer` reste bloqué jusqu’à revue des sources et du périmètre |

Ce registre est une photographie vérifiée, pas une garantie permanente : chaque modification
relance les commandes adaptées et remplace la ligne par un résultat daté dans le journal de
la boucle.

### Suite complète — limites constatées

Le dernier passage parallèle historique (`bun test apps/site/tests`) avait produit 1 068 pass,
2 skip, 6 échecs et 2 erreurs, dus aux mocks partagés entre fichiers. Le passage de référence
séquentiel actuel (`bun test apps/site/tests --parallel=1`) exécute **1 155 tests : 1 153 pass,
2 skip, 0 fail**. Les tests ciblés de la refonte, du déploiement/auth et du RAG restent donc
verts au moment de cette photographie ; le test local de déploiement a depuis été retiré car
les unités et bascules relèvent d'`aphrody-infra` ; le mode parallèle
est conservé uniquement comme détecteur d’interactions.

Une mesure avec `REFONTE_AUDIT_SERIAL=1` (Bun `--parallel=1`) a exécuté **1 153 pass**,
2 skip et **0 fail** sur 1 155 tests ; son rapport runtime est `FAIT` avec
`fullSuiteExitCode=0`, `serialValidation=true` et `failureStreak=0`. La divergence est donc limitée au chargement
parallèle de modules/mocks entre fichiers ; le mode séquentiel constitue la référence fiable
pour la validation de la refonte, tandis que le mode parallèle reste conservé comme détecteur
d’interactions.

## 1. Principes non négociables

- **Identité stable** : les clés numériques existantes ne changent pas ; chaque nouvel objet
  reçoit un `slug` canonique immuable et des alias historiques.
- **Preuve avant éditorial** : une relation canonique ou un crédit exige une source primaire
  enregistrée (`bot.db_sources`/`public.canon_references`) et un statut de vérification.
- **Séparation des continuités** : manga, anime, films, jeux et Xenoverse sont des timelines
  distinctes ; aucune fusion silencieuse d’un récit dérivé dans le manga.
- **Bitemporalité légère** : `published_at` décrit l’œuvre ; `created_at`, `updated_at` et
  `wiki_revisions` décrivent l’état éditorial du site.
- **Lecture seule par défaut** : API publiques paginées, requêtes paramétrées, et cache par
  combinaison de facettes. Les mutations passent par l’admin wiki avec audit.
- **Trilingue** : `name`, `name_ja`, `name_romaji`, plus les textes localisés versionnés ; le
  slug est indépendant de la langue (`son-goku`, jamais une traduction variable).

## Phase 1 — schéma de données et ontologie

### 1.1 Média, manga et variantes de lecture

Les tables actuelles `bot.db_manga_volumes` et `bot.db_manga_chapters` restent compatibles.
Les colonnes existantes (`series`, `volume_number`, `title`, `title_ja`, `cover`, `pages`,
`volume_id`, `visible`) sont conservées. Les tables suivantes normalisent ce qui manque sans
dupliquer les planches.

```sql
create type bot.media_kind as enum ('manga', 'databook', 'guide', 'light_novel', 'anime_comic', 'spin_off');
create type bot.edition_kind as enum ('tankobon', 'full_color', 'kanzenban', 'soshuuhen', 'bunko', 'digital', 'other');
create type bot.page_color as enum ('nb', 'color', 'mixed');

create table if not exists bot.media_works (
  id bigint generated always as identity primary key,
  slug text not null unique,
  kind bot.media_kind not null,
  series text not null,
  title text not null,
  title_ja text,
  title_romaji text,
  synopsis_fr text,
  source_id bigint references bot.db_sources(id),
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bot.media_editions (
  id bigint generated always as identity primary key,
  work_id bigint not null references bot.media_works(id),
  edition bot.edition_kind not null,
  label text not null,
  language text not null default 'ja',
  isbn text,
  publisher text,
  published_at date,
  page_color bot.page_color not null default 'nb',
  scan_policy text not null default 'self_hosted',
  visible boolean not null default true,
  unique (work_id, edition, language, isbn)
);

create table if not exists bot.media_volumes (
  id bigint generated always as identity primary key,
  edition_id bigint not null references bot.media_editions(id),
  legacy_volume_id bigint unique references bot.db_manga_volumes(id),
  number numeric(6,2) not null,
  slug text not null unique,
  title text,
  cover text,
  page_count integer,
  visible boolean not null default true,
  unique (edition_id, number)
);

create table if not exists bot.media_chapters (
  id bigint generated always as identity primary key,
  volume_id bigint not null references bot.media_volumes(id),
  legacy_chapter_id bigint unique references bot.db_manga_chapters(id),
  number numeric(8,2) not null,
  slug text not null unique,
  title text,
  pages jsonb not null default '[]',
  ocr_status text not null default 'unprocessed',
  visible boolean not null default true,
  unique (volume_id, number)
);

create table if not exists bot.media_page_assets (
  id bigint generated always as identity primary key,
  uri text not null,
  width integer,
  height integer,
  sha256 text not null,
  source_id bigint references bot.db_sources(id),
  unique (sha256)
);

-- Un asset physique peut être partagé par plusieurs éditions/chapitres sans
-- recopier le fichier ni perdre l'ordre de lecture propre à chaque chapitre.
create table if not exists bot.media_page_refs (
  chapter_id bigint not null references bot.media_chapters(id),
  asset_id bigint not null references bot.media_page_assets(id),
  ordinal integer not null check (ordinal > 0),
  page_label text,
  primary key (chapter_id, ordinal),
  unique (chapter_id, asset_id)
);
```

Pour les 42 tomes de la série DB, `media_works` représente l’œuvre et `media_volumes`
les volumes d’une édition donnée ; l’API publique `/api/wiki/media` expose cette hiérarchie
en lecture seule avec les filtres `kind`, `series`, `slug` et `edition`. Les éditions restent
imbriquées sous leur œuvre et les volumes sont comptés uniquement lorsqu’ils sont `visible`.
représente chaque tome/édition. Les planches ne sont jamais recopiées entre éditions : une
édition peut référencer un même `media_page_assets` par `media_page_refs` si le fichier est
strictement identique. Le catalogue actuel est backfillé par `legacy_*_id`, puis l’API utilise
une vue de compatibilité pendant deux releases.

Contraintes de qualité : `number` contigu par édition (sauf hors-série explicitement marqué),
SHA-256 obligatoire pour chaque asset, et aucune page publiée sans `source_id` ou preuve
d’acquisition. Un tome incomplet reste visible avec un badge « à compléter », jamais rempli
par interpolation.

### 1.2 Événements, combats et chronologies

`db_battles`, `db_timeline_events`, `db_tournaments`, `db_sagas` et `db_arcs` deviennent des
projections éditoriales d’un graphe unifié. On ne supprime pas les tables existantes dans la
première version.

```sql
create type bot.narrative_event_kind as enum ('event', 'battle', 'tournament', 'war');
create type bot.timeline_kind as enum ('manga', 'anime', 'film', 'oav', 'game', 'xenoverse', 'other');
create type bot.canon_rank as enum ('absolute', 'supervised', 'official_extension', 'non_canon', 'apocryphal', 'unverified');

create table if not exists bot.narrative_timelines (
  id bigint generated always as identity primary key,
  slug text not null unique,
  kind bot.timeline_kind not null,
  label text not null,
  parent_id bigint references bot.narrative_timelines(id),
  source_id bigint references bot.db_sources(id),
  visible boolean not null default true
);

create table if not exists bot.narrative_events (
  id bigint generated always as identity primary key,
  slug text not null unique,
  kind bot.narrative_event_kind not null,
  title text not null,
  title_ja text,
  title_romaji text,
  synopsis_fr text,
  timeline_id bigint not null references bot.narrative_timelines(id),
  saga_id bigint references bot.db_sagas(id),
  arc_id bigint references bot.db_arcs(id),
  canon bot.canon_rank not null default 'unverified',
  start_order numeric(10,3),
  end_order numeric(10,3),
  source_id bigint references bot.db_sources(id),
  visible boolean not null default true
);

create table if not exists bot.narrative_event_aliases (
  event_id bigint not null references bot.narrative_events(id),
  alias text not null,
  locale text not null default 'fr',
  primary key (event_id, alias, locale)
);

create table if not exists bot.narrative_event_participants (
  event_id bigint not null references bot.narrative_events(id),
  character_id bigint not null references bot.db_characters(id),
  role text not null default 'participant',
  outcome text,
  primary key (event_id, character_id, role)
);

create table if not exists bot.narrative_event_relations (
  from_event_id bigint not null references bot.narrative_events(id),
  to_event_id bigint not null references bot.narrative_events(id),
  relation text not null check (relation in ('contains','variant_of','adaptation_of','precedes','branches_from')),
  primary key (from_event_id, to_event_id, relation)
);
```

Un doublon apparent n’est pas écrasé : le combat manga et son adaptation anime sont deux
événements avec `adaptation_of`; l’équivalent Xenoverse est `variant_of` sur une timeline
`xenoverse`. Une clé de dédoublonnage candidate (`normalized_title`, participants triés,
timeline, bornes) sert uniquement à la revue humaine et ne déclenche jamais une fusion.

### 1.3 Contributeurs, crédits et hub méta

```sql
create type bot.contributor_category as enum ('author','editorial_staff','animation','voice','music','scenario','publisher','other');

create table if not exists bot.contributors (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  name_ja text,
  name_romaji text,
  category bot.contributor_category not null,
  birth_date date,
  death_date date,
  biography_fr text,
  spotlight_rank integer,
  source_id bigint references bot.db_sources(id),
  visible boolean not null default true
);

create table if not exists bot.contributor_credits (
  id bigint generated always as identity primary key,
  contributor_id bigint not null references bot.contributors(id),
  role text not null,
  credit_scope text not null check (credit_scope in ('work','series','episode','film','game','track','character')),
  work_id bigint references bot.media_works(id),
  episode_id bigint references bot.db_episodes(id),
  movie_id bigint references bot.db_movies(id),
  game_id bigint references bot.db_games(id),
  soundtrack_id bigint references bot.db_soundtracks(id),
  character_id bigint references bot.db_characters(id),
  source_id bigint references bot.db_sources(id),
  visible boolean not null default true,
  check (num_nonnulls(work_id, episode_id, movie_id, game_id, soundtrack_id, character_id) = 1)
);
```

Akira Toriyama reçoit `spotlight_rank = 0` uniquement lorsque sa preuve biographique et ses
crédits sont validés. La page hub ne recopie pas sa biographie : elle affiche un synopsis court
et un lien vers `/wiki/contributeurs/akira-toriyama`. Les autres personnes sont filtrables par
catégorie et rôle, avec pagination et chargement différé.

### 1.4 Dépréciation des catégories obsolètes

1. Exporter un snapshot PG, compter les références et produire `legacy_category_map` :
   `jump-anime-comics → {anime_comic, manga, film, guide}` selon la preuve de chaque entrée ;
   `light-novel → media_kind = light_novel`.
2. Créer les nouvelles lignes avec un `legacy_id`, conserver le slug quand il est unique et
   générer un alias quand il collisionne.
3. Réécrire toutes les FK, liens internes et sources RAG dans une transaction vérifiable.
4. Créer ou alimenter `public.url_redirects` (`source_path`, `target_path`, `status_code=301`,
   `visible`) et une règle de non-régression SEO : chaque ancienne URL résout vers une seule URL
   canonique.
5. Marquer les anciennes catégories `visible = false`, renseigner `replaced_by_id` et
   conserver leurs révisions. Aucun `DELETE` physique.
6. Rebuild RAG isolé, purge des chunks orphelins, puis validation de 100 % des liens entrants.
7. Après deux releases sans trafic résiduel, seulement alors retirer les routes mortes du code.

## Phase 2 — architecture de l’information et UX

### 2.1 Lecteur manga unifié : machine à états

États : `loading → ready | error`; dans `ready`, `selecting_edition`, `reading`, `prefetching`,
`completed`. Transitions :

| Événement | Garde | Action |
|---|---|---|
| `OPEN(volume, edition?)` | volume visible | choisir l’édition canonique, charger page 1 |
| `SELECT_EDITION(id)` | édition disponible | conserver `ordinal`, reset si hors bornes |
| `NEXT` / `PREV` | page dans les bornes | mettre à jour URL et précharger voisin |
| `JUMP(ordinal)` | entier valide | afficher page cible, pousser historique |
| `LOAD_FAILURE` | retry épuisé | `error`, conserver dernière page |
| `END_VOLUME` | dernière page | proposer tome suivant, sans navigation forcée |

URL canonique : `/manga/dragon-ball/volume-01?page=12&edition=tankobon`; les paramètres de
présentation non canoniques (`fit`, `theme`) ne sont pas indexés. Le sélecteur affiche une
étiquette, langue, couleur, nombre de pages et statut de complétude ; il interdit de prétendre
qu’une édition absente est disponible.

Desktop : colonne de lecture centrée (largeur maximale contrôlée), rail miniature optionnel,
barre supérieure fixe (tome, édition, page, progression). Mobile : une seule planche, gestes
précédent/suivant, boutons accessibles, `IntersectionObserver` pour préchargement ±1 et cache
limité. Chaque image porte `width/height`, `alt` localisé et `decoding=async`; le SSR livre la
métadonnée puis hydrate le lecteur.

### 2.2 Navigation et databooks

Le rail devient un drawer responsive, avec groupes accordéon mémorisés par utilisateur :

```text
Dragon Ball
├─ Manga (42 tomes)       [lecteur unifié]
├─ Databooks               ├ Daizenshuu
│                          ├ Chōzenshū / guides
│                          └ Sōshūhen
├─ Light novels            [œuvres dérivées, statut visible]
├─ Anime & films
├─ Chronologies & combats  [facettes]
├─ Jeux & timelines        [Xenoverse séparé]
└─ Autour de Dragon Ball   [contributeurs, OST, seiyū]
```

La navigation est pilotée par un manifeste typé (label, route, permission, compteur), non par
des conditions dispersées dans les composants. Le fil d’Ariane et les données structurées
reflètent la même hiérarchie.

### 2.3 Wireframe du hub méta

```text
┌ Autour de Dragon Ball ──────────────────────────────────────────┐
│ HERO · AKIRA TORIYAMA                                           │
│ [portrait]  Auteur · créateur · impact documenté                 │
│ synopsis court                                                → Bio│
├ Explorer l’équipe ───────────────────────────────────────────────┤
│ [Tous] [Auteur] [Éditorial] [Animation] [Doublage] [Musique]     │
│ Recherche…  Année…  Œuvre…                                      │
│ ┌ carte contributeur ┐ ┌ carte contributeur ┐ …                 │
│ │ rôle · œuvres       │ │ rôle · œuvres       │                 │
│ └─────────────────────┘ └─────────────────────┘       [charger] │
├ Réseau de crédits (graphe accessible en liste)                   │
│ œuvres ↔ personnes ↔ rôles · export JSON-LD                      │
└ Sources et révisions                                              ┘
```

Le graphe est une vue progressive (pas un rendu de milliers de nœuds) : liste tabulaire
accessible d’abord, visualisation après interaction. Les crédits non prouvés sont exclus du
compteur public et signalés dans l’admin.
L’endpoint public `GET /api/wiki/contributors` sert cette vue avec recherche `q`, catégories,
filtre spotlight, tri déterministe et pagination plafonnée à 100 ; ses facettes sont calculées
avant la pagination afin que les compteurs restent cohérents avec le corpus visible.

## Phase 3 — recherche et facettes

Payload versionné :

```json
{
  "q": "Goku Vegeta",
  "page": 1,
  "limit": 24,
  "sort": "chronology",
  "filters": {
    "kind": ["battle", "tournament"],
    "canon": ["absolute", "supervised", "non_canon"],
    "timeline": ["manga", "xenoverse"],
    "characterIds": [1, 2],
    "sagaIds": [7],
    "arcIds": [],
    "orderFrom": null,
    "orderTo": null
  }
}
```

Endpoints : `GET /api/wiki/events?q=...&type=battle&type=tournament&timeline=xenoverse` et
`GET /api/wiki/timelines`. Le second expose les continuités visibles avec `event_count` calculé
sur les événements visibles, afin que le filtre de timeline ne promette jamais un volume faux.
Les valeurs sont répétables, validées par une liste blanche et normalisées dans l’URL. Une URL
sans filtre reste canonique ; les combinaisons filtrées portent `noindex,follow` sauf les
landing pages explicitement autorisées (`type`, `timeline`). Réponse : `{data, facets, page,
pageCount, canonicalUrl}`. `facets` est calculé sur le jeu filtré sauf sa propre dimension,
avec compte exact et tri déterministe.

Index minimum : `(visible, timeline_id, kind, canon)`, `(event_id, character_id)`,
`(saga_id, arc_id, start_order)`, trigramme sur les titres et recherche plein texte pondérée
FR/JA. Le moteur exécute d’abord les ID de facettes, ensuite le texte, puis la pagination ; il
ne charge jamais les participants complets dans la requête de comptage.

## Phase 4 — cas limites et audit de rupture

- **Combat manga/anime/Xenoverse** : conserver trois objets, relation `adaptation_of` ou
  `variant_of`, et afficher un sélecteur de continuité. Une page canonique doit déclarer sa
  timeline dans JSON-LD.
- **Light novel hybride** : classer l’œuvre comme `light_novel`, attacher des tags de contenu
  (`official_material`, `derivative`, `mixed`) et un `canon_rank` par assertion, jamais un
  canon global ambigu. Les personnages cités ne deviennent pas automatiquement canoniques.
- **Jump anime comics** : mapper entrée par entrée, vérifier les ISBN/pages et préserver les
  anciens liens par 301. Les couvertures ou planches déjà présentes sont dédupliquées par hash,
  jamais par nom de fichier.
- **Doublons de personnes** : table d’alias et revue manuelle ; fusion seulement si l’identité
  et la source concordent. Les crédits restent auditables après fusion.
- **Échelles volumineuses** : curseur (`id`, `start_order`) pour API, `limit ≤ 100`, SSR des
  24 premières cartes, virtualisation client au-delà de 200, `ETag` et cache court par payload.
- **Pages manquantes / droits** : état explicite `missing` ou `restricted`, placeholder
  accessible ; jamais d’URL inventée ni de fallback silencieux vers une autre édition.
- **SEO/i18n** : un slug, alternates `fr/en/ja`, canonical stable, redirection avant rendu,
  titres localisés indépendants du chemin.
- **RAG** : source ID et `entity_type/entity_id` obligatoires dans chaque chunk ; les
  catégories masquées ne sont pas réindexées ; les relations de variantes sont exposées dans
  les métadonnées pour éviter les réponses fusionnées.

## Phase 5 — plan d’exécution et critères de validation

### Sprint 1 — inventaire et contrats

- Exporter schémas/volumétrie, identifier collisions de slug et catégories à migrer.
- Ajouter les types TypeScript du payload, les JSON Schemas et les fixtures minimales.
- Critères : snapshot restaurable, zéro secret commité, matrice de mapping signée et tests de
  compatibilité des routes existantes.

### Sprint 2 — tables et backfill média

- Migration idempotente des tables média, index et vues de compatibilité.
- Backfill des 42 tomes, chapitres et éditions ; audit SHA-256 et pages.
- Critères : comptes source = comptes cible, FK sans orphelin, aucun `DELETE`, rollback testé
  sur copie et lecteur legacy toujours fonctionnel.

### Sprint 3 — événements et contributeurs

- Migration du graphe d’événements, participants, timelines et crédits.
- Revue des doublons, attribution des preuves, construction du spotlight Toriyama.
- Critères : chaque entrée visible a source + slug + timeline/catégorie ; tests de relations
  cycliques et de canonicité ; endpoints paginés répondent avec 200/4xx déterministes.

### Sprint 4 — recherche et RAG

- Implémenter facettes, curseur, URL canonique et indexes ; tests de plan SQL.
- Rebuild RAG en processus isolé, purge des chunks orphelins et évaluation Recall@k.
- Les nouvelles sources PG sont enregistrées sous `media_works`, `narrative_timelines`,
  `narrative_events` et `contributors` dans `PG_SOURCES` (`media_works: renduMediaWorks`,
  `narrative_timelines: renduNarrativeTimelines`); `rag-build.ts` injecte leur clé de registre comme
  `source_id` et n’indexe que les lignes visibles.
- Critères : combinaisons de facettes stables, latence p95 mesurée sur volumétrie réelle,
  aucune catégorie masquée dans l’index, citations traçables et zéro chunk orphelin. Le dernier
  gold run est `FAIT` : 172/172 sources présentes et Recall@5 80,2 % ≥ seuil 80 %. Le
  contrôle d’alignement est également `FAIT` (59 995 / 59 995, aucun orphelin) ; le sidecar
  d’embeddings étant volontairement désactivé ici par `deploy/install.sh` (migration vers un
  VPS RAG dédié), la métrique dense servie hybride reste à mesurer sur cette infrastructure
  dédiée ; le repli BM25 est la preuve de référence locale.

### Sprint 5 — lecteur et navigation

- Brancher la FSM sur l’API média ; préchargement, reprise de page, accessibilité clavier et
  mobile ; déployer le drawer et le hub méta.
- Critères : parcours 42 tomes sur desktop/mobile, édition absente gérée explicitement,
  Lighthouse/accessibilité sans régression bloquante, URLs canoniques et sitemap valides.

### Sprint 6 — migration SEO et bascule

- Activer les 301, publier les landing pages autorisées, masquer les catégories obsolètes,
  revalider sitemap et liens entrants.
- Faire produire par `bun run site:artifact` un artefact vérifié, puis laisser
  le pipeline `aphrody-infra` publier la release, sonder les API/cache/RAG et
  conserver le rollback. Le dépôt Shenron ne bascule pas directement les services.
- Critères de sortie : 0 FK orpheline, 0 lien interne cassé dans l’audit, 100 % des anciennes
  URLs importantes redirigées, rollback documenté et bilan admin publié.

## Checklist de livraison

- [x] Migration idempotente, snapshot et restauration testés sur copie.
- [x] `visible = false` utilisé pour toute dépréciation ; aucune suppression physique.
- [ ] Sources, canon, crédits et variantes vérifiés par preuve.
- [x] `bun` uniquement ; tests ciblés exécutés, et `gen:entries` non requis (aucune commande/event modifié).
- [ ] Index RAG reconstruit hors premier plan et chunks orphelins contrôlés.
- [ ] API, lecteur, navigation, sitemap, alternates et 301 vérifiés en production miroir.
- [x] Handoff opérateur : push synchronisé, déploiement bleu/vert et re-sonde live terminés ; slot A `20260919143019-5e0db582` actif, quatre APIs refonte HTTP 200 avec `X-Forwarded-Proto: https`.
- [x] Bilan bimodal publié dans `.coord` (rapports JSON) et notification envoyée au salon admin.
- [x] `bun run audit:architecture` passe avec le total de contrôles courant (105/105 au dernier
  tour, augmenté lorsqu’un nouveau contrat est ajouté).

## Boucle de travail continue (itération contrôlée)

La « boucle infinie » du chantier est une boucle d’observation et de correction, pas un
processus qui monopolise un worker ou une connexion. Elle est relancée par CI, un opérateur ou
un agent A2A après chaque changement et s’arrête uniquement lorsqu’un critère de sortie est
prouvé.

Pour une surveillance locale continue, lancer `REFONTE_AUDIT_INTERVAL_MS=60000 bun run
audit:architecture:watch`. Le watcher relance l’audit Bun à chaque tour, conserve le code de
sortie de chaque contrôle et s’arrête proprement sur `SIGINT`/`SIGTERM`. Il ne modifie ni la
base ni le contenu du document ; les corrections restent des changements examinés séparément.
Pour exécuter un seul tour (CI, diagnostic ou reprise après incident), ajouter
`REFONTE_AUDIT_ONCE=1` ; le rapport est écrit puis le processus se termine sans attendre
l’intervalle suivant.
Pour neutraliser les interactions de mocks entre fichiers pendant la suite exhaustive,
ajouter `REFONTE_AUDIT_SERIAL=1` avec `REFONTE_AUDIT_FULL=1` ; le watcher transmet alors
`--parallel=1` à Bun et conserve ce mode dans le journal de démarrage.
Chaque tour écrit aussi le dernier verdict dans `.coord/architecture-refonte-last.json` (chemin
modifiable avec `REFONTE_AUDIT_REPORT`) pour permettre une reprise après interruption.
Il append également le verdict runtime dans `.coord/architecture-refonte-history.jsonl`, borné
aux 200 derniers tours ; le chemin est modifiable avec `REFONTE_AUDIT_HISTORY`. Ce journal JSONL
conserve la tendance `failureStreak` après chaque relance, sans remplacer le dernier
rapport consommé par les outils.
Pour inclure la validation comportementale à chaque tour, ajouter `REFONTE_AUDIT_RUNTIME=1` ;
le watcher exécutera alors `bun test apps/site/tests/databook-features.test.ts` après l’audit
structurel et affichera les deux codes de sortie dans le journal du tour. Il persistera aussi
le verdict combiné dans `${REFONTE_AUDIT_REPORT}.runtime.json` avec `FAIT` uniquement si les
contrôles activés valent zéro. Le fichier est écrit même en mode structurel seul, maintient `failureStreak` et pose `escalation: "ADMIN_REQUIRED"`
au troisième tour non passant consécutif ; l’agent ou l’opérateur doit alors publier le bilan
dans le canal admin avant de poursuivre les corrections.
Pour sonder aussi les endpoints publics de la refonte à chaque tour, ajouter
`REFONTE_AUDIT_API=1` ; le watcher lance alors `bun run audit:refonte-api`, conserve son rapport
`.api.json` et inclut `apiExitCode` dans le verdict runtime. Cette option reste désactivée par
défaut afin de ne pas générer de trafic réseau lors d’un audit structurel local.
Pour un tour de maintenance exhaustif, ajouter aussi `REFONTE_AUDIT_FULL=1` : le watcher lance
`bun test apps/site/tests` et persiste `fullSuiteExitCode`. Les échecs connus de la suite globale
restent alors visibles dans le rapport au lieu d’être confondus avec les tests ciblés.

```text
OBSERVE → MESURE → PRIORISE → MODIFIE → VALIDE → PUBLIE LE BILAN
   ↑                                                        │
   └────────────── nouvel écart ou nouvelle preuve ─────────┘
```

À chaque tour, le journal doit contenir : commit/artefact, snapshot ou endpoint inspecté,
constat chiffré, changement appliqué, commande de validation, résultat et prochaine action.
Les actions destructrices sont interdites si le snapshot ou le rollback associé n’est pas
présent. Un état inchangé est un résultat de mesure valide, mais ne justifie pas de redémarrer
un service.

Ordre de priorité permanent : (1) intégrité et canon, (2) FK/slug/redirects, (3) sources et
RAG, (4) performances API, (5) lecteur et ergonomie, (6) enrichissements éditoriaux. Une
anomalie répétée trois tours de suite est escaladée dans `docs/ADMIN-REPORTS.md` et via le
canal admin ; elle ne doit pas être masquée par une modification de présentation.

Critères d’arrêt global : toutes les cases de livraison sont prouvées sur un miroir de
production, deux releases successives n’introduisent ni 404 ni chunk orphelin, les métriques
p95 restent sous les seuils du Sprint 4, et le rollback est démontré. Tant qu’un critère manque,
la boucle reste ouverte et reprend au premier contrôle qui a échoué.
