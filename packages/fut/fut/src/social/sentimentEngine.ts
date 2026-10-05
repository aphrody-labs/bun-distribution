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

import type { Tweet } from "@aphrody/x";
import type {
	CommunityVerdict,
	PlayerCommunitySentiment,
	PlayerReviewQuote,
} from "./types.ts";

const POSITIVE_PATTERNS = [
	/\bbeast\b/i,
	/\bmonstre\b/i,
	/\bcrack\b/i,
	/\bcheat\s*code\b/i,
	/\bunreal\b/i,
	/\binsane\b/i,
	/\bbroken\b/i,
	/\bgod\s*tier\b/i,
	/\bmust[\s-]*(?:buy|do|have)\b/i,
	/\bautomatic\b/i,
	/\bclutch\b/i,
	/\bgame[\s-]*changer\b/i,
	/\bso\s+good\b/i,
	/\b10\/10\b/i,
	/\bcarry\b/i,
	/\bglitch\b/i,
	/\bsmooth\b/i,
	/\bmeta\b/i,
	/\bbest\s+(?:st|cb|cm|rw|lw|cam|lb|rb|gk)\b/i,
	/\bbanger\b/i,
	/\bpépite\b/i,
	/\bincroyable\b/i,
	/\bfantastic\b/i,
	/\bgem\b/i,
	/\bworth\s+(?:every|it)\b/i,
	/\bélégant\b/i,
	/\brapide\b/i,
	/\bfinishing\s+is\s+lethal\b/i,
];

const NEGATIVE_PATTERNS = [
	/\bfraud\b/i,
	/\bfraude\b/i,
	/\bclunky\b/i,
	/\bheavy\b/i,
	/\btruck\b/i,
	/\bcamion\b/i,
	/\bunusable\b/i,
	/\bterrible\b/i,
	/\bdon'?t\s+do\b/i,
	/\bwaste\s+of\s+(?:coins|fodder)\b/i,
	/\boverpriced\b/i,
	/\bscam\b/i,
	/\bpoubelle\b/i,
	/\bhorrible\b/i,
	/\bfodder\b/i,
	/\bvendez\b/i,
	/\bsell\b/i,
	/\bmisses\s+everything\b/i,
	/\blourde?\b/i,
	/\bnul\b/i,
	/\bslow\b/i,
	/\bnerfed\b/i,
	/\bdisappointing\b/i,
	/\bavoid\b/i,
	/\bflop\b/i,
];

/**
 * Analyzes a collection of tweets discussing a player to extract
 * factual community consensus, sentiment score, top reviews, and price impact.
 */
export function analyzePlayerTweets(
	playerName: string,
	tweets: Tweet[],
): PlayerCommunitySentiment {
	if (tweets.length === 0) {
		return {
			playerName,
			sampledTweetsCount: 0,
			sentimentScore: 50,
			positivePercentage: 50,
			negativePercentage: 25,
			neutralPercentage: 25,
			verdict: "NEUTRAL",
			proPlayerConsensus: "Pas assez de données récentes sur X pour établir un consensus communautaire.",
			trendingKeywords: [],
			topReviews: [],
			pricePredictionMultiplier: 1.0,
			sentimentCatalysts: [],
			sentimentRisks: [],
			lastUpdated: new Date().toISOString(),
		};
	}

	let weightedPos = 0;
	let weightedNeg = 0;
	let weightedNeu = 0;
	let totalWeight = 0;

	const reviews: PlayerReviewQuote[] = [];
	const foundKeywords = new Map<string, number>();

	for (const t of tweets) {
		const text = t.text || "";
		// Weight tweet by popularity (likes + retweets) so trusted voices count more
		const engagement = (t.like_count ?? 0) + (t.retweet_count ?? 0) * 2;
		const weight = Math.max(1, 1 + Math.log10(engagement + 1) * 2);

		let posHits = 0;
		for (const p of POSITIVE_PATTERNS) {
			const m = text.match(p);
			if (m) {
				posHits++;
				const kw = m[0].toLowerCase();
				foundKeywords.set(kw, (foundKeywords.get(kw) ?? 0) + 1);
			}
		}

		let negHits = 0;
		for (const n of NEGATIVE_PATTERNS) {
			const m = text.match(n);
			if (m) {
				negHits++;
				const kw = m[0].toLowerCase();
				foundKeywords.set(kw, (foundKeywords.get(kw) ?? 0) + 1);
			}
		}

		let sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
		if (posHits > negHits) {
			sentiment = "BULLISH";
			weightedPos += weight;
		} else if (negHits > posHits) {
			sentiment = "BEARISH";
			weightedNeg += weight;
		} else {
			weightedNeu += weight;
		}
		totalWeight += weight;

		// Collect notable reviews with high engagement or clear sentiment
		if (posHits > 0 || negHits > 0 || (t.like_count ?? 0) > 5) {
			reviews.push({
				author: t.author?.name || t.author?.username || "Joueur X",
				authorUsername: t.author?.username || "unknown",
				text: text.replace(/\n+/g, " ").trim(),
				sentiment,
				likes: t.like_count ?? 0,
				url: t.author?.username ? `https://x.com/${t.author.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
			});
		}
	}

	// Sort reviews by engagement
	reviews.sort((a, b) => b.likes - a.likes);
	const topReviews = reviews.slice(0, 5);

	// Calculate percentages
	const safeTotal = totalWeight || 1;
	const posPct = Math.round((weightedPos / safeTotal) * 100);
	const negPct = Math.round((weightedNeg / safeTotal) * 100);
	const neuPct = Math.max(0, 100 - posPct - negPct);

	// Sentiment score 0 to 100
	const sentimentScore = Math.min(100, Math.max(0, Math.round(50 + (posPct - negPct) * 0.5)));

	// Determine verdict
	let verdict: CommunityVerdict = "NEUTRAL";
	let consensusText = "La communauté est partagée sur le rendement de la carte.";
	let priceMultiplier = 1.0;
	const catalysts: string[] = [];
	const risks: string[] = [];

	if (posPct >= 75) {
		verdict = "GOD_TIER_BEAST";
		consensusText = "Consensus unanime : la carte est un monstre compétitif en jeu (animations fluides, vitesse dévastatrice).";
		priceMultiplier = 1.08;
		catalysts.push(`Hype communautaire virale sur X (${posPct}% d'avis positifs) : forte pression acheteuse.`);
	} else if (posPct >= 55) {
		verdict = "BULLISH_META";
		consensusText = "Avis très favorables : carte largement validée pour Champions et Rivals.";
		priceMultiplier = 1.04;
		catalysts.push(`Retour positif des streamers et joueurs compétitifs sur X.`);
	} else if (negPct >= 50) {
		verdict = "FRAUD_ALERT";
		consensusText = "Alerte déception (Fraud Alert) : la carte déçoit en jeu par rapport à son prix ou ses stats affichées.";
		priceMultiplier = 0.92;
		risks.push(`Vagues de revente suite aux critiques sur X (${negPct}% d'avis négatifs, lourdeur ou finition en berne).`);
	} else if (negPct > posPct) {
		verdict = "OVERPRICED";
		consensusText = "Joueur correct mais jugé surcoté par rapport aux alternatives marché.";
		priceMultiplier = 0.96;
		risks.push("Considéré comme trop cher par les traders X : risque de décote rapide.");
	}

	// Top trending keywords
	const sortedKeywords = Array.from(foundKeywords.entries())
		.toSorted((a, b) => b[1] - a[1])
		.slice(0, 6)
		.map(([kw]) => kw);

	return {
		playerName,
		sampledTweetsCount: tweets.length,
		sentimentScore,
		positivePercentage: posPct,
		negativePercentage: negPct,
		neutralPercentage: neuPct,
		verdict,
		proPlayerConsensus: consensusText,
		trendingKeywords: sortedKeywords,
		topReviews,
		pricePredictionMultiplier: priceMultiplier,
		sentimentCatalysts: catalysts,
		sentimentRisks: risks,
		lastUpdated: new Date().toISOString(),
	};
}
