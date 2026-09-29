# Services et stockage Achillea

> **Note d'architecture (23/09/2026)** : Le frontend autonome Angular d'Achilléa a été retiré et intégré dans `apps/website` (`/achillea`). Les unités `achillea-postgrest`, `achillea-storage` et `achillea-realtime` (ports 8820-8822) ainsi que le GoTrue dédié (`achillea-auth` port 8824) ont été retirés. La base Achilléa est désormais un schéma natif de la base `rg` (`scripts/ops/achillea-merge.ts`), et l'authentification est unifiée via Better Auth (`/api/achillea/session`). Seul `achillea-bot.service` reste actif aux côtés de `rg-api.service`.

Cette fiche décrit la configuration déclarative du portage Achillea. Elle ne constitue pas
une activation de production : aucune unité systemd, configuration Nginx, migration ou
politique Supabase n'est appliquée automatiquement.

La source de vérité machine-readable est le [catalogue de services
Infra](https://github.com/aphrody-code/aphrody-infra/blob/main/config/service-catalog.json).
Les routes et unités sont contrôlées avec le dépôt Infra, sans réseau ni secret.

## Topologie

| Surface                  | Écoute locale      | Exposition                                                      | Propriétaire                   |
| ------------------------ | ------------------ | --------------------------------------------------------------- | ------------------------------ |
| API REST Ts.ED           | `127.0.0.1:4000`   | via le proxy ranked ; upload `/api/proxy/*` en direct par Nginx | processus backend              |
| API unifiée Elysia/Kysely | `127.0.0.1:8800` | `https://api.rosegriffon.fr/v1/` et `/health` | `rg-api.service`               |
| Ranked REST + Colyseus   | `127.0.0.1:4002`   | `https://ranked.rosegriffon.fr`                                 | enfant du backend              |
| Socket.IO                | `127.0.0.1:4005`   | `https://ranked.rosegriffon.fr/socket.io/`                      | processus backend              |
| Front Achilléa            | route Next         | `https://rosegriffon.fr/achillea`                               | `apps/website`                |

`achillea-bot.service` supervise le backend, l'API historique, Socket.IO et le sous-processus
ranked. `rg-api.service` porte l'API unifiée Elysia/Kysely sur le même schéma PostgreSQL
`achillea`; les nouvelles surfaces migrées passent par `api.rosegriffon.fr/v1/`.
`KillMode=control-group` garantit que ranked s'arrête avec son parent. Le front de production
est rendu par `apps/website`; `achillea.rosegriffon.fr` redirige vers cette route.

L'unité candidate est
[`systemd/rg-achillea-bot.service`](https://github.com/aphrody-code/aphrody-infra/blob/main/systemd/rg-achillea-bot.service).
Elle n'est ni copiée ni démarrée par les tests de configuration.

## Secrets

Aucun `.env` réel ne doit être créé ou versionné dans le dépôt.

- En local, les valeurs sont chargées depuis `$HOME/.bash_secrets`, fichier utilisateur en
  mode `0600`, avant la commande Bun.
- En production, systemd lit exclusivement `/etc/rose-griffon/achillea.env`, détenu par root
  et en mode `0600`.
- Les valeurs déjà publiées dans une conversation ou un journal sont compromises : elles
  doivent être révoquées et remplacées avant d'être placées dans l'un de ces fichiers.
- Une clé personnelle Supabase `sbp_…` sert à administrer la plateforme. Ce n'est ni un mot
  de passe PostgreSQL, ni une clé Storage runtime, et elle ne doit pas être transmise au bot.

Le fichier de production contient au minimum les noms suivants, avec leurs valeurs injectées
hors Git :

| Classe              | Variables                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord             | `BOT_PROFILE=current` et `BOT_COMMAND_GUILDS` (liste CSV pour éviter les commandes globales dupliquées) ; profil `current` = application `1427690638576582697` (gateway, panneaux, ~59 guildes) : `BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`. L'OAuth du site est exclusivement Better Auth/Rose Griffon : dans cette application Discord, déclarer `https://rosegriffon.fr/api/auth/callback/discord`. Le profil `legacy` et `DISCORD_OAUTH_PROFILE` ne servent plus à connecter Achilléa ; `TEST_GUILD_ID`, `BOT_OWNER_ID` |
| PostgreSQL Supabase | `DATABASE_URL` (recommandé) ; les cinq variables `DATABASE_*` historiques restent un repli                                                      |
| API et sessions     | `API_ADMIN_TOKEN`, `JWT_SECRET_KEY`, `RANKED_INTERNAL_SECRET` ; les sondes admin utilisent uniquement `API_ADMIN_TOKEN` (aucun bearer Discord) |
| Redis               | `REDIS_HOST`, `REDIS_PORT`                                                                                                                      |
| Origins             | `WEBSITE_URL`, `PUBLIC_API_URL`, `UNIFIED_API_URL`, `OAUTH_CALLBACK_BASE_URL`, `WEB_ALLOWED_ORIGINS`, `RANKED_ALLOWED_ORIGINS`, `RANKED_PUBLIC_URL` |
| Storage Supabase    | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_PRIVATE_STORAGE_BUCKET`, `SUPABASE_SIGNED_URL_TTL`                  |

`API_HOST=127.0.0.1`, `API_PORT=4000`, `UNIFIED_API_HOST=127.0.0.1`, `UNIFIED_API_PORT=8800`,
`RANKED_HOST=127.0.0.1`, `RANKED_PORT=4002`,
`SOCKET_HOST=127.0.0.1`, `SOCKET_PORT=4005`, `NODE_ENV=production` et `RANKED_ENTRY` sont
fixés par l'unité versionnée, pas par le fichier secret. Cela empêche les trois ports amont
de contourner Nginx en écoutant sur l'interface publique. En production, `RANKED_ENTRY`
désigne exclusivement l'artefact construit `build/ranked/main.js`, jamais la source TypeScript.

Le mot de passe PostgreSQL reste nécessaire dans `DATABASE_URL` pour MikroORM et `Bun.SQL`.
La cible est désormais la base `rg`, schéma `achillea` (cf. section suivante) : le garde-fou
n'est plus « ne jamais écrire dans rg » mais « ne jamais écrire hors du schéma achillea »,
imposé par le chemin de recherche du rôle. TLS reste imposé pour les hôtes Supabase
distants.

### Une seule base : le schéma `achillea` de `rg`

Achilléa a vécu successivement sur Supabase Cloud, puis dans une base `achillea`
dédiée du cluster local, exposée à `rg` par `postgres_fdw` — des tables
étrangères, lisibles mais jamais écrivables, et une identité coupée en deux.
Depuis [`scripts/ops/achillea-merge.ts`](../scripts/ops/achillea-merge.ts), ses
69 tables sont de VRAIES tables du schéma `achillea` de la base `rg`.

Ce que ça change concrètement :

- une seule base à sauvegarder (`scripts/ops/sauvegarde.ts` la couvrait déjà,
  elle couvre maintenant tout) ;
- les jointures `public.profiles ⋈ achillea."user"` se font dans Postgres, sans
  connexion distante ni fenêtre de divergence ;
- la tâche nocturne `sync:achillea`, qui ne réalignait que la FORME des tables
  étrangères, n'a plus d'objet et a été retirée.

Les 67 politiques RLS ont été reprises telles quelles : c'est toujours elles la
barrière, jamais le GRANT. Le chemin de recherche est posé sur les rôles
(`alter role … in database rg set search_path = achillea, public`), pas dans la
configuration de MikroORM : les 56 migrations d'Achilléa écrivent des noms non
qualifiés, et l'application n'a pas changé d'une ligne.

```bash
bun scripts/ops/achillea-merge.ts --verify   # inventaire comparé, aucune écriture
bun scripts/ops/achillea-merge.ts --copy     # (re)copie le schéma et les données
bun scripts/ops/achillea-merge.ts --cutover  # bascule les services sur `rg`
```

La base `achillea` n'est PAS supprimée : elle reste le repli immédiat — remettre
l'ancienne `DATABASE_URL` dans `/etc/rose-griffon/achillea.env` et relancer le
service suffit à revenir en arrière.

`achillea-auth` (GoTrue dédié, port 8824) est arrêté et désactivé : son schéma
`auth` ne contenait qu'un utilisateur et aucun appel `/auth/v1/` n'est jamais
arrivé. Better Auth/Rose Griffon est l'unique propriétaire de la connexion et
du callback Discord. Après cette session, la passerelle du site émet seulement
un JWT Achilléa borné à l'API/ranked ; le contrat (émetteur, audience, durée,
cookie) est partagé entre `@rosegriffon/achillea-core` et `@rosegriffon/auth`.


## Configuration publique du navigateur

Le build Angular lit uniquement ces variables publiques :

```text
ACHILLEA_API_BASE_URL
ACHILLEA_SOCKET_URL
ACHILLEA_SOCKET_PATH
ACHILLEA_COLYSEUS_URL
ACHILLEA_CDN_BASE_URL
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_JWKS_URL
ACHILLEA_YOUTUBE_API_KEY
ACHILLEA_YOUTUBE_CHANNEL_ID
```

`SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_KEY`, `DATABASE_URL` et les secrets Discord/JWT ne
sont jamais acceptés par l'injecteur Angular. Le fichier public généré `achillea-config.js` est chargé
avant Angular et peut être remplacé au déploiement sans reconstruire les bundles.

Pour la production actuelle, l'API, Socket.IO et Colyseus doivent utiliser des noms DNS HTTPS
ou WSS ; l'injecteur refuse `localhost` et les adresses IP littérales. Le chemin Socket.IO reste
`/socket.io`.

## Uploads Supabase

Les uploads passent par le backend ; le navigateur ne reçoit jamais la clé secrète Supabase.
Le backend utilise `SUPABASE_SECRET_KEY` pour écrire et supprimer ; l'ancien nom
`SUPABASE_SERVICE_KEY` reste seulement un alias de transition. Deux buckets séparent les
usages publics des preuves privées.

| Usage                 | Bucket / préfixe objet | Visibilité                             | Limite                                      | Types                                    |
| --------------------- | ---------------------- | -------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Proxy web authentifié | `images/proxy/`        | URL publique                           | 6 Mio                                       | PNG, JPEG, WebP, GIF                     |
| Images Discord        | `images/discord/`      | URL publique                           | validation backend                          | PNG, JPEG, WebP, GIF                     |
| Preuves ranked        | `ranked-proofs/proof/` | privé, URL signée (3 600 s par défaut) | 5 Mio décodés, transport texte base64 8 Mio | PNG, JPEG, WebP détectés par magic bytes |

Le stockage est désormais décrit dans le [catalogue de services
Infra](https://github.com/aphrody-code/aphrody-infra/blob/main/config/service-catalog.json)
et le script de migration versionné. Il ne s'exécute pas seul. Il faut d'abord
obtenir un dump valide de la base Achillea, relire la cible et appliquer la migration
sur ce projet uniquement.

Les références persistées pour les nouvelles preuves sont opaques (`supabase-private:…`) ;
le backend génère l'URL signée seulement à la lecture. Les anciennes URL publiques et les
références locales restent lisibles pendant la transition. Une politique de rétention et de
suppression reste à approuver avant l'activation de production.

## Vérifications d'exploitation

Après une activation explicitement autorisée, les sondes attendues sont :

| Sonde                                      | Attendu                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `http://127.0.0.1:4000/health/check`       | JSON du bot/API ; la disponibilité Discord est un champ, pas la santé du port |
| `http://127.0.0.1:4002/api/health`         | `200` et `{ "ok": true, … }`                                                  |
| TCP `127.0.0.1:4005`                       | port Socket.IO ouvert ; le namespace notifications exige ensuite un JWT       |
| `https://achillea.rosegriffon.fr/`         | shell Angular                                                                 |
| `https://ranked.rosegriffon.fr/api/health` | même santé ranked derrière Nginx                                              |

Les tests statiques ne prétendent pas valider l'état live, la connexion PostgreSQL/Redis,
les permissions du bucket, OAuth, CORS ou les WebSockets. Ces contrôles appartiennent à la
gate d'activation, avec sauvegarde, canary et retour arrière.
