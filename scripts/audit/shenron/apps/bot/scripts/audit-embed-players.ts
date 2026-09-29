/**
 * audit-embed-players.ts — Sonde TOUS les lecteurs (players) du catalogue
 * (`bot.db_episodes` + `bot.db_movies`) et rend un tableau chiffré par série,
 * par provider et par langue.
 *
 * Lecture seule : n'écrit RIEN en base. Le rapport JSON produit
 * (`--out <fichier>`) sert d'entrée à la réparation ciblée.
 *
 * Le verdict vient de `_embed-liveness.ts` (source jouable + média joignable,
 * pas un simple HTTP 200).
 *
 * Usage :
 *   DATABASE_URL=... bun apps/bot/scripts/audit-embed-players.ts \
 *     [--out /tmp/audit.json] [--conc 10] [--limit N] [--no-media]
 */
import postgres from "postgres";
import { type Player, type Verdict, probePlayer, withConcurrency } from "./_embed-liveness";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
}
const OUT = arg("--out");
const CONC = Number(arg("--conc") ?? 10);
const LIMIT = arg("--limit") ? Number(arg("--limit")) : undefined;
const CHECK_MEDIA = !process.argv.includes("--no-media");

const sql = postgres(DB_URL, { max: 3, prepare: false });

type Row = { id: number; group: string; title: string; players: Player[] };
type Item = { table: "db_episodes" | "db_movies"; row: Row; index: number; player: Player };

const episodes = (await sql`
	SELECT id, series AS "group", title, players
	FROM bot.db_episodes
	WHERE players IS NOT NULL AND jsonb_array_length(players) > 0
	ORDER BY id
`) as unknown as Row[];
const movies = (await sql`
	SELECT id, 'FILM' AS "group", title, players
	FROM bot.db_movies
	WHERE players IS NOT NULL AND jsonb_array_length(players) > 0
	ORDER BY id
`) as unknown as Row[];

const items: Item[] = [];
for (const row of episodes) {
	row.players.forEach((player, index) => items.push({ table: "db_episodes", row, index, player }));
}
for (const row of movies) {
	row.players.forEach((player, index) => items.push({ table: "db_movies", row, index, player }));
}
const work = LIMIT ? items.slice(0, LIMIT) : items;

console.log(
	`Audit de ${work.length} lecteur(s) sur ${episodes.length} épisodes + ${movies.length} films ` +
		`(concurrence ${CONC}, média ${CHECK_MEDIA ? "vérifié" : "non vérifié"})…`
);

let done = 0;
const started = Date.now();
const results = await withConcurrency(work, CONC, async (it) => {
	const probe = await probePlayer(it.player, { checkMedia: CHECK_MEDIA });
	done++;
	if (done % 100 === 0) {
		const rate = done / ((Date.now() - started) / 1000);
		console.log(`  … ${done}/${work.length} (${rate.toFixed(1)}/s)`);
	}
	return { ...it, ...probe };
});

// ---- agrégats ---------------------------------------------------------
type Tally = { alive: number; dead: number; suspect: number };
const empty = (): Tally => ({ alive: 0, dead: 0, suspect: 0 });
const bump = (m: Map<string, Tally>, k: string, v: Verdict) => {
	const t = m.get(k) ?? empty();
	t[v]++;
	m.set(k, t);
};

const bySeries = new Map<string, Tally>();
const byProvider = new Map<string, Tally>();
const byLang = new Map<string, Tally>();
const reasons = new Map<string, number>();
for (const r of results) {
	bump(bySeries, r.row.group, r.verdict);
	bump(byProvider, r.player.provider, r.verdict);
	bump(byLang, r.player.lang ?? "(sans lang)", r.verdict);
	if (r.verdict !== "alive") reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
}

function table(title: string, m: Map<string, Tally>) {
	console.log(`\n=== ${title} ===`);
	const rows = [...m.entries()].toSorted((a, b) => b[1].dead - a[1].dead || a[0].localeCompare(b[0]));
	console.log(
		"  clé".padEnd(22),
		"total".padStart(6),
		"vivant".padStart(7),
		"mort".padStart(6),
		"suspect".padStart(8)
	);
	for (const [k, t] of rows) {
		const total = t.alive + t.dead + t.suspect;
		console.log(
			`  ${k}`.padEnd(22),
			String(total).padStart(6),
			String(t.alive).padStart(7),
			String(t.dead).padStart(6),
			String(t.suspect).padStart(8)
		);
	}
}

table("par série", bySeries);
table("par provider", byProvider);
table("par langue", byLang);

console.log("\n=== motifs de non-vivacité ===");
for (const [reason, n] of [...reasons.entries()].toSorted((a, b) => b[1] - a[1])) {
	console.log(`  ${String(n).padStart(5)}  ${reason}`);
}

// Fiches qui perdraient TOUS leurs lecteurs.
const perRow = new Map<string, { row: Row; table: string; alive: number; total: number }>();
for (const r of results) {
	const key = `${r.table}:${r.row.id}`;
	const e = perRow.get(key) ?? { row: r.row, table: r.table, alive: 0, total: 0 };
	e.total++;
	if (r.verdict !== "dead") e.alive++;
	perRow.set(key, e);
}
const orphans = [...perRow.values()].filter((e) => e.alive === 0);
console.log(`\n=== fiches sans AUCUN lecteur survivant : ${orphans.length} ===`);
for (const o of orphans.slice(0, 40)) {
	console.log(`  ${o.table} #${o.row.id} [${o.row.group}] ${o.row.title} (${o.total} lecteur(s))`);
}

const alive = results.filter((r) => r.verdict === "alive").length;
const dead = results.filter((r) => r.verdict === "dead").length;
const suspect = results.filter((r) => r.verdict === "suspect").length;
console.log(
	`\nTOTAL : ${results.length} lecteurs — ${alive} vivants, ${dead} morts, ${suspect} suspects`
);

if (OUT) {
	await Bun.write(
		OUT,
		JSON.stringify(
			results.map((r) => ({
				table: r.table,
				id: r.row.id,
				group: r.row.group,
				title: r.row.title,
				index: r.index,
				provider: r.player.provider,
				lang: r.player.lang ?? null,
				embedUrl: r.player.embedUrl,
				verdict: r.verdict,
				reason: r.reason,
				status: r.status ?? null,
			})),
			null,
			1
		)
	);
	console.log(`\n✓ Rapport écrit : ${OUT}`);
}

await sql.end();
