import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, idle_timeout: 10 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(fn: () => Promise<T>, maxRetries = 6): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (err) {
			if (i >= maxRetries) throw err;
			console.warn(`  [RETRY ${i}/${maxRetries}] ${(err as Error).message}`);
			await sleep(1500 * i);
		}
	}
}

export function idRevision(): string {
	return Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");
}

interface DatabookUpdate {
	id: number;
	title: string;
	titleJa: string;
	description?: string;
}

const databookUpdates: DatabookUpdate[] = [
	{
		id: 43,
		title: "Shonen Jump (Issue 1, January 2003) Dragon Power! / Ask Akira Toriyama",
		titleJa: "SHONEN JUMP 2003年1月号 (Dragon Power! / 鳥山明インタビュー)",
		description: "Numéro inaugural du magazine officiel nord-américain Shonen Jump (Viz Media, janvier 2003, paru le 26 novembre 2002). Il contient un dossier complet et une double interview exclusive d'Akira Toriyama intitulée « Dragon Power! / Ask Akira Toriyama », dans laquelle l'auteur répond aux questions des lecteurs américains et revient sur la création de Goku et l'univers Dragon Ball.",
	},
	{
		id: 55,
		title: "Flying Postman Press April 2015 issue",
		titleJa: "FLYING POSTMAN PRESS 2015年4月号",
	},
	{
		id: 56,
		title: "Dragon Ball Z: Shin Budokai Designer Diary",
		titleJa: "ドラゴンボールZ 真武道会 開発者ダイアリー",
	},
	{
		id: 57,
		title: "WIRED Japan 1997 #1: “Issue 3.01”",
		titleJa: "WIRED 日本版 1997年1月号 (Vol.3.01)",
	},
	{
		id: 427,
		title: "Dragon Ball Le Manga de Légende — Livret de bienvenue",
		titleJa: "DRAGON BALL The legend of manga — Livret de bienvenue",
		description: "Livret de présentation et de bienvenue de la collection encyclopédique officielle « Dragon Ball Le Manga de Légende », éditée par Hachette Collections sous licence Shueisha Inc. et Bird Studio. Il détaille le contenu des 50 fascicules, le plan de l'encyclopédie et la collection des figurines exclusives créées d'après les dessins d'Akira Toriyama.",
	},
	{
		id: 438,
		title: "CD Consoles HS - n°2",
		titleJa: "CD Consoles 特別増刊2号 (CD Consoles HS - n°2)",
		description: "Numéro hors-série collector n°2 du magazine mensuel CD Consoles (Pressimage, octobre 1996), consacré à l'actualité des adaptations vidéoludiques et animées Dragon Ball Z sur consoles 32 bits (PlayStation, Saturn) et 16 bits (Super Nintendo).",
	},
	{
		id: 439,
		title: "Dragon Ball Z - Catalogue Manga Distribution",
		titleJa: "ドラゴンボールZ マンガ・ディストリビューション・カタログ",
		description: "Catalogue commercial officiel édité par Manga Distribution (1995), présentant l'intégrale des cassettes vidéo (VHS), coffrets collectors, posters et produits dérivés Dragon Ball Z distribués sur le marché francophone.",
	},
	{
		id: 440,
		title: "Jam - n°1",
		titleJa: "Jam 1号 (Jam - n°1)",
		description: "Premier numéro du magazine français Jam (Média Système Édition, avril 1995), incluant un grand dossier couleur sur le phénomène Dragon Ball Z, ses héros, ses guides d'épisodes et les cartes Carddass japonaises.",
	},
	{
		id: 441,
		title: "Joypad n°31 - Supplément",
		titleJa: "Joypad 31号 付録 (Joypad n°31 - Supplément)",
		description: "Supplément collector hors-série offert avec le n°31 du magazine Joypad (Média Système Édition, mai 1994), proposant les guides complets, coups spéciaux et astuces pour les jeux Dragon Ball Z Super Butōden 2 (Super Famicom) et L'Appel du Destin (Mega Drive).",
	},
	{
		id: 442,
		title: "Top Consoles HS - n°1",
		titleJa: "Top Consoles 特別増刊1号 (Top Consoles HS - n°1)",
		description: "Premier hors-série du magazine Top Consoles (Pressimage, septembre 1995), entièrement dédié aux jeux vidéo Dragon Ball Z, aux imports japonais et aux secrets des jeux d'arcade et consoles de salon.",
	},
];

async function prepareUpdates() {
	const allBooks = await retry(() => sql`
		SELECT id, title, title_ja, description, published_at 
		FROM bot.db_databooks 
		WHERE title_ja IS NULL OR trim(title_ja) = ''
		ORDER BY id ASC
	`);

	const updates: { id: number; title: string; titleJa: string; description?: string; before: Record<string, unknown> }[] = [];

	for (const book of allBooks) {
		const predefined = databookUpdates.find((u) => u.id === Number(book.id));
		if (predefined) {
			updates.push({
				id: Number(book.id),
				title: book.title,
				titleJa: predefined.titleJa,
				description: predefined.description ?? book.description,
				before: { title_ja: book.title_ja, description: book.description },
			});
			continue;
		}

		// Handle Manga de Légende Fascicules
		const m = book.title.match(/Fascicule\s+(\d+)/i);
		if (m) {
			const pad = m[1].padStart(2, "0");
			const num = parseInt(m[1], 10);
			const titleJa = `DRAGON BALL The legend of manga — Fascicule ${pad}`;
			const desc = `Fascicule n°${num} de la collection encyclopédique officielle « Dragon Ball Le Manga de Légende », éditée par Hachette Collections sous licence Shueisha Inc. et Bird Studio. Conçu au Japon par Kisousha et Banana Globe Studio (2007), ce fascicule propose l'analyse des chapitres du manga, des dossiers sur l'univers d'Akira Toriyama, des coulisses de production et accompagne la figurine de collection officielle.`;
			updates.push({
				id: Number(book.id),
				title: book.title,
				titleJa,
				description: desc,
				before: { title_ja: book.title_ja, description: book.description },
			});
			continue;
		}

		console.warn(`Unmatched book ID ${book.id}: ${book.title}`);
	}

	return updates;
}

async function main() {
	const apply = process.argv.includes("--apply");
	console.log(`Mode : ${apply ? "APPLICATION EN COURS" : "SIMULATION (utiliser --apply pour écrire)"}\n`);

	console.log("=== 1. MISE À JOUR DU CHAPITRE MANGA MANQUANT (ID 20999) ===");
	const [ch20999] = await retry(() => sql`SELECT * FROM bot.db_manga_chapters WHERE id = 20999`);
	if (ch20999) {
		console.log(`Chapitre ID 20999 : ${ch20999.series} ch.${ch20999.chapter_number} "${ch20999.title}"`);
		console.log(`  Actuel : volume_id = ${ch20999.volume_id}, published_at = ${ch20999.published_at}`);

		if (ch20999.volume_id == null || ch20999.published_at == null) {
			console.log(`  Cible  : volume_id = 114 (Tome 33), published_at = 713491200 (WSJ 1992 #36-37)`);
			if (apply) {
				await retry(() =>
					sql.begin(async (tx) => {
						await tx`
							UPDATE bot.db_manga_chapters 
							SET volume_id = 114, published_at = 713491200 
							WHERE id = 20999
						`;
						await tx`
							INSERT INTO public.wiki_revisions
								(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
							VALUES
								(${idRevision()}, 'db_manga_chapters', '20999', 'update',
								 ${`DBFC ch.0 TRUNKS THE STORY －たったひとりの戦士－ (Le dernier des guerriers)`},
								 ${JSON.stringify({ volume_id: ch20999.volume_id, published_at: ch20999.published_at })},
								 ${JSON.stringify({ volume_id: 114, published_at: 713491200 })},
								 'shenron:subagent-databooks', 'Shenron Databooks & Mangathèque Subagent', NOW())
						`;
					})
				);
				console.log("  ✓ Chapitre 20999 mis à jour avec révision traçable.");
			}
		} else {
			console.log("  ✓ Déjà à jour.");
		}
	}

	console.log("\n=== 2. MISE À JOUR DES DATABOOKS SANS TITLE_JA ===");
	const updates = await prepareUpdates();
	console.log(`Nombre d'ouvrages restants à mettre à jour : ${updates.length}`);

	let updatedCount = 0;
	for (const u of updates) {
		if (apply) {
			await retry(() =>
				sql.begin(async (tx) => {
					if (u.description) {
						await tx`
							UPDATE bot.db_databooks 
							SET title_ja = ${u.titleJa}, description = ${u.description} 
							WHERE id = ${u.id}
						`;
					} else {
						await tx`
							UPDATE bot.db_databooks 
							SET title_ja = ${u.titleJa} 
							WHERE id = ${u.id}
						`;
					}
					await tx`
						INSERT INTO public.wiki_revisions
							(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
						VALUES
							(${idRevision()}, 'db_databooks', ${String(u.id)}, 'update',
							 ${u.title},
							 ${JSON.stringify(u.before)},
							 ${JSON.stringify({ title_ja: u.titleJa, ...(u.description ? { description: u.description } : {}) })},
							 'shenron:subagent-databooks', 'Shenron Databooks & Mangathèque Subagent', NOW())
					`;
				})
			);
			updatedCount++;
		}
		console.log(`  [ID ${u.id}] ${u.title} -> title_ja: "${u.titleJa}"`);
	}

	if (apply) {
		console.log(`\n✓ ${updatedCount} databooks mis à jour avec révisions tracées.`);
	}

	console.log("\n=== 3. AUDIT FINAL DE COUVERTURE ===");
	const totalDatabranch = await retry(() => sql`
		SELECT count(*)::int as total,
		       count(title_ja)::int as with_ja,
		       (count(*) - count(title_ja))::int as missing_ja
		FROM bot.db_databooks
		WHERE visible IS NOT FALSE
	`);
	const mangaBranch = await retry(() => sql`
		SELECT count(*)::int as total,
		       count(volume_id)::int as with_vol,
		       count(published_at)::int as with_pub
		FROM bot.db_manga_chapters
		WHERE visible IS NOT FALSE
	`);
	console.log(`Databooks visibles : ${totalDatabranch[0].with_ja} / ${totalDatabranch[0].total} avec title_ja (manquants : ${totalDatabranch[0].missing_ja})`);
	console.log(`Chapitres visibles : ${mangaBranch[0].with_vol} / ${mangaBranch[0].total} avec volume_id`);
	console.log(`Chapitres visibles : ${mangaBranch[0].with_pub} / ${mangaBranch[0].total} avec published_at`);

	await sql.end();
}

main().catch((err) => {
	console.error("Erreur:", err);
	process.exit(1);
});
