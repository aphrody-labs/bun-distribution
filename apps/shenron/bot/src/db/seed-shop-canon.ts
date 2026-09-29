import "reflect-metadata";
import { container } from "tsyringe";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { shopItems } from "~/db/schema";
import { CANON_PRICES } from "~/lib/economy-canon";
import { formatZeni } from "~/lib/zeni";

/**
 * Catalogue « économie réelle » : titres et badges dont le prix EST le prix
 * canon de l'univers (Chōzenshū 4, planche 40), et non une valeur de jeu.
 *
 * La boutique ne contenait que des bannières et des couleurs : aucun titre,
 * aucun badge. Ce seed les ajoute sans toucher aux articles existants.
 *
 * Emblèmes : les deux kanji vérifiés sont ceux du dogi de Goku, la tortue de
 * Kamé Sennin (亀) devant et l'emblème de Kaiô (界) dans le dos (Kanzenshuu,
 * « Kanji Symbol Guide »). Les deux autres (龍, 銭) sont des sceaux
 * thématiques du serveur et ne revendiquent aucune origine canon.
 *
 * Usage :
 *   bun src/db/seed-shop-canon.ts            # affiche le plan, n'écrit rien
 *   bun src/db/seed-shop-canon.ts --apply    # insère les articles absents
 */
const APPLY = process.argv.includes("--apply");
const canon = (key: string) => {
	const p = CANON_PRICES.find((c) => c.key === key);
	if (!p) throw new Error(`Repère canon inconnu : ${key}`);
	return p;
};

type Seed = {
	key: string;
	type: "title" | "badge";
	name: string;
	description: string;
	price: number;
	meta?: Record<string, string>;
};

const SEEDS: Seed[] = [
	{
		key: "title_taxi",
		type: "title",
		name: "Usager du taxi de West City",
		description: `Au prix exact d'une course de taxi dans l'univers : ${formatZeni(canon("taxi").zeni)} (${canon("taxi").source.title}).`,
		price: canon("taxi").zeni,
	},
	{
		key: "title_capsule",
		type: "title",
		name: "Abonné au système Capsule",
		description: `Le prix de l'intégration au système Capsule : ${formatZeni(canon("capsule").zeni)} (${canon("capsule").source.title}).`,
		price: canon("capsule").zeni,
	},
	{
		key: "title_budokai",
		type: "title",
		name: "Champion du Tenkaichi Budokai",
		description: `Le prix remis au vainqueur : ${formatZeni(canon("budokai").zeni)} (${canon("budokai").source.title}).`,
		price: canon("budokai").zeni,
	},
	{
		key: "title_house",
		type: "title",
		name: "Propriétaire à West City",
		description: `Une maison individuelle, Capsule comprise : ${formatZeni(canon("house").zeni)} (${canon("house").source.title}).`,
		price: canon("house").zeni,
	},
	{
		key: "title_aircar",
		type: "title",
		name: "Pilote d'aircar",
		description: `Un aircar quatre places : ${formatZeni(canon("aircar").zeni)} (${canon("aircar").source.title}).`,
		price: canon("aircar").zeni,
	},
	{
		key: "title_baba",
		type: "title",
		name: "Client de Baba la voyante",
		description: `Une consultation : ${formatZeni(canon("baba").zeni)} (${canon("baba").source.title}).`,
		price: canon("baba").zeni,
	},
	{
		key: "title_taopaipai",
		type: "title",
		name: "Commanditaire de Tao Pai Pai",
		description: `Le tarif d'un contrat : ${formatZeni(canon("taopaipai").zeni)} par cible (${canon("taopaipai").source.title}).`,
		price: canon("taopaipai").zeni,
	},
	{
		key: "badge_kame",
		type: "badge",
		name: "Sceau de la tortue (亀)",
		description: "Le kanji porté par les élèves de Kamé Sennin, sur le devant du dogi de Goku.",
		price: canon("capsule").zeni,
		meta: { badgePath: "badges/badge-kame.svg" },
	},
	{
		key: "badge_kaio",
		type: "badge",
		name: "Emblème de Kaiô (界)",
		description: "L'emblème de Kaiô, dans le dos du dogi de Goku après son entraînement dans l'au-delà.",
		price: canon("house").zeni,
		meta: { badgePath: "badges/badge-kaio.svg" },
	},
	{
		key: "badge_shenron",
		type: "badge",
		name: "Sceau de Shenron (龍)",
		description: "Sceau du serveur Dragon Ball France.",
		price: canon("budokai_late").zeni,
		meta: { badgePath: "badges/badge-shenron.svg" },
	},
	{
		key: "badge_zeni",
		type: "badge",
		name: "Pièce de zéni (銭)",
		description: "Sceau des grandes fortunes du serveur.",
		price: canon("aircar").zeni,
		meta: { badgePath: "badges/badge-zeni.svg" },
	},
];

async function main() {
	const dbs = container.resolve(DatabaseService);
	let added = 0;
	for (const s of SEEDS) {
		const existing = await dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, s.key) });
		const line = `${s.type.padEnd(6)} ${s.key.padEnd(18)} ${formatZeni(s.price).padStart(16)} · ${s.name}`;
		if (existing) {
			console.log(`  = ${line} (déjà présent, inchangé)`);
			continue;
		}
		console.log(`  ${APPLY ? "+" : "~"} ${line}`);
		if (APPLY) {
			await dbs.db.insert(shopItems).values({
				key: s.key,
				type: s.type,
				name: s.name,
				description: s.description,
				price: s.price,
				roleId: null,
				meta: s.meta ? JSON.stringify(s.meta) : null,
				enabled: true,
			});
			added++;
		}
	}
	console.log(APPLY ? `\n${added} article(s) ajouté(s).` : "\nPlan seulement : relancer avec --apply pour écrire.");
}

await main();
