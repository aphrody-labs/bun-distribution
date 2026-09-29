/**
 * test-gemma-multimodal.ts — Teste la MULTIMODALITÉ de Gemma 4 (vision) via Ollama
 * sur (1) les PLANCHES manga (images .webp ↔ OCR de référence) et (2) les VIDÉOS
 * (frames extraites par ffmpeg). Gemma 4 est encoder-free multimodal (projecteur clip).
 *
 * Manga : prend N planches (avec OCR de référence) du data/manga-visual-map.json,
 *   envoie l'image à Gemma, et compare la lecture/description vision au texte OCR.
 * Vidéo : --video <fichier> → extrait 3 frames réparties (ffmpeg) → Gemma décrit la
 *   scène et identifie les personnages. (Ollama ne prend pas la vidéo brute : on passe
 *   des frames. Aucune vidéo locale n'existe par défaut → fournir --video.)
 *
 * Usage : bun apps/bot/scripts/test-gemma-multimodal.ts [--manga N] [--video chemin]
 * Env   : MM_MODEL (défaut gemma4:12b), OLLAMA_URL
 */
import { $ } from "bun";

const MODEL = process.env.MM_MODEL ?? "gemma4:12b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/chat";
const ROOT = new URL("..", import.meta.url).pathname; // apps/bot/
const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? (args[i + 1] ?? "") : def;
};

async function vision(prompt: string, imagesB64: string[]): Promise<string> {
	const t0 = Date.now();
	const res = await fetch(OLLAMA, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			think: false,
			stream: false,
			messages: [{ role: "user", content: prompt, images: imagesB64 }],
			options: { temperature: 0.3, num_predict: 320 },
		}),
	});
	if (!res.ok) return `(HTTP ${res.status} : ${(await res.text()).slice(0, 200)})`;
	const j = (await res.json()) as { message?: { content?: string } };
	return `${(j.message?.content ?? "").trim()}  [${Date.now() - t0}ms]`;
}

const b64 = async (path: string) =>
	Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");

// ── 1. MANGA (vision sur planches) ───────────────────────────────────────────
const nManga = Number(flag("--manga", "3"));
if (nManga > 0) {
	const map = JSON.parse(await Bun.file(`${ROOT}data/manga-visual-map.json`).text()) as {
		tomes: {
			series: string;
			tome: string;
			pages: { planche: number; image: string; text: string }[];
		}[];
	};
	const withText: { series: string; tome: string; planche: number; image: string; text: string }[] =
		[];
	for (const t of map.tomes)
		for (const p of t.pages)
			if (p.text && p.text.length > 60)
				withText.push({
					series: t.series,
					tome: t.tome,
					planche: p.planche,
					image: p.image,
					text: p.text,
				});
	console.log(
		`\n========== MANGA (vision) — ${MODEL} — ${withText.length} planches OCR dispo ==========`
	);
	for (let i = 0; i < nManga; i++) {
		const p = withText[Math.floor((i * withText.length) / nManga)];
		if (!p) break;
		const out = await vision(
			"Tu regardes une planche du manga Dragon Ball. Lis le texte des bulles dans l'ordre de lecture (haut→bas, gauche→droite) puis décris en une phrase ce qui se passe.",
			[await b64(`${ROOT}${p.image}`)]
		);
		console.log(`\n--- ${p.series}/${p.tome} planche ${p.planche} (${p.image}) ---`);
		console.log(`  OCR réf  : ${p.text.replace(/\s+/g, " ").slice(0, 140)}`);
		console.log(`  Gemma👁️ : ${out.replace(/\n+/g, " ").slice(0, 480)}`);
	}
}

// ── 2. VIDÉO (vision sur frames) ─────────────────────────────────────────────
const video = flag("--video");
if (video) {
	console.log(`\n========== VIDÉO (frames) — ${MODEL} — ${video} ==========`);
	// durée pour répartir 3 frames
	let dur = 60;
	try {
		const probe =
			await $`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${video}`.text();
		dur = Math.max(6, Math.floor(Number(probe.trim()) || 60));
	} catch {}
	const ts = [0.2, 0.5, 0.8].map((f) => Math.floor(dur * f));
	const frames: string[] = [];
	for (const t of ts) {
		const out = `/tmp/mm-frame-${t}.png`;
		try {
			await $`ffmpeg -y -ss ${t} -i ${video} -frames:v 1 -vf scale=768:-1 ${out}`.quiet();
			frames.push(await b64(out));
		} catch (e) {
			console.error(`  ! extraction frame @${t}s échouée`, e);
		}
	}
	if (frames.length) {
		const out = await vision(
			"Voici des images extraites (dans l'ordre chronologique) d'un épisode ou film Dragon Ball. Décris la scène, le décor, et identifie les personnages visibles.",
			frames
		);
		console.log(
			`\n--- ${frames.length} frames (${ts.join("s, ")}s) ---\n  Gemma👁️ : ${out.slice(0, 600)}`
		);
	}
} else {
	console.log(
		`\n========== VIDÉO ==========\n(aucune vidéo : passe --video /chemin/episode.mp4 — ex. un master DBZ. ffmpeg extraira 3 frames réparties.)`
	);
}
