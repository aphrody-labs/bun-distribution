/**
 * Compare une sortie Aphrody au benchmark databooks relu.
 *
 * Lecture seule : ce score n'écrit ni en base ni dans Redis. Il rend visible
 * une régression avant qu'un modèle ne passe sur un lot de production.
 *
 *   bun scripts/score-databooks-ocr.ts <benchmark.jsonl> <resultats.jsonl>
 */
import { basename } from "node:path";
import { classerDefaut } from "../src/lib/databooks-defauts";

const [benchmarkPath, resultatPath] = Bun.argv.slice(2);
if (!benchmarkPath || !resultatPath) {
	console.error("usage : bun scripts/score-databooks-ocr.ts <benchmark.jsonl> <resultats.jsonl>");
	process.exit(2);
}

type Ligne = { image?: string; text?: { kind?: string; markdown?: string } };
const lire = async (path: string) =>
	(await Bun.file(path).text())
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Ligne];
			} catch {
				return [];
			}
		});
const cle = (image: string | undefined) => basename(image ?? "");
const normalise = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
const distance = (a: string, b: string) => {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				current[j - 1]! + 1,
				previous[j]! + 1,
				previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		previous = current;
	}
	return previous[b.length]!;
};

const references = await lire(benchmarkPath);
const resultats = new Map((await lire(resultatPath)).map((item) => [cle(item.image), item]));
let missing = 0;
let textless = 0;
let fautives = 0;
let total = 0;
let similarity = 0;
for (const reference of references) {
	const result = resultats.get(cle(reference.image));
	if (!result) {
		missing++;
		continue;
	}
	const attendu = normalise(reference.text?.markdown ?? "");
	const obtenu = result.text?.kind === "text" ? normalise(result.text.markdown ?? "") : "";
	if (!obtenu) {
		textless++;
		continue;
	}
	// Une référence a été relue à l'image : une signature mécanique peut donc
	// être légitime (couverture très courte, kanji isolés). L'égalité exacte à
	// cette référence ne doit jamais échouer le benchmark.
	if (obtenu !== attendu && classerDefaut(obtenu) !== null) fautives++;
	total++;
	similarity += 1 - distance(attendu, obtenu) / Math.max(attendu.length, obtenu.length, 1);
}
const couverture = references.length
	? (100 * (references.length - missing)) / references.length
	: 0;
const precision = total ? (100 * similarity) / total : 0;
console.log(
	JSON.stringify(
		{
			references: references.length,
			missing,
			textless,
			fautives,
			couverturePct: Number(couverture.toFixed(2)),
			similaritePct: Number(precision.toFixed(2)),
		},
		null,
		2
	)
);
if (missing || textless || fautives) process.exitCode = 1;
