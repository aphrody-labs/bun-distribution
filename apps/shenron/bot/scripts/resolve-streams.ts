import { rename } from "node:fs/promises";
import postgres from "postgres";

import {
	type DirectStream,
	resolveEpisodeStreams,
	resolvePlayer,
} from "./_bxc-media";
import type { Player } from "./_embed-liveness";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const dryRun = process.argv.includes("--dry-run");
const limit = Math.max(1, Number(process.env.LIMIT ?? 40));
const staleHours = Math.max(1, Number(process.env.STALE_H ?? 8));
const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 2));
const drain = process.env.DRAIN === "1";
/**
 * Types de médias à résoudre : `KINDS=movie`, `KINDS=episode`, défaut les deux.
 *
 * Les films n'ont droit qu'au quart du lot, et seulement au-delà de STALE_H.
 * Or le proxy HLS du bot ne sait PAS les résoudre à la volée — son repli lit le
 * SQLite, où `players` et `stream_url` n'existent pas (colonnes PG seules) — :
 * un film absent de `streams.json` reste en 404 jusqu'au prochain passage qui
 * le sélectionne. Mesuré le 2026-09-13 : 0 film sur 51 entrées, 0/23 flux
 * vivants. `KINDS=movie` les traite sans re-résoudre au passage des dizaines
 * d'épisodes déjà servis.
 */
const kinds = new Set(
	(process.env.KINDS ?? "episode,movie")
		.split(",")
		.map((kind) => kind.trim())
		.filter(Boolean),
);
const retryBaseMs = Math.max(
	60_000,
	Number(process.env.STREAM_RETRY_MS ?? 3_600_000),
);
const retryMaxMs = Math.max(
	retryBaseMs,
	Number(process.env.STREAM_RETRY_MAX_MS ?? 86_400_000),
);
const streamsPath = `${import.meta.dir}/../data/streams.json`;
const sql = postgres(databaseUrl, {
	max: concurrency + 1,
	prepare: false,
	onnotice: () => {},
});

type MediaLanguage = "vf" | "vostfr";
type StreamEntry = {
	url: string;
	headers: Record<string, string>;
	type: string;
	provider?: string;
	at: number;
};
type StreamVariants = Partial<Record<MediaLanguage, StreamEntry>>;
type MediaRow = {
	kind: "episode" | "movie";
	id: number;
	label: string;
	series: string | null;
	numberInSeries: number | null;
	players: Player[];
	streams: StreamVariants | null;
	failures: number | null;
};

const store: Record<string, StreamEntry> = await Bun.file(streamsPath)
	.json()
	.catch(() => ({}));

function retryAt(failures: number): number {
	return (
		Date.now() + Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(failures, 8))
	);
}

async function streamReachable(stream: DirectStream): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12_000);
	try {
		const response = await fetch(stream.url, {
			signal: controller.signal,
			headers: { ...stream.headers, Range: "bytes=0-1024" },
		});
		return response.ok || response.status === 206;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function playerLanguage(player: Player): MediaLanguage | null {
	if (player.lang === "vf" || player.lang === "vostfr") return player.lang;
	if (/\bvostfr\b/i.test(player.name)) return "vostfr";
	if (/\bvf\b/i.test(player.name)) return "vf";
	return null;
}

function isFresh(stream: StreamEntry | undefined): boolean {
	return Boolean(
		stream?.url && Date.now() - stream.at < staleHours * 3_600_000,
	);
}

async function resolveRow(row: MediaRow): Promise<boolean> {
	const rank = (provider: string) =>
		provider === "vidmoly" ? 0 : provider === "mailru" ? 1 : 2;
	const variants: StreamVariants = { ...row.streams };
	const languages =
		row.kind === "episode"
			? row.series === "DB_DAIMA"
				? (["vostfr"] as MediaLanguage[])
				: (["vf", "vostfr"] as MediaLanguage[])
			: ([
					...new Set(row.players.map(playerLanguage).filter(Boolean)),
				] as MediaLanguage[]);
	let allResolved = languages.length > 0;
	let primary: StreamEntry | null = null;
	let directEpisodeStreams: ReturnType<typeof resolveEpisodeStreams> | null =
		null;
	let lastError =
		languages.length === 0 ? "no language-tagged player" : "unresolved";

	for (const language of languages) {
		if (isFresh(variants[language])) {
			primary ??= variants[language] ?? null;
			continue;
		}
		const candidates = row.players
			.filter(
				(player) => playerLanguage(player) === language && player.embedUrl,
			)
			.toSorted((left, right) => rank(left.provider) - rank(right.provider));
		let stream: DirectStream | null = null;
		lastError =
			candidates.length === 0
				? `no eligible ${language} player`
				: `unresolved ${language}`;
		for (const player of candidates) {
			const result = await resolvePlayer(player);
			if (!result.ok) {
				lastError = result.error;
				continue;
			}
			if (!(await streamReachable(result.value))) {
				lastError = `${result.value.provider} returned an unreachable ${language} stream`;
				continue;
			}
			stream = result.value;
			break;
		}
		if (
			!stream &&
			row.kind === "episode" &&
			row.series &&
			row.numberInSeries != null
		) {
			directEpisodeStreams ??= resolveEpisodeStreams(
				row.series,
				row.numberInSeries,
			);
			const direct = await directEpisodeStreams;
			if (!direct.ok) {
				lastError = direct.error;
			} else if (!direct.value[language]) {
				lastError = `live series page has no ${language} stream`;
			} else if (!(await streamReachable(direct.value[language]))) {
				lastError = `live series page returned an unreachable ${language} stream`;
			} else {
				stream = direct.value[language];
			}
		}
		if (!stream) {
			allResolved = false;
			console.log(`  ${row.kind}#${row.id} ${language} failed: ${lastError}`);
			continue;
		}
		const entry: StreamEntry = { ...stream, at: Date.now() };
		variants[language] = entry;
		primary ??= entry;
		console.log(
			`  ${row.kind}#${row.id} ${language} resolved with ${stream.provider} (${stream.type})`,
		);
	}

	const table = row.kind === "episode" ? "db_episodes" : "db_movies";
	if (!allResolved || !primary) {
		if (!dryRun) {
			const failures = (row.failures ?? 0) + 1;
			await sql`
				UPDATE bot.${sql(table)}
				SET streams = ${sql.json(variants)}, stream_checked_at = ${Date.now()},
				    stream_resolve_failures = ${failures},
				    stream_retry_after = ${retryAt(failures)}
				WHERE id = ${row.id}
			`;
			for (const [language, entry] of Object.entries(variants)) {
				if (entry)
					store[
						`${row.kind === "movie" ? `movie-${row.id}` : row.id}-${language}`
					] = entry;
			}
		}
		return false;
	}

	if (!dryRun) {
		const now = Date.now();
		const defaultStream = variants.vostfr ?? variants.vf ?? primary;
		await sql`
			UPDATE bot.${sql(table)}
			SET streams = ${sql.json(variants)},
			    stream_url = ${defaultStream.url}, stream_headers = ${sql.json(defaultStream.headers)},
			    stream_provider = ${defaultStream.provider ?? null}, stream_at = ${now},
			    stream_checked_at = ${now}, stream_resolve_failures = 0,
			    stream_retry_after = NULL
			WHERE id = ${row.id}
		`;
		const key = row.kind === "movie" ? `movie-${row.id}` : String(row.id);
		store[key] = defaultStream;
		for (const [language, entry] of Object.entries(variants)) {
			if (entry) store[`${key}-${language}`] = entry;
		}
	}
	return true;
}

async function loadRows(): Promise<MediaRow[]> {
	const staleBefore = Date.now() - staleHours * 3_600_000;
	const movieLimit = !kinds.has("movie")
		? 0
		: kinds.has("episode")
			? Math.max(1, Math.floor(limit / 4))
			: limit;
	const episodeLimit = kinds.has("episode") ? Math.max(1, limit - movieLimit) : 0;
	return (await sql`
		WITH episodes AS (
			SELECT 'episode'::text AS kind, id, series,
			       number_in_series AS "numberInSeries",
			       series || ' ' || number_in_series AS label, players, streams,
			       stream_resolve_failures AS failures, stream_checked_at
			FROM bot.db_episodes
			WHERE jsonb_typeof(players) = 'array' AND jsonb_array_length(players) > 0
			  AND (
			    stream_url IS NULL
			    OR
			    (series <> 'DB_DAIMA'
			     AND coalesce(nullif(streams->'vf'->>'at', '')::bigint, 0) < ${staleBefore})
			    OR
			    coalesce(nullif(streams->'vostfr'->>'at', '')::bigint, 0) < ${staleBefore}
			  )
			  AND (stream_retry_after IS NULL OR stream_retry_after <= ${Date.now()})
			ORDER BY stream_checked_at ASC NULLS FIRST, id
			LIMIT ${episodeLimit}
		), movies AS (
			SELECT 'movie'::text AS kind, id, NULL::text AS series,
			       NULL::bigint AS "numberInSeries", title AS label, players, streams,
			       stream_resolve_failures AS failures, stream_checked_at
			FROM bot.db_movies
			WHERE jsonb_typeof(players) = 'array' AND jsonb_array_length(players) > 0
			  AND (
			    stream_url IS NULL
			    OR
			    (EXISTS (SELECT 1 FROM jsonb_array_elements(players) p WHERE lower(coalesce(p->>'lang', p->>'name', '')) = 'vf' OR (p->>'name' ~* '\\mVF\\M' AND p->>'name' !~* 'VOSTFR'))
			     AND coalesce(nullif(streams->'vf'->>'at', '')::bigint, 0) < ${staleBefore})
			    OR
			    (EXISTS (SELECT 1 FROM jsonb_array_elements(players) p WHERE lower(coalesce(p->>'lang', p->>'name', '')) = 'vostfr' OR p->>'name' ~* 'VOSTFR')
			     AND coalesce(nullif(streams->'vostfr'->>'at', '')::bigint, 0) < ${staleBefore})
			  )
			  AND (stream_retry_after IS NULL OR stream_retry_after <= ${Date.now()})
			ORDER BY stream_checked_at ASC NULLS FIRST, id
			LIMIT ${movieLimit}
		)
		SELECT kind, id, series, "numberInSeries", label, players, streams, failures FROM episodes
		UNION ALL
		SELECT kind, id, series, "numberInSeries", label, players, streams, failures FROM movies
	`) as unknown as MediaRow[];
}

async function main(): Promise<void> {
	if (!dryRun) {
		for (const table of ["db_episodes", "db_movies"] as const) {
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS streams jsonb NOT NULL DEFAULT '{}'::jsonb`;
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS stream_checked_at bigint`;
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS stream_resolve_failures integer NOT NULL DEFAULT 0`;
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS stream_retry_after bigint`;
		}
	}

	const [{ locked }] = (await sql`
		SELECT pg_try_advisory_lock(hashtext('shenron-media-stream-resolve')) AS locked
	`) as unknown as [{ locked: boolean }];
	if (!locked) {
		console.log("Another stream resolution cycle is already running; exiting.");
		return;
	}

	try {
		let totalSelected = 0;
		let totalResolved = 0;
		for (;;) {
			const rows = await loadRows();
			console.log(
				`${rows.length} media records selected (stale > ${staleHours}h)`,
			);
			if (rows.length === 0) break;
			totalSelected += rows.length;
			let cursor = 0;
			async function worker(): Promise<void> {
				for (;;) {
					const index = cursor++;
					if (index >= rows.length) return;
					if (await resolveRow(rows[index])) totalResolved++;
				}
			}
			await Promise.all(
				Array.from({ length: Math.min(concurrency, rows.length) || 1 }, worker),
			);
			if (!dryRun) {
				const temporaryPath = `${streamsPath}.tmp`;
				await Bun.write(temporaryPath, JSON.stringify(store));
				await rename(temporaryPath, streamsPath);
			}
			if (!drain) break;
		}
		console.log(
			`${totalResolved}/${totalSelected} media records fully resolved`,
		);
	} finally {
		await sql`SELECT pg_advisory_unlock(hashtext('shenron-media-stream-resolve'))`;
	}
}

console.log(dryRun ? "[DRY RUN]" : "[LIVE]");
await main();
await sql.end();
