#!/usr/bin/env bun
/**
 * Inventaire du catalogue de comic.dragonballcn.com : pour chaque ouvrage, la
 * liste de ses planches — numéro, nom de fichier, poids, date de numérisation.
 *
 * CE QUE CE SCRIPT RELÈVE
 * -----------------------
 * Il relève un INVENTAIRE : combien de planches compte chaque édition, comment
 * elles sont nommées et paginées (les doubles pages se repèrent à leur nom,
 * `DB02_044-045`), et à quelle date le site les a mises en ligne. Ce sont des
 * faits bibliographiques, au même titre qu'un ISBN — c'est ce qui manquait au
 * relevé de `crawl-dragonballcn.ts`, qui sait quelles éditions existent mais
 * pas quel volume chacune représente ni où sa pagination diverge.
 *
 * Les fiches passent par le client partagé Aphrody Web (`aphrody web scrape
 * --markdown --profile max`). Le crawl reste séquentiel et persiste ses
 * checkpoints au fil de l'eau.
 *
 * Sorties :
 *   · `data/catalogues/dragonballcn.json`            — le compte, par ouvrage
 *   · `data/catalogues/dragonballcn-inventaire.json` — le détail des planches
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/volumetrie-dragonballcn.ts                    # tout ce qui manque
 *   bun apps/shenron/bot/scripts/volumetrie-dragonballcn.ts --collection divers
 *   bun apps/shenron/bot/scripts/volumetrie-dragonballcn.ts --limite 10 --delai 3000
 *   bun apps/shenron/bot/scripts/volumetrie-dragonballcn.ts --recommencer      # ignore les mesures acquises
 */
import { join } from "node:path";
import { aphrodyWebScrape } from "@shenron/pipeline/aphrody";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const DOSSIER = join(import.meta.dir, "..", "data", "catalogues");
const CATALOGUE = join(DOSSIER, "dragonballcn.json");
const INVENTAIRE = join(DOSSIER, "dragonballcn-inventaire.json");
const COLLECTION = opt("collection");
const LIMITE = Number(opt("limite", "0"));
const DELAI = Number(opt("delai", "1500"));
const RECOMMENCER = flag("recommencer");
/** Au-delà, on considère que la fiche n'a pas répondu plutôt que d'inventer un nombre. */
const DUREE_MAX_MS = 180_000;

type Planche = { n: number; fichier: string; poids: string | null; ajoutee: string | null };
type Ouvrage = { did: string; url: string; libelle?: string; planches?: number | null };
type Collection = { slug: string; titre: string; ouvrages: Ouvrage[] };

// ---------------------------------------------------------- client Aphrody Web

class AphrodyWebScraper {
	async scrapeMarkdown(url: string): Promise<string | null> {
		try {
			return await aphrodyWebScrape(url, { profile: "max", timeoutMs: DUREE_MAX_MS });
		} catch (error) {
			console.error(`Aphrody Web scrape failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}
}

// ------------------------------------------------------------------- extraction

/**
 * La fiche liste ses planches en trois lignes chacune : le lien vers le fichier
 * (qui porte `fid=N`), le poids, la date de mise en ligne. On lit les trois.
 */
function planchesDeLaFiche(markdown: string): Planche[] {
	const planches = new Map<number, Planche>();
	const lignes = markdown.split("\n");
	for (const [i, ligne] of lignes.entries()) {
		// `* [DB02_003-rBumy.jpg](gain_1.php?did=0-1-1&fpp=5&fid=2)`
		const m = ligne.match(/\[([^\]]+\.(?:jpg|jpeg|png|gif|webp))\]\([^)]*[?&]fid=(\d+)\)/i);
		if (!m) continue;
		const n = Number(m[2]);
		if (planches.has(n)) continue;
		const poids = lignes[i + 1]?.match(/([\d.]+\s*[kKmM]b)/)?.[1] ?? null;
		const ajoutee = lignes[i + 2]?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
		planches.set(n, { n, fichier: m[1]!.replace(/\\_/g, "_"), poids, ajoutee });
	}
	return [...planches.values()].toSorted((a, b) => a.n - b.n);
}

// ------------------------------------------------------------------- campagne

const catalogue = (await Bun.file(CATALOGUE).json()) as { collections: Collection[] };
const inventaire: Record<string, Planche[]> = await Bun.file(INVENTAIRE)
	.json()
	.catch(() => ({}));

const collections = catalogue.collections.filter((c) => !COLLECTION || c.slug === COLLECTION);
const aFaire: { collection: string; ouvrage: Ouvrage }[] = [];
for (const c of collections) {
	for (const o of c.ouvrages) {
		if (!RECOMMENCER && typeof o.planches === "number" && inventaire[o.did]?.length) continue;
		aFaire.push({ collection: c.slug, ouvrage: o });
	}
}
const cibles = LIMITE > 0 ? aFaire.slice(0, LIMITE) : aFaire;
console.log(`${cibles.length} ouvrage(s) à inventorier (sur ${aFaire.length} restants).`);

const client = new AphrodyWebScraper();
let mesures = 0;
let muets = 0;
try {
	for (const [i, { collection, ouvrage }] of cibles.entries()) {
		const markdown = await client.scrapeMarkdown(ouvrage.url);
		const planches = markdown ? planchesDeLaFiche(markdown) : [];

		if (planches.length) {
			inventaire[ouvrage.did] = planches;
			ouvrage.planches = planches.length;
			mesures++;
		} else {
			ouvrage.planches = null;
			muets++;
		}

		const etiquette = (ouvrage.libelle || ouvrage.did).slice(0, 40).padEnd(40);
		console.log(
			`  [${String(i + 1).padStart(3)}/${cibles.length}] ${collection.padEnd(24)} ${etiquette} ${planches.length ? `${planches.length} planches` : "— sans réponse"}`
		);

		// Écriture au fil de l'eau : une interruption ne perd pas ce qui est acquis.
		if (i % 10 === 9 || i === cibles.length - 1) {
			await Bun.write(CATALOGUE, `${JSON.stringify(catalogue, null, "\t")}\n`);
			await Bun.write(INVENTAIRE, `${JSON.stringify(inventaire, null, "\t")}\n`);
		}
		if (i < cibles.length - 1) await Bun.sleep(DELAI);
	}
} finally {
	await Bun.write(CATALOGUE, `${JSON.stringify(catalogue, null, "\t")}\n`);
	await Bun.write(INVENTAIRE, `${JSON.stringify(inventaire, null, "\t")}\n`);
}

const total = Object.values(inventaire).reduce((s, p) => s + p.length, 0);
console.log(`\n✔ ${mesures} ouvrage(s) inventorié(s), ${muets} sans réponse.`);
console.log(
	`  Inventaire : ${Object.keys(inventaire).length} ouvrages, ${total} planches recensées.`
);
