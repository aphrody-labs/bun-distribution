// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, searchDatabooks, buildDatabookSources, idRevision, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

interface TechniqueTarget {
	nameOrSlug: string;
	searchTerms: string[];
	type: string;
	canonNotes: string;
}

const TECH_TARGETS: TechniqueTarget[] = [
	{
		nameOrSlug: "Kamehameha",
		searchTerms: ["かめはめ波", "Kamehameha"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (Dictionnaire des techniques, p. 110), technique de concentration de l'énergie latente créée par Kamé Sennin après 50 ans d'ascèse. Première démonstration au mont Frypan pour éteindre l'incendie.",
	},
	{
		nameOrSlug: "Kaiōken",
		searchTerms: ["界王拳", "Kaio-ken", "Kaioken"],
		type: "Nōryoku",
		canonNotes: "D'après le Daizenshuu 4 et le Daizenshuu 7, technique créée par Maître Kaioh du Nord permettant d'amplifier subitement ki, force, vitesse et réflexes au prix d'une déchirure musculaire extrême. Utilisé jusqu'au x20 contre Freezer.",
	},
	{
		nameOrSlug: "Genkidama",
		searchTerms: ["元気玉", "Genki Dama", "Genkidama"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (p. 114), technique secrète de Maître Kaioh consistant à rassembler l'énergie vitale (genki) des êtres vivants, des végétaux et de la nature en une sphère céleste dévastatrice.",
	},
	{
		nameOrSlug: "Makankōsappō",
		searchTerms: ["魔貫光殺砲", "Makankosappo", "Makankōsappō"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (p. 120), technique de perforation mise au point par Piccolo pendant les cinq années de paix pour éliminer Son Goku. Mortellement étrennée contre Raditz.",
	},
	{
		nameOrSlug: "Kienzan",
		searchTerms: ["気円斬", "Kienzan", "Destructo Disc"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (p. 108), disque tranchant de ki créé par Krilin, doté d'un pouvoir de découpe quasi absolu indépendamment de l'écart de puissance brute (tranche la queue de Vegeta Oozaru et la queue de Freezer).",
	},
	{
		nameOrSlug: "Kikōhō",
		searchTerms: ["気功砲", "Kikoho", "Kikōhō"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (p. 109), technique interdite de l'école de la Grue (Tsuru-sen-nin). Consomme directement la force vitale de l'utilisateur pour libérer une onde de choc géométrique dévastatrice.",
	},
	{
		nameOrSlug: "Final Flash",
		searchTerms: ["ファイナルフラッシュ", "Final Flash"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4, attaque ultime mise au point par Vegeta dans la Salle de l'Esprit et du Temps, capable de désintégrer une moitié du corps de Perfect Cell.",
	},
	{
		nameOrSlug: "Big Bang Attack",
		searchTerms: ["ビッグ・バン・アタック", "Big Bang Attack"],
		type: "Kikōha",
		canonNotes: "D'après le Daizenshuu 4 (p. 119), sphère compacte de ki projetée de la paume ouverte, inaugurée par Vegeta Super Saiyan contre C-19.",
	},
	{
		nameOrSlug: "Taiyōken",
		searchTerms: ["太陽拳", "Taiyoken", "Morsure du Soleil"],
		type: "Nōryoku",
		canonNotes: "D'après le Daizenshuu 4 (p. 115), technique aveuglante mise au point par l'école Tsuru (Tenshinhan) convertissant l'énergie interne en un éclair de lumière solaire.",
	},
	{
		nameOrSlug: "Mafūba",
		searchTerms: ["魔封波", "Mafuba", "Mafūba"],
		type: "Majutsu",
		canonNotes: "D'après le Daizenshuu 4 (p. 120), technique de scellement des démons inventée par Maître Mutaito pour emprisonner le Roi démon Piccolo dans un autocuiseur, au sacrifice de sa propre vie.",
	},
	{
		nameOrSlug: "Bukūjutsu",
		searchTerms: ["舞空術", "Bukujutsu", "Vol"],
		type: "Nōryoku",
		canonNotes: "D'après le Daizenshuu 4 (p. 121), art martial permettant de flotter et se propulser dans les airs en contrôlant son ki. Originaire de l'école de la Grue, adopté par l'ensemble des combattants.",
	},
	{
		nameOrSlug: "Zanzōken",
		searchTerms: ["残像拳", "Zanzoken", "Image Rémanente"],
		type: "Kōgeki",
		canonNotes: "D'après le Daizenshuu 4, technique de vitesse pure laissant une illusion d'optique rémanente pour tromper l'ennemi. Maîtrisée par Kamé Sennin, Goku et Krilin.",
	},
];

async function main() {
	console.log("=== ENRICHISSEMENT DE LA CATÉGORIE TECHNIQUES VIA DATABOOKS ===");

	let updatedCount = 0;
	const nowBigInt = BigInt(Date.now());

	for (const target of TECH_TARGETS) {
		const techs = await sql`
			SELECT id, name, slug, type, article, article_sources 
			FROM bot.db_techniques 
			WHERE name ILIKE ${target.nameOrSlug}
			   OR name ILIKE ${"%" + target.nameOrSlug + "%"}
			   OR slug ILIKE ${target.nameOrSlug.toLowerCase()}
			ORDER BY id ASC
			LIMIT 1;
		`;

		if (techs.length === 0) {
			console.log(`⚠️ Technique introuvable : ${target.nameOrSlug}`);
			continue;
		}

		const tech = techs[0];
		console.log(`\nTraitement [#${tech.id}] ${tech.name}...`);

		const matches = await searchDatabooks(sql, target.searchTerms, { limit: 4 });
		console.log(`  -> ${matches.length} planches de databooks identifiées.`);

		let existingSources: WikiSourceRef[] = [];
		if (tech.article_sources) {
			try {
				existingSources = typeof tech.article_sources === "string"
					? JSON.parse(tech.article_sources)
					: tech.article_sources;
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

		let updatedArticle = tech.article ?? "";
		const databookSectionTitle = "## Classification & Spécifications Daizenshuu";

		if (!updatedArticle.includes(databookSectionTitle)) {
			const databookLines = [
				`\n\n${databookSectionTitle}`,
				"",
				`> **Classification officielle (Daizenshuu 4 — Dictionnaire des Techniques)** :`,
				`> - **Catégorie canonique :** \`${target.type}\``,
				`> - **Description & Origine :** ${target.canonNotes}`,
				"",
				"### Extraits des archives officielles transcrites :",
				...matches.map((m) => `- **${m.bookTitle}** (planche ${m.pageNumber}) : *« ${m.snippet} »* [Consulter la planche](/wiki/databooks/${m.bookId}#p-${m.pageNumber})`),
				"",
			].join("\n");

			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n" : "") + databookLines;
		}

		await sql`
			UPDATE bot.db_techniques
			SET type = COALESCE(type, ${target.type}),
			    article = ${updatedArticle},
			    article_sources = ${JSON.stringify(mergedSources)}::jsonb,
			    article_updated_at = ${nowBigInt}
			WHERE id = ${tech.id};
		`;

		await sql`
			INSERT INTO public.wiki_revisions (
				id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				${idRevision()}, 'db_techniques', ${tech.id}, 'update',
				${`Exploitation databooks pour la technique ${tech.name} (${matches.length} planches)`},
				${tech.article ?? ''}, ${updatedArticle},
				'subagent-techniques', 'Techniques Databook Enricher', NOW()
			);
		`;

		console.log(`  ✓ Technique [#${tech.id}] ${tech.name} enrichie avec succès (${mergedSources.length} sources).`);
		updatedCount++;
	}

	console.log(`\n✅ Terminé : ${updatedCount} techniques enrichies avec les databooks.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
