import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacters } from "~/db/schema";

/**
 * Seed des portraits Xenoverse 2 sur db_characters.portraitXv2.
 *
 * 100 % CATALOGUE-DRIVEN : la source de vérité est `assets/dbz/xv2-catalog.json`
 * (code XV2 → nom FR exact du jeu, extrait des .msg). On apparie chaque perso
 * shenron au code XV2 par NOM (normalisé + synonymes), puis on pose le portrait
 * `assets/dbz/xv2-portraits/<CODE>.png` quand il existe.
 *
 * Pourquoi pas une table id→code en dur : elle s'est révélée erronée (ex. G13 =
 * "Bulma" et non Android 13, BUU = "Fu" et non Majin Buu). L'appariement par nom
 * factuel du jeu élimine ces erreurs. Mapping conservateur : un perso n'est lié
 * qu'à un code dont le nom correspond.
 *
 * Lancer : `bun src/db/seed-xv2-portraits.ts` (ou `bun db:seed-xv2-portraits`).
 */
const PORTRAIT_DIR = "./assets/dbz/xv2-portraits";
const catalog: { characters: Record<string, string> } = JSON.parse(
	readFileSync("./assets/dbz/xv2-catalog.json", "utf-8")
);

// Synonymes -> token canonique commun aux deux côtés (shenron vs nom du jeu).
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
};
const canon = (s: string) => {
	const n = s
		.split(/[,(]/)[0] // coupe sous-titre "(Super Saiyen 4)" / ", dieu..."
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

// canon(nom du jeu) -> meilleur code : préfère portrait + forme de base (sans parenthèse).
const byName = new Map<string, string>();
for (const [code, raw] of Object.entries(catalog.characters)) {
	const k = canon(raw);
	if (!k) continue;
	const cur = byName.get(k);
	if (!cur) {
		byName.set(k, code);
		continue;
	}
	const score = (c: string, name: string) =>
		(portraitCodes.has(c) ? 2 : 0) + (/[(),]/.test(name) ? 0 : 1);
	if (score(code, raw) > score(cur, catalog.characters[cur] ?? "")) byName.set(k, code);
}

const dbs = container.resolve(DatabaseService);
const db = dbs.db;
const existing = await db
	.select({ id: dbCharacters.id, name: dbCharacters.name })
	.from(dbCharacters);

let set = 0;
const unmatched: string[] = [];
for (const c of existing) {
	const code = byName.get(canon(c.name));
	if (code && portraitCodes.has(code)) {
		await db
			.update(dbCharacters)
			.set({ portraitXv2: `${PORTRAIT_DIR}/${code}.png` })
			.where(eq(dbCharacters.id, c.id));
		set++;
		console.log(`  ✓ ${c.name} → ${code}.png (${catalog.characters[code]})`);
	} else {
		unmatched.push(c.name);
	}
}
console.log(`✓ ${set}/${existing.length} portraits XV2 posés`);
if (unmatched.length) console.log(`  non appariés (${unmatched.length}) : ${unmatched.join(", ")}`);
dbs.close();
