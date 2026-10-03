# Développement local — Windows et WSL

> **État au 2026-10-02 : procédure historique, à ne pas suivre telle quelle.**
> Les commandes `bun run env:dev`, `bun run env:prod` et `bun scripts/dev/local-env.ts`
> ne correspondent à aucun script d'environnement à la racine de ce monorepo.
> Une copie résiduelle se trouve sous `scripts/dev/shenron/scripts/dev/local-env.ts`,
> mais son chemin et sa résolution de racine ne constituent pas une procédure validée.
> La préparation des `.env.local`, des tunnels distants et des secrets doit suivre
> les consignes d'exploitation actuelles; ne pas lancer ces commandes de cette page.

Les scripts Bun actuellement déclarés pour lancer les applications sont
`bun --filter @shenron/site dev` et `bun --filter @shenron/bot dev`, depuis la
racine. Ils ne génèrent pas la configuration d'environnement.

Environnement de travail Shenron sur poste : accès aux services distants par tunnels SSH,
fichiers d'environnement par app, et Next.js exécuté dans WSL.

## Ancienne procédure (historique)

```bash
bun run env:dev                         # profil local : PostgreSQL/Redis locaux, aucun token Discord prod
bun run env:prod                        # profil production : URLs, OAuth et credentials prod
bun scripts/dev/local-env.ts tunnels   # ouvre les tunnels SSH (premier plan)
bun scripts/dev/local-env.ts status    # sonde chaque port local (code ≠ 0 si un tunnel est tombé)
```

Même commande sous Windows et dans WSL : chaque côté ouvre ses propres tunnels, avec ses
propres clés `~/.ssh` et les alias `vps` et `dbfr`.

## Ports et services

Les ports distants ne sont pas écrits ici : `local-env.ts` les lit dans le catalogue
`config/service-catalog.json`, champs `health` et `target`. Le catalogue est
cherché dans cet ordre :

1. `APHRODY_INFRA_DIR` ;
2. le premier dépôt englobant qui contient `config/service-catalog.json` (le monorepo).

Règle : **port local = port distant + 10 000**. Le décalage évite toute collision avec un
service qui tourne déjà sur le poste : PostgreSQL local, Redis de WSL, ou le tunnel
`vps-tunnel` sur les ports standards.

Seule exception : PostgreSQL garde le port local que le catalogue donne à `shenron-pg-tunnel`.
`DATABASE_URL` est ainsi identique en local et en production.

| Service | Hôte SSH | Source du port distant |
| --- | --- | --- |
| PostgreSQL `shenron_site` | `dbfr` | `shenron-pg-tunnel.target` |
| Redis | `vps` | port Redis standard |
| `aphrody-ai-http` (LLM, RAG, OCR, vision) | `vps` | `health` du catalogue |
| `aphrody-shenron-embed` (E5) | `vps` | `health` du catalogue |
| API du bot (`shenron-bot`) | `vps` | `health` du catalogue |
| Outils Dragon Ball MCP (`aphrody-mcp`) | poste local | binaire `aphrody-mcp` sur le `PATH`; routes Shenron/Aphrody configurées par l'environnement |

Si un port local est déjà ouvert, le tunnel correspondant n'est pas relancé : un tunnel
existant est réutilisé, jamais tué.

> Ces tunnels mènent aux **services de production**. Les règles du dépôt s'appliquent :
> suppressions logiques uniquement (`visible = false`), jamais de `rag:build`, pas d'écriture
> en base hors procédure.

## Fichiers d'environnement

`env` lit le `.env` racine. Ce fichier concatène les variables du site, du bot et d'Aphrody,
avec des clés en double. Le script écrit un `.env.local` par app, ignoré par git :

- **Doublons résolus** selon la règle du chargeur Bun : la dernière valeur l'emporte.
- **`NODE_ENV` retiré.** C'est la commande qui le fixe (`next dev`, `next build`,
  `bun test`). Un `NODE_ENV=development` hérité du `.env` fait échouer `next build` au
  prérendu (`useContext` sur `null`).
- **URL de service** (`DATABASE_URL`, `REDIS_URL`, `APHRODY_AI_HTTP_URL`,
  `APHRODY_AI_EMBED_BASE_URL`, `SHENRON_API_URL`; noms IA canoniques du contrat
  l'Infra du monorepo, alias hérités retirés, voir [`ENV.md`](ENV.md)) réécrites vers `127.0.0.1` et le port
  du tunnel.
- **`SHENRON_API_URL`** pointe vers le tunnel de `shenron-bot` pour les deux apps, et
  **`SITE_INTERNAL_URL`** vers le `next dev` local (`http://127.0.0.1:3000`) au lieu de
  l'écoute du site en production.
- **`BETTER_AUTH_URL` par app** : `http://localhost:3000` pour le site et
  `http://localhost:5006` pour le bot.

Liste complète des variables et de leurs alias : [`ENV.md`](ENV.md).

Les URL publiques (`NEXT_PUBLIC_*`, `OAUTH_REDIRECT_URI`) restent celles du `.env` racine :
elles doivent correspondre aux origines enregistrées chez Discord et sur le CDN.

Chemins : le générateur n'écrit aucun chemin absolu. Les chemins de données (`DATA_PATH_ENV`
de `@shenron/config/paths` : `RAG_GOLD_PATH`, `A2A_COORD_DIR`, `DATABOOKS_FREEZE_FILE`,
`RAG_LEXIQUE`, `SHENRON_ADMIN_DOCS_DIR`) gardent leur défaut relatif au dépôt, valable sous
Windows comme dans WSL. Pour les surcharger, les exporter dans le shell de chaque côté, jamais
dans le `.env` racine partagé.

Relancer le profil voulu après chaque modification du `.env` racine. Le profil `dev` supprime
les tokens Discord de production ; il n'utilise un token de développement que si la clé
privée `DISCORD_TOKEN_DEV` est définie. Le profil `prod` utilise `DISCORD_TOKEN_PROD`, puis
le nom historique `DISCORD_TOKEN` en repli. Les secrets sont copiés, jamais affichés.

## Next.js : dev et build dans WSL

Sous Windows, Turbopack lance un processus `node` pour PostCSS / Tailwind. Sur ce poste
Bun-only, l'erreur est `spawning node pooled process: program not found`, et
`bunx --bun next` échoue sur les chemins absolus Windows. Le dev et le build du site se font
donc dans le clone WSL `~/src/shenron`, synchronisé par `git pull`.

```bash
# WSL
cd ~/src/shenron && git pull --rebase --autostash origin main && bun install
bun scripts/dev/local-env.ts env
setsid nohup bun scripts/dev/local-env.ts tunnels > var/tunnels.log 2>&1 < /dev/null &
cd apps/site && bun run dev      # ou : bun run build
```

Le bot consomme les versions cataloguées de `discordx`, `@discordx/di` et
`@discordx/pagination` depuis le registre, sans checkout voisin.

Dans WSL, les tunnels doivent être détachés (`setsid nohup`). Sinon ils se ferment en même
temps que la session `wsl.exe` qui les a lancés.

### PostgreSQL et Turbopack sur Windows

Pour une vérification ponctuelle depuis Windows, l'alias SSH local
`dbfr-shenron-pg` ouvre `127.0.0.1:15433` vers PostgreSQL de dbfr. Le
`DATABASE_URL` des fichiers `.env` locaux doit cibler ce port et conserver
`shenron_site` ; lancer `ssh -N dbfr-shenron-pg` avant le build.

Le lecteur manga et databooks est fourni par `@shenron/ui/reader`, sans
checkout `aphrody-ui` nécessaire au build du site.

Le pré-rendu de l'inventaire éditorial interroge PostgreSQL et peut être long.
Sur un poste de développement, augmenter temporairement les workers est sans
incidence sur la limite par défaut du VPS :

```powershell
$env:BUILD_CPUS = '8'
$env:BUILD_STATIC_CONCURRENCY = '16'
bun --filter @shenron/site build
```

Les lectures de fichiers opérateur restent exécutées au runtime et portent le
marqueur `turbopackIgnore`; elles ne sont donc plus ajoutées au traçage de
l'artefact de production.

Le typecheck, les tests et oxlint restent utilisables sous Windows (`bun run type-check`,
`bun test`).

## Tunnels natifs

`tunnels` et `status` utilisent directement `ssh -L` et les ports du catalogue
l'Infra du monorepo. Aucun CLI Aphrody n'est requis dans le checkout Shenron.
