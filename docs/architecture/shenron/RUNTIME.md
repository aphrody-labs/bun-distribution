# RUNTIME — un seul runtime applicatif pour Shenron

Statut : proposition rédigée le 2026-09-24 ; elle ne décrit pas l'état actuel de
la production. L'observation VPS/DBFR du 2026-10-02 est dans
[`TOPOLOGY-OBSERVATION-2026-10-02.md`](../../operations/infra/TOPOLOGY-OBSERVATION-2026-10-02.md)
et [`VPS-STATUS-2026-10-02.md`](../../operations/infra/VPS-STATUS-2026-10-02.md).
Les unités systemd, les routes nginx, le catalogue et la politique de
planification relèvent de l'Infra du monorepo (voir
[`INFRA-DELEGATION.md`](../../operations/shenron/INFRA-DELEGATION.md)).
Aucun hôte, IP ou port littéral n'apparaît ici. On utilise les noms de service du catalogue
(`shenron-site`, `shenron-bot` → `shenron-runtime`, `shenron-pg-tunnel`,
`aphrody-ai-http`, `aphrody-shenron-embed`) et des variables d'environnement (`API_PORT`, `PORT`,
`DATABASE_URL`, `REDIS_URL`, `APHRODY_AI_*` (voir [`ENV.md`](../../operations/shenron/ENV.md)), `RUNTIME_*`).

## 1. Objectif

Le propriétaire demande d'« unifier tous les processus, services systemd et Bun en un seul,
optimisé » (demande du 2026-09-24). Ce document interprète cette demande ainsi :

- **une seule unité opérationnelle**, `shenron.target`, qu'on démarre, arrête, déploie et
  restaure comme un tout ;
- **un seul runtime applicatif**, `@shenron/runtime`. C'est un point d'entrée Bun unique qui porte
  la passerelle Discord, l'API (legacy et `@shenron/api` Hono), le planificateur et le worker
  d'indexation Redis ;
- **un processus de rendu isolé**, Next (`shenron-site`), qui reste hors du tas et de la boucle
  d'événements de la passerelle.

Ce n'est **pas** un seul PID. Ce point est dit franchement au propriétaire : le gain réel vient
de la consolidation des pools, du planificateur, du déploiement et du plafonnement mémoire,
pas de la fusion des processus (voir §3 et §6).

## 2. État documenté au 2026-09-24 (historique)

| Élément | Nature | Propriétaire (unité / code) | Remarques |
| --- | --- | --- | --- |
| `shenron-site` | service long, Bun + `next start` | Infra du monorepo / `apps/shenron/site` | MemoryHigh 2560M, Max 4G, Low 256M, OOMScoreAdjust -300 (`systemd/shenron-site.service`, `config/service-catalog.json:153-163`). Standalone refusé (`apps/shenron/site/next.config.ts:56-59`). |
| `shenron-bot` | service long, un processus Bun : discordx + `Bun.serve` API | Infra du monorepo / `apps/shenron/bot` | `BUN_JSC_forceRAMSize=1GiB`, MemoryLow 384M, **aucun plafond**, OOMScoreAdjust -500 (`systemd/shenron-bot.service`, `service-catalog.json:180-190`). |
| API bot | dans `shenron-bot` | `apps/shenron/bot/src/api/server.ts:1132` | Démarre seulement dans `clientReady` (`apps/shenron/bot/src/index.ts:97-116`). Un échec de login termine le processus (`index.ts:155-158`). |
| CronRegistry (~10 jobs) | `setInterval` en mémoire | `apps/shenron/bot/src/api/cron-registry.ts:39-99` | Les échéances sont perdues à chaque redémarrage (risque pour `ursaf-cycle`, 24 h). |
| Tick Giveaway | `setInterval` hors registre | `apps/shenron/bot/src/commands/giveaway/Giveaway.ts:173` | Invisible dans `/cron`. |
| Worker d'indexation Redis | thread Bun Worker | `apps/shenron/bot/src/lib/redis-indexer.ts:65`, `apps/shenron/bot/src/workers/indexer.ts:33-43` | Seul précédent de Worker dans le dépôt. |
| Pools PG du bot | `BxcBridgeService` `new SQL(url)` (défaut 10) et `EpisodesService` max 2 | `apps/shenron/bot/src/services/BxcBridgeService.ts:37`, `EpisodesService.ts:121` | Environ 12 connexions. `EpisodesService.ts:83-94` scanne des fichiers `.env`. |
| Pool PG du site | `@shenron/db`, `DATABASE_POOL_MAX` 4 par défaut, plafond 20 | `packages/shenron/db/src/config.ts:2-4,35-39` | Total Shenron d'environ 16 connexions. |
| Redis du site | 2 clients paresseux | `apps/shenron/site/src/lib/databooks-redis.ts:62-69`, `apps/shenron/site/src/lib/memory-rate-limit.ts:30` | |
| `shenron-pg-tunnel` | ssh `-L` vers dbfr | Infra du monorepo | MemoryMax 64M. |
| `aphrody-ai-http`, `aphrody-shenron-embed` | services Aphrody | aphrody | Dérive du port de l'embedder : 8794 dans l'unité, 8790 dans `docs/plans/infra/PLAN.md:37`. |
| `shenron-backup.timer` (VPS) | oneshot + timer | Infra du monorepo | Le rapport historique le disait non installé ; il a été vu actif le 2026-10-02. Le succès des sauvegardes n'a pas été vérifié. |
| `shenron-pg-backup`, `shenron-sqlite-replica-backup` (dbfr) | timers | Infra du monorepo | Vus actifs le 2026-10-02 ; validité et restaurabilité des sauvegardes non vérifiées. |
| `relecture-ocr` | démon Python dans le workspace partagé | `../aphrody-py/packages/shenron/relecture-ocr` | **Non supervisé**, aucune unité. Lancer avec `uv run --project ../aphrody-py --package shenron-relecture-ocr relecture-ocr`. |
| Boucles `scripts/ops/*`, `packages/pipeline/scripts/*` | lots lancés à la main | shenron | Hors runtime. La règle 9 interdit `rag:build` en prod. |
| `shenron-zswap.service` | fichier resté en place | Infra du monorepo | Déjà retiré (`service-catalog.json:224`). C'est `rg-zram-swap` qui gère le swap. |
| Plan de release | `/srv/shenron/releases/<sha>` + `current` | Infra du monorepo | Le lien courant a été observé le 2026-10-02 ; consulter le rapport VPS daté avant opération. |

Politiques applicables :

- `oneUnitPerWorkload` : `config/service-catalog.json:213`.
- `onePublicProxy` : `service-catalog.json:214`.
- `sharedReleasePointer` : `service-catalog.json:215`.
- Règle 3, « pas de superviseur propre » : `docs/reference/infra/SHENRON-MIGRATION.md:147`.
- `per-app-cron` et `crawler` désactivés par défaut : `config/scheduler-policy.json:15`.

## 3. Décision

**Option retenue : C, « runtime hybride ».** Verdict du juge : C = 9/8/8/6/6 (exactitude,
sûreté, déploiement, gains, alignement), A = 8/3/3/4/9, B = 7/6/5/2/7.

Justification chiffrée :

- **PostgreSQL.** On passe d'environ 16 connexions à 8 au plus : un pool partagé de 4 dans le
  runtime et 4 dans le site.
- **Redis.** Le site passe de 2 clients à 1. Le runtime garde 1 client plus 1 dans le worker.
- **Unités.** On retire 1 timer (`shenron-backup`) et 1 fichier mort (`shenron-zswap`). On ajoute
  1 target. Plus aucun démon ne tourne sans supervision dans le code du runtime.
- **Mémoire bornée.** Aujourd'hui le bot n'a pas de plafond, donc le total Shenron n'est pas borné.
  Cible : runtime MemoryMax 2560M plus site 4G, soit environ 6,6G au plus, tunnel compris.
- **Déploiement.** Un seul basculement, avec retour arrière automatique et rétention de 3 releases.
- **Isolation.** On garde `oneUnitPerWorkload`. Le rendu Next ne partage ni le tas ni la boucle
  de la passerelle.

Options écartées :

- **A, un seul processus Bun avec Next, API et passerelle.** L'économie mémoire est proche de zéro,
  car chaque Worker est une VM JSC complète. A fusionne les domaines de panne du site et de la
  passerelle, malgré l'historique d'OOM (`docs/guides/shenron/pieges.md:65-78`). A demande une dérogation de
  politique et fait transiter les écritures SQLite par l'IPC de la passerelle.
  **A reste ouverte comme Phase 4**, sous seuils (§11).
- **B, une unité avec un superviseur Bun et des enfants.** B n'économise rien (MemoryMax 11G sur
  l'unité). B viole la règle 3 et demande `Delegate=` avec écriture directe dans les cgroups, ce
  qui n'est pas prouvé sur l'hôte. B ressuscite le slot bleu/vert sur un port non alloué. Son
  propre repli est `shenron.target`, c'est-à-dire C.

Amendements retenus par rapport au design C initial :

- `relecture-ocr` **ne** devient **pas** un enfant du runtime. Il obtient sa propre unité, ou il
  est remplacé par l'OCR Rust d'Aphrody (ticket infra).
- Les lots crawl, traduction et OCR de `scripts/ops` **restent manuels et hors runtime**
  (`scheduler-policy.json:15`), sauf ratification par infra.
- L'état du planificateur est persisté dans **un petit fichier SQLite dédié**
  (`RUNTIME_STATE_DB`, sous `shared/runtime/`), pas dans `bot.db`, qui porte les tables RAG.
- Le seul job enfant embarqué est la sauvegarde SQLite du cache VPS.

## 4. Topologie cible

```
shenron.target
├─ shenron-pg-tunnel.service   (inchangé, PartOf=shenron.target)
├─ shenron-site.service        (bun --bun next start ; inchangé sauf PartOf)
└─ shenron-runtime.service     (bun packages/runtime/src/main.ts ; remplace shenron-bot)
     thread principal : Bun.serve(API_PORT)
        ├─ @shenron/api (Hono) sous /api/v2
        ├─ routes legacy ApiServer (REST/GraphQL/OpenAPI) via fetch()
        ├─ /health, /health/ready, /health/aggregate, /metrics
        ├─ passerelle discordx (singleton)
        └─ Scheduler v2 (jobs inline + enfant sqlite-backup via Bun.spawn, nice, timeout, maxRss)
     Worker : redis-indexer (existant)
Hors cible : aphrody-mcp (outils Dragon Ball locaux), aphrody-ai-http, aphrody-shenron-embed (Aphrody) ; timers dbfr ;
relecture-ocr (unité propre ou OCR Aphrody) ; lots ops/pipeline (manuels).
```

Les routes nginx ne changent pas. Seul le nom d'unité derrière `bot.` change.

### Diff proposé pour Infra du monorepo (non appliqué)

`systemd/shenron.target` (not in repo) (nouveau) :

```ini
[Unit]
Description=Shenron application stack (runtime + site + pg tunnel)
Wants=shenron-pg-tunnel.service shenron-runtime.service shenron-site.service
After=network-online.target
[Install]
WantedBy=multi-user.target
```

`systemd/shenron-bot.service` → `systemd/shenron-runtime.service` (not in repo) :

```diff
-Description=Shenron bot (discordx + Bun.serve API)
+Description=Shenron runtime (gateway + @shenron/api + scheduler)
+PartOf=shenron.target
-WorkingDirectory=/srv/shenron/current/apps/shenron/bot
-ExecStart=~/.bun/bin/bun src/index.ts
+WorkingDirectory=/srv/shenron/current
+ExecStart=~/.bun/bin/bun packages/runtime/src/main.ts
+Environment=RUNTIME_STATE_DB=/srv/shenron/shared/runtime/state.sqlite
 MemoryLow=384M
+MemoryHigh=1536M
+MemoryMax=2560M
+TasksMax=512
 OOMScoreAdjust=-500
+ReadWritePaths=/srv/shenron/shared/backups/sqlite /srv/shenron/shared/runtime
+[Install]
+WantedBy=shenron.target
```

Seul `EnvironmentFile=` de l'unité bot est conservé. Les fichiers d'env du site et du bot ne sont
**jamais** fusionnés.

`Alias=` est un réglage `[Install]` : il ne fonctionne que pour une unité activée. La transition
se fait donc par une unité `shenron-bot.service` minimale, gardée une release, qui porte
`Alias=`/`Requires=` vers `shenron-runtime`. Ensuite `shenron-bot.service` passe dans
`retiredUnits`.

`shenron-site.service` et `shenron-pg-tunnel.service` reçoivent `PartOf=shenron.target` et
`WantedBy=shenron.target`.

On supprime `systemd/shenron-backup.{service,timer}` et `systemd/shenron-zswap.service` (not in repo).

`config/scheduler-policy.json` : l'entrée `shenron-backup` change de propriétaire et devient
`shenron-runtime-scheduler` (`owns: ["shenron-sqlite-local-cache"]`). Elle reste l'exception
déclarée unique à `per-app-cron`.

`config/service-catalog.json` : `shenron-bot` devient `shenron-runtime`, avec la santé sur
`/health/ready`. On ajoute `group: "shenron.target"`. `oneUnitPerWorkload` reste inchangé.

## 5. Organisation du code dans shenron

```
packages/runtime/            NOUVEAU @shenron/runtime (source-first, catalog:)
  src/main.ts                entrée unique : config -> pools -> http -> scheduler -> gateway
  src/lifecycle.ts           démarrage ordonné, drain SIGTERM, uncaught -> exit(1)
  src/http.ts                un Bun.serve : Hono (@shenron/api sous /api/v2) + fetch() legacy
  src/health.ts              /health, /health/ready, /health/aggregate, /metrics
  src/pools.ts               un pool @shenron/db (RUNTIME_PG_POOL_MAX, défaut 4) + un RedisClient
  src/scheduler/registry.ts  CronRegistry v2 (everyMs | dailyAt UTC, jitter, concurrency 1)
  src/scheduler/store.ts     état next-run dans RUNTIME_STATE_DB (bun:sqlite), pas bot.db
  src/scheduler/child.ts     Bun.spawn : timeout, nice/ionice, surveillance maxRss (Linux)
  src/jobs/sqlite-backup.ts  VACUUM INTO + gzip + rétention 14 j (portage du script infra)
  src/env.ts                 chargement de l'env par charge de travail + masquage des secrets dans les logs
  test/*.test.ts
apps/shenron/bot/src/index.ts        wrapper de 3 lignes -> runtime (compat. avec l'unité actuelle)
apps/shenron/bot/src/gateway.ts      startGateway(ctx) extrait de index.ts (sans Bun.serve ni handlers process)
apps/shenron/bot/src/api/cron-registry.ts  shim de ré-export vers packages/runtime
apps/shenron/site                    processus inchangé ; un seul client Redis partagé
```

Intégration avec `packages/ui/material-web/docs/STACK.md` :

- `@shenron/config` fournit le schéma d'env, validé au démarrage, sans jamais journaliser de
  valeur.
- `@shenron/db` fournit le pool unique, injecté dans `BxcBridgeService` et `EpisodesService`.
  Le scan `.env` est supprimé.
- `@shenron/api` (Hono) est monté par `http.ts`.
- `@shenron/auth` fournit des middlewares appliqués une seule fois. Les cookies better-auth du site
  (PG) et du bot (SQLite) restent distincts.

Ordre de démarrage :

1. Config.
2. Pools.
3. `Bun.serve` **avant** le login Discord. `/health` répond 200 et `/health/ready` répond 503 tant
   que PG et la passerelle ne sont pas prêts.
4. Scheduler. Les jobs `requires: gateway` sont sautés tant que la passerelle n'est pas prête.
5. `startGateway`, avec backoff de 5 s à 5 min. Le processus sort seulement après
   `RUNTIME_GATEWAY_FATAL_AFTER` (15 min par défaut).

Les dépendances de vagues (`var/stack-research/runtime-breakdown.json` (not in repo)) sont les suivantes :

- `server.ts` appartient à la vague 4 (`api`).
- Les services PG et le worker appartiennent à la vague 3 (`db`).
- Le runtime vient donc **après la vague 4**.

## 6. Budget mémoire / CPU

| Unité | Low | High | Max | Autre |
| --- | --- | --- | --- | --- |
| shenron-site | 256M | 2560M | 4G | inchangé, OOM -300, CPUWeight 150 |
| shenron-runtime | 384M | 1536M | 2560M | OOM -500, CPUWeight 200, TasksMax 512, `BUN_JSC_forceRAMSize=1GiB` conservé |
| enfant sqlite-backup | n/a | n/a | 256M (surveillance interne) | nice 10, IO idle, timeout 30 min |
| shenron-pg-tunnel | n/a | n/a | 64M | inchangé |
| **Total** | ~0,65G | ~4,1G | **~6,6G** | aujourd'hui le total n'est pas borné |

Ces chiffres sont des propositions, pas des mesures. La Phase 3 mesure pendant 7 jours
(p50/p99 RSS, lag de boucle), puis ajuste. La directive « pas de MemoryMax »
(`docs/guides/shenron/pieges.md:21`) est remplacée pour le runtime. Les OOM venaient du build Next
(`pieges.md:65-78`), et ce build reste externe (`scripts/build/shenron/scripts/ops/build-site-external.ts`). Il n'y a
pas de CPUQuota. `UV_THREADPOOL_SIZE=12` et `BUN_CONFIG_MAX_HTTP_REQUESTS=2048` sont conservés.

## 7. Isolation des pannes et arrêt gracieux

| Panne | Aujourd'hui | Cible |
| --- | --- | --- |
| OOM ou crash du rendu Next | site seul | site seul (unité séparée) |
| Échec du login Discord | processus terminé, l'API tombe | API dégradée mais servie, la passerelle réessaie |
| Exception non rattrapée | passerelle + API | passerelle + API + crons inline (identique) |
| Fuite du job de sauvegarde | n/a | enfant tué par maxRss ou timeout ; MemoryMax en garde-fou |
| Tunnel PG coupé | dégradation | identique ; `/health/aggregate` signale `pg: down` |
| Contention d'écriture SQLite | n/a | état du planificateur hors `bot.db` ; `VACUUM INTO` ne bloque pas les lecteurs WAL ; `rag-build` jamais dans le processus |

Arrêt sur SIGTERM, en moins de `TimeoutStopSec=30` :

1. `server.stop()`, avec un drain de 10 s.
2. Arrêt du scheduler : SIGTERM aux enfants, attente de 15 s.
3. `client.destroy()`.
4. Fermeture des pools et `dbService.close()`.
5. `worker.terminate()`.
6. `exit(0)`.

## 8. Déploiement bleu/vert et retour arrière

- Le build reste externe : `bun run site:artifact` produit un artefact scellé en sha256.
- Il n'y a pas de bleu/vert. La passerelle est un singleton, et `shenron-site-b` est retiré.
  Le basculement se fait sur un slot unique avec `proxy_cache_use_stale error timeout updating
  http_502 http_503` sur `dragonballfr.com`, pour que le cache nginx serve pendant le redémarrage.
- Nouvel adaptateur `scripts/atomic-deploy-shenron.sh`, sur le modèle de
  `atomic-deploy-aphrody-stack.sh:10,47-109`. Étapes :
  1. Vérifier le sha256.
  2. Déposer la release dans `releases/<sha>` et lancer `bun install --frozen-lockfile`.
  3. Poser les liens `shared/`.
  4. Basculer `current` avec `ln -sfn` puis `mv -T`.
  5. Redémarrer le site **d'abord** et sonder sa santé.
  6. Redémarrer le runtime et sonder `/health/ready`.
  7. En cas d'échec, rebasculer `current`, redémarrer, puis sortir en code 1.
  8. Appliquer la rétention : `SHENRON_RELEASE_KEEP=3`.
- `--only site` est **le mode par défaut** quand le diff d'artefact ne touche que le site. Une
  release du site ne reconnecte alors jamais la passerelle Discord.
- Retour arrière manuel : `atomic-deploy-shenron.sh --rollback`. L'exercice doit tenir en moins
  de 60 s.
- L'état du planificateur vit dans `shared/runtime/` et survit aux bascules.

## 9. Santé et observabilité

- `/health` sert de sonde de vivacité (liveness). `/health/ready` couvre PG, la passerelle et le
  scheduler.
- `/health/aggregate` agrège le runtime, la passerelle, PG, Redis, le site, les dépendances Aphrody
  et l'état de chaque job. Il est authentifié staff s'il est exposé.
- `/metrics` est au format texte Prometheus : RSS, tas, lag p99 de la boucle, ping WebSocket,
  durée et échecs des jobs, pic RSS des enfants, attente du pool PG.
- Les logs pino partent vers journald. Les sorties des enfants sont préfixées `{job,pid}` et les
  secrets sont masqués. `journalctl -u 'shenron-*'` donne la vue unifiée.
- Un job en échec déclenche un hook `scripts/tools/shenron/scripts/ops/notify-admin-lab.ts`. Aucun watchdog Shenron
  n'est réintroduit : `rg-infra-monitor` peut scraper les métriques.

## 10. Phasage

**Phase 1 : shenron, en local, maintenant.** Voir `var/stack-research/runtime-breakdown.json` (not in repo).

- Créer `packages/runtime` (not in repo) avec config, pools, http, health, lifecycle, scheduler v2 persistant,
  enfant borné et job sqlite-backup.
- Découper `apps/shenron/bot/src/index.ts`. Le wrapper de compatibilité maintient l'unité actuelle
  fonctionnelle.
- Mettre en place l'API avant le login.
- Déplacer Giveaway dans le registre.
- Utiliser un seul pool PG dans le bot (injection) et supprimer le scan `.env`.
- Utiliser un seul client Redis côté site.
- Mettre à jour la doc : `pieges.md:21`, le chemin `/srv/rg/releases/shenron` dans `CLAUDE.md`, et
  la dérive du port de l'embedder.

**Phase 2 : tickets Infra du monorepo.**

- T1 : `shenron.target`, renommage en `shenron-runtime` avec alias de transition.
- T2 : amender la règle 3 (le runtime peut lancer des jobs bornés qu'il planifie, mais ne supervise
  aucune autre charge de travail) et mettre à jour le catalogue.
- T3 : changer le propriétaire dans `scheduler-policy` et retirer `shenron-backup` et
  `shenron-zswap`.
- T4 : `atomic-deploy-shenron.sh`, avec rétention de 3 et tests stub.
- T5 : `relecture-ocr`, unité propre ou OCR Aphrody.
- T6 : port de l'embedder 8794, chemins `/srv/rg` périmés dans `SHENRON-MIGRATION.md:167-187`,
  `proxy_cache_use_stale`.
- T7 (optionnel) : tunnel WireGuard.

**Phase 3 : opérateur.**

1. Déployer la release de Phase 1 sous l'**ancienne** unité (chemin de compatibilité).
2. Installer les unités de la Phase 2 et lancer `enable --now shenron.target`.
3. Déclencher `sqlite-backup` à la main, puis vérifier l'intégrité sur une copie restaurée.
4. Mesurer pendant 7 jours.
5. Faire un exercice de retour arrière.
6. Retirer l'alias `shenron-bot`.

## 11. Tests et gates

Gates du dépôt :

```sh
bun run lint
bun run type-check
bun run test:all
bun test packages/runtime
bun run gen:entries && git diff --exit-code apps/shenron/bot/src/_entries.ts
git diff --check
```

Tests nouveaux :

- `scheduler.test.ts`
  - la persistance survit à une ré-instanciation ;
  - `dailyAt` est calculé en UTC ;
  - le verrou de concurrence fonctionne ;
  - un job désactivé ne se déclenche jamais.
- `child.test.ts`
  - le timeout tue l'enfant ;
  - la surveillance maxRss est testée sur Linux, et sautée sur win32.
- `lifecycle.test.ts`
  - HTTP est prêt avant la passerelle ;
  - `/health` répond 200 et `/health/ready` répond 503 ;
  - l'arrêt sur SIGTERM dure moins de 30 s.
- `pools.test.ts`
  - une seule instance de pool ;
  - aucune lecture de fichier `.env`.
- `sqlite-backup.test.ts` : `VACUUM INTO`, aller-retour gzip, rétention.
- `http.test.ts`
  - `/api/v2` est servi par Hono ;
  - les routes legacy répondent ;
  - le snapshot OpenAPI est identique avant et après la migration.
- `env.test.ts`
  - les fichiers d'env du site et du bot ne sont jamais fusionnés ;
  - les secrets sont masqués.
- Isolation auth : un cookie better-auth du site est rejeté par le bot, et inversement.
  `request-guards.test.ts` et `check-admin-staff.test.ts` restent verts.

Côté infra : `systemd-analyze verify`, schéma du catalogue, tests stub de l'adaptateur.

Seuils go/no-go de la Phase 4 vers A (Next embarqué). Toutes les conditions doivent tenir pendant
14 jours :

- ACK de heartbeat p99 < 500 ms sous charge du site ;
- économie de RSS ≥ 150 MB mesurée ;
- démarrage à froid < 15 s ;
- lag p99 de la boucle < 50 ms ;
- régression du p99 du site ≤ 10 %.

## 12. Risques

| Risque | Mitigation |
| --- | --- |
| Le propriétaire attendait un PID unique | Ce document le dit explicitement ; Phase 4 mesurée |
| File d'attente PG après la réduction de 10 à 4 connexions | `RUNTIME_PG_POOL_MAX` configurable ; attente du pool dans `/metrics` ; plafond de 20 |
| Mode dégradé : des routes supposent `client.user` | garde `requires: gateway` qui renvoie 503, couverte par des tests |
| Double exécution après un saut d'horloge | clé d'idempotence `(job, scheduledAt)`, rattrapage d'une seule exécution |
| Conflit de politique (règle 3, `per-app-cron`) | T2 et T3 fusionnés avant tout déploiement |
| `Alias=` d'une unité non activée | unité de transition explicite, retirée après une release |
| Collision de chemins avec les vagues en cours de `work-breakdown.json` | `dependsOn` w3:db, w4:api ; démarrage après la vague 4 |
| Cache SQLite du VPS sans sauvegarde d'ici la Phase 3 | prioriser T3 et le job sqlite-backup |
| Documentation périmée (`/srv/rg`, 8790 vs 8794) | T6 et corrections de doc en Phase 1 |
