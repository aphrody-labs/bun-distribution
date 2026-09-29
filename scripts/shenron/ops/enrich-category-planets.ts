// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, searchDatabooks, buildDatabookSources, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

interface PlanetTarget {
	nameOrSearch: string;
	searchTerms: string[];
	canonNotes: string;
}

const PLANET_TARGETS: PlanetTarget[] = [
	{
		nameOrSearch: "Terre",
		searchTerms: ["地球", "Earth", "Terre"],
		canonNotes: "D'après le Daizenshuu 4 (Cosmologie et Géographie, p. 16-25) et le Daizenshuu 7, planète située dans la Zone Nord de l'Univers 7, gouvernée spirituellement par Dieu depuis son Sanctuaire céleste.",
	},
	{
		nameOrSearch: "Namek",
		searchTerms: ["ナメック星", "Namek", "Namekkusei"],
		canonNotes: "D'après le Daizenshuu 4 (p. 30), planète natale des Nameks située en dehors de la juridiction de Kaioh du Nord, éclairée en permanence par trois soleils sans nuit.",
	},
	{
		nameOrSearch: "Planète Vegeta",
		searchTerms: ["惑星ベジータ", "Planète Vegeta", "Planet Vegeta"],
		canonNotes: "D'après le Daizenshuu 4 (p. 34), ancienne planète Plant conquise par les Saiyans sous la conduite du Roi Vegeta, dotée d'une gravité décuplée (10G). Détruite par Freezer en Âge 737.",
	},
	{
		nameOrSearch: "Kaïoshinkaï",
		searchTerms: ["界王神界", "Kaioshin", "Kaioshinkai"],
		canonNotes: "D'après le Daizenshuu 4 (p. 15), domaine sacré des Kaiohshins gravitant au-delà du Macrocosme de l'Univers 7, totalement isolé du monde des mortels et de l'Au-delà.",
	},
	{
		nameOrSearch: "Planète Kaio",
		searchTerms: ["界王星", "Planète Kaio", "Planet Kaio"],
		canonNotes: "D'après le Daizenshuu 4 (p. 28), située au bout de la Route du Serpent (Serpentine) dans l'Au-delà. Autrefois immense, réduite par Beerus en une petite sphère à gravité 10G.",
	},
	{
		nameOrSearch: "Salle de l'Esprit et du Temps",
		searchTerms: ["精神と時の部屋", "Salle de l'esprit et du temps", "Room of Spirit and Time"],
		canonNotes: "D'après le Daizenshuu 4 (p. 26), dimension de poche accessible depuis le Palais de Dieu où une année terrestre correspond à un seul jour à l'intérieur, avec une gravité et des températures extrêmes.",
	},
	{
		nameOrSearch: "Sanctuaire de Dieu",
		searchTerms: ["神の神殿", "Palais de Dieu", "Sanctuaire"],
		canonNotes: "D'après le Daizenshuu 4 (p. 24), structure semi-sphérique flottant haut au-dessus de la Tour Karin, résidence du Dieu de la Terre et de son serviteur M. Popo.",
	},
	{
		nameOrSearch: "Tour Karin",
		searchTerms: ["カリン塔", "Tour Karin", "Karin Tower"],
		canonNotes: "D'après le Daizenshuu 4 (p. 22), gigantesque tour reliant la Terre sacrée de Karin au Sanctuaire de Dieu. Gardée par le maître ermite félin Karin.",
	},
];

async function main() {
	console.log("=== ENRICHISSEMENT DE LA CATÉGORIE PLANÈTES & LIEUX VIA DATABOOKS ===");

	let updatedCount = 0;
	const nowBigInt = BigInt(Date.now());

	for (const target of PLANET_TARGETS) {
		const planets = await sql`
			SELECT id, name, article, article_sources 
			FROM bot.db_planets 
			WHERE name ILIKE ${target.nameOrSearch}
			   OR name ILIKE ${"%" + target.nameOrSearch + "%"}
			ORDER BY id ASC
			LIMIT 1;
		`;

		if (planets.length === 0) {
			console.log(`⚠️ Planète/Lieu introuvable dans db_planets : ${target.nameOrSearch}`);
			continue;
		}

		const p = planets[0];
		console.log(`\nTraitement [#${p.id}] ${p.name}...`);

		const matches = await searchDatabooks(sql, target.searchTerms, { limit: 4 });
		console.log(`  -> ${matches.length} planches de databooks identifiées.`);

		let existingSources: WikiSourceRef[] = [];
		if (p.article_sources) {
			try {
				existingSources = typeof p.article_sources === "string"
					? JSON.parse(p.article_sources)
					: p.article_sources;
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

		let updatedArticle = p.article ?? "";
		const databookSectionTitle = "## Géographie & Données Cosmologiques Daizenshuu";

		if (!updatedArticle.includes(databookSectionTitle)) {
			const databookLines = [
				`\n\n${databookSectionTitle}`,
				"",
				`> **Archives officielles (Daizenshuu 4 — Cosmologie & Géographie)** :`,
				`> ${target.canonNotes}`,
				"",
				"### Planches des archives officielles transcrites :",
				...matches.map((m) => `- **${m.bookTitle}** (planche ${m.pageNumber}) : *« ${m.snippet} »* [Consulter la planche](/wiki/databooks/${m.bookId}#p-${m.pageNumber})`),
				"",
			].join("\n");

			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n" : "") + databookLines;
		}

		await sql`
			UPDATE bot.db_planets
			SET article = ${updatedArticle},
			    article_sources = ${JSON.stringify(mergedSources)}::jsonb,
			    article_updated_at = ${nowBigInt}
			WHERE id = ${p.id};
		`;

		await sql`
			INSERT INTO public.wiki_revisions (
				"tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				'db_planets', ${p.id}, 'update',
				${`Exploitation databooks pour le lieu ${p.name} (${matches.length} planches)`},
				${p.article ?? ''}, ${updatedArticle},
				'subagent-planets', 'Planets Databook Enricher', NOW()
			);
		`;

		console.log(`  ✓ Planète [#${p.id}] ${p.name} enrichie avec succès (${mergedSources.length} sources).`);
		updatedCount++;
	}

	console.log(`\n✅ Terminé : ${updatedCount} planètes/lieux enrichis avec les databooks.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
