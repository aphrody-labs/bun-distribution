<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan de Convergence et Unification Totale : Rose Griffon, Achilléa, ElysiaJS, Colyseus & Bun

Ce document constitue la feuille de route canonique de consolidation définitive des architectures de Rose Griffon et d'Achilléa sous Bun 1.4.2 et TypeScript 7.0.2 dans le monorepo Aphrody.

---

## 1. Objectifs Stratégiques

1. **Unification des Daemons de Bots Discord (`@rosegriffon/bot`)** :
   - Rapatrier le bot Achilléa sous forme de profil dédié (`achillea`) aux côtés des profils existants `rg` et `azalee` au sein de `iecode/apps/rg/bot`.
   - Produire un **unique binaire ELF autonome compilé AOT** (`dist/rg-bot` (not in repo) (generated or machine-local artifact; presence depends on the build host), ~145-150 Mo) via `aphrody discord compile rg --smoke`.
   - Zéro framework HTTP (`express`, `@tsed/*`) dans le processus Discord.

2. **Unification de la Couche Serveur & API (`@rosegriffon/api`)** :
   - Migration 100% vers **ElysiaJS** (haute performance, typage de bout en bout avec Eden et TypeBox, runner Bun natif).
   - Intégration de l'ensemble des 22 contrôleurs d'Achilléa sous `/v1/achillea/*`.
   - Migration des flux temps réel vers le routeur WebSocket natif d'Elysia (`app.ws("/v1/achillea/ws")`) et les SSE (`/realtime/v1/stream`), éliminant la dépendance à `socket.io`.

3. **Moteur Compétitif Ranked Colyseus (`@colyseus/bun-websockets`)** :
   - Rapatriement du moteur Colyseus (`QueueRoom`, `MatchRoom`, `LobbyRoom`) sous le contrôle de la stack serveur unifiée (`iecode/packages/rg/achillea-core/src/ranked`).
   - Élimination des proxys de compatibilité HTTP internes vers un port 4000 défunt, au profit d'appels directs aux requêtes Kysely partagées.

4. **Objectif 2 Applications Roses Griffon (`iecode/apps/rg/website` & `iecode/apps/rg/bot`) — RÉALISÉ** :
   - Suppression définitive des applications doublons `apps/rg/cdn` (not in repo), `apps/rg/realtime` (not in repo), `apps/rg/storage` (not in repo), `apps/rg/api` (not in repo), `apps/rg/achillea-bot` (not in repo), `apps/rg/azalee` (not in repo).
   - Intégration de l'ensemble de la couche API REST ElysiaJS (153 routes), WebSockets natifs et moteur Colyseus Ranked au sein de `iecode/apps/rg/bot/src/api`.
   - Build de production Next.js 16 (Turbopack) validé à 100% pour `iecode/apps/rg/website`.
   - Transfert des bibliothèques de jeu Inazuma (`azalee`, `inagle`, `inagle-cross`) dans le monorepo `iecode` (`../iecode/packages/`).
   - Packaging et publication autonome de `patreon-bun` sur GitHub (`rose-griffon/patreon-bun`).

---

## 2. Matrice d'Alignement des Services (État Actif)

| Composant | État Initial (Fragmenté) | État Final Unifié | Statut |
| :--- | :--- | :--- | :--- |
| **Bot Discord RG** | `iecode/apps/rg/bot` (Profils `rg` et `azalee`) | `iecode/apps/rg/bot` (Profils `rg`, `azalee`, `achillea`) | **Actif** |
| **Bot Discord Achilléa** | `apps/rg/achillea-bot` (not in repo) (Daemon hybride lourd) | Intégré dans `iecode/apps/rg/bot` (profil `achillea`) | **Actif** |
| **API REST Achilléa & RG**| `apps/rg/achillea-bot` (not in repo) (:4000) & `apps/rg/api` (not in repo) | `iecode/apps/rg/bot/src/api` (ElysiaJS :8800, 153 routes) | **Actif** |
| **Live Notifications** | `socket.io` (:4005) dans `achillea-bot` | Elysia WebSocket natif (`/v1/achillea/ws` :8800) | **Actif** |
| **Moteur Ranked** | Colyseus subprocess managé par `achillea-bot` | Colyseus Engine intégré (`iecode/apps/rg/bot/src/api/ranked`) | **Actif** |
| **ORM & Base SQL** | MikroORM 7 + Kysely (dual-stack) | **Kysely** + SQL typesafe unifié (`@rosegriffon/db`) | **Actif** |
| **Stockage, Realtime & CDN** | 3 apps autonomes (`storage`, `realtime`, `cdn`) | Absorbés in-process dans `apps/rg/bot/src/api/services` (not in repo) | **Actif** |
| **Libs Inazuma (Jeu)** | `packages/rg/{azalee,inagle,inagle-cross}` (not in repo) | Transférées vers `iecode` (`../iecode/packages/`) | **Actif** |
| **Application Web** | `iecode/apps/rg/website` | `iecode/apps/rg/website` (Next.js 16 Turbopack validé) | **Actif** |

---

## 3. Détail des Interfaces & Endpoints Migrés

### 3.1. Routes REST `/v1/achillea/*` sous ElysiaJS
1. **Contrats & Tournois** : `/tournaments`, `/leagues`, `/organizations`, `/clans`, `/guilds`.
2. **Joueurs & Profils** : `/users`, `/wallet`, `/licenses`, `/player-notes`.
3. **Compétition Live** : `/ranked/tiers`, `/ranked/leaderboard`, `/ranked/me`.
4. **Modération & Arbitrage** : `/sanctions`, `/admin/*`, `/moderation/sync` (HMAC vérifié).
5. **Médias & Proxy** : `/proxy/upload` (validation magic bytes PNG/JPEG/WebP) et `/proxy/delete/:id`.
6. **Streaming & Casts** : `/casts/events`, `/casts/availabilities`, `/casts/auto-assign`.

### 3.2. WebSocket & Hub Temps Réel
- Point d'accès : `ws://api.rosegriffon.fr/v1/achillea/ws` (ou port :8800 local).
- Authentification par jeton Bearer ou cookie de session.
- Salons dynamiques : `user:${userId}` recevant les événements :
  - `match_found` (match matchmaking assigné).
  - `rematch_offer` (demande de revanche directe).
  - `ranked_dispute_resolved` (décision staff sur litige).
  - Notifications système en direct.

---

## 4. Phase de Déploiement & Arrêt de la Dette

1. **Suppression des dépendances superflues** :
   - Retrait de `@tsed/*`, `express`, `multer`, `socket.io`, `body-parser`, `cookie-parser`.
2. **Réduction drastique de l'empreinte mémoire** :
   - Économie estimée de **~450 Mo de RAM** en production en supprimant les doublons de runtime V8/Node et en exploitant JavaScriptCore/Bun natif.
3. **Audit continu de portabilité** :
   - Conservation des gardes `purity.test.ts` et `portability.test.ts` garantissant que `@rosegriffon/achillea-core` et `@rosegriffon/achillea-types` demeurent exempts de tout code d'infrastructure.
