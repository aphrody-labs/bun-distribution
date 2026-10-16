# @rosegriffon/db

Package database partagé pour l'écosystème Rose Griffon.

## PostgreSQL ownership

RG, Achillea and Better Auth use Supabase Cloud PostgreSQL. `RG_DATABASE_URL`
takes precedence over the compatibility `DATABASE_URL` and
`ROSE_GRIFFON_DATABASE_URL` names. Achillea keeps its `achillea,public` search
path within that store. An absent configuration never creates a local database.

Gameplay projections (`inagle_*`) use Neon through `INAGLE_DATABASE_URL`, with
`NIE_PG_URL` as an explicit historical alias. There is no fallback to the RG
connection. `getInaglePgPool()`, `createInagleSql<DB>()` and
`createInagleBunSql()` expose the same store ownership for pg, Kysely and Bun SQL.
The configured URL retains the driver's TLS behavior.

`createPostgresClient()` dispatches its unqualified table names and RPC names
starting with `inagle_` to gameplay; other names, auth and storage stay on RG.
An explicit `createPostgresClient(connectionString)` overrides only the RG
connection. It never redirects gameplay to that URL. Raw SQL callers choose
their store explicitly; the facade does not parse SQL to infer routing.

The unified search issues one union per store and combines its typed results.
The bot reads community inventory from RG and character records from Neon,
then composes them by character ID while retaining inventory order. Neither
path creates a cross-store SQL join or transfers database credentials.

Supabase Cloud browser clients accept `sb_publishable_` keys only on HTTPS
`*.supabase.co` endpoints. The retained local PostgREST gateway keeps its anon
JWT contract. Server storage supports `SUPABASE_SECRET_KEY` or the historical
`SUPABASE_SERVICE_ROLE_KEY`; opaque keys use `apikey`, while legacy JWTs also
retain their Bearer header. Runtime secrets remain outside this package.

The retained SQL migrations and typed table definitions keep ownership of DDL.
This routing change creates no schemas, foreign tables, `dblink` connections,
provider configuration or data migrations. Import scripts use Kysely's
`Insertable` contract with JSON strings and ISO timestamps required by those
definitions; running an import remains an explicit operator action.

Azalee's read-only SQLite mirror, aura helpers, local test/status/random-team
commands and local extraction inputs remain offline. PostgreSQL wiki/gameplay
commands use the Inagle connection; the team-builder's saved user teams use RG.
The local gameplay repair rejects managed hosts before opening a client and
only repairs `inagle_*` tables in the explicitly configured loopback database.
It does not alter RG tables or invoke a fallback database through `sudo`.

## Contenu

- **Types PostgreSQL :** Source de vérité générée via `bun run types:gen`.
- **Accès SQL :** `@rosegriffon/db/achillea-sql`, `@rosegriffon/db/pg` et `@rosegriffon/db/bun-sql` sont les frontières SQL communes.
- **Compatibilité HTTP :** les helpers browser/server et Storage restent isolés pour les surfaces auth/fichiers uniquement.
- **Services :** Logique métier transverse (ex: agrégation de statistiques dashboard).
- **Accès SQL Achilléa :** `@rosegriffon/db/achillea-sql` expose Kysely + `pg`,
  avec `search_path=achillea,public` et l’URL PostgreSQL unifiée `rg`.
  Chaque service migré fournit une interface Kysely exacte pour ses tables ;
  le helper ne force volontairement aucune index signature qui neutraliserait
  la vérification compile-time des tables et colonnes. Les appels partagent le
  même pool par URL/options ; `destroyAchilleaSql()` ferme proprement les pools
  lors de l’arrêt d’un worker ou d’un test.
- **Types Kysely Supabase :** `@rosegriffon/db/kysely-types` expose
  `SupabaseKyselyDatabase`, traduit depuis les types générés Supabase avec
  `kysely-supabase` pour les requêtes publiques/RLS.

## Utilisation

```typescript
import { createPostgresClient } from "@rosegriffon/db/service";

const db = createPostgresClient();
const { data } = await db.from("profiles").select("*");
```


## Scripts

- `types:gen` : Régénère `src/types.gen.ts` depuis la base PostgreSQL **locale**
  (`scripts/types-gen.ts` → générateur pg-meta sur `127.0.0.1:8813`, celui-là même
  qu'appelait `supabase gen types typescript` avant la bascule self-host). Le
  fichier produit est commité ; toute retouche à la main est effacée au prochain
  passage, donc une correction de type se fait en base puis par régénération.
- `type-check` : Vérifie la validité des types du package.
- `test` : Lance les tests unitaires (`bun test`).

La migration SQL est la source de vérité pour les changements PostgreSQL. Les
anciens fichiers MikroORM d’Achilléa sont gelés pendant la transition ; ne pas
utiliser `schema:update` en production.
