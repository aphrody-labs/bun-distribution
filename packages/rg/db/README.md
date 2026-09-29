# @rosegriffon/db

Package database partagé pour l'écosystème Rose Griffon.

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
