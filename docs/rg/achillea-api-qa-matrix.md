# Matrice QA de l'API Achilléa

État au 25 septembre 2026. L'inventaire des routes déclarées dans le checkout courant se trouve dans [`achillea-api-route-inventory.csv`](./achillea-api-route-inventory.csv) : 94 routes Elysia de l'API unifiée, 170 routes TSed du bot et 21 routes Express du service ranked, soit 285 déclarations. Les routes du bot sont montées sur `/` dans TSed puis relayées sous `/api` par le serveur ranked ; le CSV conserve leur chemin TSed. Le proxy générique `/api/*`, les assets statiques en développement et les routes de plugins chargés dynamiquement ne sont pas des entrées finies dans le CSV. Une route déclarée dans le code ne prouve ni son déploiement ni son bon fonctionnement en production.

## Niveaux de preuve

| Statut | Sens |
| --- | --- |
| `SOURCE_ONLY` | Route trouvée dans le code ; aucun appel authentifié concluant. |
| `PUBLIC_LIVE` | Appel public de production observé ; ne valide pas la session ni les écritures. |
| `AUTH_LIVE` | Appel avec une vraie session Better Auth et résultat vérifié. |
| `BLOCKED_LOCAL_DB` | Test local essayé mais base locale indisponible. |
| `FAIL` | Réponse observée qui contredit le contrat. |

Le CSV donne `SOURCE_ONLY` à chaque route par défaut. Ne promouvoir un statut qu'avec date, environnement, identité de test non sensible, requête expurgée, code HTTP, assertion et référence de trace. Ne jamais stocker un cookie, jeton, secret QR, corps personnel ou clé API.

## Vérifications effectuées

| Surface | Environnement | Résultat | Limite |
| --- | --- | --- | --- |
| `GET /api/ranked/leaderboard?mode=2&page=0&pageSize=3` | `ranked.rosegriffon.fr`, public | HTTP 200, `total=12`, trois entrées observées | Pas de session ; ne prouve pas le filtre Elo ajouté dans le checkout. |
| `GET /v1/achillea/ranked/leaderboard` via `app.handle` | local, `.env` | HTTP 500, `ECONNREFUSED 127.0.0.1:5432` | La base locale n'écoute pas ; test de projection impossible. |
| `bun run test --test-name-pattern ranked` | local, `apps/api` | 6 passent, 2 lectures leaderboard échouent avec 500 | Même panne de connexion DB ; aucune validation authentifiée complète. |
| `bun run type-check` | local, `apps/api` et `packages/achillea-client` | succès | Contrôle statique uniquement. |

## Campagne authentifiée encore requise

1. Préparer des comptes de test distincts : anonyme, joueur, organisateur, modérateur et administrateur, liés à Better Auth. Garder les identifiants hors du dépôt.
2. Exécuter toutes les lectures du CSV en anonyme puis avec joueur ; vérifier la parité des données publiques, la pagination, les filtres, les corps de réponse et les codes 401/403 prévus.
3. Exécuter les écritures uniquement sur des fixtures de test isolées, avec rollback ou nettoyage documenté ; contrôler les transitions tournoi, bracket, scores, classements, wallet, sanctions et notifications en base et dans l'UI.
4. Couvrir les routes propres au bot (Discord, casts, ranked temps réel, administration) avec ses dépendances réelles. Leur déclaration TSed ne signifie pas que l'API unifiée les expose.
5. Rejouer les cinq parcours demandés (`/achillea/tournaments/circuit/ranking`, `/tournaments`, `/ranked`, `/ranked/history`, `/ranked/leaderboard`) en navigateur anonyme et authentifié ; comparer réseau, rendu et données DB, puis consigner chaque preuve.

La campagne n'est pas terminée. L'inventaire sert de checklist route par route et évite de confondre couverture source, tests locaux et validation réelle en session.
