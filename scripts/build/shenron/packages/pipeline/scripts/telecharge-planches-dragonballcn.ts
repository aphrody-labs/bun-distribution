#!/usr/bin/env bun

import { chmod, mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string, defaut = "") => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};

const EXECUTE = flag("oui");
const VERIFIER = flag("verifier-acces");
const COLLECTION = opt("collection");
const DID = opt("did");
const LIMITE = Number(opt("limite", "0"));
const QUALITE = Number(opt("qualite", "78"));

const REFERENCE = opt("reference") || null;

const RACINE_BOT = join(import.meta.dir, "..");
const DOSSIER_CATALOGUES = join(RACINE_BOT, "data", "catalogues");
const CATALOGUE = join(DOSSIER_CATALOGUES, "dragonballcn.json");
const INVENTAIRE = join(DOSSIER_CATALOGUES, "dragonballcn-inventaire.json");
const SORTIE = join(RACINE_BOT, "assets", "dragonballcn", "planches");

const MAISON = process.env.DRAGONBALLCN_ETAT_DIR ?? join(process.env.HOME ?? "/tmp", ".aphrody");
const JOURNAL = join(MAISON, "dragonballcn-planches.json");
const BINAIRE_MCP = join(process.env.HOME ?? "", ".local", "bin", "bxc-mcp");

const RACINE = "https://comic.dragonballcn.com";

const AGENT = "dragonballfr.com-archive/1.0 (rapatriement autorise; +https://dragonballfr.com)";

const DELAI_MIN = 900;
const DELAI_MAX = 2500;
const BUDGET_FENETRE = 300;
const FENETRE_MS = 15 * 60 * 1000;
const BUDGET_JOUR = 5000;
const JOUR_MS = 24 * 60 * 60 * 1000;
const REFUS_MAX = 5;
const DISQUE_MIN = 2 * 2 ** 30;

const DUREE_MCP_MS = 180_000;

type Planche = { n: number; fichier: string; poids: string | null; ajoutee: string | null };
type Ouvrage = { did: string; url: string; libelle?: string; titre_tome?: string };
type Collection = { slug: string; titre: string; ouvrages: Ouvrage[] };
type Journal = {
	dossiers: Record<string, string>;

	acquis: Record<string, number[]>;
	horodatages: number[];

	muettes?: string[];
};

async function litJournal(): Promise<Journal> {
	const vide: Journal = { dossiers: {}, acquis: {}, horodatages: [] };
	const fichier = Bun.file(JOURNAL);
	if (!(await fichier.exists())) return vide;
	return { ...vide, ...((await fichier.json()) as Partial<Journal>) };
}

async function ecritJournal(journal: Journal) {
	await mkdir(MAISON, { recursive: true });
	await Bun.write(JOURNAL, `${JSON.stringify(journal, null, "\t")}\n`);
	await chmod(JOURNAL, 0o600);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const libreSurDisque = async () => {
	const s = await statfs(RACINE_BOT);
	return s.bavail * s.bsize;
};

class Gouverneur {
	constructor(private horodatages: number[]) {}

	private compte(depuis: number) {
		const seuil = Date.now() - depuis;
		return this.horodatages.filter((t) => t > seuil).length;
	}

	verrou(): string | null {
		if (this.compte(FENETRE_MS) >= BUDGET_FENETRE)
			return `budget de fenêtre atteint (${BUDGET_FENETRE} / 15 min)`;
		if (this.compte(JOUR_MS) >= BUDGET_JOUR)
			return `budget quotidien atteint (${BUDGET_JOUR} / 24 h)`;
		return null;
	}

	async temporise() {
		await sleep(DELAI_MIN + Math.floor(Math.random() * Math.max(1, DELAI_MAX - DELAI_MIN)));
		const maintenant = Date.now();
		this.horodatages.push(maintenant);

		const limite = maintenant - JOUR_MS;
		this.horodatages = this.horodatages.filter((t) => t > limite);
	}

	get trace() {
		return this.horodatages;
	}
}

type Reponse = { statut: number; corps: Uint8Array };

async function recupere(url: string, referer: string): Promise<Reponse> {
	const proc = Bun.spawn(
		[
			"curl",
			"-sS",
			"-m",
			"60",
			"--compressed",
			"-A",
			AGENT,
			"-H",
			`Referer: ${referer}`,
			"-w",
			"%{http_code}",
			url,
		],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const brut = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
	await proc.exited;

	const statut = Number(new TextDecoder().decode(brut.slice(-3)));
	return { statut, corps: brut.slice(0, -3) };
}

const estUneImage = (corps: Uint8Array) => {
	if (corps.length < 512) return false;
	const entete = new TextDecoder().decode(corps.slice(0, 16)).toLowerCase();
	return !entete.includes("<!doctype") && !entete.includes("<html");
};

async function resoutDossier(url: string): Promise<string | null> {
	const proc = Bun.spawn([BINAIRE_MCP], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
	const lecteur = proc.stdout.getReader();
	const decodeur = new TextDecoder();
	const echeance = Date.now() + DUREE_MCP_MS;
	let reste = "";

	const envoie = async (message: unknown) => {
		proc.stdin.write(`${JSON.stringify(message)}\n`);
		await proc.stdin.flush();
	};

	const attend = async (id: number): Promise<string | null> => {
		while (Date.now() < echeance) {
			const saut = reste.indexOf("\n");
			if (saut === -1) {
				const { value, done } = await lecteur.read();
				if (done) return null;
				reste += decodeur.decode(value, { stream: true });
				continue;
			}
			const ligne = reste.slice(0, saut).trim();
			reste = reste.slice(saut + 1);
			if (!ligne) continue;
			try {
				if ((JSON.parse(ligne) as { id?: number }).id === id) return ligne;
			} catch {}
		}
		return null;
	};

	try {
		await envoie({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "dragonballfr-planches", version: "1.0" },
			},
		});
		if (!(await attend(1))) return null;
		await envoie({ jsonrpc: "2.0", method: "notifications/initialized" });
		await envoie({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "bxc_scrape_markdown", arguments: { url, profile: "max", force: true } },
		});
		const reponse = await attend(2);
		return reponse ? (/list\/+([^"')\s\\]+?)\/_thumb\./.exec(reponse)?.[1] ?? null) : null;
	} finally {
		lecteur.cancel().catch(() => {});
		proc.kill();
	}
}

async function verifieAcces(collections: Collection[], inventaire: Record<string, Planche[]>) {
	const ouvrage = collections.flatMap((c) => c.ouvrages).find((o) => inventaire[o.did]?.length);
	if (!ouvrage) {
		console.error("✗ Aucun ouvrage inventorié : lancer d'abord volumetrie-dragonballcn.ts.");
		process.exit(1);
	}
	const journal = await litJournal();
	const dossier = journal.dossiers[ouvrage.did] ?? (await resoutDossier(ouvrage.url));
	const fichier = inventaire[ouvrage.did]![0]!.fichier;

	console.log(
		`Sonde sur ${ouvrage.did} (${ouvrage.titre_tome || ouvrage.libelle || "sans titre"})`
	);
	console.log(`  dossier distant : ${dossier ?? "— non résolu (la fiche n'a pas répondu)"}\n`);

	const cibles: [string, string][] = [
		["couverture de catalogue", `${RACINE}/images/cover/db_jp_or/01.gif`],
		["fiche de lecture", ouvrage.url],
	];
	if (dossier) {
		cibles.push(["planche pleine résolution", `${RACINE}/list/${dossier}/${fichier}`]);
		cibles.push(["miniature de planche", `${RACINE}/list/${dossier}/_thumb.${fichier}`]);
	}

	let ouvert = 0;
	for (const [libelle, url] of cibles) {
		const { statut, corps } = await recupere(url, ouvrage.url);
		const verdict =
			statut === 200
				? estUneImage(corps) || libelle.includes("fiche")
					? "ouvert"
					: "page d'erreur"
				: "refusé";
		if (verdict === "ouvert") ouvert++;
		console.log(`  ${String(statut).padEnd(4)} ${verdict.padEnd(14)} ${libelle}`);
		await sleep(1200);
	}

	console.log(
		ouvert === cibles.length
			? "\n✔ Tout répond. Relancer avec --oui pour lancer la campagne."
			: "\n⚠ Le site refuse encore une partie de ces ressources. Un accord éditorial ne\n" +
					"  suffira pas seul : demander en même temps la mise en liste blanche de notre\n" +
					`  agent (« ${AGENT} ») ou de l'IP du VPS, ou l'envoi direct des fichiers.`
	);
}

async function verifiePrealables(sonde: boolean) {
	const manques: string[] = [];

	if (!Bun.which("curl"))
		manques.push("`curl` absent du PATH — c'est le client HTTP du script (apt install curl).");

	if (!(await Bun.file(BINAIRE_MCP).exists()))
		manques.push(
			`\`${BINAIRE_MCP}\` absent — le binaire MCP résout le dossier distant. ` +
				"Le reconstruire depuis bxc : `bun run build:mcp`, puis l'installer dans ~/.local/bin."
		);

	try {
		await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } })
			.webp()
			.toBuffer();
	} catch (erreur) {
		manques.push(
			`\`sharp\` inutilisable (${(erreur as Error).message}) — \`bun install\` à la racine.`
		);
	}

	if (!(await Bun.file(CATALOGUE).exists()))
		manques.push(`\`${CATALOGUE}\` absent — lancer d'abord \`crawl-dragonballcn.ts\`.`);
	if (!(await Bun.file(INVENTAIRE).exists()))
		manques.push(`\`${INVENTAIRE}\` absent — lancer d'abord \`volumetrie-dragonballcn.ts\`.`);

	if (!manques.length) return;
	console.error(`✗ ${manques.length} prérequis manquant(s) :`);
	for (const manque of manques) console.error(`  · ${manque}`);

	if (!sonde && (await Bun.file(CATALOGUE).exists()) && (await Bun.file(INVENTAIRE).exists())) {
		console.error("  (simulation : on continue, mais `--oui` échouerait en l'état)\n");
		return;
	}
	process.exit(1);
}

await verifiePrealables(VERIFIER || EXECUTE);

const catalogue = (await Bun.file(CATALOGUE).json()) as { collections: Collection[] };
const inventaire = (await Bun.file(INVENTAIRE).json()) as Record<string, Planche[]>;
const collections = catalogue.collections.filter((c) => !COLLECTION || c.slug === COLLECTION);

if (VERIFIER) {
	await verifieAcces(collections, inventaire);
	process.exit(0);
}

if (!EXECUTE) {
	console.log("Simulation — aucune requête ne part.\nPour exécuter : relancer avec --oui.\n");
}

const journal = await litJournal();
const gouverneur = new Gouverneur(journal.horodatages);

type Tache = { collection: string; ouvrage: Ouvrage; planches: Planche[] };
const taches: Tache[] = [];
for (const collection of collections) {
	for (const ouvrage of collection.ouvrages) {
		if (DID && ouvrage.did !== DID) continue;
		const planches = inventaire[ouvrage.did];
		if (!planches?.length) continue;
		const acquis = new Set(journal.acquis[ouvrage.did] ?? []);
		const reste = planches.filter((p) => !acquis.has(p.n));
		if (reste.length) taches.push({ collection: collection.slug, ouvrage, planches: reste });
	}
}

const totalPlanches = taches.reduce((s, t) => s + t.planches.length, 0);
console.log(`${taches.length} ouvrage(s) à traiter · ${totalPlanches} planche(s) à rapatrier.\n`);

if (!EXECUTE) {
	for (const tache of taches.slice(0, LIMITE || 10)) {
		console.log(
			`  ${tache.collection}/${tache.ouvrage.did} — ${tache.planches.length} planches → ` +
				`assets/dragonballcn/planches/${tache.collection}/${tache.ouvrage.did}/`
		);
	}
	if (taches.length > (LIMITE || 10))
		console.log(`  … et ${taches.length - (LIMITE || 10)} autres.`);
	process.exit(0);
}

let rapatriees = 0;
let refusConsecutifs = 0;
let n = 0;
const muettes: string[] = [];
const illisibles: string[] = [];

boucle: for (const tache of taches) {
	if (LIMITE && n >= LIMITE) break;

	const dossier = journal.dossiers[tache.ouvrage.did] ?? (await resoutDossier(tache.ouvrage.url));
	if (!dossier) {
		muettes.push(tache.ouvrage.did);
		console.warn(`  ⚠ ${tache.ouvrage.did} — fiche muette, dossier distant introuvable. Passé.`);
		continue;
	}
	journal.dossiers[tache.ouvrage.did] = dossier;

	const cible = join(SORTIE, tache.collection, tache.ouvrage.did);
	await mkdir(cible, { recursive: true });
	const acquis = new Set(journal.acquis[tache.ouvrage.did] ?? []);

	for (const planche of tache.planches) {
		if (LIMITE && n >= LIMITE) break boucle;

		const verrou = gouverneur.verrou();
		if (verrou) {
			console.warn(`\n⏸ Arrêt : ${verrou}. Le journal est à jour, relancer plus tard.`);
			break boucle;
		}
		if ((await libreSurDisque()) < DISQUE_MIN) {
			console.error(
				`\n🛑 Garde-fou disque (< ${(DISQUE_MIN / 2 ** 30).toFixed(0)} Go libres) — arrêt.`
			);
			break boucle;
		}

		await gouverneur.temporise();
		n++;
		const url = `${RACINE}/list/${dossier}/${planche.fichier}`;
		const { statut, corps } = await recupere(url, tache.ouvrage.url);

		if (statut !== 200 || !estUneImage(corps)) {
			refusConsecutifs++;
			console.warn(`  ✗ ${tache.ouvrage.did}/${planche.n} — HTTP ${statut}`);
			if (refusConsecutifs >= REFUS_MAX) {
				console.error(
					`\n🛑 ${REFUS_MAX} refus consécutifs. Le site n'ouvre pas ses planches à ce client.\n` +
						`   L'accord obtenu doit s'accompagner d'un accès technique : liste blanche de\n` +
						`   l'agent (« ${AGENT} ») ou de l'IP du VPS, ou envoi direct. On ne force pas.`
				);
				break boucle;
			}
			continue;
		}
		refusConsecutifs = 0;

		let webp: Uint8Array;
		try {
			webp = new Uint8Array(await sharp(corps).webp({ quality: QUALITE }).toBuffer());
		} catch (erreur) {
			illisibles.push(`${tache.ouvrage.did}/${planche.n}`);
			console.warn(
				`  ✗ ${tache.ouvrage.did}/${planche.n} — illisible : ${(erreur as Error).message}`
			);
			continue;
		}
		await Bun.write(join(cible, `${String(planche.n).padStart(3, "0")}.webp`), webp);
		acquis.add(planche.n);
		rapatriees++;

		if (rapatriees % 20 === 0) {
			journal.acquis[tache.ouvrage.did] = [...acquis].toSorted((a, b) => a - b);
			journal.horodatages = gouverneur.trace;
			await ecritJournal(journal);
			console.log(`  ${rapatriees} planches rapatriées…`);
		}
	}

	journal.acquis[tache.ouvrage.did] = [...acquis].toSorted((a, b) => a - b);
	await Bun.write(
		join(cible, "index.json"),
		`${JSON.stringify(
			{
				did: tache.ouvrage.did,
				collection: tache.collection,
				titre: tache.ouvrage.titre_tome || tache.ouvrage.libelle || null,
				url_fiche: tache.ouvrage.url,
				dossier_distant: dossier,
				reference: REFERENCE,
				rapatrie_le: new Date().toISOString(),
				planches: [...acquis].toSorted((a, b) => a - b),
			},
			null,
			"\t"
		)}\n`
	);
}

journal.horodatages = gouverneur.trace;
journal.muettes = muettes;
await ecritJournal(journal);

console.log(`\n✔ ${rapatriees} planche(s) rapatriée(s) · journal : ${JOURNAL}`);
if (muettes.length)
	console.log(`  ⚠ ${muettes.length} fiche(s) muette(s), non rapatriées : ${muettes.join(", ")}`);
if (illisibles.length)
	console.log(`  ⚠ ${illisibles.length} réponse(s) illisible(s) : ${illisibles.join(", ")}`);
