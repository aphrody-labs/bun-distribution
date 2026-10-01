/**
 * canvas-kit — primitives de rendu 2D partagées.
 *
 * Extraites de `CardService` + `commands/fun/Scan.ts`, réutilisables par les
 * futurs canvases (/top, /fusion, /shop, /gay, /raciste, /bingo, /morpion, /pfc, /pendu).
 *
 * Pas de logique métier ici — uniquement des helpers sans état.
 * L'enregistrement des fonts est fait au chargement de ce module (side effect),
 * donc `import "~/lib/canvas-kit"` suffit à garantir leur disponibilité.
 */
import { existsSync } from "node:fs";
import { GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { botFile } from "~/lib/asset-files";
import { logger } from "~/lib/logger";

// ─── Fonts ────────────────────────────────────────────────────────────────

/** Racine `apps/shenron/bot` vue depuis ce module (indépendante du cwd). */
const BOT_ROOT = `${import.meta.dir}/../..`;

/**
 * Enregistrement des fonts — idempotent au niveau module.
 * Ne throw jamais : fallback silencieux sur sans-serif si un fichier manque.
 */
function registerFonts(): void {
	const fonts: Array<[string, string]> = [
		// Google Sans Flex — police principale (variable, axes opsz+wght). Skia
		// (@napi-rs/canvas) sélectionne le poids via la font string (`600 24px ...`).
		// Une seule famille pour tous les poids grâce à l'axe wght variable.
		["GoogleSansFlex.ttf", "Google Sans Flex"],
		// Legacy conservées en fallback (anciennes cartes / accents).
		["Inter-Medium.ttf", "Inter"],
		["Inter-SemiBold.ttf", "Inter SemiBold"],
		["Inter-Bold.ttf", "Inter Bold"],
		["Inter-ExtraBold.ttf", "Inter ExtraBold"],
		["InterDisplay-Black.ttf", "Inter Display Black"],
		["Teko-SemiBold.ttf", "Teko SemiBold"],
		["Teko-Bold.ttf", "Teko Bold"],
		["SaiyanSans.ttf", "Saiyan Sans"],
		["SaiyanSans-LeftOblique.ttf", "Saiyan Sans Oblique"],
		["DBSScouter.ttf", "DBS Scouter"],
		["NotoColorEmoji.ttf", "Noto Color Emoji"],
	];
	for (const [file, family] of fonts) {
		try {
			const primaryPath = botFile(`assets/fonts/${file}`, BOT_ROOT);
			if (existsSync(primaryPath)) {
				GlobalFonts.registerFromPath(primaryPath, family);
			} else if (file === "NotoColorEmoji.ttf") {
				const canonical = `${BOT_ROOT}/../../../crates/web/obscura-render/assets/noto-color-emoji.ttf`;
				if (existsSync(canonical)) {
					GlobalFonts.registerFromPath(canonical, family);
				}
			}
		} catch (err) {
			logger.debug({ err, file, family }, "Font non chargée (fallback sans-serif)");
		}
	}
}
registerFonts();

// ─── Couleurs ──────────────────────────────────────────────────────────────

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export function hexToRgb(hex: string): Rgb {
	if (!hex || typeof hex !== "string") return { r: 255, g: 255, b: 255 };
	const clean = hex.replace("#", "").trim();
	if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) {
		return { r: 255, g: 255, b: 255 };
	}
	const expanded =
		clean.length === 3
			? clean
					.split("")
					.map((c) => c + c)
					.join("")
			: clean.slice(0, 6);
	const n = parseInt(expanded, 16);
	if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex: string, alpha: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Éclaircit une couleur hex de `amount` (0-1). */
function lighten(hex: string, amount: number): string {
	const { r, g, b } = hexToRgb(hex);
	const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount));
	return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Assombrit une couleur hex de `amount` (0-1). */
function darken(hex: string, amount: number): string {
	const { r, g, b } = hexToRgb(hex);
	const mix = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
	return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ─── Paths ─────────────────────────────────────────────────────────────────

export function roundRectPath(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
	ctx.lineTo(x + radius, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

export function circlePath(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.closePath();
}

// ─── Effets ────────────────────────────────────────────────────────────────

/** Glow radial centré — remplit un carré englobant. */
export function fillRadialGlow(
	ctx: SKRSContext2D,
	cx: number,
	cy: number,
	r: number,
	hex: string,
	opacity = 0.8
): void {
	const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
	grad.addColorStop(0, rgba(hex, opacity));
	grad.addColorStop(1, rgba(hex, 0));
	ctx.fillStyle = grad;
	ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** Scanlines horizontales style CRT/scouter. */
export function drawScanlines(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	color: string,
	step = 4
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	for (let yy = y; yy < y + h; yy += step) {
		ctx.beginPath();
		ctx.moveTo(x, yy);
		ctx.lineTo(x + w, yy);
		ctx.stroke();
	}
	ctx.restore();
}

/** Gauge / barre de progression horizontale arrondie. */
export function drawGauge(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	ratio: number,
	opts: { bg: string; fill: string; stroke?: string; radius?: number } = {
		bg: "#1f2937",
		fill: "#fbbf24",
	}
): void {
	const clamped = Math.max(0, Math.min(1, ratio));
	const radius = opts.radius ?? h / 2;
	ctx.save();
	// Fond
	roundRectPath(ctx, x, y, w, h, radius);
	ctx.fillStyle = opts.bg;
	ctx.fill();
	// Fill
	if (clamped > 0) {
		ctx.save();
		roundRectPath(ctx, x, y, w, h, radius);
		ctx.clip();
		ctx.fillStyle = opts.fill;
		ctx.fillRect(x, y, w * clamped, h);
		ctx.restore();
	}
	// Contour
	if (opts.stroke) {
		roundRectPath(ctx, x, y, w, h, radius);
		ctx.lineWidth = 1;
		ctx.strokeStyle = opts.stroke;
		ctx.stroke();
	}
	ctx.restore();
}

// ─── Texte ─────────────────────────────────────────────────────────────────

export interface TextShadowOptions {
	color: string;
	font: string;
	shadow?: string;
	blur?: number;
	offsetY?: number;
	align?: CanvasTextAlign;
}

export function textWithShadow(
	ctx: SKRSContext2D,
	text: string,
	x: number,
	y: number,
	options: TextShadowOptions
): void {
	ctx.save();
	ctx.font = options.font;
	if (options.align) ctx.textAlign = options.align;
	if (options.shadow) {
		ctx.shadowColor = options.shadow;
		ctx.shadowBlur = options.blur ?? 8;
		ctx.shadowOffsetY = options.offsetY ?? 2;
	}
	ctx.fillStyle = options.color;
	ctx.fillText(text, x, y);
	ctx.restore();
}

export interface TextStrokedOptions {
	color: string;
	stroke: string;
	strokeWidth: number;
	font: string;
	align?: CanvasTextAlign;
}

export function textStroked(
	ctx: SKRSContext2D,
	text: string,
	x: number,
	y: number,
	options: TextStrokedOptions
): void {
	ctx.save();
	ctx.font = options.font;
	if (options.align) ctx.textAlign = options.align;
	ctx.lineWidth = options.strokeWidth;
	ctx.strokeStyle = options.stroke;
	ctx.lineJoin = "round";
	ctx.miterLimit = 2;
	ctx.strokeText(text, x, y);
	ctx.fillStyle = options.color;
	ctx.fillText(text, x, y);
	ctx.restore();
}

/**
 * Texte "double-police" : superpose deux polices différentes pour créer un
 * effet relief / bichromie typique des affiches DBZ. Usage :
 *
 *   - une font "back" en plus large + glow / décalage subtil (Saiyan Sans)
 *   - une font "front" plus rectiligne par-dessus (Inter Display Black)
 *
 * Les deux polices doivent partager le même tracé de baseline (mêmes `align`)
 * pour que la superposition reste lisible.
 */
interface TextDoubleFontOptions {
	back: {
		font: string;
		color: string;
		offsetX?: number;
		offsetY?: number;
		blur?: number;
	};
	front: { font: string; color: string };
	align?: CanvasTextAlign;
}

function textDoubleFont(
	ctx: SKRSContext2D,
	text: string,
	x: number,
	y: number,
	opts: TextDoubleFontOptions
): void {
	ctx.save();
	if (opts.align) ctx.textAlign = opts.align;

	// Couche arrière : décalée + flou
	ctx.save();
	ctx.font = opts.back.font;
	ctx.fillStyle = opts.back.color;
	if (opts.back.blur) {
		ctx.shadowColor = opts.back.color;
		ctx.shadowBlur = opts.back.blur;
	}
	ctx.fillText(text, x + (opts.back.offsetX ?? 2), y + (opts.back.offsetY ?? 2));
	ctx.restore();

	// Couche avant : nette
	ctx.font = opts.front.font;
	ctx.fillStyle = opts.front.color;
	ctx.fillText(text, x, y);
	ctx.restore();
}

// ─── Formes thématiques DBZ ───────────────────────────────────────────────

export function drawStar(
	ctx: SKRSContext2D,
	cx: number,
	cy: number,
	r: number,
	points = 5,
	color = "#ffffff"
): void {
	ctx.save();
	ctx.beginPath();
	for (let i = 0; i < points * 2; i++) {
		const angle = (i * Math.PI) / points - Math.PI / 2;
		const radius = i % 2 === 0 ? r : r / 2.2;
		const x = cx + Math.cos(angle) * radius;
		const y = cy + Math.sin(angle) * radius;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
}

/** Dragon Ball avec étoile(s) rouge(s). starCount 1-7. */
export function drawDragonBall(
	ctx: SKRSContext2D,
	cx: number,
	cy: number,
	r: number,
	starCount: number
): void {
	const grad = ctx.createRadialGradient(cx - r / 3, cy - r / 3, r / 8, cx, cy, r);
	grad.addColorStop(0, "#fef3c7");
	grad.addColorStop(0.35, "#f59e0b");
	grad.addColorStop(1, "#c2410c");
	ctx.fillStyle = grad;
	circlePath(ctx, cx, cy, r);
	ctx.fill();

	ctx.strokeStyle = "rgba(124, 45, 18, 0.5)";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	const starR = r * 0.18;
	const ring = r * 0.45;
	if (starCount === 1) {
		drawStar(ctx, cx, cy, starR, 5, "#b91c1c");
	} else {
		for (let i = 0; i < starCount; i++) {
			const angle = (i * 2 * Math.PI) / starCount - Math.PI / 2;
			drawStar(ctx, cx + Math.cos(angle) * ring, cy + Math.sin(angle) * ring, starR, 5, "#b91c1c");
		}
	}

	// Reflet
	const shine = ctx.createRadialGradient(
		cx - r / 2.2,
		cy - r / 2.2,
		0,
		cx - r / 3,
		cy - r / 3,
		r / 2.5
	);
	shine.addColorStop(0, "rgba(255, 255, 255, 0.6)");
	shine.addColorStop(1, "rgba(255, 255, 255, 0)");
	ctx.fillStyle = shine;
	circlePath(ctx, cx, cy, r);
	ctx.fill();
}

// ─── Images ────────────────────────────────────────────────────────────────

/**
 * Dessine une image en mode `object-fit: cover` — remplit la zone cible en
 * préservant le ratio, crop ce qui dépasse. Évite la distorsion des
 * backgrounds d'aspects variés.
 */
export function drawImageCover(
	ctx: SKRSContext2D,
	img: { width: number; height: number },
	dx: number,
	dy: number,
	dw: number,
	dh: number
): void {
	const srcRatio = img.width / img.height;
	const dstRatio = dw / dh;
	let sx = 0;
	let sy = 0;
	let sw = img.width;
	let sh = img.height;
	if (srcRatio > dstRatio) {
		// source plus large → crop gauche/droite
		sw = img.height * dstRatio;
		sx = (img.width - sw) / 2;
	} else {
		// source plus haute → crop haut/bas
		sh = img.width / dstRatio;
		sy = (img.height - sh) / 2;
	}
	// @ts-expect-error signature drawImage 9-arg
	ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// ─── Formatters ────────────────────────────────────────────────────────────

/** Compresse un nombre en K / M / B / T (pour affichage scouter). */
export function kiScouterLabel(n: number): string {
	if (n >= 1e12) return `${(n / 1e12).toFixed(1).replace(/\.0$/, "")}T`;
	if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
	return String(n);
}
