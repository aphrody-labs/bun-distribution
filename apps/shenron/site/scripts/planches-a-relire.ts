#!/usr/bin/env bun
/**
 * File d'attente de RELECTURE des transcriptions de databooks.
 *
 * `corrige-transcriptions-ocr.ts` répare ce qui est réparable sans regarder la
 * planche (règles pures). Le reste ne peut pas être deviné : il faut rouvrir
 * l'image. Ce script ne corrige donc rien — il **classe** ce qui doit être relu
 * et sort, pour chaque planche, de quoi la rouvrir (chemin du fichier) et la
 * redéposer (`<fiche>-<page>.jpg`, la clé qu'attend `depose-transcriptions.ts`).
 *
 * Classes de défaut, de la plus sûre à la plus incertaine :
 *   remplacement  le texte porte « � » — sortie tronquée en plein caractère,
 *                 ou signe perdu à l'écriture du fichier de résultats ;
 *   etranger      alphabet sans rapport (cyrillique, arabe, thaï, coréen) au
 *                 milieu du japonais — signature d'une hallucination du modèle ;
 *   han-sans-kana idéogrammes sans un seul kana : du chinois inventé, pas du
 *                 japonais (une page japonaise a presque toujours des kana) ;
 *   boucle        même segment répété en rafale ;
 *   courte        moins de 15 signes alors que la planche n'est pas une simple
 *                 illustration — souvent un OCR qui a abandonné ;
 *   vide          aucune transcription (peut être légitime : planche muette).
 *
 * Usage :
 *   bun scripts/planches-a-relire.ts --classe remplacement --limite 10
 *   bun scripts/planches-a-relire.ts --compte              # effectif par classe
 *   bun scripts/planches-a-relire.ts --classe etranger --json
 *
 * La sortie par défaut est une ligne par planche, séparée par des tabulations :
 *   <fiche>\t<page>\t<clé de dépôt>\t<chemin absolu de l'image>\t<défaut>
 */
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche, gravite, type Defaut } from "../src/lib/databooks-defauts";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const CLASSES = ["remplacement", "etranger", "han-sans-kana", "boucle", "courte", "vide"] as const;
type Classe = Defaut;

const RACINE = join(import.meta.dir, "..", "public", "wiki", "databooks");

/** URL de la base, lue dans `apps/shenron/site/.env` (ancrage `^DATABASE_URL=` : le
 *  fichier porte une ligne Neon COMMENTÉE avant la ligne active). */
async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const distant = await Bun.file(join(import.meta.dir, "../../../.env.remote-db"))
		.text()
		.catch(() => "");
	const remoteLine = distant.split("\n").findLast((l) => l.startsWith("REMOTE_DATABASE_URL="));
	const remoteValue = remoteLine
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (remoteValue) return remoteValue;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const ligne = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.pop();
	const valeur = ligne
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/shenron/site/.env).");
		process.exit(1);
	}
	return valeur;
}

interface Planche {
	fiche: number;
	titre: string;
	page: number;
	image: string;
	defaut: Defaut;
	/** Nombre de signes fautifs (remplacement/étranger) — sert à trier le pire d'abord. */
	gravite: number;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const lignes = await sql<{ id: number; title: string; pages: unknown }[]>`
		SELECT id, title, pages FROM bot.db_databooks WHERE pages IS NOT NULL ORDER BY id`;

	const file: Planche[] = [];
	/** Emplacements sans image ni texte — comptés, jamais mis en file. */
	let fantomes = 0;
	for (const fiche of lignes) {
		const pages = Array.isArray(fiche.pages) ? (fiche.pages as Record<string, unknown>[]) : [];
		for (const p of pages) {
			const texte = typeof p.text === "string" ? p.text : "";
			// Le drapeau posé par le relecteur (« vérifier quand même ») sort la
			// planche de la file : les signatures se trompent sur les planches
			// maigres, et une file qui redonne éternellement les mêmes planches
			// déjà regardées finit par ne plus être ouverte.
			const defaut = defautDePlanche(p, texte);
			if (!defaut) continue;
			const image = typeof p.image === "string" ? p.image.split("/").pop()! : "";
			// Emplacement sans image ET sans texte : il n'y a rien à rouvrir. Ce
			// sont des trous dans le dépôt (262 au 2026-08-25, dont 228 pour le
			// seul Daizenshuu 1), déjà filtrés à l'affichage — les compter comme
			// « à relire » ferait passer un manque de scans pour un défaut d'OCR.
			if (!image) {
				fantomes++;
				continue;
			}
			file.push({
				// `Number()` obligatoire : postgres-js rend les bigint en CHAÎNES.
				// Sans lui, `--fiche 142` comparait `"142" === 142` et ne rendait
				// JAMAIS rien — un relecteur en concluait « rien à relire ici ».
				fiche: Number(fiche.id),
				titre: fiche.title,
				page: Number(p.number ?? 0),
				image,
				defaut,
				gravite: gravite(texte, defaut),
			});
		}
	}

	if (flag("compte")) {
		for (const c of CLASSES) {
			const n = file.filter((p) => p.defaut === c).length;
			console.log(`${c.padEnd(14)} ${String(n).padStart(6)}`);
		}
		console.log(`${"TOTAL".padEnd(14)} ${String(file.length).padStart(6)}`);
		console.log(
			`\n(+ ${fantomes} emplacement(s) sans image ni texte : rien à relire, il manque le scan)`
		);
	} else {
		const classe = opt("classe") as Classe | undefined;
		if (classe && !CLASSES.includes(classe)) {
			console.error(`✗ classe inconnue : ${classe} (attendu : ${CLASSES.join(", ")})`);
			process.exit(2);
		}
		const fiche = opt("fiche") ? Number(opt("fiche")) : null;
		const limite = Number(opt("limite", "0"));
		const depuis = Number(opt("depuis", "0"));

		let sortie = file
			.filter((p) => (classe ? p.defaut === classe : true))
			.filter((p) => (fiche ? p.fiche === fiche : true))
			.toSorted((a, b) => b.gravite - a.gravite || a.fiche - b.fiche || a.page - b.page)
			.slice(depuis);
		if (limite > 0) sortie = sortie.slice(0, limite);

		if (flag("json")) {
			console.log(JSON.stringify(sortie, null, 2));
		} else {
			for (const p of sortie) {
				const extension = p.image.split(".").pop() ?? "jpg";
				console.log(
					[
						p.fiche,
						p.page,
						`${p.fiche}-${p.page}.${extension}`,
						join(RACINE, p.image),
						p.defaut,
					].join("\t")
				);
			}
		}
	}
} finally {
	await sql.end();
}
