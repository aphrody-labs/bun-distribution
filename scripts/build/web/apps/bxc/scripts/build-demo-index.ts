/**
 * Copyright 2026 aphrody-code
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build the BXC demo index: documentation of widely used open-source projects
 * (`demo-index/sources.json`), deduplicated, chunked and embedded, ready
 * to be queried with the `bxc_index_search` MCP tool or
 * `GET /api/v1/index/search`.
 *
 *   bun scripts/build-demo-index.ts [--db ~/.bxc/demo-index.sqlite] [--pages-per-source 300]
 *                                   [--only React,Vue] [--concurrency 32] [--no-vectors]
 *
 * Local build only: publishing a hosted instance is gated by the deployment
 * boundary in AGENTS.md.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { MassiveCrawler } from "../src/crawler/MassiveCrawler.ts";

interface Source {
	name: string;
	root: string;
	prefix?: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = flag("--db") ?? join(homedir(), ".bxc", "demo-index.sqlite");
const pagesPerSource = Number(flag("--pages-per-source") ?? 300);
const concurrency = Number(flag("--concurrency") ?? 32);
const only = flag("--only")?.split(",").map((s) => s.trim().toLowerCase());
const enableVectors = !args.includes("--no-vectors");

const { sources } = (await Bun.file(join(import.meta.dir, "..", "demo-index", "sources.json")).json()) as {
	sources: Source[];
};
const selected = sources.filter((s) => !only || only.includes(s.name.toLowerCase()));

for (const source of selected) {
	const root = new URL(source.root);
	const prefix = source.prefix ?? "/";
	const started = performance.now();
	const crawler = new MassiveCrawler({
		requestQueueName: join(homedir(), ".bxc", "demo-index", `${root.host}.frontier.db`),
		sqliteDbPath: dbPath,
		allowedDomains: [root.hostname],
		excludePatterns: [`^https?://${root.host.replaceAll(".", "\\.")}(?!${prefix.replaceAll("/", "\\/")})`],
		maxDepth: 6,
		maxRequests: pagesPerSource,
		minConcurrency: Math.min(8, concurrency),
		maxConcurrency: concurrency,
		maxInFlightPerHost: 8,
		daemon: false,
		enableVectors,
		log: () => {},
	});
	await crawler.run([source.root]);
	const stats = crawler.stats();
	console.log(
		`${source.name.padEnd(16)} fetched=${stats.fetched} indexed=${stats.indexed} dup=${stats.canonicalRedirects + stats.nearDuplicates + stats.exactDuplicates} blocked=${stats.blocked} ${((performance.now() - started) / 1000).toFixed(1)}s`,
	);
	crawler.db.close();
}
console.log(`Demo index written to ${dbPath}`);
