#!/usr/bin/env bun
/**
 * Télécharge les COUVERTURES des ouvrages relevés par `crawl-dragonballcn.ts`
 * et les enregistre dans `bot.db_assets` (donc dans la galerie de l'admin).
 *
 * Une couverture par ouvrage : c'est l'illustration qui identifie une édition
 * dans une bibliographie, l'usage que la base pratique déjà partout ailleurs
 * (`license_key = FAIR-USE-EDITORIAL`, cf. les buckets shueisha / viz / toei).
 *
 * Ce que le script pose, que les ingests précédents avaient laissé vide :
 *   · `width`/`height` — mesurés avec sharp. Les 801 assets déjà en base ont ces
 *     deux colonnes à NULL, ce qui empêche la galerie de trier ou de repérer une
 *     vignette trop petite. Tout nouveau média arrive désormais mesuré.
 *   · `sha256` — permet à la galerie de détecter les doublons (64 en base).
 *   · `source_url` — l'URL d'origine, vide sur les 801 : sans elle, impossible de
 *     retrouver d'où vient une image ni de la re-télécharger.
 *
 * Reprise : un fichier déjà présent sur disque ET en base est sauté. Relancer le
 * script après un crawl élargi ne retélécharge que le nouveau.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/telecharge-couvertures-dragonballcn.ts --simulation
 *   bun apps/shenron/bot/scripts/telecharge-couvertures-dragonballcn.ts
 *   bun apps/shenron/bot/scripts/telecharge-couvertures-dragonballcn.ts --collection dragonball_jp_original
 */
import { join } from "node:path";
import postgres from "postgres";
import sharp from "sharp";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const SIMULATION = args.includes("--simulation");
const COLLECTION = opt("collection", "");
const DELAI = Number(opt("delai", "700"));

const RACINE_BOT = join(import.meta.dir, "..");
const CATALOGUE = opt("catalogue", join(RACINE_BOT, "data", "catalogues", "dragonballcn.json"))!;
const RACINE_DB = join(RACINE_BOT, "public", "db");
const BUCKET = "dragonballcn";
const SOURCE_ID = "dragonballcn";
const AGENT =
	"dragonballfr.com-catalogue/1.0 (couvertures bibliographiques; +https://dragonballfr.com)";

const MIMES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
};

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	// La DERNIÈRE ligne `^DATABASE_URL=` fait foi : l'ancienne URL Neon la précède, en commentaire.
	const texte = await Bun.file(join(RACINE_BOT, "..", "site", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

let derniere = 0;
async function temporise() {
	const reste = DELAI - (Date.now() - derniere);
	if (reste > 0) await Bun.sleep(reste);
	derniere = Date.now();
}

/** curl plutôt que `fetch` : Cloudflare rend 403 à l'empreinte TLS de Bun, 200 à celle de curl. */
async function telecharge(url: string, referer: string): Promise<Uint8Array | null> {
	await temporise();
	const proc = Bun.spawn(
		["curl", "-sS", "-m", "40", "-A", AGENT, "-H", `Referer: ${referer}`, "--compressed", url],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const donnees = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
	await proc.exited;
	// Une page d'erreur HTML se reconnaît à sa taille et à son entête ; une image, non.
	if (donnees.length < 512) return null;
	const entete = new TextDecoder().decode(donnees.slice(0, 16)).toLowerCase();
	if (entete.includes("<!doctype") || entete.includes("<html")) return null;
	return donnees;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	const catalogue = await Bun.file(CATALOGUE).json();
	const collections = (catalogue.collections ?? []).filter(
		(c: { slug: string }) => !COLLECTION || c.slug === COLLECTION
	);

	const cibles: { slug: string; url: string; chemin: string; libelle: string; page: string }[] = [];
	for (const c of collections) {
		for (const o of c.ouvrages ?? []) {
			if (!o.couverture) continue;
			const ext = (/\.([a-z0-9]+)(?:\?|$)/i.exec(o.couverture)?.[1] ?? "jpg").toLowerCase();
			if (!MIMES[ext]) continue;
			cibles.push({
				slug: c.slug,
				url: o.couverture,
				chemin: `${BUCKET}/${c.slug}/${o.did}.${ext}`,
				libelle: o.titre_tome || o.libelle || o.did,
				page: o.url,
			});
		}
	}
	console.log(`${cibles.length} couvertures à traiter (${collections.length} collections).\n`);

	const dejaEnBase = new Set(
		(
			(await sql`select path from bot.db_assets where path like ${`${BUCKET}/%`}`) as unknown as {
				path: string;
			}[]
		).map((r) => r.path)
	);

	if (!SIMULATION) {
		await sql`
			insert into bot.db_sources (id, name, url, license_key)
			values (${SOURCE_ID}, ${"鳥山明漫画資料館 (comic.dragonballcn.com)"},
			        ${"https://comic.dragonballcn.com/"}, ${"FAIR-USE-EDITORIAL"})
			on conflict (id) do nothing
		`;
	}

	let [{ max: idCourant }] =
		(await sql`select coalesce(max(id), 0) as max from bot.db_assets`) as unknown as {
			max: number;
		}[];
	idCourant = Number(idCourant);

	let poses = 0,
		sautes = 0,
		echecs = 0;
	for (const cible of cibles) {
		const surDisque = join(RACINE_DB, cible.chemin);
		if (dejaEnBase.has(cible.chemin) && (await Bun.file(surDisque).exists())) {
			sautes++;
			continue;
		}
		if (SIMULATION) {
			console.log(`  ${cible.chemin} ← ${cible.url}`);
			poses++;
			continue;
		}

		const donnees = await telecharge(cible.url, cible.page);
		if (!donnees) {
			echecs++;
			console.warn(`  ✗ ${cible.chemin} — refusé ou vide`);
			continue;
		}

		await Bun.write(surDisque, donnees);
		const ext = cible.chemin.split(".").pop()!;
		let largeur: number | null = null,
			hauteur: number | null = null;
		try {
			const meta = await sharp(donnees).metadata();
			largeur = meta.width ?? null;
			hauteur = meta.height ?? null;
		} catch {
			// Format que sharp ne sait pas lire : le média reste valide, sans dimensions.
		}
		const empreinte = new Bun.CryptoHasher("sha256").update(donnees).digest("hex");

		idCourant++;
		await sql`
			insert into bot.db_assets (id, path, source_id, source_url, license_key, attribution,
			                           sha256, mime_type, bytes, width, height, role, created_at)
			values (${idCourant}, ${cible.chemin}, ${SOURCE_ID}, ${cible.url}, ${"FAIR-USE-EDITORIAL"},
			        ${`Couverture — ${cible.libelle} · comic.dragonballcn.com`},
			        ${empreinte}, ${MIMES[ext] ?? null}, ${donnees.length},
			        ${largeur}, ${hauteur}, ${"cover"}, ${Math.floor(Date.now() / 1000)})
		`;
		poses++;
		if (poses % 25 === 0) console.log(`  ${poses} posées…`);
	}

	console.log(
		`\n${poses} couverture(s) ${SIMULATION ? "à télécharger" : "posée(s)"} · ${sautes} déjà là · ${echecs} échec(s).`
	);
	if (SIMULATION) console.log("(simulation — relancer sans --simulation)");
} finally {
	await sql.end();
}
