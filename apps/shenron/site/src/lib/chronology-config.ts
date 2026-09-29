/**
 * chronology-config — lecture/écriture **server-only** de la curation de la
 * chronologie universelle (/wiki/chronologie).
 *
 * La table `ChronologyConfig` (schéma public) stocke un unique document JSON
 * (singleton `default`) : ordre des ères + overrides par entrée (ère/date/titre/
 * note/masquage/rang manuel). La page publique lit ici la config résolue puis
 * `applyChronology` produit la frise FIXE ; l'éditeur `/admin/chronologie`
 * l'écrit via `/api/chronologie-config`. Toute lecture est enveloppée (jamais
 * throw) : table absente / DB indispo / JSON invalide ⇒ défauts → frise
 * strictement identique à l'ancien ordre auto « ère ». Cf. `lib/chronology.ts`.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chronologyConfig } from "@/db/schema";
import {
	DEFAULT_CHRONOLOGY_CONFIG,
	resolveChronologyConfig,
	type ChronologyConfig,
} from "@/lib/chronology";

const SINGLETON_ID = "default";

/** Config chronologie résolue (patch DB fusionné aux défauts). Ne throw jamais. */
export async function getChronologyConfig(): Promise<ChronologyConfig> {
	try {
		const [row] = await db
			.select()
			.from(chronologyConfig)
			.where(eq(chronologyConfig.id, SINGLETON_ID))
			.limit(1);
		if (!row) return structuredClone(DEFAULT_CHRONOLOGY_CONFIG);
		return resolveChronologyConfig(row.data);
	} catch (e) {
		console.error("[chronology-config] lecture échouée, repli sur les défauts :", e);
		return structuredClone(DEFAULT_CHRONOLOGY_CONFIG);
	}
}

/** Upsert du singleton (on stocke la config déjà résolue) → renvoie la config résolue. */
export async function saveChronologyConfig(
	patch: unknown,
	by?: string | null
): Promise<ChronologyConfig> {
	const resolved = resolveChronologyConfig(patch);
	// La colonne jsonb est typée Record<string, unknown> ; ChronologyConfig est
	// structurellement du JSON → cast localisé (cf. home-config.ts).
	const data = resolved as unknown as Record<string, unknown>;
	await db
		.insert(chronologyConfig)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: chronologyConfig.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	return resolved;
}
