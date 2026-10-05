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

import { XClient, XSession } from "@aphrody/x";
import { analyzePlayerTweets } from "./sentimentEngine.ts";
import type {
	FutNewsCategory,
	FutNewsItem,
	FutNewsUrgency,
	PlayerCommunitySentiment,
} from "./types.ts";

export interface LiveNewsOptions {
	count?: number;
	query?: string;
	category?: FutNewsCategory;
	minLikes?: number;
}

export interface PlayerSentimentOptions {
	count?: number;
	includeQuotes?: boolean;
}

export class FutXFeed {
	private client?: XClient;

	constructor(client?: XClient) {
		this.client = client;
	}

	private getClient(): XClient {
		if (this.client) return this.client;
		const session = XSession.loadOrEnv();
		this.client = new XClient(session);
		return this.client;
	}

	/**
	 * Fetches live breaking news, leaks, SBC updates, and market intel from X.
	 */
	public async getLiveNews(options: LiveNewsOptions = {}): Promise<FutNewsItem[]> {
		const client = this.getClient();
		const count = options.count ?? 20;
		const query = options.query ?? '("FC27" OR "FC 27" OR "Ultimate Team" OR "EASPORTSFC") (leak OR sbc OR promo OR totw OR fut)';

		const page = await client.search(query, count, undefined, "Latest");
		const items: FutNewsItem[] = [];

		for (const t of page.tweets) {
			const text = t.text || "";
			const likes = t.like_count ?? 0;
			const retweets = t.retweet_count ?? 0;
			const replies = t.reply_count ?? 0;

			if (options.minLikes && likes < options.minLikes) {
				continue;
			}

			const category = this.categorizeNews(text);
			if (options.category && category !== options.category) {
				continue;
			}

			const urgency = this.determineUrgency(text, likes, retweets);
			const authorUsername = t.author?.username || "unknown";

			items.push({
				id: t.id,
				author: t.author?.name || authorUsername,
				authorUsername,
				text,
				createdAt: t.created_at || new Date().toISOString(),
				likes,
				retweets,
				replies,
				category,
				urgency,
				url: `https://x.com/${authorUsername}/status/${t.id}`,
			});
		}

		// Sort by urgency and then by creation date / engagement
		return items.toSorted((a, b) => {
			const urgencyWeight = { BREAKING: 3, HIGH: 2, NORMAL: 1 };
			const scoreA = urgencyWeight[a.urgency] * 10000 + a.likes * 2 + a.retweets * 3;
			const scoreB = urgencyWeight[b.urgency] * 10000 + b.likes * 2 + b.retweets * 3;
			return scoreB - scoreA;
		});
	}

	/**
	 * Analyzes player sentiment, community verdict, and price prediction impact
	 * using live tweets from the FUT community.
	 */
	public async analyzePlayerSentiment(
		playerName: string,
		options: PlayerSentimentOptions = {},
	): Promise<PlayerCommunitySentiment> {
		const client = this.getClient();
		const count = options.count ?? 25;
		const query = `"${playerName}" (FC27 OR "FC 27" OR FUT OR "Ultimate Team" OR FIFA)`;

		try {
			const page = await client.search(query, count, undefined, "Latest");
			return analyzePlayerTweets(playerName, page.tweets);
		} catch {
			// Fallback to neutral sentiment if search fails
			return analyzePlayerTweets(playerName, []);
		}
	}

	private categorizeNews(text: string): FutNewsCategory {
		const lower = text.toLowerCase();
		if (
			lower.includes("leak") ||
			lower.includes("leaked") ||
			lower.includes("fuite") ||
			lower.includes("futsheriff")
		) {
			return "LEAK";
		}
		if (
			lower.includes("sbc") ||
			lower.includes("dce") ||
			lower.includes("challenge") ||
			lower.includes("requirements")
		) {
			return "SBC";
		}
		if (
			lower.includes("promo") ||
			lower.includes("totw") ||
			lower.includes("rttf") ||
			lower.includes("trailblazer") ||
			lower.includes("team of the week")
		) {
			return "PROMO";
		}
		if (
			lower.includes("patch") ||
			lower.includes("gameplay") ||
			lower.includes("update") ||
			lower.includes("nerf") ||
			lower.includes("buff")
		) {
			return "GAMEPLAY";
		}
		if (
			lower.includes("market") ||
			lower.includes("crash") ||
			lower.includes("invest") ||
			lower.includes("fodder") ||
			lower.includes("coins") ||
			lower.includes("prix")
		) {
			return "MARKET";
		}
		return "GENERAL";
	}

	private determineUrgency(text: string, likes: number, retweets: number): FutNewsUrgency {
		const lower = text.toLowerCase();
		if (
			likes >= 100 ||
			retweets >= 50 ||
			lower.includes("urgent") ||
			lower.includes("breaking") ||
			lower.includes("official") ||
			lower.includes("officiel")
		) {
			return "BREAKING";
		}
		if (likes >= 25 || retweets >= 10 || lower.includes("leak") || lower.includes("confirmed")) {
			return "HIGH";
		}
		return "NORMAL";
	}
}
