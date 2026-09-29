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

export type FutNewsCategory = "LEAK" | "SBC" | "PROMO" | "GAMEPLAY" | "MARKET" | "GENERAL";
export type FutNewsUrgency = "BREAKING" | "HIGH" | "NORMAL";

export interface FutNewsItem {
	id: string;
	author: string;
	authorUsername: string;
	text: string;
	createdAt: string;
	likes: number;
	retweets: number;
	replies: number;
	views?: number;
	category: FutNewsCategory;
	urgency: FutNewsUrgency;
	url: string;
}

export type CommunityVerdict =
	| "GOD_TIER_BEAST" // Overwhelmingly positive (>80% positive)
	| "BULLISH_META" // Positive (60-80% positive)
	| "NEUTRAL" // Divided community (40-60%)
	| "OVERPRICED" // Good in-game but too expensive relative to performance
	| "FRAUD_ALERT"; // Negative (<40% positive, considered a fraud)

export interface PlayerReviewQuote {
	author: string;
	authorUsername: string;
	text: string;
	sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
	likes: number;
	url: string;
}

export interface PlayerCommunitySentiment {
	playerName: string;
	sampledTweetsCount: number;
	sentimentScore: number; // 0 to 100 (50 = neutral)
	positivePercentage: number;
	negativePercentage: number;
	neutralPercentage: number;
	verdict: CommunityVerdict;
	proPlayerConsensus: string;
	trendingKeywords: string[];
	topReviews: PlayerReviewQuote[];
	pricePredictionMultiplier: number; // e.g. 1.08 (+8%) or 0.94 (-6%)
	sentimentCatalysts: string[];
	sentimentRisks: string[];
	lastUpdated: string;
}
