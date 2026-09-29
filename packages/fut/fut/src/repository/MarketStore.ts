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
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UtAuctionItem } from "../ea/types.ts";

/**
 * Persistent store of observed transfer-market prices.
 *
 * The package had no price history at all: its `prices` table held a single
 * row, so every valuation fell back to hard-coded ladders and each prediction
 * was effectively measured against itself. This store records what the market
 * actually showed, so a valuation can be derived from observations instead.
 *
 * Every row is one sighting of one auction at one moment. Rows are append-only
 * and deduplicated per (trade, observation time), which makes repeated searches
 * cheap to record and lets the same auction be followed as its bid climbs.
 */

export const MARKET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS market_observations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    definition_id INTEGER NOT NULL,
    trade_id      INTEGER,
    rating        INTEGER,
    platform      TEXT    NOT NULL DEFAULT 'console',
    buy_now       INTEGER,
    current_bid   INTEGER,
    starting_bid  INTEGER,
    expires       INTEGER,
    source        TEXT    NOT NULL,
    observed_at   INTEGER NOT NULL,
    UNIQUE(trade_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_market_def_time
    ON market_observations(definition_id, platform, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_observed
    ON market_observations(observed_at DESC);

CREATE TABLE IF NOT EXISTS price_bands (
    definition_id INTEGER NOT NULL,
    min_price     INTEGER NOT NULL,
    max_price     INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (definition_id)
);
`;

/** Where an observation came from. */
export type MarketSource = "search" | "extension" | "tradepile" | "watchlist";

/** Supported platforms for a price observation. */
export type MarketPlatform = "console" | "pc";

export interface MarketObservation {
	definitionId: number;
	tradeId?: number;
	rating?: number;
	platform: MarketPlatform;
	buyNow?: number;
	currentBid?: number;
	startingBid?: number;
	expires?: number;
	source: MarketSource;
	observedAt: number;
}

/** Aggregated view of the buy-now prices seen for one definition. */
export interface BinSummary {
	definitionId: number;
	platform: MarketPlatform;
	/** 10th percentile of observed buy-now prices — a robust "floor". */
	floor: number;
	median: number;
	min: number;
	max: number;
	/** Number of observations the summary is based on. */
	sampleSize: number;
	/** Oldest and newest observation timestamps in the window. */
	from: number;
	to: number;
}

export interface MarketStoreOptions {
	/** SQLite file. Defaults to the package data directory; `:memory:` is accepted. */
	dbPath?: string;
}

/**
 * Reads and writes observed market prices.
 *
 * `close()` must be called when done; the handle is a plain SQLite connection.
 */
export class MarketStore {
	private db: Database;

	constructor(options: MarketStoreOptions = {}) {
		const dbPath =
			options.dbPath ??
			process.env.BXC_FUT_MARKET_DB ??
			// Resolve relative to this module, not the cwd, so the store does not
			// move with the working directory.
			join(import.meta.dir, "../data/fut_market.sqlite");

		if (dbPath !== ":memory:") {
			mkdirSync(dirname(dbPath), { recursive: true });
		}
		this.db = new Database(dbPath, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec(MARKET_SCHEMA_SQL);
	}

	/** Records observations, ignoring exact duplicates. Returns rows inserted. */
	public record(observations: MarketObservation[]): number {
		if (observations.length === 0) return 0;
		const stmt = this.db.prepare(
			`INSERT OR IGNORE INTO market_observations
			 (definition_id, trade_id, rating, platform, buy_now, current_bid,
			  starting_bid, expires, source, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		let inserted = 0;
		const tx = this.db.transaction((rows: MarketObservation[]) => {
			for (const o of rows) {
				const res = stmt.run(
					o.definitionId,
					o.tradeId ?? null,
					o.rating ?? null,
					o.platform,
					o.buyNow ?? null,
					o.currentBid ?? null,
					o.startingBid ?? null,
					o.expires ?? null,
					o.source,
					o.observedAt,
				);
				inserted += res.changes;
			}
		});
		tx(observations);
		return inserted;
	}

	/**
	 * Records a transfer-market search result. Auctions without a definition id
	 * or a buy-now price carry no pricing signal and are skipped.
	 */
	public recordAuctions(
		auctions: UtAuctionItem[],
		platform: MarketPlatform = "console",
		source: MarketSource = "search",
		observedAt: number = Date.now(),
	): number {
		return this.record(
			auctions
				.filter((a) => a.assetId > 0)
				.map((a) => ({
					definitionId: a.assetId,
					tradeId: a.tradeId,
					rating: a.rating,
					platform,
					buyNow: a.buyNowPrice || undefined,
					currentBid: a.currentBid || undefined,
					startingBid: a.startingBid || undefined,
					expires: a.expires || undefined,
					source,
					observedAt,
				})),
		);
	}

	/** Stores EA's official price band for a definition. */
	public recordPriceBand(
		definitionId: number,
		minPrice: number,
		maxPrice: number,
		updatedAt: number = Date.now(),
	): void {
		this.db
			.prepare(
				`INSERT INTO price_bands (definition_id, min_price, max_price, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(definition_id) DO UPDATE SET
				   min_price = excluded.min_price,
				   max_price = excluded.max_price,
				   updated_at = excluded.updated_at`,
			)
			.run(definitionId, minPrice, maxPrice, updatedAt);
	}

	/** EA's price band for a definition, if one has been recorded. */
	public getPriceBand(
		definitionId: number,
	): { minPrice: number; maxPrice: number; updatedAt: number } | null {
		const row = this.db
			.prepare(
				"SELECT min_price, max_price, updated_at FROM price_bands WHERE definition_id = ?",
			)
			.get(definitionId) as
			| { min_price: number; max_price: number; updated_at: number }
			| undefined;
		return row
			? { minPrice: row.min_price, maxPrice: row.max_price, updatedAt: row.updated_at }
			: null;
	}

	/**
	 * Summarizes the buy-now prices observed for a definition.
	 *
	 * The floor is the 10th percentile rather than the strict minimum: a single
	 * mispriced or already-sold listing should not define the market. Returns
	 * `null` when nothing has been observed in the window — an empty result is
	 * reported as such, never as a zero price.
	 */
	public getBinSummary(
		definitionId: number,
		options: { platform?: MarketPlatform; sinceMs?: number } = {},
	): BinSummary | null {
		const platform = options.platform ?? "console";
		const since = options.sinceMs ? Date.now() - options.sinceMs : 0;

		const rows = this.db
			.prepare(
				`SELECT buy_now, observed_at FROM market_observations
				 WHERE definition_id = ? AND platform = ? AND observed_at >= ?
				   AND buy_now IS NOT NULL AND buy_now > 0
				 ORDER BY buy_now ASC`,
			)
			.all(definitionId, platform, since) as Array<{
			buy_now: number;
			observed_at: number;
		}>;

		if (rows.length === 0) return null;

		const prices = rows.map((r) => r.buy_now);
		const times = rows.map((r) => r.observed_at);

		// Linearly interpolated percentile (the R-7 / numpy default). Picking the
		// nearest rank instead would make the single cheapest listing the p10 of
		// any sample of ten or fewer — exactly the outlier the floor must resist.
		const at = (q: number): number => {
			if (prices.length === 1) return prices[0];
			const pos = q * (prices.length - 1);
			const lo = Math.floor(pos);
			const hi = Math.ceil(pos);
			if (lo === hi) return prices[lo];
			return Math.round(prices[lo] + (pos - lo) * (prices[hi] - prices[lo]));
		};

		return {
			definitionId,
			platform,
			floor: at(0.1),
			median: at(0.5),
			min: prices[0],
			max: prices[prices.length - 1],
			sampleSize: prices.length,
			from: Math.min(...times),
			to: Math.max(...times),
		};
	}

	/** Total observations stored, for diagnostics. */
	public count(): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS n FROM market_observations")
			.get() as { n: number };
		return row.n;
	}

	public close(): void {
		this.db.close();
	}
}
