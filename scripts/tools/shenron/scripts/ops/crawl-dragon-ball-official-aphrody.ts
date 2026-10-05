#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Resumable official-site campaign. Aphrody Web owns network capture and index. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AphrodyWebClient } from "@shenron/pipeline/aphrody";
import { scrapeWithAphrody } from "../../../../../packages/shenron/pipeline/scripts/lib/aphrody-web-scrape.ts";

const ORIGIN = "https://dragon-ball-official.com";
const SITEMAP = `${ORIGIN}/sitemap.xml`;
const STATE_DIR = join(import.meta.dir, "../../var/runs/dragon-ball-official-aphrody");
const BATCH_SIZE = 10;

export type OfficialCrawlMode = "status" | "dry-run" | "apply";
export interface OfficialCrawlState {
	schema: "shenron-official-aphrody-crawl/v1";
	campaignId: string;
	discovered: number;
	completedBatches: number[];
	jobs: { batch: number; id: string; status: string }[];
	updatedAt: string;
}

export function parseMode(args: string[]): OfficialCrawlMode {
	const flags = ["--status", "--dry-run", "--apply"].filter((flag) => args.includes(flag));
	if (flags.length > 1) throw new Error("Choose only one of --status, --dry-run, --apply");
	return flags[0] === "--apply" ? "apply" : flags[0] === "--dry-run" ? "dry-run" : "status";
}

function locs(xml: string): string[] {
	return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
		.map((match) => match[1]!.trim().replaceAll("&amp;", "&"));
}

function officialUrl(value: string): URL | null {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" && parsed.hostname === "dragon-ball-official.com" && !parsed.username && !parsed.password ? parsed : null;
	} catch {
		return null;
	}
}

export async function discoverOfficialPages(capture: (url: string) => Promise<string>): Promise<string[]> {
	const pending = [SITEMAP];
	const seenSitemaps = new Set<string>();
	const pages = new Set<string>();
	while (pending.length) {
		const sitemap = pending.shift()!;
		if (seenSitemaps.has(sitemap)) continue;
		seenSitemaps.add(sitemap);
		const xml = await capture(sitemap);
		if (!/<(?:urlset|sitemapindex)\b/i.test(xml)) throw new Error(`Invalid official sitemap: ${sitemap}`);
		for (const value of locs(xml)) {
			const parsed = officialUrl(value);
			if (!parsed) continue;
			if (/\.xml$/i.test(parsed.pathname)) {
				if (!seenSitemaps.has(parsed.href)) pending.push(parsed.href);
			} else if (!parsed.search && !/\.(?:jpg|jpeg|png|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|zip|pdf)$/i.test(parsed.pathname)) {
				pages.add(parsed.href);
			}
		}
	}
	if (!pages.size) throw new Error("Official sitemap contains no eligible pages");
	return [...pages].toSorted();
}

export async function runOfficialCrawl(
	mode: OfficialCrawlMode,
	options: {
		capture?: (url: string) => Promise<string>;
		client?: Pick<AphrodyWebClient, "crawl" | "status">;
		stateDir?: string;
		sleep?: (ms: number) => Promise<void>;
	} = {},
): Promise<{ mode: OfficialCrawlMode; campaignId?: string; discovered?: number; completedBatches?: number; batches?: number; stateFile?: string }> {
	const stateDir = options.stateDir ?? STATE_DIR;
	if (mode === "status") {
		const current = Bun.file(join(stateDir, "current.json"));
		if (!(await current.exists())) return { mode };
		const state = await current.json() as OfficialCrawlState;
		return { mode, campaignId: state.campaignId, discovered: state.discovered, completedBatches: state.completedBatches.length, batches: Math.ceil(state.discovered / BATCH_SIZE), stateFile: join(stateDir, `campaign-${state.campaignId}.json`) };
	}
	const capture = options.capture ?? (async (url: string) => (await scrapeWithAphrody(url, { profile: "http" })).content);
	const urls = await discoverOfficialPages(capture);
	const campaignId = new Bun.CryptoHasher("sha256").update(urls.join("\n")).digest("hex").slice(0, 20);
	const stateFile = join(stateDir, `campaign-${campaignId}.json`);
	const batches = Math.ceil(urls.length / BATCH_SIZE);
	if (mode === "dry-run") return { mode, campaignId, discovered: urls.length, completedBatches: 0, batches, stateFile };
	await mkdir(stateDir, { recursive: true });
	const saved = Bun.file(stateFile);
	const state: OfficialCrawlState = await saved.exists()
		? await saved.json() as OfficialCrawlState
		: { schema: "shenron-official-aphrody-crawl/v1", campaignId, discovered: urls.length, completedBatches: [], jobs: [], updatedAt: new Date().toISOString() };
	if (state.schema !== "shenron-official-aphrody-crawl/v1" || state.campaignId !== campaignId || state.discovered !== urls.length) throw new Error("Official crawl state does not match the current sitemap");
	const save = async () => {
		state.updatedAt = new Date().toISOString();
		await Bun.write(stateFile, JSON.stringify(state, null, 2));
		await Bun.write(join(stateDir, "current.json"), JSON.stringify(state, null, 2));
	};
	await save();
	const client = options.client ?? new AphrodyWebClient();
	const sleep = options.sleep ?? Bun.sleep;
	for (let batch = 0; batch < batches; batch++) {
		if (state.completedBatches.includes(batch)) continue;
		const seeds = urls.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
		let record = [...state.jobs].toReversed().find((item) => item.batch === batch && item.status === "running");
		let job;
		if (record) {
			try {
				job = await client.status(record.id);
			} catch {
				// The API keeps job status in memory; a server restart loses that ID.
				record.status = "lost";
				await save();
			}
		}
		if (!job) {
			job = await client.crawl({ urls: seeds, allowedDomains: ["dragon-ball-official.com"], maxDepth: 0, maxRequests: seeds.length, maxConcurrency: 4, profile: "static" });
			record = { batch, id: job.id, status: job.status };
			state.jobs.push(record);
			await save();
		}
		while (job.status === "running") {
			await sleep(2_000);
			job = await client.status(job.id);
		}
		record!.status = job.status;
		if (job.status !== "completed") {
			await save();
			throw new Error(`Aphrody Web official crawl batch ${batch} ended as ${job.status}; rerun --apply to resume`);
		}
		state.completedBatches.push(batch);
		await save();
	}
	return { mode, campaignId, discovered: urls.length, completedBatches: state.completedBatches.length, batches, stateFile };
}

if (import.meta.main) {
	const mode = parseMode(process.argv.slice(2));
	const report = await runOfficialCrawl(mode);
	console.log(JSON.stringify(report));
}
