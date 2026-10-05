#!/usr/bin/env bun
import { tempPath } from "@aphrody/paths";
/**
 * **Poste de commande d'une campagne de traduction par agents.**
 *
 * `traduction-boucle.ts` sait tourner seule parce que ses deux moteurs sont des
 * processus : `aphrody chat` et NLLB. Mesuré le 2026-09-11, aucun des deux n'est
 * utilisable sur ce corpus — la session Google est expirée (HTTP 401) et NLLB a
 * rendu 9 refus sur 9 planches, les databooks étant surtout des tableaux.
 *
 * Le moteur qui passe le juge est un agent d'instruction : 132 planches
 * déposées pour 6 refus sur la première vague. Mais un agent ne se lance pas
 * depuis un script : il se lance depuis la session qui le pilote. La campagne
 * est donc forcément en deux temps, et ce fichier supprime le travail manuel
 * qu'il y avait autour :
 *
 *   bun scripts/campagne-traduction.ts prepare --vague 8 --lot 120 --sortie /tmp/vague
 *       [--exclure 19,18] pour écarter les ouvrages qu'un agent traite encore
 *       → un JSON par ouvrage, sur des ouvrages DISTINCTS pour que deux agents
 *         ne se marchent pas dessus (la file rétrécit à mesure des dépôts, donc
 *         un décalage dans la file ne suffirait pas à les séparer).
 *
 *   bun scripts/campagne-traduction.ts depose /tmp/vague --appliquer
 *       → passe TOUTES les sorties d'agents au juge et les dépose, puis
 *         réindexe Redis. Une sortie fautive n'interrompt pas les autres.
 *
 * Simulation par défaut, comme partout dans cette chaîne.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const commande = args[0] ?? "";
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : d;
};

/** Exécute une commande du dépôt et rend sa sortie ; ne lève jamais. */
async function bun(argv: string[], timeoutMs = 600_000): Promise<{ ok: boolean; sortie: string }> {
	const proc = Bun.spawn(["bun", ...argv], { cwd: RACINE, stdout: "pipe", stderr: "pipe" });
	const minuteur = setTimeout(() => proc.kill(), timeoutMs);
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	clearTimeout(minuteur);
	return { ok: code === 0, sortie: `${out}${err}` };
}

/** Les ouvrages qui restent à traduire, du plus fourni au moins fourni. */
async function ouvragesEnAttente(): Promise<{ id: number; reste: number; titre: string }[]> {
	const r = await bun(["scripts/planches-a-traduire.ts", "--compte"]);
	const lignes = r.sortie.split(/\r?\n/);
	const sortie: { id: number; reste: number; titre: string }[] = [];
	for (const ligne of lignes) {
		// « 19  reste  201  faites  106   171 k signes  Titre de l'ouvrage »
		const m = ligne.match(/^\s*(\d+)\s+reste\s+(\d+)\s+faites\s+\d+\s+\d+ k signes\s+(.+?)\s*$/);
		if (m) sortie.push({ id: Number(m[1]), reste: Number(m[2]), titre: m[3]! });
	}
	return sortie.toSorted((a, b) => b.reste - a.reste);
}

if (commande === "prepare") {
	const vague = Number(opt("vague", "8"));
	const taille = Number(opt("lot", "120"));
	const sortie = opt("sortie", tempPath("vague"))!;
	// Les ouvrages déjà confiés à un agent encore au travail. La file ne rétrécit
	// qu'au DÉPÔT : sans cette exclusion, une seconde vague reprendrait les mêmes
	// planches que la première est en train de traduire, et on paierait deux fois
	// la même lecture pour un doublon que le dépôt refuserait ensuite.
	const exclus = new Set(
		(opt("exclure", "") ?? "")
			.split(",")
			.map((v) => Number(v.trim()))
			.filter((v) => Number.isFinite(v) && v > 0)
	);
	const ouvrages = (await ouvragesEnAttente()).filter((o) => !exclus.has(o.id));
	if (exclus.size > 0) console.log(`${exclus.size} ouvrage(s) exclu(s) : déjà confiés à un agent`);
	if (ouvrages.length === 0) {
		console.log("file vide — rien à préparer");
		process.exit(0);
	}
	const retenus = ouvrages.slice(0, vague);
	console.log(`${ouvrages.length} ouvrage(s) en attente — préparation de ${retenus.length} lot(s)`);
	let prepares = 0;
	for (const o of retenus) {
		const fichier = join(sortie, `lot-db${o.id}.json`);
		const r = await bun([
			"scripts/planches-a-traduire.ts",
			"--databook",
			String(o.id),
			"--lot",
			String(taille),
			"--json",
			fichier,
		]);
		const premiere = r.sortie.split(/\r?\n/).find((l) => l.includes("planches")) ?? r.sortie.slice(0, 120);
		console.log(`  ${r.ok ? "✓" : "✗"} #${o.id} ${o.titre.slice(0, 44).padEnd(44)} ${premiere.trim()}`);
		if (r.ok) prepares += 1;
	}
	console.log(`\n${prepares}/${retenus.length} lot(s) prêts dans ${sortie}`);
	process.exit(prepares === 0 ? 1 : 0);
}

if (commande === "depose") {
	const racine = args[1];
	if (!racine || !existsSync(racine)) {
		console.error("usage : campagne-traduction.ts depose <racine-des-sorties> [--appliquer]");
		process.exit(2);
	}
	const appliquer = flag("appliquer");
	const fichiers = readdirSync(racine)
		.filter((f) => f.endsWith(".jsonl"))
		.toSorted();
	if (fichiers.length === 0) {
		console.log(`aucune sortie d'agent (*.jsonl) dans ${racine}`);
		process.exit(0);
	}
	let retenues = 0;
	let refusees = 0;
	for (const f of fichiers) {
		const argv = ["scripts/depose-traductions.ts", join(racine, f)];
		if (appliquer) argv.push("--appliquer");
		const r = await bun(argv);
		// « 34 traductions retenues, 4 refusées. »
		const m = r.sortie.match(/(\d+) traductions? retenues?, (\d+) refus/);
		if (m) {
			retenues += Number(m[1]);
			refusees += Number(m[2]);
			console.log(`  ${f.padEnd(28)} ${m[1]!.padStart(4)} retenues, ${m[2]!.padStart(3)} refusées`);
		} else {
			console.log(`  ${f.padEnd(28)} ✗ ${r.sortie.trim().split(/\r?\n/).pop()?.slice(0, 90)}`);
		}
	}
	console.log(`\n${retenues} retenue(s), ${refusees} refusée(s)${appliquer ? "" : " (simulation)"}`);

	if (appliquer && retenues > 0) {
		// Le dépôt écrit directement en base : l'index Redis, lui, est tenu par
		// l'API. Sans cette passe, le back-office montrerait l'état d'avant.
		const r = await bun(["scripts/index-databooks-redis.ts"]);
		console.log(r.ok ? r.sortie.trim().split(/\r?\n/).pop() : `✗ Redis : ${r.sortie.slice(0, 160)}`);
	}
	process.exit(0);
}

console.error(
	await Bun.file(import.meta.path)
		.text()
		.then((t) => t.split("*/")[0]!.replace(/^#!.*\n/, ""))
);
process.exit(2);
