import { describe, expect, test } from "bun:test";
import { isPublicDatabookImage, publicDatabookImage } from "../src/lib/databook-media";

describe("public databook media", () => {
	test("accepts public dragonballcn reader references", () => {
		const page =
			"https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/9.11.zongji/01/195-nJmh3.jpg";
		expect(isPublicDatabookImage(page)).toBe(true);
		expect(publicDatabookImage(page)).toBe(page);
	});

	test("accepts the http form of the public reader", () => {
		expect(publicDatabookImage("http://comic.dragonballcn.com/list/book/001.jpg")).toBe(
			"http://comic.dragonballcn.com/list/book/001.jpg"
		);
	});

	test("keeps local assets and unrelated remote images", () => {
		expect(publicDatabookImage(" ./assets/wiki/databooks/page.jpg ")).toBe(
			"./assets/wiki/databooks/page.jpg"
		);
		expect(publicDatabookImage("/wiki/databooks/page.webp")).toBe("/wiki/databooks/page.webp");
		expect(publicDatabookImage("https://comic.dragonballcn.com/images/cover/book.gif")).toBe(
			"https://comic.dragonballcn.com/images/cover/book.gif"
		);
		expect(publicDatabookImage("https://images.example.com/book.webp")).toBe(
			"https://images.example.com/book.webp"
		);
	});

	test("rejects empty values", () => {
		expect(isPublicDatabookImage(null)).toBe(false);
		expect(publicDatabookImage(undefined)).toBeNull();
		expect(publicDatabookImage("   ")).toBeNull();
	});

	test("rejects malformed or unsafe absolute references", () => {
		expect(publicDatabookImage("https://")).toBeNull();
		expect(publicDatabookImage("javascript:alert(1)")).toBeNull();
		expect(publicDatabookImage("//comic.dragonballcn.com/list/book/001.jpg")).toBeNull();
	});
});
