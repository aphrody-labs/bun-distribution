#!/usr/bin/env bun
/**
 * optimize-jpeg-batch — sharp en parallèle pour batch JPEG (re-encode mozjpeg q=82).
 * Beaucoup plus rapide que `bunx sharp-cli` par fichier (init coût ~500ms).
 *
 * Usage: bun run scripts/optimize-jpeg-batch.ts apps/bot/public/db
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import sharp from "sharp";

const ROOT = process.argv[2] ?? "apps/bot/public/db";
const CONCURRENCY = parseInt(Bun.env.JOBS ?? "8", 10);

function* walk(dir: string): Generator<string> {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		const s = statSync(p);
		if (s.isDirectory()) yield* walk(p);
		else if (/\.(jpe?g)$/i.test(p)) yield p;
	}
}

let saved = 0,
	totalBefore = 0,
	totalAfter = 0,
	processed = 0;
const pending: Promise<void>[] = [];
let active = 0;

async function processOne(f: string): Promise<void> {
	const before = statSync(f).size;
	totalBefore += before;
	try {
		const buf = readFileSync(f);
		const out = await sharp(buf, { failOn: "none" })
			.jpeg({ quality: 82, mozjpeg: true, progressive: true })
			.toBuffer();
		if (out.byteLength < before) {
			writeFileSync(f, out);
			saved += before - out.byteLength;
			totalAfter += out.byteLength;
		} else {
			totalAfter += before;
		}
		processed++;
	} catch (e) {
		console.error(`  err ${f}: ${e instanceof Error ? e.message : e}`);
		totalAfter += before;
	}
}

for (const f of walk(ROOT)) {
	while (active >= CONCURRENCY) {
		await Promise.race(pending);
		for (let i = pending.length - 1; i >= 0; i--) {
			const p = pending[i]!;
			// @ts-expect-error settled state
			if (p.__done) {
				pending.splice(i, 1);
				active--;
			}
		}
	}
	active++;
	const p = processOne(f).finally(() => {
		// @ts-expect-error mark
		p.__done = true;
	});
	pending.push(p);
}
await Promise.all(pending);

const pct = Math.round((100 * saved) / Math.max(totalBefore, 1));
console.log(`\nJPEG batch: ${processed} fichiers`);
console.log(`  Avant : ${(totalBefore / 1024 / 1024).toFixed(1)} MiB`);
console.log(`  Après : ${(totalAfter / 1024 / 1024).toFixed(1)} MiB`);
console.log(`  Économisé : ${(saved / 1024 / 1024).toFixed(1)} MiB (-${pct}%)`);
