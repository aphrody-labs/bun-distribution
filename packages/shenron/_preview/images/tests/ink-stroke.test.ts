import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { measureInkStroke } from "../src/ink-stroke";

const dir = mkdtempSync(join(tmpdir(), "ink-stroke-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Verbatim copy of the former AphrodyNativeBridge.measureInkStroke body (reference). */
async function legacyMeasure(imagePath: string) {
	const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;
	const C = info.channels;
	const strokeWidths: number[] = [];
	const stepY = Math.max(1, Math.floor(H / 60));
	for (let y = stepY; y < H; y += stepY) {
		let inStroke = false;
		let len = 0;
		for (let x = 0; x < W; x++) {
			const idx = (y * W + x) * C;
			const lum = 0.2126 * data[idx]! + 0.7152 * data[idx + 1]! + 0.0722 * data[idx + 2]!;
			if (lum < 60) {
				inStroke = true;
				len++;
			} else {
				if (inStroke && len >= 1 && len < W * 0.1) strokeWidths.push(len);
				inStroke = false;
				len = 0;
			}
		}
	}
	strokeWidths.sort((a, b) => a - b);
	return {
		width: W,
		height: H,
		medianStrokePx: strokeWidths[Math.floor(strokeWidths.length / 2)] || 0,
		sampleCount: strokeWidths.length,
	};
}

/** White page with vertical black strokes of widths 2, 3, 3, 5 px (RGBA PNG). */
async function fixture(alpha: boolean): Promise<string> {
	const W = 200;
	const H = 120;
	const channels = alpha ? 4 : 3;
	const raw = Buffer.alloc(W * H * channels, 255);
	const strokes: Array<[number, number]> = [[20, 2], [60, 3], [100, 3], [150, 5]];
	for (let y = 0; y < H; y++) {
		for (const [x0, w] of strokes) {
			for (let x = x0; x < x0 + w; x++) {
				const i = (y * W + x) * channels;
				raw[i] = 0;
				raw[i + 1] = 0;
				raw[i + 2] = 0;
			}
		}
	}
	const file = join(dir, alpha ? "page-rgba.png" : "page-rgb.png");
	await sharp(raw, { raw: { width: W, height: H, channels } }).png().toFile(file);
	return file;
}

describe("measureInkStroke", () => {
	for (const alpha of [false, true]) {
		test(`matches the legacy implementation (${alpha ? "RGBA" : "RGB"})`, async () => {
			const file = await fixture(alpha);
			const got = await measureInkStroke(file);
			expect(got).toEqual(await legacyMeasure(file));
			// stepY = 2 → rows 2..118 = 59 rows × 4 strokes; sorted median = 3 px.
			expect(got).toEqual({ width: 200, height: 120, medianStrokePx: 3, sampleCount: 236 });
		});
	}

	test("accepts an encoded buffer and returns 0 on a blank page", async () => {
		const blank = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#ffffff" } })
			.png()
			.toBuffer();
		expect(await measureInkStroke(blank)).toEqual({ width: 50, height: 50, medianStrokePx: 0, sampleCount: 0 });
	});
});
