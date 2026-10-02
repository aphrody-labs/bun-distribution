<!-- SPDX-License-Identifier: Apache-2.0 -->
# Référence Canonique de la Base de Données & de Kysely

Ce document constitue le guide de référence pour l'utilisation, le typage, la configuration des pools et les opérations sur la base de données PostgreSQL unique `rg` via le query builder **Kysely** au sein du monorepo Aphrody ([`packages/rg/db`](../../../packages/rg/db)).

---

## 1. Topologie & Schémas PostgreSQL

Depuis la fusion complète (`scripts/rg/ops/achillea-merge.ts`), Rose Griffon n'utilise plus qu'**une seule instance PostgreSQL locale (version 18)** hébergée sur le VPS de production (`51.77.147.152:5432`), éliminant définitivement les connexions distantes, les proxies et les tables étrangères `postgres_fdw`.

La base unique `rg` est organisée en deux schémas logiques principaux :

```mermaid
erDiagram
    DATABASE_RG {
        string schema_achillea "Domaine Esport & Compétitions"
        string schema_public "Domaine Communauté, Profils, Wiki, Auth"
    }

    schema_achillea ||--o{ clan : contient
    schema_achillea ||--o{ event : contient
    schema_achillea ||--o{ lobby : contient
    schema_achillea ||--o{ wallet : contient
    schema_achillea ||--o{ user_elo : contient
    schema_achillea ||--o{ license : contient

    schema_public ||--o{ profiles : contient
    schema_public ||--o{ articles : contient
    schema_public ||--o{ user : "Better Auth"
    schema_public ||--o{ session : "Better Auth"
    schema_public ||--o{ inagle_characters : "Wiki Azalée"
    schema_public ||--o{ inagle_skills : "Wiki Azalée"

    profiles ||--o{ clan_member : "Jointure directe sans FDW"
```

### 1.1. Schéma `achillea`
Dédié au moteur compétitif et à l'écosystème tournois :
- **Clans & Équipes** : `clan`, `clan_member`, `clan_member_history`, `clan_invite`, `clan_application`, `clan_experience`, `clan_experience_log`.
- **Tournois & Matchs** : `event`, `tournament_event`, `tournament_phase`, `tournament_participant`, `event_managers`, `lobby`, `lobby_user`, `lobby_match`, `ruleset`.
- **Classements & Saisons** : `user_elo`, `season`, `rank`, `stat`.
- **Licences & Économie** : `license`, `wallet`, `transaction`, `interclan_lineup`.

### 1.2. Schéma `public`
Dédié à l'identité, au CMS et aux projections de données Inazuma Eleven :
- **Authentification & Identité** : Tables Better Auth (`user`, `session`, `account`, `verification`), table unifiée `profiles`.
- **Contenu & Actualités** : `articles`, `events` (calendrier), `orders`.
- **Projections Wiki Azalée (Inagle)** : `inagle_basara`, `inagle_characters`, `inagle_skills`, `inagle_items`, `inagle_quests`, `inagle_teams`, `inagle_cross_catalog`, `inagle_cpk_index`, `inagle_game_text`.

---

## 2. Configuration Réseau & Pool de Connexions

### 2.1. Variables d'Environnement
La connexion est résolue de manière déterministe par `getAchilleaDatabaseUrl()` dans [`packages/rg/db/src/achillea.ts`](../../../packages/rg/db/src/achillea.ts) :

```typescript
export function getAchilleaDatabaseUrl(): string {
  return (
    process.env["DATABASE_URL"] ||
    process.env["ROSE_GRIFFON_DATABASE_URL"] ||
    process.env["RG_DATABASE_URL"] ||
    process.env["ACHILLEA_DATABASE_URL"] ||
    "postgresql://postgres:postgres@localhost:5432/rg"
  );
}
```

### 2.2. Configuration du Driver `pg.Pool`
L'usine de connexion `createPgPool()` applique des garde-fous stricts adaptés aux démons long-running sous Bun :
- **Taille de pool bornée** : Plafonnée par défaut à 4 connexions par processus (ou configurable via `DATABASE_POOL_MAX`) afin d'éviter d'épuiser les descripteurs de sockets PostgreSQL.
- **Timeouts** :
  - `connectionTimeoutMillis: 5_000` (détection rapide des pannes)
  - `idleTimeoutMillis: 30_000` (libération des connexions inactives)
- **Keep-Alive TCP** : Activé pour maintenir les flux au travers du firewall local.
- **Search Path** : `-c search_path=achillea,public` garantit que les tables des deux schémas sont directement accessibles sans préfixe obligatoire.

---

## 3. Typage Kysely & Schémas TypeScript

### 3.1. Composition du Schéma Global
Le type `Database` exporté par [`packages/rg/db/src/schema/index.ts`](../../../packages/rg/db/src/schema/index.ts) agrège l'ensemble des définitions de tables :

```typescript
import type { AchilleaTables } from "./achillea";
import type { PublicTables } from "./public";
import type { InagleTables } from "./inagle";

export type Database = AchilleaTables & PublicTables & InagleTables;
```

### 3.2. Types de Colonnes Kysely
Pour garantir la rigueur de typage à l'insertion et à la mise à jour, les tables utilisent les modificateurs de colonnes officiels :
- `Generated<T>` : Colonne gérée automatiquement par PostgreSQL (`SERIAL`, `IDENTITY` ou valeur par défaut). Optionnelle à l'insertion, obligatoire à la lecture.
- `ColumnType<SelectType, InsertType, UpdateType>` : Différencie les types de données selon le contexte d'opération.
- `JSONColumnType<T>` : Parse et valide les colonnes JSONB / JSON.

---

## 4. Patrons de Requêtes Recommandés

### 4.1. Injection de Dépendance dans Elysia (`dbPlugin`)
Dans l'API, l'instance Kysely est injectée automatiquement via le plugin `dbPlugin` :

```typescript
import { Elysia } from "elysia";
import { dbPlugin } from "../plugins/db";

export const clanController = new Elysia({ prefix: "/clans" })
  .use(dbPlugin)
  .get("/:tag", async ({ db, params: { tag }, error }) => {
    const clan = await db
      .selectFrom("clan")
      .selectAll()
      .where("tag", "=", tag)
      .executeTakeFirst();

    if (!clan) return error(404, { message: "Clan introuvable" });
    return clan;
  });
```

### 4.2. Jointures Multi-Schémas sans FDW
Grâce au `searchPath` unifié et à la colocation sur la base `rg`, les requêtes joignent nativement les données de tournoi et les profils utilisateurs :

```typescript
const participants = await db
  .selectFrom("tournament_participant")
  .innerJoin("profiles", "profiles.id", "tournament_participant.user_id")
  .select([
    "tournament_participant.id as participant_id",
    "tournament_participant.status",
    "profiles.username",
    "profiles.avatar_url"
  ])
  .where("tournament_participant.event_id", "=", eventId)
  .execute();
```

### 4.3. Transactions & Verrouillage Pessimiste (`FOR UPDATE`)
Pour les opérations critiques d'arbitrage de score ou de mouvement financier dans le portefeuille :

```typescript
await db.transaction().execute(async (trx) => {
  // Verrouillage de la ligne pour prévenir toute condition de course (race condition)
  const wallet = await trx
    .selectFrom("wallet")
    .selectAll()
    .where("user_id", "=", userId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  if (wallet.balance < cost) {
    throw new Error("Solde insuffisant");
  }

  await trx
    .updateTable("wallet")
    .set({ balance: wallet.balance - cost })
    .where("user_id", "=", userId)
    .execute();

  await trx
    .insertInto("transaction")
    .values({
      wallet_id: wallet.id,
      amount: -cost,
      type: "purchase",
      created_at: new Date()
    })
    .execute();
});
```

### 4.4. Requêtes SQL Brutes Sécurisées (`sql`)
Lorsque des fonctions PostgreSQL avancées sont requises (recherche plein texte, trigrammes, géométrie) :

```typescript
import { sql } from "@rosegriffon/db/achillea-sql";

const results = await db
  .selectFrom("inagle_characters")
  .selectAll()
  .where(sql<boolean>`similarity(name_localised, ${query}) > 0.3`)
  .orderBy(sql`similarity(name_localised, ${query})`, "desc")
  .limit(20)
  .execute();
```

---

## 5. Régénération des Types & Migrations

### 5.1. Régénération des Types TypeScript
Lorsque le schéma PostgreSQL est modifié sur la base locale :

```bash
bun run --filter @rosegriffon/db types:gen
```
> [!IMPORTANT]
> Ne jamais modifier manuellement `types.gen.ts`. Toute altération est écrasée à la régénération suivante.

### 5.2. Protocole de Migration Zéro-Downtime
1. **Migrations Additives Uniquement** : Ajouter des colonnes avec valeurs par défaut ou `NULL`.
2. **Pas de Renommage Immédiat** : Conserver l'ancienne colonne pendant une période de dépréciation si du code en production l'utilise encore.
3. **Exécution des Scripts** : Les scripts de structure vivent sous `scripts/ops/` et s'exécutent avec `bun scripts/ops/<migration>.ts`.

---

## 6. Cycle de Vie & Procédure de Sauvegarde

### 6.1. Arrêt Propre (Graceful Shutdown)
À l'arrêt du démon API/Bot (`SIGTERM` ou `SIGINT`), les pools Kysely et connexions actives doivent être libérés pour éviter les connexions fantômes (zombies) :

```typescript
import { destroyAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { closePgPool } from "@rosegriffon/db/pg";

process.on("SIGTERM", async () => {
  await destroyAchilleaSql();
  await closePgPool();
  process.exit(0);
});
```

### 6.2. Sauvegardes Quotidiennes Automatisées
Les dumps PostgreSQL sont exécutés quotidiennement par le cron de maintenance et conservés sous `/var/backups/postgres` sur le VPS hôte :
- Format : Archive compressée `pg_dump -Fc rg > /var/backups/postgres/rg_$(date +%Y%m%d).dump`.
- Restauration : `pg_restore -d rg --clean --if-exists /var/backups/postgres/<archive>.dump`.
