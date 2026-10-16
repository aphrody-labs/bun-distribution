/**
 * @file db/index.ts
 * @description Consolidated Bun-native database clients (SQLite & PostgreSQL) and Drizzle ORM.
 */

// Drizzle ORM client, schemas, and helpers
export * from "../sql/drizzle.js";

// SQL service projection data loader
export { loadInagleServiceData } from "../sql/service-data.js";

// Bun-native direct database clients
export { Database } from "bun:sqlite";
export { SQL, sql } from "bun";
