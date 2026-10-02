> Historical source reference from the imported RG repository. Its paths,
> versions and instructions are not current configuration. The only active
> repository rules are [root AGENTS.md](../../../../AGENTS.md); current ownership
> follows the [IECODE package decision](../../../decisions/rg/ievr-packages-from-iecode.md).

<!-- SPDX-License-Identifier: Apache-2.0 -->
# AGENTS.md — Rose Griffon Execution Contract

## 0. Identité & Mandat — Rose Griffon

`rg` est le monorepo canonique de la plateforme web, des données et des services communautaires de l'association Rose Griffon (`rosegriffon.fr`).

- **Trois piliers unifiés sous `rosegriffon.fr` (`apps/rg/website`)** :
  1. **Association** (`/`) : actualités, chroniques, projets, boutique, RG TV, adhésion.
  2. **Wiki Azalée** (`/wiki`) : encyclopédie Inazuma Eleven: Victory Road (joueurs, techniques, clubs, simulateurs, 3D). Redirection 301 depuis `azalee.rosegriffon.fr`.
  3. **E-sport Achilléa** (`/achillea`) : scène compétitive, tournois, Astral League, clans, ranked ELO, portefeuilles ACH. Redirection 301 depuis `achillea.rosegriffon.fr`.

## 1. Principes & Monorepo

- **Gestionnaire unique** : Bun strict (`bun@1.4.2`). Interdiction formelle de `npm`, `pnpm`, `yarn` ou `node`.
- **Packages de référence** :
  - `apps/rg/website` : application Next.js 15 unifiée (`@rosegriffon/website`).
  - `packages/rg/auth` : Better Auth unique par origine publique (`@rosegriffon/auth`).
  - `packages/rg/db` : accès PostgreSQL typé (`@rosegriffon/db`).
  - `packages/ui` : composants partagés Material Design 3 (`@rosegriffon/ui`).
  - `packages/rg/app-shell` : structure de navigation unifiée (`@rosegriffon/app-shell`).
  - `packages/rg/achillea-client` : client interne typé vers `rg-api` / schéma `achillea`.
- **Orchestration infra déléguée** :
  - L'infrastructure VPS, les unités systemd (`rg-website:3004`, `rg-api:8807`, `rg-bot`), les routes Nginx et les releases (`/srv/rg/current`, `/srv/rg/releases`) sont pilotées par `aphrody-infra`.
  - Ne jamais restaurer `release-stack.ts` local ou d'anciennes unités retirées (`achillea-postgrest`, `achillea-storage`, `achillea-realtime`, `achillea-auth:8824`).

## 2. Authentification & Données

- **Authentification unique (Better Auth)** :
  - Toute authentification passe par `@rosegriffon/auth` et `/api/auth/*`.
  - Achilléa obtient sa session via `POST /api/achillea/session` (interne vers `rg-api`), éliminant l'ancien GoTrue et les anciens doublons OAuth.
- **Fusion native Achilléa** :
  - Les données Achilléa résident nativement dans le schéma PostgreSQL `achillea` de la base `rg` (orchestré par `scripts/rg/ops/achillea-merge.ts`). Aucun FDW externe n'est utilisé.

## 3. Règles d'exécution YOLO / NHITL

- **Mode autonome** : `APHRODY_YOLO=1`, `APHRODY_NHITL=1`, `APHRODY_AGENT_AUTHENTICATED=1`, `APHRODY_AUTO_APPROVE=1`.
- **Préservation des modifications utilisateur** : Préserver impérativement les modifications en cours dans `apps/rg/website` et ne stager que les fichiers appartenant à la tâche.
- **Zéro fuite** : Ne jamais committer de secrets, tokens Discord, clés API ou fichiers `.env`.
- **Validation** : Tester les changements avec `bun test` ou les checks ciblés avant de déclarer `FAIT`.

## Automatisation transversale

`bun run docs:check-links` délègue la vérification documentaire à `aphrody-ops docs-links`. Conserver cette entrée locale lors de toute évolution du module central.
