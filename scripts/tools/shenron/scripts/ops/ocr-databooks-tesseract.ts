#!/usr/bin/env bun
/**
 * Compatibility entry point for Japanese databook OCR through Aphrody AI.
 * Keeps the legacy resultats.jsonl for editorial verification and stores the
 * complete Aphrody OCR v2 evidence beside it. Existing results are preserved.
 */
import { appendFile, readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
	legacyAuditProjection,
	recogniseRemotePage,
	toOcrResultV2,
} from "@shenron/pipeline/aphrody/remote-ocr";

const root = resolve(process.argv[2] ?? "data/databooks-ocr");
const concurrency = Number(process.argv[3] ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
	throw new Error("OCR concurrency must be an integer from 1 to 16");
}
const requestedBooks = new Set(
	(process.argv[4] ?? "").split(",").map((value) => value.trim()).filter(Boolean),
);

async function existingRows(path: string): Promise<Map<string, string>> {
	const rows = new Map<string, string>();
	const content = await Bun.file(path).text().catch(() => "");
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as { image?: unknown };
		if (typeof record.image !== "string" || !record.image) throw new Error(`Invalid OCR result in ${path}`);
		const name = basename(record.image);
		if (rows.has(name)) throw new Error(`Duplicate OCR result for ${name} in ${path}`);
		rows.set(name, line);
	}
	return rows;
}

async function runLot(lot: string): Promise<number> {
	const lotDir = join(root, lot);
	const imageDir = join(lotDir, "images");
	const legacyPath = join(lotDir, "resultats.jsonl");
	const evidencePath = join(lotDir, "aphrody-resultats-v2.jsonl");
	const images = (await readdir(imageDir))
		.filter((name) => [".jpg", ".jpeg", ".png", ".webp"].includes(extname(name).toLowerCase()))
		.filter((name) => requestedBooks.size === 0 || requestedBooks.has(name.split("-")[0]!))
		.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	const completed = await existingRows(legacyPath);
	const evidence = new Map<string, string>();
	const saved = await Bun.file(evidencePath).text().catch(() => "");
	for (const line of saved.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as { schema?: string; image?: { path?: string; sha256?: string } };
		if (record.schema !== "aphrody.ocr.result/v2" || !record.image?.path || !record.image.sha256) {
			throw new Error(`Invalid Aphrody OCR evidence in ${evidencePath}`);
		}
		const name = basename(record.image.path);
		if (evidence.has(name)) throw new Error(`Duplicate Aphrody OCR evidence for ${name}`);
		evidence.set(name, line);
	}
	let cursor = 0;
	let done = 0;
	let added = 0;
	let writeQueue = Promise.resolve();
	const persist = (path: string, line: string) => {
		const pending = writeQueue.then(() => appendFile(path, `${line}\n`, "utf8"));
		writeQueue = pending;
		return pending;
	};
	async function worker(): Promise<void> {
		while (cursor < images.length) {
			const image = images[cursor++]!;
			if (completed.has(image)) {
				done++;
				continue;
			}
			const path = resolve(join(imageDir, image));
			const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
			let v2 = evidence.get(image);
			if (v2) {
				const record = JSON.parse(v2) as { image: { sha256: string } };
				const currentHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
				if (record.image.sha256 !== currentHash) throw new Error(`Image changed since OCR: ${path}`);
			} else {
				const result = await recogniseRemotePage(bytes);
				if (result.suspect) throw new Error(`Aphrody requires visual review for ${path}`);
				v2 = JSON.stringify(toOcrResultV2(path, bytes, result));
				await persist(evidencePath, v2);
				evidence.set(image, v2);
			}
			const projected = JSON.parse(legacyAuditProjection(`${v2}\n`).jsonl) as { image: string; text: unknown };
			await persist(legacyPath, JSON.stringify({ ...projected, image }));
			completed.set(image, v2);
			added++;
			done++;
			if (done % 50 === 0 || done === images.length) console.log(`${lot}: ${done}/${images.length}`);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
	await writeQueue;
	return added;
}

const lots = (await readdir(root, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory() && /^lot-\d+$/.test(entry.name))
	.map((entry) => entry.name)
	.toSorted();
let added = 0;
for (const lot of lots) added += await runLot(lot);
console.log(`OCR Aphrody terminé : ${added} nouvelle(s) planche(s), ${lots.length} lot(s).`);
