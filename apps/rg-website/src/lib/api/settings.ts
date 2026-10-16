import { getPgPool } from "@/lib/db/pg";

export const FEATURE_SHOW_DISCORD_EVENTS = "feature_show_discord_events";

/**
 * Fetch a global setting value.
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts) :
 * ce Data API a été restreint (`exceed_storage_size_quota`) pendant 7+ jours
 * début août 2026, cassant ces pages en boucle, alors que la connexion
 * Postgres directe restait fonctionnelle tout du long.
 */
export async function getSetting<T = unknown>(key: string, defaultValue: T): Promise<T> {
	try {
		return await fetchSetting(key, defaultValue);
	} catch (error) {
		console.warn(`Error fetching setting ${key}:`, error);
		return defaultValue;
	}
}

/**
 * Fetch a public setting value. Alias de `getSetting` : la lecture Postgres
 * directe n'a pas de notion de client "cookies-aware" vs "public" — les deux
 * variantes sont conservées pour préserver la signature/l'usage des appelants.
 */
export async function getPublicSetting<T = unknown>(key: string, defaultValue: T): Promise<T> {
	try {
		return await fetchSetting(key, defaultValue);
	} catch (error) {
		console.warn(`Error fetching public setting ${key}:`, error);
		return defaultValue;
	}
}

async function fetchSetting<T>(key: string, defaultValue: T): Promise<T> {
	const pool = getPgPool();
	const { rows } = await pool.query<{ value: unknown }>(
		"SELECT value FROM settings WHERE key = $1 LIMIT 1",
		[key]
	);

	const row = rows[0];
	if (!row) {
		return defaultValue;
	}

	const { value } = row;

	if (typeof defaultValue === "boolean" && typeof value === "string") {
		if (value === "true") {
			return true as unknown as T;
		}
		if (value === "false") {
			return false as unknown as T;
		}
	}

	return value as T;
}
