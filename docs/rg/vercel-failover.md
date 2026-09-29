# Secours Vercel de Website

## Portée

Le secours Vercel couvre uniquement `apps/website`, qui inclut le wiki Azalée
sous `/wiki`. Il n'existe aucun projet ou build Vercel Azalée distinct. Il ne remplace pas les
services persistants du VPS : PostgreSQL/PostgREST, Storage, Realtime SSE, CDN
dynamique, RAG, MCP, bots Discord, cron et génération de modèles NIE.

Les frontends Vercel doivent donc joindre les API publiques du VPS tant qu'une
base managée et un stockage objet n'ont pas été migrés. Ce mode protège les pages
et assets de build contre une panne applicative, mais pas contre une perte totale
du VPS et de ses données.

## Authentification

Ne jamais committer un jeton Vercel ni le placer dans `.env`. Injecter un jeton
fraîchement créé dans le shell, exécuter le préflight, puis effacer la variable :

```bash
read -rsp 'Jeton Vercel: ' VERCEL_TOKEN && export VERCEL_TOKEN
bun scripts/ops/vercel-failover.ts preflight
unset VERCEL_TOKEN
```

Le script écrit l'identifiant dans
`~/.config/aphrody/vercel/auth.json`, dossier `0700`, fichier `0600`, hors dépôt.

## Déploiement one-shot

```bash
bun scripts/ops/vercel-failover.ts deploy
```

Le déploiement utilise `--skip-domain` : aucune bascule publique n'arrive avant
les tests. Configurer dans les projets Vercel les variables nécessaires issues
du coffre de production, en particulier les URLs publiques, Better Auth, OAuth,
SMTP, Stripe, Supabase compatible et Sentry. Ne pas copier les chemins locaux
(`127.0.0.1`, `/var/...`, SQLite) dans Vercel.

Après validation des URLs Vercel :

1. ajouter `rosegriffon.fr` et `www.rosegriffon.fr` au projet Website ; conserver
   `azalee.rosegriffon.fr` comme redirection permanente vers `/wiki` ;
2. appliquer les enregistrements DNS proposés par Vercel chez OVH ;
3. conserver `api`, `cdn`, `supabase`, `db`, `storage`, `realtime`, `mcp` et les
   workers sur le VPS ;
4. vérifier OAuth/Better Auth, webhooks Stripe, CSP, cookies et uploads ;
5. garder le TTL DNS bas pendant la fenêtre de bascule.

## Condition d'un vrai secours sans VPS

Pour survivre à la perte totale du VPS, migrer d'abord PostgreSQL vers un service
managé, `/var/www/rg-storage` vers un stockage objet, les transformations CDN
vers un service image, Realtime vers un transport managé et RAG vers une base
vectorielle accessible aux fonctions Vercel. Les bots, MCP et cron nécessitent
un hôte de processus permanent distinct de Vercel Functions.
