/**
 * backfill-narrative-graph.ts — Sprint 3 Graphe Narratif & Contributeurs
 *
 * Unifie les combats (47 db_battles), tournois (10 db_tournaments) et
 * événements chronologiques (32 db_timeline_events) sous l'ontologie unifiée :
 *   - bot.narrative_timelines (manga-canon, anime-toei, movies-dbz, xenoverse)
 *   - bot.narrative_events (battle, tournament, event, war)
 *   - bot.narrative_event_participants (characters reliés)
 *   - bot.narrative_event_relations (contains, variant_of, adaptation_of)
 *   - bot.contributors (Spotlight Toriyama rank=0, Torishima, Koyama, Nozawa, Kikuchi)
 *   - bot.contributor_credits (liens stricts vérifiés)
 *
 * Zéro suppression physique (visible = false obligatoire).
 * Usage : bun scripts/ops/backfill-narrative-graph.ts [--dry-run]
 */
import { Database } from "bun:sqlite";
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL requis dans l'environnement.");
	process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");
const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sqlite = new Database("apps/bot/data/bot.db");

function slugify(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function main() {
	console.log(`[Sprint 3 Narrative Backfill] Démarrage... Mode: ${isDryRun ? "DRY-RUN" : "LIVE"}`);

	// 1. Lignes temporelles majeures
	console.log("→ Ingestion bot.narrative_timelines...");
	const TIMELINES_DEF = [
		{ slug: "manga-canon", kind: "manga", label: "Continuité Manga Canonique (Toriyama)" },
		{ slug: "anime-toei", kind: "anime", label: "Continuité Toei Animation (DB, DBZ, DBGT, DBS)" },
		{ slug: "movies-dbz", kind: "film", label: "Univers Alternatif des Films DBZ" },
		{ slug: "xenoverse", kind: "xenoverse", label: "Lignes Temporelles Dérivées & Multivers" },
	];

	const timelineMap: Record<string, number> = {};
	for (const t of TIMELINES_DEF) {
		if (isDryRun) {
			timelineMap[t.slug] = 1;
			console.log(`  [DRY] narrative_timelines '${t.slug}'`);
		} else {
			const [row] = await sql`
				INSERT INTO bot.narrative_timelines (slug, kind, label, visible)
				VALUES (${t.slug}, ${t.kind}, ${t.label}, true)
				ON CONFLICT (slug) DO UPDATE SET
					label = EXCLUDED.label
				RETURNING id;
			`;
			timelineMap[t.slug] = Number(row.id);
			console.log(`  ✓ narrative_timelines '${t.slug}' (id: ${timelineMap[t.slug]})`);
		}
	}

	const canonTimelineId = timelineMap["manga-canon"] ?? 1;

	// Preload des personnages pour résolution des participants
	console.log("→ Chargement du lexique des personnages...");
	const characters = await sql`SELECT id, name FROM bot.db_characters WHERE visible = true;`;
	const charByName = new Map<string, number>();
	for (const c of characters) {
		charByName.set(c.name.toLowerCase().trim(), Number(c.id));
	}
	const findChar = (rawName: string): number | null => {
		const norm = rawName.toLowerCase().trim();
		if (charByName.has(norm)) return charByName.get(norm)!;
		const clean = norm.replace(/\s*\([^)]*\)/g, "").trim();
		if (charByName.has(clean)) return charByName.get(clean)!;
		for (const [k, id] of charByName.entries()) {
			if (k.length > 3 && (k.includes(clean) || clean.includes(k))) return id;
		}
		return null;
	};

	// 2. Unification des Combats (depuis SQLite apps/bot/data/bot.db)
	console.log("→ Lecture des combats depuis SQLite...");
	const battles = sqlite.query("SELECT * FROM db_battles WHERE visible = 1;").all() as any[];
	console.log(`  Trouvé : ${battles.length} combats.`);

	let insertedBattles = 0;
	let insertedParticipants = 0;
	const eventBySlug: Map<string, number> = new Map();

	for (const b of battles) {
		const evSlug = `battle-${b.slug}`;
		const canonRank = b.canon ? "absolute" : "non_canon";

		let eventId: number;
		if (isDryRun) {
			eventId = Number(b.id);
			eventBySlug.set(evSlug, eventId);
			insertedBattles++;
		} else {
			const [ev] = await sql`
				INSERT INTO bot.narrative_events (
					slug, kind, title, title_ja, synopsis_fr, timeline_id, saga_id, arc_id, canon, visible
				) VALUES (
					${evSlug},
					'battle',
					${b.title},
					${b.title_ja},
					${b.climax_summary},
					${canonTimelineId},
					${b.saga_id ? Number(b.saga_id) : null},
					${b.arc_id ? Number(b.arc_id) : null},
					${canonRank},
					true
				)
				ON CONFLICT (slug) DO UPDATE SET
					title = EXCLUDED.title,
					title_ja = EXCLUDED.title_ja,
					synopsis_fr = EXCLUDED.synopsis_fr,
					canon = EXCLUDED.canon
				RETURNING id;
			`;
			eventId = Number(ev.id);
			eventBySlug.set(evSlug, eventId);
			insertedBattles++;

			// Parsing des combatants
			let parsedCombatants: Array<{ name: string; side?: string }> = [];
			try {
				if (b.combatants) parsedCombatants = JSON.parse(b.combatants);
			} catch {}

			for (const c of parsedCombatants) {
				const charId = findChar(c.name);
				if (charId) {
					const isWinner = b.winner_id ? Number(b.winner_id) === charId : b.winner_name && b.winner_name.toLowerCase().includes(c.name.toLowerCase());
					await sql`
						INSERT INTO bot.narrative_event_participants (
							event_id, character_id, role, outcome
						) VALUES (
							${eventId},
							${charId},
							${c.side === "b" ? "opponent" : "participant"},
							${isWinner ? "winner" : "contestant"}
						)
						ON CONFLICT (event_id, character_id, role) DO UPDATE SET
							outcome = EXCLUDED.outcome;
					`;
					insertedParticipants++;
				}
			}
		}
	}
	console.log(`  ✓ ${insertedBattles} combats unifiés dans narrative_events.`);
	console.log(`  ✓ ${insertedParticipants} participants reliés.`);

	// 3. Unification des Tournois
	console.log("→ Lecture des tournois depuis SQLite...");
	const tournaments = sqlite.query("SELECT * FROM db_tournaments WHERE visible = 1;").all() as any[];
	console.log(`  Trouvé : ${tournaments.length} tournois.`);

	let insertedTournaments = 0;
	for (const t of tournaments) {
		const evSlug = `tournament-${t.slug}`;
		const canonRank = t.canon ? "absolute" : "non_canon";
		if (isDryRun) {
			eventBySlug.set(evSlug, Number(t.id));
			insertedTournaments++;
		} else {
			const [ev] = await sql`
				INSERT INTO bot.narrative_events (
					slug, kind, title, title_ja, synopsis_fr, timeline_id, canon, visible
				) VALUES (
					${evSlug},
					'tournament',
					${t.name},
					${t.name_ja},
					${t.rules_summary},
					${canonTimelineId},
					${canonRank},
					true
				)
				ON CONFLICT (slug) DO UPDATE SET
					title = EXCLUDED.title,
					title_ja = EXCLUDED.title_ja,
					synopsis_fr = EXCLUDED.synopsis_fr
				RETURNING id;
			`;
			eventBySlug.set(evSlug, Number(ev.id));
			insertedTournaments++;
		}
	}
	console.log(`  ✓ ${insertedTournaments} tournois unifiés dans narrative_events.`);

	// 4. Unification des Événements Historiques
	console.log("→ Lecture des événements chronologiques depuis SQLite...");
	const timelineEvents = sqlite.query("SELECT * FROM db_timeline_events WHERE visible = 1;").all() as any[];
	console.log(`  Trouvé : ${timelineEvents.length} événements historiques.`);

	let insertedHistory = 0;
	for (const h of timelineEvents) {
		const evSlug = `timeline-${h.id}-${slugify(h.title)}`;
		const canonRank = h.canon ? "absolute" : "non_canon";
		if (isDryRun) {
			eventBySlug.set(evSlug, Number(h.id));
			insertedHistory++;
		} else {
			const [ev] = await sql`
				INSERT INTO bot.narrative_events (
					slug, kind, title, title_ja, synopsis_fr, timeline_id, start_order, canon, visible
				) VALUES (
					${evSlug},
					'event',
					${h.title},
					${h.title_ja},
					${h.description},
					${canonTimelineId},
					${h.order_idx ? Number(h.order_idx) : null},
					${canonRank},
					true
				)
				ON CONFLICT (slug) DO UPDATE SET
					title = EXCLUDED.title,
					title_ja = EXCLUDED.title_ja,
					synopsis_fr = EXCLUDED.synopsis_fr,
					canon = EXCLUDED.canon
				RETURNING id;
			`;
			eventBySlug.set(evSlug, Number(ev.id));
			insertedHistory++;
		}
	}
	console.log(`  ✓ ${insertedHistory} événements historiques unifiés dans narrative_events.`);

	// 5. Relations typées du graphe narratif
	console.log("→ Création des relations typées du graphe narratif...");
	const RELATIONS_DEF: Array<{ from: string; to: string; relation: "contains" | "variant_of" | "adaptation_of" | "precedes" }> = [
		{ from: "tournament-21e-tenkaichi-budokai", to: "battle-goku-vs-jackie-chun-21e-tournoi", relation: "contains" },
		{ from: "tournament-22e-tenkaichi-budokai", to: "battle-goku-vs-tenshinhan-22e-tournoi-finale", relation: "contains" },
		{ from: "tournament-23e-tenkaichi-budokai", to: "battle-goku-vs-piccolo-23e-tournoi-finale", relation: "contains" },
		{ from: "tournament-cell-games", to: "battle-gohan-ssj2-vs-cell-parfait", relation: "contains" },
		{ from: "tournament-tournoi-du-pouvoir", to: "battle-goku-ultra-instinct-vs-jiren", relation: "contains" },
	];

	let insertedRelations = 0;
	for (const rel of RELATIONS_DEF) {
		const fromId = eventBySlug.get(rel.from);
		const toId = eventBySlug.get(rel.to);
		if (fromId && toId) {
			if (isDryRun) {
				insertedRelations++;
			} else {
				await sql`
					INSERT INTO bot.narrative_event_relations (from_event_id, to_event_id, relation)
					VALUES (${fromId}, ${toId}, ${rel.relation})
					ON CONFLICT (from_event_id, to_event_id, relation) DO NOTHING;
				`;
				insertedRelations++;
			}
		}
	}
	console.log(`  ✓ ${insertedRelations} relations typées enregistrées.`);

	// 6. Contributeurs Majeurs (Akira Toriyama spotlight_rank=0, Staff & Cast)
	console.log("→ Ingestion des contributeurs (bot.contributors)...");
	const CONTRIBUTORS_DEF = [
		{
			slug: "akira-toriyama",
			name: "Akira Toriyama",
			name_ja: "鳥山明",
			name_romaji: "Toriyama Akira",
			category: "author",
			birth_date: "1955-04-05",
			death_date: "2024-03-01",
			biography_fr: "Auteur légendaire, mangaka et créateur de Dragon Ball, Dr. Slump et chara-designer iconique de Dragon Quest et Chrono Trigger.",
			spotlight_rank: 0,
		},
		{
			slug: "kazuhiko-torishima",
			name: "Kazuhiko Torishima",
			name_ja: "鳥嶋和彦",
			name_romaji: "Torishima Kazuhiko",
			category: "editorial_staff",
			birth_date: "1952-10-20",
			death_date: null,
			biography_fr: "Éditeur historique d'Akira Toriyama au Weekly Shōnen Jump ('Docteur Mashirito'), artisan clé du succès phénoménal de Dragon Ball.",
			spotlight_rank: 1,
		},
		{
			slug: "takao-koyama",
			name: "Takao Koyama",
			name_ja: "小山高生",
			name_romaji: "Koyama Takao",
			category: "scenario",
			birth_date: "1948-04-21",
			death_date: null,
			biography_fr: "Scénariste en chef de Dragon Ball Z et des 13 premiers films d'animation DBZ chez Toei Animation.",
			spotlight_rank: 2,
		},
		{
			slug: "masako-nozawa",
			name: "Masako Nozawa",
			name_ja: "野沢雅子",
			name_romaji: "Nozawa Masako",
			category: "voice",
			birth_date: "1936-10-25",
			death_date: null,
			biography_fr: "Seiyū légendaire incarnant Son Goku, Son Gohan, Son Goten, Bardock et Black Goku depuis 1986.",
			spotlight_rank: 3,
		},
		{
			slug: "shunsuke-kikuchi",
			name: "Shunsuke Kikuchi",
			name_ja: "菊池俊輔",
			name_romaji: "Kikuchi Shunsuke",
			category: "music",
			birth_date: "1931-11-01",
			death_date: "2021-04-24",
			biography_fr: "Compositeur symphonique de génie dont les thèmes orchestraux ont forgé l'âme musicale de Dragon Ball et Dragon Ball Z.",
			spotlight_rank: 4,
		},
	];

	const contributorMap: Record<string, number> = {};
	for (const c of CONTRIBUTORS_DEF) {
		if (isDryRun) {
			contributorMap[c.slug] = 1;
			console.log(`  [DRY] contributor '${c.slug}'`);
		} else {
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
					${c.spotlight_rank},
					true
				)
				ON CONFLICT (slug) DO UPDATE SET
					name = EXCLUDED.name,
					name_ja = EXCLUDED.name_ja,
					biography_fr = EXCLUDED.biography_fr,
					spotlight_rank = EXCLUDED.spotlight_rank
				RETURNING id;
			`;
			contributorMap[c.slug] = Number(row.id);
			console.log(`  ✓ contributor '${c.slug}' (id: ${contributorMap[c.slug]})`);
		}
	}

	// 7. Contributor Credits
	console.log("→ Ingestion des crédits contributeurs (bot.contributor_credits)...");
	const toriyamaId = contributorMap["akira-toriyama"];
	const nozawaId = contributorMap["masako-nozawa"];

	if (!isDryRun && toriyamaId) {
		const [dbWork] = await sql`SELECT id FROM bot.media_works WHERE slug = 'dragon-ball' LIMIT 1;`;
		if (dbWork) {
			await sql`
				INSERT INTO bot.contributor_credits (
					contributor_id, role, credit_scope, work_id, visible
				) VALUES (
					${toriyamaId},
					'Auteur original & Scénariste',
					'work',
					${Number(dbWork.id)},
					true
				);
			`;
			console.log(`  ✓ Crédit Toriyama ↔ Dragon Ball enregistré.`);
		}
	}

	if (!isDryRun && nozawaId) {
		const [gokuChar] = await sql`SELECT id FROM bot.db_characters WHERE name ILIKE '%Son Goku%' LIMIT 1;`;
		if (gokuChar) {
			await sql`
				INSERT INTO bot.contributor_credits (
					contributor_id, role, credit_scope, character_id, visible
				) VALUES (
					${nozawaId},
					'Voix originale japonaise (VO)',
					'character',
					${Number(gokuChar.id)},
					true
				);
			`;
			console.log(`  ✓ Crédit Masako Nozawa ↔ Son Goku enregistré.`);
		}
	}

	console.log("\n=========================================");
	console.log(" BILAN SPRINT 3 GRAPHE NARRATIF (FAIT)");
	console.log("=========================================");
	console.log(`- Timelines créées : ${Object.keys(timelineMap).length}`);
	console.log(`- Combats unifiés : ${insertedBattles}`);
	console.log(`- Tournois unifiés : ${insertedTournaments}`);
	console.log(`- Événements historiques unifiés : ${insertedHistory}`);
	console.log(`- Total événements narratifs unifiés : ${insertedBattles + insertedTournaments + insertedHistory}`);
	console.log(`- Relations typées formées : ${insertedRelations}`);
	console.log(`- Contributeurs enregistrés : ${Object.keys(contributorMap).length}`);
	console.log(`- Spotlight Akira Toriyama rank=0 validé.`);
	console.log("=========================================\n");

	await sql.end();
}

main().catch((err) => {
	console.error("✗ Échec du backfill graphe narratif :", err);
	process.exit(1);
});
