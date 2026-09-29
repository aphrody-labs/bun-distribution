#!/usr/bin/env bun
/**
 * Optimise les backgrounds pour usage canvas : resize max 1600×900, WebP q=82.
 * Cibles ≈ 100-250 KB par image (vs 500 KB - 7 MB en source).
 *
 * Utilise @napi-rs/canvas (déjà en dep) pour load + resize + encode WebP.
 *
 * Usage : bun scripts/optimize-backgrounds.ts
 */

import { Glob } from "bun";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const MAX_W = 1600;
const MAX_H = 900;
const QUALITY = 82;

const glob = new Glob("assets/backgrounds/**/*.{jpg,jpeg,png}");
const files: string[] = [];
for await (const f of glob.scan(".")) files.push(f);

console.log(`→ ${files.length} fichier(s) à optimiser\n`);

let totalIn = 0;
let totalOut = 0;

for (const src of files) {
	const srcSize = (await Bun.file(src).bytes()).length;
	totalIn += srcSize;
	try {
		const img = await loadImage(src);
		// Calcul du ratio pour tenir dans MAX_W × MAX_H sans distorsion
		const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
		const w = Math.round(img.width * scale);
		const h = Math.round(img.height * scale);

		const canvas = createCanvas(w, h);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0, w, h);

		const webp = await canvas.encode("webp", QUALITY);
		const dst = src.replace(/\.(jpg|jpeg|png)$/, ".webp");
		await Bun.write(dst, webp);
		totalOut += webp.length;

		const ratio = ((1 - webp.length / srcSize) * 100).toFixed(0);
		console.log(
			`  \x1b[32m✓\x1b[0m ${dst.padEnd(60)} ${(srcSize / 1024).toFixed(0).padStart(5)} KB → ${(webp.length / 1024).toFixed(0).padStart(4)} KB  \x1b[2m(-${ratio}%)\x1b[0m`
		);

		// Supprime l'original
		if (dst !== src) await Bun.file(src).delete();
	} catch (err) {
		console.error(`  \x1b[31m✗\x1b[0m ${src} — ${err}`);
	}
}

const totalInMB = (totalIn / 1024 / 1024).toFixed(1);
const totalOutMB = (totalOut / 1024 / 1024).toFixed(1);
const savedPct = ((1 - totalOut / totalIn) * 100).toFixed(0);
console.log(`\n→ ${totalInMB} MB → \x1b[1m${totalOutMB} MB\x1b[0m (-${savedPct}%)`);
