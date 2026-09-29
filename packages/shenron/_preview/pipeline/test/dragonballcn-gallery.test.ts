// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { parseGalleryListing, parseGalleryPages } from "../src/dragonballcn-gallery";

const html = `<html><head><title>Vol 1 - 龙珠中文网</title></head><body>
<img src="/list//db/v01/_thumb.001.jpg"><img src="/list/db/v01/_thumb.002.jpg">
<img src="/list/db/v01/_thumb.001.jpg"></body></html>`;

describe("dragonballcn gallery parser", () => {
	test("listing dedups files and keeps the first directory", () => {
		expect(parseGalleryListing(html)).toEqual({ title: "Vol 1", directory: "db/v01", files: ["001.jpg", "002.jpg"] });
	});

	test("pages carry thumb, image and viewer URLs", () => {
		const r = parseGalleryPages(html, "a b", "https://x");
		expect(r.totalPages).toBe(2);
		expect(r.pages[1]).toEqual({
			pageNumber: 2,
			name: "002.jpg",
			thumbUrl: "https://x/list/db/v01/_thumb.002.jpg",
			imageUrl: "https://x/list/db/v01/002.jpg",
			pageUrl: "https://x/list/gain_1.php?did=a%20b#page_2",
		});
	});

	test("missing title and plates", () => {
		expect(parseGalleryListing("<p></p>")).toEqual({ title: null, files: [] });
	});
});
