/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { FutCrawlerOptions, FutCrawlStats, FutCrawlTarget } from "./types.ts";
import { UniversalFutScraper } from "../scraper/universalScraper.ts";
import { detectFutUrlType } from "../router/urlDetector.ts";

export class MassiveFutCrawler {
	private db: Database;
	private scraper: UniversalFutScraper;
	private concurrency: number;
	private maxPages: number;
	private onProgress?: (stats: FutCrawlStats) => void;
	private queue: FutCrawlTarget[] = [];
	private visitedHashes = new Set<bigint>();
	private running = false;
	private stats: FutCrawlStats = {
		crawled: 0,
		total: 0,
		success: 0,
		errors: 0,
		currentConcurrency: 0,
	};

	constructor(opts: FutCrawlerOptions = {}) {
		this.concurrency = opts.concurrency || 6;
		this.maxPages = opts.maxPages || 500;
		this.onProgress = opts.onProgress;
		this.scraper = new UniversalFutScraper();

		const dataDir = join(import.meta.dir, "../data");
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		const dbPath = opts.dbPath || join(dataDir, "fut_extracted_database.sqlite");
		this.db = new Database(dbPath);
		this.initDatabase();
	}

	private initDatabase(): void {
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = NORMAL;

			CREATE TABLE IF NOT EXISTS visited_urls (
				url_hash TEXT PRIMARY KEY,
				url TEXT NOT NULL,
				crawled_at TEXT NOT NULL,
				status TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS crawled_entities (
				id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				page_type TEXT NOT NULL,
				name TEXT NOT NULL,
				raw_json TEXT NOT NULL,
				crawled_at TEXT NOT NULL
			);
		`);

		const rows = this.db.query("SELECT url_hash FROM visited_urls").all() as Array<{ url_hash: number | bigint }>;
		for (const r of rows) {
			this.visitedHashes.add(BigInt(r.url_hash));
		}
	}

	public addSeed(url: string, priority: number = 1): void {
		const hash = BigInt.asIntN(64, Bun.hash.wyhash(url));
		if (this.visitedHashes.has(hash)) return;

		const detected = detectFutUrlType(url);
		this.queue.push({
			url,
			provider: detected.provider,
			pageType: detected.pageType,
			priority,
		});
		this.queue.sort((a, b) => b.priority - a.priority);
		this.stats.total = this.queue.length + this.stats.crawled;
	}

	public addSeeds(urls: string[]): void {
		for (const u of urls) {
			this.addSeed(u);
		}
	}

	public async start(): Promise<FutCrawlStats> {
		if (this.running) return this.stats;
		this.running = true;

		const workers = Array.from({ length: this.concurrency }, () => this.runWorker());
		await Promise.all(workers);

		this.running = false;
		return this.stats;
	}

	public stop(): void {
		this.running = false;
	}

	public close(): void {
		this.stop();
		this.scraper.close();
		this.db.close();
	}

	private async runWorker(): Promise<void> {
		while (this.running && this.queue.length > 0 && this.stats.crawled < this.maxPages) {
			const target = this.queue.shift();
			if (!target) break;

			const hash = BigInt.asIntN(64, Bun.hash.wyhash(target.url));
			if (this.visitedHashes.has(hash)) continue;
			this.visitedHashes.add(hash);

			this.stats.currentConcurrency++;
			try {
				let entity: { id: string; name: string };
				switch (target.pageType) {
					case "PLAYER": {
						const player = await this.scraper.scrapePlayer(target.url);
						entity = player;
						break;
					}
					case "SBC": {
						const sbc = await this.scraper.scrapeSbc(target.url);
						entity = sbc;
						break;
					}
					case "EVOLUTION": {
						const evo = await this.scraper.scrapeEvolution(target.url);
						entity = evo;
						break;
					}
					case "SQUAD": {
						const squad = await this.scraper.scrapeSquad(target.url);
						entity = squad;
						break;
					}
					default: {
						const fodder = await this.scraper.scrapeFodder(target.url);
						entity = { id: "fodder-index", name: "Fodder Index" };
						break;
					}
				}

				this.db.run(
					`INSERT OR REPLACE INTO crawled_entities (id, provider, page_type, name, raw_json, crawled_at)
					 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
					[entity.id, target.provider, target.pageType, entity.name, JSON.stringify(entity)],
				);

				this.db.run(
					`INSERT OR REPLACE INTO visited_urls (url_hash, url, crawled_at, status)
					 VALUES (?, ?, datetime('now'), 'SUCCESS')`,
					[hash, target.url],
				);

				this.stats.success++;
				this.stats.lastEntity = entity.name;
			} catch (err: unknown) {
				this.stats.errors++;
				this.db.run(
					`INSERT OR REPLACE INTO visited_urls (url_hash, url, crawled_at, status)
					 VALUES (?, ?, datetime('now'), 'ERROR')`,
					[hash, target.url],
				);
			} finally {
				this.stats.crawled++;
				this.stats.lastUrl = target.url;
				this.stats.currentConcurrency--;

				if (this.onProgress) {
					this.onProgress({ ...this.stats });
				}
			}
		}
	}
}
