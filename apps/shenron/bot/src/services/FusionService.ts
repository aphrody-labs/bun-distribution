import { singleton, inject } from "tsyringe";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { User } from "discord.js";
import { BackgroundCacheService } from "./BackgroundCacheService";
import { DatabaseService } from "~/db/index";
import {
	drawImageCover,
	drawStar,
	rgba,
	roundRectPath,
	textStroked,
	textWithShadow,
} from "~/lib/canvas-kit";

/**
 * Canvas fusion — deux états :
 *   - state: "propose"  → "FUSION ?" avec 2 avatars séparés et VS central
 *   - state: "success"  → "FUSIOOON-HA !!" avec 2 avatars fusionnés + nom canonique
 */

export interface FusionInput {
	a: User;
	b: User;
	state: "propose" | "success";
	fusedName?: string; // requis si state = success
}

const BG_FILE = "assets/backgrounds/aurora/aurora-borealis-at-kennedy-space-center.webp";
const COLOR_A = "#F85B1A"; // orange Goku
const COLOR_B = "#2955DC"; // bleu Vegeta
const COLOR_FUSION = "#ec4899"; // rose central

@singleton()
export class FusionService {
	private avatarCache = new Map<string, Image>();

	constructor(
		@inject(BackgroundCacheService) private bgCache: BackgroundCacheService,
		@inject(DatabaseService) private dbs: DatabaseService
	) {}

	private get db() {
		return this.dbs.db;
	}

	/** Retourne la fusion active d'un utilisateur si elle existe. */
	async getFusion(userId: string) {
		const row = await this.db.query.fusions.findFirst({
			where: (f, { or, eq }) => or(eq(f.userA, userId), eq(f.userB, userId)),
		});
		if (!row) return null;
		const partnerId = row.userA === userId ? row.userB : row.userA;
		return { ...row, partnerId };
	}

	private async loadAvatar(user: User): Promise<Image | null> {
		const url = user.displayAvatarURL({
			extension: "png",
			size: 256,
			forceStatic: true,
		});
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

	async render(input: FusionInput): Promise<Buffer> {
		const SCALE = 2;
		const W = 900;
		const H = 380;
		const canvas = createCanvas(W * SCALE, H * SCALE);
		const ctx = canvas.getContext("2d") as SKRSContext2D;
		ctx.scale(SCALE, SCALE);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// ── Fond ───────────────────────────────────────────────────────────
		ctx.save();
		roundRectPath(ctx, 0, 0, W, H, 28);
		ctx.clip();

		const bg = await this.loadBg();
		if (bg) {
			drawImageCover(ctx, bg, 0, 0, W, H);
			ctx.fillStyle = "rgba(0,0,0,0.68)";
			ctx.fillRect(0, 0, W, H);
		} else {
			const grad = ctx.createLinearGradient(0, 0, W, 0);
			grad.addColorStop(0, "#1a0a2e");
			grad.addColorStop(0.5, "#3a0420");
			grad.addColorStop(1, "#0a0f3d");
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, W, H);
		}

		// Étoiles décoratives
		ctx.save();
		ctx.globalAlpha = 0.4;
		drawStar(ctx, 80, 60, 8, 5, "#fef3c7");
		drawStar(ctx, W - 90, 80, 10, 5, "#fef3c7");
		drawStar(ctx, W - 50, H - 70, 6, 5, "#fef3c7");
		drawStar(ctx, 50, H - 60, 7, 5, "#fef3c7");
		ctx.restore();

		// ── Titre ──────────────────────────────────────────────────────────
		const title = input.state === "success" ? "FUSIOOON-HA !!" : "PROPOSITION DE FUSION";
		textStroked(ctx, title, W / 2, 56, {
			font: "800 34px 'Google Sans Flex', sans-serif",
			color: input.state === "success" ? "#fbbf24" : "#f1f5f9",
			stroke: "rgba(0,0,0,0.9)",
			strokeWidth: 4,
			align: "center",
		});

		// ── Avatars ────────────────────────────────────────────────────────
		const AV_R = 78;
		const AV_Y = 180;
		const AV_CX_A = 210;
		const AV_CX_B = W - 210;

		if (input.state === "propose") {
			// Deux avatars séparés + "VS" central
			await this.drawAvatarWithAura(ctx, input.a, AV_CX_A, AV_Y, AV_R, COLOR_A);
			await this.drawAvatarWithAura(ctx, input.b, AV_CX_B, AV_Y, AV_R, COLOR_B);

			// Centre : VS + point d'interrogation
			textStroked(ctx, "?", W / 2, 195, {
				font: "800 110px 'Google Sans Flex', sans-serif",
				color: COLOR_FUSION,
				stroke: "rgba(0,0,0,0.8)",
				strokeWidth: 5,
				align: "center",
			});
			// Petit glow rose autour
			ctx.save();
			ctx.globalCompositeOperation = "screen";
			const g = ctx.createRadialGradient(W / 2, 180, 10, W / 2, 180, 100);
			g.addColorStop(0, rgba(COLOR_FUSION, 0.3));
			g.addColorStop(1, rgba(COLOR_FUSION, 0));
			ctx.fillStyle = g;
			ctx.fillRect(W / 2 - 100, 80, 200, 200);
			ctx.restore();
		} else {
			// État success : deux avatars superposés au centre (fusion)
			const FUSE_CX = W / 2;
			// Halo de fusion (grand)
			ctx.save();
			ctx.globalCompositeOperation = "screen";
			for (let i = 5; i > 0; i--) {
				const auraR = AV_R + i * 20;
				const g = ctx.createRadialGradient(FUSE_CX, AV_Y, AV_R * 0.3, FUSE_CX, AV_Y, auraR);
				g.addColorStop(0, rgba(COLOR_FUSION, 0.35));
				g.addColorStop(0.5, rgba("#fbbf24", 0.25));
				g.addColorStop(1, rgba(COLOR_FUSION, 0));
				ctx.fillStyle = g;
				ctx.fillRect(FUSE_CX - auraR, AV_Y - auraR, auraR * 2, auraR * 2);
			}
			ctx.restore();

			// Avatar A (demi gauche)
			await this.drawHalfAvatar(ctx, input.a, FUSE_CX - 40, AV_Y, AV_R, "left", COLOR_A);
			// Avatar B (demi droite)
			await this.drawHalfAvatar(ctx, input.b, FUSE_CX + 40, AV_Y, AV_R, "right", COLOR_B);

			// Ring de fusion
			ctx.save();
			ctx.beginPath();
			ctx.arc(FUSE_CX, AV_Y, AV_R + 8, 0, Math.PI * 2);
			ctx.strokeStyle = COLOR_FUSION;
			ctx.lineWidth = 4;
			ctx.shadowColor = COLOR_FUSION;
			ctx.shadowBlur = 28;
			ctx.stroke();
			ctx.restore();

			// Pseudos de part et d'autre
			textWithShadow(ctx, input.a.username.slice(0, 14), AV_CX_A - 80, AV_Y + 10, {
				font: "700 16px 'Google Sans Flex', sans-serif",
				color: COLOR_A,
				shadow: "rgba(0,0,0,0.9)",
				blur: 4,
				align: "left",
			});
			textWithShadow(ctx, input.b.username.slice(0, 14), AV_CX_B + 80, AV_Y + 10, {
				font: "700 16px 'Google Sans Flex', sans-serif",
				color: COLOR_B,
				shadow: "rgba(0,0,0,0.9)",
				blur: 4,
				align: "right",
			});
		}

		// ── Bandeau bas ────────────────────────────────────────────────────
		const BAND_Y = H - 70;
		const BAND_H = 60;
		ctx.save();
		roundRectPath(ctx, 30, BAND_Y, W - 60, BAND_H, 14);
		const bandGrad = ctx.createLinearGradient(30, BAND_Y, W - 60, BAND_Y);
		bandGrad.addColorStop(0, rgba(COLOR_A, 0.55));
		bandGrad.addColorStop(0.5, rgba(COLOR_FUSION, 0.55));
		bandGrad.addColorStop(1, rgba(COLOR_B, 0.55));
		ctx.fillStyle = bandGrad;
		ctx.fill();
		ctx.strokeStyle = rgba(COLOR_FUSION, 0.7);
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();

		if (input.state === "success" && input.fusedName) {
			textStroked(ctx, input.fusedName.toUpperCase(), W / 2, BAND_Y + 40, {
				font: "800 34px 'Google Sans Flex', sans-serif",
				color: "#fbbf24",
				stroke: "rgba(0,0,0,0.9)",
				strokeWidth: 3,
				align: "center",
			});
		} else {
			textWithShadow(ctx, "Acceptes-tu la fusion ?", W / 2, BAND_Y + 38, {
				font: "800 22px 'Google Sans Flex', sans-serif",
				color: "#f1f5f9",
				shadow: "rgba(0,0,0,0.9)",
				blur: 5,
				align: "center",
			});
		}

		ctx.restore();
		// `encode` async via libuv threadpool — fusion 1100×500 prend ~250 ms.
		return canvas.encode("png");
	}

	private async drawAvatarWithAura(
		ctx: SKRSContext2D,
		user: User,
		cx: number,
		cy: number,
		r: number,
		color: string
	): Promise<void> {
		// Aura
		ctx.save();
		ctx.globalCompositeOperation = "screen";
		for (let i = 3; i > 0; i--) {
			const auraR = r + i * 16;
			const g = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, auraR);
			g.addColorStop(0, rgba(color, 0.45));
			g.addColorStop(1, rgba(color, 0));
			ctx.fillStyle = g;
			ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);
		}
		ctx.restore();

		// Avatar
		const img = await this.loadAvatar(user);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		if (img) {
			ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
		} else {
			ctx.fillStyle = "#1f2937";
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		}
		ctx.restore();

		// Ring
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		ctx.shadowColor = color;
		ctx.shadowBlur = 16;
		ctx.stroke();
		ctx.restore();

		// Pseudo
		textWithShadow(ctx, user.username.slice(0, 14), cx, cy + r + 24, {
			font: "700 16px 'Google Sans Flex', sans-serif",
			color: "#f1f5f9",
			shadow: "rgba(0,0,0,0.9)",
			blur: 4,
			align: "center",
		});
	}

	/** Demi-avatar clippé (moitié gauche ou droite) — utilisé pour l'effet fusion. */
	private async drawHalfAvatar(
		ctx: SKRSContext2D,
		user: User,
		cx: number,
		cy: number,
		r: number,
		half: "left" | "right",
		color: string
	): Promise<void> {
		const img = await this.loadAvatar(user);
		ctx.save();
		// Clip : demi-cercle
		ctx.beginPath();
		if (half === "left") {
			ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, false);
		} else {
			ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
		}
		ctx.closePath();
		ctx.clip();
		if (img) {
			ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
		} else {
			ctx.fillStyle = color;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		}
		ctx.restore();
	}
}
