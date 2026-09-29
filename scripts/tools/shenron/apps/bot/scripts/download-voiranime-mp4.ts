/**
 * download-voiranime-mp4.ts — CLI Bun : télécharge des épisodes Dragon Ball en MP4
 * depuis VoirAnime, pour NOURRIR Gemma (test multimodal vidéo).
 *
 * Délègue la résolution au MÊME script que le bot prod (`/api/hls/:id/download` →
 * resolveStreamOnDemand → ~/bxc/scripts/resolve-episode.ts), qui scrape les lecteurs
 * FRAIS via VoiranimeScraper et teste chaque provider jusqu'à un flux hls/mp4 valide.
 * Sortie résolveur : { type:"hls"|"mp4", url, headers:{Referer}, provider }.
 * Puis ffmpeg (HLS/m3u8 → mp4, headers Referer injectés).
 *
 * Usage : bun apps/bot/scripts/download-voiranime-mp4.ts <SÉRIE> <ep|début-fin> [opts]
 *   SÉRIE : DB | DBZ | DBGT | DBS | DB_DAIMA   (VOSTFR — comme le résolveur prod)
 *   --duration <sec>  tronque (ex. 90 pour un clip de test rapide)
 *   --out <dir>       défaut apps/bot/data/dbz-videos
 *   --limit <N>       max d'épisodes
 * Env : BXC_DIR (défaut ~/bxc)
 */
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";

const ROOT = new URL("..", import.meta.url).pathname; // apps/bot/
const BXC_DIR = process.env.BXC_DIR ?? `${os.homedir()}/bxc`;
const SERIES = new Set(["DB", "DBZ", "DBGT", "DBS", "DB_DAIMA"]);

const argv = process.argv.slice(2);
const opt = (n: string, d = "") => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const series = (pos[0] ?? "").toUpperCase();
const epArg = pos[1] ?? "";
if (!SERIES.has(series) || !epArg) {
	console.error(
		"Usage: bun scripts/download-voiranime-mp4.ts <DB|DBZ|DBGT|DBS|DB_DAIMA> <ep|a-b> [--duration sec] [--out dir] [--limit N]"
	);
	process.exit(1);
}
const duration = Number(opt("duration", "0"));
const limit = Number(opt("limit", "0"));
const OUT = opt("out") || `${ROOT}data/dbz-videos`;
mkdirSync(OUT, { recursive: true });

const [from, to] = epArg.includes("-")
	? epArg.split("-").map(Number)
	: [Number(epArg), Number(epArg)];
let numbers: number[] = [];
for (let n = from; n <= to; n++) numbers.push(n);
if (limit > 0) numbers = numbers.slice(0, limit);

interface Resolved {
	type?: "hls" | "mp4";
	url?: string;
	headers?: Record<string, string>;
	provider?: string;
	error?: string;
}

/** Résout un épisode → flux, via le script bxc prouvé (même que le bot). */
async function resolve(n: number): Promise<Resolved> {
	const proc = Bun.spawn([process.execPath, "scripts/resolve-episode.ts", series, String(n)], {
		cwd: BXC_DIR,
		stdout: "pipe",
		stderr: "ignore",
	});
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	const line = out.trim().split("\n").findLast(Boolean) ?? "{}";
	try {
		return JSON.parse(line) as Resolved;
	} catch {
		return { error: "parse" };
	}
}

console.log(
	`▶ ${series} : ${numbers.length} épisode(s) → ${OUT}${duration > 0 ? ` (clips ${duration}s)` : ""}`
);
let ok = 0;
for (const n of numbers) {
	const out = `${OUT}/${series}-${String(n).padStart(3, "0")}.mp4`;
	if (existsSync(out)) {
		console.log(`= ep ${n} déjà là, skip`);
		ok++;
		continue;
	}
	process.stdout.write(`· ep ${n} : résolution… `);
	const r = await resolve(n);
	if (!r.url || !(r.type === "hls" || r.type === "mp4")) {
		console.log(`✗ ${r.error ?? "pas de flux"}`);
		continue;
	}
	console.log(`flux ${r.type} via ${r.provider}, download…`);
	const referer = r.headers?.Referer ?? r.headers?.referer ?? "";
	const args = [
		"-y",
		"-loglevel",
		"error",
		...(referer ? ["-headers", `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0`] : []),
		"-i",
		r.url,
		...(duration > 0 ? ["-t", String(duration)] : []),
		"-c",
		"copy",
		"-bsf:a",
		"aac_adtstoasc",
		out,
	];
	const ff = Bun.spawn(["ffmpeg", ...args], { stdout: "ignore", stderr: "pipe" });
	await ff.exited;
	if (ff.exitCode !== 0 || !existsSync(out)) {
		console.log(`  ✗ ep ${n} ffmpeg KO : ${(await new Response(ff.stderr).text()).slice(-160)}`);
		continue;
	}
	const mb = Math.round(Bun.file(out).size / 1024 / 1024);
	console.log(`  ✓ ep ${n} → ${out} (${mb} Mo)`);
	ok++;
}
console.log(
	`\n${ok}/${numbers.length} téléchargé(s). Tester Gemma : bun scripts/test-gemma-multimodal.ts --manga 0 --video "${OUT}/${series}-${String(from).padStart(3, "0")}.mp4"`
);
