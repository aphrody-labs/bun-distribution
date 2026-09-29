# achillea-bot

Backend **Bun + Ts.ED + MikroORM 7 + discord.js** du monorepo Achillea : bot Discord, API REST (Ts.ED, :4000), ranked Colyseus (:4002) et Socket.IO (:4005). Base **Supabase** (PostgreSQL managé) + Redis (ioredis / BullMQ).

Ce workspace fait partie du monorepo : voir le **[README racine](../../README.md)** pour le
démarrage et la configuration du dépôt.

```bash
bun run --filter achillea-bot dev     # dev
bun run --filter achillea-bot build   # build prod (tsc -> build/)
```

- Portage initial : aucune configuration Docker, PM2, systemd, nginx, certificat ou donnée
  d'exécution n'est incluse dans ce workspace.
- Base de données : seules les migrations TypeScript versionnées sont conservées sous
  `database/migrations/`. Leur exécution exige une base Achillea dédiée et reste une
  opération explicite hors de ce portage.
- Ranked : [docs/ranked.md](docs/ranked.md).

## Configuration Supabase côté serveur

Les secrets sont injectés au processus (par exemple depuis `~/.bash_secrets`, mode `0600`) et
ne sont jamais placés dans le dépôt. Le backend accepte une URL PostgreSQL Supabase complète,
ce qui évite de dupliquer ses composants :

```text
DATABASE_URL=postgresql://<user>:<password>@<pooler>.supabase.com:6543/postgres?sslmode=require
DATABASE_URL_DEV=postgresql://<user>:<password>@<pooler-dev>.supabase.com:6543/postgres?sslmode=require
TEST_DATABASE_URL=postgresql://<user>:<password>@<pooler-test>.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<server-secret-key>
SUPABASE_STORAGE_BUCKET=images
SUPABASE_PRIVATE_STORAGE_BUCKET=ranked-proofs
SUPABASE_SIGNED_URL_TTL=3600
API_HOST=127.0.0.1
SOCKET_HOST=127.0.0.1
RANKED_HOST=127.0.0.1
```

- `DATABASE_URL` est prioritaire sur les anciennes variables `DATABASE_HOST`, `DATABASE_PORT`,
  `DATABASE_NAME`, `DATABASE_USER` et `DATABASE_PASSWORD`. Le sous-processus ranked utilise le
  même contrat. Les connexions vers Supabase activent TLS avec vérification du certificat.
- `SUPABASE_SECRET_KEY` reste strictement serveur. Une clé `sb_publishable_` ou un JWT de rôle
  `anon` est refusé par le service d'upload. `SUPABASE_SERVICE_KEY` reste accepté comme alias
  de migration.
- Le bucket `images` doit exister et être public, puisque les URL d'images génériques sont
  publiques. Les preuves ranked vont dans le bucket privé `ranked-proofs` et sont restituées
  via une URL signée temporaire. La création des buckets et leurs politiques restent des
  opérations d'administration explicites. En production, un échec Storage ferme l'upload
  (`503`) au lieu de publier une copie locale ; le repli disque n'existe qu'en développement.
- Les uploads web sont gardés en mémoire avec un plafond de 6 Mio, limités à PNG/JPEG/WebP/GIF,
  puis leur signature binaire est comparée au MIME annoncé avant l'envoi à Storage.
- Les trois serveurs écoutent par défaut uniquement sur la boucle locale. Définir explicitement
  une autre adresse seulement si l'isolation réseau du conteneur l'exige.

Les commandes de migration ne s'exécutent jamais au démarrage. Pour les tests réseau, utiliser
uniquement un projet ou une branche Supabase de test via les variables `TEST_*` documentées dans
[tests/README.md](tests/README.md).

## Note de licence des dépendances

La dépendance `case@~1.6.3` est publiée sous l'expression SPDX `MIT OR GPL` ; ce
workspace retient explicitement l'option MIT.
