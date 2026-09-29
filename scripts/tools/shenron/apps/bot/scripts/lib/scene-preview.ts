/**
 * scene-preview.ts — Aperçu animé court d'une scène d'épisode : diaporama des
 * captures, chacune tenue `hold` secondes.
 *
 * Partagé par `build-episode-scenes.ts` (captures tirées d'un master local) et
 * `build-scene-previews.ts` (captures déjà déposées par `frames-depuis-lecteur.ts`).
 *
 * Le format suit l'extension de sortie :
 *   - `.mp4`  : H.264 web-friendly, `+faststart` ;
 *   - `.webp` : WebP animé en boucle, une image par capture. C'est le format que
 *     `/assets` du bot sert aujourd'hui (le MP4 n'y est pas autorisé), et la
 *     page épisode l'affiche comme une image — aucun lecteur vidéo à armer.
 * ffmpeg `concat demuxer`, dimensions paires dans les deux cas.
 */
import { join } from "node:path";

export interface ScenePreviewOptions {
	/** Durée d'affichage de chaque capture, en secondes. */
	hold: number;
	/** Dossier de travail (liste concat), nettoyé par l'appelant. */
	workDir: string;
	/** Largeur maximale ; une capture plus large est réduite, proportions gardées. */
	maxWidth?: number;
}

const echapper = (chemin: string) => chemin.replace(/'/g, "'\\''");

/** Écrit `sortie` (`.mp4` ou `.webp`) à partir de `images` (chemins absolus, dans l'ordre). */
export async function buildScenePreview(
	images: string[],
	sortie: string,
	opts: ScenePreviewOptions
): Promise<void> {
	const derniere = images.at(-1);
	if (derniere === undefined) throw new Error("montage : aucune capture");
	const webp = sortie.toLowerCase().endsWith(".webp");
	const lignes = images.flatMap((p) => [`file '${echapper(p)}'`, `duration ${opts.hold}`]);
	// En MP4, le concat demuxer ne tient la durée de la dernière image que si elle
	// est répétée. En WebP, `fps` en tire déjà une image par capture : la répéter
	// doublerait la dernière.
	if (!webp) lignes.push(`file '${echapper(derniere)}'`);
	const liste = join(opts.workDir, "concat.txt");
	await Bun.write(liste, `${lignes.join("\n")}\n`);

	const echelle = opts.maxWidth
		? `scale=trunc(min(iw\\,${opts.maxWidth})/2)*2:-2`
		: "scale=trunc(iw/2)*2:trunc(ih/2)*2";
	const encodage = webp
		? ["-vf", `${echelle},fps=${1 / opts.hold}`, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "72", "-compression_level", "4", "-loop", "0"]
		: ["-vf", `${echelle},format=yuv420p`, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart"];
	const proc = Bun.spawn(
		["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", liste, ...encodage, "-y", sortie],
		{ stdout: "ignore", stderr: "pipe" }
	);
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`ffmpeg (preview) a échoué (code ${code}):\n${stderr.slice(-600)}`);
	}
}
