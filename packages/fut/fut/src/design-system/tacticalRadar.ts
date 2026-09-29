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

export interface TacticalRadarMetrics {
	ATT: number; // 0 - 100
	DEF: number; // 0 - 100
	LAR: number; // 0 - 100 (Largeur)
	END: number; // 0 - 100 (Endurance)
	PRO: number; // 0 - 100 (Profondeur)
	CST: number; // 0 - 100 (Construction)
}

export class TacticalRadarRenderer {
	private static readonly AXES: (keyof TacticalRadarMetrics)[] = [
		"ATT",
		"DEF",
		"LAR",
		"END",
		"PRO",
		"CST",
	];

	/**
	 * Generates a responsive SVG markup of the FC IQ 6-axis tactical hexagon radar.
	 */
	public static renderSvg(
		metrics: TacticalRadarMetrics,
		options: { size?: number; showLabels?: boolean } = {},
	): string {
		const size = options.size ?? 240;
		const center = size / 2;
		const radius = (size / 2) * 0.75;
		const showLabels = options.showLabels ?? true;

		// 6 angles (60 degrees each, starting at -90 deg for top ATT)
		const getCoordinates = (index: number, val: number) => {
			const angle = (index * 60 - 90) * (Math.PI / 180);
			const r = (val / 100) * radius;
			const x = center + r * Math.cos(angle);
			const y = center + r * Math.sin(angle);
			return { x, y };
		};

		// Generate background concentric grid hexagons (25%, 50%, 75%, 100%)
		const gridLevels = [0.25, 0.5, 0.75, 1.0];
		const gridHexagons = gridLevels
			.map((lvl) => {
				const points = TacticalRadarRenderer.AXES.map((_, i) => {
					const pt = getCoordinates(i, lvl * 100);
					return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
				}).join(" ");
				return `<polygon points="${points}" fill="none" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />`;
			})
			.join("\n");

		// Radial axis spokes
		const axisSpokes = TacticalRadarRenderer.AXES.map((_, i) => {
			const pt = getCoordinates(i, 100);
			return `<line x1="${center}" y1="${center}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />`;
		}).join("\n");

		// Data polygon
		const dataPoints = TacticalRadarRenderer.AXES.map((axis, i) => {
			const val = Math.max(10, Math.min(100, metrics[axis]));
			const pt = getCoordinates(i, val);
			return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
		}).join(" ");

		// Labels
		const labels = showLabels
			? TacticalRadarRenderer.AXES.map((axis, i) => {
					const pt = getCoordinates(i, 118);
					return `
			<text x="${pt.x.toFixed(1)}" y="${pt.y.toFixed(1)}"
				fill="#CBD5E1"
				font-size="11"
				font-weight="700"
				font-family="system-ui, sans-serif"
				text-anchor="middle"
				dominant-baseline="central">
				${axis}
			</text>`;
			  }).join("\n")
			: "";

		return `
		<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="fc-tactical-radar">
			<defs>
				<linearGradient id="radarFillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stop-color="#00FF85" stop-opacity="0.45" />
					<stop offset="100%" stop-color="#0099FF" stop-opacity="0.2" />
				</linearGradient>
			</defs>
			${gridHexagons}
			${axisSpokes}
			<polygon points="${dataPoints}"
				fill="url(#radarFillGrad)"
				stroke="#00FF85"
				stroke-width="2"
				filter="drop-shadow(0 0 6px rgba(0, 255, 133, 0.5))" />
			${labels}
		</svg>`.trim();
	}
}
