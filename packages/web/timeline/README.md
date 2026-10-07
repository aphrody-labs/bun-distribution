<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/timeline

Bibliothèque Bun importable pour collecter une chronologie éditoriale, conserver
ses rangs et sa provenance, puis produire JSON, SQL, SQLite, Redis, GraphQL et
des exemples d'entraînement. Aucun processus enfant, CLI ou serveur ne démarre
à l'import. Le même module se consomme dans un site, un bot, un service ou un
runtime Bun sur Linux, Windows et macOS ; ces trois OS n'ont pas tous été
qualifiés par cette passe.

```ts
import { collect, createTimelineHandler, sqliteExport, redisIndex } from "@aphrody/timeline";

const snapshot = await collect();
sqliteExport(snapshot, "timeline.sqlite");
await redisIndex(snapshot, process.env.REDIS_URL!);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8813,
  fetch: createTimelineHandler(() => snapshot),
});
// L'application propriétaire arrête et attend server.stop() à sa fermeture.
```

`collect(fetcher, source)` accepte les URL de l'application et un transport
injectable. `normalize()` vérifie les totaux, identités, rangs, dates et origines
avant de produire un instantané. Les médias conservent l'ordre éditorial ; les
Âges, y compris négatifs, ont leur ordre propre. Les références imprimées sont
conservées telles quelles.

`refresh(output, options)` matérialise les projections dans un store privé,
appelle éventuellement `options.indexDocuments(directory, snapshot)`, vérifie
GraphQL et les cardinalités Redis, puis publie le pointeur de génération par
renommage atomique. L'application choisit l'indexeur et son domaine ; la
bibliothèque ne lance pas de commande. `load(output)` lit l'instantané courant.

`crawlDetails()` reprend les fiches sources les plus anciennes, avec budget et
délai par requête. Une panne conserve la dernière description disponible et
reste visible dans `crawl-state.json`. Seuls les champs éditoriaux sont ajoutés
aux passages ; les lecteurs vidéo et leur configuration sont exclus.

`query(snapshot, document, variables)` exécute un vrai document GraphQL.
`createTimelineHandler(loader)` fournit `/graphql`, `/timeline.json` et `/health`
à monter dans `Bun.serve`. Le schéma `SDL` et les types sont exportés.

`sqlExport()` produit un import transactionnel compatible PostgreSQL/SQLite ;
`sqliteExport()` l'applique avec `bun:sqlite`. Redis utilise `RedisClient` natif,
un hash d'entrées et deux ensembles triés ; le pointeur courant change après
vérification des compteurs. Les projections Redis expirent après sept jours,
renouvelés à chaque rafraîchissement.

`trainingRows()` sépare train/évaluation par identité stable. Une correction de
texte ne déplace pas une entrée entre les jeux. Cette préparation n'entraîne
aucun modèle et ne prouve pas de gain du modèle Shenron.

Le raccordement aux opérations et au foyer natif existants vit dans
[`@aphrody/workspace`](../../infra/workspace/src/shenron.ts). Le produit peut
consommer directement les exports sans ce raccordement.
