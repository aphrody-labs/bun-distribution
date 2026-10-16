/**
 * Façade publique de l'accès durable aux données de jeu.
 *
 * Ce module n'expose que PostgreSQL. Les adaptateurs SQLite sont réservés aux
 * sous-commandes d'extraction/dev et doivent être importés explicitement.
 */

export { createPostgresClient, PostgresQueryBuilder } from "@rosegriffon/db/postgres-client";
export {
  createClient,
  hasDatabaseProvider,
  setDatabaseProvider,
  type DatabaseClient,
  type DatabaseClientFactory,
} from "./provider";
