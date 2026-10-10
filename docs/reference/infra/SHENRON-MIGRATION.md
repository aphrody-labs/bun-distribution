# Migration Shenron vers Aphrody Infra

> **Migration record, not a current service inventory.** Shenron site, bot,
> tunnel and backup entries remain declared in the root catalogues, but the
> Aphrody AI HTTP and embedding units discussed below are marked retired in
> `tools/config/service-catalog.json` and the Aphrody plane is retired in
> `tools/config/production-topology.json`. Do not infer active RAG/OCR/A2A capability
> from this migration narrative; use the dated VPS/topology reports and current
> catalogues before operational actions.

> **Historical compute section:** “Calcul Shenron hébergé par Aphrody” below
> describes a retired Aphrody AI integration. Its service names are not a
> current Shenron deployment contract; do not use the section's environment
> variables, ports or probes as current runtime instructions.

Shenron devient une application orchestrée par le même plan d’infrastructure
que RG et Aphrody. RG fournit la plateforme canonique (UI, auth, API, Postgres,
proxy et observabilité) ; Shenron conserve son domaine métier (wiki, média,
MCP et bot). Cette migration concerne l’exploitation, pas le mélange du code
métier : le dépôt Shenron reste sa source applicative, tandis que
`aphrody-infra` devient l’autorité des releases, unités systemd, routes Nginx,
backups et probes.

## Cible canonique

- racine de release propre à Shenron : `/srv/shenron/current` →
  `/srv/shenron/releases/<sha>` (voir « Décision — plan de release Shenron
  découplé de RG » ci-dessous ; `/srv/rg/current` reste la release RG) ;
- données mutables hors release : `/srv/shenron/shared/{site/wiki,
  site/next-cache,bot/data,bot/assets,backups/sqlite}` ;
- site Next/Bun : `shenron-site.service`, port local `5011`,
  `WorkingDirectory=/srv/shenron/current/apps/site`, `NEXT_DIST_DIR=.next-build`
  (artefact scellé de `bun run site:artifact`) ;
- PostgreSQL `shenron_site` : reste sur dbfr, joint par
  `shenron-pg-tunnel.service` (127.0.0.1:15433 → dbfr 127.0.0.1:5432) ;
- MCP : `shenron-mcp` (:5010, `mcp.dragonballfr.com`) est retiré depuis le
  2026-09-25 ; ses outils sont les `dragonball.*` d'`aphrody-mcp` (feature
  `dragonball`, par défaut), servis par `aphrody-ai-http` sur
  `127.0.0.1:8789/mcp` ; les API éditoriales bot/site demeurent les backends de
  données ;
- bot Discord **et** API publique (REST/GraphQL/OpenAPI) : `shenron-bot.service`,
  port local `5006`, `WorkingDirectory=/srv/shenron/current/apps/bot` ;
- hôte d'assets `cdn.dragonballfr.com` : servi par le même Nginx, statique d'abord
  depuis `/srv/shenron-cdn`, puis Next ou le bot, puis la page de maintenance ;
- backups : `shenron-backup.timer` (sauvegarde SQLite locale) et les unités
  spécialisées déclarées dans le catalogue ;
- exposition publique : Nginx uniquement, déclarée dans
  `tools/config/host/nginx/routes.json` ; les vhosts réels sont
  `tools/config/host/nginx/shenron/{00-shenron,dragonballfr.com,cdn.dragonballfr.com,bot.dragonballfr.com}.conf`,
  installés séparément dans `/etc/nginx/conf.d/` sur le vps ;
- déploiement : `scripts/release/atomic-deploy-shenron.sh` (`assemble` puis
  `activate`, rollback vers le `current` précédent), seul ou comme deuxième
  étape du bundle tout-en-un (`docs/operations/infra/IMMUTABLE-RELEASES.md`).

## Décision — process unique bot/API (résout l'écart signalé par
`shenron/docs/INFRA-DELEGATION.md`)

`docs/infra-vps.md` (not in repo) et `shenron:apps/bot/src/lib/env.ts` (côté Shenron) confirment un
seul workload Bun : `discordx` (gateway Discord) et `Bun.serve` (API REST/
GraphQL/OpenAPI, `API_PORT` par défaut `5006`) tournent dans le même process,
démarré par `bun src/index.ts` depuis `apps/bot` (not in repo). Le catalogue infra a donc été
aligné sur ce fait : **`shenron-api.service` est retiré** (ajouté à
`policies.retiredUnits` dans `tools/config/service-catalog.json`) et
`shenron-bot.service` porte à la fois le bot et le `health` public
(`http://127.0.0.1:5006/health`, `public: true`). `tools/config/host/nginx/routes.json`
route donc `bot.dragonballfr.com` vers le service `shenron-bot`, pas
`shenron-api`.

## Calcul Shenron hébergé par Aphrody

Le runtime Shenron utilise `RAG_BACKEND=aphrody` après la validation du corpus et
des appels HTTP réels. L'unité `aphrody-ai-http.service` tourne sous le rôle
`aphrody` et reçoit dans `/etc/aphrody/aphrody-ai-http.env` l'URL PostgreSQL
`APHRODY_MCP_DATABASE_URL` et `APHRODY_SHENRON_API_TOKEN` (nom lu côté
serveur). Le même jeton est fourni au bot et au site par
`/etc/aphrody/shenron-compute-client.env` (`APHRODY_AI_HTTP_URL`,
`APHRODY_AI_HTTP_TOKEN`, plus les alias `APHRODY_SHENRON_API_URL`/`_TOKEN`),
écrit par `provision-aphrody-stack-env.sh --fresh-host` et vérifié par
`scripts/tools/infra/provision-shenron-ai-access.sh`. Ces valeurs ne vont pas dans la
release ; l'activation exige la présence des clés sans afficher leur valeur.

Le moteur d'embeddings configuré par `APHRODY_AI_EMBED_MODEL` et
`APHRODY_AI_EMBED_BASE_URL` (alias `APHRODY_SHENRON_EMBED_*`, noms canoniques de
`tools/config/local-ai.json`) doit produire les mêmes vecteurs
`Xenova/multilingual-e5-small` 384D que le corpus importé : préfixes `query: `
et `passage: `, mean pooling et normalisation L2. Une dimension identique avec
un autre modèle ne suffit pas. L'unité `aphrody-shenron-embed.service` exécute
`aphrody-embed serve` (Rust pur) sur `127.0.0.1:8794` avec les fichiers épinglés
sous `/srv/aphrody/shared/models/e5-native`, préchargés et vérifiés par
`aphrody-embed install --model-dir` avant la bascule ; le service ne télécharge
jamais. Les modèles de chat et vision sont configurés séparément
(`APHRODY_SHENRON_LLM_PROVIDER=gemini-web`, `APHRODY_AI_CHAT_BASE_URL`,
`APHRODY_AI_VISION_BASE_URL`). Le statut HTTP de l'AI, du Web et du MCP
(`dragonball.*` sur `/mcp`), un appel RAG, un appel LLM, une image OCR et un
crawl indexé sont les preuves de bascule. Le code et les données PostgreSQL
seuls ne prouvent pas que ces services sont actifs.

## Décision — plan de release Shenron découplé de RG (2026-09-23)

La cible initiale plaçait Shenron sous `/srv/rg/current/apps/shenron`, c'est-à-dire
à l'intérieur de la release RG immuable, basculée par le déploiement RG
(`scripts/release/atomic-deploy-rg.sh`) indépendamment de Shenron. Chaque bascule RG
aurait fait disparaître Shenron, et un déploiement Shenron aurait dû écrire dans
une release RG scellée. Shenron possède donc sa propre racine :

- `/srv/shenron/releases/<sha>` : source `git archive` du commit Shenron, plus
  l'artefact `site-build.tar.gz` (`bun run site:artifact`, vérifié par sha256)
  extrait dans `shenron:apps/site/.next-build`, plus `bun install --frozen-lockfile` ;
- `/srv/shenron/current` : lien basculé atomiquement (`ln -sfn` puis `mv -T`),
  la release précédente reste disponible pour le rollback ;
- `/srv/shenron/shared` : les données mutables, reliées dans la release par des
  liens symboliques (`apps/site/public/wiki` (not in repo), `shenron:apps/bot/data`,
  `shenron:apps/bot/assets`, `shenron:apps/site/.next-build/cache`). Les fichiers suivis par git
  sont rafraîchis depuis la release, et rien n'y est supprimé.

Secrets : `/etc/rose-griffon/shenron-{site,bot}.env` (0600 root), copiés d'hôte
à hôte depuis l'ancien checkout dbfr sans être affichés. Seul `DATABASE_URL`
est réécrit vers le tunnel (127.0.0.1:15433). Un build hors VPS doit disposer
de `apps/site/.env` (not in repo) : les `NEXT_PUBLIC_*` (CDN, AdSense, URLs) sont inlinés
au build.

Base : PostgreSQL de dbfr n'écoute que sur loopback, et 5432 n'est jamais public.
Le WireGuard historique (`wg0`, 10.8.0.0/24) est inactif côté VPS. Le chemin privé
retenu est donc `shenron-pg-tunnel.service`, un tunnel SSH supervisé par systemd.

CDN : `cdn.dragonballfr.com` est une route Shenron dédiée, co-localisée sur le
VPS (`tools/config/host/nginx/routes.json`, `tools/config/host/nginx/shenron/cdn.dragonballfr.com.conf`),
parce que le site est construit avec cet hôte comme base d'assets. Le plan est
statique d'abord : `/srv/shenron-cdn` sert les fichiers, puis Next (`shenron-site`)
ou le bot (`shenron-bot`) répondent, puis la maintenance (503 HTML de marque, API en
503 JSON). `shenron-cdn-sync.timer` (horaire, `tools/config/host/systemd/shenron/`) tire de
dbfr vers le vps le wiki, les assets et `public-extra` par WireGuard, avec une clé
`rrsync -ro` limitée à WireGuard (10.8.0.1 ; shell et écriture refusés).

Nginx : quatre fichiers possédés par Shenron sur l'hôte, installés séparément dans
`/etc/nginx/conf.d/` : `00-shenron.conf` (zones de cache) et les vhosts
`dragonballfr.com.conf`, `cdn.dragonballfr.com.conf` et `bot.dragonballfr.com.conf`
(sources `tools/config/host/nginx/shenron/`), validés par `nginx -t`.
`scripts/release/atomic-deploy-shenron.sh` installe encore un `shenron.conf`
concaténé unique : à aligner sur ces fichiers avant son prochain usage.
`mcp.dragonballfr.com` est retiré avec `shenron-mcp` (2026-09-25). La page 50x de
marque est installée dans `/var/www/shenron/50x.html`. Preuve datée : MEMORY,
lignes « Production dragonballfr.com » et « CDN statique Shenron ».

Adaptateur (2026-09-26) : `scripts/release/atomic-deploy-shenron.sh assemble
BUNDLE/shenron` construit `/srv/shenron/releases/<sha complet>` sans toucher au
service ; `activate` vérifie le catalogue installé (rôle `shenron-site`,
`shenron-bot` ; `shenron-pg-tunnel` et le timer de backup restent hors
release), les clés requises de `tools/config/secrets-contract.json` dans les fichiers
d'environnement des unités, les liens `shared/`, puis bascule `current`,
redémarre, sonde `:5011/api/health`, `:5006/health` et les routes HTTPS et
restaure tout (y compris les fichiers de seed rafraîchis) en cas d'échec ;
`restore BACKUP` rejoue la sauvegarde d'une activation. Testé par
`scripts/release/test-atomic-deploy-shenron.sh`.

État mesuré le 2026-09-23 après restauration :
- release `63426cfb` active sous `/srv/shenron/current` ;
- `shenron-pg-tunnel`, `shenron-site` et `shenron-bot` actifs ;
- DNS `@`, `www`, `bot` et `mcp` vers le VPS ; `cdn` y pointait déjà ;
- dbfr ne sert plus aucun site ni bot.

État observé le 2026-09-26 (lecture seule) : release `4cac743f` active,
`shenron-site`, `shenron-bot`, `shenron-pg-tunnel` actifs, `shenron-backup.timer`
installé et actif (le checkout `~/aphrody-infra` existe).

Écart restant : le bot utilise le Redis local du VPS (clés `dbz:*`,
`REDIS_URL` non défini) et non celui de dbfr.

## Sauvegarde SQLite durable

`shenron-backup.service` configure `SHENRON_SQLITE_BACKUP_DIR` vers
`/srv/shenron/shared/backups/sqlite`, hors du pointeur de release, et autorise
l'écriture uniquement dans ce répertoire via `ReadWritePaths`. Le script
applicatif accepte cette variable et conserve les snapshots 14 jours par âge
(`SHENRON_SQLITE_BACKUP_RETENTION_DAYS=14`). Le dossier partagé doit être créé
et possédé par l'utilisateur de service (`ubuntu`) lors du provisioning. Le
timer doit être installé/rechargé après déploiement de l'unité, puis son
premier résultat doit être vérifié et une restauration de contrôle effectuée.

## Règles de déduplication

1. Une seule unité par workload, déclarée dans `tools/config/service-catalog.json`.
2. Un seul Nginx et une seule table de routes publiques.
3. Aucun service Shenron ne lance sa propre instance Bun, Nginx ou superviseur.
4. Les secrets restent dans les fichiers d’environnement opérateur et ne sont
   jamais copiés dans Git.
5. Un déploiement doit publier une release versionnée, basculer le pointeur
   atomiquement, sonder les routes puis conserver le rollback précédent.

La migration physique d’une base ou d’un répertoire de données reste une
opération séparée : dump chiffré, checksum, restauration de contrôle et preuve
de rollback sont requis avant suppression de l’ancien emplacement.

## Convergence RG/Shenron

`tools/config/application-contracts.json` est l’index des contrats retenus : RG reste
la référence pour l’UI, Better Auth, les types API, PostgreSQL, Realtime et
Storage. Shenron réutilise ces frontières et garde SQLite uniquement comme
cache local borné pour ses tâches offline. Les doubles unités de site,
filebrowser, watchdog et superviseurs propres à Shenron sont retirées du plan.

## Décisions ouvertes

- ~~Adaptateur de déploiement Shenron~~ — **fermé le 2026-09-26** : l'ancien
  `scripts/atomic-deploy.sh` (not in repo) (site Aphrody seul) est supprimé ; Shenron a son
  adaptateur `scripts/release/atomic-deploy-shenron.sh` sur sa propre racine, RG le
  sien (`scripts/release/atomic-deploy-rg.sh`, release active `5691ba4b`), et
  `aphrody-infra deploy --stack shenron|bundle` les pilote.
- **Privoxy / proxy média Shenron** (`shenron/deploy/privoxy/shenron-media*`) :
  hors périmètre de cette tâche, signalé côté Shenron
  (`shenron:docs/operations/INFRA-DELEGATION.md`) comme candidat à un composant `aphrody-os`
  mutualisé plutôt qu'une unité par application. Non traité ici.

## Audit de parité VPS/DBFR (2026-09-24, lecture seule)

- VPS : `shenron-{site,bot,mcp,pg-tunnel}.service`, `shenron-backup.{service,timer}`,
  `aphrody-ai-http.service` et `aphrody-shenron-embed.service` installés sont
  identiques octet pour octet aux sources `systemd/` ; `/etc/nginx/conf.d/shenron.conf`
  et `mcp.dragonballfr.com.conf` correspondent aux exemples `nginx/`. Ports
  5006/5010/5011/15433/8789/8794 en écoute loopback, sondes du catalogue en 200.
  Aucune unité `shenron.target`, `shenron-runtime` ni `shenron-api`.
- Catalogue corrigé : `aphrody-shenron-embed.workingDirectory` pointe
  `shenron:apps-embed` (not in repo) ; `staged` retiré de `aphrody-shenron-embed`,
  `shenron-mcp` et `shenron-backup` (actifs en production). Source
  `tools/config/host/systemd/shenron/shenron-zswap.service` (not in repo) supprimée (unité retirée, absente des deux hôtes).
- Écart résolu (2026-09-30) : sur DBFR, `shenron-pg-backup.service` et
  `shenron-sqlite-replica-backup.service` disposent d'un fallback direct et
  résilient vers `~/shenron/scripts/backup-shenron-{pg,sqlite}.sh`
  avec création automatique des répertoires de destination (`ExecStartPre`). Les
  sauvegardes ont été déclenchées manuellement et validées avec succès
  (status 0/SUCCESS, dumps compressés vérifiés).

## Audit et Clôture de Parité de Bout en Bout (2026-09-30)

L'audit de bout en bout de l'infrastructure Shenron a validé la conformité
stricte entre les dépôts (`aphrody` et `aphrody-infra`) et les serveurs réels
(`vps` et `dbfr`) :

1. **Doctrine du service unique Bot + API (`shenron-bot.service`)** :
   - Un seul workload Bun (`bun src/index.ts`, PID actif 2064448) héberge à la
     fois la passerelle Discord (`discordx`) et l'API publique REST / GraphQL /
     OpenAPI sur le port 5006 (`http://127.0.0.1:5006/health`).
   - L'unité `shenron-api.service` et l'unité retirée `shenron-mcp.service` sont
     consignées dans `policies.retiredUnits` de `service-catalog.json`.

2. **Résolution du bogue EROFS sur Next.js (`shenron-site.service`)** :
   - Sous `ProtectSystem=strict`, Next.js échouait lors de l'accès à `.coord`
     dans la release scellée en lecture seule.
   - Ajout de `Environment=A2A_COORD_DIR=/srv/shenron/shared/coord` dans
     l'unité systemd, création du dossier persistant `/srv/shenron/shared/coord`
     et intégration dans les liens de release d'`atomic-deploy-shenron.sh`.
   - `shenron-site.service` redémarré proprement (port 5011, prêt en 241ms).

3. **Exposition publique et Sondes de Santé Nginx (HTTP/2 200 OK)** :
   - `https://dragonballfr.com/api/health` ➔ 200 OK (Next.js sur :5011)
   - `https://bot.dragonballfr.com/health` ➔ 200 OK (Bot + API sur :5006)
   - `https://cdn.dragonballfr.com/health` ➔ 200 OK (Nginx CDN probe)
   - `https://cdn.dragonballfr.com/api/health` ➔ 200 OK (passerelle vers :5011)

4. **Validation des sauvegardes réelles** :
   - VPS : `shenron-backup.service` (SQLite 128 Mo compressé dans `/srv/shenron/shared/backups/sqlite/`, status 0/SUCCESS).
   - DBFR : `shenron-pg-backup.service` (PostgreSQL 81 Mo compressé vérifié par `gzip -t`, status 0/SUCCESS).
   - DBFR : `shenron-sqlite-replica-backup.service` (SQLite réplica 127 Mo compressé, status 0/SUCCESS).

5. **Nettoyage et Purge des Résidus** :
   - Monorepo : suppression du répertoire orphelin `shenron:packages/_preview` (not in repo) (457 fichiers) et masquage de `/.coord/` dans `.gitignore`.
   - VPS & DBFR : suppression de `~/.shenron-build-tmp` et `.shenron-isr-release-dir`.
   - Validation `aphrody-infra validate` : 23 services, 25 routes, 0 violation.
