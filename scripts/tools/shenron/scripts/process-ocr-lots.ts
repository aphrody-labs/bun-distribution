import { homePath } from "@aphrody/paths";
import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { recogniseRemotePage, toOcrResultV2 } from "@shenron/pipeline/aphrody/remote-ocr";

const LOTS_DIR = process.env.SHENRON_OCR_LOTS_DIR ?? homePath("ocr-lots");
const lots = ["lot-001", "lot-003"];

for (const lot of lots) {
	const dir = join(LOTS_DIR, lot);
	const imgDir = join(dir, "images");
	const manifestPath = join(dir, "manifeste.json");
	const resPath = join(dir, "resultats.jsonl");

	if (!existsSync(manifestPath)) continue;
	console.log(`=== Traitement OCR ${lot} ===`);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const entries = (manifest.entrees || []) as Array<{ image: string }>;

	const done = new Set<string>();
	if (existsSync(resPath)) {
		const lines = (await readFile(resPath, "utf8")).split("\n");
		for (const l of lines) {
			if (!l.trim()) continue;
			try {
				const item = JSON.parse(l);
				if (item.image) done.add(basename(item.image));
			} catch {}
		}
	}

	console.log(`${entries.length} entrées au total, ${done.size} déjà traitées.`);
	let count = 0;
	const aTraiter = entries.filter((e) => !done.has(basename(e.image)));

	for (const entry of aTraiter) {
		const imgName = basename(entry.image);
		const imgFile = join(imgDir, imgName);
		if (!existsSync(imgFile)) {
			console.warn(`Image manquante: ${imgFile}`);
			continue;
		}

		const bytes = new Uint8Array(await Bun.file(imgFile).arrayBuffer());
		const result = await recogniseRemotePage(bytes);
		if (result.suspect) throw new Error(`Aphrody requires visual review for ${imgFile}`);
		const textOut = result.text.trim();
		const elapsed = result.elapsed_ms;

		let textPayload: { kind: "text"; markdown: string } | { kind: "none" } = { kind: "none" };
		if (textOut.length >= 10) {
			textPayload = { kind: "text", markdown: textOut };
		}

		const record = {
			image: entry.image,
			text: textPayload,
			elapsed_ms: elapsed,
			aphrody: toOcrResultV2(imgFile, bytes, result),
		};

		await appendFile(resPath, `${JSON.stringify(record)}\n`, "utf8");
		done.add(imgName);
		count++;
		if (count % 20 === 0 || count === aTraiter.length) {
			console.log(`[${lot}] ${count} / ${aTraiter.length} planches traitées (${elapsed}ms dernière)`);
		}
	}

	console.log(`✓ Fin OCR pour ${lot}. Total traité: ${count}`);
}

