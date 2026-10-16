// Re-export pour compat backward — utiliser directement `@rosegriffon/db/service` dans les nouveaux modules.
// Cast en SupabaseClient permissif (cf. lib/supabase/client.ts pour le rationale).
import { createPostgresClient } from "@rosegriffon/db/service";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  return createPostgresClient() as unknown as SupabaseClient;
}
