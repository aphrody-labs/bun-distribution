# `@rosegriffon/azalee` — extraction du cœur du wiki en bibliothèque

Note d'architecture. Décrit **pourquoi** le cœur métier d'Azalée a quitté
`apps/azalee`, **ce qui a bougé**, le **contrat client-safe / serveur**, et la voie
**CLI + GUI Tauri sans Next**.

Référence d'usage : [`packages/azalee/README.md`](../packages/azalee/README.md).

## Pourquoi

Toute la logique du wiki (service wiki de ~2 600 lignes, index CPK, index de texte de
jeu, résolution d'URLs CDN, règles de jeu, glossaire FR, recherche floue) vivait dans
`apps/azalee/lib/**` et `apps/azalee/src/lib/**`. Elle y était **prisonnière de Next** :

- `import "server-only"` en tête des modules données — impossible à charger hors RSC ;
- alias `@/…` résolus par le `tsconfig` de l'app uniquement ;
- fraîcheur exprimée par le hint propriétaire `fetch(url, { next: { revalidate } })` ;
- données figées lues par chemin relatif depuis le `cwd` de l'app.

Conséquence : le CLI `azalee` (alors `bin/azalee.ts`) réimplémentait ses propres accès
données, et une application de bureau était hors de portée sans embarquer Next.

L'objectif déclaré — « utiliser cette lib pour la version CLI et GUI Tauri d'azalee
sans Next » — impose un cœur **framework-agnostique**, avec une racine bundlable dans
une webview et une surface serveur qui ne dépend que de Bun.

## Ce qui a bougé

Le paquet npm reprend le nom historique `@rosegriffon/azalee` ; à l'époque de cette
extraction, l'application Next avait été renommée `@rosegriffon/azalee-web` (dossier
`apps/azalee` inchangé). Cette application a depuis été entièrement retirée : le wiki
est fusionné dans `apps/website` (voir [azalee.md](azalee.md)). Le tableau ci-dessous
reste la référence des chemins **d'origine** (`apps/azalee/...`, aujourd'hui disparus)
vers leur destination actuelle dans `packages/azalee`.

| Ancien chemin | Nouveau chemin |
| --- | --- |
| `bin/azalee.ts` | `packages/azalee/src/cli.ts` |
| `apps/azalee/lib/wiki-service.ts` | `packages/azalee/src/wiki/service.ts` |
| `apps/azalee/lib/wiki/{teams,shops,quests,coaches,stadiums,drops,gacha,trophies,invocation,chara-stats,game-text}.ts` | `packages/azalee/src/wiki/*.ts` |
| `apps/azalee/lib/wiki/*-shared.ts` | `packages/azalee/src/wiki/*-shared.ts` |
| `apps/azalee/lib/cpk/{index,materialize,shared,tree}.ts` | `packages/azalee/src/cpk/*.ts` |
| `apps/azalee/lib/game-text/{index,materialize,shared,format}.ts` | `packages/azalee/src/game-text/*.ts` |
| `apps/azalee/lib/cross/{catalog,data,data-shared,assets-shared}.ts` | `packages/azalee/src/cross/*.ts` |
| `apps/azalee/src/lib/images/{index,utils}.ts` | `packages/azalee/src/images/*.ts` |
| `apps/azalee/src/lib/images/utils.test.ts` | `packages/azalee/test/images.test.ts` |
| `apps/azalee/lib/search/**` + `apps/azalee/lib/search-utils.ts` | `packages/azalee/src/search/**` (`search-utils.ts` → `utils.ts`) |
| `apps/azalee/lib/{translations,format-description,japanese-romaji,download-filename,aura-translations}.ts` | `packages/azalee/src/text/*.ts` |
| `apps/azalee/lib/gaiji-shared.ts` | `packages/azalee/src/text/gaiji.ts` |
| `apps/azalee/lib/{formations,gender,roster-resolver,skills-cutin,team-rules,team-types,team-emblem-map}.ts` | `packages/azalee/src/game/*.ts` |
| `apps/azalee/lib/supabase/sqlite-client.ts` | `packages/azalee/src/db/sqlite-client.ts` |
| `apps/azalee/data/*.json` (22 fichiers, dont `cross/`) | `packages/azalee/src/data/**` |
| `apps/azalee/scripts/build-*.ts` (8 générateurs de manifestes) | `packages/azalee/scripts/` |

Modules **créés** par l'extraction, sans équivalent antérieur :

| Nouveau fichier | Rôle |
| --- | --- |
| `src/index.ts` | Racine client-safe (agrège `game`, `images`, `search`, `text` + les types `*-shared`) |
| `src/config.ts` | Résolution des artefacts runtime (`dataDir`, miroir, cache) — remplace les chemins relatifs implicites |
| `src/db/provider.ts` | Point d'injection unique (`setDatabaseProvider`) — remplace l'import direct du client Supabase de l'app |
| `src/db/index.ts` | Surface données agrégée |
| `src/net.ts` | `fetchJson` avec cache TTL de processus — remplace `fetch(url, { next: { revalidate } })` |
| `src/server/index.ts` | Surface serveur agrégée |
| `src/server/serve.ts` | API HTTP headless (41 routes JSON, `Bun.serve`) |
| `scripts/build-standalone.ts` | Compile le CLI en binaire autonome (`bun build --compile`) |
| `types/workspace-shims.d.ts` | Shims de types `@rosegriffon/db` pour le build de publication (TS6059) |
| `test/config.test.ts` | Couverture de la résolution d'artefacts sur les vrais artefacts machine |

Ce qui **reste dans l'app** : tout ce qui est spécifiquement Next ou spécifiquement
web — authentification (`lib/auth*.ts`), Supabase côté requête (`lib/supabase/`),
lecture de sauvegarde wasm (`lib/save-reader.ts`, `lib/nie-*`), utilitaires UI,
composants, routes.

## Le contrat client-safe / serveur

C'est l'invariant qui rend la lib utilisable en webview **et** en sidecar.

- **Racine (`.`)** : types, règles de jeu pures, URLs CDN, glossaire, recherche floue.
  Aucun `bun:sqlite`, aucun `node:fs`, aucun accès réseau au chargement.
- **`/server`** : configuration, couche données, wiki, CPK, texte de jeu, Cross, RAG,
  API HTTP. Runtime Bun (Node ≥ 22 pour la seule lecture SQLite, via `node:sqlite`).
- **Jumeaux `-shared`** : tout module serveur `<x>.ts` qui expose des types ou des
  helpers purs les isole dans `<x>-shared.ts`, ré-exporté par la racine. Un composant
  client importe le `-shared`, jamais le module qui lit le disque.

Sans cet invariant, un bundle navigateur casse à la résolution (`Can't resolve 'fs'`,
`'tls'`) — exactement le symptôme qui avait imposé la règle `server-only` du côté Next.

Le contrat est vérifiable mécaniquement — si la racine tire un module serveur, le
bundle navigateur échoue à la résolution :

```bash
bun build --target=browser packages/azalee/src/index.ts --outdir /tmp/azalee-browser
# Bundled 45 modules in 43ms → index.js 2.66 MB
```

À lancer après toute modification de `src/index.ts` ou d'un module qu'il agrège.

## Comment l'app Next consomme la lib

Deux modes, selon la pureté du module.

**1. Import direct** pour tout ce qui est pur — 94 fichiers de `apps/azalee` importent
la lib. Sous-chemins les plus sollicités : `@rosegriffon/azalee/images` (32 imports),
`@rosegriffon/azalee/cpk/shared` (18), `@rosegriffon/azalee/game/formations` (9),
puis `text/*`, `search/*`, `game/*` et les `wiki/*-shared`. Aucune façade : ces
modules n'ont rien de Next.

**2. Façade `lib/**`** pour tout module serveur. Une façade ne fait que deux choses :
poser la garde `server-only` et garantir l'injection du client de données.

```ts
// apps/azalee/lib/wiki/teams.ts
import "server-only";

import "@/lib/azalee-runtime";

export * from "@rosegriffon/azalee/wiki/teams";
```

```ts
// apps/azalee/lib/cpk/index.ts — pas d'accès DB, donc pas d'injection
import "server-only";

export * from "@rosegriffon/azalee/cpk";
```

L'injection est centralisée dans un module unique, importé par chaque façade — elle
est donc garantie avant le premier accès données, quelle que soit la route :

```ts
// apps/website/src/lib/azalee-runtime.ts
import "server-only";

import { setDatabaseProvider } from "@rosegriffon/azalee/db";
import { createPostgresClient } from "@rosegriffon/db/service";

setDatabaseProvider(createPostgresClient);

export { createPostgresClient };
```

Le client injecté est le client Supabase enveloppé du `Proxy` maison : les tables
`inagle_*` partent sur le miroir SQLite, tout le reste (éditorial, social, `tweets`…)
reste sur PostgREST, avec repli Postgres si le miroir est indisponible. Sémantique
strictement identique à l'avant-extraction : les pages du wiki n'ont pas changé de
comportement, seul le lieu du code a changé.

Sans injection, la lib utilise PostgreSQL si une URL est configurée. Les outils CLI,
tests et sidecars peuvent sélectionner explicitement le miroir SQLite offline.

Façades présentes : `lib/wiki-service.ts`, `lib/wiki/{teams,shops,quests,coaches,stadiums,drops,gacha,trophies,invocation,chara-stats,game-text}.ts`,
`lib/cpk/index.ts`, `lib/game-text/index.ts`, `lib/azalee-runtime.ts`.

## La voie CLI et GUI Tauri, sans Next

```text
                    @rosegriffon/azalee (racine, pur)
                     ┌──────────────┴──────────────┐
              webview Tauri                    app Next (client)
                     │                              │
                     │  fetch http://127.0.0.1:3010 │  RSC
                     ▼                              ▼
        azalee serve (sidecar Bun)          façades lib/** + provider
                     └──────────────┬──────────────┘
                       @rosegriffon/azalee/server
                                    │
                     miroir SQLite · index CPK · index texte
```

**CLI.** `src/cli.ts` (24 commandes, dont `data` et `serve`) n'accède plus aux données par
ses propres chemins : il appelle `resolveMirrorPath()` de la lib, donc la même
résolution que le wiki web. Un binaire autonome se compile via
`bun run --cwd packages/azalee compile` (`bun build --compile`, runtime Bun embarqué,
pas de `node_modules`).

**GUI Tauri.** Le binaire compilé sert de `externalBin` ; le processus Rust le lance
en sidecar (`azalee serve --port 3010`) et la webview parle JSON à
`http://127.0.0.1:3010`. La webview importe en plus la racine de la lib pour tout ce
qui est pur (URLs CDN, formations, glossaire) — pas d'aller-retour HTTP pour calculer
une URL d'image. `GET /health` sert de sonde de démarrage : la matérialisation des
index CPK et texte se fait au premier accès.

Aucun projet Tauri n'existe encore dans le dépôt : la lib et le sidecar sont la
condition préalable, désormais remplie.

## Points ouverts

- `AZALEE_DATA_DIR` / `AZALEE_CACHE_DIR` (et les helpers `resolveDataFile` /
  `getCacheDir` de `src/config.ts`) ne sont pas encore honorés par `src/cpk/index.ts`
  ni `src/game-text/index.ts`, qui conservent leur propre résolution
  (`CPK_INDEX_PATH`, `CPK_CACHE_DIR`, `GAME_TEXT_DATA_DIR`). Unifier sur `config.ts`
  supprimerait ces trois variables.
- Le `wikiService` expose encore plusieurs signatures en `any` héritées de l'app ;
  le typage strict est un chantier indépendant de l'extraction.
- Les artefacts volumineux (miroir, index) restent dans `apps/azalee/data/` : la lib
  les localise, elle ne les possède pas. Une distribution hors monorepo devra les
  fournir via `configureAzalee()` ou les variables d'environnement.
