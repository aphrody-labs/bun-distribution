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
renouvelés à chaque rafraîchissement. Le troisième argument `namespace`, ou
`refresh()` avec `redisNamespace`, isole les pointeurs de plusieurs applications
sur une même instance Redis.

`trainingRows()` sépare train/évaluation par identité stable. Une correction de
texte ne déplace pas une entrée entre les jeux. Ses options `subject`,
`originSourceId` et `content` adaptent les exemples à une autre application.
`refresh()` inclut les fiches collectées dans les passages et dans ces exemples.
Cette préparation n'entraîne aucun modèle et ne prouve pas de gain du modèle Shenron.

`trainingArtifacts(snapshot, options)` produit les entrées LoRA acceptées par
le chargeur existant `aphrody_train.lora.load_examples` :
`prepared/rollouts.jsonl` contient les questions et les réponses avec les rôles
`user`/`model` et leurs parties textuelles ; `gold.jsonl` conserve les identités
d'évaluation. Les cibles d'évaluation utilisent l'API détail, car le contrôle
du trainer retire les fragments des URL et les repères d'Âges partagent une
page. Chaque question commence par l'identité de sa fiche, avant les titres
abrégés tels que « vol. », pour éviter une ambiguïté entre tomes.
`refresh()` écrit aussi `training.json`, qui porte les compteurs et les
SHA-256 des deux fichiers. La validation réelle sur les 716 fiches accepte
655 exemples sans recouvrement avec les 61 cas d'évaluation.

`indexRetrieval(snapshot, options)` alimente l'API RAG Aphrody existante par
upserts idempotents. L'application fournit l'origine REST, le jeton, un espace
`originSourceId` propre et éventuellement les textes enrichis. `requireVectors`
exige l'accusé d'indexation vectorielle pour chaque document. La synchronisation
finale vérifie le nombre exact d'entrées et retire logiquement les anciens
documents du seul espace choisi ; une erreur intermédiaire empêche ce retrait.
Le jeton et les réponses privées ne sont jamais inclus dans les erreurs.

Le raccordement aux opérations et au foyer natif existants vit dans
[`@aphrody/workspace`](../../infra/workspace/src/shenron.ts). Le produit peut
consommer directement les exports sans ce raccordement.
