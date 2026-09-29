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

import type { MarketFilterMatrix } from "../filters/filterMatrix.ts";
import { CardShellManager, type CardShellId } from "./cardShells.ts";
import { TacticalRadarRenderer, type TacticalRadarMetrics } from "./tacticalRadar.ts";
import { FC27_DESIGN_TOKENS } from "./tokens.ts";

export interface RenderableCardPlayer {
	name: string;
	rating: number;
	position: string;
	shellId: CardShellId;
	nation?: string;
	club?: string;
	stats?: {
		PAC: number;
		SHO: number;
		PAS: number;
		DRI: number;
		DEF: number;
		PHY: number;
	};
	roleBadge?: string;
	playStylePlus?: string;
}

export class Fc27ComponentRenderer {
	/**
	 * Renders a full FC 27 Player Card with authentic shell gradient, stats and badges.
	 */
	public static renderPlayerCard(player: RenderableCardPlayer): string {
		const spec = CardShellManager.getSpec(player.shellId);
		const stats = player.stats ?? { PAC: 80, SHO: 80, PAS: 80, DRI: 80, DEF: 80, PHY: 80 };

		const roleHtml = player.roleBadge ? CardShellManager.renderRoleBadge(player.roleBadge) : "";
		const playStyleHtml = player.playStylePlus
			? CardShellManager.renderPlayStyleBadge(player.playStylePlus, true)
			: "";

		return `
		<div class="fc-card-container" style="
			width: 160px;
			height: 235px;
			background: ${spec.backgroundGradient};
			border: ${spec.borderStyle};
			border-radius: 12px;
			padding: 10px;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			position: relative;
			box-shadow: ${spec.accentGlow ? `0 8px 24px ${spec.accentGlow}` : "0 8px 24px rgba(0,0,0,0.5)"};
			font-family: ${FC27_DESIGN_TOKENS.typography.fontFamily};
			color: ${spec.textColor};
			user-select: none;
			overflow: hidden;
		">
			<!-- Header: OVR + POS -->
			<div style="display: flex; justify-content: space-between; align-items: flex-start;">
				<div>
					<div style="font-size: 26px; font-weight: 900; line-height: 1;">${player.rating}</div>
					<div style="font-size: 13px; font-weight: 700; text-transform: uppercase;">${player.position}</div>
				</div>
				<div>${playStyleHtml}</div>
			</div>

			<!-- Player Name & Club Ribbon -->
			<div style="text-align: center; margin-top: 40px;">
				<div style="font-size: 14px; font-weight: 800; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
					${player.name}
				</div>
				<div style="font-size: 10px; opacity: 0.8; font-weight: 600;">
					${player.club ?? ""} ${player.nation ? `• ${player.nation}` : ""}
				</div>
			</div>

			<!-- 6 Core Attributes Grid -->
			<div style="
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 2px 12px;
				font-size: 11px;
				font-weight: 700;
				padding: 6px 4px;
				background: rgba(0, 0, 0, 0.15);
				border-radius: 6px;
			">
				<div style="display: flex; justify-content: space-between;"><span>${stats.PAC}</span><span style="opacity: 0.7;">RAP</span></div>
				<div style="display: flex; justify-content: space-between;"><span>${stats.DRI}</span><span style="opacity: 0.7;">DRI</span></div>
				<div style="display: flex; justify-content: space-between;"><span>${stats.SHO}</span><span style="opacity: 0.7;">TIR</span></div>
				<div style="display: flex; justify-content: space-between;"><span>${stats.DEF}</span><span style="opacity: 0.7;">DÉF</span></div>
				<div style="display: flex; justify-content: space-between;"><span>${stats.PAS}</span><span style="opacity: 0.7;">PAS</span></div>
				<div style="display: flex; justify-content: space-between;"><span>${stats.PHY}</span><span style="opacity: 0.7;">PHY</span></div>
			</div>

			<!-- Bottom Role Badge -->
			<div style="display: flex; justify-content: center; margin-top: 2px;">
				${roleHtml}
			</div>
		</div>`.trim();
	}

	/**
	 * Renders the 9-tile Transfer Market Search Filters Matrix (screen: tx_ui_ut_transfermarket_search_filters_grid).
	 */
	public static renderMarketFilterGrid(matrix: MarketFilterMatrix): string {
		const tiles = matrix.generateGridTiles();
		const tilesHtml = tiles
			.map(
				(t) => `
			<div class="fc-filter-tile" style="
				background: ${FC27_DESIGN_TOKENS.colors.surfaces.glassTile};
				border: ${FC27_DESIGN_TOKENS.borders.subtle};
				border-radius: ${FC27_DESIGN_TOKENS.glassmorphism.borderRadiusTile};
				padding: 16px;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
				min-height: 110px;
				transition: all 0.15s ease;
				cursor: pointer;
			">
				<div style="font-size: 14px; font-weight: 700; color: #FFFFFF; text-transform: uppercase;">
					${t.labelFr}
				</div>
				<div style="font-size: 16px; font-weight: 800; color: #94A3B8; margin-top: 8px;">
					${t.currentDisplayValue}
				</div>
			</div>`,
			)
			.join("\n");

		return `
		<div class="fc-market-filter-grid" style="
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 16px;
			padding: 24px;
			background: ${FC27_DESIGN_TOKENS.colors.surfaces.glassBase};
			border-radius: 16px;
			backdrop-filter: ${FC27_DESIGN_TOKENS.glassmorphism.backdropFilter};
			font-family: ${FC27_DESIGN_TOKENS.typography.fontFamily};
			max-width: 960px;
		">
			${tilesHtml}
		</div>`.trim();
	}

	/**
	 * Renders FC IQ Collective Tactics Overview card with share code and 6-axis tactical radar.
	 */
	public static renderTacticsCard(options: {
		shareCode: string;
		formation: string;
		buildUpStyle: string;
		defensiveApproach: string;
		pros: string[];
		risks: string[];
		metrics: TacticalRadarMetrics;
	}): string {
		const radarSvg = TacticalRadarRenderer.renderSvg(options.metrics, { size: 200 });

		const prosHtml = options.pros
			.map((p) => `<div style="color: #22C55E; font-size: 12px; font-weight: 600;">✓ ${p}</div>`)
			.join("\n");
		const risksHtml = options.risks
			.map((r) => `<div style="color: #FACC15; font-size: 12px; font-weight: 600;">! ${r}</div>`)
			.join("\n");

		return `
		<div class="fc-tactics-card" style="
			display: flex;
			gap: 24px;
			padding: 20px;
			background: ${FC27_DESIGN_TOKENS.colors.surfaces.glassElevated};
			border: ${FC27_DESIGN_TOKENS.borders.subtle};
			border-radius: 12px;
			font-family: ${FC27_DESIGN_TOKENS.typography.fontFamily};
			color: #FFFFFF;
		">
			<div style="flex: 1;">
				<div style="font-size: 11px; color: #94A3B8; text-transform: uppercase;">Tactique active</div>
				<div style="font-size: 20px; font-weight: 900; margin: 4px 0;">${options.formation}</div>
				<div style="display: inline-block; padding: 4px 10px; background: rgba(0, 255, 133, 0.15); border: 1px solid #00FF85; border-radius: 9999px; color: #00FF85; font-size: 12px; font-weight: 700; margin-bottom: 12px;">
					Code : ${options.shareCode}
				</div>
				<div style="font-size: 12px; color: #E2E8F0; margin-bottom: 8px;">
					Style : <strong>${options.buildUpStyle}</strong> • Bloc : <strong>${options.defensiveApproach}</strong>
				</div>
				<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 4px;">
					${prosHtml}
					${risksHtml}
				</div>
			</div>
			<div style="display: flex; align-items: center; justify-content: center;">
				${radarSvg}
			</div>
		</div>`.trim();
	}
}
