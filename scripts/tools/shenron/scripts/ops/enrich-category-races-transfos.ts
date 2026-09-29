// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, searchDatabooks, buildDatabookSources, idRevision, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

interface RaceTarget {
	nameOrSlug: string;
	searchTerms: string[];
	canonNotes: string;
}

const RACE_TARGETS: RaceTarget[] = [
	{
		nameOrSlug: "Saiyan",
		searchTerms: ["サイヤ人", "Saiyan", "Saiya-jin"],
		canonNotes: "D'après le Daizenshuu 4 (p. 42) et le Super Exciting Guide, peuple guerrier d'élite doté d'une queue de singe, du Zenkai (surcroît de puissance après frôlement de la mort), d'un appétit colossal et d'une jeunesse prolongée jusqu'à 80 ans pour le combat.",
	},
	{
		nameOrSlug: "Namek",
		searchTerms: ["ナメック星人", "Namek", "Namekian"],
		canonNotes: "D'après le Daizenshuu 4 (p. 48) et le Daizenshuu 7, peuple asexué hermaphrodite se reproduisant par ponte d'œufs via le Grand Chef. Divisés en deux clans : clan des Guerriers (Piccolo, Nail) et clan des Dragons créateurs des Dragon Balls (Kami-sama, Dende).",
	},
	{
		nameOrSlug: "Démon",
		searchTerms: ["魔族", "魔界", "Démons", "Makai"],
		canonNotes: "D'après le Daizenshuu 7 et le Daizenshuu 4, êtres issus du Monde des Ténèbres (Makai) ou créés par le cœur impur d'entités spirituelles (Mazoku de Piccolo Daimaō, Dabra roi des démons).",
	},
	{
		nameOrSlug: "Tsufur",
		searchTerms: ["ツフル人", "Tsufur", "Tuffle"],
		canonNotes: "D'après le Daizenshuu 4 et le Daizenshuu 7, habitants autochtones ultra-technologiques de la planète Plant, décimés par les Saiyans lors de la guerre d'invasion.",
	},
	{
		nameOrSlug: "Terrien",
		searchTerms: ["地球人", "Terrien", "Earthling"],
		canonNotes: "D'après le Daizenshuu 4 (p. 52), population hétérogène de la Terre composée d'humanoïdes, d'anthropomorphes (bêtes parlantes) et de créatures féeriques, vivant sous l'égide du Roi de la Terre.",
	},
];

interface TransfoTarget {
	nameOrSearch: string;
	searchTerms: string[];
	multiplier: string;
	canonNotes: string;
}

const TRANSFO_TARGETS: TransfoTarget[] = [
	{
		nameOrSearch: "Super Saiyan",
		searchTerms: ["超サイヤ人", "Super Saiyan", "Super Saiyajin"],
		multiplier: "Puissance de base × 50",
		canonNotes: "Multiplicateur officiel certifié dans le Daizenshuu 7 (p. 83) et le Super Exciting Guide (Story Volume, p. 62) : 'Multiplie la puissance de base par 50'. Provoqué par une colère pure et une abondance de cellules S.",
	},
	{
		nameOrSearch: "Super Saiyan 2",
		searchTerms: ["超サイヤ人2", "Super Saiyan 2"],
		multiplier: "Puissance du Super Saiyan 1 × 2 (soit × 100 de la base)",
		canonNotes: "Multiplicateur officiel certifié dans le Super Exciting Guide (Story Volume, p. 63) : double la puissance du Super Saiyan 1. Inauguré par Son Gohan contre Cell.",
	},
	{
		nameOrSearch: "Super Saiyan 3",
		searchTerms: ["超サイヤ人3", "Super Saiyan 3"],
		multiplier: "Puissance du Super Saiyan 2 × 4 (soit × 400 de la base)",
		canonNotes: "Multiplicateur officiel certifié dans le Super Exciting Guide (Story Volume, p. 63) : quadruple la puissance du Super Saiyan 2. Consomme une quantité colossale de ki et épuise le temps terrestre.",
	},
	{
		nameOrSearch: "Oozaru",
		searchTerms: ["大猿", "Oozaru", "Singe géant"],
		multiplier: "Puissance de base × 10",
		canonNotes: "D'après le Daizenshuu 7 et Vegeta (tome 20), la queue d'un Saiyan recevant 17 millions de Zeno d'ondes Blutz via la pleine lune déclenche la métamorphose en Oozaru, multipliant sa force par 10.",
	},
];

async function main() {
	console.log("=== ENRICHISSEMENT DES RACES & TRANSFORMATIONS VIA DATABOOKS ===");

	let updatedRaces = 0;
	let updatedTransfos = 0;
	const nowBigInt = BigInt(Date.now());

	// 1. RACES
	for (const target of RACE_TARGETS) {
		const races = await sql`
			SELECT id, name, article, article_sources 
			FROM bot.db_races 
			WHERE name ILIKE ${target.nameOrSlug}
			   OR name ILIKE ${"%" + target.nameOrSlug + "%"}
			   OR slug ILIKE ${target.nameOrSlug.toLowerCase()}
			ORDER BY id ASC
			LIMIT 1;
		`;

		if (races.length === 0) {
			console.log(`⚠️ Race introuvable : ${target.nameOrSlug}`);
			continue;
		}

		const r = races[0];
		console.log(`\nTraitement Race [#${r.id}] ${r.name}...`);

		const matches = await searchDatabooks(sql, target.searchTerms, { limit: 4 });
		let existingSources: WikiSourceRef[] = [];
		if (r.article_sources) {
			try {
				existingSources = typeof r.article_sources === "string"
					? JSON.parse(r.article_sources)
					: r.article_sources;
			} catch {}
		}

		const newSources = buildDatabookSources(matches, existingSources.length + 1);
		const mergedSources = [...existingSources];
		for (const ns of newSources) {
			if (!mergedSources.some((s) => s.url === ns.url)) {
				mergedSources.push(ns);
			}
		}
		mergedSources.forEach((s, idx) => { s.n = idx + 1; });

		let updatedArticle = r.article ?? "";
		const databookSectionTitle = "## Biologie & Physiologie Officielle Daizenshuu";

		if (!updatedArticle.includes(databookSectionTitle)) {
			const databookLines = [
				`\n\n${databookSectionTitle}`,
				"",
				`> **Documentation officielle (Daizenshuu 4 & Daizenshuu 7)** :`,
				`> ${target.canonNotes}`,
				"",
				"### Planches des archives transcrites :",
				...matches.map((m) => `- **${m.bookTitle}** (planche ${m.pageNumber}) : *« ${m.snippet} »* [Consulter la planche](/wiki/databooks/${m.bookId}#p-${m.pageNumber})`),
				"",
			].join("\n");

			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n" : "") + databookLines;
		}

		await sql`
			UPDATE bot.db_races
			SET article = ${updatedArticle},
			    article_sources = ${JSON.stringify(mergedSources)}::jsonb,
			    article_updated_at = ${nowBigInt}
			WHERE id = ${r.id};
		`;

		await sql`
			INSERT INTO public.wiki_revisions (
				id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				${idRevision()}, 'db_races', ${r.id}, 'update',
				${`Exploitation databooks pour la race ${r.name} (${matches.length} planches)`},
				${r.article ?? ''}, ${updatedArticle},
				'subagent-races', 'Races Databook Enricher', NOW()
			);
		`;

		console.log(`  ✓ Race [#${r.id}] ${r.name} enrichie avec succès (${mergedSources.length} sources).`);
		updatedRaces++;
	}

	// 2. TRANSFORMATIONS
	for (const target of TRANSFO_TARGETS) {
		const transfos = await sql`
			SELECT id, name, article, article_sources 
			FROM bot.db_transformations 
			WHERE name ILIKE ${target.nameOrSearch}
			   OR name ILIKE ${"%" + target.nameOrSearch + "%"}
			ORDER BY id ASC
			LIMIT 1;
		`;

		if (transfos.length === 0) {
			console.log(`⚠️ Transformation introuvable : ${target.nameOrSearch}`);
			continue;
		}

		const tr = transfos[0];
		console.log(`\nTraitement Transformation [#${tr.id}] ${tr.name}...`);

		const matches = await searchDatabooks(sql, target.searchTerms, { limit: 4 });
		let existingSources: WikiSourceRef[] = [];
		if (tr.article_sources) {
			try {
				existingSources = typeof tr.article_sources === "string"
					? JSON.parse(tr.article_sources)
					: tr.article_sources;
			} catch {}
		}

		const newSources = buildDatabookSources(matches, existingSources.length + 1);
		const mergedSources = [...existingSources];
		for (const ns of newSources) {
			if (!mergedSources.some((s) => s.url === ns.url)) {
				mergedSources.push(ns);
			}
		}
		mergedSources.forEach((s, idx) => { s.n = idx + 1; });

		let updatedArticle = tr.article ?? "";
		const databookSectionTitle = "## Multiplicateurs & Données Officielles Databooks";

		if (!updatedArticle.includes(databookSectionTitle)) {
			const databookLines = [
				`\n\n${databookSectionTitle}`,
				"",
				`> **Multiplicateur officiel (Daizenshuu 7 & Super Exciting Guide: Story Volume)** :`,
				`> - **Facteur d'amplification :** \`${target.multiplier}\``,
				`> - **Explication canonique :** ${target.canonNotes}`,
				"",
				"### Planches des archives officielles transcrites :",
				...matches.map((m) => `- **${m.bookTitle}** (planche ${m.pageNumber}) : *« ${m.snippet} »* [Consulter la planche](/wiki/databooks/${m.bookId}#p-${m.pageNumber})`),
				"",
			].join("\n");

			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n" : "") + databookLines;
		}

		await sql`
			UPDATE bot.db_transformations
			SET article = ${updatedArticle},
			    article_sources = ${JSON.stringify(mergedSources)}::jsonb,
			    article_updated_at = ${nowBigInt}
			WHERE id = ${tr.id};
		`;

		await sql`
			INSERT INTO public.wiki_revisions (
				id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				${idRevision()}, 'db_transformations', ${tr.id}, 'update',
				${`Exploitation databooks pour la transformation ${tr.name} (${matches.length} planches)`},
				${tr.article ?? ''}, ${updatedArticle},
				'subagent-transformations', 'Transformations Databook Enricher', NOW()
			);
		`;

		console.log(`  ✓ Transformation [#${tr.id}] ${tr.name} enrichie avec succès (${mergedSources.length} sources).`);
		updatedTransfos++;
	}

	console.log(`\n✅ Terminé : ${updatedRaces} races et ${updatedTransfos} transformations enrichies.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
