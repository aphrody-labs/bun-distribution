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

import { z } from "zod";

export const MarketCategorySchema = z.enum([
	"player",
	"consumables",
	"stadium",
	"staff",
]);
export type MarketCategory = z.infer<typeof MarketCategorySchema>;

export const CardRarityGroupSchema = z.enum([
	"all",
	"bronze_common",
	"bronze_rare",
	"silver_common",
	"silver_rare",
	"gold_common",
	"gold_rare",
	"totw",
	"ucl_rttk",
	"trailblazers",
	"centurions",
	"cornerstones", // Pierre Angulaire as seen on Sávio 83
	"heroes",
	"icons",
	"evolutions_in_progress",
	"evolutions_completed",
	"squad_foundations",
	"potm",
	"flashback",
	"special",
]);
export type CardRarityGroup = z.infer<typeof CardRarityGroupSchema>;

export const PositionGroupSchema = z.enum([
	"all",
	"attackers", // ST, CF, RW, LW, RF, LF
	"midfielders", // CAM, CM, CDM, LM, RM
	"defenders", // CB, LB, RB, LWB, RWB
	"goalkeepers", // GK
]);
export type PositionGroup = z.infer<typeof PositionGroupSchema>;

export const SpecificPositionSchema = z.enum([
	"GK",
	"CB",
	"LB",
	"RB",
	"LWB",
	"RWB",
	"CDM",
	"CM",
	"CAM",
	"LM",
	"RM",
	"LW",
	"RW",
	"CF",
	"ST",
]);
export type SpecificPosition = z.infer<typeof SpecificPositionSchema>;

export const ChemistryStyleFilterSchema = z.enum([
	"all",
	"basic",
	"sniper",
	"finisher",
	"deadeye",
	"marksman",
	"hawk",
	"artist",
	"architect",
	"powerhouse",
	"maestro",
	"engine",
	"sentinel",
	"guardian",
	"gladiator",
	"backbone",
	"anchor",
	"shadow",
	"hunter",
	"catalyst",
	"wall",
	"shield",
	"cat",
	"glove",
]);
export type ChemistryStyleFilter = z.infer<typeof ChemistryStyleFilterSchema>;

export interface PriceFilterRange {
	minBid?: number;
	maxBid?: number;
	minBuyNow?: number;
	maxBuyNow?: number;
}

export interface MarketFilterQuery {
	category?: MarketCategory;
	name?: string;
	defId?: number;
	rarity?: CardRarityGroup;
	position?: SpecificPosition | PositionGroup;
	playStyleId?: string;
	playStyleTier?: "any" | "regular" | "plus";
	chemStyle?: ChemistryStyleFilter;
	pricing?: PriceFilterRange;
	nationId?: number;
	leagueId?: number;
	teamId?: number;
	page?: number;
	pageSize?: number;
}

export interface FilterTileDefinition {
	id: string;
	labelFr: string;
	labelEn: string;
	icon: string;
	currentDisplayValue: string;
	shortcutKey: string;
}
