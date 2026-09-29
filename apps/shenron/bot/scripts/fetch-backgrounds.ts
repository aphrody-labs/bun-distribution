#!/usr/bin/env bun
/**
 * Récupère des fonds d'écran public domain (NASA) pour les canvases.
 *
 * Usage : bun scripts/fetch-backgrounds.ts [--list | --download]
 *   --list       (défaut) Affiche les candidats par thème avec URL + titre
 *   --download   Télécharge tout dans assets/backgrounds/<theme>/<slug>.jpg
 *
 * Tous les assets viennent de NASA Images API — **public domain**, sans attribution
 * obligatoire (mention recommandée : "Image credit: NASA").
 */

import { mkdir } from "node:fs/promises";

interface Candidate {
	theme: string;
	query: string;
	/** Pour quel canvas c'est adapté */
	useFor: string[];
}

const THEMES: Candidate[] = [
	{
		theme: "nebula",
		query: "nebula",
		useFor: ["/top (podium)", "/profil (theme cosmic)"],
	},
	{
		theme: "galaxy",
		query: "galaxy spiral",
		useFor: ["/shop", "/fusion background"],
	},
	{
		theme: "sun",
		query: "sun solar corona",
		useFor: ["/top (doré)", "/gay gauge"],
	},
	{
		theme: "earth",
		query: "earth from space",
		useFor: ["/profil default", "/planete Terre"],
	},
	{
		theme: "stars",
		query: "star field deep space",
		useFor: ["/scan scouter", "/bingo grid"],
	},
	{
		theme: "aurora",
		query: "aurora borealis",
		useFor: ["/fusion (turquoise)", "/profil blue"],
	},
];

interface NasaItem {
	data: Array<{ title: string; description?: string; nasa_id: string }>;
	links?: Array<{ href: string; rel: string; render?: string }>;
}

async function search(q: string, perPage = 5): Promise<NasaItem[]> {
	const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=${perPage}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`NASA API HTTP ${res.status}`);
	const json = (await res.json()) as { collection: { items: NasaItem[] } };
	return json.collection.items;
}

/** Retourne l'URL HD (original ~large) en remplaçant ~small / ~medium par ~orig. */
function upgradeUrl(url: string): string {
	return url.replace(/~(small|medium|thumb)\.(jpg|jpeg|png|webp)$/, "~orig.$2");
}

function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

const mode = Bun.argv.includes("--download") ? "download" : "list";

console.log(`${mode === "download" ? "→ Téléchargement" : "→ Liste"} (mode: ${mode})\n`);

let total = 0;
const report: Array<{
	theme: string;
	file?: string;
	url: string;
	title: string;
}> = [];

for (const t of THEMES) {
	console.log(`\x1b[1m── ${t.theme}\x1b[0m  (\x1b[2m${t.useFor.join(" · ")}\x1b[0m)`);
	const items = await search(t.query, 4);
	if (mode === "download") {
		await mkdir(`assets/backgrounds/${t.theme}`, { recursive: true });
	}
	for (const item of items) {
		const title = item.data[0]?.title ?? "?";
		const thumb = item.links?.[0]?.href;
		if (!thumb) continue;
		const hd = upgradeUrl(thumb);
		total++;
		if (mode === "download") {
			const filename = `${slug(title)}.jpg`;
			const path = `assets/backgrounds/${t.theme}/${filename}`;
			try {
				const res = await fetch(hd);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const buf = Buffer.from(await res.arrayBuffer());
				await Bun.write(path, buf);
				const size = (buf.length / 1024).toFixed(0);
				console.log(`  \x1b[32m✓\x1b[0m ${path}  \x1b[2m(${size} KB) — ${title}\x1b[0m`);
				report.push({ theme: t.theme, file: path, url: hd, title });
			} catch (err) {
				console.log(`  \x1b[31m✗\x1b[0m ${filename}  \x1b[2m(${String(err)})\x1b[0m`);
			}
		} else {
			console.log(`  ${hd}`);
			console.log(`    \x1b[2m${title}\x1b[0m`);
			report.push({ theme: t.theme, url: hd, title });
		}
	}
}

console.log(
	`\n${total} image(s) ${mode === "download" ? "téléchargée(s)" : "listée(s)"} · ${THEMES.length} thèmes`
);
if (mode === "list") {
	console.log(`\nPour télécharger : \x1b[34mbun scripts/fetch-backgrounds.ts --download\x1b[0m`);
}

if (mode === "download") {
	// Écrit un manifest JSON
	await Bun.write(
		"assets/backgrounds/manifest.json",
		JSON.stringify(
			{
				source: "NASA Images API — https://images-api.nasa.gov",
				license: "Public Domain (NASA media usage guidelines)",
				generatedAt: new Date().toISOString(),
				images: report,
			},
			null,
			2
		)
	);
	console.log(`\n\x1b[32m✓\x1b[0m manifest : assets/backgrounds/manifest.json`);
}
