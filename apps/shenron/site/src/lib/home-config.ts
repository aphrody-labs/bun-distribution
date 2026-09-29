/**
 * home-config — lecture/écriture **server-only** de la configuration de la home.
 *
 * La table `HomeConfig` (schéma public) stocke un unique document JSON (singleton
 * `default`). La page `/` lit ici la config résolue ; l'éditeur `/admin/home`
 * l'écrit via `/api/home-config`. Toute lecture est enveloppée (jamais throw) :
 * table absente / DB indispo / JSON invalide ⇒ défauts → home strictement
 * identique à la version en dur. Cf. `lib/home-scenes.ts` (types + défauts).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { homeConfig } from "@/db/schema";
import { DEFAULT_HOME_CONFIG, resolveHomeConfig, type HomeConfig } from "@/lib/home-scenes";
import { pickBestImage } from "@/lib/image-variants";

/**
 * Sert la meilleure résolution EXISTANTE de chaque image de scène : si la même
 * image (dHash identique) est hébergée en plus grand, c'est elle qui part au
 * héro. Le poster d'un clip reste tel quel (c'est une frame, pas un doublon).
 */
function upgradeSceneImages(config: HomeConfig): HomeConfig {
	const up = <T extends { image: string }>(s: T): T => ({ ...s, image: pickBestImage([s.image]) ?? s.image });
	return {
		...config,
		hero: { ...config.hero, scenes: config.hero.scenes.map(up) },
		sections: config.sections.map((sec) => (sec.scene ? { ...sec, scene: up(sec.scene) } : sec)),
	};
}

const SINGLETON_ID = "default";

/** Config home résolue (patch DB fusionné aux défauts). Ne throw jamais. */
export async function getHomeConfig(): Promise<HomeConfig> {
	try {
		const [row] = await db
			.select()
			.from(homeConfig)
			.where(eq(homeConfig.id, SINGLETON_ID))
			.limit(1);
		if (!row) return upgradeSceneImages(structuredClone(DEFAULT_HOME_CONFIG));
		return upgradeSceneImages(resolveHomeConfig(row.data));
	} catch (e) {
		console.error("[home-config] lecture échouée, repli sur les défauts :", e);
		return upgradeSceneImages(structuredClone(DEFAULT_HOME_CONFIG));
	}
}

/** Upsert du singleton (on stocke la config déjà résolue) → renvoie la config résolue. */
export async function saveHomeConfig(patch: unknown, by?: string | null): Promise<HomeConfig> {
	const resolved = resolveHomeConfig(patch);
	// La colonne jsonb est typée Record<string, unknown> ; HomeConfig (interface
	// close, sans index signature) est structurellement du JSON → cast localisé.
	const data = resolved as unknown as Record<string, unknown>;
	await db
		.insert(homeConfig)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: homeConfig.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	return resolved;
}
