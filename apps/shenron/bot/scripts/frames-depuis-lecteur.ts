#!/usr/bin/env bun
/**
 * frames-depuis-lecteur.ts — des captures d'épisode SANS vidéo locale.
 *
 * Le pipeline « Scènes d'épisode » existe depuis longtemps (`extract-dbz-frames.ts`,
 * `ingest-episode-frames.ts`), mais il attend un fichier vidéo dans
 * `apps/shenron/bot/data/dbz-sources/`. Il n'y en a aucun sur ce VPS, et il n'y en aura
 * pas : 826 épisodes ne tiennent pas sur un disque déjà à 90 %. Résultat mesuré
 * le 2026-09-12 : la colonne `db_episodes.frames` est vide partout.
 *
 * Ce script lève ce blocage en allant chercher le flux au lieu du fichier :
 *
 *   1. `bxc animesama episodes <slug>` donne, pour une saison et une langue, la
 *      liste ORDONNÉE des lecteurs — un embed par épisode ;
 *   2. `bxc animesama resolve <embed>` rend le HLS direct et les en-têtes
 *      (`Referer`, `Origin`) que l'hébergeur exige ;
 *   3. ffmpeg ouvre ce HLS, se positionne au timecode demandé et n'écrit QUE
 *      l'image : aucune vidéo n'est téléchargée, le coût disque est celui d'une
 *      vignette WebP.
 *
 * ── Le piège, et la garde ────────────────────────────────────────────────────
 * Tout repose sur un pari : que le n-ième lecteur de la liste soit bien le
 * n-ième épisode. Rien ne le garantit — un hors-série inséré, une numérotation
 * décalée, et l'on attribue une scène de l'épisode 40 à la fiche de l'épisode 39.
 * Une erreur invisible, recopiée sur toute une saison.
 *
 * D'où `--verifier` : la première capture (et une sur N ensuite) est soumise à
 * `bxc frames search --remote`, qui interroge trace.moe. Seul un vecteur de 33
 * entiers quitte la machine, jamais l'image. Si le numéro d'épisode reconnu ne
 * correspond pas, le script s'arrête au lieu de polluer une saison entière.
 *
 * ── Ce qu'il écrit ───────────────────────────────────────────────────────────
 * Les mêmes chemins et le même contrat que le pipeline local, pour que
 * l'ingestion gardée existante reprenne la suite sans rien savoir de la source :
 *   assets/ext/db_episodes_frames/<series>/ep<NNN>/frame-<NNNNN>.webp
 *   data/dbz-frames/<series>-ep<NNN>.json
 * AUCUNE écriture en base ici. Le dépôt reste le travail de
 * `ingest-episode-frames.ts`.
 *
 * ── Mode --proxy ─────────────────────────────────────────────────────────────
 * Kai Final n'a pas d'équivalent sûr sur anime-sama : la saison « kai » y aligne
 * 168 lecteurs pour 167 épisodes internationaux, et trace.moe — seul juge de
 * l'alignement — était à court de quota le 2026-09-13. `--proxy` lit chaque fiche
 * par le proxy HLS du bot, c'est-à-dire par le lecteur de SA page : la capture
 * montre ce que la fiche montre, l'alignement est celui de la fiche, et
 * `--verifier` devient sans objet. Les segments du proxy n'ont pas d'extension :
 * la durée vient de la playlist (somme des #EXTINF) et ffmpeg reçoit
 * `-extension_picky 0`.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   bun apps/shenron/bot/scripts/frames-depuis-lecteur.ts --series DBZ --ep 1
 *   bun apps/shenron/bot/scripts/frames-depuis-lecteur.ts --series DBZ --de 1 --a 10 --appliquer
 *   bun apps/shenron/bot/scripts/frames-depuis-lecteur.ts --series DB --lang vostfr --n 6 --appliquer
 *
 *   --series    DB | DBZ | DBGT | DBS | DB_DAIMA | DBZ_KAI | DBZ_KAI_FINAL   (défaut DBZ)
 *   --ep N      un seul épisode        --de N --a M   une plage
 *   --slug      forcer le slug anime-sama (sinon table ci-dessous)
 *   --saison    dossier de saison (défaut saison1)
 *   --lang      vf | vostfr (défaut vf)
 *   --n N       captures par épisode (défaut 8)
 *   --debut S   secondes ignorées au début, générique (défaut 100)
 *   --fin S     secondes ignorées à la fin (défaut 100)
 *   --qualite   qualité WebP 0..100 (défaut 82)
 *   --verifier  contrôle trace.moe au cœur de chaque épisode (45 % puis 70 %)
 *   --proxy     capturer par le proxy HLS du bot (lecteur de la fiche), sans anime-sama
 *   --appliquer écrit réellement ; sans lui, rien n'est créé
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	type EpisodeFrame,
	type FramesDataset,
	type Series,
	pad,
	resolveEpisode,
	writeDatasetIfNonEmpty,
} from "./lib/frames-common.js";

const ROOT = new URL("..", import.meta.url).pathname; // apps/shenron/bot/
const ASSETS_DIR = join(ROOT, "assets", "ext", "db_episodes_frames");
const DATA_DIR = join(ROOT, "data", "dbz-frames");
/** bxc depuis ses sources : le binaire compilé est cassé pour ces commandes. */
const BXC = process.env.BXC_CLI ?? join(process.env.HOME ?? "/home/ubuntu", "bxc/src/cli/index.ts");

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? (args[i + 1] ?? d) : d;
};
const num = (n: string, d: number) => Number(opt(n, String(d))) || d;

const SERIES = (opt("series", "DBZ") ?? "DBZ") as Series;
const LANG = opt("lang", "vf")!;
// Saison anime-sama : `kai` pour Kai (cf. SLUGS), `saison1` partout ailleurs.
const SAISON = opt("saison", SERIES === "DBZ_KAI" ? "kai" : "saison1")!;
const N_FRAMES = Math.max(1, Math.min(40, num("n", 8)));
const DEBUT = num("debut", 100);
const FIN = num("fin", 100);
const QUALITE = Math.max(1, Math.min(100, num("qualite", 82)));
const APPLIQUER = flag("appliquer");
const VERIFIER = flag("verifier");
const PROXY = flag("proxy");
const BOT_LOCAL = process.env.SHENRON_BOT_URL ?? "http://127.0.0.1:5006";

/**
 * Slugs anime-sama par série.
 *
 * Écrits ici plutôt que devinés : `dragon-ball-daima` et `dragon-ball-kai`
 * existent sous des noms qui ne se dérivent pas de notre énumération, et une
 * recherche floue tomberait un jour sur un autre catalogue.
 */
const SLUGS: Record<string, string> = {
	DB: "dragon-ball",
	DBZ: "dragon-ball-z",
	DBGT: "dragon-ball-gt",
	DBS: "dragon-ball-super",
	DB_DAIMA: "dragon-ball-daima",
	// Kai n'a pas de fiche à lui sur anime-sama : c'est la saison « kai » de
	// dragon-ball-z (168 épisodes, Kai puis Final Chapters). « dragon-ball-z-kai »
	// n'existe pas — mesuré le 2026-09-13, l'énumération rendait une erreur.
	DBZ_KAI: "dragon-ball-z",
};
const SLUG = opt("slug", SLUGS[SERIES] ?? "dragon-ball")!;

/** Marge de disque sous laquelle on n'écrit plus rien. */
const DISQUE_MINIMAL_MO = 2_048;

interface Lecteur {
	index: number;
	nom: string;
	hebergeur: string;
	urls: string[];
}

interface Flux {
	type: string;
	url: string | null;
	enTetes: Record<string, string>;
	erreur: string | null;
}

async function bxc(argv: string[], timeoutMs = 180_000): Promise<string> {
	const proc = Bun.spawn(["bun", BXC, ...argv], { stdout: "pipe", stderr: "pipe" });
	const minuteur = setTimeout(() => proc.kill(), timeoutMs);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	clearTimeout(minuteur);
	return sortie;
}

/** Mégaoctets libres sur la partition du dépôt. */
async function disqueLibreMo(): Promise<number> {
	const proc = Bun.spawn(["df", "-Pm", ROOT], { stdout: "pipe" });
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	return Number(sortie.trim().split("\n").at(-1)?.split(/\s+/)[3] ?? 0);
}

/** Durée du flux, en secondes — sans elle, on ne sait pas où répartir les captures. */
async function duree(url: string, enTetes: Record<string, string>): Promise<number | null> {
	const proc = Bun.spawn(
		[
			"ffprobe",
			"-hide_banner",
			"-loglevel",
			"error",
			...(Object.keys(enTetes).length ? ["-headers", entetesFfmpeg(enTetes)] : []),
			"-show_entries",
			"format=duration",
			"-of",
			"default=nw=1:nk=1",
			url,
		],
		{ stdout: "pipe", stderr: "pipe" }
	);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	const secondes = Number(sortie.trim());
	return Number.isFinite(secondes) && secondes > 0 ? secondes : null;
}

/**
 * Durée d'un flux du proxy HLS du bot, et sa nature. ffprobe n'y lit rien (« N/A ») :
 * les segments `/api/hls/<id>/seg?u=…` n'ont pas d'extension. On somme les #EXTINF
 * de la première variante, à condition que la playlist soit close
 * (#EXT-X-ENDLIST). Un MP4 servi sous la même URL passe par ffprobe.
 */
async function dureeProxy(maitre: string): Promise<{ secondes: number; type: "hls" | "mp4" } | null> {
	try {
		const r = await fetch(maitre, { signal: AbortSignal.timeout(90_000) });
		if (!r.ok) return null;
		if (!/mpegurl/i.test(r.headers.get("content-type") ?? "")) {
			await r.body?.cancel();
			const secondes = await duree(maitre, {});
			return secondes ? { secondes, type: "mp4" } : null;
		}
		let playlist = await r.text();
		if (!playlist.includes("#EXTINF")) {
			const variante = playlist
				.split("\n")
				.map((ligne) => ligne.trim())
				.find((ligne) => ligne && !ligne.startsWith("#"));
			if (!variante) return null;
			const rv = await fetch(new URL(variante, maitre), { signal: AbortSignal.timeout(90_000) });
			if (!rv.ok) return null;
			playlist = await rv.text();
		}
		if (!playlist.includes("#EXT-X-ENDLIST")) return null;
		let secondes = 0;
		for (const m of playlist.matchAll(/#EXTINF:\s*([\d.]+)/g)) secondes += Number(m[1]);
		return secondes > 0 ? { secondes, type: "hls" } : null;
	} catch {
		return null;
	}
}

function entetesFfmpeg(enTetes: Record<string, string>): string {
	return `${Object.entries(enTetes)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\r\n")}\r\n`;
}

/** Une capture au timecode demandé. `sortie` vide = échec, jamais une exception. */
async function capture(
	url: string,
	enTetes: Record<string, string>,
	secondes: number,
	fichier: string,
	webp: boolean,
	/** Segments sans extension (proxy du bot) : ffmpeg ≥ 8 les refuse sans `-extension_picky 0`. */
	sansExtension = false
): Promise<boolean> {
	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-hide_banner",
			"-loglevel",
			"error",
			...(Object.keys(enTetes).length ? ["-headers", entetesFfmpeg(enTetes)] : []),
			"-user_agent",
			"Mozilla/5.0",
			...(sansExtension ? ["-extension_picky", "0"] : []),
			// `-ss` AVANT `-i` : ffmpeg saute directement au segment HLS concerné
			// au lieu de décoder tout ce qui précède.
			"-ss",
			String(Math.round(secondes)),
			"-i",
			url,
			"-frames:v",
			"1",
			...(webp ? ["-c:v", "libwebp", "-quality", String(QUALITE)] : ["-q:v", "3"]),
			"-y",
			fichier,
		],
		{ stdout: "ignore", stderr: "pipe" }
	);
	const minuteur = setTimeout(() => proc.kill(), 120_000);
	const erreur = await new Response(proc.stderr).text();
	const code = await proc.exited;
	clearTimeout(minuteur);
	if (code !== 0) {
		console.error(`    ✗ ffmpeg ${Math.round(secondes)}s — ${erreur.trim().slice(0, 160)}`);
		return false;
	}
	return true;
}

/**
 * trace.moe dit-il le même numéro d'épisode que nous ?
 *
 * `null` quand la réponse n'est pas exploitable (quota, réseau, aucune
 * correspondance) : on ne transforme pas une absence de réponse en accusation.
 */
type Verdict = { accord: boolean | null; episode: number | null; similarite: number | null };

async function verdictTraceMoe(fichier: string, attendu: number): Promise<Verdict> {
	const sortie = await bxc(["frames", "search", fichier, "--remote", "--limit", "3", "--json"]);
	try {
		const data = JSON.parse(sortie) as {
			matches?: { title?: string; episode?: number | null; similarity?: number }[];
		};
		const meilleur = (data.matches ?? []).find(
			(m) => /dragon ball/i.test(m.title ?? "") && typeof m.episode === "number"
		);
		if (!meilleur) return { accord: null, episode: null, similarite: null };
		const similarite = meilleur.similarity ?? 0;
		const episode = meilleur.episode ?? null;
		if (similarite < 0.9) return { accord: null, episode, similarite };
		return { accord: episode === attendu, episode, similarite };
	} catch {
		return { accord: null, episode: null, similarite: null };
	}
}

// ── Déroulé ─────────────────────────────────────────────────────────────────

const premier = Number(opt("ep") ?? opt("de", "1"));
const dernier = opt("ep") ? premier : Number(opt("a", String(premier)));
if (!Number.isFinite(premier) || !Number.isFinite(dernier) || dernier < premier) {
	console.error("✗ plage d'épisodes invalide (--ep N, ou --de N --a M)");
	process.exit(1);
}

console.log(
	`${SERIES} · ${SLUG} · ${SAISON} · ${LANG} — épisodes ${premier}→${dernier}, ` +
		`${N_FRAMES} captures/épisode${APPLIQUER ? "" : " (simulation)"}`
);

const brut = PROXY
	? ""
	: await bxc(["animesama", "episodes", SLUG, "--season", SAISON, "--lang", LANG, "--json"]);
let lecteurs: Lecteur[] = [];
try {
	lecteurs = PROXY ? [] : ((JSON.parse(brut) as { lecteurs?: Lecteur[] }).lecteurs ?? []);
} catch {
	console.error(`✗ anime-sama : réponse illisible pour ${SLUG}/${SAISON}/${LANG}`);
	process.exit(1);
}
if (!PROXY && lecteurs.length === 0) {
	console.error("✗ aucun lecteur publié pour cette saison et cette langue");
	process.exit(1);
}
console.log(
	PROXY
		? `  source : proxy HLS du bot, variante ${LANG}`
		: `  lecteurs : ${lecteurs.map((l) => `${l.hebergeur} (${l.urls.length} ép.)`).join(" · ")}`
);

let ecrits = 0;
let echecs = 0;
let verifiees = 0;

for (let ep = premier; ep <= dernier; ep++) {
	console.log(`\n── ${SERIES} épisode ${ep}`);

	// Un hébergeur peut ne pas résoudre (embed4me rend une page sans piste) ;
	// on essaie les suivants avant d'abandonner l'épisode.
	let flux: Flux | null = null;
	let embedUtilise: string | null = null;
	for (const lecteur of lecteurs) {
		const embed = lecteur.urls[ep - 1];
		if (!embed) continue;
		const rep = await bxc(["animesama", "resolve", embed, "--json"]);
		try {
			const f = JSON.parse(rep) as Flux;
			if (f.url) {
				flux = f;
				embedUtilise = embed;
				console.log(`  flux ${f.type} via ${lecteur.hebergeur}`);
				break;
			}
			console.log(`  ${lecteur.hebergeur} : ${f.erreur ?? "pas de piste"}`);
		} catch {
			console.log(`  ${lecteur.hebergeur} : réponse illisible`);
		}
	}
	if (PROXY) {
		const fiche = resolveEpisode(SERIES, ep);
		if (fiche) {
			const chemin = `/api/hls/${fiche.id}/master.m3u8?lang=${LANG}`;
			flux = { type: "hls", url: `${BOT_LOCAL}${chemin}`, enTetes: {}, erreur: null };
			embedUtilise = chemin;
			console.log(`  flux via le proxy (fiche #${fiche.id})`);
		}
	}
	if (!flux?.url) {
		console.error("  ✗ aucun lecteur résolu — épisode ignoré");
		echecs++;
		continue;
	}

	let secondes: number | null;
	if (PROXY) {
		const mesure = await dureeProxy(flux.url);
		secondes = mesure?.secondes ?? null;
		if (mesure) flux.type = mesure.type;
	} else {
		secondes = await duree(flux.url, flux.enTetes);
	}
	if (!secondes) {
		console.error("  ✗ durée inconnue — épisode ignoré");
		echecs++;
		continue;
	}
	const utile = secondes - DEBUT - FIN;
	if (utile < N_FRAMES) {
		console.error(`  ✗ durée utile trop courte (${Math.round(secondes)} s)`);
		echecs++;
		continue;
	}
	console.log(`  durée ${Math.round(secondes)} s — captures entre ${DEBUT} s et ${Math.round(secondes - FIN)} s`);

	const resolu = resolveEpisode(SERIES, ep);
	const dossierRel = `${SERIES}/ep${pad(ep, 3)}`;
	const dossier = join(ASSETS_DIR, dossierRel);
	const frames: EpisodeFrame[] = [];

	// Contrôle d'alignement : UNE fois par épisode, au CŒUR de l'épisode.
	//
	// Il portait sur la première capture, et il a arrêté DBS dès l'épisode 2 le
	// 2026-09-13, alors que l'épisode 1 venait d'être confirmé. Cette capture tombe
	// à ~3 min — en plein récapitulatif de l'épisode précédent, où trace.moe
	// reconnaît, à juste titre, l'épisode d'avant. Ce n'était pas un décalage de
	// lecteurs, c'était le « précédemment dans Dragon Ball Super ».
	//
	// On sonde donc à 45 % puis 70 % de la durée utile. Une confirmation suffit.
	// On n'arrête que si trace.moe désigne avec assurance un autre épisode, et que
	// ce n'est pas simplement le précédent — ou si les deux sondes s'accordent sur
	// le même autre épisode, auquel cas le doute n'est plus permis.
	if (VERIFIER && PROXY) console.log("  · contrôle trace.moe sans objet : capture du lecteur de la fiche");
	if (VERIFIER && !PROXY && verifiees < 24) {
		const sondes: Verdict[] = [];
		for (const part of [0.45, 0.7]) {
			const temoin = `/tmp/frames-verif-${SERIES}-${ep}-${Math.round(part * 100)}.jpg`;
			if (!(await capture(flux.url, flux.enTetes, DEBUT + utile * part, temoin, false))) continue;
			const v = await verdictTraceMoe(temoin, ep);
			verifiees++;
			sondes.push(v);
			if (v.accord === true) break;
		}
		const detail =
			sondes
				.map((v) =>
					v.episode === null ? "sans réponse" : `ép. ${v.episode} à ${Math.round((v.similarite ?? 0) * 100)} %`
				)
				.join(", ") || "aucune sonde";
		const confirme = sondes.some((v) => v.accord === true);
		const refus = sondes.filter((v) => v.accord === false);
		const suspect = refus.some((v) => v.episode !== ep - 1);
		const concordants = refus.length === 2 && refus[0].episode === refus[1].episode;
		if (!confirme && (suspect || concordants)) {
			console.error(
				`  ✗ trace.moe désigne un autre épisode que ${ep} (${detail}) — ` +
					"alignement lecteur/épisode faux, arrêt."
			);
			process.exit(2);
		}
		console.log(
			confirme
				? `  ✓ trace.moe confirme l'épisode ${ep} (${detail})`
				: `  · contrôle trace.moe non concluant (${detail})`
		);
	}

	for (let i = 0; i < N_FRAMES; i++) {
		// Réparties, jamais aux bornes : une capture au tout début du segment
		// utile retombe souvent sur un fondu au noir.
		const t = DEBUT + (utile * (i + 0.5)) / N_FRAMES;

		if (!APPLIQUER) {
			frames.push(cadre(ep, i, null, t, resolu, embedUtilise));
			continue;
		}

		if ((await disqueLibreMo()) < DISQUE_MINIMAL_MO) {
			console.error(`  ✗ moins de ${DISQUE_MINIMAL_MO} Mio libres — arrêt avant écriture`);
			process.exit(3);
		}
		await mkdir(dossier, { recursive: true });
		const nom = `frame-${pad(i + 1, 5)}.webp`;
		const chemin = join(dossier, nom);
		if (!(await capture(flux.url, flux.enTetes, t, chemin, true, PROXY && flux.type === "hls"))) {
			echecs++;
			continue;
		}
		const taille = await stat(chemin).then((s) => s.size).catch(() => 0);
		if (taille < 1_000) {
			console.error(`    ✗ capture vide à ${Math.round(t)} s`);
			echecs++;
			continue;
		}
		frames.push(
			cadre(ep, i, `./assets/ext/db_episodes_frames/${dossierRel}/${nom}`, t, resolu, embedUtilise)
		);
		ecrits++;
	}

	console.log(`  ${frames.length} capture(s)${APPLIQUER ? "" : " simulée(s)"}`);
	if (APPLIQUER && frames.length > 0) {
		await mkdir(DATA_DIR, { recursive: true });
		const dataset: FramesDataset = {
			series: SERIES,
			episodeNumber: ep,
			episodeId: resolu?.id ?? null,
			source: "ffmpeg",
			meta: {
				via: PROXY ? "proxy HLS du bot" : "anime-sama + bxc",
				slug: SLUG,
				saison: SAISON,
				langue: LANG,
				embed: embedUtilise,
				dureeSec: Math.round(secondes),
				captures: N_FRAMES,
				qualiteWebp: QUALITE,
			},
			scrapedAt: new Date().toISOString(),
			frames,
		};
		await writeDatasetIfNonEmpty(join(DATA_DIR, `${SERIES}-ep${pad(ep, 3)}.json`), dataset);
	}
}

/** Un `EpisodeFrame` du contrat partagé, sans rien inventer de plus. */
function cadre(
	ep: number,
	i: number,
	imagePath: string | null,
	t: number,
	resolu: { id: number } | null,
	embed: string | null
): EpisodeFrame {
	return {
		source: "ffmpeg",
		sourceId: `hls:${SERIES.toLowerCase()}:${pad(ep, 3)}:${pad(i + 1, 5)}`,
		sourceUrl: embed,
		episodeNumber: ep,
		imagePath,
		timecodeSec: Math.round(t),
		width: null,
		height: null,
		// Renseignés par le merge de personnages, pas ici : une capture ne sait
		// pas qui elle montre, et le deviner serait de l'invention.
		characterNames: [],
		tags: [],
		caption: null,
		isNotable: false,
		sortOrder: i + 1,
	};
}

console.log(
	`\n${ecrits} capture(s) écrite(s), ${echecs} échec(s)` +
		(VERIFIER ? `, ${verifiees} contrôle(s) trace.moe` : "") +
		(APPLIQUER ? "" : " — simulation, relancer avec --appliquer")
);
