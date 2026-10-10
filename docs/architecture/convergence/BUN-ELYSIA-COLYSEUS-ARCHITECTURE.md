<!-- SPDX-License-Identifier: Apache-2.0 -->
# Référence d'Architecture : Architecture Unifiée Bun, ElysiaJS & Colyseus pour Rose Griffon

Ce document décrit l'architecture de référence et les patterns techniques adoptés pour le backend unifié Rose Griffon / Achilléa sous Bun 1.4.2.

---

## 1. Stack Technique Fondamentale

- **Runtime** : [Bun 1.4.2](https://bun.sh) (JavaScriptCore natif, I/O asynchrone C++, Bun.serve).
- **Type Checker** : [TypeScript 7.0.2](https://www.typescriptlang.org) en mode strict.
- **Routeur HTTP / REST** : [ElysiaJS v1.4](https://elysiajs.com) avec validation déclarative TypeBox (`Elysia.t`) et client typé Eden.
- **WebSocket & Realtime** :
  - `Elysia.ws()` (basé sur uWebSockets compilé avec Bun) pour les canaux applicatifs et notifications légères.
  - Server-Sent Events (SSE) via `POSTGRES LISTEN/NOTIFY` pour la réplication temps réel des modifications de tables (`/realtime/v1/stream`).
  - [Colyseus v0.17](https://colyseus.io) via `@colyseus/bun-websockets` pour l'état synchronisé en mémoire (matchmaking, rooms de match 1v1 / 2v2).
- **Accès Données** :
  - **Kysely** avec pooler PostgreSQL Supabase (port 5432 / 6543) et `pg`.
  - Pas de couches ORM complexes avec métadonnées de décorateurs fragiles en production.
- **Stockage Objets** :
  - S3 / Supabase Storage pour les médias statiques et preuves de litiges compétitifs.

---

## 2. Patterns d'Implémentation ElysiaJS

### 2.1. Contrôleur Typé Déclaratif
```typescript
import { Elysia, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";

export const tournamentController = new Elysia({ prefix: "/tournaments" })
  .use(dbPlugin)
  .get("/", async ({ db, query }) => {
    return await db.selectFrom("tournament").selectAll().execute();
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      limit: t.Optional(t.Numeric({ default: 20 }))
    }),
    response: {
      200: t.Array(t.Any()),
      400: t.Object({ error: t.String() })
    }
  });
```

### 2.2. WebSockets Natifs Haute Performance (`app.ws`)
```typescript
import { Elysia, t } from "elysia";

export const notificationWs = new Elysia()
  .ws("/v1/achillea/ws", {
    body: t.Object({
      type: t.String(),
      payload: t.Optional(t.Any())
    }),
    open(ws) {
      const user = ws.data.user;
      if (user) {
        ws.subscribe(`user:${user.id}`);
        console.info(`[ws] User connected: ${user.id}`);
      }
    },
    message(ws, { type, payload }) {
      // Traitement des messages entrants
    },
    close(ws) {
      const user = ws.data.user;
      if (user) {
        ws.unsubscribe(`user:${user.id}`);
      }
    }
  });
```

---

## 3. Moteur de Matchs Temps Réel (Colyseus)

Le serveur Colyseus exploite le transport natif Bun :

```typescript
import { defineServer, defineRoom } from "colyseus";
import { BunWebSockets } from "@colyseus/bun-websockets";
import { QueueRoom } from "./rooms/QueueRoom";
import { MatchRoom } from "./rooms/MatchRoom";
import { LobbyRoom } from "./rooms/LobbyRoom";

export const gameServer = defineServer({
  transport: new BunWebSockets({}),
  rooms: {
    queue: defineRoom(QueueRoom).filterBy(["mode", "ranked"]),
    match: defineRoom(MatchRoom),
    lobby: defineRoom(LobbyRoom),
  }
});
```

---

## 4. Pipeline d'Exécution & Compilateur Rust

1. **Compilation AOT des Bots** :
   ```bash
   aphrody discord compile rg --smoke
   ```
   Génère l'exécutable ELF autonome `dist/rg-bot` (not in repo) (generated or machine-local artifact; presence depends on the build host) incorporant les profils `rg`, `azalee`, et `achillea`.
2. **Démarrage de l'API Unifiée** :
   ```bash
   bun run --filter @rosegriffon/api start
   ```
   Écoute sur `:8800` et sert l'ensemble du réseau web, REST, SSE, et WebSocket.
