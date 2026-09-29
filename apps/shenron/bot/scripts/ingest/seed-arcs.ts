import "reflect-metadata";
import "~/db/wiki-write-guard";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbArcs, dbSagas } from "~/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "~/lib/logger";

const ARCS = [
	// DB
	{ sagaSlug: "pilaf", slug: "pilaf-quest", name: "Quête des Dragon Balls", orderIdx: 1 },
	{ sagaSlug: "red-ribbon", slug: "muscle-tower", name: "Muscle Tower", orderIdx: 1 },
	{ sagaSlug: "red-ribbon", slug: "blue-general", name: "Général Blue", orderIdx: 2 },
	{ sagaSlug: "red-ribbon", slug: "commander-red", name: "Commandant Red", orderIdx: 3 },

	// DBZ
	{ sagaSlug: "saiyan", slug: "raditz-arc", name: "Arrivée de Raditz", orderIdx: 1 },
	{ sagaSlug: "saiyan", slug: "vegeta-nappa", name: "Combat contre Vegeta et Nappa", orderIdx: 2 },
	{ sagaSlug: "namek", slug: "namek-arrival", name: "Arrivée sur Namek", orderIdx: 1 },
	{ sagaSlug: "namek", slug: "ginyu-force", name: "Commando Ginyu", orderIdx: 2 },
	{ sagaSlug: "namek", slug: "frieza-final", name: "Combat final contre Freezer", orderIdx: 3 },
	{ sagaSlug: "cell", slug: "androids-arrival", name: "Arrivée des Androïdes", orderIdx: 1 },
	{ sagaSlug: "cell", slug: "imperfect-cell", name: "Cell Imparfait", orderIdx: 2 },
	{ sagaSlug: "cell", slug: "cell-games", name: "Cell Games", orderIdx: 3 },
	{ sagaSlug: "buu", slug: "great-saiyaman", name: "Great Saiyaman", orderIdx: 1 },
	{ sagaSlug: "buu", slug: "world-tournament-25", name: "25e Tenkaichi Budôkai", orderIdx: 2 },
	{ sagaSlug: "buu", slug: "majin-buu-awakening", name: "Éveil de Majin Boo", orderIdx: 3 },
	{ sagaSlug: "buu", slug: "fusion-arc", name: "Saga des Fusions", orderIdx: 4 },
	{ sagaSlug: "buu", slug: "kid-buu", name: "Kid Boo", orderIdx: 5 },

	// DBS
	{ sagaSlug: "god", slug: "beerus-arc", name: "Dieu de la Destruction Beerus", orderIdx: 1 },
	{ sagaSlug: "golden-frieza", slug: "golden-frieza-arc", name: "Golden Freezer", orderIdx: 1 },
	{
		sagaSlug: "champa",
		slug: "u6-tournament",
		name: "Tournoi Univers 6 vs Univers 7",
		orderIdx: 1,
	},
	{ sagaSlug: "future-trunks", slug: "goku-black", name: "Goku Black", orderIdx: 1 },
	{
		sagaSlug: "tournament-of-power",
		slug: "top-recruitment",
		name: "Recrutement pour le Tournoi",
		orderIdx: 1,
	},
	{ sagaSlug: "tournament-of-power", slug: "top-main", name: "Le Tournoi du Pouvoir", orderIdx: 2 },
];

async function runArcSeed() {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	logger.info("→ Seeding Arcs...");

	let inserted = 0;
	for (const arc of ARCS) {
		const saga = await db.query.dbSagas.findFirst({
			where: eq(dbSagas.slug, arc.sagaSlug),
		});

		if (!saga) {
			logger.warn(`Saga not found for arc ${arc.slug}: ${arc.sagaSlug}`);
			continue;
		}

		const exists = await db.query.dbArcs.findFirst({
			where: eq(dbArcs.slug, arc.slug),
		});

		if (!exists) {
			await db.insert(dbArcs).values({
				sagaId: saga.id,
				slug: arc.slug,
				name: arc.name,
				orderIdx: arc.orderIdx,
			});
			inserted++;
		}
	}

	logger.info(`✓ ${inserted} new arcs inserted.`);
}

if (import.meta.main) {
	runArcSeed()
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
