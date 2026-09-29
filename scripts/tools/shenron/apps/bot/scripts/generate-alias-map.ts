/**
 * generate-alias-map.ts — Génère la table d'alias pour la canonicalisation des entités (PLAN A3).
 *
 * Lit la base SQLite, extrait les personnages, planètes, techniques, sagas, races, etc.
 * Normalise les noms, associe les écritures japonaises/romaji, intègre des synonymes historiques
 * (ex: Sangoku -> Goku, Frieza -> Freezer, Cell -> Celula) et écrit le résultat dans alias-map.json.
 *
 * Usage : bun apps/bot/scripts/generate-alias-map.ts
 */
import { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DBP = process.env.RAG_DB ?? new URL("../data/bot.db", import.meta.url).pathname;
const OUT_DIR = new URL("../data/rag/", import.meta.url).pathname;
const OUT_PATH = join(OUT_DIR, "alias-map.json");

mkdirSync(OUT_DIR, { recursive: true });

interface AliasTarget {
	canonical: string;
	type: string;
	id: string;
}

const aliasMap: Record<string, AliasTarget> = {};

function normalizeKey(str: string): string {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Enlève les accents
		.replace(/[^a-z0-9]/g, " ") // Remplace les caractères spéciaux par des espaces
		.replace(/\s+/g, " ") // Collapse les espaces multiples
		.trim();
}

function addAlias(variant: string, target: AliasTarget) {
	const norm = normalizeKey(variant);
	if (!norm) return;
	// Ne pas écraser si déjà présent (conserve la priorité)
	if (!aliasMap[norm]) {
		aliasMap[norm] = target;
	}
	// Enlever les espaces si contient plusieurs mots (ex: "son goku" -> "songoku")
	if (norm.includes(" ")) {
		const noSpaces = norm.replace(/\s+/g, "");
		if (!aliasMap[noSpaces]) {
			aliasMap[noSpaces] = target;
		}
	}
}

async function main() {
	console.log("=== GÉNÉRATION DE L'ALIAS-MAP DRAGON BALL ===");
	const db = new Database(DBP, { readonly: true });

	const q = (sql: string) => db.query(sql).all() as any[];

	// 1. Personnages
	console.log("-> Extraction des personnages…");
	const characters = q("SELECT id, name, name_ja, name_romaji FROM db_characters");
	for (const c of characters) {
		const target: AliasTarget = { canonical: c.name, type: "character", id: String(c.id) };
		addAlias(c.name, target);
		if (c.name_ja) addAlias(c.name_ja, target);
		if (c.name_romaji) addAlias(c.name_romaji, target);

		// Synonymes historiques & variations de traduction
		const nameLower = c.name.toLowerCase();
		if (nameLower === "goku") {
			addAlias("sangoku", target);
			addAlias("son goku", target);
			addAlias("son gokuu", target);
			addAlias("kakarot", target);
			addAlias("kakarotto", target);
			addAlias("gokū", target);
		} else if (nameLower === "vegeta") {
			addAlias("végéta", target);
			addAlias("bejita", target);
		} else if (nameLower === "freezer") {
			addAlias("frieza", target);
			addAlias("furīza", target);
		} else if (nameLower === "celula") {
			addAlias("cell", target);
			addAlias("seru", target);
		} else if (nameLower === "krillin") {
			addAlias("krilin", target);
			addAlias("kuririn", target);
		} else if (nameLower === "majin boo" || nameLower === "majin buu") {
			addAlias("boo", target);
			addAlias("buu", target);
			addAlias("majin buu", target);
			addAlias("majin boo", target);
		} else if (nameLower === "mr. satan") {
			addAlias("hercule", target);
			addAlias("hercule satan", target);
			addAlias("satan", target);
		} else if (nameLower === "piccolo") {
			addAlias("petit coeur", target);
			addAlias("petit-coeur", target);
			addAlias("pikkoro", target);
		} else if (nameLower === "gohan") {
			addAlias("son gohan", target);
			addAlias("son gohanu", target);
		} else if (nameLower === "goten") {
			addAlias("son goten", target);
		} else if (nameLower === "gotenks") {
			addAlias("gotex", target);
			addAlias("gotenx", target);
		} else if (nameLower === "gogeta") {
			addAlias("gogéta", target);
		} else if (nameLower === "vegetto" || nameLower === "vegito") {
			addAlias("vegetto", target);
			addAlias("vegito", target);
			addAlias("bégito", target);
			addAlias("begito", target);
		} else if (nameLower === "jiren") {
			addAlias("jiren le gris", target);
		} else if (nameLower === "yamcha") {
			addAlias("yamcha", target);
			addAlias("yamchaa", target);
		} else if (nameLower === "tenshinhan" || nameLower === "tien") {
			addAlias("tien", target);
			addAlias("ten shin han", target);
		} else if (nameLower === "roshi" || nameLower === "master roshi") {
			addAlias("tortue geniale", target);
			addAlias("tortue géniale", target);
			addAlias("muten roshi", target);
			addAlias("kame sennin", target);
		} else if (nameLower === "c-17" || nameLower === "android 17") {
			addAlias("c17", target);
			addAlias("c-17", target);
			addAlias("android 17", target);
			addAlias("androide 17", target);
			addAlias("cyber-guerrier 17", target);
		} else if (nameLower === "c-18" || nameLower === "android 18") {
			addAlias("c18", target);
			addAlias("c-18", target);
			addAlias("android 18", target);
			addAlias("androide 18", target);
		} else if (nameLower === "c-16" || nameLower === "android 16") {
			addAlias("c16", target);
			addAlias("c-16", target);
			addAlias("android 16", target);
			addAlias("androide 16", target);
		}
	}

	// 2. Planètes
	console.log("-> Extraction des planètes…");
	const planets = q("SELECT id, name, name_ja FROM db_planets");
	for (const p of planets) {
		const target: AliasTarget = { canonical: p.name, type: "planet", id: String(p.id) };
		addAlias(p.name, target);
		if (p.name_ja) addAlias(p.name_ja, target);

		if (p.name.toLowerCase() === "namek") {
			addAlias("planete namek", target);
			addAlias("nouvelle namek", target);
			addAlias("nouvelle planete namek", target);
		} else if (p.name.toLowerCase() === "vegeta") {
			addAlias("planete vegeta", target);
			addAlias("planète végéta", target);
		}
	}

	// 3. Techniques
	console.log("-> Extraction des techniques…");
	const techniques = q("SELECT slug, name, name_ja FROM db_techniques");
	for (const t of techniques) {
		const target: AliasTarget = { canonical: t.name, type: "technique", id: t.slug };
		addAlias(t.name, target);
		if (t.name_ja) addAlias(t.name_ja, target);

		const nameLower = t.name.toLowerCase();
		if (nameLower === "kamehameha") {
			addAlias("kame-hame-ha", target);
			addAlias("kamehame ha", target);
		} else if (nameLower === "genki dama" || nameLower === "spirit bomb") {
			addAlias("genkidama", target);
			addAlias("orbe d energie", target);
			addAlias("orbe d'énergie", target);
			addAlias("spirit bomb", target);
		} else if (nameLower === "kaioken") {
			addAlias("kaio-ken", target);
			addAlias("kaio ken", target);
		} else if (nameLower === "makankosappo" || nameLower === "special beam cannon") {
			addAlias("makan kosappo", target);
			addAlias("murasakibara", target);
			addAlias("canon demoniaque", target);
			addAlias("canon démoniaque", target);
			addAlias("special beam cannon", target);
		} else if (nameLower === "final flash") {
			addAlias("flash final", target);
		} else if (nameLower === "masenko") {
			addAlias("masenkô", target);
		} else if (nameLower === "kienzan" || nameLower === "destructo disc") {
			addAlias("kien-zan", target);
			addAlias("kien zan", target);
			addAlias("destructo disc", target);
			addAlias("disque d energie", target);
			addAlias("disque d'énergie", target);
		}
	}

	// 4. Races
	console.log("-> Extraction des races…");
	const races = q("SELECT slug, name, name_ja FROM db_races");
	for (const r of races) {
		const target: AliasTarget = { canonical: r.name, type: "race", id: r.slug };
		addAlias(r.name, target);
		if (r.name_ja) addAlias(r.name_ja, target);

		if (r.name.toLowerCase() === "saiyan") {
			addAlias("saiyans", target);
			addAlias("sayen", target);
			addAlias("sayens", target);
			addAlias("guerrier de l espace", target);
			addAlias("guerriers de l espace", target);
		} else if (r.name.toLowerCase() === "namekian" || r.name.toLowerCase() === "namek") {
			addAlias("namekiens", target);
			addAlias("namekienne", target);
		}
	}

	// 5. Sagas
	console.log("-> Extraction des sagas…");
	const sagas = q("SELECT slug, name, name_ja FROM db_sagas");
	for (const s of sagas) {
		const target: AliasTarget = { canonical: s.name, type: "saga", id: s.slug };
		addAlias(s.name, target);
		if (s.name_ja) addAlias(s.name_ja, target);
		addAlias(`saga ${s.name}`, target);
	}

	db.close();

	// Enregistrer le fichier
	writeFileSync(OUT_PATH, JSON.stringify(aliasMap, null, 2));
	console.log(
		`✓ Alias-map générée avec succès : ${Object.keys(aliasMap).length} alias -> ${OUT_PATH}`
	);
}

main().catch((e) => {
	console.error("✗ Erreur lors de la génération de l'alias-map :", e);
	process.exit(1);
});
