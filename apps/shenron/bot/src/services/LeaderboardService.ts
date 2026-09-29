import { singleton, inject } from "tsyringe";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { BackgroundCacheService } from "./BackgroundCacheService";
import {
	drawDragonBall,
	drawImageCover,
	drawScanlines,
	kiScouterLabel,
	rgba,
	roundRectPath,
	textStroked,
	textWithShadow,
} from "~/lib/canvas-kit";

export interface LeaderboardEntry {
	id: string;
	username: string;
	avatarURL: string;
	xp: number;
	zeni: number;
}

export interface LeaderboardMeta {
	title: string;
	subtitle?: string;
	page: number;
	totalPages: number;
}

const BG_FILE = "assets/backgrounds/nebula/weighing-in-on-the-dumbbell-nebula.webp";

// Configuration Toriyama des médailles de podium
const PODIUM_CONFIG = {
	1: {
		label: "CHAMPION",
		kanji: "壱",
		ring: "#facc15",
		ringOuter: "#eab308",
		glow: "#fde047",
		stars: 4,
		accent: "#fbbf24",
		pedestalTop: "#ca8a04",
		pedestalBottom: "#1f1608",
	},
	2: {
		label: "CHALLENGER",
		kanji: "弐",
		ring: "#e2e8f0",
		ringOuter: "#94a3b8",
		glow: "#38bdf8",
		stars: 1,
		accent: "#94a3b8",
		pedestalTop: "#475569",
		pedestalBottom: "#0f172a",
	},
	3: {
		label: "GUERRIER",
		kanji: "参",
		ring: "#f97316",
		ringOuter: "#c2410c",
		glow: "#fb923c",
		stars: 3,
		accent: "#ea580c",
		pedestalTop: "#9a3412",
		pedestalBottom: "#1a0e08",
	},
} as const;

@singleton()
export class LeaderboardService {
	private avatarCache = new Map<string, Image>();

	constructor(@inject(BackgroundCacheService) private bgCache: BackgroundCacheService) {}

	private async loadAvatar(url: string): Promise<Image | null> {
		if (this.avatarCache.has(url)) return this.avatarCache.get(url)!;
		try {
			const img = await loadImage(url);
			this.avatarCache.set(url, img);
			return img;
		} catch {
			return null;
		}
	}

	private async loadBg(): Promise<Image | null> {
		return this.bgCache.get(BG_FILE);
	}

	async render(entries: LeaderboardEntry[], meta: LeaderboardMeta): Promise<Buffer> {
		const SCALE = 2;
		const W = 1100;
		const H = 720;
		const canvas = createCanvas(W * SCALE, H * SCALE);
		const ctx = canvas.getContext("2d") as SKRSContext2D;
		ctx.scale(SCALE, SCALE);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// ── Fond Toriyama : Espace / Nébuleuse & Grille Tactique Scouter ─────
		const CARD_R = 24;
		ctx.save();
		roundRectPath(ctx, 0, 0, W, H, CARD_R);
		ctx.clip();

		const bg = await this.loadBg();
		if (bg) {
			drawImageCover(ctx, bg, 0, 0, W, H);
			// Voile sombre texturé avec teinte bleue nuit Toriyama
			const bgOverlay = ctx.createLinearGradient(0, 0, W, H);
			bgOverlay.addColorStop(0, "rgba(9, 13, 24, 0.88)");
			bgOverlay.addColorStop(0.5, "rgba(15, 23, 42, 0.82)");
			bgOverlay.addColorStop(1, "rgba(5, 7, 13, 0.94)");
			ctx.fillStyle = bgOverlay;
			ctx.fillRect(0, 0, W, H);
		} else {
			const grad = ctx.createLinearGradient(0, 0, W, H);
			grad.addColorStop(0, "#0b0f19");
			grad.addColorStop(0.4, "#131b2e");
			grad.addColorStop(1, "#06080e");
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, W, H);
		}

		// Scanlines subtiles style Scouter CRT
		drawScanlines(ctx, 0, 0, W, H, "rgba(56, 189, 248, 0.025)", 4);

		// Grille tactique Scouter (lignes très discrètes)
		this.drawScouterGrid(ctx, W, H);

		// Particules de Ki flottantes (étincelles dorées et cyans)
		this.drawKiSparkles(ctx, W, H);

		// Dragon Balls décoratives aux angles supérieurs
		ctx.save();
		ctx.shadowColor = "rgba(245, 158, 11, 0.4)";
		ctx.shadowBlur = 20;
		drawDragonBall(ctx, 75, 65, 34, 7);
		drawDragonBall(ctx, W - 75, 65, 34, 4);
		ctx.restore();

		// Coins Scouter tactiques (crochets HUD Toriyama)
		this.drawHudBrackets(ctx, 16, 16, W - 32, H - 32, 28, "rgba(250, 204, 21, 0.6)");

		// ── En-tête : Typographie Saiyan & Badges ────────────────────────────
		const headerY = 52;
		// Micro-label Scouter
		textWithShadow(ctx, "DRAGON BALL FRANCE  ·  TACTICAL SCOUTER LEADERBOARD", W / 2, headerY - 24, {
			font: "700 11px 'Google Sans Flex', sans-serif",
			color: "rgba(56, 189, 248, 0.85)",
			align: "center",
		});

		// Titre principal percutant avec encrage franc (0.8% stroke)
		textStroked(ctx, meta.title.toUpperCase(), W / 2, headerY + 12, {
			font: "800 38px 'Google Sans Flex', sans-serif",
			color: "#fbbf24",
			stroke: "#000000",
			strokeWidth: 5,
			align: "center",
		});

		// Sous-titre ou statut
		if (meta.subtitle) {
			textWithShadow(ctx, meta.subtitle, W / 2, headerY + 36, {
				font: "600 14px 'Google Sans Flex', sans-serif",
				color: "rgba(255, 255, 255, 0.75)",
				shadow: "rgba(0,0,0,0.8)",
				blur: 6,
				align: "center",
			});
		}

		// Trait séparateur énergétique scouter sous l'en-tête
		const sepGrad = ctx.createLinearGradient(W / 2 - 280, 0, W / 2 + 280, 0);
		sepGrad.addColorStop(0, "rgba(250, 204, 21, 0)");
		sepGrad.addColorStop(0.2, "rgba(250, 204, 21, 0.6)");
		sepGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.9)");
		sepGrad.addColorStop(0.8, "rgba(250, 204, 21, 0.6)");
		sepGrad.addColorStop(1, "rgba(250, 204, 21, 0)");
		ctx.fillStyle = sepGrad;
		ctx.fillRect(W / 2 - 280, headerY + 46, 560, 2);

		// ── Structure du contenu (Page 1 = Podium + Reste, Page 2+ = Grille 10)
		const isFirstPage = meta.page === 1;

		if (isFirstPage && entries.length > 0) {
			// Mode Podium (Top 3) + Liste (4 à 10)
			const podium = entries.slice(0, 3);
			const slots: Array<{
				rank: 1 | 2 | 3;
				cx: number;
				cy: number;
				avR: number;
				height: number;
			}> = [];

			if (podium.length >= 1) slots.push({ rank: 1, cx: W / 2, cy: 195, avR: 58, height: 130 });
			if (podium.length >= 2) slots.push({ rank: 2, cx: W / 2 - 275, cy: 222, avR: 47, height: 110 });
			if (podium.length >= 3) slots.push({ rank: 3, cx: W / 2 + 275, cy: 222, avR: 47, height: 95 });

			// Dessin des podiums
			for (const slot of slots) {
				const entry = podium[slot.rank - 1];
				if (!entry) continue;
				await this.drawPodiumSlot(ctx, entry, slot);
			}

			// Reste (positions 4-10)
			const rest = entries.slice(3, 10);
			if (rest.length > 0) {
				const LIST_Y = 412;
				const ROW_H = 34;
				const LIST_X = 75;
				const LIST_W = W - 150;
				const maxRestXp = Math.max(...entries.map((e) => e.xp), 1);

				// Panneau cadre d'encre Toriyama
				ctx.save();
				roundRectPath(ctx, LIST_X, LIST_Y, LIST_W, ROW_H * rest.length + 22, 14);
				ctx.fillStyle = "rgba(7, 11, 20, 0.78)";
				ctx.fill();
				ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
				ctx.lineWidth = 3;
				ctx.stroke();
				ctx.strokeStyle = "rgba(250, 204, 21, 0.25)";
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.restore();

				for (let i = 0; i < rest.length; i++) {
					const e = rest[i]!;
					const y = LIST_Y + 12 + i * ROW_H;
					const rank = 4 + i;
					await this.drawListRow(ctx, e, rank, LIST_X + 10, y, LIST_W - 20, ROW_H, maxRestXp);
				}
			}
		} else if (entries.length > 0) {
			// Page 2+ : Affichage optimisé en pleine hauteur pour 10 combattants
			const LIST_Y = 120;
			const ROW_H = 49;
			const LIST_X = 75;
			const LIST_W = W - 150;
			const maxXp = Math.max(...entries.map((e) => e.xp), 1);

			// Cadre global
			ctx.save();
			roundRectPath(ctx, LIST_X, LIST_Y, LIST_W, ROW_H * entries.length + 18, 16);
			ctx.fillStyle = "rgba(7, 11, 20, 0.82)";
			ctx.fill();
			ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
			ctx.lineWidth = 3;
			ctx.stroke();
			ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.restore();

			for (let i = 0; i < entries.length; i++) {
				const e = entries[i]!;
				const y = LIST_Y + 10 + i * ROW_H;
				const rank = (meta.page - 1) * 10 + 1 + i;
				await this.drawListRow(ctx, e, rank, LIST_X + 12, y, LIST_W - 24, ROW_H, maxXp);
			}
		}

		// ── Pied de page tactique ───────────────────────────────────────────
		const footerY = H - 24;
		// Petit séparateur
		ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(80, footerY - 14);
		ctx.lineTo(W - 80, footerY - 14);
		ctx.stroke();

		// Info page & total
		textWithShadow(
			ctx,
			`PAGE ${meta.page} / ${meta.totalPages}   ·   ${entries.length} GUERRIERS ACTIFS`,
			W / 2,
			footerY,
			{
				font: "700 13px 'Google Sans Flex', sans-serif",
				color: "rgba(250, 204, 21, 0.9)",
				shadow: "rgba(0,0,0,0.9)",
				blur: 4,
				align: "center",
			}
		);

		// Badge système
		textWithShadow(ctx, "SHENRON KI ENGINE v2.4", W - 90, footerY, {
			font: "600 11px 'Google Sans Flex', sans-serif",
			color: "rgba(56, 189, 248, 0.5)",
			align: "right",
		});

		textWithShadow(ctx, "SYSTEM: ACTIVE", 90, footerY, {
			font: "600 11px 'Google Sans Flex', sans-serif",
			color: "rgba(34, 197, 94, 0.6)",
			align: "left",
		});

		ctx.restore();
		return canvas.encode("png");
	}

	/**
	 * Dessine un slot de podium (Top 1, 2 ou 3) avec esthétique Toriyama :
	 * médailles brillantes, auras de Ki additives, cadre d'encre et badges.
	 */
	private async drawPodiumSlot(
		ctx: SKRSContext2D,
		entry: LeaderboardEntry,
		slot: {
			rank: 1 | 2 | 3;
			cx: number;
			cy: number;
			avR: number;
			height: number;
		}
	): Promise<void> {
		const { rank, cx, cy, avR, height } = slot;
		const cfg = PODIUM_CONFIG[rank];

		// 1. Piédestal géométrique avec encrage franc
		const P_W = 185;
		const P_H = height;
		const P_TOP_Y = cy + avR + 32;

		ctx.save();
		roundRectPath(ctx, cx - P_W / 2, P_TOP_Y, P_W, P_H, 12);
		const pGrad = ctx.createLinearGradient(0, P_TOP_Y, 0, P_TOP_Y + P_H);
		pGrad.addColorStop(0, rgba(cfg.pedestalTop, 0.65));
		pGrad.addColorStop(0.4, "rgba(18, 24, 38, 0.9)");
		pGrad.addColorStop(1, cfg.pedestalBottom);
		ctx.fillStyle = pGrad;
		ctx.fill();

		// Contour d'encre net Toriyama
		ctx.strokeStyle = "#000000";
		ctx.lineWidth = 3;
		ctx.stroke();

		// Filet métallique interne
		ctx.strokeStyle = cfg.ring;
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();

		// Watermark chiffre géant dans le piédestal
		ctx.save();
		ctx.globalAlpha = 0.16;
		textStroked(ctx, String(rank), cx, P_TOP_Y + P_H - 12, {
			font: "900 88px 'Google Sans Flex', sans-serif",
			color: cfg.ring,
			stroke: "#000000",
			strokeWidth: 4,
			align: "center",
		});
		ctx.restore();

		// Badge Kanji sur le piédestal
		ctx.save();
		ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
		roundRectPath(ctx, cx - 18, P_TOP_Y - 14, 36, 26, 6);
		ctx.fill();
		ctx.strokeStyle = cfg.ring;
		ctx.lineWidth = 1.5;
		ctx.stroke();
		textWithShadow(ctx, cfg.kanji, cx, P_TOP_Y + 5, {
			font: "700 16px 'Google Sans Flex', sans-serif",
			color: cfg.ring,
			align: "center",
		});
		ctx.restore();

		// 2. Aura de Ki étincelante autour de l'avatar (multi-couches additives)
		ctx.save();
		ctx.globalCompositeOperation = "screen";
		for (let i = 4; i > 0; i--) {
			const auraR = avR + i * 13;
			const g = ctx.createRadialGradient(cx, cy, avR * 0.4, cx, cy, auraR);
			g.addColorStop(0, rgba(cfg.glow, 0.45));
			g.addColorStop(0.6, rgba(cfg.glow, 0.12));
			g.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = g;
			ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);
		}
		ctx.restore();

		// 3. Avatar circulaire avec anneau d'or/argent/bronze et encrage
		const avatar = await this.loadAvatar(entry.avatarURL);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, avR, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		if (avatar) {
			ctx.drawImage(avatar, cx - avR, cy - avR, avR * 2, avR * 2);
		} else {
			ctx.fillStyle = "#1e293b";
			ctx.fillRect(cx - avR, cy - avR, avR * 2, avR * 2);
		}
		ctx.restore();

		// Anneau extérieur d'encre (stroke noir franc)
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, avR + 4, 0, Math.PI * 2);
		ctx.strokeStyle = "#000000";
		ctx.lineWidth = 5;
		ctx.stroke();

		// Anneau métallique coloré brillant
		ctx.beginPath();
		ctx.arc(cx, cy, avR + 2, 0, Math.PI * 2);
		ctx.strokeStyle = cfg.ring;
		ctx.lineWidth = 3.5;
		ctx.shadowColor = cfg.glow;
		ctx.shadowBlur = 14;
		ctx.stroke();
		ctx.restore();

		// Mini Dragon Ball sur l'épaule de l'avatar (4 étoiles pour le #1 !)
		ctx.save();
		const dbR = rank === 1 ? 16 : 13;
		const dbX = cx + avR - 10;
		const dbY = cy - avR + 12;
		ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
		ctx.shadowBlur = 6;
		drawDragonBall(ctx, dbX, dbY, dbR, cfg.stars);
		ctx.restore();

		// 4. Pseudo du guerrier sous l'avatar (fond badge d'encre)
		const nameText = truncate(entry.username, 16);
		ctx.save();
		ctx.font = "700 16px 'Google Sans Flex', sans-serif";
		const nameW = ctx.measureText(nameText).width;
		roundRectPath(ctx, cx - nameW / 2 - 10, cy + avR + 5, nameW + 20, 24, 6);
		ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
		ctx.fill();
		ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
		ctx.lineWidth = 2;
		ctx.stroke();

		textWithShadow(ctx, nameText, cx, cy + avR + 22, {
			font: "700 15px 'Google Sans Flex', sans-serif",
			color: "#ffffff",
			shadow: "rgba(0,0,0,0.9)",
			blur: 4,
			align: "center",
		});
		ctx.restore();

		// 5. Statistiques dans le piédestal (XP Scouter + Zénis)
		textWithShadow(ctx, "PUISSANCE (KI)", cx, P_TOP_Y + P_H / 2 - 12, {
			font: "800 10px 'Google Sans Flex', sans-serif",
			color: "rgba(56, 189, 248, 0.85)",
			align: "center",
		});

		textStroked(ctx, `${kiScouterLabel(entry.xp)} U`, cx, P_TOP_Y + P_H / 2 + 15, {
			font: "900 26px 'Google Sans Flex', sans-serif",
			color: cfg.ring,
			stroke: "#000000",
			strokeWidth: 3.5,
			align: "center",
		});

		textWithShadow(ctx, `${kiScouterLabel(entry.zeni)} Ƶ`, cx, P_TOP_Y + P_H / 2 + 35, {
			font: "600 12px 'Google Sans Flex', sans-serif",
			color: "rgba(250, 204, 21, 0.9)",
			shadow: "rgba(0,0,0,0.9)",
			blur: 4,
			align: "center",
		});
	}

	/**
	 * Dessine une ligne détaillée de la liste (positions 4-10 ou page 2+)
	 * avec avatar, jauge de progression, rank badge et lecture scouter nette.
	 */
	private async drawListRow(
		ctx: SKRSContext2D,
		entry: LeaderboardEntry,
		rank: number,
		x: number,
		y: number,
		w: number,
		h: number,
		maxXp: number
	): Promise<void> {
		// Fond de la ligne avec alternance subtile et contour d'encre
		const isEven = rank % 2 === 0;
		ctx.save();
		roundRectPath(ctx, x, y, w, h - 4, 8);
		ctx.fillStyle = isEven ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.055)";
		ctx.fill();

		// Filet d'accent gauche
		ctx.fillStyle = rank <= 5 ? "rgba(250, 204, 21, 0.7)" : "rgba(56, 189, 248, 0.4)";
		ctx.fillRect(x, y + 3, 3, h - 10);
		ctx.restore();

		// Badge Rang (#4, #5...)
		const rankBoxW = 42;
		ctx.save();
		roundRectPath(ctx, x + 8, y + 4, rankBoxW, h - 12, 6);
		ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
		ctx.fill();
		ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		textWithShadow(ctx, `#${rank}`, x + 8 + rankBoxW / 2, y + (h - 4) / 2 + 5, {
			font: "800 13px 'Google Sans Flex', sans-serif",
			color: rank <= 5 ? "#fbbf24" : "rgba(255, 255, 255, 0.75)",
			align: "center",
		});
		ctx.restore();

		// Avatar miniature
		const avSize = Math.max(20, h - 14);
		const avX = x + rankBoxW + 16;
		const avY = y + (h - 4 - avSize) / 2;
		const avatar = await this.loadAvatar(entry.avatarURL);

		ctx.save();
		ctx.beginPath();
		ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		if (avatar) {
			ctx.drawImage(avatar, avX, avY, avSize, avSize);
		} else {
			ctx.fillStyle = "#334155";
			ctx.fillRect(avX, avY, avSize, avSize);
		}
		ctx.restore();

		// Contour d'encre sur le mini avatar
		ctx.save();
		ctx.beginPath();
		ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
		ctx.strokeStyle = "#000000";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.strokeStyle = "rgba(250, 204, 21, 0.4)";
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();

		// Nom du combattant
		const nameX = avX + avSize + 12;
		textWithShadow(ctx, truncate(entry.username, 20), nameX, y + (h - 4) / 2 + 5, {
			font: "700 14px 'Google Sans Flex', sans-serif",
			color: "#f8fafc",
			shadow: "rgba(0,0,0,0.8)",
			blur: 4,
			align: "left",
		});

		// Jauge de niveau / énergie Toriyama (entre le nom et les scores)
		const gaugeW = 120;
		const gaugeH = 6;
		const gaugeX = x + w - 340;
		const gaugeY = y + (h - 4 - gaugeH) / 2;
		const ratio = Math.max(0.04, Math.min(1, entry.xp / maxXp));

		ctx.save();
		roundRectPath(ctx, gaugeX, gaugeY, gaugeW, gaugeH, 3);
		ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
		ctx.fill();
		ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
		ctx.lineWidth = 0.5;
		ctx.stroke();

		// Remplissage néon énergie
		if (ratio > 0) {
			ctx.save();
			roundRectPath(ctx, gaugeX, gaugeY, gaugeW * ratio, gaugeH, 3);
			ctx.clip();
			const gGrad = ctx.createLinearGradient(gaugeX, 0, gaugeX + gaugeW, 0);
			gGrad.addColorStop(0, "#0284c7");
			gGrad.addColorStop(0.6, "#38bdf8");
			gGrad.addColorStop(1, "#facc15");
			ctx.fillStyle = gGrad;
			ctx.fillRect(gaugeX, gaugeY, gaugeW * ratio, gaugeH);
			ctx.restore();
		}
		ctx.restore();

		// Score XP (Scouter Power Level)
		textWithShadow(ctx, `${kiScouterLabel(entry.xp)} u`, x + w - 170, y + (h - 4) / 2 + 5, {
			font: "800 14px 'Google Sans Flex', sans-serif",
			color: "#38bdf8",
			shadow: "rgba(0,0,0,0.8)",
			blur: 4,
			align: "right",
		});

		// Zénis (pièces dorées)
		textWithShadow(ctx, `${kiScouterLabel(entry.zeni)} z`, x + w - 30, y + (h - 4) / 2 + 5, {
			font: "700 14px 'Google Sans Flex', sans-serif",
			color: "#fbbf24",
			shadow: "rgba(0,0,0,0.8)",
			blur: 4,
			align: "right",
		});
	}

	/** Grille Scouter discrète */
	private drawScouterGrid(ctx: SKRSContext2D, w: number, h: number): void {
		ctx.save();
		ctx.strokeStyle = "rgba(56, 189, 248, 0.02)";
		ctx.lineWidth = 1;
		const step = 40;
		for (let x = 0; x < w; x += step) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
			ctx.stroke();
		}
		for (let y = 0; y < h; y += step) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
			ctx.stroke();
		}
		ctx.restore();
	}

	/** Particules d'étincelles de Ki */
	private drawKiSparkles(ctx: SKRSContext2D, w: number, h: number): void {
		ctx.save();
		const sparkles = [
			{ x: 140, y: 150, r: 2, c: "#facc15" },
			{ x: 220, y: 340, r: 1.5, c: "#38bdf8" },
			{ x: 380, y: 180, r: 2.5, c: "#facc15" },
			{ x: 720, y: 190, r: 2, c: "#fde047" },
			{ x: 880, y: 350, r: 1.5, c: "#38bdf8" },
			{ x: 960, y: 160, r: 2, c: "#facc15" },
			{ x: 550, y: 110, r: 3, c: "#ffffff" },
		];
		for (const s of sparkles) {
			ctx.beginPath();
			ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
			ctx.fillStyle = s.c;
			ctx.shadowColor = s.c;
			ctx.shadowBlur = 8;
			ctx.fill();
		}
		ctx.restore();
	}

	/** Crochets tactiques HUD Toriyama aux angles */
	private drawHudBrackets(
		ctx: SKRSContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		len: number,
		color: string
	): void {
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2.5;

		// Haut-gauche
		ctx.beginPath();
		ctx.moveTo(x, y + len);
		ctx.lineTo(x, y);
		ctx.lineTo(x + len, y);
		ctx.stroke();

		// Haut-droite
		ctx.beginPath();
		ctx.moveTo(x + w - len, y);
		ctx.lineTo(x + w, y);
		ctx.lineTo(x + w, y + len);
		ctx.stroke();

		// Bas-gauche
		ctx.beginPath();
		ctx.moveTo(x, y + h - len);
		ctx.lineTo(x, y + h);
		ctx.lineTo(x + len, y + h);
		ctx.stroke();

		// Bas-droite
		ctx.beginPath();
		ctx.moveTo(x + w - len, y + h);
		ctx.lineTo(x + w, y + h);
		ctx.lineTo(x + w, y + h - len);
		ctx.stroke();

		ctx.restore();
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
