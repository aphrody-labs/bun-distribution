# Parité des lectures Achilléa entre API historique et API RG

Audit en lecture seule du 25 septembre 2026, release observée sur le VPS : `8ac42b2726cb6c636cfe96555adce98eca0823b0`. Les résultats HTTP ci-dessous sont des instantanés, pas une garantie de parité permanente.

## Routage du site actuellement livré

`apps/website/src/lib/achillea/client.ts` choisit `NEXT_PUBLIC_ACHILLEA_API_URL` puis la valeur par défaut de `packages/achillea-client/src/v1/http.ts`, `https://ranked.rosegriffon.fr/api`. La variable n'est pas définie dans `/etc/rose-griffon/website.env` ni dans le `.env.production` de la release consultée. Un chunk client de cette release contient la valeur historique. Le site livré appelle donc cette origine par défaut pour les vues étudiées. `ranked.rosegriffon.fr` reste aussi nécessaire au WebSocket du matchmaking ; ce protocole n'est pas couvert par la migration des lectures REST.

| Vue | Lecture utilisée par le client | API RG équivalente | Observation anonyme |
| --- | --- | --- | --- |
| Circuit `/achillea/tournaments/circuit/ranking` | `GET /tournaments/circuit/ranking` | `GET /v1/achillea/tournaments/circuit/ranking` | 200 des deux côtés ; JSON identique sur le prélèvement |
| Liste `/achillea/tournaments` | `GET /tournaments` | `GET /v1/achillea/tournaments` | 200 des deux côtés ; pagination divergente, voir ci-dessous |
| Accueil `/achillea/ranked` | `GET /ranked/tiers`, `GET /ranked/me` après session | `GET /v1/achillea/ranked/tiers`, `GET /v1/achillea/ranked/me` | tiers 200 et JSON identique ; `me` requiert la session, non comparé ici |
| Historique `/achillea/ranked/history` | `GET /users/me/ranked-history` ou `GET /users/:id/ranked-history` | mêmes suffixes sous `/v1/achillea` | routes présentes dans le code RG ; contenu réel et session non comparés sans identifiant de joueur de test |
| Classement `/achillea/ranked/leaderboard` | `GET /ranked/leaderboard` et `/ranked/tiers` | mêmes suffixes sous `/v1/achillea` | 200 des deux côtés ; JSON identique pour `mode=2&page=0&pageSize=2` et les tiers |

`GET /users/leaderboard?page=1&pageSize=2`, utilisé ailleurs dans Achilléa, répond également 200 avec JSON identique sur les deux origines. Les sommes SHA-256 du JSON normalisé dans PowerShell coïncidaient pour circuit, ranked leaderboard, ranked tiers et users leaderboard lors du prélèvement. Cela confirme ces réponses ponctuelles uniquement.

## Écart de contrat confirmé : liste des tournois

Pour `GET /tournaments?page=1&pageSize=2`, l'API historique répond `meta={page:1,limit:25,total:9,pageCount:1}` ; l'API RG répond `meta={page:1,limit:2,total:9,pageCount:5}`. La première entrée a le même ID (`32`) et les mêmes clés. Le code RG accepte `pageSize` ou `pagination` (maximum 50) dans `apps/api/src/modules/achillea/tournaments/index.ts`. Le client typé expose les deux paramètres. Une bascule d'origine changerait donc la pagination visible si le site passe `pageSize` : vérifier les contrôles et la charge, puis choisir explicitement le comportement voulu. Ne pas confondre une différence de réponse avec une différence de données sources.

## Blocages avant la bascule

1. Comparer tous les champs et la pagination des réponses réelles, sur plusieurs pages et filtres (`organization`, `states`, recherche/Elo), et pas seulement les cinq prélèvements ci-dessus.
2. Tester les lectures personnelles (`/ranked/me`, `/users/me/ranked-history`) en session Better Auth, ainsi que l'historique public d'un utilisateur existant. La présence d'une route ne prouve ni cookie partagé, ni CORS, ni parité des autorisations.
3. Cartographier les mutations consommées par le site. Le contrôleur RG `ranked` expose seulement tiers, leaderboard et me ; défi, matchmaking, litige et autres écritures restent dans le bot. Changer globalement `NEXT_PUBLIC_ACHILLEA_API_URL` casserait ces appels même si les cinq lectures publiques sont compatibles.
4. Migrer les lectures par ressource ou par route et garder le client historique pour les fonctions bot jusqu'à parité complète. Tester les deux origines en navigateur authentifié et anonyme, puis seulement changer la configuration de release.

## Méthode reproductible

Comparer les deux préfixes `https://ranked.rosegriffon.fr/api` et `https://api.rosegriffon.fr/v1/achillea` avec les mêmes chemins et requêtes, sans cookie pour les lectures publiques. Relever code HTTP, clés, longueurs, `meta`, puis des échantillons de données sans publier de données privées. Le code source de référence est `packages/achillea-client/src/v1/{tournaments,ranked,users}.ts` et `apps/api/src/modules/achillea/{tournaments,ranked,users}`.
