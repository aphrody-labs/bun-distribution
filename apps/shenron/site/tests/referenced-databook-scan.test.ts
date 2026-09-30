import { describe, expect, test } from "bun:test";
import {
	parseReferencedDatabookScan,
	referencedScanBasename,
} from "../src/lib/referenced-databook-scan";

describe("referenced databook scans", () => {
	test("accepts an exact referenced HTTPS scan", () => {
		const raw = "https://comic.dragonballcn.com/list/9.11.zongji/01/001-USMMv.jpg";
		expect(parseReferencedDatabookScan(raw)?.href).toBe(raw);
		expect(referencedScanBasename(raw)).toBe("001-USMMv.jpg");
	});

	test.each([
		"https://evil.example/list/book/001.jpg",
		"https://comic.dragonballcn.com/other/001.jpg",
		"https://comic.dragonballcn.com/list/book/001.svg",
		"https://user:pass@comic.dragonballcn.com/list/book/001.jpg",
	])("rejects an unsafe source: %s", (raw) => {
		expect(parseReferencedDatabookScan(raw)).toBeNull();
	});

	test("accepts the public HTTP form of a DragonballCN scan", () => {
		const raw = "http://comic.dragonballcn.com/list/book/001.jpg";
		expect(parseReferencedDatabookScan(raw)?.href).toBe(raw);
	});
});
