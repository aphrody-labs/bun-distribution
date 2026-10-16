import { createSupabaseBrowserClient } from "@rosegriffon/db/browser";

/** Unique façade navigateur pour les opérations Supabase Storage. */
export function getBrowserStorage() {
	return createSupabaseBrowserClient().storage;
}

export function getBrowserPublicUrl(bucket: string, path: string): string {
	return getBrowserStorage().from(bucket).getPublicUrl(path).data.publicUrl;
}
