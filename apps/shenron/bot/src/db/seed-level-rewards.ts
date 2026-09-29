import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { levelRewards } from "~/db/schema";
import { LEVEL_THRESHOLDS, ZENI_PER_LEVEL } from "~/lib/constants";
import { RACE_LEVEL_ROLES } from "~/lib/race-levels";

/**
 * Mapping palier XP → rôle de transformation DBZ existant sur Dragon Ball FR.
 * Source de vérité unique : l'échelle SAIYAN de `lib/race-levels.ts` (Kaioken →
 * UI Parfait). `level_rewards` reste la table race-agnostique des paliers (zéni,
 * seuil XP, bannière) ; les rôles par AUTRE race vivent dans `race-levels.ts`.
 */
const LEVEL_ROLE_MAP = RACE_LEVEL_ROLES.saiyan;

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

await db.delete(levelRewards);

/**
 * Bannières par niveau — mapping CANON DBZ après analyse visuelle + fact-check
 * Google (Dragon Ball Wiki, kanzenshuu) le 2026-05-16. Chaque palier reflète
 * une étape narrative de la franchise, du début enfance DB à l'apex Ultra Instinct.
 *
 *   L1  Goku enfant + Shenron (DB Original — début de l'aventure)
 *   L2  Goku + Gohan enfant (DBZ Saga Saiyan/Namek — avant SSJ)
 *   L3  Goku SSJ vs Frieza (DBZ Namek — 1er Super Saiyan canon)
 *   L4  Goku SSJ Kamehameha (DBZ — puissance brute SSJ)
 *   L5  5 Super Saiyans ère Cell (Goku, Trunks adulte, Gohan, Trunks bébé, Piccolo)
 *   L6  Goku SSJ3 (DBZ Saga Buu — apex DBZ classique)
 *   L7  Goku SSG rosé vs Beerus (DBS Battle of Gods — entrée dans le divin)
 *   L8  Goku+Vegeta SSJ4 (DB GT — apex Saiyan)
 *   L9  Merged Zamasu (DBS Future Trunks — antagoniste ultime, demi-visage violet mutilé)
 *   L10 Goku Ultra Instinct Maîtrisé silhouette rainbow (DBS TdP ep.130 — endgame absolu)
 *
 * Les 9 bannières restantes (01,03,05,09,13,15,16,18,19) sont disponibles
 * comme items "banner_*" dans le shop (cosmétiques, prix échelonnés Zéni).
 */
const BANNERS: Record<number, string> = {
	1: "assets/banners/banner-17.jpg", // Goku enfant + Shenron
	2: "assets/banners/banner-14.jpg", // Goku + Gohan enfant
	3: "assets/banners/banner-06.jpg", // Goku SSJ vs Frieza
	4: "assets/banners/banner-08.jpg", // Goku SSJ Kamehameha
	5: "assets/banners/banner-04.jpg", // 5 SSJ ère Cell
	6: "assets/banners/banner-12.jpg", // Goku SSJ3
	7: "assets/banners/banner-10.jpg", // Goku SSG vs Beerus
	8: "assets/banners/banner-07.jpg", // Goku+Vegeta SSJ4 (GT)
	9: "assets/banners/banner-11.jpg", // Merged Zamasu
	10: "assets/banners/banner-02.jpg", // Ultra Instinct Maîtrisé silhouette
};

for (const { level, xp } of LEVEL_THRESHOLDS) {
	const roleId = LEVEL_ROLE_MAP[level];
	if (!roleId) continue;
	await db.insert(levelRewards).values({
		level,
		roleId,
		xpThreshold: xp,
		zeniBonus: ZENI_PER_LEVEL * level,
		bannerUrl: BANNERS[level] ?? null,
	});
	console.log(
		`  L${level.toString().padStart(2)} (${xp.toLocaleString("fr").padStart(11)} XP) → ${roleId} · ${BANNERS[level] ?? "—"}`
	);
}

console.log(`✓ ${LEVEL_THRESHOLDS.length} level rewards seeded`);
dbs.close();
