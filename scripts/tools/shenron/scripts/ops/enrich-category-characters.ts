// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, searchDatabooks, buildDatabookSources, idRevision, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

interface CharacterTarget {
	id: number;
	name: string;
	searchTerms: string[];
	canonNotes: string;
}

const TARGETS: CharacterTarget[] = [
	{
		id: 1, // Goku
		name: "Goku",
		searchTerms: ["孫悟空", "カカロット", "Kakarotto", "Son Goku"],
		canonNotes: "D'après le Daizenshuu 7 (p. 80) et le Daizenshuu 2 (Story Guide), né en Âge 737 (Âge 734 dans Dragon Ball Minus), envoyé sur Terre avant l'anéantissement de la planète Vegeta. Élevé par Son Gohan au mont Paozu, formé par Kamé Sennin, Maître Karin, Dieu et Maître Kaioh du Nord.",
	},
	{
		id: 2, // Vegeta
		name: "Vegeta",
		searchTerms: ["ベジータ", "Prince Vegeta", "Bejīta"],
		canonNotes: "D'après le Daizenshuu 7 (p. 104), prince héritier de la dynastie saiyane, né en Âge 732. Son père le Roi Vegeta est assassiné par Freezer. Débarque sur Terre le 3 novembre de l'Âge 762 avec Nappa.",
	},
	{
		id: 10, // Gohan
		name: "Gohan",
		searchTerms: ["孫悟飯", "Gohan", "Son Gohan"],
		canonNotes: "Fils aîné de Son Goku et Chichi, né en mai de l'Âge 757 (Daizenshuu 7, p. 84). Premier combattant à éveiller le stade de Super Saiyan 2 lors des Cell Games en Âge 767.",
	},
	{
		id: 3, // Piccolo
		name: "Piccolo",
		searchTerms: ["ピッコロ", "マジュニア", "Ma Junior", "Piccolo"],
		canonNotes: "Né le 9 mai de l'Âge 753 (Daizenshuu 7, p. 98) en tant que réincarnation et fils du Roi démon Piccolo. Fusionne avec Nail sur Namek en Âge 762 puis refait corps avec Dieu en Âge 767 pour devenir le Super Namek.",
	},
	{
		id: 706, // Krilin
		name: "Krilin",
		searchTerms: ["クリリン", "Kuririn", "Krilin"],
		canonNotes: "Né le 29 octobre de l'Âge 736 (Daizenshuu 7, p. 64). Ancien disciple du temple d'Orin, condisciple de Goku chez Kamé Sennin dès Âge 749. Considéré par Toriyama comme le Terrien le plus puissant.",
	},
	{
		id: 5, // Freezer
		name: "Freezer",
		searchTerms: ["フリーザ", "Frieza", "Freezer"],
		canonNotes: "Empereur de l'univers, fils du Roi Cold. Responsable de la destruction de la planète Vegeta en Âge 737 (Daizenshuu 7, p. 101). Possède quatre transformations physiologiques et une forme dorée.",
	},
	{
		id: 323, // Cell
		name: "Cell",
		searchTerms: ["セル", "Cell", "Seru"],
		canonNotes: "Bio-cyborg parfait conçu par le superordinateur du Dr Gero (Daizenshuu 2, p. 118 et Daizenshuu 7). Absorbe C-17 et C-18 en Âge 767 pour atteindre sa forme parfaite.",
	},
	{
		id: 32, // Majin Buu
		name: "Majin Buu",
		searchTerms: ["魔人ブウ", "Majin Buu", "Boo"],
		canonNotes: "D'après Akira Toriyama et le Daizenshuu 7 (p. 110), créature originelle existant depuis les temps immémoriaux. Réveillé par le sorcier Babidi en mai de l'Âge 774 sur Terre.",
	},
	{
		id: 16, // Trunks
		name: "Trunks",
		searchTerms: ["トランクス", "Torankusu", "Trunks"],
		canonNotes: "Né en Âge 766, fils de Vegeta et Bulma. La version du futur voyage dans le temps en Âge 764 pour avertir les guerriers Z de l'avènement des cyborgs (Daizenshuu 7, p. 92).",
	},
	{
		id: 682, // Kamé Sennin
		name: "Kamé Sennin",
		searchTerms: ["亀仙人", "武天老師", "Muten Rōshi", "Kame Sennin"],
		canonNotes: "Né en Âge 430 (Daizenshuu 7, p. 60), le maître des arts martiaux de la Terre. Inventeur du Kamehameha après 50 années d'entraînement rigoureux.",
	},
	{
		id: 12, // Tenshinhan
		name: "Tenshinhan",
		searchTerms: ["天津飯", "Tenshinhan", "Tien Shinhan"],
		canonNotes: "Né en Âge 733 (Daizenshuu 7, p. 88), descendant de la race tricéphale des Trois Yeux (Mitsume-jin). Ancien champion du 22e Tenkaichi Budokai en Âge 753.",
	},
	{
		id: 13, // Yamcha
		name: "Yamcha",
		searchTerms: ["ヤムチャ", "Yamucha", "Yamcha"],
		canonNotes: "Né en Âge 733 (Daizenshuu 7, p. 112), ancien bandit du désert maniant le Rōgāfūfūken, premier adversaire martial de Son Goku devenu son allié fidèle.",
	},
];

async function main() {
	console.log("=== ENRICHISSEMENT DE LA CATÉGORIE PERSONNAGES VIA DATABOOKS ===");

	let updatedCount = 0;
	const nowBigInt = BigInt(Date.now());

	for (const target of TARGETS) {
		const chars = await sql`
			SELECT id, name, article, article_sources 
			FROM bot.db_characters 
			WHERE id = ${target.id};
		`;

		if (chars.length === 0) {
			console.log(`⚠️ Personnage introuvable : ID #${target.id}`);
			continue;
		}

		const char = chars[0];
		console.log(`\nTraitement [#${char.id}] ${char.name}...`);

		// Recherche des planches pertinentes
		const matches = await searchDatabooks(sql, target.searchTerms, { limit: 4 });
		console.log(`  -> ${matches.length} planches de databooks identifiées.`);

		let existingSources: WikiSourceRef[] = [];
		if (char.article_sources) {
			try {
				existingSources = typeof char.article_sources === "string"
					? JSON.parse(char.article_sources)
					: char.article_sources;
			} catch {}
		}

		const newSources = buildDatabookSources(matches, existingSources.length + 1);
		const mergedSources: WikiSourceRef[] = existingSources.map((s) => ({ ...s }));
		for (const ns of newSources) {
			if (!mergedSources.some((s) => s.url === ns.url)) {
				mergedSources.push({ ...ns });
			}
		}
		mergedSources.forEach((s, idx) => { s.n = idx + 1; });

		let updatedArticle = char.article ?? "";
		const databookSectionTitle = "## Données Canoniques & Databooks Officiels";

		if (!updatedArticle.includes(databookSectionTitle)) {
			const databookLines = [
				`\n\n${databookSectionTitle}`,
				"",
				`> **Références officielles (Daizenshuu & Guides Akira Toriyama)** :`,
				`> ${target.canonNotes}`,
				"",
				"### Mentions et apparitions dans les archives officielles :",
				...matches.map((m) => `- **${m.bookTitle}** (planche ${m.pageNumber}) : *« ${m.snippet} »* [Consulter la planche](/wiki/databooks/${m.bookId}#p-${m.pageNumber})`),
				"",
			].join("\n");

			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n" : "") + databookLines;
		}

		await sql`
			UPDATE bot.db_characters
			SET article = ${updatedArticle},
			    article_sources = ${JSON.stringify(mergedSources)}::jsonb,
			    article_updated_at = ${nowBigInt}
			WHERE id = ${char.id};
		`;

		await sql`
			INSERT INTO public.wiki_revisions (
				id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				${idRevision()}, 'db_characters', ${char.id}, 'update',
				${`Exploitation databooks pour ${char.name} (${matches.length} planches)`},
				${char.article ?? ''}, ${updatedArticle},
				'subagent-characters', 'Characters Databook Enricher', NOW()
			);
		`;

		console.log(`  ✓ Fiche [#${char.id}] ${char.name} enrichie avec succès (${mergedSources.length} sources).`);
		updatedCount++;
	}

	console.log(`\n✅ Terminé : ${updatedCount} personnages enrichis avec les databooks.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
