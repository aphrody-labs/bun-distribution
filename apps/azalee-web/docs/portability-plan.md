# Plan de portabilité d’Azalée

## Objectif

Rendre Azalée déployable sans modification fonctionnelle sur :

1. Vercel ;
2. un serveur auto-hébergé avec Docker ou systemd ;
3. un autre hébergeur Node compatible ;
4. une installation déplacée vers une autre base, un autre stockage ou un autre domaine.

Le code applicatif doit rester identique. Seuls l’image, les variables d’environnement, les adaptateurs d’infrastructure et les fichiers de déploiement peuvent varier.

## État actuel et risques

Azalée est un monolithe Next.js App Router avec environ 90 pages, 23 Server Actions et 209 composants. La portabilité est actuellement limitée par :

- dépendance simultanée à Supabase, PostgreSQL direct, Drizzle/Kysely et un cache SQLite Bun ;
- logique d’environnement dans `lib/supabase/server.ts`, `lib/auth.ts` et `next.config.ts` ;
- réécriture `/storage` spécifique à nginx/self-host ;
- sortie `standalone` et hypothèses Bun dans les scripts de build/exécution ;
- services externes codés directement : Google, Discord, CloudFront, Vroid, email, Web Push, Sentry ;
- jobs cron et imports exécutés hors d’un contrat de queue explicite ;
- secrets, URL publiques et valeurs de secours mélangés avec la logique de démarrage ;
- migrations, sauvegardes et données de référence pas encore réunies dans un kit de déplacement reproductible.

## Architecture cible

```text
app/                         Adaptateurs Next : routes, pages, actions
src/features/               Modules métier : characters, news, avatar, search…
src/application/            Cas d’usage, contrats, DTO, autorisation
src/infrastructure/         Implémentations DB, auth, stockage, email, queue
packages/db/                Schéma, migrations, repositories portables
packages/platform/          Contrat de plateforme et adaptateurs
ops/                         Docker, compose, Vercel, systemd, sauvegarde
```

Règle de dépendance : `app` peut appeler `application`, `application` peut appeler des interfaces, et `infrastructure` implémente ces interfaces. Le métier ne doit jamais importer `next/*`, `process.env`, un client Supabase concret, `bun:sqlite` ou un SDK fournisseur.

## Contrat de plateforme

Créer un module de configuration validé au démarrage, avec :

- `APP_ORIGIN`, `APP_ENV`, `PORT` ;
- `DATABASE_URL` et paramètres de pool ;
- `AUTH_SECRET`, `AUTH_BASE_URL`, OAuth providers ;
- `STORAGE_DRIVER` (`s3`, `supabase`, `local`) et credentials ;
- `EMAIL_DRIVER` (`smtp`, fournisseur HTTP, `noop`) ;
- `QUEUE_DRIVER` (`database`, `redis`, `vercel`, `noop`) ;
- `CACHE_DRIVER` (`memory`, `redis`, `database`, `noop`) ;
- `CRON_AUTH_SECRET` ;
- Sentry, CDN, Web Push, Google et Discord comme intégrations optionnelles.

Le démarrage doit échouer avec un message précis pour une variable obligatoire. Les placeholders silencieux et les fallbacks secrets doivent disparaître en production.

## Décisions structurantes

### 1. Runtime

Standardiser le runtime applicatif sur Node.js LTS pour la compatibilité Vercel et self-host. Bun reste autorisé pour le développement et les scripts explicitement compatibles, mais ne doit pas être requis pour servir l’application.

Vérifier chaque dépendance native (`sharp`, `pg`, `konva`, `bcryptjs`, WASM, Inagle) dans les deux modes : build Vercel et image Docker Linux.

### 2. Base de données

Faire de PostgreSQL la source de vérité unique pour les données transactionnelles et de référence.

- Drizzle devient l’interface d’écriture et de lecture côté serveur.
- Supabase JS reste uniquement un adaptateur optionnel pour RLS/realtime/storage si nécessaire.
- Le proxy PostgreSQL/SQLite de `lib/supabase/server.ts` est supprimé du chemin métier.
- Le cache SQLite devient un artefact local optionnel, jamais une dépendance de production.
- Toutes les modifications passent par des migrations versionnées et idempotentes.

Support cible : PostgreSQL managé ou auto-hébergé, sans dépendance obligatoire aux extensions propriétaires Supabase. Les fonctionnalités RLS doivent être documentées et testées séparément.

### 3. Authentification

Conserver Better Auth, mais isoler son initialisation derrière `AuthPort`.

- sessions et comptes dans PostgreSQL ;
- cookies HTTP-only, domaine et secure dérivés de `APP_ORIGIN` ;
- OAuth configuré par variables, sans URL codée en dur ;
- rôle/permissions vérifiés dans les cas d’usage ;
- pont JWT Supabase optionnel, activé par adaptateur et non par défaut dans le métier.

Prévoir un export/import des utilisateurs, comptes liés, sessions invalidées et rôles avant tout déplacement.

### 4. Stockage de fichiers

Créer `ObjectStorage` avec opérations `put`, `get`, `delete`, `exists`, `signedUrl`.

- adaptateur S3-compatible recommandé pour la portabilité ;
- adaptateur Supabase Storage pour l’installation actuelle ;
- adaptateur filesystem uniquement en développement ou petite installation ;
- les pages ne construisent plus d’URL `/storage` fournisseur ;
- les objets sont référencés par clé logique (`zukan/…`, `avatars/…`) et non par URL absolue.

Les assets volumineux, modèles 3D, vidéos et sauvegardes doivent être externalisés du conteneur et inclus dans un manifeste exportable.

### 5. Cache, jobs et cron

Créer des interfaces `Cache`, `JobQueue` et `Scheduler`.

- mode self-host minimal : PostgreSQL + worker séparé ;
- mode scalable : Redis/Valkey + worker ;
- mode Vercel : route cron authentifiée qui pousse ou exécute des jobs courts ;
- aucune tâche longue dans une Server Action ou une fonction HTTP synchrone ;
- jobs idempotents avec clé de déduplication, retry borné, timeout et journal d’exécution.

Les imports, génération d’index, envoi de notifications, publication planifiée et sauvegardes doivent devenir des jobs observables.

## Matrice de déploiement

| Élément  | Vercel                       | Self-host                           | Portable              |
| -------- | ---------------------------- | ----------------------------------- | --------------------- |
| Web      | Next.js Node runtime         | Next standalone dans Docker/systemd | Oui                   |
| DB       | PostgreSQL managé            | PostgreSQL Docker ou externe        | Oui                   |
| Auth     | Better Auth + DB             | Better Auth + DB                    | Oui                   |
| Fichiers | S3/Supabase Storage          | S3/MinIO/Supabase                   | Oui                   |
| Jobs     | Cron Vercel + worker externe | worker Docker/systemd               | Via `JobQueue`        |
| Cache    | Redis/Upstash ou DB          | Valkey/Redis ou DB                  | Via `Cache`           |
| CDN      | Vercel/CDN externe           | nginx/CDN externe                   | URL dérivée de config |
| Logs     | stdout + Sentry              | stdout/journald + Sentry            | Oui                   |
| Secrets  | variables Vercel             | `.env` injecté/secrets manager      | Oui                   |

## Plan d’exécution par phases

### Phase 0 — contrat de compatibilité

- figer versions Node, package manager, architecture CPU et variables publiques ;
- documenter les routes, Server Actions, cron, webhooks et intégrations ;
- créer une matrice de tests Vercel-like/self-host ;
- définir SLO minimaux : démarrage, healthcheck, lecture, login, upload, mutation, job.

### Phase 1 — bootstrap reproductible

- ajouter `.env.example` complet et validation typée ;
- ajouter `Dockerfile` multi-stage et `docker-compose.yml` pour app, PostgreSQL, worker et stockage S3-compatible ;
- créer `ops/migrate`, `ops/backup`, `ops/restore`, `ops/smoke` ;
- standardiser `build`, `start`, `worker` et `migrate` avec Node ;
- rendre le healthcheck indépendant de Supabase et détailler les dépendances dégradées.

### Phase 2 — découplage infrastructure

- extraire DB, auth, storage, email, cache, queue dans `packages/platform` ;
- remplacer les imports directs de `process.env` par `config` ;
- supprimer les URL fournisseurs codées en dur ;
- isoler le bridge JWT Supabase et le cache SQLite ;
- ajouter des tests contractuels pour chaque adaptateur.

### Phase 3 — découpage métier

- organiser `wikiService` par domaines ;
- déplacer validations, repositories et cas d’usage hors de `app/` ;
- rendre les pages et actions minces ;
- uniformiser autorisation, erreurs, pagination, cache et observabilité ;
- conserver GraphQL comme adaptateur externe, basé sur les mêmes cas d’usage que les pages.

### Phase 4 — données et migration

- produire migrations PostgreSQL depuis zéro ;
- vérifier 23/23 politiques RLS et leurs équivalents en accès serveur ;
- exporter données, objets, utilisateurs, rôles, paramètres et index ;
- restaurer sur une instance vierge ;
- comparer volumes, checksums, relations, slugs, images et permissions ;
- documenter rollback et rotation des secrets.

### Phase 5 — déploiements officiels

- Vercel : build, variables, domaine, cron, logs, limites de durée et stockage externe ;
- self-host Docker : reverse proxy, TLS, volumes, worker, backups, migrations atomiques ;
- self-host systemd : générer l’unité depuis l’artefact standalone, sans logique spécifique dans l’application ;
- ajouter un environnement de staging identique à chaque cible.

### Phase 6 — validation de déplacement

- déployer une copie complète sur un domaine temporaire ;
- exécuter les smoke tests et tests Playwright ;
- tester OAuth avec nouveaux callbacks ;
- tester upload/download, génération OG, WASM, Web Push et jobs ;
- basculer le DNS avec TTL réduit ;
- surveiller erreurs, latence, queues et taux de login ;
- conserver l’ancien environnement en lecture seule jusqu’à validation finale.

## CI/CD obligatoire

Chaque pull request doit exécuter :

1. format, lint et type-check ;
2. tests unitaires et intégration PostgreSQL ;
3. build Next en mode production ;
4. build et démarrage de l’image Docker ;
5. smoke tests HTTP ;
6. tests Playwright sur l’image ;
7. vérification qu’aucun secret ou hostname d’environnement n’est embarqué.

Les branches de déploiement doivent publier un artefact immuable : commit, image digest, migrations appliquées et manifeste de configuration non secret.

## Critères d’acceptation

Le projet sera considéré portable lorsque :

- une installation vierge démarre avec `docker compose up` et un `.env` documenté ;
- la même image applicative fonctionne sur Vercel et self-host ;
- aucune page métier ne dépend directement de Supabase, Vercel, nginx ou Bun ;
- une sauvegarde complète permet de restaurer DB et objets sur un autre fournisseur ;
- le changement de domaine ne nécessite aucune modification de code ;
- les jobs peuvent être arrêtés puis rejoués sans doublons dangereux ;
- les tests de migration et smoke tests passent sur deux infrastructures distinctes ;
- un rollback applicatif et un rollback de migration sont documentés et testés.

## Ordre prioritaire recommandé

1. configuration typée + Docker + migrations ;
2. PostgreSQL/DB unique et suppression des fallbacks silencieux ;
3. stockage abstrait et export d’objets ;
4. auth et callbacks pilotés par configuration ;
5. worker/queue idempotent ;
6. extraction des services métier ;
7. pipelines Vercel et self-host ;
8. exercice complet de déplacement et restauration.

Cette stratégie conserve le monolithe Next.js, mais transforme chaque dépendance d’hébergement en adaptateur remplaçable. Elle évite donc de maintenir une version Vercel et une version self-host divergentes.
