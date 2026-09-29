/**
 * Chargement de la COURBE DE NIVEAUX éditable depuis la DB.
 *
 * Les paliers actifs vivent dans `xp.ts` (`ACTIVE_THRESHOLDS`, lu par les
 * hot-paths `levelForXP`/`xpProgress`). Ici on les hydrate depuis la clé
 * `guild_settings.xp.thresholds` (JSON) au BOOT, et l'API admin les remplace à
 * chaud. Absente/invalide → on garde le défaut en dur (`LEVEL_THRESHOLDS`).
 */
import { eq } from "drizzle-orm";
import type { DB } from "~/db/index";
import { guildSettings } from "~/db/schema";
import { getLevelThresholds, type LevelThreshold, setLevelThresholds } from "./xp";

const LEVEL_THRESHOLDS_KEY = "xp.thresholds";

/** Hydrate la courbe active depuis la DB. À appeler AU BOOT (après migrations). */
export function loadLevelThresholds(db: DB): void {
	try {
		const rows = db
			.select()
			.from(guildSettings)
			.where(eq(guildSettings.key, LEVEL_THRESHOLDS_KEY))
			.all();
		const raw = rows[0]?.value;
		if (!raw) return; // pas de surcharge → défaut en dur conservé
		const parsed = JSON.parse(raw) as LevelThreshold[];
		if (Array.isArray(parsed) && parsed.length > 0) setLevelThresholds(parsed);
	} catch {
		// JSON cassé / colonne absente → on garde le défaut, jamais de crash boot.
	}
}

/** Persiste ET applique une nouvelle courbe (appelé par l'API après validation). */
export function saveLevelThresholds(db: DB, rows: LevelThreshold[]): LevelThreshold[] {
	setLevelThresholds(rows); // applique immédiatement (tri + validation dans le setter)
	const value = JSON.stringify(getLevelThresholds());
	db.insert(guildSettings)
		.values({ key: LEVEL_THRESHOLDS_KEY, value })
		.onConflictDoUpdate({ target: guildSettings.key, set: { value } })
		.run();
	return [...getLevelThresholds()];
}
