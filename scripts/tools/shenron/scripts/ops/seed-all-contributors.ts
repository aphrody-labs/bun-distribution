#!/usr/bin/env bun
/**
 * scripts/ops/seed-all-contributors.ts — Ingestion des 23 Bâtisseurs Majeurs & Crédits
 *
 * Peuplement exhaustif de bot.contributors et bot.contributor_credits d'après
 * le catalogue canonique de production Dragon Ball (Toriyama, éditeurs, scénaristes Toei,
 * chara-designers / directeurs d'animation, seiyū légendaires et compositeurs).
 *
 * Idempotence garantie : ON CONFLICT (slug) DO UPDATE.
 */
import postgres from "postgres";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("FATAL: DATABASE_URL requis.");
	process.exit(1);
}

const sql = postgres(DATABASE_URL);
const sqlitePath = resolve(import.meta.dir, "../../apps/bot/data/bot.db");
const sqlite = new Database(sqlitePath);

interface ContributorDef {
	slug: string;
	name: string;
	name_ja: string;
	name_romaji: string;
	category: "author" | "editorial_staff" | "scenario" | "animation" | "voice" | "music" | "publisher" | "other";
	birth_date?: string | null;
	death_date?: string | null;
	biography_fr: string;
	spotlight_rank?: number | null;
	credit?: {
		role: string;
		scope: "work" | "character" | "soundtrack";
		targetWorkSlug?: string;
		targetCharacterName?: string;
	};
}

const CONTRIBUTORS: ContributorDef[] = [
	// 1. Auteur & Démiurge
	{
		slug: "akira-toriyama",
		name: "Akira Toriyama",
		name_ja: "鳥山明",
		name_romaji: "Toriyama Akira",
		category: "author",
		birth_date: "1955-04-05",
		death_date: "2024-03-01",
		biography_fr: "Auteur légendaire, mangaka et créateur absolu de Dragon Ball. En 42 tomes et 519 chapitres parus dans le Weekly Shōnen Jump, il a fondé les codes du shōnen planétaire moderne.",
		spotlight_rank: 0,
		credit: {
			role: "Auteur original, Mangaka & Scénariste",
			scope: "work",
			targetWorkSlug: "dragon-ball",
		},
	},

	// 2. Éditeurs Shueisha
	{
		slug: "kazuhiko-torishima",
		name: "Kazuhiko Torishima",
		name_ja: "鳥嶋和彦",
		name_romaji: "Torishima Kazuhiko",
		category: "editorial_staff",
		birth_date: "1952-10-20",
		biography_fr: "1er Éditeur de Toriyama (Dr. Slump & Genèse Dragon Ball). Réputé pour son exigence ('Recommence !'), il a orienté Toriyama vers les arts martiaux et inspiré le Roi Démon Piccolo.",
		spotlight_rank: 1,
	},
	{
		slug: "yu-kondo",
		name: "Yu Kondo",
		name_ja: "近藤裕",
		name_romaji: "Kondō Yū",
		category: "editorial_staff",
		biography_fr: "2e Éditeur (Arc Saiyans & Arc Namek / Freezer). Sous son impulsion, la narration a pris une tournure dramatique et cosmique, favorisant l'éveil du Super Saiyan.",
		spotlight_rank: 11,
	},
	{
		slug: "fuyuto-takeda",
		name: "Fuyuto Takeda",
		name_ja: "武田冬門",
		name_romaji: "Takeda Fuyuto",
		category: "editorial_staff",
		biography_fr: "3e Éditeur (Arc Cyborgs / Cell & Arc Majin Buu). A accompagné Toriyama jusqu'au 519e et dernier chapitre du manga, encourageant le retour à l'humour et aux fusions.",
		spotlight_rank: 12,
	},
	{
		slug: "akio-iyoku",
		name: "Akio Iyoku",
		name_ja: "伊能昭夫",
		name_romaji: "Iyoku Akio",
		category: "editorial_staff",
		biography_fr: "Directeur de la Dragon Ball Room chez Shueisha puis président de Capsule Corporation Tokyo. Chef d'orchestre de la continuité canonique moderne (DBS Broly, Super Hero, Daima).",
		spotlight_rank: 13,
	},

	// 3. Scénaristes Toei Animation
	{
		slug: "takao-koyama",
		name: "Takao Koyama",
		name_ja: "小山高生",
		name_romaji: "Koyama Takao",
		category: "scenario",
		birth_date: "1948-04-21",
		biography_fr: "Scénariste en chef de Dragon Ball Z (épisodes 1 à 291) et auteur des scénarios des 13 premiers films d'animation DBZ chez Toei Animation (Broly, Cooler, Janemba).",
		spotlight_rank: 2,
	},
	{
		slug: "katsuyuki-sumisawa",
		name: "Katsuyuki Sumisawa",
		name_ja: "隅沢克之",
		name_romaji: "Sumisawa Katsuyuki",
		category: "scenario",
		biography_fr: "Scénariste prolifique de l'anime Dragon Ball et DBZ, plume des arcs Saiyans et Freezer et de plusieurs films Toei.",
		spotlight_rank: 21,
	},
	{
		slug: "aya-matsui",
		name: "Aya Matsui",
		name_ja: "松井亜弥",
		name_romaji: "Matsui Aya",
		category: "scenario",
		biography_fr: "Scénariste clé de Dragon Ball et Dragon Ball Z, ayant apporté une grande sensibilité aux épisodes centrés sur Gohan et Chichi.",
		spotlight_rank: 22,
	},

	// 4. Direction de l'Animation & Character Design
	{
		slug: "minoru-maeda",
		name: "Minoru Maeda",
		name_ja: "前田実",
		name_romaji: "Maeda Minoru",
		category: "animation",
		birth_date: "1954-04-03",
		biography_fr: "Directeur de l'animation en chef sur Dragon Ball et Dragon Ball Z jusqu'à la fin de l'arc Cell. Son style doux et organique définit l'âge d'or visuel de la série télévisée.",
		spotlight_rank: 31,
	},
	{
		slug: "katsuyoshi-nakatsuru",
		name: "Katsuyoshi Nakatsuru",
		name_ja: "中鶴勝祥",
		name_romaji: "Nakatsuru Katsuyoshi",
		category: "animation",
		birth_date: "1962-05-22",
		biography_fr: "Animateur de génie dont le trait était si proche d'Akira Toriyama que l'auteur lui-même s'y méprenait. Créateur du design de Bardock et du Super Saiyan 4 de DBGT.",
		spotlight_rank: 32,
	},
	{
		slug: "tadayoshi-yamamuro",
		name: "Tadayoshi Yamamuro",
		name_ja: "山室直儀",
		name_romaji: "Yamamuro Tadayoshi",
		category: "animation",
		birth_date: "1960-01-01",
		biography_fr: "Directeur de l'animation de l'arc Majin Buu, des films des années 1990 et superviseur général de Dragon Ball Super et du film Battle of Gods.",
		spotlight_rank: 33,
	},
	{
		slug: "naohiro-shintani",
		name: "Naohiro Shintani",
		name_ja: "新谷直大",
		name_romaji: "Shintani Naohiro",
		category: "animation",
		biography_fr: "Directeur de l'animation du film phénomène Dragon Ball Super : Broly (2018). Choisi personnellement par Toriyama pour son trait épuré, souple et fidèle au manga original.",
		spotlight_rank: 34,
	},
	{
		slug: "chikashi-kubota",
		name: "Chikashi Kubota",
		name_ja: "久保田誓",
		name_romaji: "Kubota Chikashi",
		category: "animation",
		birth_date: "1978-01-01",
		biography_fr: "Directeur de l'animation de Dragon Ball Super : Super Hero (prologue 2D) et character designer en chef de Dragon Ball Daima (2024).",
		spotlight_rank: 35,
	},

	// 5. Voix Légendaires (Seiyū VO)
	{
		slug: "masako-nozawa",
		name: "Masako Nozawa",
		name_ja: "野沢雅子",
		name_romaji: "Nozawa Masako",
		category: "voice",
		birth_date: "1936-10-25",
		biography_fr: "Seiyū d'exception incarnant Son Goku, Son Gohan, Son Goten, Bardock, Vegetto et Gotenks. Voix de Goku depuis le premier épisode de 1986.",
		spotlight_rank: 3,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Son Goku",
		},
	},
	{
		slug: "toshio-furukawa",
		name: "Toshio Furukawa",
		name_ja: "古川登志夫",
		name_romaji: "Furukawa Toshio",
		category: "voice",
		birth_date: "1946-07-16",
		biography_fr: "Comédien de doublage japonais incarnant Piccolo (Piccolo Daimaô Jr) depuis le 23e Tenkaichi Budokai.",
		spotlight_rank: 41,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Piccolo",
		},
	},
	{
		slug: "ryo-horikawa",
		name: "Ryo Horikawa",
		name_ja: "堀川りょう",
		name_romaji: "Horikawa Ryō",
		category: "voice",
		birth_date: "1958-02-01",
		biography_fr: "Voix emblématique de Vegeta depuis son apparition dans la saga Saiyans en 1989, conférant au prince des Saiyans sa fierté royale légendaire.",
		spotlight_rank: 42,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Vegeta",
		},
	},
	{
		slug: "mayumi-tanaka",
		name: "Mayumi Tanaka",
		name_ja: "田中真弓",
		name_romaji: "Tanaka Mayumi",
		category: "voice",
		birth_date: "1955-01-15",
		biography_fr: "Voix historique de Krillin et Yajirobé dans l'intégralité des séries et films Dragon Ball.",
		spotlight_rank: 43,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Krillin",
		},
	},
	{
		slug: "takeshi-kusao",
		name: "Takeshi Kusao",
		name_ja: "草尾毅",
		name_romaji: "Kusao Takeshi",
		category: "voice",
		birth_date: "1965-11-20",
		biography_fr: "Voix de Trunks (Trunks du Futur et Trunks enfant) depuis son arrivée cataclysmique face à Mecha Freezer.",
		spotlight_rank: 44,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Trunks",
		},
	},
	{
		slug: "ryusei-nakao",
		name: "Ryusei Nakao",
		name_ja: "中尾隆聖",
		name_romaji: "Nakao Ryūsei",
		category: "voice",
		birth_date: "1951-02-05",
		biography_fr: "Interprète magistral de l'empereur Freezer, de Cooler et de Frost. Son rire sardonique 'Hohoho' est entré dans l'histoire de l'animation.",
		spotlight_rank: 45,
		credit: {
			role: "Voix originale japonaise (VO)",
			scope: "character",
			targetCharacterName: "Freezer",
		},
	},

	// 6. Musique & Bandes Originales
	{
		slug: "shunsuke-kikuchi",
		name: "Shunsuke Kikuchi",
		name_ja: "菊池俊輔",
		name_romaji: "Kikuchi Shunsuke",
		category: "music",
		birth_date: "1931-11-01",
		death_date: "2021-04-24",
		biography_fr: "Compositeur symphonique de génie dont les 400+ pistes orchestrales ont forgé l'âme musicale de Dragon Ball et Dragon Ball Z.",
		spotlight_rank: 4,
	},
	{
		slug: "norihito-sumitomo",
		name: "Norihito Sumitomo",
		name_ja: "住友紀人",
		name_romaji: "Sumitomo Norihito",
		category: "music",
		birth_date: "1964-02-27",
		biography_fr: "Compositeur de Dragon Ball Z : Battle of Gods, Resurrection 'F', Dragon Ball Kai (saga Buu) et Dragon Ball Super.",
		spotlight_rank: 51,
	},
	{
		slug: "hironobu-kageyama",
		name: "Hironobu Kageyama",
		name_ja: "影山ヒロノブ",
		name_romaji: "Kageyama Hironobu",
		category: "music",
		birth_date: "1961-02-18",
		biography_fr: "Chanteur mythique interprétant 'CHA-LA HEAD-CHA-LA', 'WE GOTTA POWER' et les plus grands hymnes énergétiques de la saga.",
		spotlight_rank: 52,
	},
	{
		slug: "hiroki-takahashi",
		name: "Hiroki Takahashi",
		name_ja: "高橋洋樹",
		name_romaji: "Takahashi Hiroki",
		category: "music",
		birth_date: "1965-05-06",
		biography_fr: "Chanteur de 'Makafushigi Adventure!', générique d'ouverture légendaire de la première série animée Dragon Ball (1986).",
		spotlight_rank: 53,
	},
];

async function run() {
	console.log(`[Seed Contributors] Démarrage... Ingestion de ${CONTRIBUTORS.length} contributeurs`);

	let insertedPostgres = 0;
	let insertedCredits = 0;

	for (const c of CONTRIBUTORS) {
		// 1. Insertion Postgres
		const [row] = await sql`
			INSERT INTO bot.contributors (
				slug, name, name_ja, name_romaji, category, birth_date, death_date, biography_fr, spotlight_rank, visible
			) VALUES (
				${c.slug},
				${c.name},
				${c.name_ja},
				${c.name_romaji},
				${c.category},
				${c.birth_date ? c.birth_date : null},
				${c.death_date ? c.death_date : null},
				${c.biography_fr},
				${c.spotlight_rank ?? null},
				true
			)
			ON CONFLICT (slug) DO UPDATE SET
				name = EXCLUDED.name,
				name_ja = EXCLUDED.name_ja,
				name_romaji = EXCLUDED.name_romaji,
				category = EXCLUDED.category,
				birth_date = EXCLUDED.birth_date,
				death_date = EXCLUDED.death_date,
				biography_fr = EXCLUDED.biography_fr,
				spotlight_rank = EXCLUDED.spotlight_rank,
				visible = true
			RETURNING id;
		`;

		const contributorId = Number(row.id);
		insertedPostgres++;

		// 2. Réplique SQLite
		sqlite.run(
			`INSERT INTO contributors (
				id, slug, name, name_ja, name_romaji, category, birth_date, death_date, biography_fr, spotlight_rank, visible
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
			ON CONFLICT(slug) DO UPDATE SET
				name = excluded.name,
				name_ja = excluded.name_ja,
				name_romaji = excluded.name_romaji,
				category = excluded.category,
				biography_fr = excluded.biography_fr,
				spotlight_rank = excluded.spotlight_rank,
				visible = 1;`,
			[
				contributorId,
				c.slug,
				c.name,
				c.name_ja,
				c.name_romaji,
				c.category,
				c.birth_date ?? null,
				c.death_date ?? null,
				c.biography_fr,
				c.spotlight_rank ?? null,
			]
		);

		// 3. Crédits associés
		if (c.credit) {
			if (c.credit.scope === "work" && c.credit.targetWorkSlug) {
				const [work] = await sql`SELECT id FROM bot.media_works WHERE slug = ${c.credit.targetWorkSlug} LIMIT 1;`;
				if (work) {
					await sql`
						INSERT INTO bot.contributor_credits (contributor_id, role, credit_scope, work_id, visible)
						VALUES (${contributorId}, ${c.credit.role}, 'work', ${Number(work.id)}, true)
						ON CONFLICT DO NOTHING;
					`;
					insertedCredits++;
				}
			} else if (c.credit.scope === "character" && c.credit.targetCharacterName) {
				const [char] = await sql`
					SELECT id FROM bot.db_characters WHERE name ILIKE ${'%' + c.credit.targetCharacterName + '%'} LIMIT 1;
				`;
				if (char) {
					await sql`
						INSERT INTO bot.contributor_credits (contributor_id, role, credit_scope, character_id, visible)
						VALUES (${contributorId}, ${c.credit.role}, 'character', ${Number(char.id)}, true)
						ON CONFLICT DO NOTHING;
					`;
					insertedCredits++;
				}
			}
		}
	}

	console.log(`\n✓ ${insertedPostgres} contributeurs synchronisés sur Neon PostgreSQL et SQLite.`);
	console.log(`✓ ${insertedCredits} crédits spécifiques attachés.`);
	console.log(`✓ Akira Toriyama spotlight_rank = 0 préservé.`);
	await sql.end();
}

run().catch((err) => {
	console.error("FATAL:", err);
	process.exit(1);
});
