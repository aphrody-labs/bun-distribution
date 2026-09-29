#!/usr/bin/env bun
/**
 * assets-dragonballcn.ts — Constitue le MIROIR LOCAL de ce que
 * comic.dragonballcn.com (鳥山明漫画資料館) sert réellement, rangé sous
 * `apps/bot/assets/dragonballcn/`.
 *
 * CE QUI EST MIROITÉ
 * ------------------
 *   · les 12 pages de catalogue (`*.htm`) — la source du relevé bibliographique,
 *     archivées telles quelles sous `data/catalogues/pages/` ;
 *   · les couvertures d'édition (`images/cover/…`) — une par tome, converties en
 *     WebP et rangées par collection puis par ordre de parution ;
 *   · le catalogue et l'inventaire de pagination, fondus en un manifeste unique
 *     `assets/dragonballcn/index.json`.
 *
 * RANGEMENT
 * ---------
 *   assets/dragonballcn/
 *     README.md                     provenance, licence, ce qui manque et pourquoi
 *     index.json                    manifeste : collections → ouvrages → métadonnées
 *     <collection>/NNN.webp         couverture, NNN = rang de parution dans l'édition
 *
 * Usage :
 *   bun apps/bot/scripts/assets-dragonballcn.ts --simulation
 *   bun apps/bot/scripts/assets-dragonballcn.ts
 *   bun apps/bot/scripts/assets-dragonballcn.ts --collection dragonball_jp_original --force
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string, defaut = "") => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};

const SIMULATION = flag("simulation");
const FORCE = flag("force");
const COLLECTION = opt("collection");
const DELAI = Number(opt("delai", "700"));
const QUALITE = Number(opt("qualite", "82"));

const RACINE_BOT = join(import.meta.dir, "..");
const DOSSIER_CATALOGUES = join(RACINE_BOT, "data", "catalogues");
const CATALOGUE = join(DOSSIER_CATALOGUES, "dragonballcn.json");
const INVENTAIRE = join(DOSSIER_CATALOGUES, "dragonballcn-inventaire.json");
const CACHE_PAGES = join(DOSSIER_CATALOGUES, ".cache-dragonballcn");
const MIROIR_PAGES = join(DOSSIER_CATALOGUES, "pages");
/** Couvertures déjà rapatriées par `telecharge-couvertures-dragonballcn.ts`. */
const RESERVE = join(RACINE_BOT, "public", "db", "dragonballcn");
const SORTIE = join(RACINE_BOT, "assets", "dragonballcn");

const RACINE_SITE = "https://comic.dragonballcn.com";
const AGENT =
	"dragonballfr.com-catalogue/1.0 (couvertures bibliographiques; +https://dragonballfr.com)";

type Planche = { n: number; fichier: string; poids: string | null; ajoutee: string | null };
type Ouvrage = {
	did: string;
	url: string;
	libelle?: string;
	couverture?: string | null;
	titre_tome?: string;
	premiere_edition?: string;
	isbn?: string;
	magazine?: string;
	prix?: string;
	editeur?: string;
	planches?: number | null;
	/** Posés par `enrichit-divers-dragonballcn.ts` depuis les pages d'index. */
	rubrique?: string;
	rubrique_icone?: string | null;
	date_affichee?: string | null;
	parution?: string | null;
	numerisation?: string | null;
	fil_forum?: string | null;
};
type Collection = {
	slug: string;
	titre: string;
	titre_site: string | null;
	url: string;
	ouvrages: Ouvrage[];
};

// ------------------------------------------------------------------ récupération

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
	if (donnees.length < 512) return null;
	const entete = new TextDecoder().decode(donnees.slice(0, 16)).toLowerCase();
	// Une page d'erreur se reconnaît à son entête ; une image, non.
	return entete.includes("<!doctype") || entete.includes("<html") ? null : donnees;
}

/** La couverture, prise à la réserve locale si elle y est, au site sinon. */
async function sourceCouverture(slug: string, ouvrage: Ouvrage): Promise<Uint8Array | null> {
	const ext = (/\.([a-z0-9]+)(?:\?|$)/i.exec(ouvrage.couverture ?? "")?.[1] ?? "jpg").toLowerCase();
	const local = Bun.file(join(RESERVE, slug, `${ouvrage.did}.${ext}`));
	if (await local.exists()) return new Uint8Array(await local.arrayBuffer());
	return telecharge(ouvrage.couverture!, ouvrage.url);
}

// ------------------------------------------------------------------ pages source

/** Les pages de catalogue lues par le crawler, sous un nom lisible plutôt qu'un hachage. */
async function miroiteLesPages(collections: Collection[]) {
	let copiees = 0;
	for (const collection of collections) {
		const cache = Bun.file(join(CACHE_PAGES, `${Bun.hash(collection.url).toString(36)}.html`));
		if (!(await cache.exists())) continue;
		if (SIMULATION) {
			copiees++;
			continue;
		}
		await Bun.write(join(MIROIR_PAGES, `${collection.slug}.html`), await cache.arrayBuffer());
		copiees++;
	}
	return copiees;
}

// ------------------------------------------------------------------ campagne

const catalogue = (await Bun.file(CATALOGUE).json()) as {
	source: string;
	releve_le: string;
	collections: Collection[];
};
const inventaire = (await Bun.file(INVENTAIRE)
	.json()
	.catch(() => ({}))) as Record<string, Planche[]>;

const collections = catalogue.collections.filter((c) => !COLLECTION || c.slug === COLLECTION);

if (FORCE && !SIMULATION && !COLLECTION) await rm(SORTIE, { recursive: true, force: true });

const manifeste = {
	source: RACINE_SITE,
	titre_source: "鳥山明漫画資料館 (comic.dragonballcn.com)",
	releve_le: catalogue.releve_le,
	miroir_le: new Date().toISOString(),
	licence: "FAIR-USE-EDITORIAL",
	perimetre:
		"Couvertures d'édition et données bibliographiques uniquement. Les planches restent " +
		"référencées par leurs URLs publiques DragonballCN et ne sont pas copiées dans ce miroir.",
	totaux: {
		collections: 0,
		ouvrages: 0,
		couvertures: 0,
		planches_recensees: 0,
		avec_isbn: 0,
		avec_date: 0,
		avec_pagination: 0,
	},
	collections: [] as unknown[],
};

let ecrites = 0;
let reprises = 0;
let echecs = 0;

for (const collection of collections) {
	const dossier = join(SORTIE, collection.slug);
	if (!SIMULATION) await mkdir(dossier, { recursive: true });

	const ouvrages: unknown[] = [];
	for (const [i, ouvrage] of collection.ouvrages.entries()) {
		const rang = String(i + 1).padStart(3, "0");
		const planches = inventaire[ouvrage.did]?.length ?? null;
		const fiche: Record<string, unknown> = {
			rang: i + 1,
			did: ouvrage.did,
			url_fiche: ouvrage.url,
			titre: ouvrage.titre_tome || ouvrage.libelle || null,
			rubrique: ouvrage.rubrique ?? null,
			// `premiere_edition` vient du bloc éditeur ; `parution` de la liste d'index.
			premiere_edition: ouvrage.premiere_edition ?? ouvrage.parution ?? null,
			numerisation: ouvrage.numerisation ?? null,
			date_affichee: ouvrage.date_affichee ?? null,
			isbn: ouvrage.isbn ?? null,
			editeur: ouvrage.editeur ?? null,
			magazine: ouvrage.magazine ?? null,
			prix: ouvrage.prix ?? null,
			fil_forum: ouvrage.fil_forum ?? null,
			planches_recensees: planches,
			// Une fiche que le site n'a pas rendue au bout de cinq passes est déclarée
			// muette, pas comptée à zéro : l'absence de mesure n'est pas une mesure.
			pagination: planches ? "relevee" : "fiche muette",
			couverture: null,
		};

		if (ouvrage.couverture) {
			const relatif = `${collection.slug}/${rang}.webp`;
			const cible = join(dossier, `${rang}.webp`);
			const deja = Bun.file(cible);

			if (!FORCE && (await deja.exists())) {
				const donnees = new Uint8Array(await deja.arrayBuffer());
				const meta = await sharp(donnees).metadata();
				fiche.couverture = {
					chemin: `./assets/dragonballcn/${relatif}`,
					source_url: ouvrage.couverture,
					octets: donnees.length,
					largeur: meta.width ?? null,
					hauteur: meta.height ?? null,
					sha256: new Bun.CryptoHasher("sha256").update(donnees).digest("hex"),
				};
				reprises++;
			} else if (SIMULATION) {
				console.log(`  ${relatif} ← ${ouvrage.couverture}`);
				ecrites++;
			} else {
				const brut = await sourceCouverture(collection.slug, ouvrage);
				if (!brut) {
					echecs++;
					console.warn(`  ✗ ${relatif} — refusée ou vide (${ouvrage.couverture})`);
				} else {
					// Sans redimensionner : une couverture de catalogue fait déjà moins de 400 px.
					const webp = new Uint8Array(await sharp(brut).webp({ quality: QUALITE }).toBuffer());
					await Bun.write(cible, webp);
					const meta = await sharp(webp).metadata();
					fiche.couverture = {
						chemin: `./assets/dragonballcn/${relatif}`,
						source_url: ouvrage.couverture,
						octets: webp.length,
						largeur: meta.width ?? null,
						hauteur: meta.height ?? null,
						sha256: new Bun.CryptoHasher("sha256").update(webp).digest("hex"),
					};
					ecrites++;
				}
			}
		}

		ouvrages.push(fiche);
		manifeste.totaux.ouvrages++;
		if (fiche.couverture) manifeste.totaux.couvertures++;
		if (ouvrage.isbn) manifeste.totaux.avec_isbn++;
		if (fiche.premiere_edition) manifeste.totaux.avec_date++;
		if (planches) manifeste.totaux.avec_pagination++;
		manifeste.totaux.planches_recensees += planches ?? 0;
	}

	manifeste.collections.push({
		slug: collection.slug,
		titre: collection.titre,
		titre_site: collection.titre_site,
		url: collection.url,
		page_archivee: `./data/catalogues/pages/${collection.slug}.html`,
		ouvrages,
	});
	manifeste.totaux.collections++;
	console.log(`▸ ${collection.slug.padEnd(26)} ${collection.ouvrages.length} ouvrages`);
}

const pages = await miroiteLesPages(collections);

if (!SIMULATION && !COLLECTION) {
	await Bun.write(join(SORTIE, "index.json"), `${JSON.stringify(manifeste, null, "\t")}\n`);
}

// Les dossiers vides (aucune couverture disponible) ne restent pas en place.
if (!SIMULATION) {
	for (const collection of collections) {
		const dossier = join(SORTIE, collection.slug);
		const contenu = await readdir(dossier).catch(() => [] as string[]);
		if (!contenu.length) await rm(dossier, { recursive: true, force: true });
	}
}

console.log(
	`\n✔ ${ecrites} couverture(s) ${SIMULATION ? "à écrire" : "écrite(s)"} · ${reprises} déjà là · ${echecs} échec(s)` +
		` · ${pages} page(s) de catalogue archivée(s).`
);
console.log(
	`  Manifeste : ${manifeste.totaux.collections} collections · ${manifeste.totaux.ouvrages} ouvrages · ` +
		`${manifeste.totaux.couvertures} couvertures · ${manifeste.totaux.avec_date} datés · ` +
		`${manifeste.totaux.avec_isbn} ISBN · ${manifeste.totaux.avec_pagination} paginés · ` +
		`${manifeste.totaux.planches_recensees} planches recensées (non reproduites).`
);
if (SIMULATION) console.log("  (simulation — relancer sans --simulation)");
