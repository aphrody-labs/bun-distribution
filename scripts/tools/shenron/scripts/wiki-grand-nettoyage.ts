import postgres from "postgres";
import { join } from "node:path";

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envFile = join(import.meta.dir, "..", "apps", "site", ".env");
	const content = await Bun.file(envFile).text().catch(() => "");
	const line = content.split("\n").filter(l => l.startsWith("DATABASE_URL=")).at(-1);
	if (!line) throw new Error("DATABASE_URL not found in apps/site/.env");
	return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

interface Action {
	table: string;
	action: "hide" | "update_text";
	id: number | string;
	name?: string;
	keptId?: number | string;
	reason: string;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");

	const dbUrl = await getDatabaseUrl();
	const sql = postgres(dbUrl);

	console.log(`======================================================`);
	console.log(`[GRAND-NETTOYAGE] Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read only)"}`);
	console.log(`======================================================\n`);

	const actions: Action[] = [];

	// 1. PERSONNAGES EN DOUBLON / DUMMY XV2 / FORMES EN TANT QUE PERSO SEPARE
	const charDuplicates = [
		{ hideId: 108, keptId: 542, reason: "Son Goku Black (dummy XV2 #108) duplique Goku Black (#542 canon)" },
		{ hideId: 1139, keptId: 10, reason: "Son Gohan (#1139 article court) duplique Gohan (#10 article complet)" },
		{ hideId: 706, keptId: 11, reason: "Krilin (#706) duplique Krillin (#11 article complet et image officielle)" },
		{ hideId: 1236, keptId: 109, reason: "Trunks (futur) (#1236 article vide) duplique Trunks du Futur (#109)" },
		{ hideId: 102, keptId: 5, reason: "Golden Freezer (#102 dummy XV2) est une transformation de Freezer (#5, transfo #17)" },
		{ hideId: 127, keptId: 3, reason: "Piccolo Orange (#127 dummy XV2) est une transformation de Piccolo (#3, transfo #13)" },
		{ hideId: 89, keptId: 32, reason: "Super Buu (#89 dummy XV2) est une transformation de Majin Buu (#32, transfo #32)" },
		{ hideId: 103, keptId: 398, reason: "Metal Cooler (#103 dummy XV2) est une forme de Cooler (#398)" },
		{ hideId: 95, keptId: 449, reason: "Dieu démon Demigra (#95 dummy XV2) duplique Démigra (#449)" },
		{ hideId: 123, keptId: 298, reason: "C-21 (#123 dummy XV2) duplique C-21 (bon) #298 / C-21 (mauvais) #318" },
		{ hideId: 760, keptId: 90, reason: "Majin Boo (pur) (#760) duplique Kid Buu / Majin Buu Pur (#90)" },
		{ hideId: 1259, keptId: 107, reason: "Vieux Kaio Shin (#1259) duplique Vieux Kaïo Shin (#107)" },
		{ hideId: 1343, keptId: 136, reason: "Âbra (#1343) duplique Abra (#136)" },
	];

	for (const cd of charDuplicates) {
		const row = await sql<{ id: number; name: string; visible: boolean }[]>`
			SELECT id, name, visible FROM bot.db_characters WHERE id = ${cd.hideId}
		`;
		if (row.length > 0 && row[0].visible) {
			actions.push({
				table: "bot.db_characters",
				action: "hide",
				id: cd.hideId,
				name: row[0].name,
				keptId: cd.keptId,
				reason: cd.reason
			});
			if (apply) {
				await sql`UPDATE bot.db_characters SET visible = false WHERE id = ${cd.hideId}`;
				console.log(`  ✓ [bot.db_characters] Masqué: #${cd.hideId} ('${row[0].name}') -> ${cd.reason}`);
			} else {
				console.log(`  [DRY] [bot.db_characters] Masquerait: #${cd.hideId} ('${row[0].name}') -> ${cd.reason}`);
			}
		}
	}

	// 2. DOUBLONS DE PLANETES
	const planetDuplicates = [
		{ hideId: 4, keptId: 34, reason: "Freezer No. 79 (#4) duplique Planète Freezer 79 (#34)" },
		{ hideId: 13, keptId: 65, reason: "Makyo (#13) duplique Étoile Makyô (#65)" },
	];

	for (const pd of planetDuplicates) {
		const row = await sql<{ id: number; name: string; visible: boolean }[]>`
			SELECT id, name, visible FROM bot.db_planets WHERE id = ${pd.hideId}
		`;
		if (row.length > 0 && row[0].visible) {
			actions.push({
				table: "bot.db_planets",
				action: "hide",
				id: pd.hideId,
				name: row[0].name,
				keptId: pd.keptId,
				reason: pd.reason
			});
			if (apply) {
				await sql`UPDATE bot.db_planets SET visible = false WHERE id = ${pd.hideId}`;
				console.log(`  ✓ [bot.db_planets] Masqué: #${pd.hideId} ('${row[0].name}') -> ${pd.reason}`);
			} else {
				console.log(`  [DRY] [bot.db_planets] Masquerait: #${pd.hideId} ('${row[0].name}') -> ${pd.reason}`);
			}
		}
	}

	// 3. DOUBLONS DE TRANSFORMATIONS (ex: Buuhan x2, Forme finale x2)
	const transfoDuplicates = [
		{ hideId: 101, keptId: 34, reason: "Son Gohan absorbé (#101, char 32) duplique Majin Buu (Gohan) (#34, char 32)" },
		{ hideId: 89, keptId: 16, reason: "Forme finale (#89, char 5) duplique Freezer forme parfaite (#16, char 5)" },
	];

	for (const td of transfoDuplicates) {
		const row = await sql<{ id: number; name: string; visible: boolean }[]>`
			SELECT id, name, visible FROM bot.db_transformations WHERE id = ${td.hideId}
		`;
		if (row.length > 0 && row[0].visible) {
			actions.push({
				table: "bot.db_transformations",
				action: "hide",
				id: td.hideId,
				name: row[0].name,
				keptId: td.keptId,
				reason: td.reason
			});
			if (apply) {
				await sql`UPDATE bot.db_transformations SET visible = false WHERE id = ${td.hideId}`;
				console.log(`  ✓ [bot.db_transformations] Masqué: #${td.hideId} ('${row[0].name}') -> ${td.reason}`);
			} else {
				console.log(`  [DRY] [bot.db_transformations] Masquerait: #${td.hideId} ('${row[0].name}') -> ${td.reason}`);
			}
		}
	}

	// 4. CANON REFERENCES DOUBLONS
	const canonPairs = [
		{ prime: "l-echec-du-passage-de-flambeau-a-gohan", dupe: "l-echec-du-passage-de-flambeau-a-gohan-2" },
		{ prime: "la-relation-ambigue-avec-vegeta", dupe: "la-relation-ambigue-avec-vegeta-2" },
		{ prime: "mr-satan-hercule-et-l-importance-du-gag", dupe: "mr-satan-hercule-et-l-importance-du-gag-2" },
		{ prime: "piccolo-le-personnage-prefere-de-l-auteur", dupe: "piccolo-le-personnage-prefere-de-l-auteur-2" }
	];

	for (const cp of canonPairs) {
		const row = await sql<{ id: string; visible: boolean }[]>`
			SELECT id, visible FROM public.canon_references WHERE id = ${cp.dupe}
		`;
		if (row.length > 0 && row[0].visible) {
			actions.push({
				table: "public.canon_references",
				action: "hide",
				id: cp.dupe,
				keptId: cp.prime,
				reason: "Citation dupliquée avec source vague et année manquante dans la variante -2"
			});
			if (apply) {
				await sql`UPDATE public.canon_references SET visible = false WHERE id = ${cp.dupe}`;
				console.log(`  ✓ [public.canon_references] Masqué: '${cp.dupe}' (conservé '${cp.prime}')`);
			} else {
				console.log(`  [DRY] [public.canon_references] Masquerait: '${cp.dupe}' (conservé '${cp.prime}')`);
			}
		}
	}

	// 5. CORRECTION DU MOT DOUBLE EN DESCRIPTION
	const char761 = await sql<{ id: number; description: string }[]>`
		SELECT id, description FROM bot.db_characters WHERE id = 761
	`;
	if (char761[0]?.description?.includes("était la forme forme prise")) {
		actions.push({
			table: "bot.db_characters",
			action: "update_text",
			id: 761,
			reason: "Correction du mot doublon 'forme forme' -> 'forme' dans la description"
		});
		if (apply) {
			await sql`
				UPDATE bot.db_characters
				SET description = replace(description, 'était la forme forme prise', 'était la forme prise')
				WHERE id = 761
			`;
			console.log(`  ✓ [bot.db_characters] Description de #761 nettoyée ('forme forme' -> 'forme')`);
		} else {
			console.log(`  [DRY] [bot.db_characters] Nettoierait description de #761`);
		}
	}

	// 6. CORRECTION FAUTES CANON CONFIG
	const canonConfigRow = await sql<{ id: string; data: any }[]>`
		SELECT id, data FROM public."CanonConfig" LIMIT 1
	`;
	if (canonConfigRow.length > 0) {
		const cfg = canonConfigRow[0];
		const rawJson = JSON.stringify(cfg.data);
		let correctedJson = rawJson;
		let modified = false;

		if (rawJson.includes("Drragon Ball Sparking Zero")) {
			correctedJson = correctedJson.replace(/Drragon Ball Sparking Zero/g, "Dragon Ball Sparking Zero");
			modified = true;
		}
		if (rawJson.includes("non intégrer à l'œuvre")) {
			correctedJson = correctedJson.replace(/non intégrer à l'œuvre/g, "non intégrés à l'œuvre");
			modified = true;
		}

		if (modified) {
			actions.push({
				table: 'public."CanonConfig"',
				action: "update_text",
				id: cfg.id,
				reason: "Correction des fautes dans CanonConfig"
			});
			if (apply) {
				const parsed = JSON.parse(correctedJson);
				await sql`UPDATE public."CanonConfig" SET data = ${sql.json(parsed)} WHERE id = ${cfg.id}`;
				console.log(`  ✓ [public."CanonConfig"] Fautes corrigées dans la doctrine canon`);
			} else {
				console.log(`  [DRY] [public."CanonConfig"] Corrigerait les fautes dans la doctrine`);
			}
		}
	}

	console.log(`\n======================================================`);
	console.log(`[GRAND-NETTOYAGE] Bilan : ${actions.length} actions exécutées.`);
	console.log(`======================================================`);

	await sql.end();
}

main().catch(err => {
	console.error("[GRAND-NETTOYAGE] Error:", err);
	process.exit(1);
});
