# Archive historique — Neon ↔ GitHub ↔ Vercel

> **Retiré.** Ce document décrit l’ancienne architecture Neon/Vercel et des
> workflows qui ne sont plus présents dans ce dépôt. Il ne constitue pas une
> procédure exploitable ni l’état courant de production. Le site est livré par
> artefact via `.github/workflows/site-artifact.yml`; l’infrastructure active
> et les déploiements sont gérés dans `aphrody-infra`.

Les informations ci-dessous sont conservées comme historique. Ne pas exécuter
les commandes ou procédures listées sans les réécrire pour l’architecture actuelle.

Pipeline de bout en bout pour le **site** (`apps/shenron/site`, projet Vercel `dbfr`,
rootDirectory `apps/shenron/site`) : branche Neon par PR, migrations Drizzle, env preview
Vercel câblée sur la branche, migration prod au déploiement, nettoyage à la
fermeture de PR. Plus la couverture des jobs récurrents (cron/scripts/wiki-crawl)
qui touchent la base.

> **Périmètre.** Seul **`apps/shenron/site`** utilise Neon Postgres comme base applicative
> (schéma `public.*` : `User`, `Post`, `Comment`, `WikiPage`, `WikiCategory`,
> `ba_*`, `site_events`, `user_preferences`). Le **bot** (`apps/shenron/bot`) tourne sur
> **SQLite** (`apps/shenron/bot/data/bot.db`, `bun:sqlite`) — il n'utilise PAS Neon en
> runtime. Le schéma Neon **`bot.*`** est un **miroir de données** alimenté par
> les scripts de sync/ingest (cf. §4), pas géré par `drizzle-kit` côté Postgres.

## Vue d'ensemble

```
PR ouverte / synchronize
  └─ neon-branch.yml (job setup)
       ├─ neondatabase/create-branch-action@v5
       │     → branche Neon `preview/pr-<n>-<head>` (fork de la branche par défaut)
       │     → sortie: db_url_with_pooler
       ├─ drizzle-kit migrate           (apps/shenron/site, DATABASE_URL = branche PR)
       │     → applique les migrations GÉNÉRÉES, idempotent
       ├─ vercel env add DATABASE_URL preview <git-branch>
       │     → le déploiement PREVIEW de `dbfr` tape la branche Neon isolée
       └─ neondatabase/schema-diff-action@v1  → commentaire de diff sur la PR

merge / push main  (si schéma changé)
  └─ deploy-vercel.yml
       ├─ job migrate-prod  (gate dorny/paths-filter sur schema.ts/migrations/**)
       │     → neonctl résout la connection string de la branche par défaut (prod)
       │     → drizzle-kit migrate   (idempotent, prod)
       └─ job deploy (needs: migrate-prod)
             → vercel deploy --prod

PR fermée / mergée
  └─ neon-branch.yml (job cleanup)
       ├─ neondatabase/delete-branch-action@v3   → supprime la branche Neon
       └─ vercel env rm DATABASE_URL preview <git-branch>  → retire l'override
```

## Fichiers

| Fichier                               | Rôle                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `.github/workflows/neon-branch.yml`   | Branche par PR + migrate + wire preview Vercel + schema-diff + cleanup      |
| `.github/workflows/deploy-vercel.yml` | `migrate-prod` (conditionnel) → `deploy` prod                               |
| `apps/shenron/site/drizzle.config.ts`         | `schema: src/db/schema.ts`, `out: src/db/migrations`, `dialect: postgresql` |
| `apps/shenron/site/src/db/migrations/`        | Migrations générées + `meta/_journal.json` (`drizzle-kit generate`)         |
| `apps/shenron/site/src/lib/db.ts`             | Client Drizzle (`postgres-js`, `prepare:false` pour le pooler pgbouncer)    |

## Secrets & variables GitHub (repo `aphrody-code/shenron`)

Tous **déjà provisionnés** (vérifié) — aucune étape humaine restante :

| Nom                 | Type     | Valeur / source                                                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `NEON_API_KEY`      | secret   | clé API Neon (Neon GitHub App). Utilisée par create/delete/schema-diff **et** par `neonctl` pour résoudre l'URL prod. |
| `NEON_PROJECT_ID`   | variable | `patient-star-28731823` (projet `shenron`, org `aphrody`)                                                             |
| `VERCEL_TOKEN`      | secret   | override env preview + deploy prod                                                                                    |
| `VERCEL_ORG_ID`     | secret   | `team_guWQJZI4ZmSLj2K3RWuU4VqM`                                                                                       |
| `VERCEL_PROJECT_ID` | secret   | `prj_wxLn9COQIo9HAOUVis08ppKXx7zI` (projet `dbfr`)                                                                    |

> La connexion prod n'est **jamais** stockée en secret : `migrate-prod` la résout à
> la volée via `neonctl connection-string --api-key $NEON_API_KEY --project-id …
--pooled` (branche par défaut), et la passe à `drizzle-kit` par variable
> d'environnement — jamais loggée.

## Choix de design

- **`drizzle-kit migrate` (pas `push`).** Le repo a un dossier de migrations
  généré (`src/db/migrations` + `_journal.json`) ; `migrate` est idempotent
  (table `drizzle.__drizzle_migrations`) et applique uniquement les migrations
  non encore enregistrées. Les branches preview sont des **forks de la branche
  par défaut** (schéma déjà présent) → seules les **nouvelles** migrations de la
  PR s'appliquent. Validé sur une branche éphémère : `migrate` reconnaît la
  migration `0000_dark_johnny_blaze` déjà appliquée et ne fait rien de
  destructif. Workflow pour régénérer une migration après un changement de
  schéma : `cd apps/shenron/site && bun run db:generate` (commit le `.sql` + le `meta/`).
- **`create-branch-action@v5`** (sortie `db_url_with_pooler`). v6 existe mais
  renomme la sortie en `db_url_pooled` ; on reste sur v5 pour la stabilité.
- **Env preview scopée par git-branch** plutôt que par l'intégration Neon-Vercel
  native : le projet `dbfr` n'a pas l'intégration GitHub native (App sans accès
  au repo privé), donc on pousse l'override via la CLI Vercel. Idempotent
  (`rm` avant `add`). La prod (`public.*` sur la branche par défaut) n'est
  **jamais** touchée par le chemin PR.
- **Gate prod** via `dorny/paths-filter@v3` : `migrate-prod` ne tourne que si
  `schema.ts`, `migrations/**` ou `drizzle.config.ts` ont changé ; sinon le job
  passe en no-op et `deploy` enchaîne.

## §4 — Cron / scripts / wiki-crawl qui touchent la base

Les événements récurrents qui écrivent la base sont **VPS-bound** (ils dépendent
de la SQLite du bot et/ou du binaire `bxc` headless — indisponibles sur les
runners GitHub hébergés), donc automatisés par **timers systemd** lisant
`DATABASE_URL` depuis `~/.shenron-neon.env` (jamais commité). Tous
lisent l'URL depuis l'env (zéro hardcode) et écrivent un schéma **isolé**
(`bot.*`), jamais `public.*` du site.

| Événement (script)                                                              | Cible DB                     | Automatisation                                      | Cadence         |
| ------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------- | --------------- |
| `sync-sqlite-to-neon.ts` (runtime + `db_news` SQLite→Neon)                      | Neon `bot.*`                 | `shenron-neon-sync.timer`                           | 30 min          |
| `sync-neon-to-sqlite.ts` (wiki éditorial Neon→SQLite)                           | SQLite                       | `shenron-neon-pull.timer`                           | 15 min          |
| `resolve-streams.ts` (flux vidéo → Neon, bxc headless)                          | Neon `bot.*`                 | `shenron-stream-resolve.timer` (opt-in)             | 2 h             |
| **`ingest/scrape-manga-chapters.ts`** (wiki-crawl planches manga, bxc headless) | Neon `bot.db_manga_chapters` | **`shenron-wiki-crawl.timer`** (opt-in, **ajouté**) | 1×/jour 04:30   |
| `update-deps.yml` (bun update)                                                  | —                            | GitHub Actions `schedule`                           | lundi 06:00 UTC |
| `codeql.yml`                                                                    | —                            | GitHub Actions `schedule`                           | mardi 07:00 UTC |

**Lacune comblée** : le wiki-crawl manga (`scrape-manga-chapters.ts`) était le
seul événement récurrent touchant la base **sans** hook d'automatisation. Ajouté :
`deploy/systemd/shenron-wiki-crawl.{service,timer}` (même patron que les autres
units : `Type=oneshot`, `EnvironmentFile`, `bxc` sur le PATH, `--limit 20` pour
rester borné/idempotent). Laissé **opt-in** dans `deploy/install.sh` (dépend de
`bxc` + réseau sortant lourd), à activer par :

```bash
sudo systemctl enable --now shenron-wiki-crawl.timer
```

Toutes les commandes de migration/seed Drizzle (`db:push`, `db:generate`,
`db:migrate`, `db:seed-*`) lisent `DATABASE_URL`/`DATABASE_PATH` depuis l'env —
aucune chaîne de connexion n'est codée en dur dans le dépôt (audité).

## Étape humaine restante

**Aucune.** `NEON_API_KEY` + `NEON_PROJECT_ID` sont déjà provisionnés sur le
repo (Neon GitHub App installée), et `VERCEL_*` + `GH_PACKAGES_TOKEN` aussi. Les
deux workflows sont prêts à tourner à la prochaine PR / au prochain push `main`.

> Si un jour la clé est révoquée, la régénérer dans la console Neon
> (`Settings → API Keys`) puis :
> `gh secret set NEON_API_KEY -R aphrody-code/shenron --body '<clé>'`.
