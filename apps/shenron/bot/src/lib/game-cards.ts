/**
 * Cartes visuelles des jeux de devinette (pendu, bingo), rendues avec le
 * canvas-kit : fond sombre, filet or 1 px, rayon 12, accents orange et or,
 * titres en Saiyan Sans, interface en Google Sans Flex. Aucune ombre portée.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { circlePath, drawDragonBall, fillRadialGlow, rgba, roundRectPath } from "~/lib/canvas-kit";
import { DIFFICULTY_LABELS, type GameDifficulty } from "~/services/games/difficulty";

const GAME_CARD_COLORS = {
	bgTop: "#1a0d05",
	bgBottom: "#0c0704",
	surface: "#1f1209",
	gold: "#fbbf24",
	goldSoft: "#fde68a",
	orange: "#f97316",
	text: "#e7d8c3",
	muted: "#a8927a",
	miss: "#f87171",
	missLine: "#ef4444",
	ink: "#1a0d05",
} as const;

const DIFFICULTY_ACCENTS: Record<GameDifficulty, string> = {
	facile: "#facc15",
	normal: "#f97316",
	difficile: "#ef4444",
};

type GameCardStatus = "playing" | "won" | "lost";

const SCALE = 2;
const PAD = 36;
const UI_FONT = "'Google Sans Flex', 'Inter', sans-serif";
const TITLE_FONT = "'Saiyan Sans', 'Inter Display Black', sans-serif";
const C = GAME_CARD_COLORS;

function newCard(w: number, h: number) {
	const canvas = createCanvas(w * SCALE, h * SCALE);
	const ctx = canvas.getContext("2d") as SKRSContext2D;
	ctx.scale(SCALE, SCALE);
	ctx.imageSmoothingEnabled = true;
	return { canvas, ctx };
}

function drawBackground(ctx: SKRSContext2D, w: number, h: number): void {
	ctx.save();
	roundRectPath(ctx, 0, 0, w, h, 12);
	ctx.clip();
	const bg = ctx.createLinearGradient(0, 0, 0, h);
	bg.addColorStop(0, C.bgTop);
	bg.addColorStop(1, C.bgBottom);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);
	fillRadialGlow(ctx, w - 90, 10, 300, C.orange, 0.2);
	fillRadialGlow(ctx, 40, h + 40, 260, C.gold, 0.07);
	ctx.restore();
	roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, 12);
	ctx.lineWidth = 1;
	ctx.strokeStyle = rgba(C.gold, 0.35);
	ctx.stroke();
}

function drawHeader(
	ctx: SKRSContext2D,
	w: number,
	title: string,
	subtitle: string,
	level: GameDifficulty,
	status: GameCardStatus
): void {
	ctx.save();
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	ctx.font = `48px ${TITLE_FONT}`;
	const grad = ctx.createLinearGradient(0, 28, 0, 72);
	grad.addColorStop(0, C.goldSoft);
	grad.addColorStop(1, C.orange);
	ctx.lineJoin = "round";
	ctx.lineWidth = 6;
	ctx.strokeStyle = "#2a1206";
	ctx.strokeText(title, PAD, 72);
	ctx.fillStyle = grad;
	ctx.fillText(title, PAD, 72);

	ctx.font = `500 17px ${UI_FONT}`;
	ctx.fillStyle = C.text;
	ctx.fillText(subtitle, PAD, 102);

	const accent = DIFFICULTY_ACCENTS[level];
	const label = DIFFICULTY_LABELS[level].toUpperCase();
	ctx.font = `700 14px ${UI_FONT}`;
	const bw = ctx.measureText(label).width + 30;
	const bx = w - PAD - bw;
	const by = 38;
	roundRectPath(ctx, bx, by, bw, 30, 15);
	ctx.fillStyle = rgba(accent, 0.14);
	ctx.fill();
	ctx.lineWidth = 1;
	ctx.strokeStyle = accent;
	ctx.stroke();
	ctx.fillStyle = accent;
	ctx.textAlign = "center";
	ctx.fillText(label, bx + bw / 2, by + 20);

	if (status !== "playing") {
		ctx.font = `800 20px ${UI_FONT}`;
		ctx.textAlign = "right";
		ctx.fillStyle = status === "won" ? C.gold : C.miss;
		ctx.fillText(status === "won" ? "VICTOIRE" : "DÉFAITE", w - PAD, 102);
	}
	ctx.restore();
}

// ─── Pendu ──────────────────────────────────────────────────────────────────

export interface PenduCardInput {
	word: string;
	found: ReadonlySet<string>;
	missed: ReadonlySet<string>;
	errors: number;
	maxErrors: number;
	status: GameCardStatus;
	level: GameDifficulty;
	category: string | null;
}

export async function renderPenduCard(input: PenduCardInput): Promise<Buffer> {
	const W = 960;
	const H = 432;
	const { canvas, ctx } = newCard(W, H);
	drawBackground(ctx, W, H);
	drawHeader(
		ctx,
		W,
		"PENDU",
		input.category ? `Indice : ${input.category}` : "Aucun indice",
		input.level,
		input.status
	);

	// Mot : une tuile par lettre, demi-tuile pour les espaces.
	const chars = [...input.word];
	const gapRatio = 0.16;
	const units = chars.reduce((n, c) => n + (c === " " ? 0.5 : 1), 0);
	const size = Math.min(62, (W - 2 * PAD) / (units + Math.max(0, chars.length - 1) * gapRatio));
	const gap = size * gapRatio;
	const tileH = size * 1.18;
	const total = units * size + Math.max(0, chars.length - 1) * gap;
	let x = (W - total) / 2;
	const y = 128 + (74 - tileH) / 2;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (const c of chars) {
		if (c === " ") {
			x += size * 0.5 + gap;
			continue;
		}
		const revealed = input.found.has(c);
		const showMissing = input.status !== "playing" && !revealed;
		roundRectPath(ctx, x, y, size, tileH, 10);
		ctx.fillStyle = revealed ? rgba(C.gold, 0.12) : C.surface;
		ctx.fill();
		ctx.lineWidth = 1;
		ctx.strokeStyle = revealed ? C.gold : showMissing ? C.missLine : rgba(C.gold, 0.22);
		ctx.stroke();
		if (revealed || showMissing) {
			ctx.font = `800 ${Math.round(size * 0.62)}px ${UI_FONT}`;
			ctx.fillStyle = revealed ? C.goldSoft : C.miss;
			ctx.fillText(c.toUpperCase(), x + size / 2, y + tileH / 2 + 1);
		} else {
			ctx.fillStyle = C.orange;
			ctx.fillRect(x + size * 0.28, y + tileH - 12, size * 0.44, 3);
		}
		x += size + gap;
	}
	ctx.restore();

	// Vies : une Dragon Ball par vie restante.
	const livesY = 258;
	const left = Math.max(0, input.maxErrors - input.errors);
	ctx.save();
	ctx.font = `700 13px ${UI_FONT}`;
	ctx.fillStyle = C.muted;
	ctx.textBaseline = "middle";
	ctx.fillText("VIES", PAD, livesY);
	for (let i = 0; i < input.maxErrors; i++) {
		const cx = PAD + 82 + i * 46;
		if (i < left) {
			drawDragonBall(ctx, cx, livesY, 17, i + 1);
		} else {
			circlePath(ctx, cx, livesY, 16);
			ctx.fillStyle = rgba("#ffffff", 0.04);
			ctx.fill();
			ctx.lineWidth = 1;
			ctx.strokeStyle = rgba(C.muted, 0.4);
			ctx.stroke();
		}
	}
	ctx.font = `800 24px ${UI_FONT}`;
	ctx.textAlign = "right";
	ctx.fillStyle = left <= 1 && input.status === "playing" ? C.miss : C.gold;
	ctx.fillText(`${left} / ${input.maxErrors}`, W - PAD, livesY);
	ctx.restore();

	// Clavier : lettres trouvées en or, ratées barrées en rouge.
	const rows = ["abcdefghijklm", "nopqrstuvwxyz"];
	const keyGap = 8;
	const keyW = (W - 2 * PAD - 12 * keyGap) / 13;
	const keyH = 46;
	const ky0 = 304;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `700 18px ${UI_FONT}`;
	rows.forEach((row, r) => {
		[...row].forEach((l, j) => {
			const kx = PAD + j * (keyW + keyGap);
			const ky = ky0 + r * (keyH + keyGap);
			const hit = input.found.has(l);
			const miss = input.missed.has(l);
			roundRectPath(ctx, kx, ky, keyW, keyH, 8);
			ctx.fillStyle = hit ? C.gold : miss ? rgba(C.missLine, 0.14) : C.surface;
			ctx.fill();
			ctx.lineWidth = 1;
			ctx.strokeStyle = hit ? C.gold : miss ? rgba(C.missLine, 0.6) : rgba(C.gold, 0.18);
			ctx.stroke();
			ctx.fillStyle = hit ? C.ink : miss ? C.miss : C.text;
			ctx.fillText(l.toUpperCase(), kx + keyW / 2, ky + keyH / 2 + 1);
			if (miss) {
				ctx.beginPath();
				ctx.moveTo(kx + keyW * 0.25, ky + keyH * 0.72);
				ctx.lineTo(kx + keyW * 0.75, ky + keyH * 0.28);
				ctx.lineWidth = 2;
				ctx.strokeStyle = rgba(C.missLine, 0.8);
				ctx.stroke();
			}
		});
	});
	ctx.restore();

	return canvas.encode("png");
}

// ─── Bingo ──────────────────────────────────────────────────────────────────

export interface BingoCardInput {
	min: number;
	max: number;
	range: { lo: number; hi: number };
	guesses: ReadonlyArray<{ value: number; hint: "higher" | "lower" | "match" }>;
	attemptsUsed: number | null;
	maxAttempts: number | null;
	status: GameCardStatus;
	level: GameDifficulty;
	target?: number;
	lastHint?: "higher" | "lower" | "match" | null;
}

export async function renderBingoCard(input: BingoCardInput): Promise<Buffer> {
	const W = 960;
	const H = 330;
	const { canvas, ctx } = newCard(W, H);
	drawBackground(ctx, W, H);
	drawHeader(
		ctx,
		W,
		"BINGO",
		`Nombre entre ${input.min} et ${input.max}`,
		input.level,
		input.status
	);

	const x0 = PAD;
	const x1 = W - PAD;
	const barY = 176;
	const barH = 20;
	const span = Math.max(1, input.max - input.min);
	const map = (v: number) => x0 + ((v - input.min) / span) * (x1 - x0);

	ctx.save();
	roundRectPath(ctx, x0, barY, x1 - x0, barH, barH / 2);
	ctx.fillStyle = C.surface;
	ctx.fill();
	ctx.lineWidth = 1;
	ctx.strokeStyle = rgba(C.gold, 0.22);
	ctx.stroke();

	const { lo, hi } = input.range;
	if (lo <= hi) {
		let xa = map(lo);
		let xb = map(hi);
		if (xb - xa < 8) {
			const mid = (xa + xb) / 2;
			xa = mid - 4;
			xb = mid + 4;
		}
		const fill = ctx.createLinearGradient(xa, 0, xb, 0);
		fill.addColorStop(0, C.orange);
		fill.addColorStop(1, C.gold);
		roundRectPath(ctx, xa, barY, xb - xa, barH, barH / 2);
		ctx.fillStyle = fill;
		ctx.fill();

		ctx.font = `800 20px ${UI_FONT}`;
		ctx.fillStyle = C.goldSoft;
		ctx.textBaseline = "alphabetic";
		if (lo === hi) {
			ctx.textAlign = "center";
			ctx.fillText(String(lo), (xa + xb) / 2, barY - 14);
		} else if (xb - xa < 110) {
			ctx.textAlign = "center";
			ctx.fillText(`${lo} – ${hi}`, Math.min(x1 - 60, Math.max(x0 + 60, (xa + xb) / 2)), barY - 14);
		} else {
			ctx.textAlign = "left";
			ctx.fillText(String(lo), xa, barY - 14);
			ctx.textAlign = "right";
			ctx.fillText(String(hi), xb, barY - 14);
		}
	}

	for (const g of input.guesses) {
		const gx = map(g.value);
		ctx.beginPath();
		ctx.moveTo(gx, barY - 6);
		ctx.lineTo(gx, barY + barH + 6);
		ctx.lineWidth = 2;
		ctx.strokeStyle = g.hint === "match" ? C.gold : rgba(C.miss, 0.85);
		ctx.stroke();
	}

	ctx.font = `600 15px ${UI_FONT}`;
	ctx.fillStyle = C.muted;
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	ctx.fillText(String(input.min), x0, barY + barH + 26);
	ctx.textAlign = "right";
	ctx.fillText(String(input.max), x1, barY + barH + 26);

	if (input.status !== "playing" && input.target !== undefined) {
		const tx = map(input.target);
		circlePath(ctx, tx, barY + barH / 2, 10);
		ctx.fillStyle = C.gold;
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = C.ink;
		ctx.stroke();
	}
	ctx.restore();

	// Essais + dernier indice.
	const rowY = 280;
	ctx.save();
	ctx.textBaseline = "middle";
	if (input.maxAttempts !== null && input.attemptsUsed !== null) {
		ctx.font = `700 13px ${UI_FONT}`;
		ctx.fillStyle = C.muted;
		ctx.textAlign = "left";
		ctx.fillText("ESSAIS", PAD, rowY);
		for (let i = 0; i < input.maxAttempts; i++) {
			const cx = PAD + 92 + i * 28;
			circlePath(ctx, cx, rowY, 9);
			if (i < input.attemptsUsed) {
				ctx.fillStyle = C.orange;
				ctx.fill();
			} else {
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = rgba(C.gold, 0.55);
				ctx.stroke();
			}
		}
	}
	let hint = "";
	let color: string = C.gold;
	if (input.status === "won" && input.target !== undefined) hint = `TROUVÉ : ${input.target}`;
	else if (input.status === "lost" && input.target !== undefined) {
		hint = `C'ÉTAIT ${input.target}`;
		color = C.miss;
	} else if (input.lastHint === "higher") {
		hint = "PLUS HAUT";
		color = C.orange;
	} else if (input.lastHint === "lower") {
		hint = "PLUS BAS";
		color = C.orange;
	}
	if (hint) {
		ctx.font = `800 30px ${UI_FONT}`;
		ctx.textAlign = "right";
		ctx.fillStyle = color;
		ctx.fillText(hint, W - PAD, rowY);
	}
	ctx.restore();

	return canvas.encode("png");
}
