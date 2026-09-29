#!/usr/bin/env bun
/**
 * Enrichit `db_games.cover` via l'API MediaWiki de Wikipedia (pas de clé).
 * `generator=search` trouve la meilleure page pour le titre, `pageimages`
 * renvoie l'image d'infobox (box art / logo). Téléchargement local durable
 * dans `assets/ext/db_games/<id>.<ext>` → `cover = ./assets/ext/db_games/...`.
 *
 * Idempotent : ne traite que les jeux sans cover. Réexécutable.
 *
 * Usage : bun scripts/enrich-games-covers.ts [--force] [--dry-run]
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DB = new URL("../data/bot.db", import.meta.url).pathname;
const ASSETS = new URL("../assets/ext/db_games/", import.meta.url).pathname;
const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry-run");
if (!Bun.env.ALLOW_SQLITE_WIKI_WRITE) {
	console.error(
		"Wiki migre sur Neon (source de verite) -- ecriture SQLite ecrasee par le reverse-sync. Edite via le site, ou ALLOW_SQLITE_WIKI_WRITE=1 pour forcer."
	);
	process.exit(1);
}
const db = new Database(DB);
mkdirSync(ASSETS, { recursive: true });

const UA = "ShenronBot/1.0 (https://dragonballfr.com; wiki enrichment)";

// 1) recherche le titre de page Wikipedia le plus pertinent, 2) lit son image
// de tête via l'API REST summary (`originalimage`) — qui expose la box art
// d'infobox (non-free) là où `pageimages` ne renverrait qu'un logo libre.
async function wikiTitle(title: string): Promise<string | null> {
	const url =
		"https://en.wikipedia.org/w/api.php?" +
		new URLSearchParams({
			action: "query",
			format: "json",
			list: "search",
			srsearch: `${title} video game`,
			srlimit: "1",
		});
	try {
		const r = await fetch(url, { headers: { "user-agent": UA } });
		if (!r.ok) return null;
		const j = (await r.json()) as {
			query?: { search?: { title: string }[] };
		};
		return j.query?.search?.[0]?.title ?? null;
	} catch {
		return null;
	}
}

async function summaryImage(page: string): Promise<string | null> {
	const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, "_"))}`;
	try {
		const r = await fetch(url, { headers: { "user-agent": UA } });
		if (!r.ok) return null;
		const j = (await r.json()) as {
			originalimage?: { source: string };
			thumbnail?: { source: string };
		};
		const src = j.originalimage?.source ?? j.thumbnail?.source ?? null;
		return src ? src.split("?")[0] : null;
	} catch {
		return null;
	}
}

async function wikiImage(title: string): Promise<string | null> {
	// Les titres DB ont souvent perdu le préfixe "Dragon Ball Z:" → on biaise la
	// recherche, sauf pour les crossovers Jump dont le nom court est complet.
	const isCrossover = /jump|j-stars|battle stadium|famicom/i.test(title);
	const hasFranchise = /dragon\s*ball/i.test(title);
	const queries =
		isCrossover || hasFranchise
			? [`${title} video game`, title]
			: [`Dragon Ball ${title} video game`, `Dragon Ball Z ${title}`, `${title} video game`];

	for (const q of queries) {
		const page = await wikiTitle(q);
		if (!page) continue;
		const img = await summaryImage(page);
		if (img) return img;
	}
	return null;
}

function extOf(url: string): string {
	const m = url.split("?")[0].match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);
	const e = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
	return e === "svg" ? "png" : e; // évite les SVG (next/image dangerouslyAllowSVG=false)
}

async function download(url: string, dest: string): Promise<boolean> {
	try {
		const r = await fetch(url, {
			headers: { "user-agent": UA, accept: "image/*" },
		});
		if (!r.ok) return false;
		const buf = await r.arrayBuffer();
		if (buf.byteLength < 512) return false;
		await Bun.write(dest, buf);
		return true;
	} catch {
		return false;
	}
}

const where = FORCE ? "" : "WHERE cover IS NULL OR cover = ''";
const games = db.query(`SELECT id, title FROM db_games ${where} ORDER BY id`).all() as {
	id: number;
	title: string;
}[];
const upd = db.query("UPDATE db_games SET cover = ? WHERE id = ?");

console.log(`${games.length} jeu(x) à enrichir`);
let ok = 0;
let fail = 0;
for (const g of games) {
	const img = await wikiImage(g.title);
	if (!img) {
		console.log(`  ✗ ${g.title} — pas d'image Wikipedia`);
		fail++;
		continue;
	}
	if (DRY) {
		console.log(`  · ${g.title} → ${img.slice(0, 80)}`);
		ok++;
		continue;
	}
	const ext = extOf(img);
	const dest = `${ASSETS}${g.id}.${ext}`;
	if (await download(img, dest)) {
		upd.run(`./assets/ext/db_games/${g.id}.${ext}`, g.id);
		console.log(`  ✓ ${g.title}`);
		ok++;
	} else {
		console.log(`  ✗ ${g.title} — download échoué`);
		fail++;
	}
	await new Promise((r) => setTimeout(r, 250)); // courtoisie Wikipedia
}
console.log(`\n✓ ${ok} cover(s) ${DRY ? "trouvées (dry)" : "enregistrées"}, ${fail} échec(s)`);
