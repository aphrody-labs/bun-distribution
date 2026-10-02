# Variables d'environnement — référence canonique

Document de référence unique pour les variables lues par le bot, le site et le pipeline.
Les autres documents renvoient ici au lieu de recopier les listes. Les résolveurs cités sont
la source de vérité : en cas d'écart, le code fait foi.

Règles :

- **Aucune valeur de production n'est écrite dans ce dépôt.** Les adresses, ports et secrets
  de production viennent de l'environnement fourni par `aphrody-infra`
  (`config/service-catalog.json`, `EnvironmentFile` opérateur).
- Les défauts codés dans `@shenron/config` ne servent qu'à garder un processus utilisable sans
  environnement (poste de dev, tests). C'est le seul endroit autorisé à les écrire.
- Les `.env` ne sont jamais affichés ni commités. En local, `bun scripts/dev/local-env.ts env`
  dérive un `.env.local` par app (voir [`DEV-LOCAL.md`](DEV-LOCAL.md)).
- Nom canonique d'abord ; les noms historiques restent acceptés en lecture. Quand plusieurs
  noms sont posés, la première valeur non vide dans l'ordre de lecture l'emporte.

## Origines publiques — `@shenron/config/public-urls`

Résolveurs `resolveSiteUrl`, `resolveApiUrl`, `resolveAssetsUrl`, table `PUBLIC_URL_ENV`.
Le miroir `NEXT_PUBLIC_*` est lu en premier : c'est la valeur que Next inscrit dans les bundles
client, serveur et client doivent donc résoudre la même origine.

| Origine | Canonique | Ordre de lecture | Repli |
| --- | --- | --- | --- |
| site | `SHENRON_PUBLIC_SITE_URL` | `NEXT_PUBLIC_SITE_URL`, `SHENRON_PUBLIC_SITE_URL`, `SITE_PUBLIC_URL`, `BETTER_AUTH_URL` | origine publique du site |
| API du bot | `SHENRON_PUBLIC_API_URL` | `NEXT_PUBLIC_SHENRON_API_URL`, `SHENRON_PUBLIC_API_URL`, `API_PUBLIC_URL`, `SHENRON_API_URL` | origine publique de l'API |
| assets / CDN | `SHENRON_PUBLIC_ASSETS_URL` | `NEXT_PUBLIC_SHENRON_ASSETS_URL`, `SHENRON_PUBLIC_ASSETS_URL` | origine de l'API |

`ownImageRemotePatterns(env)` dérive de ces mêmes origines les `images.remotePatterns` de Next
(assets, CDN miroir, médias Discord) ; `assetMirrorUrl` bascule une URL d'asset entre le CDN et
l'API, qui servent le même arbre `/assets/**`.

## Services internes — `@shenron/config/services`

Résolveurs `resolveRedisUrl`, `resolveSiteInternalUrl`, `resolveBotApiInternalUrl`,
`resolveLibreTranslateUrl`, `resolveRelectureOcrUrl`, table `INTERNAL_SERVICE_ENV`. Les défauts
sont des adresses de boucle locale pour le dev ; en production, l'environnement les fournit.

| Service | Ordre de lecture |
| --- | --- |
| Redis / Valkey | `REDIS_URL`, `VALKEY_URL` |
| Site interne (appels bot → site) | `SITE_INTERNAL_URL` |
| API du bot (bind et appels internes) | `API_HOST` + `API_PORT` |
| LibreTranslate | `LIBRETRANSLATE_URL` (clé : `LIBRETRANSLATE_API_KEY`) |
| Sidecar de relecture OCR | `RELECTURE_OCR_URL` |

Le rate limit d'authentification du site (`apps/site/src/lib/auth-rate-limit.ts`) utilise
`REDIS_URL` s'il est posé et se replie sur un stockage en mémoire sinon ; il n'a pas d'URL par
défaut.

## Alias de secrets et de chemins — `@shenron/config/env`, `@shenron/config/paths`

`ENV_ALIASES` : paires qui doivent porter la même valeur quand les deux sont posées
(`checkAlias` signale l'écart en nommant les variables, jamais les valeurs).

| Rôle | Canonique | Historique |
| --- | --- | --- |
| Jeton admin de l'API | `SHENRON_ADMIN_TOKEN` | `API_ADMIN_TOKEN` |
| Secret d'utilisateur agissant | `SHENRON_USER_SECRET` | `API_USER_SECRET` |
| Boîtes A2A `.coord` | `A2A_COORD_DIR` | `COORD_DIR` |
| Jeu gold RAG | `RAG_GOLD_PATH` | `RAG_GOLD` |

`DATA_PATH_ENV` (chemins de données inscriptibles, défaut relatif au dépôt) : `RAG_GOLD_PATH`,
`SHENRON_ADMIN_DOCS_DIR`, `A2A_COORD_DIR`, `DATABOOKS_FREEZE_FILE`, `RAG_LEXIQUE`. En production,
un chemin encore issu du défaut est signalé une fois par processus.

## Base de données — `@shenron/db`

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | PostgreSQL `shenron_site`, schéma `postgres://` ou `postgresql://` obligatoire (`resolveDatabaseUrl`). |
| `SITE_BUILD_DATABASE_URL` | Base de lecture du build d'artefact du site (`bun run site:artifact`). |
| `DATABASE_PATH` | Fichier SQLite du bot (runtime + réplica wiki). |

## Authentification — `@shenron/auth`

| Variable | Rôle |
| --- | --- |
| `BETTER_AUTH_SECRET` | Secret Better Auth, lu par `resolveBetterAuthSecret` ; repli `SESSION_SECRET`. Obligatoire en production, une valeur trop courte est refusée. |
| `BETTER_AUTH_URL` | Base URL Better Auth de l'app (aussi dernier repli de l'origine du site). |
| `SHENRON_ADMIN_TOKEN` | Jeton d'administration maître. Utilisable via le formulaire `/admin-access` (POST, jamais dans une URL), `Authorization: Bearer <token>`, `x-admin-token` ou le cookie HMAC signé `dbfr_admin` (30 jours après connexion durable). `aphrody shenron auth url` n'affiche que l'URL du formulaire. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_ALLOWED_USERS` | OAuth Discord. |
| `AgentKey` (table PG) | Jetons d'agents autonomes (`dbfr_agent_...`) avec portées explicites (`moderate`, `write:articles`, etc.) acceptés par le proxy et `getCurrentUser()`. |


## IA Aphrody — `@shenron/pipeline/ai/config` (contrat `aphrody-infra`)

Les noms suivent le contrat IA local v1 d'`aphrody-infra` :
[`config/local-ai.json`](../../config/local-ai.json)
(noms canoniques, alias hérités, forme d'URL de chaque alias, index `shenron-rag` et valeurs
de la cible `vps`). Le résolveur unique est `@shenron/pipeline/ai/config` (table `AI_ENV`) : bot,
site, façades `@shenron/pipeline/aphrody`, pipeline et scripts passent tous par lui. Il lit le nom
canonique d'abord, puis chaque alias dans l'ordre du contrat ; un alias de forme `origin`
reçoit `/v1`, un alias de forme `endpoint` perd son chemin d'opération. **Aucune adresse par
défaut** : sans valeur, la capacité est désactivée, et un appel explicite (client de calcul,
scripts) échoue avec une erreur qui nomme les variables, jamais leurs valeurs. Toutes les URL
doivent être en HTTP sur une adresse de boucle locale. Le test
`packages/pipeline/test/ai/config.test.ts` vérifie la parité avec le contrat quand le dépôt voisin
`aphrody-infra` est présent.

| Rôle | Canonique | Alias lus ensuite (forme) | Défaut |
| --- | --- | --- | --- |
| Origine d'`aphrody-ai-http` (RAG, LLM, OCR, vision) | `APHRODY_AI_HTTP_URL` | `APHRODY_SHENRON_API_URL` (origin) | aucun |
| Jeton bearer d'`aphrody-ai-http` | `APHRODY_AI_HTTP_TOKEN` | `APHRODY_SHENRON_API_TOKEN` | aucun |
| Modèle de chat envoyé à `/llm/chat` | `APHRODY_AI_CHAT_MODEL` | `APHRODY_LLM_MODEL`, `APHRODY_SHENRON_LLM_MODEL` | `gemini-web/flash` |
| Modèle de relecture visuelle (`/vision/structured`) | `APHRODY_AI_VISION_MODEL` | `APHRODY_SHENRON_VISION_MODEL` | `gemini-web/flash` |
| Embedder E5 direct (`/v1/embeddings`) | `APHRODY_AI_EMBED_BASE_URL` (base) | `APHRODY_SHENRON_EMBED_BASE_URL` (base), `EMBED_URL` (origin), `APHRODY_RAG_EMBED_ENDPOINT` (endpoint) | aucun (recherche lexicale) |
| Modèle d'embedding | `APHRODY_AI_EMBED_MODEL` | `APHRODY_SHENRON_EMBED_MODEL`, `APHRODY_RAG_EMBED_MODEL` | `Xenova/multilingual-e5-small` |
| Dimensions d'embedding | `APHRODY_AI_EMBED_DIMENSIONS` | `APHRODY_RAG_EMBED_DIM` | `384` |
| Reranker (optionnel) | `APHRODY_AI_RERANK_BASE_URL` (base, dialecte llama-server) | `RERANK_URL` (endpoint, dialecte sidecar Shenron `{query, passages}`), `APHRODY_RAG_RERANK_ENDPOINT` (endpoint, llama-server) | désactivé |
| Modèle du reranker | `APHRODY_AI_RERANK_MODEL` | `APHRODY_RAG_RERANK_MODEL` | aucun |

**Espace d'embedding (règle `never-mix-spaces`).** Le modèle et la dimension configurés sont
comparés à l'index au démarrage du bot (`assertRagEmbeddingSpace`) et avant toute écriture de
vecteurs par les scripts (`requireScriptEmbeddingSpace`) : l'index `shenron-rag` du contrat
(`Xenova/multilingual-e5-small`, q8, 384 dimensions) en mode `RAG_BACKEND=aphrody`, la ligne
`rag_meta` de l'index SQLite sinon. Un écart est une erreur fatale : le bot refuse de démarrer,
le script s'arrête avant d'écrire. Changer d'espace impose une réindexation.

Non lus par Shenron : `APHRODY_AI_CHAT_BASE_URL` et `APHRODY_AI_VISION_BASE_URL` (la génération
et la vision passent par `aphrody-ai-http`, jamais directement par un serveur de modèle).

Autres variables Aphrody :

| Variable | Rôle |
| --- | --- |
| `RAG_BACKEND` | `aphrody` (égalité exacte) : recherche, contexte et statistiques RAG par `aphrody-ai-http`. |
| `EMBED_TIMEOUT_MS`, `RERANK_TIMEOUT_MS`, `RAG_RERANK` | Délai du chemin chaud d'embedding, délai du reranker, `RAG_RERANK=0` coupe le rerank. |
| `APHRODY_WEB_API_URL`, `APHRODY_BXC_API_TOKEN` | API web/crawl d'Aphrody. |
| `APHRODY_BIN` | Chemin du CLI `aphrody` quand il n'est pas sur le `PATH`. |

## Bot Discord — `apps/bot/src/lib/env.ts`

Validées par zod ; un identifiant absent désactive la fonctionnalité concernée. Modèle commenté :
`apps/bot/.env.example`.

- Discord : `DISCORD_TOKEN_SHENRON` (repli `DISCORD_TOKEN`), `APPLICATION_ID_SHENRON`
  (repli `APPLICATION_ID`), `DISCORD_PUBLIC_KEY`, `GUILD_ID`, `OWNER_ID` / `OWNER_IDS`,
  `BOT_DEV_ID`. Les variantes `*_BEERUS`, `*_WHIS`, `*_GRAND_PRETRE`, `*_ENMA`, `*_KAIO` sont
  des alias de compatibilité : elles ne créent aucun client.
- Salons et rôles : `*_CHANNEL_ID`, `JAIL_ROLE_ID`, `URL_IN_BIO_ROLE_ID`,
  `TICKET_CATEGORY_ID`, `VOCAL_TEMPO_HUB_ID`, `SERVER_INVITE_URL`.
- API : `API_ENABLED`, `API_HOST`, `API_PORT`, `API_ADMIN_TOKEN`, `API_USER_SECRET`.
- Traduction : `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY`, `LINGVA_INSTANCE`.
- Divers : `LOG_LEVEL`, `NODE_ENV`.

## Développement local

`scripts/dev/local-env.ts` réécrit les URL de service (`DATABASE_URL`, `REDIS_URL`,
`APHRODY_AI_HTTP_URL`, `APHRODY_AI_EMBED_BASE_URL`, `SHENRON_API_URL`) vers les tunnels
locaux, recopie le jeton sous `APHRODY_AI_HTTP_TOKEN`, retire les alias IA hérités qu'il
remplace et `NODE_ENV`. Détail : [`DEV-LOCAL.md`](DEV-LOCAL.md).

## Profils dev / prod

Le switch de bout en bout est généré sans modifier le `.env` racine :

- `bun run env:dev` cible PostgreSQL `shenron_site` local (`127.0.0.1:5432`), le clone Redis
  Shenron (`127.0.0.1:16379`), les ports locaux du bot/site et les callbacks OAuth locaux.
  Les tokens Discord sont supprimés par défaut ; `DISCORD_TOKEN_DEV` est requis pour lancer
  volontairement un bot de développement.
- `bun run env:prod` conserve les endpoints publics, l'URL PostgreSQL et Redis de production,
  les callbacks OAuth publics et utilise `DISCORD_TOKEN_PROD` (repli contrôlé sur
  `DISCORD_TOKEN`).

Les deux commandes écrivent uniquement les fichiers ignorés `apps/site/.env.local` et
`apps/bot/.env.local`. `NODE_ENV` reste fixé par la commande (`next dev`, `next build` ou
`bun test`). Nginx garde une seule route par profil : le vhost local loopback est fourni par
la configuration locale, tandis que les routes de production restent gérées par
`aphrody-infra`.
