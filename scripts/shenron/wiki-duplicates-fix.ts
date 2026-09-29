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

function normalizeKey(str: string): string {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove accents
		.replace(/[^a-z0-9]/g, "");     // Remove non-alphanumeric
}

interface DuplicateReport {
	category: string;
	key: string;
	keptId: string | number;
	hiddenIds: (string | number)[];
	reason: string;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");

	const dbUrl = await getDatabaseUrl();
	const sql = postgres(dbUrl);

	console.log(`[WIKI-DEDUP] Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read only)"}`);

	const report: DuplicateReport[] = [];

	// 1. CANON_REFERENCES DUPLICATES
	console.log("\n--- Checking public.canon_references ---");
	const canonPairs = [
		{ prime: "l-echec-du-passage-de-flambeau-a-gohan", dupe: "l-echec-du-passage-de-flambeau-a-gohan-2" },
		{ prime: "la-relation-ambigue-avec-vegeta", dupe: "la-relation-ambigue-avec-vegeta-2" },
		{ prime: "mr-satan-hercule-et-l-importance-du-gag", dupe: "mr-satan-hercule-et-l-importance-du-gag-2" },
		{ prime: "piccolo-le-personnage-prefere-de-l-auteur", dupe: "piccolo-le-personnage-prefere-de-l-auteur-2" }
	];

	for (const pair of canonPairs) {
		const rows = await sql<{ id: string; visible: boolean; year: number | null }[]>`
			SELECT id, visible, year FROM public.canon_references WHERE id IN (${pair.prime}, ${pair.dupe})
		`;
		const primeRow = rows.find(r => r.id === pair.prime);
		const dupeRow = rows.find(r => r.id === pair.dupe);

		if (primeRow && dupeRow && dupeRow.visible) {
			report.push({
				category: "canon_references",
				key: pair.prime,
				keptId: pair.prime,
				hiddenIds: [pair.dupe],
				reason: "Citation dupliquée avec source vague et année manquante dans la variante -2"
			});
			if (apply) {
				await sql`UPDATE public.canon_references SET visible = false WHERE id = ${pair.dupe}`;
				console.log(`  ✓ Hidden duplicate citation: ${pair.dupe}`);
			} else {
				console.log(`  [DRY] Would hide duplicate citation: ${pair.dupe} (keeping ${pair.prime})`);
			}
		}
	}

	// 2. DB_PLANETS DUPLICATES
	console.log("\n--- Checking bot.db_planets ---");
	// Audit: Freezer No. 79 (id 4) vs Planète Freezer 79 (id 34)
	const freezerPlanets = await sql<{ id: number; name: string; visible: boolean; article: string | null }[]>`
		SELECT id, name, visible, article FROM bot.db_planets WHERE id IN (4, 34)
	`;
	const p4 = freezerPlanets.find(p => Number(p.id) === 4);
	const p34 = freezerPlanets.find(p => Number(p.id) === 34);
	if (p4 && p34 && p4.visible && p34.visible) {
		report.push({
			category: "db_planets",
			key: "Freezer 79",
			keptId: 34,
			hiddenIds: [4],
			reason: "Doublon de planète: 'Freezer No. 79' vs 'Planète Freezer 79'"
		});
		if (apply) {
			await sql`UPDATE bot.db_planets SET visible = false WHERE id = 4`;
			console.log(`  ✓ Hidden duplicate planet id 4 ('${p4.name}') in favor of id 34 ('${p34.name}')`);
		} else {
			console.log(`  [DRY] Would hide planet id 4 in favor of id 34`);
		}
	}

	// Audit: Makyo (id 13) vs Étoile Makyô (id 65)
	const makyoPlanets = await sql<{ id: number; name: string; visible: boolean; article: string | null }[]>`
		SELECT id, name, visible, article FROM bot.db_planets WHERE id IN (13, 65)
	`;
	const p13 = makyoPlanets.find(p => Number(p.id) === 13);
	const p65 = makyoPlanets.find(p => Number(p.id) === 65);
	if (p13 && p65 && p13.visible && p65.visible) {
		report.push({
			category: "db_planets",
			key: "Makyo",
			keptId: 65,
			hiddenIds: [13],
			reason: "Doublon d'astre démoniaque: 'Makyo' vs 'Étoile Makyô'"
		});
		if (apply) {
			await sql`UPDATE bot.db_planets SET visible = false WHERE id = 13`;
			console.log(`  ✓ Hidden duplicate planet id 13 ('${p13.name}') in favor of id 65 ('${p65.name}')`);
		} else {
			console.log(`  [DRY] Would hide planet id 13 in favor of id 65`);
		}
	}

	// 3. DB_CHARACTERS: BOO / BUU ANALYSIS
	console.log("\n--- Checking bot.db_characters Boo/Buu duplicates ---");
	const booChars = await sql<{ id: number; name: string; visible: boolean; article: string | null; description: string | null }[]>`
		SELECT id, name, visible, article, description FROM bot.db_characters WHERE id IN (90, 760)
	`;
	const c90 = booChars.find(c => Number(c.id) === 90);
	const c760 = booChars.find(c => Number(c.id) === 760);
	if (c90 && c760 && c90.visible && c760.visible) {
		const kept = (c90.article?.length ?? 0) >= (c760.article?.length ?? 0) ? 90 : 760;
		const hidden = kept === 90 ? 760 : 90;
		const keptName = kept === 90 ? c90.name : c760.name;
		const hiddenName = hidden === 90 ? c90.name : c760.name;

		report.push({
			category: "db_characters",
			key: "Kid Buu / Majin Boo pur",
			keptId: kept,
			hiddenIds: [hidden],
			reason: `Doublon de personnage: '${hiddenName}' (id ${hidden}) duplique '${keptName}' (id ${kept})`
		});
		if (apply) {
			await sql`UPDATE bot.db_characters SET visible = false WHERE id = ${hidden}`;
			console.log(`  ✓ Hidden duplicate character id ${hidden} ('${hiddenName}') in favor of id ${kept} ('${keptName}')`);
		} else {
			console.log(`  [DRY] Would hide character id ${hidden} ('${hiddenName}') in favor of id ${kept} ('${keptName}')`);
		}
	}

	// 4. SCAN DB_CHARACTERS FOR NORMALIZED NAME DUPLICATES
	console.log("\n--- Checking bot.db_characters normalized name duplicates ---");
	const allChars = await sql<{ id: number; name: string; article: string | null }[]>`
		SELECT id, name, article FROM bot.db_characters WHERE visible = true ORDER BY id ASC
	`;
	const charNormMap = new Map<string, { id: number; name: string; articleLen: number }[]>();
	for (const ch of allChars) {
		const k = normalizeKey(ch.name);
		if (!k || k.length < 3) continue;
		if (!charNormMap.has(k)) charNormMap.set(k, []);
		charNormMap.get(k)!.push({ id: Number(ch.id), name: ch.name, articleLen: ch.article?.length ?? 0 });
	}
	for (const [k, list] of charNormMap.entries()) {
		if (list.length > 1) {
			// Sort by article length descending, then id ascending
			list.sort((a, b) => b.articleLen - a.articleLen || a.id - b.id);
			const kept = list[0];
			const hidden = list.slice(1);
			report.push({
				category: "db_characters_normalized",
				key: kept.name,
				keptId: kept.id,
				hiddenIds: hidden.map(h => h.id),
				reason: `Doublon de nom normalisé: ${list.map(x => `'${x.name}' (#${x.id})`).join(", ")}`
			});
			if (apply) {
				const hIds = hidden.map(h => h.id);
				await sql`UPDATE bot.db_characters SET visible = false WHERE id = ANY(${hIds})`;
				console.log(`  ✓ Hidden normalized duplicates ${hIds.join(", ")} of '${kept.name}'`);
			} else {
				console.log(`  [DRY] Would hide normalized duplicates ${hidden.map(h => h.id).join(", ")} of '${kept.name}'`);
			}
		}
	}

	// 5. SCAN DB_TECHNIQUES FOR NORMALIZED NAME DUPLICATES
	console.log("\n--- Checking bot.db_techniques normalized name duplicates ---");
	const allTechs = await sql<{ id: number; name: string; article: string | null }[]>`
		SELECT id, name, article FROM bot.db_techniques WHERE visible = true ORDER BY id ASC
	`;
	const techNormMap = new Map<string, { id: number; name: string; articleLen: number }[]>();
	for (const t of allTechs) {
		const k = normalizeKey(t.name);
		if (!k || k.length < 3) continue;
		if (!techNormMap.has(k)) techNormMap.set(k, []);
		techNormMap.get(k)!.push({ id: Number(t.id), name: t.name, articleLen: t.article?.length ?? 0 });
	}
	for (const [k, list] of techNormMap.entries()) {
		if (list.length > 1) {
			list.sort((a, b) => b.articleLen - a.articleLen || a.id - b.id);
			const kept = list[0];
			const hidden = list.slice(1);
			report.push({
				category: "db_techniques_normalized",
				key: kept.name,
				keptId: kept.id,
				hiddenIds: hidden.map(h => h.id),
				reason: `Doublon de technique normalisée: ${list.map(x => `'${x.name}' (#${x.id})`).join(", ")}`
			});
			if (apply) {
				const hIds = hidden.map(h => h.id);
				await sql`UPDATE bot.db_techniques SET visible = false WHERE id = ANY(${hIds})`;
				console.log(`  ✓ Hidden normalized duplicates ${hIds.join(", ")} of '${kept.name}'`);
			} else {
				console.log(`  [DRY] Would hide normalized duplicates ${hidden.map(h => h.id).join(", ")} of '${kept.name}'`);
			}
		}
	}

	// 6. DB_TRANSFORMATIONS: duplicate form on the SAME character
	console.log("\n--- Scanning bot.db_transformations for duplicate forms on same character ---");
	const transDupes = await sql<{ name: string; character_id: number; ids: number[]; cnt: number }[]>`
		SELECT lower(trim(name)) as name, character_id, array_agg(id ORDER BY id ASC) as ids, count(*) as cnt
		FROM bot.db_transformations
		WHERE visible = true
		GROUP BY lower(trim(name)), character_id
		HAVING count(*) > 1
	`;
	for (const dupe of transDupes) {
		const kept = dupe.ids[0];
		const hidden = dupe.ids.slice(1);
		report.push({
			category: "db_transformations_character",
			key: `${dupe.name} (char: ${dupe.character_id})`,
			keptId: kept,
			hiddenIds: hidden,
			reason: `Transformation dupliquée pour le même personnage ${dupe.character_id}`
		});
		if (apply) {
			await sql`UPDATE bot.db_transformations SET visible = false WHERE id = ANY(${hidden})`;
			console.log(`  ✓ Hidden duplicate transformation ${hidden.join(", ")} on character ${dupe.character_id}`);
		} else {
			console.log(`  [DRY] Would hide duplicate transformation ${hidden.join(", ")} on character ${dupe.character_id}`);
		}
	}

	// 7. TYPO & DOUBLED WORDS FIXES (AUDIT REPORT)
	console.log("\n--- Checking character text typos/doubled words ---");
	const char761 = await sql<{ id: number; description: string }[]>`
		SELECT id, description FROM bot.db_characters WHERE id = 761
	`;
	if (char761[0]?.description?.includes("était la forme forme prise")) {
		report.push({
			category: "text_typo",
			key: "char_761_description",
			keptId: 761,
			hiddenIds: [],
			reason: "Mot dupliqué 'forme forme prise' corrigé en 'forme prise'"
		});
		if (apply) {
			await sql`
				UPDATE bot.db_characters
				SET description = replace(description, 'était la forme forme prise', 'était la forme prise')
				WHERE id = 761
			`;
			console.log("  ✓ Fixed doubled word 'forme forme' in character 761 description");
		} else {
			console.log("  [DRY] Would fix doubled word 'forme forme' in character 761 description");
		}
	}

	// 8. CANON CONFIG TYPOS (Audit finding)
	console.log("\n--- Checking public.\"CanonConfig\" typos ---");
	const canonConfigRow = await sql<{ id: string; data: any }[]>`
		SELECT id, data FROM public."CanonConfig" LIMIT 1
	`;
	if (canonConfigRow.length > 0) {
		const cfg = canonConfigRow[0];
		let modified = false;
		const rawJson = JSON.stringify(cfg.data);

		let correctedJson = rawJson;
		if (rawJson.includes("Drragon Ball Sparking Zero")) {
			correctedJson = correctedJson.replace(/Drragon Ball Sparking Zero/g, "Dragon Ball Sparking Zero");
			modified = true;
			console.log("  ✓ Fixed typo 'Drragon Ball' -> 'Dragon Ball' in CanonConfig");
		}
		if (rawJson.includes("non intégrer à l'œuvre")) {
			correctedJson = correctedJson.replace(/non intégrer à l'œuvre/g, "non intégrés à l'œuvre");
			modified = true;
			console.log("  ✓ Fixed typo 'non intégrer' -> 'non intégrés' in CanonConfig");
		}

		if (modified) {
			report.push({
				category: "canon_config_typos",
				key: "CanonConfig",
				keptId: cfg.id,
				hiddenIds: [],
				reason: "Fautes de frappe corrigées: 'Drragon Ball' -> 'Dragon Ball', 'non intégrer' -> 'non intégrés'"
			});
			if (apply) {
				const parsed = JSON.parse(correctedJson);
				await sql`UPDATE public."CanonConfig" SET data = ${sql.json(parsed)} WHERE id = ${cfg.id}`;
				console.log("  ✓ CanonConfig updated successfully");
			}
		}
	}

	console.log(`\n======================================================`);
	console.log(`[WIKI-DEDUP] TOTAL: ${report.length} doublons/anomalies identifiés.`);
	console.log(`======================================================`);
	for (const r of report) {
		console.log(`• [${r.category}] '${r.key}' -> conservé: ${r.keptId}, masqués: [${r.hiddenIds.join(", ")}] — ${r.reason}`);
	}

	await sql.end();
}

main().catch(err => {
	console.error("[WIKI-DEDUP] Error:", err);
	process.exit(1);
});
