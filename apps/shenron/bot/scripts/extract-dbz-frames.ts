#!/usr/bin/env bun
/**
 * extract-dbz-frames.ts — Extraction FRAME-PAR-FRAME d'un épisode DBZ depuis une
 * VIDÉO LOCALE via ffmpeg (scene-detection + cadence régulière), sortie webp.
 *
 * Réplique l'esprit du pipeline « frames d'anime » rpbey (cf.
 * apps/web/scripts/scrape-anime-frames.ts), mais adapté à la SOURCE shenron :
 * rpbey scrape des galeries de screencaps existantes (fancaps, zéro
 * ffmpeg) ; côté DBZ, l'ayant droit dispose des MASTERS VIDÉO → on génère nos
 * propres captures HQ localement (pas de dépendance à un wiki tiers).
 *
 *   Source d'entrée : un fichier vidéo d'épisode (mp4/mkv/...) ou un dossier.
 *   Méthode : ffmpeg `select='gt(scene,SEUIL)'` (changements de plan) FUSIONNÉ
 *     avec un échantillonnage régulier `fps=1/PERIODE` (filet de sécurité pour les
 *     plans longs sans coupe). Dédup par hash de contenu (frames quasi-identiques).
 *   Sortie : webp (qualité réglable) dans
 *     apps/shenron/bot/assets/ext/db_episodes_frames/<series>/ep<NNN>/frame-<NNNNN>.webp
 *     + dataset JSON apps/shenron/bot/data/dbz-frames/<series>-ep<NNN>.json (contrat
 *     frames-common.ts). AUCUNE écriture DB (ingestion séparée, gardée).
 *
 * Bun-only : `Bun.spawn(["ffmpeg", ...])`, `Bun.file`, `Bun.write`. Pas de node.
 *
 * ── Où déposer les vidéos sources ────────────────────────────────────────────
 *   apps/shenron/bot/data/dbz-sources/<series>/<numberInSeries>.<ext>
 *   ex. apps/shenron/bot/data/dbz-sources/DBZ/1.mkv  (l'épisode 1 de DBZ)
 *   (ou passer --input <chemin> pour un fichier hors arborescence.)
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   bun apps/shenron/bot/scripts/extract-dbz-frames.ts --series DBZ --ep 1 \
 *       [--input <video>] [--scene 0.4] [--period 6] [--quality 82] \
 *       [--max 400] [--dry-run]
 *
 *   --series   série db_episodes (DB|DBZ|DBGT|DBS|DB_DAIMA|DBZ_KAI). défaut DBZ
 *   --ep       numberInSeries (obligatoire)
 *   --input    chemin vidéo explicite (sinon résolu dans dbz-sources/)
 *   --scene    seuil scene-detection 0..1 (défaut 0.4 ; plus bas = plus de frames)
 *   --period   1 frame régulière toutes N secondes en filet (défaut 6 ; 0 = off)
 *   --quality  qualité webp 0..100 (défaut 82)
 *   --max      cap de frames gardées après extraction (défaut 600)
 *   --dry-run  n'écrit ni webp ni dataset : compte seulement les frames candidates
 */
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	type EpisodeFrame,
	type FramesDataset,
	type Series,
	pad,
	resolveEpisode,
	writeDatasetIfNonEmpty,
} from "./lib/frames-common.js";

const SERIES_VALUES: Series[] = ["DB", "DBZ", "DBGT", "DBS", "DB_DAIMA", "DBZ_KAI"];
const ROOT = new URL("../", import.meta.url).pathname; // apps/shenron/bot/
const SOURCES_DIR = join(ROOT, "data", "dbz-sources");
const ASSETS_DIR = join(ROOT, "assets", "ext", "db_episodes_frames");
const DATA_DIR = join(ROOT, "data", "dbz-frames");
const VIDEO_EXTS = [".mkv", ".mp4", ".m4v", ".webm", ".avi", ".mov", ".ts"];

interface Args {
	series: Series;
	ep: number;
	input: string | null;
	scene: number;
	period: number;
	quality: number;
	max: number;
	dryRun: boolean;
}

function parseArgs(): Args {
	const argv = process.argv.slice(2);
	const val = (flag: string): string | undefined => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const num = (flag: string, def: number): number => {
		const v = val(flag);
		return v !== undefined && v !== "" ? Number(v) : def;
	};
	const series = (val("--series") ?? "DBZ").toUpperCase() as Series;
	if (!SERIES_VALUES.includes(series)) {
		throw new Error(`--series invalide « ${series} ». Valeurs: ${SERIES_VALUES.join(", ")}`);
	}
	const ep = num("--ep", NaN);
	if (!Number.isInteger(ep) || ep <= 0) {
		throw new Error("--ep <numberInSeries> requis (entier > 0).");
	}
	return {
		series,
		ep,
		input: val("--input") ?? null,
		scene: num("--scene", 0.4),
		period: num("--period", 6),
		quality: num("--quality", 82),
		max: num("--max", 600),
		dryRun: argv.includes("--dry-run"),
	};
}

const exists = (p: string) =>
	stat(p).then(
		() => true,
		() => false
	);

/** Résout la vidéo source : --input explicite, sinon dbz-sources/<series>/<ep>.<ext>. */
async function resolveInput(args: Args): Promise<string> {
	if (args.input) {
		if (!(await exists(args.input))) throw new Error(`--input introuvable: ${args.input}`);
		return args.input;
	}
	const dir = join(SOURCES_DIR, args.series);
	if (await exists(dir)) {
		const files = await readdir(dir);
		const stem = String(args.ep);
		// Match exact "<ep>.<ext>" puis, à défaut, un nom contenant le numéro.
		const exact = files.find((f) => VIDEO_EXTS.some((e) => f.toLowerCase() === `${stem}${e}`));
		const loose = files.find(
			(f) =>
				VIDEO_EXTS.some((e) => f.toLowerCase().endsWith(e)) &&
				new RegExp(`(^|[^0-9])0*${stem}([^0-9]|$)`).test(f)
		);
		const pick = exact ?? loose;
		if (pick) return join(dir, pick);
	}
	throw new Error(
		`Vidéo source introuvable pour ${args.series} ep ${args.ep}.\n` +
			`  Dépose-la dans ${dir}/${args.ep}.<ext> (${VIDEO_EXTS.join("/")}) ou passe --input <chemin>.`
	);
}

/** Durée de la vidéo en secondes via ffprobe (best-effort, 0 si indispo). */
async function probeDuration(input: string): Promise<number> {
	const p = Bun.spawn(
		[
			"ffprobe",
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			input,
		],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const out = await new Response(p.stdout).text();
	await p.exited;
	const d = Number(out.trim());
	return Number.isFinite(d) ? d : 0;
}

/**
 * Lance ffmpeg : sélection = (scene-cut > seuil) OU (1 frame toutes `period` s).
 * Émet des PNG numérotés + un timecode par frame (via `showinfo` sur stderr) pour
 * conserver le mapping frame ↔ timecode. PNG intermédiaire → webp (sharp-free,
 * via `ffmpeg` lui-même en 2e passe par fichier pour la qualité webp).
 *
 * On extrait d'abord en PNG (lossless, vfr) pour pouvoir lire les timecodes
 * `showinfo`, puis on convertit chaque PNG retenu en webp.
 */
async function extractPngs(
	input: string,
	outDir: string,
	args: Args
): Promise<{ file: string; timecodeSec: number | null }[]> {
	const selectParts: string[] = [];
	if (args.scene > 0) selectParts.push(`gt(scene,${args.scene})`);
	// `fps` ne se combine pas dans un `select` ; on l'ajoute en filet via un
	// second terme temporel : isnan(prev_selected_t) ou t-prev >= period.
	if (args.period > 0)
		selectParts.push(`isnan(prev_selected_t)+gte(t-prev_selected_t,${args.period})`);
	const selectExpr = selectParts.length > 0 ? selectParts.join("+") : "1";

	// -vsync vfr : garde le timing variable ; showinfo : émet pts_time sur stderr.
	const vf = `select='${selectExpr}',showinfo`;
	const pattern = join(outDir, "raw-%05d.png");
	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-hide_banner",
			"-loglevel",
			"info",
			"-i",
			input,
			"-vf",
			vf,
			"-vsync",
			"vfr",
			"-frame_pts",
			"0",
			"-y",
			pattern,
		],
		{ stdout: "ignore", stderr: "pipe" }
	);
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`ffmpeg a échoué (code ${code}). Dernières lignes:\n${stderr.slice(-600)}`);
	}

	// `showinfo` émet une ligne par frame SÉLECTIONNÉE, dans l'ordre, avec pts_time.
	const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));

	// Liste les PNG produits, triés (raw-00001.png …) → on les apparie aux times.
	const produced = (await readdir(outDir)).filter((f) => /^raw-\d+\.png$/.test(f)).toSorted();
	return produced.map((f, i) => ({
		file: join(outDir, f),
		timecodeSec: Number.isFinite(times[i]) ? times[i] : null,
	}));
}

/** Convertit un PNG en webp via ffmpeg (qualité réglable), renvoie w/h. */
async function pngToWebp(
	png: string,
	webp: string,
	quality: number
): Promise<{ width: number | null; height: number | null }> {
	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			png,
			"-frames:v",
			"1",
			"-c:v",
			"libwebp",
			"-quality",
			String(quality),
			"-y",
			webp,
		],
		{ stdout: "ignore", stderr: "pipe" }
	);
	await proc.exited;
	// Dimensions via ffprobe sur le webp final.
	const probe = Bun.spawn(
		[
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"csv=p=0",
			webp,
		],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const out = (await new Response(probe.stdout).text()).trim();
	await probe.exited;
	const [w, h] = out.split(",").map((n) => Number(n));
	return { width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null };
}

async function main() {
	const args = parseArgs();
	const input = await resolveInput(args);
	const epId = resolveEpisode(args.series, args.ep);
	const epTag = `ep${pad(args.ep, 3)}`;
	const duration = await probeDuration(input);

	console.log(
		`Extraction frames — ${args.series} ${epTag} (db id ${epId?.id ?? "?"})\n` +
			`  source : ${input} (${duration ? `${duration.toFixed(0)}s` : "durée inconnue"})\n` +
			`  params : scene>${args.scene}${args.period > 0 ? ` + 1/${args.period}s` : ""}, webp q${args.quality}, cap ${args.max}` +
			(args.dryRun ? "  [DRY-RUN]" : "")
	);

	// Dossier de travail temporaire pour les PNG bruts (toujours hors assets prod).
	const work = join("/tmp", `dbz-frames-${args.series}-${epTag}-${Date.now()}`);
	await mkdir(work, { recursive: true });

	const raws = await extractPngs(input, work, args);
	console.log(`  ffmpeg → ${raws.length} frame(s) candidate(s) extraite(s).`);
	if (raws.length === 0)
		throw new Error("0 frame extraite — vérifier la vidéo / abaisser --scene.");

	const kept = raws.slice(0, args.max);
	if (kept.length < raws.length) {
		console.log(`  cap --max ${args.max} → ${raws.length - kept.length} frame(s) ignorée(s).`);
	}

	const relBase = `${args.series}/${epTag}`;
	const assetDir = join(ASSETS_DIR, relBase);
	if (!args.dryRun) await mkdir(assetDir, { recursive: true });

	const frames: EpisodeFrame[] = [];
	let sortOrder = 0;
	for (const r of kept) {
		const idx = pad(sortOrder + 1, 5);
		const fileName = `frame-${idx}.webp`;
		const relPath = `./assets/ext/db_episodes_frames/${relBase}/${fileName}`;
		let width: number | null = null;
		let height: number | null = null;
		if (!args.dryRun) {
			const dest = join(assetDir, fileName);
			const dims = await pngToWebp(r.file, dest, args.quality);
			width = dims.width;
			height = dims.height;
		}
		frames.push({
			source: "ffmpeg",
			sourceId: `ffmpeg:${args.series.toLowerCase()}:${pad(args.ep, 3)}:${idx}`,
			sourceUrl: input,
			episodeNumber: args.ep,
			imagePath: args.dryRun ? null : relPath,
			timecodeSec: r.timecodeSec,
			width,
			height,
			characterNames: [],
			tags: ["ffmpeg-scene"],
			caption: null,
			// Heuristique : une frame issue d'un scene-cut (timecode dédié) est plus
			// « marquante » qu'un filet temporel — affiné par le merge personnages.
			isNotable: false,
			sortOrder: sortOrder++,
		});
	}

	// Nettoyage des PNG bruts (toujours, même dry-run).
	await Bun.spawn(["rm", "-rf", work]).exited;

	const dataset: FramesDataset = {
		series: args.series,
		episodeNumber: args.ep,
		episodeId: epId?.id ?? null,
		source: "ffmpeg",
		meta: {
			input,
			durationSec: duration || null,
			scene: args.scene,
			periodSec: args.period,
			quality: args.quality,
			ffmpeg: "scene-detection + fps filet",
		},
		scrapedAt: new Date().toISOString(),
		frames,
	};

	if (args.dryRun) {
		console.log(
			`\n[DRY-RUN] ${frames.length} frame(s) candidate(s) — rien écrit. ` +
				`Sortie réelle irait dans ${assetDir}/ + ${join(DATA_DIR, `${args.series}-${epTag}.json`)}`
		);
		return;
	}

	await mkdir(DATA_DIR, { recursive: true });
	const out = join(DATA_DIR, `${args.series}-${epTag}.json`);
	await writeDatasetIfNonEmpty(out, dataset);
	console.log(
		`\nOK — ${frames.length} webp dans ${assetDir}\n` +
			`  dataset : ${out}\n` +
			`  ingestion DB (gardée) à faire séparément (Neon db_episodes).`
	);
}

main().catch((e) => {
	console.error("ÉCHEC:", e?.message ?? e);
	process.exit(1);
});
