import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { like } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacters, dbTransformations } from "~/db/schema";

/**
 * Importe les formes/transformations Xenoverse 2 dans db_transformations.
 *
 * Catalogue-driven : chaque code XV2 dont le nom contient une forme entre
 * parenthèses (« Son Goku (Super Saiyen 4) ») est rattaché au personnage de base
 * (« Goku ») via appariement par nom canonique, avec son portrait XV2 comme image.
 *
 * Idempotent : purge d'abord les transformations XV2 (image sous xv2-portraits),
 * sans toucher aux 43 transformations curées existantes.
 * Lancer : `bun db:seed-xv2-transformations` (après seed-xv2-characters).
 */
const PORTRAIT_DIR = "./assets/dbz/xv2-portraits";
const catalog: { characters: Record<string, string> } = JSON.parse(
	readFileSync("./assets/dbz/xv2-catalog.json", "utf-8")
);

const SYN: Record<string, string> = {
	songoku: "goku",
	songohan: "gohan",
	songoten: "goten",
	krilin: "krillin",
	bills: "beerus",
	celula: "cell",
	majinbuu: "buu",
	boo: "buu",
	vegeto: "vegetto",
	msatan: "mrsatan",
	satan: "mrsatan",
	doria: "dodoria",
	vermoud: "vermoudh",
};
const canon = (s: string) => {
	const n = s
		.split(/[,(]/)[0]
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/^c-?(\d+)/, "android$1")
		.replace(/[^a-z0-9]/g, "");
	return SYN[n] ?? n;
};

const portraitCodes = new Set(
	readdirSync(PORTRAIT_DIR)
		.filter((f) => /^[A-Z0-9]{3}\.png$/.test(f))
		.map((f) => f.slice(0, 3))
);

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

// purge des transfos XV2 précédentes
await db.delete(dbTransformations).where(like(dbTransformations.image, "%xv2-portraits%"));

const chars = await db.select({ id: dbCharacters.id, name: dbCharacters.name }).from(dbCharacters);
const byCanon = new Map(chars.map((c) => [canon(c.name), c.id]));

let added = 0;
const seen = new Set<string>();
const unlinked = new Set<string>();
for (const [code, raw] of Object.entries(catalog.characters)) {
	const m = raw.match(/^(.+?)\s*\((.+)\)\s*$/);
	if (!m || !portraitCodes.has(code)) continue;
	const baseName = m[1]!.trim();
	const form = m[2]!.trim();
	// ignore les variantes d'âge / de période (pas de vraies transformations)
	if (/^(petit|ado|adulte|enfant|jeune|bébé|\d+\s*ans|du futur|gt|base|jeunesse)$/i.test(form))
		continue;
	const charId = byCanon.get(canon(baseName));
	if (!charId) {
		unlinked.add(baseName);
		continue;
	}
	const dedup = `${charId}:${form.toLowerCase()}`;
	if (seen.has(dedup)) continue;
	seen.add(dedup);
	await db.insert(dbTransformations).values({
		name: form,
		image: `${PORTRAIT_DIR}/${code}.png`,
		characterId: charId,
	});
	added++;
}

console.log(`✓ ${added} transformations XV2 ajoutées`);
if (unlinked.size) console.log(`  (formes sans perso de base : ${[...unlinked].join(", ")})`);
const total = await db.select({ id: dbTransformations.id }).from(dbTransformations);
console.log(`→ db_transformations : ${total.length}`);
dbs.close();
