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

export interface UtasSessionConfig {
	sid?: string;
	phishingToken?: string;
	personaId?: string;
	nucleusId?: string;
	gameSku?: string;
	gameYear?: string;
	cookiesPath?: string;
	sessionPath?: string;
	/**
	 * Called with every transfer-market result the client receives, so a caller
	 * can persist price observations without the client depending on a store.
	 * Failures inside the hook are swallowed: recording must never break a read.
	 */
	onAuctions?: (auctions: UtAuctionItem[], params: UtMarketSearchParams) => void;
}

export interface UtAuctionItem {
	tradeId: number;
	assetId: number;
	rating: number;
	itemType: string;
	rareflag: number;
	preferredPosition: string;
	startingBid: number;
	currentBid: number;
	buyNowPrice: number;
	expires: number;
	tradeState: string;
}

export interface UtMarketSearchParams {
	type?: "player" | "training" | "clubInfo" | "development";
	defId?: number;
	maskedDefId?: number;
	lev?: "gold" | "silver" | "bronze" | "special";
	pos?: string;
	nat?: number;
	leag?: number;
	team?: number;
	micr?: number; // min current bid
	macr?: number; // max current bid
	minb?: number; // min BIN
	maxb?: number; // max BIN
	num?: number;
	start?: number;
}

export interface UtClubInventoryStats {
	totalItems: number;
	credits: number;
	tradepileCount: number;
	watchlistCount: number;
}

/**
 * Trade-pile / watch-list style response. The UTAS `/tradepile`, `/watchlist`
 * and `/transfermarket` endpoints all return an `auctionInfo` array; the pile
 * endpoints additionally echo the live credit balance.
 */
export interface UtTradeItemsResult {
	items: UtAuctionItem[];
	credits: number;
	total: number;
}

/** A stackable consumable / development item from `/club/consumables/*`. */
export interface UtConsumableItem {
	resourceId: number;
	count: number;
	untradeableCount: number;
	discardValue: number;
	preferredPosition?: string;
	rating?: number;
	cardsubtypeid?: number;
}

/**
 * EA's allowed price band for one item definition, from
 * `/marketdata/item/pricelimits`. Listings outside `[minPrice, maxPrice]` are
 * rejected by the server, so this is the hard bound on any valuation.
 *
 * Field names mirror the web app's own mapping
 * (`{defId, itemId, priceLimits: ValueBand(minPrice, maxPrice)}`).
 */
export interface UtPriceBand {
	defId: number;
	itemId?: number;
	minPrice: number;
	maxPrice: number;
}

/** EA price bands keyed by definition id, with the untouched payload. */
export interface UtPriceLimits {
	bands: UtPriceBand[];
	byDefId: Record<number, UtPriceBand>;
	raw: unknown;
}

/**
 * One entry of EA's team-link table (`/chemistry/teamlinks`): an extra link a
 * team grants beyond its own club/league/nation, which is how Icons and Heroes
 * boost chemistry.
 */
export interface UtTeamLink {
	teamId: number;
	leagueId?: number;
	nationId?: number;
	linkedTeamIds?: number[];
	linkedLeagueIds?: number[];
	linkedNationIds?: number[];
}

/** EA's team-link reference table, with the untouched payload for fields we do not model yet. */
export interface UtChemistryTeamLinks {
	links: UtTeamLink[];
	raw: unknown;
}

/**
 * A chemistry threshold rule from `/chemistry/profiles`: how many team-mates
 * sharing a club / league / nation are needed to earn each chemistry point.
 */
export interface UtChemistryProfile {
	id?: number;
	name?: string;
	clubThresholds?: number[];
	leagueThresholds?: number[];
	nationThresholds?: number[];
}

/** EA's live chemistry rules, with the untouched payload for unmodelled fields. */
export interface UtChemistryProfiles {
	profiles: UtChemistryProfile[];
	raw: unknown;
}

/** A single club statistic entry from `/club/stats/club`. */
export interface UtClubStat {
	type: string;
	contextId: number;
	contextValue: number;
	typeValue: number;
}

export interface UtClubPlayerItem {
	id: number;
	assetId: number;
	resourceId: number;
	rating: number;
	itemType: string;
	rareflag: number;
	preferredPosition: string;
	possiblePositions?: string[];
	nation: number;
	leagueId: number;
	teamid: number;
	untradeable: boolean;
	discardValue: number;
	owners?: number;
	playStyle?: number;
	cardsubtypeid?: number;
	name?: string;

	// --- Item history -------------------------------------------------------
	// The web app surfaces all of this on a club item ("Élément acheté pour
	// 8 900", matches played, cards, injuries). Every field is optional: when
	// UTAS omits one it stays undefined rather than defaulting to a number that
	// would read as a real measurement.

	/** What this copy was bought for. The basis for any profit-and-loss figure. */
	lastSalePrice?: number;
	/** Loyalty bonus earned by playing matches with the item in the club. */
	loyaltyBonus?: number;
	/** Contract games remaining, when the item carries a contract. */
	contract?: number;
	/** Injury type and its remaining duration in games, when injured. */
	injuryType?: string;
	injuryGames?: number;
	/** Suspension games remaining. */
	suspension?: number;
	/** Per-item career totals as UTAS reports them (games, goals, assists, cards). */
	lifetimeStats?: Array<{ index: number; value: number }>;
	/** Stats accumulated with the current club only. */
	statsList?: Array<{ index: number; value: number }>;
}

export interface ClubSyncSummary {
	syncedAt: string;
	totalPlayers: number;
	untradeableCount: number;
	tradeableCount: number;
	fodderCountByRating: Record<number, number>;
	estimatedTotalValueCoins: {
		console: number;
		pc: number;
	};
	topCards: Array<{
		id: number;
		name?: string;
		rating: number;
		position: string;
		untradeable: boolean;
		estimatedPriceConsole: number;
		estimatedPricePc: number;
	}>;
}

export interface UtUserMassInfo {
	userInfo: {
		personaId: number;
		personaName: string;
		clubName: string;
		clubAbbr: string;
		credits: number;
		points: number;
		established: number;
		division: number;
	};
	deckLimits: {
		tradePileLimit: number;
		watchListLimit: number;
		unassignedPileLimit: number;
	};
	unassignedPileSize: number;
	currencies: Array<{ name: string; funds: number; finalFunds: number }>;
}

export interface UtBidResult {
	tradeId: number;
	bidAmount: number;
	success: boolean;
	currentBid: number;
	tradeState: string;
	creditsRemaining: number;
}

export interface UtListAuctionParams {
	itemId: number;
	startingBid: number;
	buyNowPrice: number;
	durationSeconds?: number;
}

export interface UtListAuctionResult {
	id: number;
	success: boolean;
}

export type UtItemPileTarget = "club" | "trade";

export interface UtItemMoveResult {
	success: boolean;
	itemId: number;
	pile: UtItemPileTarget;
}

export interface UtQuickSellResult {
	totalCredits: number;
	itemIds: number[];
}

export interface UtSessionData {
	sid: string;
	phishingToken: string;
	nucleusId?: string;
	personaId?: string;
	gameSku?: string;
	savedAt: string;
}

