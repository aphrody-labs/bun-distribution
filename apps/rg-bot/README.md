# @rosegriffon/bot

Bot Discord du projet Rose Griffon : slash commands publiques (communauté,
éditorial, agenda, boutique, archive X), commandes de données de jeu IEVR
(wiki Azalée, archives CPK, CDN, RAG) et arbres réservés `/staff` et
`/administration`, plus la génération de cartes canvas.

Restauré depuis `vps@c4d47a683^:apps/rg-bot/`, modernisé pour le monorepo
`~/rg/` (Turborepo + Bun + catalog).

Le seul processus Discord actif est `rg-bot.service`. Les données Azalée sont
servies par `rg-api.service` (`/v1/azalee`) ; l'ancien profil Discord Azalée et
son unité `azalee-bot.service` sont retirés.

## Un bot Discord, une API Azalée

Le bot communautaire Rose Griffon est l'unique processus Discord (`rg-bot`).
Les commandes et données de jeu passent par l'API Elysia/Kysely unifiée ; elles
ne nécessitent plus une seconde identité Discord ni un second démon.

Le profil actif est `rg`, avec un jeton et des guildes centralisés.

**Ne jamais dupliquer un fichier de `src/commands/` pour en faire une variante
« azalee ».** Toute différence entre les deux bots passe par le registre de
profils (`src/lib/profil.ts`, module pur couvert par `bun:test`) — sinon chaque
correctif futur devrait être appliqué deux fois, et ne le serait pas.

Le guide historique `docs/bot-azalee.md` est conservé comme archive et ne
décrit plus un service déployable.

## Présentation : la trousse `src/lib/ui`

Toutes les réponses des deux bots passent par une seule trousse — couleurs,
icônes, pieds de page, bornage aux limites de l'API, pagination et charges de
réponse (`succes`, `echec`, `vide`, `refus`). Aucune commande n'écrit une
couleur, une émoji d'état ni une limite Discord en dur :

```ts
import { differer, echec, fiche, piedDeCommande, rangeePagination, repondre } from "../lib/ui";
```

La charte complète (patron d'une commande, palette, règles de nommage, ce qui
est éphémère) : [`docs/bot-format.md`](../../docs/bot-format.md).
`bun test src/lib/ui` la couvre.

## Commandes

```bash
bun install              # depuis la racine du monorepo
cd apps/rg-bot
cp .env.example .env     # remplir les secrets Discord/Supabase et les deux URLs PostgreSQL

bun dev                  # bun --watch
bun start                # one-shot
bun run build            # → dist/index.js
bun run type-check       # tsc --noEmit
bun run test             # bun test src
bun run lint             # oxlint src (lint:fix pour corriger)
bun run smoke:admin      # smoke test services + RBAC + audit (requiert DB live)
bun run smoke:canvas     # smoke test canvas (génère /tmp/rg-{staff,profil,events}.png)
```

⚠ Toujours lancer depuis `apps/bot` (ou avec ce répertoire comme
`WorkingDirectory`) : Bun lit le `tsconfig.json` du répertoire courant, et
c'est celui-ci qui porte `experimentalDecorators` + `emitDecoratorMetadata`.
Depuis la racine du dépôt, discordx meurt sur « TypeError: undefined is not an
object (evaluating 'descriptor.value') ».

## Architecture

```
src/
├── index.ts              entry — Client discordx, intents, imports de commandes, login
├── commands/             une racine par domaine (arbre exact = les imports d'index.ts)
│   ├── …                 commandes publiques (communauté, éditorial, données de jeu, archive X)
│   ├── staff/            consultation réservée à l'équipe
│   └── administration/   écriture réservée aux administrateurs
├── events/
│   ├── ready.ts          @Once(clientReady) → sync membres si BOT_SYNC_MEMBRES=1
│   └── memberEvents.ts   @On(guildMemberAdd|Update|userUpdate) → syncOneMember
├── services/
│   ├── admin.ts          queries dashboard admin (cached 30s/60s via lib/cache)
│   ├── website.ts        queries publiques (team, profile, chroniques, events, planning, …)
│   ├── tweets.ts         archive X : liste, réglage de notification, curseur
│   ├── tweetsNotifier.ts drain des nouveaux posts → embeds dans le salon d'annonce
│   ├── syncMembers.ts    upsert discord_members + sync user.image via account bridge
│   └── teamPhotos.ts     sync avatars staff (team_members) — 3 tables propagées
├── lib/
│   ├── profil.ts         registre de l'identité rg — jeton, guildes, modules, marque
│   ├── db.ts             expose `supabase` (@rosegriffon/db service) + `sql` (Bun.SQL)
│   ├── azalee.ts         client HTTP typé de l'API Azalée unifiée (:8800/v1/azalee)
│   ├── api.ts            client HTTP /api/bot/v1/* du site Next (alternative à db direct)
│   ├── cache.ts          Redis (Bun.RedisClient) + fallback in-memory
│   ├── rbac.ts           requireRgAdmin/Strict — résout discord_id → profile.role
│   ├── audit.ts          logAdminAction → admin_audit_log
│   ├── embeds.ts         rgEmbed + utils format (truncate, fmtDate, DAYS_FR, …)
│   ├── *-format.ts       logique pure de rendu, couverte par `bun test`
│   └── canvas/           génération PNG via @aphrody/canvas
│       ├── theme.ts      palette + fonts (ensureFonts)
│       ├── cards.ts      renderProfileCard, renderTeamGrid, renderEventList, …
│       └── utils.ts      helpers Canvas2D (rounded rect, wrapped text, circular img, …)
└── scripts/
    ├── smoke-admin.ts    smoke services + RBAC + audit (CI-friendly)
    └── smoke-canvas.ts   smoke canvas (écrit dans /tmp/rg-*.png)
```

Toute logique décidable sans Discord ni base (rendu d'une ligne, bornage des
pages, encodage de l'état des boutons) vit dans un module `lib/*-format.ts`
pur, couvert par `bun:test` — les fichiers de `commands/` ne font que du
câblage.

## Liens monorepo

- [`@rosegriffon/db`](../../packages/db) — client typé de la base self-host (browser/server/service + types `Database` générés)
- `@rosegriffon/azalee` (IECODE `packages/azalee`, archive figée selon `config/sibling-checkouts.json`) — bibliothèque du wiki IEVR ; le bot en consomme le sous-chemin `/remote`
- [`@rosegriffon/config`](../../packages/config) — tsconfig (`tsconfig-bun.json`), oxlintrc, eslint base

## Couche DB — Bun.SQL + client Supabase-compatible

Le bot utilise **deux** chemins d'accès selon le contexte de la requête :

- **`supabase`** (de `@rosegriffon/db/service`) : client service-role typé.
  Préférer pour les requêtes simples (`from().select()`, `.insert()`, `.rpc()`)
  — bénéficie du type-checking sur les colonnes via `Database`.
- **`sql`** (de `bun`) : `RG_DATABASE_URL` vers Supabase RG; `inagleSql`
  utilise `INAGLE_DATABASE_URL` vers Neon gameplay. Aucun fallback croisé.
  Préférer le SQL direct pour les CTE, fenêtres et jointures complexes.

Les tables `inagle_*` vont sur Neon; les comptes, les données RG et Achillea
restent dans le projet Supabase Cloud `rg`. Les deux clients gardent ces URLs
séparées. `DATABASE_URL` reste un alias de compatibilité RG pour les scripts
anciens. Voir `src/lib/db.ts`.
