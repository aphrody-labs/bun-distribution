/**
 * Produit un manifeste de contrôle par lot sans modifier manifeste.json.
 * Les sorties sont manifeste.ocr.json et décrivent les entrées réellement
 * présentes sur disque ainsi que les résultats JSONL déjà produits.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type Entry = {
	databookId: number;
	page: number;
	titre?: string;
	kind?: string;
	categorie?: string;
	image: string;
};

const root = process.argv[2] ?? "data/sj-ocr";
const lots = (await readdir(root, { withFileTypes: true }))
	.filter((x) => x.isDirectory() && /^lot-\d+$/.test(x.name))
	.map((x) => x.name)
	.toSorted();

const profile = (kind: string | undefined, category: string | undefined) => ({
	kind: kind ?? "unknown",
	category: category ?? "unknown",
	ocrPreset: "databooks",
	readingOrder: "ja-vertical-right-to-left",
	keepJapanese: true,
});

let totalImages = 0;
let totalExpected = 0;
let totalResults = 0;

for (const lot of lots) {
	const dir = join(root, lot);
	const source = JSON.parse(await readFile(join(dir, "manifeste.json"), "utf8")) as {
		lot: number;
		lots: number;
		planches: number;
		entrees: Entry[];
	};
	const imageDir = join(dir, "images");
	const files = (await readdir(imageDir)).filter((x) => /\.(?:jpe?g|png|webp)$/i.test(x)).toSorted();
	const expected = source.entrees.map((entry) => entry.image.split("/").at(-1) ?? entry.image);
	const existing = await readFile(join(dir, "resultats.jsonl"), "utf8").catch(() => "");
	const resultImages = existing
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return (JSON.parse(line) as { image?: string }).image ?? null;
			} catch {
				return null;
			}
		})
		.filter((x): x is string => Boolean(x));
	const first = source.entrees[0];
	const missing = expected.filter((name) => !files.includes(name));
	const pending = expected.filter((name) => !resultImages.includes(name));
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		lot: source.lot,
		lots: source.lots,
		sourceManifest: "manifeste.json",
		profile: profile(first?.kind, first?.categorie),
		counts: {
			expected: expected.length,
			imagesOnDisk: files.length,
			resultsJsonl: resultImages.length,
			pending: pending.length,
			missingImages: missing.length,
		},
		entries: source.entrees.map((entry) => ({
			databookId: entry.databookId,
			page: entry.page,
			titre: entry.titre ?? null,
			kind: entry.kind ?? null,
			categorie: entry.categorie ?? null,
			image: entry.image,
			localImage: join("images", entry.image.split("/").at(-1) ?? entry.image),
			present: files.includes(entry.image.split("/").at(-1) ?? entry.image),
			resultPresent: resultImages.includes(entry.image.split("/").at(-1) ?? entry.image),
		})),
	};
	await Bun.write(join(dir, "manifeste.ocr.json"), `${JSON.stringify(output, null, "\t")}\n`);
	totalImages += files.length;
	totalExpected += expected.length;
	totalResults += resultImages.length;
	console.log(
		`${lot}: ${files.length}/${expected.length} images · ${resultImages.length} résultats · ${profile(first?.kind, first?.categorie).category}`
	);
}

console.log(
	`TOTAL: ${lots.length} lots · ${totalImages}/${totalExpected} images · ${totalResults} résultats`
);
