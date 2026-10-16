/**
 * Types Kysely pour les tables Supabase générées.
 *
 * Le schéma public/RLS est généré par Supabase ; `kysely-supabase` traduit
 * automatiquement ses contrats Row/Insert/Update en tables utilisables par
 * Kysely. Le schéma serveur Achilléa reste séparé et possède ses interfaces
 * strictes dans les services migrés.
 */
import type { KyselifyDatabase } from "kysely-supabase";

import type { Database as SupabaseDatabase } from "./types.gen";

export type SupabaseKyselyDatabase = KyselifyDatabase<SupabaseDatabase>;
