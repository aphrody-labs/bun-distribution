import { describe, expect, it } from "bun:test";
import {
	analyzePlayerTweets,
	type PlayerCommunitySentiment,
} from "../src/social/index.ts";
import {
	predictPlayerFuturePrice,
	predictPlayerDualPlatform,
} from "../src/prediction/timeSeriesPredictor.ts";
import type { DetailedCardStats } from "../src/squad/metaRating.ts";
import type { Tweet } from "@aphrody/x";

describe("FUT Social Community Sentiment & X Integration", () => {
	const mockMbappeCard: DetailedCardStats = {
		id: "mbappe-gold",
		name: "Kylian Mbappé",
		overallRating: 91,
		position: "ST",
		pac: 97,
		sho: 90,
		pas: 80,
		dri: 92,
		def: 36,
		phy: 78,
		skillMoves: 5,
		weakFoot: 4,
		accelerateType: "Quick Step",
		playstyles: ["Rapid", "Finesse Shot", "Trickster"],
		playstylesPlus: ["Quick Step+"],
	};

	it("analyzes bullish tweets and assigns GOD_TIER_BEAST verdict with positive multiplier", () => {
		const bullishTweets: Tweet[] = [
			{
				id: "1",
				text: "Mbappé is an absolute beast! Glitch in defense, finishing is lethal!",
				like_count: 50,
				retweet_count: 10,
				reply_count: 5,
				author: { id: "10", name: "ProFUT", username: "profut" },
			},
			{
				id: "2",
				text: "Pure cheat code this year. 10/10 must have for weekend league, insane pace!",
				like_count: 35,
				retweet_count: 4,
				reply_count: 2,
				author: { id: "11", name: "FUTTrader", username: "futtrader" },
			},
			{
				id: "3",
				text: "Best ST in the game, completely broken card!",
				like_count: 20,
				retweet_count: 2,
				reply_count: 1,
				author: { id: "12", name: "ChampsGuru", username: "champsguru" },
			},
		];

		const sentiment = analyzePlayerTweets("Mbappé", bullishTweets);

		expect(sentiment.sampledTweetsCount).toBe(3);
		expect(sentiment.verdict).toBe("GOD_TIER_BEAST");
		expect(sentiment.positivePercentage).toBeGreaterThanOrEqual(75);
		expect(sentiment.pricePredictionMultiplier).toBeGreaterThan(1.0);
		expect(sentiment.sentimentScore).toBeGreaterThan(70);
		expect(sentiment.topReviews.length).toBeGreaterThan(0);
		expect(sentiment.sentimentCatalysts.length).toBeGreaterThan(0);
	});

	it("analyzes bearish tweets and detects FRAUD_ALERT with discount multiplier", () => {
		const fraudTweets: Tweet[] = [
			{
				id: "4",
				text: "Total fraud! Clunky, heavy as a truck and misses everything. Waste of coins.",
				like_count: 60,
				retweet_count: 15,
				reply_count: 10,
				author: { id: "13", name: "AngryGamer", username: "angrygamer" },
			},
			{
				id: "5",
				text: "Don't do him. Unusable gameplay, terrible finishing and slow turning.",
				like_count: 40,
				retweet_count: 8,
				reply_count: 4,
				author: { id: "14", name: "FUTReview", username: "futreview" },
			},
			{
				id: "6",
				text: "Overpriced scam card. Vendez vite avant le crash!",
				like_count: 25,
				retweet_count: 3,
				reply_count: 1,
				author: { id: "15", name: "TraderGuy", username: "traderguy" },
			},
		];

		const sentiment = analyzePlayerTweets("Fraud Card", fraudTweets);

		expect(sentiment.verdict).toBe("FRAUD_ALERT");
		expect(sentiment.negativePercentage).toBeGreaterThanOrEqual(50);
		expect(sentiment.pricePredictionMultiplier).toBeLessThan(1.0);
		expect(sentiment.sentimentScore).toBeLessThan(40);
		expect(sentiment.sentimentRisks.length).toBeGreaterThan(0);
	});

	it("handles empty tweets gracefully returning neutral baseline", () => {
		const sentiment = analyzePlayerTweets("Unknown Player", []);
		expect(sentiment.verdict).toBe("NEUTRAL");
		expect(sentiment.pricePredictionMultiplier).toBe(1.0);
		expect(sentiment.sentimentScore).toBe(50);
		expect(sentiment.sampledTweetsCount).toBe(0);
	});

	it("incorporates community sentiment into time series price forecasting", () => {
		const bullishSentiment: PlayerCommunitySentiment = {
			playerName: "Mbappé",
			sampledTweetsCount: 15,
			sentimentScore: 90,
			positivePercentage: 85,
			negativePercentage: 5,
			neutralPercentage: 10,
			verdict: "GOD_TIER_BEAST",
			proPlayerConsensus: "Consensus unanime : la carte est un monstre.",
			trendingKeywords: ["beast", "cheat code", "broken"],
			topReviews: [],
			pricePredictionMultiplier: 1.08,
			sentimentCatalysts: ["Hype communautaire virale sur X (+85% positifs)"],
			sentimentRisks: [],
			lastUpdated: new Date().toISOString(),
		};

		const baselinePred = predictPlayerFuturePrice(mockMbappeCard, 2500000);
		const socialPred = predictPlayerFuturePrice(mockMbappeCard, 2500000, {
			communitySentiment: bullishSentiment,
		});

		// Short-term 12h and 24h predictions should reflect the social sentiment bonus
		expect(socialPred.forecasts["12h"].predictedPrice).toBeGreaterThan(
			baselinePred.forecasts["12h"].predictedPrice,
		);
		expect(socialPred.factors.communitySentimentBonusPercent).toBe(8);
		expect(socialPred.catalysts).toContain("Hype communautaire virale sur X (+85% positifs)");
		expect(socialPred.communitySentiment).toBeDefined();
		expect(socialPred.communitySentiment?.verdict).toBe("GOD_TIER_BEAST");
	});

	it("incorporates community sentiment into dual-platform (Console vs PC) prediction", () => {
		const bullishSentiment: PlayerCommunitySentiment = {
			playerName: "Mbappé",
			sampledTweetsCount: 20,
			sentimentScore: 88,
			positivePercentage: 80,
			negativePercentage: 10,
			neutralPercentage: 10,
			verdict: "GOD_TIER_BEAST",
			proPlayerConsensus: "Monstre compétitif",
			trendingKeywords: ["beast", "broken"],
			topReviews: [],
			pricePredictionMultiplier: 1.08,
			sentimentCatalysts: ["Hype virale"],
			sentimentRisks: [],
			lastUpdated: new Date().toISOString(),
		};

		const dual = predictPlayerDualPlatform(mockMbappeCard, {
			livePriceConsole: 2400000,
			livePricePc: 3100000,
			communitySentiment: bullishSentiment,
		});

		expect(dual.console.communitySentiment).toBeDefined();
		expect(dual.pc.communitySentiment).toBeDefined();
		expect(dual.console.factors.communitySentimentBonusPercent).toBe(8);
		expect(dual.pc.factors.communitySentimentBonusPercent).toBe(8);
		expect(dual.platformDisparity.pcPremiumPercent).toBeGreaterThan(20);
	});
});
