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

/**
 * Frostbite UI Design System Tokens
 * Reverse-engineered directly from 4K in-game captures of EA SPORTS FC 27.
 */
export const FC27_DESIGN_TOKENS = {
	colors: {
		brand: {
			neonGreen: "#00FF85", // Pitch green glow / active state
			electricCyan: "#00F0FF", // Promo crystals & streaks
			deepPurple: "#7C3AED", // Cornerstone / Pierre Angulaire
			goldAccent: "#FFD700", // FUT Coins & Gold cards
			fcPointsGreen: "#10B981", // FC Points badge
			spViolet: "#A855F7", // Season Points (SP)
		},
		surfaces: {
			pitchDark: "#071210", // Primary pitch backdrop dark slate
			glassBase: "rgba(11, 16, 22, 0.85)", // Glassmorphism backdrop
			glassTile: "rgba(18, 28, 38, 0.72)", // 9-tile market filter grid
			glassElevated: "rgba(22, 33, 46, 0.88)", // Card inspect overlay
			glassModal: "rgba(14, 20, 28, 0.96)", // Pack opening modal
			hudTray: "rgba(8, 13, 19, 0.92)", // Bench & reserves tray
		},
		borders: {
			subtle: "rgba(255, 255, 255, 0.08)",
			medium: "rgba(255, 255, 255, 0.15)",
			active: "#00FF85",
			highlight: "rgba(0, 255, 133, 0.5)",
		},
		text: {
			primary: "#FFFFFF",
			secondary: "#94A3B8",
			muted: "#64748B",
			accentGreen: "#00FF85",
			accentYellow: "#FFD700",
			proCheck: "#22C55E",
			riskExclamation: "#FACC15",
			errorRed: "#EF4444",
		},
	},
	borders: {
		subtle: "rgba(255, 255, 255, 0.08)",
		medium: "rgba(255, 255, 255, 0.15)",
		active: "#00FF85",
		highlight: "rgba(0, 255, 133, 0.5)",
	},
	typography: {
		fontFamily: "system-ui, -apple-system, 'DIN Pro', 'Segoe UI', Roboto, sans-serif",
		headingTransform: "uppercase",
		weights: {
			regular: 400,
			medium: 500,
			semibold: 600,
			bold: 700,
			black: 900,
		},
	},
	glassmorphism: {
		backdropFilter: "blur(20px) saturate(180%)",
		boxShadowDefault: "0 8px 32px 0 rgba(0, 0, 0, 0.45)",
		boxShadowActive: "0 0 20px rgba(0, 255, 133, 0.35), 0 8px 32px 0 rgba(0, 0, 0, 0.5)",
		borderRadiusTile: "8px",
		borderRadiusCard: "12px",
		borderRadiusPill: "9999px",
	},
	cardDimensions: {
		aspectRatio: 0.68,
		standardWidth: 160,
		standardHeight: 235,
		miniWidth: 80,
		miniHeight: 118,
	},
} as const;

export type Fc27DesignTokens = typeof FC27_DESIGN_TOKENS;
