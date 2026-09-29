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

export interface BigDataStats {
	totalPlayers: number;
	totalClubs: number;
	totalNations: number;
	totalLeagues: number;
	averageRating: number;
	maxRating: number;
	topPlaystyles: Array<{ playstyle: string; count: number }>;
	ratingDistribution: Record<string, number>;
	genderDistribution: Record<string, number>;
}

export interface PlayerQueryFilter {
	name?: string;
	position?: string;
	minRating?: number;
	maxRating?: number;
	league?: string;
	nation?: string;
	club?: string;
	gender?: "Men" | "Women";
	minPace?: number;
	minShooting?: number;
	minPassing?: number;
	minDribbling?: number;
	minDefending?: number;
	minPhysical?: number;
	playstyles?: string[];
	playstylesPlus?: string[];
	accelerateType?: string;
	weakFootMin?: number;
	skillMovesMin?: number;
	sortBy?: "overall_rating" | "pac" | "sho" | "pas" | "dri" | "def" | "phy";
	sortOrder?: "ASC" | "DESC";
	limit?: number;
	offset?: number;
}

export interface PlayerRecord {
	id: string;
	name: string;
	overallRating: number;
	position: string;
	alternativePositions: string[];
	club: string;
	nation: string;
	league: string;
	rarity: string;
	gender: string;
	accelerateType: string;
	pac: number;
	sho: number;
	pas: number;
	dri: number;
	def: number;
	phy: number;
	skillMoves: number;
	weakFoot: number;
	foot: string;
	playstyles: string[];
	playstylesPlus: string[];
	url: string;
}
