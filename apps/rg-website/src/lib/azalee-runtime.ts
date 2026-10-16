import "server-only";

/**
 * Branchement de la bibliothèque `@rosegriffon/azalee` sur le runtime Next.
 *
 * Dans le wiki web, toutes les tables durables sont lues via le fournisseur
 * PostgreSQL/Kysely centralisé par `@rosegriffon/db`. Le SQLite reste limité
 * aux outils CLI et aux scénarios offline explicites.
 *
 * Ce module est importé par chaque façade serveur de `lib/` : l'injection est
 * donc garantie avant le premier accès données, quelle que soit la route.
 */
