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
 * POURQUOI LE SERVEUR MCP ET NON LA CLI NI curl
 * ---------------------------------------------
 * Trois clients ont été mesurés le 2026-09-04 sur les fiches `list/gain_1.php` :
 *   · `curl`, même avec Referer et User-Agent honnêtes → **403 Cloudflare**,
 *     sur TOUS les identifiants, alors que les pages de catalogue (`*.htm`)
 *     passent en 200 avec le même client ;
 *   · `bxc scrape --profile max` en ligne de commande → réussit la première
 *     fiche puis rend des réponses VIDES (96 octets) sur les suivantes ;
 *   · le serveur **bxc-mcp** (`bxc_scrape_markdown`, profil `max`) → rend la
 *     fiche complète, de façon reproductible. C'est le client retenu ici.
 * Le dialogue se fait en JSON-RPC sur l'entrée standard du binaire `bxc-mcp`
 * (transport stdio), un seul processus pour toute la campagne.
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

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const DOSSIER = join(import.meta.dir, "..", "data", "catalogues");
const CATALOGUE = join(DOSSIER, "dragonballcn.json");
const INVENTAIRE = join(DOSSIER, "dragonballcn-inventaire.json");
const BINAIRE_MCP = `${process.env.HOME}/.local/bin/bxc-mcp`;
const COLLECTION = opt("collection");
const LIMITE = Number(opt("limite", "0"));
const DELAI = Number(opt("delai", "1500"));
const RECOMMENCER = flag("recommencer");
/** Au-delà, on considère que la fiche n'a pas répondu plutôt que d'inventer un nombre. */
const DUREE_MAX_MS = 180_000;

type Planche = { n: number; fichier: string; poids: string | null; ajoutee: string | null };
type Ouvrage = { did: string; url: string; libelle?: string; planches?: number | null };
type Collection = { slug: string; titre: string; ouvrages: Ouvrage[] };

// ------------------------------------------------------------ client MCP stdio

/**
 * Un seul processus `bxc-mcp` pour toute la campagne : le relancer à chaque
 * fiche coûterait plus cher que la requête elle-même (le binaire pèse 127 Mo).
 */
class ClientMcp {
	private proc: Bun.Subprocess<"pipe", "pipe", "ignore">;
	private reste = "";
	private lecteur: ReadableStreamDefaultReader<Uint8Array>;
	private id = 0;

	constructor() {
		this.proc = Bun.spawn([BINAIRE_MCP], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
		this.lecteur = this.proc.stdout.getReader();
	}

	/** Lit jusqu'à la réponse portant cet identifiant (le serveur peut intercaler des notifications). */
	private async reponse(id: number, echeance: number): Promise<Record<string, unknown> | null> {
		const decodeur = new TextDecoder();
		while (Date.now() < echeance) {
			const nl = this.reste.indexOf("\n");
			if (nl === -1) {
				const { value, done } = await this.lecteur.read();
				if (done) return null;
				this.reste += decodeur.decode(value, { stream: true });
				continue;
			}
			const ligne = this.reste.slice(0, nl).trim();
			this.reste = this.reste.slice(nl + 1);
			if (!ligne) continue;
			try {
				const msg = JSON.parse(ligne) as { id?: number };
				if (msg.id === id) return msg as Record<string, unknown>;
			} catch {
				// Ligne non JSON (trace du serveur) : on l'ignore.
			}
		}
		return null;
	}

	private async demande(method: string, params: unknown, dureeMs: number) {
		const id = ++this.id;
		this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		await this.proc.stdin.flush();
		return this.reponse(id, Date.now() + dureeMs);
	}

	async ouvrir() {
		await this.demande(
			"initialize",
			{
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "dragonballfr-inventaire", version: "1.0" },
			},
			30_000
		);
		this.proc.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
		);
		await this.proc.stdin.flush();
	}

	async scrapeMarkdown(url: string): Promise<string | null> {
		const r = (await this.demande(
			"tools/call",
			{ name: "bxc_scrape_markdown", arguments: { url, profile: "max", force: true } },
			DUREE_MAX_MS
		)) as { result?: { content?: { type: string; text?: string }[] } } | null;
		const texte = r?.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
		return texte.trim() ? texte : null;
	}

	fermer() {
		this.proc.kill();
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

const client = new ClientMcp();
await client.ouvrir();

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
	client.fermer();
}

const total = Object.values(inventaire).reduce((s, p) => s + p.length, 0);
console.log(`\n✔ ${mesures} ouvrage(s) inventorié(s), ${muets} sans réponse.`);
console.log(
	`  Inventaire : ${Object.keys(inventaire).length} ouvrages, ${total} planches recensées.`
);
