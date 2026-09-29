#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
/**
 * Exporte Dragon Ball et Dragon Ball Super en lots OCR immuables et vérifiables.
 *
 * Par défaut, seules les planches absentes de `db_manga_pages` sont exportées.
 * Chaque run est adressé par le SHA-256 du corpus et de ses paramètres : une
 * reprise ne peut donc jamais mélanger deux générations de lots différentes.
 *
 * Usage :
 *   bun scripts/export-manga-ocr.ts --sortie ../../data/manga-ocr
 *   bun scripts/export-manga-ocr.ts --series DB,DBS --taille 100 --plan
 *   bun scripts/export-manga-ocr.ts --id DB:vol1:3 --id DBS:ch1315:1
 *   bun scripts/export-manga-ocr.ts --tout --force
 */
import { Glob } from "bun";
import sharp from "sharp";
import {
	atomicWriteJson,
	identifyMangaAsset,
	MANGA_MANIFEST_SCHEMA_VERSION,
	MANGA_SERIES,
	type MangaManifestEntry,
	type MangaOcrManifest,
	type MangaSeries,
	mangaPageId,
	readMangaManifest,
	sha256File,
} from "../src/manga-ocr";

const args = Bun.argv.slice(2);
const option = (name: string, fallback?: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const options = (name: string): string[] =>
	args.flatMap((value, index) => {
		const next = args[index + 1];
		return value === `--${name}` && next ? [next] : [];
	});
const flag = (name: string): boolean => args.includes(`--${name}`);
const positiveInteger = (name: string, fallback: number, min: number, max: number): number => {
	const value = Number(option(name, String(fallback)));
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`--${name} doit être un entier entre ${min} et ${max}`);
	}
	return value;
};

const BOT_ROOT = join(import.meta.dir, "..");
const MANGA_ROOT = join(BOT_ROOT, "assets", "manga");
const DATABASE = option("database") ?? join(BOT_ROOT, "data", "bot.db");
const OUTPUT_ROOT = option("sortie") ?? join(BOT_ROOT, "..", "..", "data", "manga-ocr");
const LOT_SIZE = positiveInteger("taille", 100, 1, 1_000);
const WIDTH = positiveInteger("largeur", 1800, 800, 4_000);
const QUALITY = positiveInteger("qualite", 86, 40, 100);
const CONCURRENCY = positiveInteger("concurrence", 4, 1, 16);
const ALL = flag("tout");
const FORCE = flag("force");
const PLAN = flag("plan");
/**
 * Les identités ciblées, par `--id` répété ou par `--ids-fichier`.
 *
 * Une campagne de reprise en porte plus d'un millier (cf.
 * `apps/shenron/site/scripts/planches-manga-a-relire.ts --ids`) : autant d'arguments
 * dépasseraient la limite de ligne de commande de Windows. Le fichier attend
 * une identité par ligne, au format `DB:vol12:7`, et tolère les commentaires
 * `#` ainsi que les lignes vides.
 */
const idsDuFichier = (chemin: string | undefined): string[] => {
	if (!chemin) return [];
	const brut = readFileSync(chemin, "utf8");
	return brut
		.split(/\r?\n/)
		.map((ligne) => ligne.trim())
		.filter((ligne) => ligne.length > 0 && !ligne.startsWith("#"));
};
const TARGET_IDS = new Set([...options("id"), ...idsDuFichier(option("ids-fichier"))]);
const requestedSeries = (option("series", "DB,DBS") ?? "")
	.split(",")
	.map((value) => value.trim().toUpperCase())
	.filter(Boolean);
if (
	requestedSeries.length === 0 ||
	requestedSeries.some((value) => !MANGA_SERIES.includes(value as MangaSeries))
) {
	throw new Error("--series accepte uniquement DB, DBS ou DB,DBS");
}
const SERIES = [...new Set(requestedSeries)] as MangaSeries[];

async function mapPool<T, R>(
	items: T[],
	limit: number,
	callback: (item: T) => Promise<R>
): Promise<R[]> {
	const result: R[] = [];
	result.length = items.length;
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (cursor < items.length) {
				const index = cursor++;
				const item = items[index];
				if (item === undefined) throw new Error(`élément ${index} absent du pool`);
				result[index] = await callback(item);
			}
		})
	);
	return result;
}

function existingTranscriptions(): Set<string> {
	if (!existsSync(DATABASE)) return new Set();
	const database = new Database(DATABASE, { readonly: true });
	try {
		const table = database
			.query("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='db_manga_pages'")
			.get() as { ok: number } | null;
		if (!table) return new Set();
		return new Set(
			(
				database
					.query(
						"SELECT series, tome, planche FROM db_manga_pages WHERE text IS NOT NULL AND length(trim(text)) > 0"
					)
					.all() as { series: string; tome: string; planche: number }[]
			).map((row) => mangaPageId(row.series as MangaSeries, row.tome, Number(row.planche)))
		);
	} finally {
		database.close();
	}
}

const discovered: Array<ReturnType<typeof identifyMangaAsset> & { absolute: string }> = [];
for await (const relative of new Glob("**/*.webp").scan(MANGA_ROOT)) {
	const identity = identifyMangaAsset(relative);
	if (!identity || !SERIES.includes(identity.series)) continue;
	discovered.push({
		...identity,
		absolute: join(MANGA_ROOT, ...relative.split(/[\\/]/)),
	});
}
discovered.sort(
	(a, b) =>
		a.series.localeCompare(b.series) ||
		a.tome.localeCompare(b.tome, undefined, { numeric: true }) ||
		a.planche - b.planche ||
		a.source.localeCompare(b.source)
);
const duplicateIds = discovered
	.filter((entry, index) => index > 0 && discovered[index - 1]?.id === entry.id)
	.map((entry) => entry.id);
if (duplicateIds.length > 0) {
	throw new Error(
		`identités de planches dupliquées: ${[...new Set(duplicateIds)].slice(0, 10).join(", ")}`
	);
}

const completed = existingTranscriptions();
const selected =
	TARGET_IDS.size > 0
		? discovered.filter((entry) => TARGET_IDS.has(entry.id))
		: ALL
			? discovered
			: discovered.filter((entry) => !completed.has(entry.id));
const selection = TARGET_IDS.size > 0 ? "ids" : ALL ? "all" : "missing";
if (TARGET_IDS.size > 0 && selected.length !== TARGET_IDS.size) {
	const found = new Set(selected.map((entry) => entry.id));
	throw new Error(
		`identifiant(s) manga introuvable(s): ${[...TARGET_IDS].filter((id) => !found.has(id)).join(", ")}`
	);
}
console.log(
	`corpus manga: ${discovered.length} planches (${completed.size} transcrites dans le réplica) · ` +
		`${selected.length} sélectionnées [${SERIES.join("+")}, ${selection}]`
);
console.log(
	`lots: ${Math.ceil(selected.length / LOT_SIZE)} × ${LOT_SIZE} · sortie: ${OUTPUT_ROOT}`
);

if (selected.length === 0) {
	await mkdir(OUTPUT_ROOT, { recursive: true });
	await atomicWriteJson(join(OUTPUT_ROOT, "current.json"), {
		schemaVersion: MANGA_MANIFEST_SCHEMA_VERSION,
		status: "complete",
		selection,
		series: SERIES,
		pages: 0,
		generatedAt: new Date().toISOString(),
	});
	console.log("✓ aucune planche à exporter");
	process.exit(0);
}
if (PLAN) process.exit(0);

const sourceEntries = await mapPool(selected, CONCURRENCY, async (entry) => {
	const info = await stat(entry.absolute);
	return {
		...entry,
		sourceBytes: info.size,
		sourceSha256: await sha256File(entry.absolute),
	};
});
const fingerprintInput = sourceEntries
	.map((entry) => `${entry.id}\t${entry.source}\t${entry.sourceBytes}\t${entry.sourceSha256}`)
	.join("\n");
const corpusSha256 = new Bun.CryptoHasher("sha256")
	.update(`${selection}\n${SERIES.join(",")}\n${WIDTH}\n${QUALITY}\n${fingerprintInput}`)
	.digest("hex");
const runId = option("run-id") ?? `corpus-${corpusSha256.slice(0, 16)}`;
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) throw new Error("--run-id invalide");
const runRoot = join(OUTPUT_ROOT, "runs", runId);
const totalLots = Math.ceil(sourceEntries.length / LOT_SIZE);
const lotPointers: Array<{
	lot: number;
	manifest: string;
	pages: number;
	sha256: string;
}> = [];

for (let lot = 1; lot <= totalLots; lot++) {
	const lotRoot = join(runRoot, `lot-${String(lot).padStart(3, "0")}`);
	const imagesRoot = join(lotRoot, "images");
	const manifestPath = join(lotRoot, "manifest.json");
	await mkdir(imagesRoot, { recursive: true });
	const slice = sourceEntries.slice((lot - 1) * LOT_SIZE, lot * LOT_SIZE);

	if (!FORCE && existsSync(manifestPath)) {
		try {
			const manifest = await readMangaManifest(manifestPath);
			const allImagesPresent = manifest.entries.every((entry) =>
				existsSync(join(lotRoot, entry.image))
			);
			if (manifest.entries.length === slice.length && allImagesPresent) {
				const sha256 = await sha256File(manifestPath);
				lotPointers.push({
					lot,
					manifest: `lot-${String(lot).padStart(3, "0")}/manifest.json`,
					pages: slice.length,
					sha256,
				});
				console.log(`  ↷ lot ${lot}/${totalLots}: déjà complet`);
				continue;
			}
		} catch {
			// Un manifeste incomplet ou ancien est reconstruit sous le même corpus immuable.
		}
	}

	const entries = await mapPool(slice, CONCURRENCY, async (entry): Promise<MangaManifestEntry> => {
		const safeTome = entry.tome.replace(/[^a-zA-Z0-9_-]/g, "-");
		const imageName = `${entry.series}-${safeTome}-${String(entry.planche).padStart(4, "0")}-${entry.sourceSha256.slice(0, 12)}-w${WIDTH}q${QUALITY}.jpg`;
		const imagePath = join(imagesRoot, imageName);
		if (FORCE || !existsSync(imagePath)) {
			const temporary = `${imagePath}.${process.pid}.tmp.jpg`;
			await sharp(entry.absolute)
				.rotate()
				.resize({ width: WIDTH, withoutEnlargement: true })
				.jpeg({ quality: QUALITY, mozjpeg: true })
				.toFile(temporary);
			await Bun.file(temporary).exists();
			await import("node:fs/promises").then(({ rename }) => rename(temporary, imagePath));
		}
		const imageInfo = await stat(imagePath);
		return {
			id: entry.id,
			series: entry.series,
			collection: entry.collection,
			tome: entry.tome,
			planche: entry.planche,
			source: entry.source,
			sourceSha256: entry.sourceSha256,
			sourceBytes: entry.sourceBytes,
			image: `images/${imageName}`,
			imageSha256: await sha256File(imagePath),
			imageBytes: imageInfo.size,
			alreadyTranscribed: completed.has(entry.id),
		};
	});

	const manifest: MangaOcrManifest = {
		schemaVersion: MANGA_MANIFEST_SCHEMA_VERSION,
		lot,
		lots: totalLots,
		generatedAt: new Date().toISOString(),
		generator: "apps/shenron/bot/scripts/export-manga-ocr.ts",
		selection,
		series: SERIES,
		imagePipeline: { width: WIDTH, quality: QUALITY, format: "jpeg" },
		entries,
		responseExpected: {
			format: "aphrody-ocr-jsonl",
			result: {
				image: "images/DB-vol1-0001-….jpg",
				text: { kind: "text", markdown: "…" },
			},
		},
	};
	await atomicWriteJson(manifestPath, manifest);
	const sha256 = await sha256File(manifestPath);
	lotPointers.push({
		lot,
		manifest: `lot-${String(lot).padStart(3, "0")}/manifest.json`,
		pages: entries.length,
		sha256,
	});
	console.log(`  ✓ lot ${lot}/${totalLots}: ${entries.length} planches`);
}

const corpusManifest = {
	schemaVersion: MANGA_MANIFEST_SCHEMA_VERSION,
	runId,
	generatedAt: new Date().toISOString(),
	generator: "apps/shenron/bot/scripts/export-manga-ocr.ts",
	selection,
	series: SERIES,
	corpusSha256,
	pages: sourceEntries.length,
	lots: totalLots,
	imagePipeline: { width: WIDTH, quality: QUALITY, format: "jpeg" },
	manifests: lotPointers,
};
await atomicWriteJson(join(runRoot, "corpus-manifest.json"), corpusManifest);
await mkdir(OUTPUT_ROOT, { recursive: true });
await atomicWriteJson(join(OUTPUT_ROOT, "current.json"), {
	schemaVersion: MANGA_MANIFEST_SCHEMA_VERSION,
	runId,
	corpusSha256,
	manifest: `runs/${runId}/corpus-manifest.json`,
	pages: sourceEntries.length,
	lots: totalLots,
	generatedAt: corpusManifest.generatedAt,
});
console.log(`✓ ${sourceEntries.length} planches exportées · run ${runId} · sha256 ${corpusSha256}`);
