import "reflect-metadata";
import { readFileSync } from "node:fs";
import { isNull, notInArray } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacterTechniques, dbCharacters, dbTechniques } from "~/db/schema";

/**
 * Lie chaque personnage à ses compétences Xenoverse 2 (db_character_techniques).
 *
 * Source : `assets/dbz/xv2-skillsets.json` (code XV2 → loadout super/ultimate/
 * evasive/awoken), décodé depuis `system/custom_skill.cus` + `char_model_spec.cms`
 * côté dbxv2 (chaîne CMS→CUS→.msg validée : Goku ressort avec Kamehameha, Genkidama…).
 *
 * Apparie le code au personnage shenron (via le catalogue + nom canonique) et
 * chaque nom de compétence à une ligne db_techniques. Idempotent : purge d'abord
 * les liens vers des techniques de type XV2 avant de réinsérer.
 *
 * Lancer : `bun db:seed-xv2-char-techniques` (après techniques + characters).
 */
const skillsets: Record<string, Record<string, string[]>> = JSON.parse(
	readFileSync("./assets/dbz/xv2-skillsets.json", "utf-8")
);
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
const normT = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, "");

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

// maps : nom canonique perso -> id ; nom normalisé technique -> id
const chars = await db.select({ id: dbCharacters.id, name: dbCharacters.name }).from(dbCharacters);
const charByCanon = new Map(chars.map((c) => [canon(c.name), c.id]));
const techs = await db.select({ id: dbTechniques.id, name: dbTechniques.name }).from(dbTechniques);
const techByName = new Map(techs.map((t) => [normT(t.name), t.id]));

// purge robuste : on retire TOUT lien dont la technique n'est PAS curée
// (type NULL). Couvre les liens XV2 ET les liens orphelins (le seed techniques
// supprime/réinsère les techniques XV2 -> leurs ids changent à chaque run).
const curatedTechIds = (
	await db.select({ id: dbTechniques.id }).from(dbTechniques).where(isNull(dbTechniques.type))
).map((t) => t.id);
await db
	.delete(dbCharacterTechniques)
	.where(notInArray(dbCharacterTechniques.techniqueId, curatedTechIds));

// liens existants (pour ne pas dupliquer)
const existingPairs = new Set(
	(
		await db
			.select({ c: dbCharacterTechniques.characterId, t: dbCharacterTechniques.techniqueId })
			.from(dbCharacterTechniques)
	).map((p) => `${p.c}:${p.t}`)
);

let links = 0;
let linkedChars = 0;
let unresolvedTech = 0;
for (const [code, cats] of Object.entries(skillsets)) {
	const charName = catalog.characters[code];
	if (!charName) continue;
	const charId = charByCanon.get(canon(charName));
	if (!charId) continue;
	let any = false;
	for (const names of Object.values(cats)) {
		for (const skill of names) {
			const techId = techByName.get(normT(skill));
			if (!techId) {
				unresolvedTech++;
				continue;
			}
			const key = `${charId}:${techId}`;
			if (existingPairs.has(key)) continue;
			existingPairs.add(key);
			await db.insert(dbCharacterTechniques).values({ characterId: charId, techniqueId: techId });
			links++;
			any = true;
		}
	}
	if (any) linkedChars++;
}

console.log(`✓ ${links} liens perso↔technique XV2 (${linkedChars} persos liés)`);
if (unresolvedTech)
	console.log(`  (${unresolvedTech} occurrences de compétences sans technique en base)`);
const total = await db.select({ c: dbCharacterTechniques.characterId }).from(dbCharacterTechniques);
console.log(`→ db_character_techniques : ${total.length} liens`);
dbs.close();
