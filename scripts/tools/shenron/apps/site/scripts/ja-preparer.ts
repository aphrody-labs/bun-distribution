/**
 * Installe les ressources japonaises hors dépôt, dans `apps/site/.ja-data/`.
 *
 *   bun apps/site/scripts/ja-preparer.ts [--force]
 *
 * Deux ressources, aucune versionnée dans git (elles pèsent 18 et 113 Mo, et ne
 * sont pas notre code) :
 *
 *  - **le dictionnaire de kuromoji**, recopié depuis `node_modules` : la
 *    bibliothèque le livre avec elle, mais son chemin dépend du hoisting de Bun,
 *    ce qui n'est pas une base fiable pour un service. On le fige à un endroit
 *    que l'on maîtrise.
 *
 *  - **JMdict** (EDRDG, licence CC BY-SA 4.0), récupéré depuis les publications
 *    de `jmdict-simplified`. On n'en garde QUE les graphies : le JSON fait
 *    113 Mo, l'index des formes écrites en fait 7,6, et c'est tout ce dont le
 *    détecteur de fautes a besoin — savoir si un mot existe.
 *
 * Le script est idempotent : il ne refait rien qui soit déjà en place, sauf
 * `--force`. Même esprit que `rag:build` côté bot, en beaucoup plus court.
 */
import { mkdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";

const RACINE = join(import.meta.dir, "..");
const DONNEES = join(RACINE, ".ja-data");
const FORCE = process.argv.includes("--force");

const DEPOT_JMDICT = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

async function existe(chemin: string): Promise<boolean> {
	return await Bun.file(chemin).exists();
}

async function copierDictionnaireKuromoji(): Promise<void> {
	const cible = join(DONNEES, "kuromoji-dict");
	if (!FORCE && (await existe(join(cible, "base.dat.gz")))) {
		console.log("· dictionnaire kuromoji déjà en place");
		return;
	}
	// Bun peut hoister le paquet à la racine du monorepo ou le laisser dans
	// l'application : on essaie les deux plutôt que de supposer.
	const candidats = [
		join(RACINE, "node_modules/@sglkc/kuromoji/dict"),
		join(RACINE, "../../node_modules/@sglkc/kuromoji/dict"),
	];
	const source = (
		await Promise.all(
			candidats.map(async (c) => ((await existe(join(c, "base.dat.gz"))) ? c : null))
		)
	).find(Boolean);
	if (!source) {
		throw new Error("dictionnaire kuromoji introuvable — lancer `bun install` à la racine");
	}
	await mkdir(cible, { recursive: true });
	await cp(source, cible, { recursive: true });
	console.log(`✓ dictionnaire kuromoji copié depuis ${source}`);
}

async function construireIndexJmdict(): Promise<void> {
	const cible = join(DONNEES, "jmdict-graphies.txt");
	if (!FORCE && (await existe(cible))) {
		console.log("· index JMdict déjà en place");
		return;
	}
	console.log("· recherche de la dernière publication de JMdict…");
	const rel = (await (await fetch(DEPOT_JMDICT)).json()) as {
		tag_name: string;
		assets: { name: string; browser_download_url: string }[];
	};
	const asset = rel.assets.find((a) => /^jmdict-eng-3.*\.json\.tgz$/.test(a.name));
	if (!asset) throw new Error("archive jmdict-eng introuvable dans la publication");
	console.log(`· ${rel.tag_name} — téléchargement de ${asset.name}`);

	await mkdir(DONNEES, { recursive: true });
	const archive = join(DONNEES, "jmdict.tgz");
	await Bun.write(archive, await (await fetch(asset.browser_download_url)).arrayBuffer());

	// `tar` plutôt qu'une bibliothèque de décompression : il est présent partout
	// où ce projet tourne, et l'archive n'est lue qu'une fois.
	const extraction = Bun.spawn(["tar", "xzf", archive, "-C", DONNEES], { stderr: "pipe" });
	if ((await extraction.exited) !== 0) {
		throw new Error(`extraction impossible : ${await new Response(extraction.stderr).text()}`);
	}

	const glob = new Bun.Glob("jmdict-eng-*.json");
	const [nom] = [...glob.scanSync(DONNEES)];
	if (!nom) throw new Error("JSON JMdict introuvable après extraction");

	const brut = JSON.parse(await Bun.file(join(DONNEES, nom)).text()) as {
		words: { kanji?: { text: string }[]; kana?: { text: string }[] }[];
	};
	const graphies = new Set<string>();
	for (const mot of brut.words) {
		for (const k of mot.kanji ?? []) graphies.add(k.text);
		for (const k of mot.kana ?? []) graphies.add(k.text);
	}
	await Bun.write(cible, [...graphies].join("\n"));

	// Le JSON complet et l'archive ne servent plus : 113 Mo pour un index de 7,6.
	await rm(join(DONNEES, nom), { force: true });
	await rm(archive, { force: true });
	console.log(
		`✓ ${brut.words.length} entrées → ${graphies.size} graphies (${(Bun.file(cible).size / 1e6).toFixed(1)} Mo)`
	);
}

await mkdir(DONNEES, { recursive: true });
await copierDictionnaireKuromoji();
await construireIndexJmdict();
console.log(`\nressources japonaises prêtes dans ${DONNEES}`);
