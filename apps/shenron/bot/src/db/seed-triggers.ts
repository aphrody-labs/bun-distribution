import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { achievementTriggers } from "~/db/schema";

const TRIGGERS: Array<{ code: string; description: string; pattern: string; flags?: string }> = [
	{
		code: "KAMEHAMEHA",
		description: "A crié le nom de la plus célèbre attaque DBZ",
		pattern: "kame(?:\\s*ha)+meha",
	},
	{
		code: "OVER_9000",
		description: "IT'S OVER 9000 !!!",
		pattern: "(?:it['’]?s|c['’]?est)\\s*over\\s*9[\\s,.']?0{3}",
	},
	{
		code: "GENKIDAMA",
		description: "A appelé la Genkidama / Spirit Bomb",
		pattern: "\\b(genki\\s*dama|spirit\\s*bomb)\\b",
	},
	{ code: "NAMEK", description: "A mentionné Namek", pattern: "\\bnamek(?:sei|ian)?\\b" },
	{ code: "SAIYAN", description: "A invoqué la race Saiyan", pattern: "\\bsaiyan?j?in?\\b" },
	{
		code: "DRAGON_BALL",
		description: "A trouvé une Dragon Ball",
		pattern: "\\bdragon[-\\s]?ball[s]?\\b",
	},
	{ code: "SHENRON", description: "A invoqué Shenron", pattern: "\\bshenron\\b" },
	{ code: "PORUNGA", description: "A invoqué Porunga", pattern: "\\bporunga\\b" },
	{ code: "KAIOKEN", description: "A utilisé le Kaio-ken", pattern: "\\bkaio[-\\s]?ken\\b" },
	{
		code: "ULTRA_INSTINCT",
		description: "A atteint l'Ultra Instinct / Migatte no Goku'i",
		pattern: "\\b(ultra\\s*instinc?t|migatte)\\b",
	},
	{
		code: "GOD_MODE",
		description: "A atteint un état divin",
		pattern: "\\bsuper\\s*saiyan\\s*(god|blue|ros[eé])\\b",
	},
	{ code: "FINAL_FLASH", description: "A lancé un Final Flash", pattern: "\\bfinal\\s*flash\\b" },
	{
		code: "GALICK_GUN",
		description: "A lancé un Galick Gun / Gun",
		pattern: "\\bgalick\\s*gun\\b",
	},
	{
		code: "MAKANKOSAPPO",
		description: "A utilisé le Makankosappo (Special Beam Cannon)",
		pattern: "\\b(makank[oō]sappo|special\\s*beam\\s*cannon)\\b",
	},
	{ code: "CHICHI_SIMP", description: "Avoue avoir peur de Chichi", pattern: "\\bchichi\\b" },
];

async function main() {
	const dbs = container.resolve(DatabaseService);
	for (const t of TRIGGERS) {
		await dbs.db
			.insert(achievementTriggers)
			.values({
				code: t.code,
				description: t.description,
				pattern: t.pattern,
				flags: t.flags ?? "i",
				enabled: true,
			})
			.onConflictDoUpdate({
				target: achievementTriggers.code,
				set: {
					description: t.description,
					pattern: t.pattern,
					flags: t.flags ?? "i",
					enabled: true,
				},
			});
	}
	console.log(`✓ ${TRIGGERS.length} achievement triggers seeded`);
	dbs.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
