#!/usr/bin/env bun
/**
 * @file scripts/ops/index-frames.ts
 * Index frame par frame des épisodes dans `bxc frames` (MPEG-7 ColorLayout).
 *
 * À quoi ça sert : la page « Scènes & Frame Finder » d'un épisode calcule la
 * signature ColorLayout d'une capture, mais n'a rien à quoi la comparer tant
 * que l'index local est vide. Elle retombe alors sur trace.moe, qui indexe
 * l'anime mondial et répond du bruit — mesuré le 2026-09-12 sur une vignette
 * de DB épisode 1 : « Hayate no Gotoku! 54 % », « ONE PIECE 54 % ». Un index
 * local ne contient QUE nos épisodes : chaque réponse est exploitable et rien
 * ne sort de la machine.
 *
 * Coût réel, à connaître avant de lancer :
 *  - un épisode ≈ 24 min ; à `--fps 1` cela fait ~1 400 signatures ;
 *  - l'épisode doit être téléchargé en entier (200–400 Mio) puis SUPPRIMÉ ;
 *    le script n'en garde jamais deux, le disque du VPS est déjà tendu ;
 *  - compter plusieurs minutes par épisode (téléchargement + décodage).
 * D'où le traitement par lots, la reprise, et le garde-fou d'espace libre.
 *
 * Prérequis : le flux doit être résolvable par le bot. Au 2026-09-12,
 * `GET /api/hls/<id>/download` renvoie 502 (« source en erreur ») pour les
 * épisodes dont `stream_url` a expiré et 404 pour ceux qui n'en ont pas : la
 * résolution amont (vidmoly / voiranime) doit être réparée AVANT d'indexer,
 * sinon le script ne fera que journaliser des échecs.
 *
 * Usage :
 *   bun scripts/ops/index-frames.ts --dry-run              # plan, rien ne bouge
 *   bun scripts/ops/index-frames.ts --series DB --limit 5
 *   bun scripts/ops/index-frames.ts --fps 2 --limit 20
 *   bun scripts/ops/index-frames.ts --ids 1,2,3
 */

import { statfsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQL } from "bun";

const API = process.env.SHENRON_API_URL ?? "https://bot.dragonballfr.com";

/** Marge disque sous laquelle on refuse de télécharger un épisode (Mio). */
const MIN_FREE_MIB = 4096;
/** Taille maximale admise pour un épisode téléchargé (Mio). */
const MAX_EPISODE_MIB = 1024;

function arg(name: string): string | null {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? (process.argv[i + 1] ?? null) : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const DRY_RUN = flag("dry-run");
const FPS = Number(arg("fps") ?? 1);
const LIMIT = Number(arg("limit") ?? 10);
const SERIES = arg("series");
const IDS = (arg("ids") ?? "")
	.split(",")
	.map((s) => Number(s.trim()))
	.filter((n) => Number.isFinite(n) && n > 0);

type Episode = {
	id: number;
	series: string;
	number_in_series: number | null;
	title: string | null;
};

function freeMib(path: string): number {
	const st = statfsSync(path);
	return Math.floor((Number(st.bavail) * Number(st.bsize)) / (1024 * 1024));
}

async function run(cmd: string[]): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code: await proc.exited, out, err };
}

/** Médias déjà présents dans l'index — la reprise est gratuite. */
async function alreadyIndexed(): Promise<Set<string>> {
	const { out } = await run(["bxc", "frames", "list", "--json"]);
	try {
		const parsed = JSON.parse(out) as { media?: Array<{ title?: string; episode?: number }> };
		return new Set(
			(parsed.media ?? []).map((m) => `${(m.title ?? "").trim()}:${m.episode ?? ""}`)
		);
	} catch {
		// `bxc frames list` sans index renvoie du texte : rien d'indexé.
		return new Set();
	}
}

async function pickEpisodes(sql: SQL): Promise<Episode[]> {
	if (IDS.length > 0) {
		return sql`
			select id, series, number_in_series, title
			from bot.db_episodes
			where id = any(${IDS})
			order by id
		` as unknown as Promise<Episode[]>;
	}
	return sql`
		select id, series, number_in_series, title
		from bot.db_episodes
		where visible is not false
			and (${SERIES}::text is null or series = ${SERIES})
		order by series, number_in_series
		limit ${LIMIT}
	` as unknown as Promise<Episode[]>;
}

/**
 * Télécharge l'épisode via le résolveur du bot (`/api/hls/:id/download`), qui
 * re-signe le flux amont à la demande — les `stream_url` stockés expirent.
 */
async function download(ep: Episode, dest: string): Promise<string | null> {
	const url = `${API}/api/hls/${ep.id}/download`;
	const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
	if (!res.ok) return `flux indisponible (${res.status} sur ${url})`;

	const declared = Number(res.headers.get("content-length") ?? 0);
	if (declared > MAX_EPISODE_MIB * 1024 * 1024) {
		return `épisode trop lourd (${Math.round(declared / 1024 / 1024)} Mio)`;
	}
	const written = await Bun.write(dest, res);
	if (written < 1024 * 1024) return `téléchargement vide ou tronqué (${written} octets)`;
	return null;
}

async function main() {
	const dbUrl = process.env.DATABASE_URL;
	if (!dbUrl) {
		console.error("✗ DATABASE_URL manquant dans l'environnement.");
		process.exit(1);
	}
	const sql = new SQL(dbUrl);
	const episodes = await pickEpisodes(sql);
	const indexed = await alreadyIndexed();

	console.log(
		`▶ ${episodes.length} épisode(s) retenus · fps=${FPS} · disque libre ${freeMib(tmpdir())} Mio${DRY_RUN ? " · DRY-RUN" : ""}`
	);

	let done = 0;
	let skipped = 0;
	const failures: string[] = [];

	for (const ep of episodes) {
		const label = `${ep.series} ${ep.number_in_series ?? ep.id} — ${ep.title ?? "sans titre"}`;
		const mediaKey = `${ep.series}:${ep.number_in_series ?? ep.id}`;
		if (indexed.has(mediaKey)) {
			skipped++;
			console.log(`  ⏭ ${label} (déjà indexé)`);
			continue;
		}
		if (DRY_RUN) {
			console.log(`  ⋯ ${label} → serait indexé`);
			continue;
		}
		if (freeMib(tmpdir()) < MIN_FREE_MIB) {
			failures.push(`${label} : disque sous ${MIN_FREE_MIB} Mio libres — arrêt`);
			break;
		}

		const dest = join(tmpdir(), `frames-ep-${ep.id}.mp4`);
		try {
			const problem = await download(ep, dest);
			if (problem) {
				failures.push(`${label} : ${problem}`);
				console.log(`  ✗ ${label} — ${problem}`);
				continue;
			}
			const { code, err } = await run([
				"bxc",
				"frames",
				"index",
				dest,
				"--fps",
				String(FPS),
				"--title",
				ep.series,
				"--episode",
				String(ep.number_in_series ?? ep.id),
			]);
			if (code !== 0) {
				failures.push(`${label} : bxc frames index a échoué — ${err.trim().slice(0, 200)}`);
				console.log(`  ✗ ${label} — indexation échouée`);
				continue;
			}
			done++;
			console.log(`  ✓ ${label}`);
		} finally {
			// Toujours : un épisode gardé, c'est 300 Mio de disque perdus sur un
			// VPS dont la rétention est déjà limitée à deux releases.
			await unlink(dest).catch(() => {});
		}
	}

	const { out: stats } = await run(["bxc", "frames", "stats"]);
	console.log(`\n▶ indexés ${done} · ignorés ${skipped} · échecs ${failures.length}`);
	if (failures.length > 0) console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
	console.log(stats.trim());
	await sql.end();
}

await main();
