import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacters } from "~/db/schema";

/**
 * Ajoute les personnages Dragon Ball Xenoverse 2 ABSENTS de db_characters.
 *
 * Catalogue-driven (`assets/dbz/xv2-catalog.json`, noms FR du jeu) + portraits
 * (`assets/dbz/xv2-portraits/<CODE>.png`). N'ajoute qu'un perso :
 *   - qui possède un portrait (colonne image NOT NULL),
 *   - dont le nom est une FORME DE BASE (pas une transfo « (Super Saiyen…) »),
 *   - absent de la base (dédup par nom canonique + synonymes),
 *   - qui n'est pas du bruit (grand singe, variante, robot/NPC, avatar CaC…).
 *
 * À lancer APRÈS seed-xv2-portraits.ts. Additif/idempotent (onConflictDoNothing).
 * Lancer : `bun db:seed-xv2-characters`.
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

// bruit à exclure (transfos grand singe, variantes techniques, NPC/robots, avatars)
const BLOCK = /gorille géant|variante|robot|réception|éclairé|^tous$/i;
const isAvatarCode = (c: string) => /^XA[A-Z]$/.test(c);

const portraitCodes = new Set(
	readdirSync(PORTRAIT_DIR)
		.filter((f) => /^[A-Z0-9]{3}\.png$/.test(f))
		.map((f) => f.slice(0, 3))
);

const dbs = container.resolve(DatabaseService);
const db = dbs.db;
const existing = await db.select({ name: dbCharacters.name }).from(dbCharacters);
const existingKeys = new Set(existing.map((c) => canon(c.name)));

const added: string[] = [];
const seen = new Set<string>();
for (const [code, raw] of Object.entries(catalog.characters)) {
	if (!portraitCodes.has(code) || isAvatarCode(code)) continue;
	if (/[(）]/.test(raw)) continue; // forme transformée → géré par db_transformations
	if (BLOCK.test(raw)) continue;
	const k = canon(raw);
	if (!k || existingKeys.has(k) || seen.has(k)) continue;
	seen.add(k);
	const rel = `${PORTRAIT_DIR}/${code}.png`;
	await db
		.insert(dbCharacters)
		.values({
			name: raw,
			image: rel,
			portraitXv2: rel,
			description: "Personnage jouable de Dragon Ball Xenoverse 2.",
		})
		.onConflictDoNothing();
	added.push(`${code} → ${raw}`);
}

console.log(`✓ ${added.length} nouveaux persos XV2 ajoutés`);
for (const a of added) console.log(`    + ${a}`);
const total = await db.select({ id: dbCharacters.id }).from(dbCharacters);
console.log(`→ db_characters : ${total.length} persos`);
dbs.close();
