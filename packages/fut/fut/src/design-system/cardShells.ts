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

export type CardShellId =
	| "gold_rare"
	| "gold_common"
	| "silver_rare"
	| "bronze_rare"
	| "icon_hero_white_gold"
	| "special_totw_ucl_black"
	| "evolution_emerald_green"
	| "cornerstone_pierre_angulaire"
	| "electric_blue_crystal";

export interface CardShellVisualSpec {
	id: CardShellId;
	displayNameFr: string;
	displayNameEn: string;
	backgroundGradient: string;
	borderStyle: string;
	textColor: string;
	accentGlow: string;
	badgePlateColor: string;
}

export const CARD_SHELL_SPECS: Record<CardShellId, CardShellVisualSpec> = {
	gold_rare: {
		id: "gold_rare",
		displayNameFr: "Or Rare",
		displayNameEn: "Gold Rare",
		backgroundGradient: "linear-gradient(145deg, #E6C875 0%, #BA9438 50%, #7E601B 100%)",
		borderStyle: "1px solid #FFDF73",
		textColor: "#261E05",
		accentGlow: "rgba(255, 215, 0, 0.4)",
		badgePlateColor: "#4A3B10",
	},
	gold_common: {
		id: "gold_common",
		displayNameFr: "Or Commun",
		displayNameEn: "Gold Common",
		backgroundGradient: "linear-gradient(145deg, #C2A658 0%, #9E8138 100%)",
		borderStyle: "1px solid #A88D44",
		textColor: "#2A2108",
		accentGlow: "rgba(186, 148, 56, 0.2)",
		badgePlateColor: "#3D3214",
	},
	silver_rare: {
		id: "silver_rare",
		displayNameFr: "Argent Rare",
		displayNameEn: "Silver Rare",
		backgroundGradient: "linear-gradient(145deg, #E2E8F0 0%, #94A3B8 50%, #475569 100%)",
		borderStyle: "1px solid #F1F5F9",
		textColor: "#0F172A",
		accentGlow: "rgba(226, 232, 240, 0.3)",
		badgePlateColor: "#1E293B",
	},
	bronze_rare: {
		id: "bronze_rare",
		displayNameFr: "Bronze Rare",
		displayNameEn: "Bronze Rare",
		backgroundGradient: "linear-gradient(145deg, #B45309 0%, #78350F 50%, #451A03 100%)",
		borderStyle: "1px solid #D97706",
		textColor: "#FEF3C7",
		accentGlow: "rgba(180, 83, 9, 0.3)",
		badgePlateColor: "#291205",
	},
	icon_hero_white_gold: {
		id: "icon_hero_white_gold",
		displayNameFr: "Héros / Icône Blanc Doré",
		displayNameEn: "Hero / Icon White Gold",
		backgroundGradient: "radial-gradient(ellipse at top, #FFFFFF 0%, #F1F5F9 45%, #CBD5E1 100%)",
		borderStyle: "2px solid #D4AF37",
		textColor: "#1E293B",
		accentGlow: "rgba(212, 175, 55, 0.5)",
		badgePlateColor: "#947A24",
	},
	special_totw_ucl_black: {
		id: "special_totw_ucl_black",
		displayNameFr: "Équipe de la Semaine / Spécial Noir",
		displayNameEn: "TOTW / Special Black",
		backgroundGradient: "linear-gradient(145deg, #1F2937 0%, #111827 50%, #030712 100%)",
		borderStyle: "1px solid rgba(255, 255, 255, 0.25)",
		textColor: "#F9FAFB",
		accentGlow: "rgba(255, 255, 255, 0.25)",
		badgePlateColor: "#374151",
	},
	evolution_emerald_green: {
		id: "evolution_emerald_green",
		displayNameFr: "Évolution Émeraude",
		displayNameEn: "Evolution Emerald",
		backgroundGradient: "linear-gradient(145deg, #064E3B 0%, #022C22 60%, #011A14 100%)",
		borderStyle: "1.5px solid #00FF85",
		textColor: "#ECFDF5",
		accentGlow: "0 0 16px rgba(0, 255, 133, 0.5)",
		badgePlateColor: "#047857",
	},
	cornerstone_pierre_angulaire: {
		id: "cornerstone_pierre_angulaire",
		displayNameFr: "Pierre Angulaire (Cornerstone)",
		displayNameEn: "Cornerstone Special",
		backgroundGradient: "linear-gradient(135deg, #4C1D95 0%, #1E1B4B 40%, #0E7490 85%, #06B6D4 100%)",
		borderStyle: "1.5px solid #A855F7",
		textColor: "#FAF5FF",
		accentGlow: "0 0 18px rgba(168, 85, 247, 0.45)",
		badgePlateColor: "#6B21A8",
	},
	electric_blue_crystal: {
		id: "electric_blue_crystal",
		displayNameFr: "Cristal Bleu Électrique (TOTW 1 / Promo)",
		displayNameEn: "Electric Blue Crystal",
		backgroundGradient: "linear-gradient(135deg, #0099FF 0%, #003366 50%, #001A33 100%)",
		borderStyle: "1.5px solid #00F0FF",
		textColor: "#E0F2FE",
		accentGlow: "0 0 20px rgba(0, 240, 255, 0.5)",
		badgePlateColor: "#0284C7",
	},
};

export class CardShellManager {
	public static getSpec(id: CardShellId): CardShellVisualSpec {
		return CARD_SHELL_SPECS[id] || CARD_SHELL_SPECS.gold_rare;
	}

	public static renderRoleBadge(roleText: string, tier: "+" | "++" = "+"): string {
		const isPlusPlus = tier === "++" || roleText.includes("++");
		const badgeColor = isPlusPlus ? "#00FF85" : "#10B981";
		const glow = isPlusPlus ? "0 0 8px rgba(0, 255, 133, 0.6)" : "none";
		return `
		<div class="fc-role-badge" style="
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 8px;
			background: rgba(10, 20, 30, 0.85);
			border: 1px solid ${badgeColor};
			border-radius: 9999px;
			color: ${badgeColor};
			font-size: 11px;
			font-weight: 700;
			box-shadow: ${glow};
		">
			<span>${roleText}</span>
			<span style="letter-spacing: -1px;">${isPlusPlus ? "++" : "+"}</span>
		</div>`;
	}

	public static renderPlayStyleBadge(name: string, isPlus = false): string {
		const bg = isPlus ? "linear-gradient(135deg, #FFD700 0%, #B45309 100%)" : "rgba(255, 255, 255, 0.15)";
		const text = isPlus ? "#000000" : "#FFFFFF";
		const border = isPlus ? "1px solid #FFE066" : "1px solid rgba(255, 255, 255, 0.25)";
		return `
		<div class="fc-playstyle-badge" style="
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 6px;
			background: ${bg};
			color: ${text};
			border: ${border};
			border-radius: 4px;
			font-size: 10px;
			font-weight: 700;
		">
			<span>❖</span>
			<span>${name}${isPlus ? "+" : ""}</span>
		</div>`;
	}
}
