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

import { WebService } from "@aphrody/agent-browser/service";
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
  private abort: AbortController | undefined;
  private rateLimitMs: number;
  private onProgress?: (stats: FutCrawlStats) => void;
  private seeds: FutCrawlTarget[] = [];
  private running = false;
  private stats: FutCrawlStats = {
    crawled: 0,
    total: 0,
    success: 0,
    errors: 0,
    currentConcurrency: 0,
  };

  constructor(opts: FutCrawlerOptions = {}) {
    this.concurrency = opts.concurrency ?? 6;
    this.maxPages = opts.maxPages ?? 500;
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > 10000)
      throw new RangeError("maxPages must be an integer between 1 and 10000");
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 128)
      throw new RangeError("concurrency must be an integer between 1 and 128");
    this.rateLimitMs = opts.rateLimitMs ?? 1000;
    if (!Number.isSafeInteger(this.rateLimitMs) || this.rateLimitMs < 0)
      throw new RangeError("rateLimitMs must be a nonnegative integer");
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
  }

  public addSeed(url: string, priority: number = 1): void {
    const hash = BigInt.asIntN(64, Bun.hash.wyhash(url));
    // Completed domain records need no re-import; network deduplication belongs to Web.
    if (
      this.db
        .query("SELECT 1 FROM visited_urls WHERE url_hash = ? AND status = 'SUCCESS'")
        .get(hash)
    )
      return;

    const detected = detectFutUrlType(url);
    this.seeds.push({
      url,
      provider: detected.provider,
      pageType: detected.pageType,
      priority,
    });
    this.seeds.sort((a, b) => b.priority - a.priority);
    this.stats.total = this.seeds.length + this.stats.crawled;
  }

  public addSeeds(urls: string[]): void {
    for (const u of urls) {
      this.addSeed(u);
    }
  }

  public async start(): Promise<FutCrawlStats> {
    if (this.running) return this.stats;
    this.running = true;

    if (this.seeds.length === 0) {
      this.running = false;
      return this.stats;
    }
    const seeds = this.seeds;
    this.seeds = [];
    this.abort = new AbortController();
    try {
      const report = await new WebService().crawl(
        seeds.map((seed) => seed.url),
        {
          maxPages: this.maxPages,
          maxDepth: 0,
          concurrency: this.concurrency,
          allowedDomains: [...new Set(seeds.map((seed) => new URL(seed.url).hostname))],
          render: true,
          includeHtml: true,
          delayMs: this.rateLimitMs,
          signal: this.abort.signal,
        },
      );
      this.stats.total =
        this.stats.crawled +
        report.stats.frontierDone +
        report.stats.frontierPending +
        report.stats.frontierFailed;
      this.stats.errors += report.errors.length;
      for (const page of report.pages) {
        if (!this.running) break;
        await this.processPage(page.url, page.html ?? "");
      }
    } catch (error) {
      this.seeds.push(...seeds);
      if (!this.abort.signal.aborted) throw error;
    } finally {
      this.abort = undefined;
      this.running = false;
    }

    this.running = false;
    return this.stats;
  }

  public stop(): void {
    this.abort?.abort();
    this.running = false;
  }

  public close(): void {
    this.stop();
    this.scraper.close();
    this.db.close();
  }

  private async processPage(url: string, html: string): Promise<void> {
    const detected = detectFutUrlType(url);
    const target = { url, provider: detected.provider, pageType: detected.pageType };
    const hash = BigInt.asIntN(64, Bun.hash.wyhash(url));

    this.stats.currentConcurrency++;
    try {
      let entity: { id: string; name: string };
      switch (target.pageType) {
        case "PLAYER": {
          const player = await this.scraper.scrapePlayer(target.url, html);
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
          await this.scraper.scrapeFodder(target.url);
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
    } catch {
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
