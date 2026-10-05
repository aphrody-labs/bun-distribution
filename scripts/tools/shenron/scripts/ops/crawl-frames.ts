#!/usr/bin/env bun
/**
 * @file scripts/ops/crawl-frames.ts
 * Crawl automatisé de toute la surface Dragon Ball exposée par bxc, vers l'index
 * local frame par frame (`bxc frames`, MPEG-7 ColorLayout).
 *
 * Pourquoi : le Frame Finder des fiches épisodes n'avait rien à quoi comparer
 * une capture. Il retombait sur trace.moe, qui répondait « Hayate no Gotoku! »
 * sur une image de Dragon Ball. Rempli, l'index local ne contient que nos
 * épisodes et nos films : chaque réponse pointe une fiche du site.
 *
 * Mesuré le 2026-09-12 sur le VPS :
 *  - `bxc frames index <m3u8>` lit directement un flux HLS résolu : un épisode
 *    de 24 min = 1 480 signatures en ~40 s, 2,2 cœurs, 110 Mio, zéro disque ;
 *  - ~86 Kio d'index par épisode → la surface entière tient sous 100 Mio ;
 *  - recherche locale : capture prise à 0:42 → « DB 1 à 0:41 », similarité 0,89.
 *
 * Sources (anime-sama, VOSTFR) et leur rattachement au site :
 *  - saisons d'épisodes → `db_episodes` par numéro, SEULEMENT si le nombre
 *    d'épisodes publiés égale celui du site (sinon la série est écartée) ;
 *  - Kai : anime-sama suit la numérotation japonaise (98 + Final Chapters en
 *    61) quand le site suit l'internationale (97 + 70). Seuls Kai 1–97 sont
 *    rattachés ; les Final Chapters sont écartés tant que l'alignement n'est pas
 *    tranché — un lien vers le mauvais épisode est pire que pas de lien ;
 *  - films → `db_movies` : anime-sama ne donne AUCUN titre. Chaque film est
 *    identifié par sa durée réelle (ffprobe) contre `duration_min`, dans l'ordre
 *    de sortie. trace.moe a été essayé et rejeté : 11 % de similarité sur un
 *    film DBZ. Film sans correspondance nette → écarté et journalisé.
 *
 * Hébergeurs : ansembed (HLS lisible sans en-tête, indexé en direct) d'abord ;
 * les autres (sibnet, sendvid…) exigent un Referer que `bxc frames index` ne
 * sait pas envoyer : ffmpeg les réencode alors en 192 px dans un fichier
 * temporaire (~1 Mio/min), indexé puis supprimé.
 *
 * Garde-fous prod : `nice 19` + `ionice idle`, un seul média à la fois, pause
 * si la charge dépasse `--max-load`, verrou contre les doubles lancements,
 * reprise gratuite (ce qui est déjà indexé est sauté), journal JSONL.
 *
 * Usage :
 *   bun scripts/ops/crawl-frames.ts --dry-run          # plan complet, rien n'est indexé
 *   bun scripts/ops/crawl-frames.ts                    # tout
 *   bun scripts/ops/crawl-frames.ts --only DB,DBZ --limit 5
 *   bun scripts/ops/crawl-frames.ts --no-movies
 *   # hors session : setsid nohup bun scripts/ops/crawl-frames.ts > journal 2>&1 &
 */
import { mkdirSync, rmSync, statfsSync } from "node:fs";
import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, loadavg } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";

const arg = (name: string): string | null => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? (process.argv[i + 1] ?? null) : null;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const DRY_RUN = flag("dry-run");
const NO_MOVIES = flag("no-movies");
const ONLY = new Set(
	(arg("only") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
);
const LIMIT = Number(arg("limit") ?? Infinity);
const FPS = Number(arg("fps") ?? 1);
const MAX_LOAD = Number(arg("max-load") ?? 4.5);
const LANG = arg("lang") ?? "vostfr";
const CONCURRENCY = Math.max(1, Math.min(3, Number(arg("concurrency") ?? 2)));
const RETRY_BASE_MS = Math.max(1_000, Number(arg("retry-base-ms") ?? 60_000));

const WORK = join(homedir(), ".shenron-build-tmp", "crawl-frames");
const JOURNAL = join(WORK, "journal.jsonl");
const STATE_PATH = join(WORK, "state.json");
const LOCK = join(WORK, "crawl.lock.d");
let ownsLock = false;
/** Marge disque sous laquelle on refuse un réencodage (Mio). */
const MIN_FREE_MIB = 4096;
/** Tolérance entre la durée réelle d'un film et `duration_min` (s). */
const MOVIE_TOLERANCE_S = 150;
/** Nombre de films libres examinés, dans l'ordre de sortie, pour une entrée. */
const FENETRE = 3;
/** Temps maximal accordé à un média (résolution + indexation). */
const ITEM_TIMEOUT_MS = 30 * 60_000;
/** Pause de politesse entre deux médias, vis-à-vis des hébergeurs. */
const PAUSE_MS = 2_000;

/** Ordre de préférence : ansembed se lit sans en-tête, les autres non. */
const HOSTERS = ["ansembed", "embed4me", "sibnet", "sendvid", "oneupload", "vk", "myvi"];

type EpisodeSource = {
	kind: "episodes";
	slug: string;
	season: string;
	series: string;
	max?: number;
};
type MovieSource = { kind: "movies"; slug: string; season: string; groups: string[] };

const SOURCES: Array<EpisodeSource | MovieSource> = [
	{ kind: "episodes", slug: "dragon-ball", season: "saison1", series: "DB" },
	{ kind: "episodes", slug: "dragon-ball-z", season: "saison1", series: "DBZ" },
	// Kai : seuls les 97 premiers s'alignent (cf. en-tête).
	{ kind: "episodes", slug: "dragon-ball-z", season: "kai", series: "DBZ_KAI", max: 97 },
	{ kind: "episodes", slug: "dragon-ball-gt", season: "saison1", series: "DBGT" },
	{ kind: "episodes", slug: "dragon-ball-super", season: "saison1", series: "DBS" },
	{ kind: "episodes", slug: "dragon-ball-daima", season: "saison1", series: "DB_DAIMA" },
	{ kind: "movies", slug: "dragon-ball", season: "film", groups: ["DB_MOVIE"] },
	{
		kind: "movies",
		slug: "dragon-ball-z",
		season: "film",
		groups: ["DBZ_MOVIE", "DBZ_SPECIAL", "DBZ_OVA"],
	},
	{ kind: "movies", slug: "dragon-ball-gt", season: "film", groups: ["DBGT_SPECIAL"] },
	{ kind: "movies", slug: "dragon-ball-super", season: "film", groups: ["DBS_MOVIE"] },
];

type Job = {
	/** Clé de reprise, identique à ce que `bxc frames list` renvoie. */
	key: string;
	label: string;
	title: string;
	episode: number | null;
	/** Embeds candidats, par ordre de préférence d'hébergeur. */
	embeds: Array<{ hoster: string; url: string }>;
	/** Film : durée attendue en secondes, pour valider l'identification. */
	expectedDurationS?: number | null;
};

type JobState = {
	attempts: number;
	lastError: string | null;
	nextRetryAt: string | null;
	updatedAt: string;
};

type CrawlState = {
	version: 1;
	jobs: Record<string, JobState>;
};

async function loadState(): Promise<CrawlState> {
	try {
		const parsed = JSON.parse(await readFile(STATE_PATH, "utf8")) as CrawlState;
		if (parsed.version === 1 && parsed.jobs && typeof parsed.jobs === "object") return parsed;
	} catch {
		// A missing or damaged checkpoint must never be treated as completed work.
	}
	return { version: 1, jobs: {} };
}

async function acquireLock(): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			mkdirSync(LOCK);
			await writeFile(join(LOCK, "pid"), String(process.pid));
			ownsLock = true;
			return;
		} catch {
			const pid = Number(await readFile(join(LOCK, "pid"), "utf8").catch(() => "0"));
			const alive =
				Number.isInteger(pid) &&
				pid > 0 &&
				(() => {
					try {
						process.kill(pid, 0);
						return true;
					} catch {
						return false;
					}
				})();
			if (alive || attempt > 0)
				throw new Error(`another frame crawl owns the lock${alive ? ` (PID ${pid})` : ""}`);
			await rm(LOCK, { recursive: true, force: true });
		}
	}
}

process.on("exit", () => {
	if (ownsLock) rmSync(LOCK, { recursive: true, force: true });
});

let checkpointQueue = Promise.resolve();
function saveState(state: CrawlState): Promise<void> {
	checkpointQueue = checkpointQueue.then(async () => {
		const temporary = `${STATE_PATH}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
		await rename(temporary, STATE_PATH);
	});
	return checkpointQueue;
}

async function run(cmd: string[], timeoutMs = ITEM_TIMEOUT_MS) {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	clearTimeout(timer);
	return { code, out, err };
}

/** Préfixe basse priorité : le site et le bot passent toujours avant le crawl. */
const LOW = ["nice", "-n", "19", "ionice", "-c3"];

async function journal(entry: Record<string, unknown>) {
	await appendFile(JOURNAL, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function freeMib(path: string): number {
	const st = statfsSync(path);
	return Math.floor((Number(st.bavail) * Number(st.bsize)) / (1024 * 1024));
}

async function waitForLoad() {
	while (loadavg()[0]! > MAX_LOAD) {
		console.log(`  ⏸ charge ${loadavg()[0]!.toFixed(2)} > ${MAX_LOAD}, pause 60 s`);
		await Bun.sleep(60_000);
	}
}

async function lecteurs(slug: string, season: string) {
	const { out } = await run(
		["bxc", "animesama", "episodes", slug, "--season", season, "--lang", LANG, "--json"],
		120_000
	);
	try {
		const d = JSON.parse(out) as { lecteurs?: Array<{ hebergeur: string; urls: string[] }> };
		return d.lecteurs ?? [];
	} catch {
		return [];
	}
}

/** Embeds de l'entrée `i` (0-based), triés par hébergeur préféré. */
function embedsAt(lecs: Array<{ hebergeur: string; urls: string[] }>, i: number) {
	return lecs
		.filter((l) => l.urls[i])
		.map((l) => ({ hoster: l.hebergeur, url: l.urls[i]! }))
		.toSorted((a, b) => rank(a.hoster) - rank(b.hoster));
}
const rank = (h: string) => (HOSTERS.indexOf(h) === -1 ? 99 : HOSTERS.indexOf(h));

type Resolved = { url: string; headers: Record<string, string>; hoster: string };

/**
 * Résout un embed en flux lisible. `reasons` reçoit la cause d'un échec : les
 * hébergeurs de films (sibnet 403, sendvid 502, myvi TLS) refusent souvent le
 * lecteur, ce qui se voyait seulement comme « durée illisible ».
 */
async function resolve(
	embed: { hoster: string; url: string },
	reasons?: string[]
): Promise<Resolved | null> {
	const { out } = await run(["bxc", "animesama", "resolve", embed.url, "--json"], 120_000);
	try {
		const d = JSON.parse(out) as {
			url: string | null;
			enTetes?: Record<string, string>;
			erreur?: string | null;
		};
		if (d.url) return { url: d.url, headers: d.enTetes ?? {}, hoster: embed.hoster };
		reasons?.push(`${embed.hoster} : ${d.erreur ?? "aucun flux"}`);
		return null;
	} catch {
		reasons?.push(`${embed.hoster} : réponse bxc illisible`);
		return null;
	}
}

const headerArg = (h: Record<string, string>) =>
	Object.entries(h)
		.map(([k, v]) => `${k}: ${v}\r\n`)
		.join("");

async function probeDuration(r: Resolved): Promise<number | null> {
	const cmd = ["ffprobe", "-v", "error"];
	if (Object.keys(r.headers).length) cmd.push("-headers", headerArg(r.headers));
	cmd.push("-show_entries", "format=duration", "-of", "csv=p=0", r.url);
	const { out } = await run(cmd, 120_000);
	const n = Number(out.trim());
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Indexe un média résolu : en direct si possible, sinon via un réencodage temporaire. */
async function indexResolved(job: Job, r: Resolved): Promise<string | null> {
	const meta = ["--title", job.title, "--fps", String(FPS)];
	if (job.episode != null) meta.push("--episode", String(job.episode));

	if (r.hoster === "ansembed") {
		const res = await run([...LOW, "bxc", "frames", "index", r.url, ...meta]);
		return res.code === 0 ? null : `index direct : ${(res.err || res.out).trim().slice(-300)}`;
	}

	if (freeMib(WORK) < MIN_FREE_MIB) return `disque sous ${MIN_FREE_MIB} Mio libres`;
	const tmp = join(WORK, `tmp-${job.key.replace(/[^\w-]+/g, "_")}.mp4`);
	try {
		const enc = await run([
			...LOW,
			"ffmpeg",
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-headers",
			headerArg(r.headers),
			"-i",
			r.url,
			"-an",
			"-vf",
			"scale=192:-2",
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-crf",
			"32",
			tmp,
		]);
		if (enc.code !== 0) return `réencodage : ${enc.err.trim().slice(-300)}`;
		const res = await run([...LOW, "bxc", "frames", "index", tmp, ...meta]);
		return res.code === 0 ? null : `index fichier : ${(res.err || res.out).trim().slice(-300)}`;
	} finally {
		await rm(tmp, { force: true }).catch(() => {});
	}
}

async function alreadyIndexed(): Promise<Set<string>> {
	const { out } = await run(["bxc", "frames", "list", "--json"], 60_000);
	try {
		const rows = JSON.parse(out) as Array<{ title: string; episode: number | null }>;
		return new Set(rows.map((r) => `${r.title}#${r.episode ?? ""}`));
	} catch {
		return new Set();
	}
}

async function planEpisodes(sql: SQL, src: EpisodeSource, jobs: Job[], report: string[]) {
	const lecs = await lecteurs(src.slug, src.season);
	const published = Math.max(0, ...lecs.map((l) => l.urls.length));
	const [row] = await sql`select count(*)::int n from bot.db_episodes where series = ${src.series}`;
	const onSite = Number(row?.n ?? 0);
	const take = src.max ?? published;
	const aligned =
		src.max != null ? published >= src.max && onSite >= src.max : published === onSite;
	if (!aligned) {
		report.push(
			`✗ ${src.series} écarté : ${published} publiés sur anime-sama, ${onSite} sur le site`
		);
		return;
	}
	for (let i = 0; i < take; i++) {
		jobs.push({
			key: `${src.series}#${i + 1}`,
			label: `${src.series} ${i + 1}`,
			title: src.series,
			episode: i + 1,
			embeds: embedsAt(lecs, i),
		});
	}
	report.push(
		`✓ ${src.series} : ${take} épisode(s) planifiés (${published} publiés, ${onSite} sur le site)`
	);
}

/**
 * Identification des films par durée, dans l'ordre de sortie. Chaque entrée
 * anime-sama prend le premier film encore libre du groupe dont la durée tombe
 * dans la tolérance. L'identification demande une résolution + un ffprobe par
 * film : elle est faite ici, au plan, pour que `--dry-run` montre les paires.
 */
async function planMovies(sql: SQL, src: MovieSource, jobs: Job[], report: string[]) {
	const lecs = await lecteurs(src.slug, src.season);
	const count = Math.max(0, ...lecs.map((l) => l.urls.length));
	const films = (await sql`
		select id, series, title, duration_min, release_date
		from bot.db_movies
		where series in ${sql(src.groups)}
		order by release_date nulls last, id
	`) as Array<{ id: number; series: string; title: string; duration_min: number | null }>;
	const libres = new Set(films.map((f) => f.id));

	for (let i = 0; i < count; i++) {
		const embeds = embedsAt(lecs, i);
		let duree: number | null = null;
		const raisons: string[] = [];
		for (const e of embeds) {
			const r = await resolve(e, raisons);
			if (r) {
				duree = await probeDuration(r);
				if (!duree) raisons.push(`${e.hoster} : ffprobe sans durée`);
			}
			if (duree) break;
		}
		if (!duree) {
			report.push(
				`✗ ${src.slug}/film #${i + 1} : durée illisible (${raisons.join(" ; ") || "aucun lecteur"}), écarté`
			);
			continue;
		}
		// Fenêtre glissante dans l'ordre de sortie : parmi les FENETRE prochains
		// films encore libres, le plus proche en durée. Prendre le premier dans la
		// tolérance se trompait sur les voisins de durée proche (spécial Bardock
		// 47 min juste avant « La Revanche de Cooler » 48 min).
		const candidats = films
			.filter((f) => libres.has(f.id) && f.duration_min != null)
			.slice(0, FENETRE)
			.map((f) => ({ f, ecart: Math.abs(f.duration_min! * 60 - duree!) }))
			.filter((c) => c.ecart <= MOVIE_TOLERANCE_S)
			.toSorted((a, b) => a.ecart - b.ecart);
		const film = candidats[0]?.f;
		if (!film) {
			report.push(
				`✗ ${src.slug}/film #${i + 1} (${Math.round(duree / 60)} min) : aucun film du site ne correspond, écarté`
			);
			continue;
		}
		libres.delete(film.id);
		jobs.push({
			key: `movie:${film.id}#`,
			label: `${film.title} (${Math.round(duree / 60)} min)`,
			title: `movie:${film.id}`,
			episode: null,
			embeds,
			expectedDurationS: duree,
		});
		report.push(
			`✓ ${src.slug}/film #${i + 1} (${Math.round(duree / 60)} min) → ${film.title} [id ${film.id}]`
		);
	}
}

async function main() {
	mkdirSync(WORK, { recursive: true });
	const dbUrl = process.env.DATABASE_URL;
	if (!dbUrl) {
		console.error("✗ DATABASE_URL manquant dans l'environnement.");
		process.exit(1);
	}

	if (!DRY_RUN) {
		try {
			await acquireLock();
		} catch (error) {
			console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	}

	const sql = new SQL(dbUrl);
	const jobs: Job[] = [];
	const report: string[] = [];
	try {
		for (const src of SOURCES) {
			if (src.kind === "movies" && NO_MOVIES) continue;
			if (src.kind === "episodes" && ONLY.size && !ONLY.has(src.series)) continue;
			if (src.kind === "movies" && ONLY.size && !ONLY.has("MOVIES")) continue;
			if (src.kind === "episodes") await planEpisodes(sql, src, jobs, report);
			else await planMovies(sql, src, jobs, report);
		}
	} finally {
		await sql.end();
	}

	console.log(report.join("\n"));
	const done = await alreadyIndexed();
	const state = await loadState();
	const missing = jobs.filter((job) => !done.has(job.key));
	const now = Date.now();
	const eligible = missing.filter((job) => {
		const saved = state.jobs[job.key];
		return !saved?.nextRetryAt || Date.parse(saved.nextRetryAt) <= now;
	});
	const todo = eligible.slice(0, LIMIT);
	console.log(
		`\n▶ planned=${jobs.length} indexed=${jobs.length - missing.length} missing=${missing.length} eligible=${eligible.length} selected=${todo.length} concurrency=${CONCURRENCY}${DRY_RUN ? " DRY-RUN" : ""}`
	);
	await journal({
		event: "plan",
		planned: jobs.length,
		indexed: jobs.length - missing.length,
		missing: missing.length,
		eligible: eligible.length,
		selected: todo.length,
		concurrency: CONCURRENCY,
		report,
	});
	if (DRY_RUN) return;

	let ok = 0;
	let ko = 0;
	const indexedKeys = new Set<string>();
	const t0 = Date.now();
	try {
		let cursor = 0;
		const worker = async (workerId: number) => {
			while (cursor < todo.length) {
				const n = cursor++;
				const job = todo[n]!;
				await waitForLoad();
				const started = Date.now();
				let erreur: string | null = "aucun hébergeur résolu";
				let hoster: string | null = null;
				for (const e of job.embeds) {
					// Résolution juste avant l'indexation : les jetons des flux expirent.
					const r = await resolve(e);
					if (!r) continue;
					erreur = await indexResolved(job, r);
					hoster = e.hoster;
					if (!erreur) break;
				}
				const secondes = Math.round((Date.now() - started) / 1000);
				if (erreur) {
					ko++;
					const previous = state.jobs[job.key]?.attempts ?? 0;
					const attempts = previous + 1;
					const delay = Math.min(6 * 60 * 60_000, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 8));
					state.jobs[job.key] = {
						attempts,
						lastError: erreur,
						nextRetryAt: new Date(Date.now() + delay).toISOString(),
						updatedAt: new Date().toISOString(),
					};
					console.log(`  ✗ [${n + 1}/${todo.length}] worker=${workerId} ${job.label} — ${erreur}`);
					await Promise.all([
						saveState(state),
						journal({
							event: "fail",
							key: job.key,
							label: job.label,
							hoster,
							error: erreur,
							attempts,
							retryInMs: delay,
							seconds: secondes,
						}),
					]);
				} else {
					ok++;
					indexedKeys.add(job.key);
					delete state.jobs[job.key];
					console.log(
						`  ✓ [${n + 1}/${todo.length}] worker=${workerId} ${job.label} via ${hoster} (${secondes} s)`
					);
					await Promise.all([
						saveState(state),
						journal({ event: "ok", key: job.key, label: job.label, hoster, seconds: secondes }),
					]);
				}
				await Bun.sleep(PAUSE_MS);
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, todo.length) }, (_, index) => worker(index + 1))
		);
	} finally {
		await checkpointQueue;
		await rm(LOCK, { recursive: true, force: true }).catch(() => {});
		ownsLock = false;
		const { out } = await run(["bxc", "frames", "stats"], 60_000);
		const verified = await alreadyIndexed();
		const remaining = jobs.filter((job) => !verified.has(job.key));
		const bilan = `▶ indexed_now=${ok} failed_now=${ko} verified=${jobs.length - remaining.length}/${jobs.length} remaining=${remaining.length} elapsed_min=${Math.round((Date.now() - t0) / 60000)}\n${out.trim()}`;
		console.log(`\n${bilan}`);
		await journal({
			event: "end",
			ok,
			failed: ko,
			verified: jobs.length - remaining.length,
			planned: jobs.length,
			remaining: remaining.length,
			complete: remaining.length === 0,
			stats: out.trim(),
		});
		// Échec réel seulement : une indexation tentée qui a échoué, ou un média
		// annoncé indexé mais absent de l'index vérifié. Des médias restants tous
		// en attente de réessai (eligible=0) ne sont pas actionnables : sortir en
		// erreur faisait boucler Restart=on-failure jusqu'à la limite de démarrage.
		const unverified = [...indexedKeys].filter((key) => !verified.has(key));
		if (unverified.length > 0) console.log(`✗ indexés mais absents de l'index : ${unverified.join(", ")}`);
		if (ko > 0 || unverified.length > 0) process.exitCode = 1;
	}
}

await main();
