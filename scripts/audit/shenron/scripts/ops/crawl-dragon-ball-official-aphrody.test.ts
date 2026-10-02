import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { discoverOfficialPages, runOfficialCrawl } from "../../../../tools/shenron/scripts/ops/crawl-dragon-ball-official-aphrody.ts";

const sitemap = '<sitemapindex><sitemap><loc>https://dragon-ball-official.com/news.xml</loc></sitemap></sitemapindex>';
const pages = '<urlset><url><loc>https://dragon-ball-official.com/news/2/</loc></url><url><loc>https://dragon-ball-official.com/news/1/</loc></url><url><loc>https://other.example/news/</loc></url></urlset>';
const capture = async (url: string) => url.endsWith("sitemap.xml") ? sitemap : pages;
let stateDir: string | undefined;

afterEach(async () => {
	if (!stateDir) return;
	const resolved = await realpath(stateDir);
	const temp = await realpath(tmpdir());
	if (!resolved.startsWith(temp + sep)) throw new Error("Test state escaped the temporary directory");
	await rm(resolved, { recursive: true });
	stateDir = undefined;
});

describe("official crawl migration", () => {
	it("discovers only official page URLs through Aphrody sitemap capture", async () => {
		expect(await discoverOfficialPages(capture)).toEqual([
			"https://dragon-ball-official.com/news/1/",
			"https://dragon-ball-official.com/news/2/",
		]);
	});

	it("dry-run plans all pages and apply resumes completed batches", async () => {
		stateDir = await mkdtemp(join(tmpdir(), "shenron-official-crawl-"));
		const calls: string[][] = [];
		const client = {
			crawl: async ({ urls }: { urls: string[] }) => {
				calls.push(urls);
				return { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "completed" as const, stats: {} };
			},
			status: async () => ({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "completed" as const, stats: {} }),
		};
		const planned = await runOfficialCrawl("dry-run", { capture, client, stateDir });
		expect(planned).toMatchObject({ discovered: 2, batches: 1, completedBatches: 0 });
		expect(calls).toHaveLength(0);
		const applied = await runOfficialCrawl("apply", { capture, client, stateDir, sleep: async () => {} });
		expect(applied).toMatchObject({ discovered: 2, batches: 1, completedBatches: 1 });
		await runOfficialCrawl("apply", { capture, client, stateDir, sleep: async () => {} });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual(["https://dragon-ball-official.com/news/1/", "https://dragon-ball-official.com/news/2/"]);
	});

	it("resumes an in-flight Aphrody job after the Shenron process restarts", async () => {
		stateDir = await mkdtemp(join(tmpdir(), "shenron-official-crawl-"));
		const planned = await runOfficialCrawl("dry-run", { capture, stateDir });
		const state = {
			schema: "shenron-official-aphrody-crawl/v1",
			campaignId: planned.campaignId,
			discovered: planned.discovered,
			completedBatches: [],
			jobs: [{ batch: 0, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "running" }],
			updatedAt: new Date().toISOString(),
		};
		await Bun.write(planned.stateFile!, JSON.stringify(state));
		let submitted = 0;
		const client = {
			crawl: async () => { submitted++; throw new Error("duplicate job"); },
			status: async () => ({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "completed" as const, stats: {} }),
		};
		const result = await runOfficialCrawl("apply", { capture, client, stateDir, sleep: async () => {} });
		expect(result.completedBatches).toBe(1);
		expect(submitted).toBe(0);
	});
});
