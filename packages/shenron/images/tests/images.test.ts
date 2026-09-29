import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
	bestVariant,
	coversResolution,
	dbPathToDisk,
	dbPathToUrlPath,
	dHash,
	diskToDbPath,
	hammingDistance,
	hashBuffer,
	hashFile,
	provePixelEquality,
	psnr,
	selectionnerIllustration,
	toWebp,
	type IllustrationCandidate,
} from "../src/index";

const dir = mkdtempSync(join(tmpdir(), "shenron-images-"));

/** Tiny deterministic gradient fixture (no binary file committed). */
async function fixture(width: number, height: number, format: "png" | "jpeg" = "png") {
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			raw[i] = Math.floor((255 * x) / width);
			raw[i + 1] = Math.floor((255 * y) / height);
			raw[i + 2] = 128;
		}
	const img = sharp(raw, { raw: { width, height, channels: 3 } });
	return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

describe("hashes", () => {
	test("hashFile matches hashBuffer and is stable", async () => {
		const buf = await fixture(16, 16);
		const p = join(dir, "a.png");
		writeFileSync(p, buf);
		expect(await hashFile(p)).toBe(hashBuffer(buf));
		expect(await hashFile(p)).toHaveLength(64);
	});

	test("dHash is resolution-invariant and distinguishes different pictures", async () => {
		const small = await fixture(32, 24);
		const big = await fixture(320, 240);
		const hs = await dHash(small);
		const hb = await dHash(big);
		expect(hs).toHaveLength(16);
		expect(hammingDistance(hs, hb)).toBeLessThanOrEqual(6);
		// Flipped gradient = a different picture.
		const flipped = await sharp(big).flop().png().toBuffer();
		expect(hammingDistance(hb, await dHash(flipped))).toBeGreaterThan(20);
	});

	test("hammingDistance", () => {
		expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
		expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
		expect(hammingDistance("00000000000000ff", "0000000000000000")).toBe(8);
	});
});

describe("variants", () => {
	test("bestVariant prefers resolution, then format, then bytes", () => {
		const v = bestVariant([
			{ path: "a.jpg", width: 200, height: 200, bytes: 10 },
			{ path: "b.png", width: 400, height: 400, bytes: 5 },
			{ path: "c.webp", width: 400, height: 400, bytes: 50 },
		]);
		expect(v?.path).toBe("b.png");
		expect(bestVariant([])).toBeNull();
		expect(bestVariant([{ path: "only.gif" }])?.path).toBe("only.gif");
	});
	test("coversResolution", () => {
		expect(coversResolution({ path: "a", width: 400, height: 300 }, { path: "b", width: 400, height: 200 })).toBe(true);
		expect(coversResolution({ path: "a", width: 300, height: 300 }, { path: "b", width: 400, height: 200 })).toBe(false);
	});
});

describe("resolve", () => {
	const roots = { bot: "/r/apps/shenron/bot", site: "/r/apps/shenron/site" };
	test("db path → disk and back", () => {
		expect(dbPathToDisk("./assets/wiki/characters/x.png", roots)).toBe("/r/apps/shenron/site/public/wiki/characters/x.png");
		expect(dbPathToDisk("assets/wiki/characters/x.png", roots)).toBe("/r/apps/shenron/site/public/wiki/characters/x.png");
		expect(dbPathToDisk("./assets/dbz/xv2-portraits/GOK.png", roots)).toBe("/r/apps/shenron/bot/assets/dbz/xv2-portraits/GOK.png");
		expect(dbPathToDisk("db/toei/a.jpg", roots)).toBe("/r/apps/shenron/bot/public/db/toei/a.jpg");
		expect(dbPathToDisk("https://x/y.png", roots)).toBeNull();
		expect(dbPathToDisk("./etc/passwd", roots)).toBeNull();
		expect(diskToDbPath("/r/apps/shenron/site/public/wiki/sagas/s.jpg", roots)).toBe("./assets/wiki/sagas/s.jpg");
		expect(diskToDbPath("/r/apps/shenron/bot/assets/manga/DBS/ch1/001.webp", roots)).toBe("./assets/manga/DBS/ch1/001.webp");
		expect(diskToDbPath("/r/apps/shenron/bot/public/db/toei/a.jpg", roots)).toBe("db/toei/a.jpg");
		expect(diskToDbPath("/elsewhere/a.jpg", roots)).toBeNull();
		// Dead root: not served by the bot.
		expect(diskToDbPath("/r/apps/shenron/bot/assets/wiki/characters/x.jpg", roots)).toBeNull();
	});
	test("url path", () => {
		expect(dbPathToUrlPath("./assets/dbz/a b.png")).toBe("/assets/dbz/a%20b.png");
		expect(dbPathToUrlPath("db/dbofficial/310-サムネイル.jpg")).toBe("/db/dbofficial/310-%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB.jpg");
	});
});

describe("pixels", () => {
	test("re-encoded PNG is proven equal, palettised copy is not", async () => {
		const a = await fixture(24, 24);
		const b = await sharp(a).png({ compressionLevel: 9 }).toBuffer();
		expect((await provePixelEquality(a, b)).equal).toBe(true);
		const palette = await sharp(a).png({ palette: true, colours: 8 }).toBuffer();
		const r = await provePixelEquality(a, palette);
		expect(r.equal).toBe(false);
		expect(r.differingPixels).toBeGreaterThan(0);
		const smaller = await sharp(a).resize(12, 12).png().toBuffer();
		expect((await provePixelEquality(a, smaller)).reason).toMatch(/dimensions differ/);
		expect(await psnr(a, b)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("webp", () => {
	test("toWebp proves non-regression (psnr, size, maxWidth)", async () => {
		const src = await fixture(600, 400);
		const ok = await toWebp(src, { quality: 85, maxWidth: 300 });
		expect(ok.ok).toBe(true);
		expect(ok.width).toBe(300);
		expect(ok.psnr).toBeGreaterThanOrEqual(38);
		expect(ok.outputBytes!).toBeLessThan(ok.inputBytes);
		const bad = await toWebp(src, { quality: 1, minPsnr: 60 });
		expect(bad.ok).toBe(false);
		expect(bad.reason).toMatch(/psnr/);
	});
});

describe("selectionnerIllustration", () => {
	const entity = { type: "character", id: 1, name: "Son Goku", nameJa: "孫悟空" };
	const c = (p: Partial<IllustrationCandidate>): IllustrationCandidate => ({
		path: "x",
		source: "xv2",
		provenance: "",
		confidence: 1,
		width: 512,
		height: 512,
		...p,
	});
	test("returns null without candidates or providers", async () => {
		expect(await selectionnerIllustration({ entite: entity, sources: ["xv2"], providers: {} })).toBeNull();
		expect(
			await selectionnerIllustration({ entite: entity, sources: ["xv2"], providers: { xv2: async () => [] } })
		).toBeNull();
	});
	test("rejects low resolution and low confidence, keeps best across sources", async () => {
		const r = await selectionnerIllustration({
			entite: entity,
			sources: ["xv2", "databook", "manga"],
			providers: {
				xv2: async () => [c({ path: "small.png", width: 200, height: 200 })],
				databook: async () => [
					c({ path: "p1-lo.jpg", source: "databook", ref: "p1", width: 500, height: 700, confidence: 0.9 }),
					c({ path: "p1-hi.jpg", source: "databook", ref: "p1", width: 1500, height: 2100, confidence: 0.9 }),
					c({ path: "p2.jpg", source: "databook", ref: "p2", width: 1500, height: 2100, confidence: 0.3 }),
				],
				manga: async () => [c({ path: "m.webp", source: "manga", width: 1200, height: 1800, confidence: 1 })],
			},
		});
		expect(r?.path).toBe("p1-hi.jpg");
		expect(r?.source).toBe("databook");
		expect(r?.score).toBeGreaterThan(0);
	});
});
