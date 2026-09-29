import "reflect-metadata";
import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbTechniques } from "~/db/schema";

/**
 * Seed du catalogue de compétences Dragon Ball Xenoverse 2 dans db_techniques.
 *
 * Source : `assets/dbz/xv2-catalog.json` (noms FR extraits du jeu via dbxv2,
 * fichiers `proper_noun_skill_*_name_fr.msg`). 4 catégories XV2 :
 *   super (compétences spéciales), ultimate (ultimes), awoken (transformations),
 *   evasive (esquives).
 *
 * Additif et idempotent : on n'insère qu'un nom de technique ABSENT de la base
 * (comparaison normalisée — accents/casse/ponctuation ignorés), pour ne jamais
 * écraser les 120 techniques curées existantes ni créer de doublon. type = la
 * catégorie XV2. slug unique généré depuis le nom.
 *
 * Lancer : `bun src/db/seed-xv2-techniques.ts` (ou `bun db:seed-xv2-techniques`).
 */
type SkillEntry = { name: string; desc: string };
type Catalog = {
	skills: Record<"super" | "ultimate" | "awoken" | "evasive", Record<string, SkillEntry>>;
};

const catalog: Catalog = JSON.parse(readFileSync("./assets/dbz/xv2-catalog.json", "utf-8"));

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, "");

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

// Idempotence : on purge nos imports XV2 précédents (typés) pour rafraîchir
// noms/descriptions, sans toucher aux techniques curées (type NULL).
const CAT_VALUES = ["super", "ultimate", "awoken", "evasive"];
await db.delete(dbTechniques).where(inArray(dbTechniques.type, CAT_VALUES));

// Index des techniques déjà présentes (normalisé) + slugs pris.
const existing = await db
	.select({ name: dbTechniques.name, slug: dbTechniques.slug })
	.from(dbTechniques);
const seenNames = new Set(existing.map((t) => norm(t.name)));
const usedSlugs = new Set(existing.map((t) => t.slug));

const CATS: Array<keyof Catalog["skills"]> = ["super", "ultimate", "awoken", "evasive"];
let inserted = 0;
const perCat: Record<string, number> = {};

for (const cat of CATS) {
	perCat[cat] = 0;
	for (const entry of Object.values(catalog.skills[cat])) {
		const key = norm(entry.name);
		if (!key || seenNames.has(key)) continue;
		seenNames.add(key);

		let slug = slugify(entry.name) || `xv2-${cat}-${inserted}`;
		let n = 1;
		while (usedSlugs.has(slug)) slug = `${slugify(entry.name)}-${++n}`;
		usedSlugs.add(slug);

		await db.insert(dbTechniques).values({
			slug,
			name: entry.name,
			type: cat,
			description: entry.desc || null,
		});
		inserted++;
		perCat[cat]++;
	}
}

console.log(
	`✓ ${inserted} techniques XV2 importées (${CATS.map((c) => `${c}:${perCat[c]}`).join(" ")})`
);
dbs.close();
