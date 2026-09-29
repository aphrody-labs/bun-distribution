/**
 * Accès à une DB Postgres LIVE pour les tests d'intégration écriture (Supabase-first).
 *
 * Supabase-first : **pas de Postgres local**. Ces tests écrivent dans une vraie DB et ne
 * doivent tourner que si une branche Supabase de test est explicitement fournie via
 * `TEST_DB_URL` (ex. postgresql://postgres:<pwd>@db.<branch-ref>.supabase.co:5432/postgres?sslmode=require).
 *
 * Sans `TEST_DB_URL`, les suites concernées se **skippent** (clone frais / CI offline) :
 *   - envelopper les blocs qui touchent la DB avec `describeLive(...)` ;
 *   - garder les `beforeAll` de connexion derrière `if (!hasLiveDb) return;`.
 *
 * Les contrôles de lecture/cohérence sans réseau passent par le snapshot SQLite
 * (cf. fixtures/snapshot.ts).
 */
import { describe } from "bun:test";

/** URL de la DB live de test (vide = non configurée). */
export const LIVE_DB_URL = process.env.TEST_DB_URL ?? "";

/** Une DB live est-elle configurée ? */
export const hasLiveDb = LIVE_DB_URL.length > 0;

/** `describe` qui ne s'exécute que si `TEST_DB_URL` est défini, sinon `describe.skip`. */
export const describeLive: typeof describe = hasLiveDb ? describe : describe.skip;
