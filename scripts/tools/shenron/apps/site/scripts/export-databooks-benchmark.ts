/**
 * Jeu d'évaluation OCR databooks, construit depuis les planches relues.
 *
 * Le corpus complet contient des OCR historiques : s'en servir comme vérité
 * ferait optimiser Aphrody vers les mêmes hallucinations. Ce script n'exporte
 * donc que les planches `verifiee: true`, avec un scan présent et un texte que
 * le juge canonique considère sain. Le lot est portable vers la machine GPU.
 *
 *   bun scripts/export-databooks-benchmark.ts --sortie /tmp/db-benchmark
 *   bun scripts/export-databooks-benchmark.ts --taille 32 --sortie /tmp/db-benchmark
 */
import { copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { cheminPlanche, chargeOuvrages, connecte, texteDePlanche } from "./_databooks-base";
import { defautDePlanche } from "../src/lib/databooks-defauts";

const args = Bun.argv.slice(2);
const valeur = (nom: string): string | undefined => {
	const i = args.indexOf(`--${nom}`);
	return i === -1 ? undefined : args[i + 1];
};
const sortie = valeur("sortie");
const taille = Number(valeur("taille") ?? "64");

if (!sortie || !Number.isSafeInteger(taille) || taille < 1 || taille > 640) {
	console.error(
		"usage : bun scripts/export-databooks-benchmark.ts --sortie <dossier> [--taille 1..640]"
	);
	process.exit(2);
}

type Reference = {
	image: string;
	databookId: number;
	page: number;
	sha256: string;
	text: { kind: "text"; markdown: string };
};

const hashFile = async (path: string) =>
	createHash("sha256")
		.update(Buffer.from(await Bun.file(path).arrayBuffer()))
		.digest("hex");

const sql = await connecte();
try {
	const ouvrages = await chargeOuvrages(sql);
	const candidats = ouvrages.flatMap((ouvrage) =>
		ouvrage.pages.flatMap((planche, index) => {
			const texte = texteDePlanche(planche).trim();
			const source = cheminPlanche(planche.image);
			const page = Number(planche.number ?? index + 1);
			if (
				!source ||
				!Number.isSafeInteger(page) ||
				page < 1 ||
				planche.verifiee !== true ||
				defautDePlanche(planche, texte) !== null
			) {
				return [];
			}
			return [{ databookId: ouvrage.id, page, texte, source }];
		})
	);

	const selection = candidats
		.toSorted((a, b) => a.databookId - b.databookId || a.page - b.page)
		.slice(0, taille);
	if (selection.length === 0) throw new Error("Aucune planche relue saine avec scan disponible.");

	const images = join(sortie, "images");
	await mkdir(images, { recursive: true });
	const references: Reference[] = [];
	for (const item of selection) {
		const ext = extname(item.source).toLowerCase() || ".jpg";
		const image = `${item.databookId}-${String(item.page).padStart(4, "0")}${ext}`;
		await copyFile(item.source, join(images, image));
		references.push({
			image: `images/${image}`,
			databookId: item.databookId,
			page: item.page,
			sha256: await hashFile(item.source),
			text: { kind: "text", markdown: item.texte },
		});
	}
	await Bun.write(
		join(sortie, "benchmark.jsonl"),
		`${references.map((reference) => JSON.stringify(reference)).join("\n")}\n`
	);
	await Bun.write(
		join(sortie, "README.txt"),
		`Benchmark databooks : ${references.length} planches relues, saines et hachées SHA-256.\n` +
			"Ne pas déposer benchmark.jsonl : il sert uniquement à mesurer une sortie Aphrody.\n"
	);
	console.log(
		`✓ benchmark : ${references.length} planche(s) → ${sortie} (${basename(images)}/ + benchmark.jsonl)`
	);
} finally {
	await sql.end();
}
