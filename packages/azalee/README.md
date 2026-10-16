# @rosegriffon/azalee

Bibliothèque Bun du wiki **Azalée** (Inazuma Eleven: Victory Road) : le cœur métier
de l'encyclopédie, extrait de l'application Next et utilisable **sans aucun framework**.

Un seul socle de données alimente les cibles actives :

| Cible                                 | Ce qu'elle importe                                              |
| ------------------------------------- | --------------------------------------------------------------- |
| Wiki web (`apps/rg-website`, Next 16) | la lib entière, derrière des façades `server-only`              |
| CLI `azalee` (`src/cli.ts`)           | la surface serveur, en Bun pur                                  |
| GUI Tauri (sidecar Bun + webview)     | la racine client-safe côté webview, `azalee serve` côté sidecar |

Avant l'extraction, toute cette logique vivait dans `apps/azalee/lib/**` : elle était
inaccessible hors de Next (`server-only`, `@/…`, `next/…`, `fetch({ next })`). La lib
supprime cette dépendance — voir la note d'architecture [`azalee-lib.md`](../../../docs/rg/azalee-lib.md).

## Installation

Dans le monorepo, c'est une dépendance workspace :

```jsonc
// apps/<app>/package.json
{
  "dependencies": {
    "@rosegriffon/azalee": "workspace:*",
  },
}
```

Hors monorepo (registre GitHub Packages, cf. `publishConfig`) :

```bash
bun add @rosegriffon/azalee
```

Runtime requis : **Bun ≥ 1.3.14** (`engines`). Node ≥ 22 fonctionne pour la couche
données (repli `node:sqlite`), mais le CLI et `createAzaleeServer` sont Bun-only.

## Deux surfaces : racine client-safe et `/server`

C'est le contrat structurant du package.

### Racine — client-safe

`@rosegriffon/azalee` ne contient **que** du code pur : types, règles de jeu,
résolution d'URLs CDN, glossaire de traduction FR, recherche floue. Aucun
`bun:sqlite`, aucun `node:fs`, aucun accès réseau au chargement. Elle se bundle
donc dans une webview Tauri, un navigateur ou un worker.

```ts
import {
  FORMATIONS,
  translateEffect,
  getCharacterFaceUrl,
  getCharacterModelFullGlbUrl,
} from "@rosegriffon/azalee";

FORMATIONS.length; // 8 layouts legacy (les formations du jeu viennent de PostgreSQL)
translateEffect("Shot AT +10%"); // "Tir ATT +10%"
getCharacterFaceUrl("c01000010");
// https://cdn.rosegriffon.fr/dx11/menu/icon_chr/face/c01000010_l_c01000010_1_l00.png
getCharacterModelFullGlbUrl("c01000010");
// https://cdn.rosegriffon.fr/model-full/c01000010.glb?v=5
```

La racine ré-exporte aussi les modules `*-shared` des couches serveur (types +
helpers purs) : `cpk/shared`, `cross/assets-shared`, `cross/data-shared`,
`game-text/format`, `game-text/shared`, et `wiki/{chara-stats,drops,gacha,game-text,invocation,shops,teams,trophies}-shared`.
Un composant client peut ainsi typer et afficher une donnée sans jamais importer
le module qui la lit.

### `/server` — accès données réel

`@rosegriffon/azalee/server` ouvre le miroir SQLite, matérialise les index CPK et
texte, et expose l'API HTTP headless. Runtime Bun (ou Node ≥ 22).

```ts
import { wikiService, resolveMirrorPath, resolveDataDir } from "@rosegriffon/azalee/server";

resolveMirrorPath(); // <iecode>/var/mirror.sqlite
resolveDataDir(); // <aphrody>/apps/rg-website/data

const { data, total } = await wikiService.getCharactersList({ q: "Mark", page: 1, limit: 2 });
total; // 5130 personnages au total dans le miroir courant
data[0]?.slug; // "mark-evans-0x3055CF22"
data[0]?.names.fr; // "Mark Evans"
```

Les listes du wiki renvoient toutes la même enveloppe `{ data, total, page, limit }`.

```ts
import { getTeamsList, getTeamDetail } from "@rosegriffon/azalee/wiki/teams";
import { listDirPaged, searchFiles, totalFiles } from "@rosegriffon/azalee/cpk";
import { searchText, categoryStats } from "@rosegriffon/azalee/game-text";

totalFiles(); // 250800 fichiers indexés dans les CPK
listDirPaged("data/dx11/menu", 50, 0); // pagination d'un dossier CPK
searchText("Raimon", "fr", 20); // index de texte de jeu (fr/en/ja)
```

## Sous-chemins d'export

Table exacte du champ `exports` de `package.json`.

| Sous-chemin                        | Cible                    | Nature                                                                                                                                                                         |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@rosegriffon/azalee`              | `src/index.ts`           | **client-safe** — jeu, images, recherche, texte, types `*-shared`                                                                                                              |
| `@rosegriffon/azalee/images`       | `src/images/index.ts`    | client-safe — résolution d'URLs CDN (visages, modèles, icônes, vidéos)                                                                                                         |
| `@rosegriffon/azalee/search`       | `src/search/index.ts`    | client-safe — fuzzy match + recherche intelligente                                                                                                                             |
| `@rosegriffon/azalee/search/*`     | `src/search/*.ts`        | client-safe — `utils`, `fuzzy-match`, `smart-search`, `search-ui-config`                                                                                                       |
| `@rosegriffon/azalee/text`         | `src/text/index.ts`      | client-safe — glossaire FR, descriptions, romaji, gaiji                                                                                                                        |
| `@rosegriffon/azalee/text/*`       | `src/text/*.ts`          | client-safe — `translations`, `format-description`, `japanese-romaji`, `download-filename`, `aura-translations`, `gaiji`                                                       |
| `@rosegriffon/azalee/game`         | `src/game/index.ts`      | client-safe — ré-export canonique depuis `@rosegriffon/inagle/game`                                                                                                            |
| `@rosegriffon/azalee/game/*`       | `src/game/*.ts`          | client-safe — `formations`, `team-rules`, `team-types`, `skills-cutin`, … (depuis inagle)                                                                                      |
| `@rosegriffon/azalee/news`         | `src/news/index.ts`      | client-safe — éditorial, articles, changelogs, flux RSS/Atom (`@rosegriffon/website`)                                                                                          |
| `@rosegriffon/azalee/news/*`       | `src/news/*.ts`          | client-safe — `Article`, `NewsPost`, `NewsCategory`, `TagCloudItem`, `FeedItem`                                                                                                |
| `@rosegriffon/azalee/bot`          | `src/bot/index.ts`       | client-safe — Discord bot, webhooks d'alerte, slash commands et automatisations                                                                                                |
| `@rosegriffon/azalee/bot/*`        | `src/bot/*.ts`           | client-safe — `BotCommand`, `BotEmbed`, `BotNotification`, `DiscordWebhookPayload`                                                                                             |
| `@rosegriffon/azalee/remote`       | `src/remote/index.ts`    | **client-safe** — client HTTP typé de l'API (41 routes), erreurs typées, sonde `/health`                                                                                       |
| `@rosegriffon/azalee/remote/*`     | `src/remote/*.ts`        | client-safe — `client`, `transport`, `errors`, `types`                                                                                                                         |
| `@rosegriffon/azalee/config`       | `src/config.ts`          | serveur — résolution des artefacts runtime                                                                                                                                     |
| `@rosegriffon/azalee/db`           | `src/db/index.ts`        | serveur — client SQLite + injection de fournisseur                                                                                                                             |
| `@rosegriffon/azalee/db/*`         | `src/db/*.ts`            | serveur — `provider`, `sqlite-client`                                                                                                                                          |
| `@rosegriffon/azalee/wiki`         | `src/wiki/index.ts`      | serveur — toutes les sections du wiki                                                                                                                                          |
| `@rosegriffon/azalee/wiki/*`       | `src/wiki/*.ts`          | serveur (ou client pour les `*-shared`) — `service`, `teams`, `shops`, `quests`, `coaches`, `stadiums`, `drops`, `gacha`, `trophies`, `invocation`, `chara-stats`, `game-text` |
| `@rosegriffon/azalee/cpk`          | `src/cpk/index.ts`       | serveur — index des 250 800 fichiers CPK                                                                                                                                       |
| `@rosegriffon/azalee/cpk/*`        | `src/cpk/*.ts`           | serveur / client (`shared`, `tree`)                                                                                                                                            |
| `@rosegriffon/azalee/game-text`    | `src/game-text/index.ts` | serveur — index du texte de jeu                                                                                                                                                |
| `@rosegriffon/azalee/game-text/*`  | `src/game-text/*.ts`     | serveur / client (`shared`, `format`)                                                                                                                                          |
| `@rosegriffon/azalee/cross`        | `src/cross/index.ts`     | serveur — Inazuma Eleven Cross (Unity/Addressables)                                                                                                                            |
| `@rosegriffon/azalee/cross/*`      | `src/cross/*.ts`         | serveur / client (`data-shared`, `assets-shared`)                                                                                                                              |
| `@rosegriffon/azalee/server`       | `src/server/index.ts`    | serveur — surface agrégée + API HTTP + résolution de source                                                                                                                    |
| `@rosegriffon/azalee/server/*`     | `src/server/*.ts`        | serveur — `serve`, `source`                                                                                                                                                    |
| `@rosegriffon/azalee/package.json` | `package.json`           | métadonnées                                                                                                                                                                    |

Règle : un fichier `<x>.ts` qui touche `bun:sqlite`/`node:fs` a toujours son
jumeau pur `<x>-shared.ts`. **Ce sont les `-shared` qu'un composant client importe.**

`src/net.ts` (récupération HTTP avec cache TTL de processus) est interne : il n'est
pas exporté, seulement consommé par `wiki/chara-stats` et `wiki/invocation`.

## Accès aux données

La lib distingue deux familles de données.

1. **Projections SQL** — PostgreSQL porte les formations, cut-ins, passifs,
   manifestes d'assets et données métier. Les clients qui en ont besoin utilisent
   uniquement les projections typées du package Inagle.
2. **Artefacts volumineux** — miroir SQLite de compatibilité pour les outils offline.
   Les textes et l’index CPK sont importés dans PostgreSQL et ne sont plus matérialisés
   en fichiers locaux.

Dans l'arborescence Aphrody, les artefacts web vivent sous `apps/rg-website/data/` :

```text
apps/rg-website/data/
├── backups/mirror.sqlite            # fallback local ; la prod lit le miroir niers
└── backups/mirror.sqlite            # miroir local de développement uniquement
```

### Variables d'environnement

| Variable                      | Lue par               | Effet                                                                                                                                                                                                      |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_DB_PATH`              | `src/config.ts`       | Chemin explicite du miroir SQLite. **Épinglé en production** (drop-in systemd) : sans lui, le repli essaie le miroir canonique niers puis, à défaut, le snapshot `supabase-*.sqlite` au nom le plus grand. |
| `NIERS_MIRROR`                | `src/config.ts`       | Chemin du miroir canonique niers utilisé par le fallback CLI/tests quand `SQLITE_DB_PATH` n'est pas défini.                                                                                                |
| `AZALEE_DATA_DIR`             | `src/config.ts`       | Dossier des artefacts runtime, testé avant les chemins conventionnels (`<cwd>/data`, `<cwd>/apps/rg-website/data`, `<pkg>/../../../apps/rg-website/data`).                                                 |
| `AZALEE_PORT` / `AZALEE_HOST` | `src/server/serve.ts` | Défauts de l'API headless (`3010` / `127.0.0.1`).                                                                                                                                                          |
| `DATABASE_URL`                | `src/cli.ts`          | PostgreSQL pour les commandes CLI qui ne passent pas par le miroir (`db`, `data push`…).                                                                                                                   |
| `DATA_ROOT` / `DATA_PATH`     | `src/cli.ts`          | Racine du dump de jeu pour `azalee data` (défaut `<iecode>/data`).                                                                                                                                         |

Note : `AZALEE_DATA_DIR` couvre uniquement la découverte du miroir local de développement ;
les modules `cpk` et `game-text` interrogent directement les projections PostgreSQL.

### Configuration explicite

Priorité maximale, au démarrage de l'hôte ou du CLI :

```ts
import { configureAzalee, getAzaleeConfig, resetAzaleeConfig } from "@rosegriffon/azalee/config";

configureAzalee({
  dataDir: "/srv/azalee/data",
  mirrorPath: "/srv/azalee/data/backups/mirror.sqlite",
  cacheDir: "/var/cache/azalee",
});
```

### Injection du client de données

Par défaut, la lib utilise PostgreSQL quand `DATABASE_URL` est disponible. Une
application hôte peut injecter son propre client SQL ; le miroir SQLite est
réservé aux tests, à l'extraction et au mode offline explicitement demandé.

```ts
import { setDatabaseProvider, hasDatabaseProvider } from "@rosegriffon/azalee/db";
import { createPostgresClient } from "@rosegriffon/db/service";

setDatabaseProvider(createPostgresClient);
hasDatabaseProvider(); // true
setDatabaseProvider(null); // retour à la fabrique PostgreSQL par défaut
```

Les modules `wiki/*` n'utilisent que la surface SQL `.from(table).select(...)` ;
le miroir SQLite reste une option explicite pour l'extraction et l'offline.

## API HTTP headless

Même socle de données que le wiki web, exposé en JSON pur, sans Next.
`handleAzaleeRequest` est une fonction `Request → Response` embarquable dans
n'importe quel routeur ; `createAzaleeServer` l'attache à `Bun.serve`.

```bash
bun packages/rg-azalee/src/cli.ts serve --port 3010
# azalee serve url=http://127.0.0.1:3010 routes=41

bun packages/rg-azalee/src/cli.ts serve --json   # table de routage en JSON, puis quitte
```

Options : `-p, --port` (défaut `3010`), `-H, --host` (défaut `127.0.0.1`),
`--cors <origin>` (défaut `*`), `-j, --json`.

```ts
import { createAzaleeServer, handleAzaleeRequest } from "@rosegriffon/azalee/server";

const server = createAzaleeServer({ port: 3010, hostname: "127.0.0.1", cors: true });
console.log(server.url.href);

// ou, dans un routeur existant :
const response = await handleAzaleeRequest(new Request("http://x/api/teams"));
```

Seuls `GET` et `OPTIONS` sont acceptés (405 sinon). Une entité absente renvoie 404
avec `{ "error": "<quoi> introuvable" }` ; une route inconnue renvoie 404 avec la
table de routage complète.

### Routes (41)

| Route                       | Contenu                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /`                     | Nom du package + table de routage                                                                                       |
| `GET /health`               | `{ ok, mirror, dataDir, cpkFiles }` — sonde de démarrage du sidecar                                                     |
| `GET /api/characters`       | Liste paginée (`q`, `element`, `position`, `rarity`, `team`, `series`, `gender`, `playstyle`, `sort`, `page`, `limit`…) |
| `GET /api/characters/:slug` | Fiche personnage complète                                                                                               |
| `GET /api/coordinators`     | Coachs et managers jouables                                                                                             |
| `GET /api/skills`           | Liste des techniques                                                                                                    |
| `GET /api/skills/:id`       | Détail d'une technique                                                                                                  |
| `GET /api/items`            | Liste des objets                                                                                                        |
| `GET /api/items/:id`        | Détail d'un objet                                                                                                       |
| `GET /api/auras/:type`      | Liste d'auras d'un type (keshin, soul, awakening, miximax, mode change…)                                                |
| `GET /api/auras/:type/:id`  | Détail d'une aura                                                                                                       |
| `GET /api/tactics`          | Liste des tactiques                                                                                                     |
| `GET /api/tactics/:slug`    | Détail d'une tactique                                                                                                   |
| `GET /api/teams`            | Les 208 équipes (emblème, saisons)                                                                                      |
| `GET /api/teams/:id`        | Effectif, uniformes, détail d'équipe                                                                                    |
| `GET /api/shops`            | Liste des boutiques                                                                                                     |
| `GET /api/shops/:id`        | Inventaire d'une boutique (`id` numérique)                                                                              |
| `GET /api/quests`           | Quêtes (`q`, `kind`)                                                                                                    |
| `GET /api/quests/:id`       | Détail d'une quête                                                                                                      |
| `GET /api/coaches`          | Coachs (`q`)                                                                                                            |
| `GET /api/coaches/:id`      | Détail d'un coach (`id` numérique)                                                                                      |
| `GET /api/stadiums`         | Les 81 stades (`q`)                                                                                                     |
| `GET /api/stadiums/:id`     | Détail d'un stade                                                                                                       |
| `GET /api/trophies`         | Succès/trophées (`q`, `category`)                                                                                       |
| `GET /api/trophies/:id`     | Détail d'un succès                                                                                                      |
| `GET /api/passives`         | Passives (`q`, `category`, `page`, `limit` ≤ 500)                                                                       |
| `GET /api/passives/:id`     | Détail d'une passive                                                                                                    |
| `GET /api/gallery`          | Illustrations (`category`, `q`, `page`, `limit` ≤ 300)                                                                  |
| `GET /api/drops`            | Taux de drop                                                                                                            |
| `GET /api/capsules`         | Capsules gacha (`q`)                                                                                                    |
| `GET /api/costumes`         | Costumes (`q`)                                                                                                          |
| `GET /api/invocation`       | Taux d'invocation par signe                                                                                             |
| `GET /api/cpk`              | Listing paginé d'un dossier CPK (`path`, `limit` ≤ 1000, `offset`)                                                      |
| `GET /api/cpk/search`       | Recherche de fichiers CPK (`q`, `limit` ≤ 1000)                                                                         |
| `GET /api/cpk/file`         | Métadonnées d'un fichier (`path`) + URL CDN décodée                                                                     |
| `GET /api/text`             | Recherche dans le texte de jeu (`q`, `locale`, `limit` ≤ 500)                                                           |
| `GET /api/text/:hash`       | Résolution d'un `hashId` dans les 3 langues                                                                             |
| `GET /api/text/stats`       | Décompte par catégorie de texte                                                                                         |
| `GET /api/cross/tables`     | Tables masterdata d'Inazuma Eleven Cross                                                                                |
| `GET /api/cross/stats`      | Statistiques du catalogue Addressables Cross                                                                            |
| `GET /api/search`           | Recherche transverse : personnages + techniques + objets (`q` ≥ 2, `limit` ≤ 50)                                        |

```bash
curl -s localhost:3010/health
# {"ok":true,"mirror":"…/data/backups/mirror.sqlite","dataDir":"…/apps/azalee/data","cpkFiles":250800}

curl -s "localhost:3010/api/characters?q=Mark&limit=2"
```

### Intégration Tauri (sidecar Bun)

Le CLI se compile en binaire autonome embarquant le runtime Bun : il tourne sans
`node_modules`, ce qui en fait le sidecar naturel d'une application Tauri.

```bash
bun run --cwd packages/rg-azalee compile          # → packages/rg-azalee/bin/azalee
bun packages/rg-azalee/scripts/build-standalone.ts --install   # + copie dans ~/.local/bin
```

Côté application (patron Tauri v2 — pas encore de projet Tauri dans ce dépôt) :

```jsonc
// tauri.conf.json — Tauri suffixe le binaire par le triplet cible
{ "bundle": { "externalBin": ["bin/azalee"] } }
```

```rust
use tauri_plugin_shell::ShellExt;

let sidecar = app.shell().sidecar("azalee")?.args(["serve", "--port", "3010"]);
let (_rx, _child) = sidecar.spawn()?;
```

```ts
// webview : la logique pure vient du bundle, les données du sidecar
import { getCharacterFaceUrl, translateEffect } from "@rosegriffon/azalee";

const res = await fetch("http://127.0.0.1:3010/api/characters?q=Mark&limit=24");
const { data } = await res.json();
```

Attendre `GET /health` avant le premier appel : la matérialisation des index CPK
et texte se fait au premier accès.

Recette complète et vérifiée (compilation du sidecar, `externalBin`, CSP,
capacités, cycle de vie, mode dégradé) : [`docs/azalee-tauri.md`](../../docs/azalee-tauri.md).

## Client distant et repli automatique

Les mêmes 41 routes sont accessibles par un **client HTTP typé, client-safe**
(`bun build --target=browser` : 4 modules, 12,2 Ko) : c'est ce qu'importe une
webview Tauri, ou le CLI d'une machine sans miroir SQLite ni dump du jeu.

```ts
import { createAzaleeClient, isAzaleeNotFound } from "@rosegriffon/azalee/remote";

// Défaut : AZALEE_API_URL, sinon https://api.rosegriffon.fr/azalee
const api = createAzaleeClient();
const { data, total } = await api.characters({ q: "Mark", limit: 24 });
```

Les réponses sont typées **à partir des fonctions serveur** qui les produisent
(`Awaited<ReturnType<typeof wikiService.getCharactersList>>`…) : le client ne
peut pas dériver du serveur. Délai d'attente 15 s, `AbortSignal`, reprise des
échecs transitoires (`408`/`425`/`429`/`5xx`, réseau, `Retry-After` honoré) et
erreurs typées `AzaleeRemoteError` (`kind`, `status`, `url`, `detail`).

Côté serveur, `createAzaleeData` choisit seul la source :

```ts
import { createAzaleeData } from "@rosegriffon/azalee/server";

const data = createAzaleeData(); // "auto"
console.log(data.source, "|", data.reason);
// local | source locale retenue : miroir SQLite présent (…/niers/var/mirror.sqlite)

const teams = await data.teams(); // 208 — depuis le disque, zéro socket
```

| Mode            | Comportement                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `auto` (défaut) | local si le miroir (ou un client injecté) est là, sinon distant ; bascule à chaud si une lecture locale échoue |
| `local`         | `handleAzaleeRequest` en appel direct — aucun socket                                                           |
| `remote`        | `fetch` vers `baseUrl`                                                                                         |

Le mode local passe par le **même** routeur que l'API HTTP : aucune logique de
lecture n'est dupliquée entre les deux sources. Un `404` ne déclenche jamais de
repli — c'est une réponse, pas une panne.

Dans une webview, où `createAzaleeData` (serveur) n'est pas importable,
`resolveAzaleeBaseUrl` joue le même rôle en HTTP pur :

```ts
import { AZALEE_DEFAULT_API_URL, resolveAzaleeBaseUrl } from "@rosegriffon/azalee/remote";

const picked = await resolveAzaleeBaseUrl(["http://127.0.0.1:3010", AZALEE_DEFAULT_API_URL], {
  requireLocalData: true, // écarte un sidecar dont /health renvoie mirror:null
});
```

## CLI `azalee`

```bash
bun packages/rg-azalee/src/cli.ts <commande>      # depuis la racine du dépôt
bun run --cwd packages/rg-azalee cli <commande>   # via le script du package
bun --filter @rosegriffon/azalee cli          # via le filtre workspace
```

Le champ `bin` déclare `azalee` → `src/cli.ts` ; `publishConfig` le bascule sur
`dist/cli.js` pour la version publiée. Commandes :

| Commande                    | Rôle                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `translate [texte]`         | Traduit en français via le glossaire consolidé                 |
| `search [requête]`          | Fuzzy search sur toutes les entités du jeu                     |
| `db [sql]`                  | Requête SQL (PostgreSQL par défaut, `--sqlite` pour le miroir) |
| `redis <cmd> <key> [val]`   | Cache Redis (`get`, `set`, `del`)                              |
| `audit`                     | Diagnostics d'intégrité (traductions, base)                    |
| `test-variants`             | Cohérence des personnages et de leurs variantes                |
| `status`                    | Santé des services locaux (SQLite, Redis, système)             |
| `wave`                      | Vague d'enrichissement/analyse (zukan, glossaire, xref assets) |
| `repair`                    | Diagnostique et répare la base locale (RLS, privilèges)        |
| `sync`                      | Synchronise les fichiers locaux avec PostgreSQL                |
| `compare <chara1> <chara2>` | Comparaison de deux joueurs                                    |
| `chara [requête]`           | Fiche joueur (profil, stats, moveset, variantes)               |
| `dialogue [requête]`        | Recherche dans les dialogues du jeu                            |
| `skill [requête]`           | Fiche technique / compétence / passive                         |
| `item [requête]`            | Fiche objet                                                    |
| `team [requête]`            | Fiche équipe                                                   |
| `random-team`               | Équipe aléatoire complète (11 joueurs + staff)                 |
| `team-builder <action>`     | Compositions : `list`, `show`, `delete`, `save`, `generate`    |
| `test`                      | Suite de vérifications du wiki (native ou Playwright)          |
| `shell` / `repl`            | Terminal interactif                                            |
| `data <sous-commande>`      | Pipeline de données unifié                                     |
| `serve`                     | API HTTP headless (voir plus haut)                             |

Sous-commandes de `data` : `push` (inagle → Supabase), `migrate` (`--apply`),
`load` (régénère le miroir SQLite), `sync` (`--full`), `typecheck`, `verify`,
`all` (`push → load → typecheck → verify`).

La plupart des commandes acceptent `--json` pour une sortie machine :

```bash
bun packages/rg-azalee/src/cli.ts chara "Mark Evans" --json
bun packages/rg-azalee/src/cli.ts search "tornade" --json
```

## Données embarquées et régénération

Les projections durables suivent PostgreSQL. Les artefacts d'extraction ne sont
plus des sources runtime :

| Fichier                              | Régénération                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `inagle_asset_manifests`             | import SQL des extractions CPK                                            |
| `@rosegriffon/inagle/asset-manifest` | projection TypeScript générée depuis `inagle_asset_manifests`             |
| `cross`                              | paquet partagé de types et règles d'extraction, sans données wiki runtime |

Les scripts de projection se lancent depuis la racine du dépôt
(`bun packages/azalee/scripts/<script>.ts`) ou depuis le package.
Les manifestes sont des **gates anti-404** : un code absent du manifeste fait
renvoyer `null` ou un placeholder au lieu d'une URL CDN morte.

En production, définir `AZALEE_UNIFIED_API_URL` (par exemple
`http://127.0.0.1:8800/v1/azalee`) force `createAzaleeData()` à utiliser l'API
Elysia unifiée, même si un miroir SQLite est présent. Le miroir reste réservé
au mode extraction/offline explicite.

## Tests, build, publication

```bash
bun test                    # from packages/azalee
bun run type-check          # tsc --noEmit (vrais types workspace)
bun run lint                # oxlint
bun run build               # tsc -p tsconfig.build.json
bun run compile             # binaire autonome → bin/azalee
```

Les tests (`test/`) s'appuient sur les **vrais artefacts** de la machine
(`apps/rg-website/data/`) : résolution de configuration et URLs CDN. Ils restaurent
systématiquement la configuration explicite et les variables d'environnement
touchées — le miroir SQLite est un singleton de processus, une fuite de
configuration casserait les fichiers de test suivants.

The publication build uses the actual `@rosegriffon/db` package types rather than
ambient `any` shims. Both producer libraries emit declarations with their TypeScript
build projects; relative TypeScript imports are rewritten for emitted JavaScript.
The root development dependencies provide PostgreSQL declarations for source-first
external packages.

Aphrody consumes private archives built from the IECODE revision pinned in its
`config/sibling-checkouts.json`. These packages keep source-first exports and are
not published by the archive preparation command. Registry publication requires an
explicit owner decision.

Rappel de discipline, valable pour toute contribution :
**la racine du package doit rester client-safe.** Tout ce qui touche `bun:sqlite`,
`node:fs` ou le réseau va dans `/server` (ou dans un module serveur avec son jumeau
`-shared`), sans quoi le bundle navigateur casse sur `Can't resolve 'fs'`/`'tls'`.
La vérification tient en une commande, à relancer après toute modification de
`src/index.ts` ou d'un module qu'il agrège :

```bash
bun build --target=browser src/index.ts --outdir /tmp/azalee-browser
# Bundled 45 modules in 43ms → index.js 2.66 MB
```
