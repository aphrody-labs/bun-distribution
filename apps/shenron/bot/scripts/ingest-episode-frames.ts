#!/usr/bin/env bun
/**
 * ingest-episode-frames.ts — Ingestion GARDÉE des « scènes d'épisode » vers Neon.
 *
 * Lit un dataset orchestrateur `data/dbz-frames/<series>-ep<NNN>.json` (produit par
 * `build-episode-scenes.ts`) et écrit dans Neon `bot.db_episodes` :
 *   UPDATE bot.db_episodes
 *      SET frames = <jsonb EpisodeFrame[]>, scene_preview = <text>
 *    WHERE series = … AND number_in_series = …
 *
 * Source de vérité du wiki = Neon. On N'ÉCRIT PAS le SQLite (replica de lecture ;
 * le reverse-sync `shenron-neon-pull` rapatrie ensuite frames/scene_preview).
 *
 * ⚠ jsonb : on passe TOUJOURS la valeur via `sql.json(value)` (postgres-js), JAMAIS
 *   `${JSON.stringify(value)}::jsonb` qui produirait un scalaire string (piège
 *   CLAUDE.md, cf. fix db_episodes.players).
 *
 * GARDE : dry-run par défaut. `--apply` requis pour écrire réellement.
 *
 * Env requis (avec --apply) : DATABASE_URL (Neon). NON sourçable en shell —
 * lancer via systemd-run avec EnvironmentFile (cf. rappel affiché en fin).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   bun apps/shenron/bot/scripts/ingest-episode-frames.ts --series DBZ --ep 1 [--file <json>] [--apply]
 *
 *   --series   série db_episodes (sinon lue depuis le dataset).
 *   --ep       numberInSeries (sinon lu depuis le dataset).
 *   --file     chemin explicite du dataset (sinon résolu : data/dbz-frames/<series>-ep<NNN>.json).
 *   --apply    EXÉCUTE l'UPDATE Neon (sinon dry-run : affiche le plan, n'écrit rien).
 */
import { join } from "node:path";
import { stat } from "node:fs/promises";
import type { EpisodeFrame, Series } from "./lib/frames-common.js";

const SERIES_VALUES: Series[] = ["DB", "DBZ", "DBGT", "DBS", "DB_DAIMA", "DBZ_KAI", "DBZ_KAI_FINAL"];
const ROOT = new URL("../", import.meta.url).pathname; // apps/shenron/bot/
const DATA_DIR = join(ROOT, "data", "dbz-frames");

interface Args {
	series: Series | null;
	ep: number | null;
	file: string | null;
	apply: boolean;
}

interface SceneDataset {
	series: Series;
	number?: number;
	episodeNumber?: number;
	frames: EpisodeFrame[];
	scenePreview: string | null;
}

function parseArgs(): Args {
	const argv = process.argv.slice(2);
	const val = (flag: string): string | undefined => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const seriesRaw = val("--series");
	const series = seriesRaw ? (seriesRaw.toUpperCase() as Series) : null;
	if (series && !SERIES_VALUES.includes(series)) {
		throw new Error(`--series invalide « ${series} ». Valeurs: ${SERIES_VALUES.join(", ")}`);
	}
	const epRaw = val("--ep");
	const ep = epRaw !== undefined && epRaw !== "" ? Number(epRaw) : null;
	if (ep !== null && (!Number.isInteger(ep) || ep <= 0)) {
		throw new Error("--ep doit être un entier > 0.");
	}
	return {
		series,
		ep,
		file: val("--file") ?? null,
		apply: argv.includes("--apply"),
	};
}

const exists = (p: string) =>
	stat(p).then(
		() => true,
		() => false
	);

function pad3(n: number): string {
	return String(n).padStart(3, "0");
}

/** Résout le chemin du dataset : --file explicite, sinon par (série, ep). */
async function resolveDatasetPath(args: Args): Promise<string> {
	if (args.file) {
		if (!(await exists(args.file))) throw new Error(`--file introuvable: ${args.file}`);
		return args.file;
	}
	if (!args.series || args.ep === null) {
		throw new Error("Sans --file, --series ET --ep sont requis pour résoudre le dataset.");
	}
	const p = join(DATA_DIR, `${args.series}-ep${pad3(args.ep)}.json`);
	if (!(await exists(p))) {
		throw new Error(`Dataset introuvable: ${p}. Lance d'abord build-episode-scenes.ts.`);
	}
	return p;
}

async function main(): Promise<void> {
	const args = parseArgs();
	const datasetPath = await resolveDatasetPath(args);
	const ds = (await Bun.file(datasetPath).json()) as SceneDataset;

	const series = (args.series ?? ds.series) as Series;
	const number = args.ep ?? ds.number ?? ds.episodeNumber ?? null;
	if (!series || number === null) {
		throw new Error("Impossible de déterminer (series, number) — préciser --series/--ep.");
	}
	const frames = Array.isArray(ds.frames) ? ds.frames : [];
	const scenePreview = ds.scenePreview ?? null;

	console.log(
		`Ingestion scène d'épisode → Neon bot.db_episodes\n` +
			`  cible   : series=${series} number_in_series=${number}\n` +
			`  dataset : ${datasetPath}\n` +
			`  frames  : ${frames.length}\n` +
			`  preview : ${scenePreview ?? "(aucun)"}\n` +
			`  mode    : ${args.apply ? "APPLY (écriture Neon)" : "DRY-RUN (rien écrit)"}`
	);

	if (!args.apply) {
		console.log(
			`\n[DRY-RUN] Plan SQL (non exécuté) :\n` +
				`  UPDATE bot.db_episodes\n` +
				`     SET frames = <jsonb ${frames.length} frame(s)>, scene_preview = ${
					scenePreview ? `'${scenePreview}'` : "NULL"
				}\n` +
				`   WHERE series = '${series}' AND number_in_series = ${number};\n\n` +
				`Pour écrire réellement (DATABASE_URL NON sourçable en shell) :\n` +
				`  sudo systemd-run --pipe -p EnvironmentFile=~/.shenron-neon.env \\\n` +
				`    --working-directory=${ROOT} \\\n` +
				`    bun scripts/ingest-episode-frames.ts --series ${series} --ep ${number} --apply\n\n` +
				`Après l'apply, propager vers le SQLite du bot (replica de lecture) :\n` +
				`  sudo systemctl start shenron-neon-pull.service`
		);
		return;
	}

	const NEON_URL = process.env.DATABASE_URL;
	if (!NEON_URL) {
		console.error(
			"✗ DATABASE_URL (Neon) requis pour --apply.\n" +
				"  Non sourçable en shell — lancer via :\n" +
				`  sudo systemd-run --pipe -p EnvironmentFile=~/.shenron-neon.env \\\n` +
				`    --working-directory=${ROOT} \\\n` +
				`    bun scripts/ingest-episode-frames.ts --series ${series} --ep ${number} --apply`
		);
		process.exit(1);
	}

	const postgres = (await import("postgres")).default;
	const sql = postgres(NEON_URL, { max: 2, prepare: false });
	try {
		// jsonb via sql.json() (JAMAIS JSON.stringify::jsonb → scalaire string).
		const rows = await sql<{ id: number }[]>`
      UPDATE bot.db_episodes
         SET frames = ${sql.json(frames as unknown as object)},
             -- Un jeu de données sans montage (captures de frames-depuis-lecteur.ts)
             -- ne doit pas effacer l'aperçu posé ensuite par build-scene-previews.ts.
             scene_preview = coalesce(${scenePreview}, scene_preview)
       WHERE series = ${series}
         AND number_in_series = ${number}
      RETURNING id
    `;
		if (rows.length === 0) {
			console.error(
				`✗ Aucune ligne mise à jour — aucun épisode series=${series} number_in_series=${number} dans Neon.`
			);
			process.exitCode = 1;
		} else {
			console.log(
				`✓ ${rows.length} épisode(s) mis à jour (id ${rows.map((r) => r.id).join(", ")}).\n` +
					`  → propager au SQLite du bot : sudo systemctl start shenron-neon-pull.service`
			);
		}
	} finally {
		await sql.end();
	}
}

main().catch((e) => {
	console.error("ÉCHEC:", e?.message ?? e);
	process.exit(1);
});
