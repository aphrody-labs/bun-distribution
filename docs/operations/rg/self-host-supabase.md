# Sortie de Supabase — pile self-host sur le VPS

> **Note de consolidation (23/09/2026)** : Les sous-domaines `supabase.`, `storage.`, `realtime.` et `studio.rosegriffon.fr` ont été retirés (DNS A supprimés), ainsi que l'unité `rg-postgrest` et les conteneurs `supabase-studio.yml`. Les surfaces publiques `/storage/v1` et `/realtime/v1` sont servies directement par Nginx sur `rosegriffon.fr` via `rg-storage` (:8810) et `rg-realtime` (:8812).

Le projet Supabase Cloud a été restreint pour dépassement du quota de stockage
(`exceed_storage_size_quota`, 3,99 Go sur un plafond de 1 Go), ce qui a coupé
**toute** l'API du projet — Storage *et* Data API PostgREST, y compris avec la
clé `service_role`. Seule la connexion Postgres directe restait ouverte.

L'ensemble a donc été rapatrié sur le VPS. Aucun appel ne sort plus vers
`*.supabase.co`.

## Ce qui remplace quoi

| Service Supabase | Remplacement self-host | Port | Unité systemd |
| --- | --- | --- | --- |
| Postgres géré | PostgreSQL 18 local, base `rg` | 5432 | `postgresql.service` |
| Data API (`/rest/v1`) | PostgREST 12.2.12 (binaire natif) | 8809 | `rg-postgrest.service` |
| Storage (`/storage/v1`) | `packages/rg/storage/server.ts` (Bun, fichiers sur disque) | 8810 | `rg-storage.service` |
| Realtime (`postgres_changes`) | `packages/rg/realtime/server.ts` (SSE + `LISTEN/NOTIFY`) | 8812 | `rg-realtime.service` |

Le code applicatif n'a **pas** été réécrit : `@supabase/supabase-js` continue de
fonctionner tel quel parce que la version de PostgREST est la même que celle de
Supabase Cloud et que `SUPABASE_JWT_SECRET` — que nous possédions déjà — signe
les clés `anon` et `service_role` existantes. Elles restent valides.

## Routage

`infra/nginx/supabase-compat.inc` expose les trois surfaces sur l'origine de
chaque application, ce qui évite tout cross-origin et garde valides les URLs
absolues déjà stockées en base :

```
/rest/v1/      → 127.0.0.1:8809   (PostgREST)
/graphql/v1    → 127.0.0.1:8809   (/rpc/graphql, profil graphql_public)
/storage/v1/   → 127.0.0.1:8810   (rg-storage)
/realtime/v1/  → 127.0.0.1:8812   (rg-realtime, SSE)
```

Inclus dans les vhosts `azalee.rosegriffon.fr`, `rosegriffon.fr` et
`api.rosegriffon.fr`. `infra/nginx/supabase-internal.conf` monte les mêmes
routes sur `127.0.0.1:8811`, point d'entrée des scripts serveur
(`SUPABASE_INTERNAL_URL`).

> **Mise à jour (2026-09-26, aphrody-infra `docs/reference/infra/PORTS-AND-DOMAINS.md` item 13)** : la conf nginx
> réellement déployée (`rg-production.conf`) n'écoute jamais sur `:8811` et n'inclut pas
> `supabase-internal.conf` — `rg-api:8800` absorbe storage/realtime en-process et sert
> `/storage/v1/`/`/realtime/v1/` en pratique. Les replis codés en dur de
> `packages/rg/db/src/env.ts`, `packages/rg/cron/src/lib/storage-assets.ts` et
> `apps/rg/website/next.config.ts` pointent donc désormais vers `127.0.0.1:8800`, pas `:8811` ; ne
> définissez `SUPABASE_INTERNAL_URL` sur `:8811` que si `supabase-internal.conf` est effectivement
> redéployé.

### Sous-domaines dédiés

`infra/nginx/supabase.rosegriffon.conf` ajoute quatre noms publics, un seul
certificat, enregistrements A chez OVH vers `51.77.147.152` :

| Nom | Rôle |
| --- | --- |
| `supabase.rosegriffon.fr` | remplaçant exact de `https://<ref>.supabase.co` — `/rest/v1`, `/storage/v1`, `/realtime/v1` sous leurs préfixes ; racine en 404 |
| `db.rosegriffon.fr` | PostgREST seul, à la racine (`/articles?select=…`) |
| `storage.rosegriffon.fr` | fichiers seuls, à la racine (`/object/public/<bucket>/<chemin>`) |
| `realtime.rosegriffon.fr` | flux SSE seul, à la racine (`/stream?table=…`) |

Ces noms **s'ajoutent** aux routes servies sur l'origine des applications, ils
ne les remplacent pas : `NEXT_PUBLIC_SUPABASE_URL` reste volontairement sur
l'origine de chaque app. Y basculer réintroduirait une requête préalable CORS
sur chaque appel navigateur, pour un gain purement cosmétique — les
sous-domaines servent aux clients externes, aux scripts et au débogage.

Renouvellement du certificat : `certbot` avec l'authentificateur `nginx`, le
bloc HTTP du vhost sert `/.well-known/acme-challenge/` depuis `/var/www/html`.

Variables d'environnement :

| Variable | Valeur |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | l'origine de l'app (`https://rosegriffon.fr`) |
| `SUPABASE_INTERNAL_URL` | `http://127.0.0.1:8811` |
| `DATABASE_URL` | `postgresql://rg:<motdepasse>@127.0.0.1:5432/rg` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | inchangées |

## Studio

`studio.rosegriffon.fr` sert le vrai Supabase Studio, branché sur notre pile.
Deux conteneurs (`infra/docker/supabase-studio.yml`), en réseau hôte parce
qu'ils doivent joindre des services qui n'écoutent que sur la boucle locale :

| Conteneur | Port | Rôle |
| --- | --- | --- |
| `rg-pg-meta` | 8813 | introspection Postgres (`supabase/postgres-meta`) |
| | 8814 | port d'admin de pg-meta, **non configurable** (= `PG_META_PORT + 1`) |
| `rg-studio` | 8815 | interface Next (`supabase/studio`) |

Ce qui fonctionne, vérifié bout en bout : **éditeur SQL** (requêtes réelles sur
la base), **éditeur de tables**, **policies RLS**, **rôles et extensions**,
**explorateur de stockage** (il liste nos buckets et nos objets à travers
`rg-storage`), et même la section **Auth**, que Studio lit directement dans
`auth.users` via pg-meta. La section **Logs** reste vide : elle demande
Logflare, qui n'est pas dans notre pile (`NEXT_PUBLIC_ENABLE_LOGS=false`).

Studio se connecte à Postgres avec le rôle `rg`, propriétaire de tous les
objets applicatifs — pas superutilisateur. L'installation d'extensions et la
gestion des rôles système sont donc en lecture seule ; tout le travail
applicatif passe.

**Studio donne un accès complet en écriture à la base.** Il est protégé par
authentification HTTP basique (`/etc/nginx/studio.htpasswd`, identifiants dans
`/etc/rg-studio.env`), et les deux conteneurs n'écoutent que sur `127.0.0.1`.

```bash
sudo docker compose --env-file /etc/rg-studio-stack.env \
     -f infra/docker/supabase-studio.yml up -d
```

Piège : le fichier `htpasswd` doit être lisible par le groupe de l'utilisateur
des workers nginx — ici `nobody:nogroup`, pas `www-data`. Sinon nginx renvoie
**500** (et non 401) sur toute requête *authentifiée*, avec un
`13: Permission denied` dans `studio.rosegriffon.fr.error.log`.

## API GraphQL

`pg_graphql` 1.6.1 (paquet officiel `.deb` pour PG 18) génère une API GraphQL
sur tout le schéma `public`. PostgREST publie `graphql_public.graphql()` en RPC,
nginx la présente sous `/graphql/v1` — même adresse que chez Supabase.
Mise en place : `apps/rg/website/supabase/migrations/20260811_pg_graphql.sql`.

**Drapeau à connaître** : depuis pg_graphql **1.6.0 l'introspection est
désactivée par défaut**. Sans elle, les requêtes de données fonctionnent
normalement mais tout `__schema` / `__type` répond
`Unknown field "__schema" on type Query` — symptôme trompeur qui fait chercher
un problème de droits ou de `search_path`. Elle s'active par un commentaire de
schéma, pas par une option de configuration :

```sql
COMMENT ON SCHEMA public IS '@graphql({"introspection": true})';
```

C'est ce qui permet à l'onglet GraphQL de Studio (GraphiQL) de peupler son
explorateur. 228 champs sont exposés.

## Documentation d'API du projet

La section « API Docs » de Studio n'est bridée par **aucun** drapeau : elle lit
la spec OpenAPI que PostgREST génère (135 chemins, 120 définitions — tout le
schéma `public`).

Un réglage compte : sans `openapi-server-proxy-uri`, la spec s'annonce avec
`host: 127.0.0.1:8809` et `schemes: ["http"]`, c'est-à-dire l'adresse de boucle
locale, ce qui rend la doc inutilisable pour un client externe. D'où, dans
`/etc/postgrest.conf` :

```
openapi-server-proxy-uri = "https://supabase.rosegriffon.fr/rest/v1"
```

La spec annonce alors `host: supabase.rosegriffon.fr:443`, `basePath: /rest/v1`,
`schemes: ["https"]`.

Note d'exposition : `openapi-mode = "ignore-privileges"` (le défaut de Supabase
Cloud) publie la forme complète du schéma, introspection GraphQL comprise. Les
**données** restent protégées par les 170 policies RLS ; seule la structure est
publique, exactement comme avant la migration.

## Outils internes

Les outils internes d'exploitation accèdent à la pile via quatre opérations de lecture :

| Outil | Ce qu'il ouvre |
| --- | --- |
| `live_tables` | tables, vues et fonctions exposées, colonnes comprises |
| `live_select` | lecture d'une table avec filtres PostgREST et total exact |
| `live_graphql` | requête GraphQL, introspection incluse |
| `live_storage` | buckets, objets et URL publiques |

Ils complètent les outils `db_*`, qui restent sur le miroir SQLite : celui-ci
est rapide et hors-ligne mais ne couvre que les 65 tables `inagle_*` du jeu et
date du dernier dump nocturne. Les outils `live_*` atteignent les 120 tables du
schéma `public` — articles, équipes, quêtes, boutiques, tweets, membres — à la
seconde près.

**Ils utilisent la clé `anon`, jamais celle de service.** Les droits restent
ceux d'un visiteur anonyme : les policies RLS s'appliquent et
les colonnes personnelles de `profiles` restent hors de portée. Vérifié :
`live_select` sur `profiles` avec `select=email` ou `select=*` renvoie
`42501 permission denied`, tandis que `username, role` passe.

## Données personnelles

Deux fuites ont été trouvées et fermées le 11/8/2026, toutes deux héritées de
la configuration Supabase d'origine :

1. **API REST** — la policy `Public profiles are viewable by everyone`
   (`USING (true)`) combinée à un `GRANT SELECT` au niveau **table** rendait les
   e-mails et adresses postales des 31 comptes lisibles par quiconque, la clé
   `anon` étant publique par conception. Correctif :
   `apps/rg/website/supabase/migrations/20260811_profiles_pii.sql`.
   Piège : un GRANT au niveau table masque tout `REVOKE` par colonne — il faut
   révoquer la table **avant** de re-granter la liste blanche, sinon la
   révocation est silencieusement sans effet.
2. **Flux temps réel** — le trigger `rg_realtime_notify()` diffusait la ligne
   entière, e-mail compris, sur un flux SSE non authentifié. Il retire
   désormais les colonnes personnelles pour `profiles`.

Conséquence assumée : `select=*` sur `profiles` échoue pour `anon`. Les appels
applicatifs qui lisaient des données personnelles passent au client
service-role, après vérification de session — ce qu'ils auraient dû faire dès
le départ.

## Base de données

`public` (120 tables, 172 fonctions, 170 politiques RLS), `auth` et `storage`
ont été restaurés à l'identique — 145 tables sur 145 avec le même nombre de
lignes que la source. Les rôles `anon`, `authenticated`, `service_role` et
`authenticator` sont recréés avec les mêmes droits, et les quatre fonctions
d'aide `auth.uid()` / `auth.role()` / `auth.email()` / `auth.jwt()` lisent les
claims injectés par PostgREST : **les politiques RLS s'appliquent inchangées**.

Extensions requises : `pg_trgm`, `vector` (paquet `postgresql-18-pgvector`),
`pgcrypto` et `uuid-ossp` (schéma `extensions`).

## Stockage des fichiers

Racine : `/var/www/rg-storage/<bucket>/<chemin>`. L'index reste la table
`storage.objects`, ce qui préserve les listings et les URLs publiques déjà
enregistrées en base.

Le service implémente le sous-ensemble de l'API consommé par le monorepo :
`upload`, `update`, `remove` (simple et par lots), `list`, `move`, `copy`,
`createSignedUrl`, téléchargement public, signé et authentifié, lecture des
buckets, requêtes `Range` et `ETag`. Les autorisations reproduisent les
politiques RLS d'origine : lecture publique sur les buckets publics, écriture
réservée au `service_role` ou aux administrateurs, dossier personnel imposé sur
`avatars`.

### Reconstruction des fichiers

Le Storage étant devenu inaccessible avant la migration, les octets ont été
reconstruits depuis les sources d'origine :

| Bucket | Objets | État |
| --- | --- | --- |
| `tweets` | 6 423 | 5 529 re-téléchargés depuis `pbs.twimg.com` (`scripts/rg/ops/refetch-tweet-media.ts`). Le reste correspond à des vidéos ou à des médias supprimés côté Twitter. |
| `patreon` | 26 | À re-synchroniser via l'API Patreon (`apps/rg/website/scripts/patreon-images-sync.ts`) : les URLs d'origine sont signées et expirées. |
| `assets` | 4 | Deux logos partenaires et deux photos d'équipe, non récupérables automatiquement. |
| `article` | 0 | Bucket purgé. La couverture perdue a été remplacée par un visuel du jeu servi par le CDN ; les trois lignes d'index orphelines ont été retirées via l'API Storage. |

Sur les images de `gallery_img2`, toujours passer par la variante `?w=<largeur>&format=webp`
du CDN : l'originale est un PNG de 9,3 Mo, la variante 1600 px pèse 42 Ko.

## Temps réel

Le trigger `public.rg_realtime_notify()`
(`apps/rg/website/supabase/migrations/20260811_realtime_notify.sql`) publie chaque
changement des tables `comments`, `settings` et `profiles` sur le canal
`rg_realtime`. `rg-realtime` tient l'écoute et rediffuse en SSE avec le même
filtrage que `postgres_changes` (`table`, `schema`, `colonne=eq.valeur`). Les
charges utiles dépassant la limite de 8 000 octets de `NOTIFY` sont réduites aux
identifiants et marquées `truncated`.

Côté navigateur, `apps/rg/website/src/lib/realtime.ts` expose `subscribeTable()` ;
`EventSource` gère la reconnexion. Les quatre points d'appel
(`CommentsSection`, `RealtimeSettingsListener`, `useTableBroadcast`,
`useProfileBroadcast` / `use-profile-sync`) ont été basculés dessus.

## Exploitation

```bash
systemctl status rg-postgrest rg-storage rg-realtime
curl -s http://127.0.0.1:8811/health
curl -s http://127.0.0.1:8810/health
curl -s http://127.0.0.1:8812/health
```

Secrets : `/etc/postgrest.conf`, `/etc/rg-storage.env`, `/etc/rg-realtime.env`
(tous en 0600).

Le miroir SQLite (`nie-miroir.timer`, possédé par `~/nie`) et les
sauvegardes continuent de fonctionner sur la base locale. Le publisher écrit
`~/nie/var/mirror.sqlite`; Azalée le consomme via `SQLITE_DB_PATH`.

## Pièges

- **Ne pas régénérer les clés** `anon` / `service_role` sans mettre à jour
  `jwt-secret` dans `/etc/postgrest.conf` et `SUPABASE_JWT_SECRET` dans
  `/etc/rg-storage.env` : les trois doivent rester cohérents.
- **`Bun.SQL` n'expose pas `LISTEN`/`NOTIFY`** (1.4.0) — `rg-realtime` utilise
  `pg`, déjà présent dans le monorepo.
- **PostgREST doit rester en 12.2.x**, la version servie par Supabase Cloud :
  la 16 change des comportements de réponse que `postgrest-js` interprète.
- **Les chemins `/storage/v1/object/public/menu/...`** encore présents dans
  `inagle_skills.image_url` (1 002) et `inagle_teams.emblem_url` (208) ne
  concernent pas ce bucket : `resolveAssetUrl()` les réécrit vers le CDN.
- **Sauvegardes de la migration** : `~/rg-migration-backup/`
  (dumps, index `storage.objects`, fichiers d'environnement d'avant bascule).
