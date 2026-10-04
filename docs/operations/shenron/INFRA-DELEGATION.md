# Délégation infra — Shenron → aphrody-infra

> L'autorité Infra a été regroupée dans le monorepo Aphrody : contrôleur
> `crates/infra/infra`, catalogues `config/`, inventaire `inventory/` et
> références courantes sous `docs/operations/infra/`. Les noms de checkout
> `aphrody-infra` ci-dessous décrivent la migration et les chemins historiques.
> Pour la topologie observée le 2026-10-02, consulter
> [`TOPOLOGY-OBSERVATION-2026-10-02.md`](../infra/TOPOLOGY-OBSERVATION-2026-10-02.md)
> et [`VPS-STATUS-2026-10-02.md`](../infra/VPS-STATUS-2026-10-02.md).

Depuis la migration décrite dans `docs/SHENRON-MIGRATION.md` et
`docs/PRODUCTION-ALLOCATION.md`, l'exploitation de Shenron n'est
plus pilotée depuis ce dépôt. Ce document fixe la frontière : qui possède
quoi, ce qui reste ici, et la liste des fichiers à supprimer une fois leur
équivalent confirmé côté de l'Infra du monorepo.

Faits de cible (source : l'Infra du monorepo, ne pas dupliquer ici en détail) :
production servie par le gros VPS (plus par `dbfr`) ; `dbfr` ne porte plus que
PostgreSQL/données/backups ; ports d'écoute, pointeur de release courante et
répertoire des releases sont lus dans le catalogue et la topologie
de l'Infra du monorepo, jamais recopiés ici ; RG reste la référence
Better Auth / Postgres / backups pour Shenron (contrats
`reuse-rg-better-auth-boundary` et `postgresql-with-sqlite-cache`).

## Ce que possède l'Infra du monorepo

- Le catalogue des services et leurs unités systemd
  (`config/service-catalog.json` : `shenron-site.service`,
  `shenron-bot.service` (API incluse),
  `shenron-backup.timer`).
- Les routes Nginx publiques et la politique « un seul Nginx, une seule table
  de routes » (`config/nginx-routes.json`).
- Les contrats d'application (`config/application-contracts.json`) : UI et
  Better Auth canoniques chez RG, PostgreSQL comme source de vérité, SQLite
  comme cache local borné.
- Le pointeur de release Shenron courante, les releases versionnées, la
  bascule atomique et le rollback.
- Les backups, timers et la politique de rétention (`config/scheduler-policy.json`).
- Les probes/health checks post-déploiement et le blue/green au niveau
  infra (le repo Shenron ne gère plus son propre slot A/B).

## API mutualisée : pas d'unité `shenron-api`

`@shenron/api` (Hono) est **monté dans `shenron-bot` et dans `shenron-site`** ;
il n'existe ni unité `shenron-api` ni vhost `shenron-api` dédiés. Les routes
publiques de l'API sont servies par les vhosts du bot et du site déclarés dans
`config/nginx-routes.json`. Contrat, montages et limiteurs :
[`design/aphrody-m3/packages/material-web/docs/STACK.md`](../../architecture/shenron/STACK.md) (§3.6 `@shenron/api`, ticket INFRA-5 du §7.3).

## Dépendances d'exécution (catalogue de l'Infra du monorepo)

Shenron consomme ces services et fichiers sans les posséder ; noms, ports,
hôtes et chemins sont lus dans le catalogue et l'environnement, jamais codés
en dur ici ni dans le code :

- `shenron-pg-tunnel` : accès PostgreSQL du site et du bot (`DATABASE_URL`).
- `aphrody-ai-http` : RAG, LLM et calcul délégués à Aphrody (Rust) en HTTP.
- `aphrody-shenron-embed` : embeddings E5 (API compatible OpenAI
  `POST /v1/embeddings`), adresse fournie par l'environnement.
- `shenron-compute-client.env` : fichier d'environnement client (URL et jeton
  des services Aphrody) chargé par les unités `shenron-bot` et `shenron-site`.

Sans ces services, les modules RAG, LLM, cache sémantique et entraînement du
bot s'importent sans erreur et `PgService` reste nul (test
`apps/shenron/bot/tests/boot-without-services.test.ts`).

## Ce que possède `aphrody-os`

- Le niveau hôte partagé par toutes les applications du VPS : gestion du
  swap, Privoxy et le proxy média système, et plus généralement les
  paquets système utilisés par plusieurs applications. Le fichier
  `deploy/privoxy/shenron-media.conf` de ce dépôt est donc candidat à un
  remplacement par un composant `aphrody-os`, pas à une réécriture locale.
  Aucune unité de swap propre à Shenron n'existe.

## Ce qui reste dans `shenron`

- Le code applicatif (`apps/shenron/bot`, `apps/shenron/site`, `packages/*`). Le MCP Shenron
  passe par le MCP unifié `aphrody-ai/crates/aphrody-mcp` (`dragonball.*`), pas
  par un service/package Shenron séparé. La ligne infra historique `shenron-mcp`
  est retirée/supersédée ; le catalogue infra fait foi.
- Les scripts de fabrication d'artefact de build, propres au monorepo :
  `scripts/build/shenron/scripts/ops/package-site-artifact.ts` (empaquetage du `.next-build` pour
  import blue/green) et `scripts/build/shenron/scripts/ops/build-site-external.ts` (build Next hors
  VPS, tunnel DB, artefact scellé). Ils produisent l'artefact que
  l'Infra du monorepo consomme ; ils ne pilotent pas le systemd/nginx cible.
- La CI applicative : `.github/shenron/workflows/ci.yml` (type-check/lint/test/build),
  `.github/shenron/workflows/codeql.yml` (scan sécurité) et
  `.github/shenron/workflows/release.yml` (binaires + GitHub Release taggée). Ces
  workflows valident le code, ils ne déploient rien en production.

## Historique de consolidation (plan de suppression clôturé)

La table ci-dessous est l'inventaire historique des candidats, avant
consolidation. Elle n'est plus une liste d'actions en attente : la migration
décrite plus bas a été exécutée. Les exceptions encore présentes sont précisées
dans son bilan et ne doivent pas être supprimées sur la seule base de cette
ancienne table.

| Chemin | Équivalent l'Infra du monorepo attendu avant suppression |
| --- | --- |
| `deploy/` (systemd, nginx, install.sh, migrate/, privoxy/, filebrowser/) | `config/service-catalog.json` + vhosts Nginx infra pour `shenron-site`, `shenron-bot` et capacités Aphrody cataloguées |
| `fly.toml` | Cible Fly retirée du plan (aucune cible infra de repli attendue — suppression simple après confirmation que `deploy-fly.yml` est désactivé) |
| `vercel.json` | Cible Vercel retirée du plan de production (standby documenté ailleurs, pas remplacé par un équivalent infra) |
| `Dockerfile` | Aucun runtime conteneur dans `config/service-catalog.json` — suppression une fois confirmé qu'aucun mainteneur ne dépend du build Docker |
| `.github/workflows/deploy-fly.yml` (not in repo) | Pipeline de release infra couvrant le déploiement (aphrody-infra) |
| `.github/workflows/deploy-vercel.yml` (not in repo) | idem — cible Vercel hors plan |
| `.github/workflows/neon-branch.yml` (not in repo) | Migration DB pilotée par le pipeline infra (Postgres géré côté de l'Infra du monorepo/RG) |
| `scripts/deploy-shenron.sh` (not in repo), `scripts/deploy-shenron.ps1` (not in repo) | Unité `shenron-bot.service` + procédure de release infra |
| `scripts/deploy-site.sh` (not in repo), `scripts/deploy-site.ps1` (not in repo) | Unité `shenron-site.service` + bascule blue/green infra |
| `scripts/deploy-mcp.sh` (not in repo) | Ancienne unité supprimée ; outils Dragon Ball portés par `aphrody-mcp` unifié |
| `scripts/ship-shenron.sh` (not in repo), `scripts/ship-shenron.ps1` (not in repo) | Pipeline de release infra (build + transfert + bascule) |
| `scripts/ship-site.sh` (not in repo) | idem, volet site |
| `scripts/ship-vps-dbfr.sh` (not in repo), `scripts/ship-vps-dbfr.ps1` (not in repo) | Le flux `vps` → `dbfr` disparaît : `dbfr` n'héberge plus le site (cf. faits de cible) |
| `scripts/release-dbfr.sh` (not in repo) | idem — release pilotée par l'Infra du monorepo, plus par `dbfr` |
| `scripts/build-vps.sh` (not in repo) | Validation de build assurée par la CI + le pipeline infra |
| `scripts/fly-init.sh` (not in repo) | Cible Fly retirée du plan |
| `scripts/clean-vps.sh` (not in repo) (et la commande `bun run clean:vps` / `scripts/ops/clean-vps.ts` (not in repo)) | Politique de rétention et nettoyage portée par l'Infra du monorepo (`config/scheduler-policy.json`) |
| `scripts/watchdog.sh` (not in repo) | Auto-remédiation portée par le superviseur infra (systemd + probes du catalogue) |
| `scripts/reactivate.sh` (not in repo) | Provisioning complet remplacé par le provisioning infra (`deploy/install.sh` infra équivalent) |
| `scripts/ops/backup-shenron-pg.sh` | `shenron-backup.timer` (ou équivalent Postgres) du catalogue infra, DB restant sur `dbfr` |
| `scripts/healthcheck.sh` (not in repo), `scripts/healthcheck.ps1` (not in repo) | Probes de santé du catalogue infra (`health` par service dans `config/service-catalog.json`) |
| `scripts/ops/ovh-dns.ts` (migré) | Bascule DNS pilotée par le plan infra si un jour nécessaire (hors scope applicatif) |

Ne sont **pas** dans cette liste (hors périmètre de cette tâche, code
applicatif) : `scripts/tools/shenron/scripts/shenron-guild-sync.sh`, `scripts/ops/backup-shenron-sqlite.sh`,
les timers de sync Neon/PG applicatifs, et tout ce qui touche à l'ingestion ou
au RAG.

## Décision encore ouverte

- **Privoxy / proxy média** : `deploy/privoxy/shenron-media*.{conf,env}` est un
  paquet système, pas une brique applicative. À confirmer s'il devient un
  composant `aphrody-os` mutualisé ou s'il reste un service par application.

## Consolidation 2026-09-23 — exécutée

La liste gated ci-dessus a été exécutée (parité confirmée dans l'Infra du monorepo).

- **Supprimés** : `apps/mcp` (not in repo) (ancien doublon de MCP ; commande `pipeline mcp` et
  scripts `mcp:*` retirés ; outils Dragon Ball désormais dans
  `aphrody-ai/crates/aphrody-mcp`) ; Fly/Vercel/Neon/
  Docker (`deploy-fly.yml`, `deploy-vercel.yml`, `neon-branch.yml`, `Dockerfile`,
  `.dockerignore`, `fly.toml`, `vercel.json`, `.vercelignore`) ; scripts de
  déploiement/ship/release/watchdog/healthcheck/clean-vps (`scripts/*.{sh,ps1}`,
  `scripts/ops/{ship-site,deploy-site,clean-vps}.ts`, blue/green local) ;
  `apps/bot/scripts/{deploy.ts,install.*,setup.sh,start.sh,doctor.sh,fly-init.sh,
  sync-sqlite-to-neon.ts,sync-neon-to-sqlite.ts,log-watcher.service}` ;
  `deploy/{systemd,nginx,filebrowser,migrate}`, `deploy/install.sh`,
  `deploy/setup-swap.sh` ; `scripts/ops/offload-rag-vectors-to-aphrody.ts` (not in repo) et
  `scripts/ops/ingest_rag_to_aphrody.py` (not in repo) (one-shot, sans référence).
- **Déplacés vers l'Infra du monorepo** : `scripts/ops/backup-shenron-{pg,sqlite}.sh`
  (les copies locales restent gelées tant que les timers DBFR exécutent
  l'ancien checkout `~/shenron/scripts/…` sur `dbfr`) ; `systemd/privoxy.service.d/shenron-media.conf` ;
  `nginx/cdn.dragonballfr.com.conf.example` (non routé, décision ouverte).
- **Artefact site** : `bun run site:artifact` (`scripts/build/shenron/scripts/ops/build-site-external.ts`,
  base de build via `SITE_BUILD_DATABASE_URL` ou `.env.remote-db`) produit
  `artifacts/site-build.tar.gz{,.sha256}` ; `bun run site:migrate` applique les
  migrations Drizzle du site. Le pipeline release l'Infra du monorepo appelle ces deux
  commandes à la place de `site:ship`.
- **Embeddings** : `ShenronEmbeddingsClient` cible l'API OpenAI-compatible
  `POST /v1/embeddings` d'`aphrody-shenron-embed` (adresse issue de
  l'environnement), ajoute les préfixes E5
  `query:`/`passage:` et découpe les lots à 16 entrées. Le reranking reste
  optionnel : le chemin SQLite local ne l'appelle que si
  `APHRODY_AI_RERANK_BASE_URL` (ou l'alias `RERANK_URL`) est explicitement configurée. Sans poids E5 prêts ou sans vecteurs compatibles,
  le RAG se replie toujours sur BM25; ce dépôt ne prouve pas la disponibilité
  runtime du modèle.
- **Restent ici** (hors infra) : `deploy/install-media-vpn-proxy.sh` et
  `deploy/privoxy/*` (lit le drop-in dans `../aphrody-infra`) ;
  `apps/shenron/bot/scripts/log-watcher.ts` reste un outil CLI manuel. Son unité
  systemd est retirée du catalogue et ne doit pas être recréée implicitement.
