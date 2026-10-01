import { describe, expect, it } from "bun:test";
import { scrapeWithAphrody } from "./aphrody-web-scrape.ts";

describe("Aphrody Web HTML capture", () => {
	it("uses Aphrody Web's local listener on the private VPS", async () => {
		let pathname = "";
		await scrapeWithAphrody("https://example.org/", {
			baseUrl: "http://127.0.0.1:3007",
			token: "fixture-token",
			fetcher: async (input) => {
				pathname = new URL(String(input)).pathname;
				return Response.json({ url: "https://example.org/", status: 200, title: "Example", content: "<main>Example</main>" });
			},
		});
		expect(pathname).toBe("/api/v1/scrape");
	});

	it("sends the source URL to the authenticated Aphrody gateway", async () => {
		let request: Request | undefined;
		const page = await scrapeWithAphrody("https://www.kanzenshuu.com/databook/", {
			baseUrl: "http://127.0.0.1:8788",
			token: "fixture-token",
			fetcher: async (input, init) => {
				request = new Request(input, init);
				return Response.json({ url: "https://www.kanzenshuu.com/databook/", status: 200, title: "Guide", content: "<main>Guide</main>" });
			},
		});
		expect(page.content).toBe("<main>Guide</main>");
		expect(request?.url).toBe("http://127.0.0.1:8788/api/v1/web/scrape");
		expect(request?.headers.get("authorization")).toBe("Bearer fixture-token");
		expect(await request?.json()).toEqual({ url: "https://www.kanzenshuu.com/databook/", profile: "static" });
	});

	it("rejects failed source pages even when the gateway replies 200", async () => {
		await expect(scrapeWithAphrody("https://example.org/", {
			token: "fixture-token",
			fetcher: async () => Response.json({ url: "https://example.org/", status: 503, title: "", content: "challenge" }),
		})).rejects.toThrow("page HTTP 503");
	});

	it("requires credentials without exposing them in errors", async () => {
		await expect(scrapeWithAphrody("https://example.org/", { token: "" })).rejects.toThrow("APHRODY_BXC_API_TOKEN");
	});
});
