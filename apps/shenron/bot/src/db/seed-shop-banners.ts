import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { shopItems } from "~/db/schema";
import { eq } from "drizzle-orm";

/**
 * Seed des 9 bannières cosmétiques disponibles dans le shop.
 * Les 10 autres sont déjà mappées aux niveaux (seed-level-rewards.ts).
 * Prix échelonnés selon rareté narrative (cinéma vs scène iconique).
 */
const SHOP_BANNERS: Array<{
	key: string;
	name: string;
	description: string;
	price: number;
	bannerPath: string;
}> = [
	{
		key: "banner_janemba_red",
		name: "Janemba Démoniaque",
		description: "Forme finale de Janemba, antagoniste de Fusion Reborn",
		price: 3500,
		bannerPath: "assets/banners/banner-01.jpg",
	},
	{
		key: "banner_z_warriors",
		name: "Z Warriors Portrait",
		description: "Portrait classique de l'équipe Z (Vegeta, Goku, Cell...)",
		price: 2000,
		bannerPath: "assets/banners/banner-03.png",
	},
	{
		key: "banner_goku_chichi_wedding",
		name: "Mariage Goku & ChiChi",
		description: "La fin du premier Dragon Ball, l'union légendaire",
		price: 1500,
		bannerPath: "assets/banners/banner-05.jpg",
	},
	{
		key: "banner_gogeta_vs_janemba",
		name: "Gogeta Punch Janemba",
		description: "La scène la plus iconique de Fusion Reborn",
		price: 4000,
		bannerPath: "assets/banners/banner-09.png",
	},
	{
		key: "banner_pilaf_goku_gt",
		name: "Pilaf & Goku GT",
		description: "Le souhait d'Émeraude — début de Dragon Ball GT",
		price: 1800,
		bannerPath: "assets/banners/banner-13.png",
	},
	{
		key: "banner_vegito_charging",
		name: "Vegito SSB Spirit Bomb",
		description: "Vegito Super Saiyan Blue chargeant son attaque divine",
		price: 5000,
		bannerPath: "assets/banners/banner-15.jpg",
	},
	{
		key: "banner_black_pink_eyes",
		name: "Goku Black Rosé",
		description: "Le regard glaçant du Saiyan Rosé à travers le miroir brisé",
		price: 3000,
		bannerPath: "assets/banners/banner-16.png",
	},
	{
		key: "banner_black_ruins",
		name: "Black & Ruines Violettes",
		description: "Goku Black contemplant son monde 'purifié'",
		price: 2500,
		bannerPath: "assets/banners/banner-18.jpg",
	},
	{
		key: "banner_goku_gohan_ssj3",
		name: "Goku & Gohan SSJ3",
		description: "Père et fils en pleine puissance Super Saiyan",
		price: 4500,
		bannerPath: "assets/banners/banner-19.png",
	},
];

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

// Cleanup anciens banner items éventuels
await db.delete(shopItems).where(eq(shopItems.type, "banner"));

for (const b of SHOP_BANNERS) {
	await db.insert(shopItems).values({
		key: b.key,
		type: "banner",
		name: b.name,
		description: b.description,
		price: b.price,
		roleId: null,
		meta: JSON.stringify({ bannerPath: b.bannerPath }),
		enabled: true,
	});
	console.log(`  ✓ ${b.key.padEnd(28)} ${b.price.toString().padStart(5)} Ƶ · ${b.name}`);
}

console.log(`✓ ${SHOP_BANNERS.length} shop banners seeded`);
dbs.close();
