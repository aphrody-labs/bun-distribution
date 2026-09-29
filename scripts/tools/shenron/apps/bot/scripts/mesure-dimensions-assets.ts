#!/usr/bin/env bun
/**
 * Renseigne `width`/`height` sur les médias de `bot.db_assets` qui n'en ont pas.
 *
 * Mesuré le 2026-09-03 : 801 des 1 142 médias avaient ces deux colonnes à NULL —
 * tous les ingests antérieurs les laissaient vides. Sans elles, la galerie ne peut
 * ni afficher la taille d'une image, ni repérer une vignette trop petite pour la
 * fiche qu'elle illustre.
 *
 * Les fichiers vivent dans DEUX racines, et les confondre fait conclure à tort
 * qu'une image est perdue : le miroir DB dans `apps/bot/public/db/`, les médias du
 * wiki dans `apps/site/public/wiki/`. Le chemin en base n'est jamais un chemin de
 * disque.
 *
 * Lecture seule sur les fichiers : on mesure, on n'y touche pas. `sharp` ne
 * réencode rien ici (`metadata()` seul) — il palettiserait un PNG s'il l'écrivait.
 *
 * Usage :
 *   bun apps/bot/scripts/mesure-dimensions-assets.ts --simulation
 *   bun apps/bot/scripts/mesure-dimensions-assets.ts
 */
import { join } from "node:path";
import postgres from "postgres";
import sharp from "sharp";

const SIMULATION = process.argv.includes("--simulation");
const RACINE_BOT = join(import.meta.dir, "..");
const RACINE_DB = join(RACINE_BOT, "public", "db");
const RACINE_WIKI = join(RACINE_BOT, "..", "site", "public", "wiki");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(RACINE_BOT, "..", "site", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

/** Les deux racines, dans l'ordre où il faut les essayer. */
function candidats(chemin: string): string[] {
	const propre = chemin.replace(/^\.?\//, "");
	if (propre.startsWith("assets/wiki/")) {
		return [join(RACINE_WIKI, propre.replace(/^assets\/wiki\//, ""))];
	}
	return [join(RACINE_DB, propre), join(RACINE_WIKI, propre)];
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	const manquants = (await sql`
		select id, path from bot.db_assets where width is null or height is null order by id
	`) as unknown as { id: number; path: string }[];
	console.log(`${manquants.length} média(s) sans dimensions.\n`);

	let mesures = 0,
		introuvables = 0,
		illisibles = 0;
	for (const media of manquants) {
		let fichier: string | null = null;
		for (const candidat of candidats(media.path)) {
			if (await Bun.file(candidat).exists()) {
				fichier = candidat;
				break;
			}
		}
		if (!fichier) {
			introuvables++;
			continue;
		}

		try {
			const meta = await sharp(await Bun.file(fichier).arrayBuffer()).metadata();
			if (!meta.width || !meta.height) {
				illisibles++;
				continue;
			}
			if (!SIMULATION) {
				await sql`
					update bot.db_assets set width = ${meta.width}, height = ${meta.height}
					where id = ${media.id}
				`;
			}
			mesures++;
			if (mesures % 100 === 0) console.log(`  ${mesures} mesurés…`);
		} catch {
			// Fichier tronqué ou format que sharp ne lit pas : on le compte, on ne devine pas.
			illisibles++;
		}
	}

	console.log(
		`\n${mesures} ${SIMULATION ? "mesurable(s)" : "mesuré(s)"} · ${introuvables} fichier(s) introuvable(s) · ${illisibles} illisible(s).`
	);
	if (SIMULATION) console.log("(simulation — relancer sans --simulation)");
} finally {
	await sql.end();
}
