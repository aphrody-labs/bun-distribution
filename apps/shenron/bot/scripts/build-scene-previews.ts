#!/usr/bin/env bun
/**
 * build-scene-previews.ts — Aperçu animé (`scene_preview`) des épisodes qui ont
 * des captures mais pas de montage.
 *
 * Constat du 2026-09-13 : 124 épisodes DBS portent 8 captures, aucun des 826 n'a
 * de `scene_preview`. `frames-depuis-lecteur.ts`, seule source de captures sur ce
 * VPS, n'écrit que les images ; le montage MP4 n'était produit que par
 * `build-episode-scenes.ts`, qui exige un master vidéo local. La page épisode
 * affiche pourtant l'aperçu animé en tête dès qu'il existe.
 *
 * Aucune vidéo relue : le montage est fait des captures DÉJÀ déposées et écrit à
 * côté d'elles (`…/ep<NNN>/preview.webp`), réduit à 1280 px de large — l'aperçu
 * tourne en boucle en tête de page, la pleine HD ne ferait que l'alourdir.
 *
 * WebP animé et non MP4 : `/assets` du bot refuse l'extension `.mp4` (403), et le
 * servir exigerait un redéploiement du bot. Mesuré sur DBS 1 : 8 captures, 270 Ko,
 * 1,2 s d'encodage ; la page l'affiche comme une image, en boucle.
 *
 * `--images` : un épisode sans `image` reçoit aussi la capture du milieu de
 * l'épisode (même fichier, aucune copie).
 *
 * Écrit dans Postgres `bot.db_episodes` (source éditoriale) ; le reverse-sync
 * `shenron-neon-pull` rapatrie `scene_preview` et `image` dans SQLite.
 * IDEMPOTENT : un épisode qui a déjà son `scene_preview` est sauté, un
 * `preview.webp` déjà sur disque n'est pas remonté.
 * SIMULATION PAR DÉFAUT — `--appliquer` pour écrire.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/build-scene-previews.ts [--series DBS] [--limite N]
 *     [--hold 0.8] [--images] [--appliquer]
 * Env : DATABASE_URL.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { buildScenePreview } from "./lib/scene-preview.js";

const ROOT = new URL("..", import.meta.url).pathname; // apps/shenron/bot/
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const SERIES = opt("series")?.toUpperCase() ?? null;
const LIMITE = Number(opt("limite") ?? Number.POSITIVE_INFINITY);
const HOLD = Number(opt("hold") ?? 0.8);
const IMAGES = flag("images");
const APPLIQUER = flag("appliquer");
const LARGEUR_MAX = 1280;
/** En deçà, le « montage » n'est qu'une image fixe qui clignote. */
const CAPTURES_MIN = 3;

type Capture = { imagePath?: string | null; sortOrder?: number; timecodeSec?: number };
const absolu = (rel: string) => join(ROOT, rel.replace(/^\.\//, ""));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requis");
const sql = postgres(url, { max: 1 });

try {
	const episodes = await sql<{ id: number; series: string; n: number; frames: Capture[]; image: string | null }[]>`
		select id, series, number_in_series as n, frames, image from bot.db_episodes
		 where jsonb_typeof(frames) = 'array' and jsonb_array_length(frames) > 0
		   and (scene_preview is null or btrim(scene_preview) = '')
		   ${SERIES ? sql`and series = ${SERIES}` : sql``}
		 order by series, number_in_series`;
	console.log(
		`${episodes.length} épisode(s) avec captures et sans aperçu${SERIES ? ` (${SERIES})` : ""}${APPLIQUER ? "" : " — SIMULATION"}`
	);

	let montes = 0;
	let repris = 0;
	let images = 0;
	let ecartes = 0;
	for (const e of episodes) {
		if (montes + repris >= LIMITE) break;
		const nom = `${e.series} ${String(e.n).padStart(3, "0")} (#${e.id})`;
		const captures = e.frames
			.filter((f) => f.imagePath)
			.toSorted((a, b) => (a.sortOrder ?? a.timecodeSec ?? 0) - (b.sortOrder ?? b.timecodeSec ?? 0));
		const presentes: Capture[] = [];
		for (const c of captures) if (await Bun.file(absolu(c.imagePath as string)).exists()) presentes.push(c);
		if (presentes.length < CAPTURES_MIN) {
			console.log(`  ✗ ${nom} : ${presentes.length}/${captures.length} capture(s) sur disque`);
			ecartes++;
			continue;
		}
		const dossier = dirname(presentes[0].imagePath as string);
		if (presentes.some((c) => dirname(c.imagePath as string) !== dossier)) {
			console.log(`  ✗ ${nom} : captures réparties dans plusieurs dossiers`);
			ecartes++;
			continue;
		}
		const apercu = `${dossier}/preview.webp`;
		const milieu = presentes[Math.floor(presentes.length / 2)].imagePath as string;
		const poserImage = IMAGES && !e.image?.trim();
		if (!APPLIQUER) {
			console.log(`  · ${nom} : ${presentes.length} captures → ${apercu}${poserImage ? ` · image ← ${milieu}` : ""}`);
			montes++;
			continue;
		}

		const surDisque = Bun.file(absolu(apercu)).size > 0;
		if (!surDisque) {
			const travail = join("/tmp", `scene-preview-${e.id}-${Date.now()}`);
			await mkdir(travail, { recursive: true });
			try {
				await buildScenePreview(
					presentes.map((c) => absolu(c.imagePath as string)),
					absolu(apercu),
					{ hold: HOLD, workDir: travail, maxWidth: LARGEUR_MAX }
				);
			} catch (err) {
				console.log(`  ✗ ${nom} : ${(err as Error).message.split("\n")[0]}`);
				ecartes++;
				continue;
			} finally {
				await rm(travail, { recursive: true, force: true });
			}
		}
		await sql`update bot.db_episodes set scene_preview = ${apercu}
			where id = ${e.id} and (scene_preview is null or btrim(scene_preview) = '')`;
		if (poserImage) {
			await sql`update bot.db_episodes set image = ${milieu}
				where id = ${e.id} and (image is null or btrim(image) = '')`;
			images++;
		}
		if (surDisque) repris++;
		else montes++;
		console.log(
			`  ✓ ${nom} : ${apercu} (${Math.round(Bun.file(absolu(apercu)).size / 1024)} Ko)${poserImage ? " · image posée" : ""}`
		);
	}
	console.log(
		`\n${montes} aperçu(s) ${APPLIQUER ? "monté(s)" : "à monter"} · ${repris} repris du disque · ` +
			`${images} image(s) posée(s) · ${ecartes} écarté(s)`
	);
} finally {
	await sql.end({ timeout: 5 });
}
