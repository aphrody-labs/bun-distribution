/**
 * Toriyama SVG Engine — Official Color Palette Tokens.
 *
 * Measured from Akira Toriyama original color tankobon covers, artbooks (Daizenshuu),
 * and official production model sheets.
 */

export const TORIYAMA_PALETTE = {
	/** Goku Gi signature colors */
	goku: {
		orange: "#f85b1a",
		blue: "#1b365d",
		red: "#de1b22",
		beltNavy: "#0d1b2a",
		wristband: "#1d3557",
	},

	/** Turtle School (Kame House) */
	kame: {
		orange: "#ff6b00",
		yellow: "#fed700",
		crestWhite: "#ffffff",
		crestBlack: "#121417",
	},

	/** King Kai (Kaio-sama) Crest */
	kai: {
		black: "#111111",
		white: "#f8f9fa",
		redRing: "#d90429",
	},

	/** Piccolo & Demon Clan (Namekian / Mazoku) */
	piccolo: {
		skinGreen: "#40916c",
		skinShade: "#2d6a4f",
		musclePink: "#f72585",
		giPurple: "#5a189a",
		capeWhite: "#f8f9fa",
	},

	/** Capsule Corporation */
	capsule: {
		cyan: "#00b4d8",
		lightCyan: "#90e0ef",
		deepBlue: "#0077b6",
		hullWhite: "#ffffff",
		metalGray: "#6c757d",
	},

	/** Red Ribbon Army */
	redRibbon: {
		scarletRed: "#d90429",
		ribbonDark: "#9d0208",
		letterWhite: "#ffffff",
		blackAccent: "#121417",
	},

	/** Majin Babidi Brand */
	majin: {
		ink: "#121417",
		darkViolet: "#3a0ca3",
		auraPink: "#f72585",
	},

	/** Dragon Ball crystal sphere amber gradient & stars */
	dragonBall: {
		amberLight: "#fdffea",
		amberMid: "#fce7a6",
		amberDeep: "#ef9a2b",
		starRed: "#e81f23",
		inkRing: "#000000",
	},

	/** Dragon Radar */
	radar: {
		bodyGreen: "#2ec4b6",
		screenDark: "#0b2528",
		gridGreen: "#00f5d4",
		blipRed: "#ff0054",
		blipYellow: "#fee440",
		buttonSilver: "#e0e1dd",
	},

	/** Scouter HUD target reticle */
	scouter: {
		hudGreen: "#00ff66",
		hudRed: "#ff0033",
		hudBlue: "#00e5ff",
		lensGreen: "rgba(0, 255, 102, 0.18)",
		lensRed: "rgba(255, 0, 51, 0.18)",
		lensBlue: "rgba(0, 229, 255, 0.18)",
	},

	/** Super Saiyan Ki Aura */
	superSaiyan: {
		auraGold: "#ffd700",
		auraAmber: "#ff9e00",
		coreWhite: "#ffffff",
		lightningBlue: "#00f0ff",
	},

	/** Divine Dragon Shenron */
	shenron: {
		scaleEmerald: "#2d6a4f",
		bellyGold: "#ffb703",
		hornBrown: "#6f4e37",
		eyeCrimson: "#e63946",
	},

	/** Manga Print Baseline */
	print: {
		ink: "#121417",
		paper: "#f7f4ea",
		halftoneDot: "rgba(18, 20, 23, 0.14)",
	},
} as const;

export type ToriyamaPalette = typeof TORIYAMA_PALETTE;
