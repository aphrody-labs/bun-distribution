// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

interface DatabookPlateRef {
	bookId: number;
	bookTitle: string;
	pageNumber: number;
	label: string;
	snippet: string;
}

interface SagaTarget {
	canonicalName: string;
	slugOrName: string;
	slugAliases: string[];
	nameAliases: string[];
	ages: string;
	canonNotes: string;
	plates: DatabookPlateRef[];
}

const SAGA_TARGETS: SagaTarget[] = [
	{
		canonicalName: "Saga Saiyans",
		slugOrName: "Saga Saiyan",
		slugAliases: ["saiyan"],
		nameAliases: ["Saga Saiyan", "Saga Saiyans"],
		ages: "Âge 761 – Âge 762",
		canonNotes: "D'après la chronologie officielle du Daizenshuu 7 (Chronologie du Dragon World) et du Daizenshuu 2 (Story Guide) : Raditz arrive sur Terre le 12 octobre de l'Âge 761, provoquant la mort de Goku et de Raditz. Après un an d'entraînement chez Maître Kaio pour Goku et auprès de Piccolo pour Gohan, Nappa et Vegeta débarquent le 3 novembre de l'Âge 762 pour la bataille décisive de la Terre.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 22,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 22 (Chronologie Dragon World — Âge 761 : Arrivée de Raditz)",
				snippet: "761 : Raditz arrive sur Terre le 12 octobre. Goku meurt en se sacrifiant pour terrasser l'envahisseur.",
			},
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 23,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 23 (Chronologie Dragon World — Âge 762 : Assaut de Nappa et Vegeta)",
				snippet: "3 novembre 762 : Débarquement de Vegeta et Nappa sur Terre. Affrontement héroïque des Guerriers Z et duel Goku vs Vegeta.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 57,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 57 (Story Guide — Saga Saiyans : Raditz et le potentiel de Gohan)",
				snippet: "ADVENTURE HISTORY — サイヤ人編 (Saga Saiyan) : Les révélations sur les origines de Son Goku et la colère cachée de Son Gohan.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 59,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 59 (Story Guide — Saga Saiyans : Le duel au sommet contre Vegeta)",
				snippet: "ADVENTURE HISTORY — Choc colossal contre le prince des Saiyans Vegeta et recours ultime au Kaiô-ken.",
			},
		],
	},
	{
		canonicalName: "Saga Freezer",
		slugOrName: "Saga Freezer",
		slugAliases: ["saga_freezer", "freezer"],
		nameAliases: ["Saga Freezer"],
		ages: "Âge 762 – Âge 764",
		canonNotes: "D'après le Daizenshuu 7 (Chronologie) et le Daizenshuu 2 (Story Guide) : Départ du vaisseau namek le 14 novembre 762. Débarquement sur Namek le 18 décembre 762. Défaite du commando Ginyu et affrontement titanesque contre Freezer. Le 24 décembre 762, Goku s'éveille en Super Saiyan légendaire et terrasse Freezer avant l'explosion de Namek. En août 764, Trunks du futur élimine Freezer cybernétique et le Roi Cold lors de leur venue sur Terre.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 24,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 24 (Chronologie Dragon World — Âge 762 : Expédition sur Namek)",
				snippet: "14 novembre 762 : Départ vers Namek. 18 décembre 762 : Débarquement sur Namek et course frénétique aux Dragon Balls.",
			},
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 25,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 25 (Chronologie Dragon World — Âge 762 : Super Saiyan et chute de Freezer)",
				snippet: "24 décembre 762 : Éveil du Super Saiyan légendaire, défaite de Freezer et destruction cosmique de Namek.",
			},
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 26,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 26 (Chronologie Dragon World — Âge 764 : Trunks pulvérise Mecha Freezer)",
				snippet: "Août 764 : Arrivée sur Terre de Freezer cybernétique et du Roi Cold, promptement annihilés par Trunks du futur.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 61,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 61 (Story Guide — Saga Freezer : La campagne militaire de Namek)",
				snippet: "ADVENTURE HISTORY — フリーザ編 (Saga Freezer) : La guerre pour les boules namekiennes contre les lieutenants et le Commando Ginyu.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 63,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 63 (Story Guide — Saga Freezer : L'éveil du guerrier légendaire)",
				snippet: "ADVENTURE HISTORY — Face-à-face mortel entre Son Goku et Freezer dans sa forme finale, triomphe du Super Saiyan.",
			},
		],
	},
	{
		canonicalName: "Saga Cell",
		slugOrName: "Saga Cell",
		slugAliases: ["cell"],
		nameAliases: ["Saga Cell"],
		ages: "Âge 764 – Âge 767",
		canonNotes: "D'après le Daizenshuu 7 et le Daizenshuu 2 : Avertissement de Trunks en août 764 suivi de 3 ans de préparation. Le 12 mai 767, apparition des cyborgs C-19 et C-20 sur l'île d'Amenbo, puis libération de C-17 et C-18 et émergence de Cell venu du futur. Le 26 mai 767 s'ouvre le Cell Games : sacrifice de Goku, transcendance de Gohan Super Saiyan 2 et destruction définitive de Cell par le Kamehameha Père-Fils.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 26,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 26 (Chronologie Dragon World — Âge 764-767 : Entraînement face aux Cyborgs)",
				snippet: "An 764 - 767 : Préparation intensive des Guerriers Z consécutive aux alertes de Trunks sur l'émergence des cyborgs.",
			},
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 27,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 27 (Chronologie Dragon World — Âge 767 : Cell Games et Gohan Super Saiyan 2)",
				snippet: "12 mai 767 : Émergence des androïdes. 26 mai 767 : Cell Games, sacrifice de Son Goku et triomphe de Son Gohan Super Saiyan 2.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 69,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 69 (Story Guide — Saga Cell & Cyborgs : Le fléau cybernétique)",
				snippet: "ADVENTURE HISTORY — セル編 / 人造人間編 (Saga Cell) : Les créations du Dr Gero et l'horreur de l'organisme biomécanique Cell.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 71,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 71 (Story Guide — Saga Cell : Corps Parfait et défi au monde)",
				snippet: "ADVENTURE HISTORY — Cell absorbe C-17 et C-18, concrétise sa forme parfaite et convoque le monde entier au Cell Games.",
			},
		],
	},
	{
		canonicalName: "Saga Majin Buu",
		slugOrName: "Saga Majin Boo",
		slugAliases: ["buu"],
		nameAliases: ["Saga Majin Boo", "Saga Majin Buu"],
		ages: "Âge 774",
		canonNotes: "D'après la chronologie officielle du Daizenshuu 7 et du Daizenshuu 2 : Le 7 mai de l'Âge 774 s'ouvre le 25e Tenkaichi Budokai avec le retour de Son Goku pour une journée sur Terre. Réveil de Majin Buu par Babidi le même jour. Combats intenses, apprentissage de la Fusion, apparition de Gotenks, Son Gohan Ultime et Vegetto. Le 9 mai 774, Goku anéantit Kid Buu au Domaine des Dieux Kaio grâce au Super Genkidama unissant l'énergie de l'univers.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 28,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 28 (Chronologie Dragon World — Âge 774 : 25e Tenkaichi Budokai et Babidi)",
				snippet: "An 774 : Période de paix, entraînement de Goten et Trunks et ouverture du 25e Tenkaichi Budokai.",
			},
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 29,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 29 (Chronologie Dragon World — Âge 774 : Majin Buu et Genkidama suprême)",
				snippet: "7 mai 774 : Libération de Majin Buu. 9 mai 774 : Destruction de Kid Buu par le Super Genkidama au Kaiôshin-kai.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 78,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 78 (Story Guide — Saga Majin Buu : La fureur de Majin Buu et sacrifice de Vegeta)",
				snippet: "ADVENTURE HISTORY — 魔人ブウ編 (Saga Majin Buu) : Réveil de la terreur millénaire, ultime sacrifice de Majin Vegeta.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 80,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 80 (Story Guide — Saga Majin Buu : Gotenks, Vegetto et conclusion cosmique)",
				snippet: "ADVENTURE HISTORY — Fusions suprêmes Gotenks et Vegetto, bataille acharnée au Royaume Céleste et délivrance universelle.",
			},
		],
	},
	{
		canonicalName: "Saga Armée du Ruban Rouge",
		slugOrName: "Saga Armée du Red Ribbon",
		slugAliases: ["red-ribbon"],
		nameAliases: ["Saga Armée du Red Ribbon", "Saga Armée du Ruban Rouge"],
		ages: "Âge 750",
		canonNotes: "D'après le Daizenshuu 7 (Chronologie) et le Daizenshuu 2 (Story Guide) : L'escadron Silver lance la recherche des Dragon Balls le 18 avril de l'Âge 750. Son Goku triomphe de la Tour du Muscle (Général Blanc, Sergent Métallique), déjoue les pièges du Général Blue à la base sous-marine, s'entraîne auprès de Maître Karin suite à l'attaque de Tao Pai Pai, et détruit seul le quartier général de l'armée du Ruban Rouge en mai 750.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 20,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 20 (Chronologie Dragon World — Âge 750 : Offensive et destruction du Red Ribbon)",
				snippet: "18 avril 750 : L'escadron Silver commence la traque. Mai 750 : Goku assaille et pulvérise le grand quartier général du Ruban Rouge.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 44,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 44 (Story Guide — Saga Red Ribbon : La Tour du Muscle)",
				snippet: "ADVENTURE HISTORY — レッドリボン軍編 (Saga Red Ribbon) : Franchissement des étages de la Tour du Muscle et défaite du Général Blanc.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 47,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 47 (Story Guide — Saga Red Ribbon : Tao Pai Pai et chute du QG)",
				snippet: "ADVENTURE HISTORY — Duel impitoyable contre Tao Pai Pai, dépassement chez Maître Karin et anéantissement de l'armée.",
			},
		],
	},
	{
		canonicalName: "Saga Roi Démon Piccolo",
		slugOrName: "Saga Piccolo Daimaô",
		slugAliases: ["piccolo-daimao"],
		nameAliases: ["Saga Piccolo Daimaô", "Saga Roi Démon Piccolo"],
		ages: "Âge 753",
		canonNotes: "D'après la chronologie officielle du Daizenshuu 7 et du Daizenshuu 2 : Le 22e Tenkaichi Budokai s'achève le 7 mai de l'Âge 753 par le meurtre de Krilin par Tambourine, marquant le retour du Roi Démon Piccolo libéré par Pilaf. Le 9 mai 753 (« Jour de Piccolo »), après avoir bu la véritable Eau Ultra Sacrée chez Maître Karin, Goku transperce Piccolo Daimaō d'un coup de poing dévastateur à King Castle, sauvant le monde avant la ponte de son incarnation de réincarnation.",
		plates: [
			{
				bookId: 4,
				bookTitle: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
				pageNumber: 21,
				label: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten, planche 21 (Chronologie Dragon World — Âge 753 : Règne de Piccolo Daimaō et délivrance)",
				snippet: "7 mai 753 : Mort tragique de Krilin et terreur de Piccolo Daimaō. 9 mai 753 : Goku terrasse le Démon à King Castle.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 53,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 53 (Story Guide — Saga Piccolo Daimaō : Le duel désespéré)",
				snippet: "ADVENTURE HISTORY — Affrontement direct contre le Roi Démon Piccolo, sacrifices héroïques pour conjurer l'apocalypse.",
			},
			{
				bookId: 2,
				bookTitle: "Dragon Ball Daizenshuu 2 — Story Guide",
				pageNumber: 129,
				label: "Dragon Ball Daizenshuu 2 — Story Guide, planche 129 (Story Guide — Saga Piccolo Daimaō : La rage de Goku et le combat final)",
				snippet: "ADVENTURE HISTORY — La douleur indicible de la perte de Krilin et la revanche absolue de Son Goku terrassant le grand démon.",
			},
		],
	},
];

function generateRevisionId(): string {
	return Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");
}

async function main() {
	console.log("=== ENRICHISSEMENT DE LA CATÉGORIE SAGAS & CHRONOLOGIE VIA DATABOOKS ===");

	let updatedCount = 0;

	for (const target of SAGA_TARGETS) {
		const sagas = await sql`
			SELECT id, name, slug, article, article_sources 
			FROM bot.db_sagas 
			WHERE slug IN ${sql(target.slugAliases)}
			   OR name IN ${sql(target.nameAliases)}
			   OR name ILIKE ${target.slugOrName}
			   OR name ILIKE ${"%" + target.slugOrName + "%"}
			ORDER BY id ASC
			LIMIT 1;
		`;

		if (sagas.length === 0) {
			console.log(`⚠️ Saga introuvable : ${target.canonicalName} (${target.slugOrName})`);
			continue;
		}

		const s = sagas[0];
		console.log(`\nTraitement [#${s.id}] ${s.name} (${target.canonicalName})...`);

		let existingSources: WikiSourceRef[] = [];
		if (s.article_sources) {
			try {
				existingSources = typeof s.article_sources === "string"
					? JSON.parse(s.article_sources)
					: s.article_sources;
				if (!Array.isArray(existingSources)) existingSources = [];
			} catch {
				existingSources = [];
			}
		}

		const newSources: WikiSourceRef[] = target.plates.map((p, idx) => ({
			n: existingSources.length + idx + 1,
			label: p.label,
			url: `/wiki/databooks/${p.bookId}#p-${p.pageNumber}`,
			kind: "databook",
		}));

		const mergedSources: WikiSourceRef[] = [...existingSources];
		for (const ns of newSources) {
			if (!mergedSources.some((src) => src.url === ns.url)) {
				mergedSources.push(ns);
			}
		}
		mergedSources.forEach((src, idx) => { src.n = idx + 1; });

		let updatedArticle = s.article ?? "";
		const databookSectionTitle = "## Chronologie Canonique & Événements Daizenshuu";

		const databookLines = [
			databookSectionTitle,
			"",
			`> **Repères chronologiques officiels (Daizenshuu 7 — Chronologie du Dragon World & Daizenshuu 2 — Story Guide)** :`,
			`> - **Période calendaire :** \`${target.ages}\``,
			`> - **Déroulement canonique :** ${target.canonNotes}`,
			"",
			"### Planches des archives officielles transcrites :",
			...target.plates.map((p) => `- **${p.bookTitle}** (planche ${p.pageNumber}) : *« ${p.snippet} »* [Consulter la planche](/wiki/databooks/${p.bookId}#p-${p.pageNumber})`),
			"",
		].join("\n");

		if (updatedArticle.includes(databookSectionTitle)) {
			const parts = updatedArticle.split(databookSectionTitle);
			updatedArticle = parts[0].trim() + "\n\n" + databookLines;
		} else {
			updatedArticle = (updatedArticle ? updatedArticle.trim() + "\n\n" : "") + databookLines;
		}

		const nowSeconds = Math.floor(Date.now() / 1000);

		await sql`
			UPDATE bot.db_sagas
			SET article = ${updatedArticle},
			    article_sources = ${sql.json(mergedSources)},
			    article_updated_at = ${nowSeconds}
			WHERE id = ${s.id};
		`;

		const revId = generateRevisionId();

		await sql`
			INSERT INTO public.wiki_revisions (
				id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
			) VALUES (
				${revId},
				'db_sagas',
				${String(s.id)},
				'update',
				${`Chronologie Daizenshuu 7 & 2 pour ${s.name} (${target.plates.length} planches liées)`},
				${sql.json({ article: s.article, article_sources: existingSources })},
				${sql.json({ article: updatedArticle, article_sources: mergedSources })},
				'subagent-sagas',
				'Subagent Sagas Databook Enricher',
				NOW()
			);
		`;

		console.log(`  ✓ Saga [#${s.id}] ${s.name} enrichie avec succès (${mergedSources.length} sources au total, révision ${revId}).`);
		updatedCount++;
	}

	console.log(`\n✅ Terminé : ${updatedCount} sagas enrichies avec les databooks Daizenshuu 7 & 2.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
