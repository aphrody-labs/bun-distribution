/**
 * Génère les 7 visuels provisoires qui remplacent des fan-arts retirés de
 * public/dbz/transformations/. Ce sont des placeholders générés par Shenron,
 * jamais des illustrations officielles Dragon Ball : leur texte le dit
 * explicitement. Usage : bun apps/site/scripts/generate-transformation-placeholders.ts
 */
import sharp from "sharp";
import { join } from "node:path";

interface PlaceholderDef {
	filename: string;
	characterName: string;
	transformationName: string;
	japaneseTitle: string;
	badgeKanji: string;
	accentColor: string;
	glowColor: string;
}

const PLACEHOLDERS: PlaceholderDef[] = [
	{
		filename: "freezer-perfect-form.webp",
		characterName: "FREEZER",
		transformationName: "FORME FINALE",
		japaneseTitle: "フリーザ（最終形態）",
		badgeKanji: "帝",
		accentColor: "#a855f7",
		glowColor: "rgba(168, 85, 247, 0.25)",
	},
	{
		filename: "gohan-ssj.webp",
		characterName: "SON GOHAN",
		transformationName: "SUPER SAIYAN",
		japaneseTitle: "孫悟飯（超サイヤ人）",
		badgeKanji: "悟",
		accentColor: "#ffea00",
		glowColor: "rgba(255, 234, 0, 0.25)",
	},
	{
		filename: "gohan-beast.webp",
		characterName: "SON GOHAN",
		transformationName: "GOHAN BEAST",
		japaneseTitle: "孫悟飯ビースト",
		badgeKanji: "獣",
		accentColor: "#c084fc",
		glowColor: "rgba(192, 132, 252, 0.3)",
	},
	{
		filename: "trunks-ssj.webp",
		characterName: "TRUNKS DU FUTUR",
		transformationName: "SUPER SAIYAN",
		japaneseTitle: "トランクス（超サイヤ人）",
		badgeKanji: "未",
		accentColor: "#ffea00",
		glowColor: "rgba(255, 234, 0, 0.25)",
	},
	{
		filename: "majin-buu-gotenks.webp",
		characterName: "MAJIN BOO",
		transformationName: "GOTENKS ABSORBÉ",
		japaneseTitle: "魔人ブウ（ゴテンクス吸収）",
		badgeKanji: "魔",
		accentColor: "#f472b6",
		glowColor: "rgba(244, 114, 182, 0.25)",
	},
	{
		filename: "gogeta-ssj.webp",
		characterName: "GOGETA",
		transformationName: "SUPER SAIYAN",
		japaneseTitle: "超ゴジータ",
		badgeKanji: "合",
		accentColor: "#ffb200",
		glowColor: "rgba(255, 178, 0, 0.25)",
	},
	{
		filename: "gogeta-ssjb-evolved.webp",
		characterName: "GOGETA",
		transformationName: "SUPER SAIYAN BLUE EVOLUTION",
		japaneseTitle: "ゴジータ（超サイヤ人ゴッドSS・進化）",
		badgeKanji: "神",
		accentColor: "#38bdf8",
		glowColor: "rgba(56, 189, 248, 0.3)",
	},
];

function generateSvg(p: PlaceholderDef): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <defs>
    <radialGradient id="auraGlow" cx="50%" cy="45%" r="45%">
      <stop offset="0%" stop-color="${p.glowColor}" stop-opacity="1"/>
      <stop offset="60%" stop-color="${p.glowColor}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#0a0a0a" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dotGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#ffffff" fill-opacity="0.04"/>
    </pattern>
    <linearGradient id="badgeBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.accentColor}"/>
      <stop offset="100%" stop-color="#2a2a26"/>
    </linearGradient>
  </defs>

  <!-- Fond obscur DBZ -->
  <rect width="800" height="1200" fill="#0a0a0a"/>
  <rect width="800" height="1200" fill="url(#dotGrid)"/>
  <rect width="800" height="1200" fill="url(#auraGlow)"/>

  <!-- Cadre décoratif extérieur -->
  <rect x="30" y="30" width="740" height="1140" fill="none" stroke="#2a2a26" stroke-width="1.5" rx="16"/>
  <rect x="42" y="42" width="716" height="1116" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1" rx="12"/>

  <!-- Coins stylisés DBZ -->
  <path d="M 30 70 L 30 30 L 70 30" fill="none" stroke="${p.accentColor}" stroke-width="3"/>
  <path d="M 770 70 L 770 30 L 730 30" fill="none" stroke="${p.accentColor}" stroke-width="3"/>
  <path d="M 30 1130 L 30 1170 L 70 1170" fill="none" stroke="${p.accentColor}" stroke-width="3"/>
  <path d="M 770 1130 L 770 1170 L 730 1170" fill="none" stroke="${p.accentColor}" stroke-width="3"/>

  <!-- Badge Kanji central -->
  <g transform="translate(400, 480)">
    <!-- Halos de puissance -->
    <circle cx="0" cy="0" r="190" fill="none" stroke="${p.accentColor}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="6,6"/>
    <circle cx="0" cy="0" r="160" fill="#141410" stroke="url(#badgeBorder)" stroke-width="4"/>
    <circle cx="0" cy="0" r="142" fill="none" stroke="${p.accentColor}" stroke-opacity="0.3" stroke-width="2"/>
    <circle cx="0" cy="0" r="115" fill="#f7f3ea"/>
    <!-- Kanji calligraphique -->
    <text x="0" y="8" text-anchor="middle" dominant-baseline="central" font-family="'Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', serif" font-weight="900" font-size="125" fill="#15120d">${p.badgeKanji}</text>
  </g>

  <!-- En-tête / Catégorie -->
  <text x="400" y="110" text-anchor="middle" font-family="'Google Sans Flex', -apple-system, sans-serif" font-weight="700" font-size="16" letter-spacing="4" fill="${p.accentColor}">SHENRON • VISUEL PROVISOIRE</text>
  <text x="400" y="138" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-weight="500" font-size="13" letter-spacing="2" fill="#888884">PLACEHOLDER GÉNÉRÉ — NON OFFICIEL</text>

  <!-- Ligne séparatrice haute -->
  <line x1="280" y1="165" x2="520" y2="165" stroke="#2a2a26" stroke-width="1.5"/>

  <!-- Typographie & Nom de la forme -->
  <text x="400" y="740" text-anchor="middle" font-family="'Google Sans Flex', -apple-system, sans-serif" font-weight="800" font-size="28" letter-spacing="3" fill="#ffffff">${p.characterName}</text>
  <text x="400" y="785" text-anchor="middle" font-family="'Google Sans Flex', -apple-system, sans-serif" font-weight="700" font-size="22" letter-spacing="1.5" fill="${p.accentColor}">${p.transformationName}</text>
  <text x="400" y="825" text-anchor="middle" font-family="'Noto Sans JP', sans-serif" font-weight="500" font-size="18" letter-spacing="2" fill="#a0a09a">${p.japaneseTitle}</text>

  <!-- Séparateur bas -->
  <line x1="240" y1="875" x2="560" y2="875" stroke="#2a2a26" stroke-width="1.5"/>
  <circle cx="400" cy="875" r="4" fill="${p.accentColor}"/>

  <!-- Notice de provenance : placeholder généré, pas une illustration officielle -->
  <text x="400" y="930" text-anchor="middle" font-family="'Google Sans Flex', -apple-system, sans-serif" font-weight="500" font-size="14" fill="#888884">ILLUSTRATION OFFICIELLE NON ENCORE SOURCÉE</text>
  <text x="400" y="955" text-anchor="middle" font-family="'Google Sans Flex', -apple-system, sans-serif" font-weight="400" font-size="13" fill="#666662">Image générée par Shenron en remplacement d’un fan-art retiré</text>

  <!-- Cartouche bas / Sceau -->
  <rect x="220" y="1040" width="360" height="42" fill="#141410" stroke="#2a2a26" stroke-width="1" rx="8"/>
  <text x="400" y="1066" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-weight="600" font-size="12" letter-spacing="2" fill="${p.accentColor}">PLACEHOLDER • NON OFFICIEL</text>
</svg>`;
}

async function main() {
	const outDir = join(import.meta.dir, "..", "public", "dbz", "transformations");
	console.log("=== GÉNÉRATION DES 7 PLACEHOLDERS DE TRANSFORMATIONS (non officiels) ===");
	for (const p of PLACEHOLDERS) {
		const svg = generateSvg(p);
		const targetFile = join(outDir, p.filename);
		await sharp(Buffer.from(svg))
			.webp({ quality: 90 })
			.toFile(targetFile);
		console.log(`✓ Placeholder généré: ${p.filename} (${p.transformationName})`);
	}
	console.log("=== SUCCÈS : 7/7 fan-arts retirés et remplacés par des placeholders générés (non officiels) ===");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
