import { singleton } from "tsyringe";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { User } from "discord.js";
import {
	drawGauge,
	drawScanlines,
	rgba,
	roundRectPath,
	textStroked,
	textWithShadow,
} from "~/lib/canvas-kit";

/**
 * Canvas "scouter gauge" — pour /gay (Gaydar de Bulma) et /raciste (Racism-o-mètre de Mr. Popo).
 * Rend une fiche scanner avec avatar de la cible + pourcentage + barre.
 */

export interface GaugeInput {
	user: User;
	title: string; // "GAYDAR DE BULMA"
	subtitle: string; // "Scanner calibré sur Master Roshi"
	pct: number; // 0-101 (OVERFLOW si > 100 — spec owner=101)
	accent: string; // couleur principale
	accentDark: string; // variante foncée pour le fond
}

@singleton()
export class GaugeService {
	private avatarCache = new Map<string, Image>();

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

	async render(input: GaugeInput): Promise<Buffer> {
		const SCALE = 2;
		const W = 700;
		const H = 320;
		const canvas = createCanvas(W * SCALE, H * SCALE);
		const ctx = canvas.getContext("2d") as SKRSContext2D;
		ctx.scale(SCALE, SCALE);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// ── Fond noir scouter ───────────────────────────────────────────────
		const CARD_R = 24;
		ctx.save();
		roundRectPath(ctx, 0, 0, W, H, CARD_R);
		ctx.clip();

		const grad = ctx.createLinearGradient(0, 0, W, H);
		grad.addColorStop(0, "#000000");
		grad.addColorStop(0.5, "#0a0a0a");
		grad.addColorStop(1, input.accentDark);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, W, H);

		// Scanlines horizontales
		drawScanlines(ctx, 0, 0, W, H, rgba(input.accent, 0.12));

		// Bordure + glow néon
		ctx.save();
		ctx.shadowColor = input.accent;
		ctx.shadowBlur = 22;
		ctx.strokeStyle = input.accent;
		ctx.lineWidth = 3;
		ctx.strokeRect(6, 6, W - 12, H - 12);
		ctx.restore();

		// ── Label scouter en haut ──────────────────────────────────────────
		textWithShadow(ctx, "« SCANNER »", 28, 32, {
			font: "700 13px 'Google Sans Flex', sans-serif",
			color: rgba(input.accent, 0.85),
			align: "left",
		});
		// Titre — Google Sans Flex 900 avec halo accent (glow néon, lisible).
		textWithShadow(ctx, input.title, 28, 62, {
			font: "900 28px 'Google Sans Flex', sans-serif",
			color: "#f1f5f9",
			align: "left",
			shadow: rgba(input.accent, 0.85),
			blur: 14,
		});
		textWithShadow(ctx, input.subtitle, 28, 84, {
			font: "500 12px 'Google Sans Flex', sans-serif",
			color: "rgba(255,255,255,0.5)",
			align: "left",
		});

		// ── Avatar cible (gauche) ──────────────────────────────────────────
		const AV_CX = 100;
		const AV_CY = 190;
		const AV_R = 56;

		// Aura
		ctx.save();
		ctx.globalCompositeOperation = "screen";
		for (let i = 3; i > 0; i--) {
			const auraR = AV_R + i * 12;
			const g = ctx.createRadialGradient(AV_CX, AV_CY, AV_R * 0.5, AV_CX, AV_CY, auraR);
			g.addColorStop(0, rgba(input.accent, 0.4));
			g.addColorStop(1, rgba(input.accent, 0));
			ctx.fillStyle = g;
			ctx.fillRect(AV_CX - auraR, AV_CY - auraR, auraR * 2, auraR * 2);
		}
		ctx.restore();

		const avatar = await this.loadAvatar(input.user);
		ctx.save();
		ctx.beginPath();
		ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		if (avatar) {
			ctx.drawImage(avatar, AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
		} else {
			ctx.fillStyle = "#1f2937";
			ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
		}
		ctx.restore();
		// Ring
		ctx.save();
		ctx.beginPath();
		ctx.arc(AV_CX, AV_CY, AV_R + 3, 0, Math.PI * 2);
		ctx.strokeStyle = input.accent;
		ctx.lineWidth = 3;
		ctx.shadowColor = input.accent;
		ctx.shadowBlur = 14;
		ctx.stroke();
		ctx.restore();

		// Pseudo sous l'avatar
		textWithShadow(ctx, input.user.username.toUpperCase().slice(0, 14), AV_CX, AV_CY + AV_R + 24, {
			font: "700 14px 'Google Sans Flex', sans-serif",
			color: "#f1f5f9",
			align: "center",
			shadow: "rgba(0,0,0,0.8)",
			blur: 4,
		});

		// ── Pourcentage géant (droite) ─────────────────────────────────────
		const PCT_CX = 460;
		const PCT_CY = 170;
		const pctText = input.pct > 100 ? "101" : String(input.pct);

		// Chiffre géant en font Scouter
		textStroked(ctx, pctText, PCT_CX, PCT_CY, {
			font: "700 140px 'Google Sans Flex', sans-serif",
			color: input.accent,
			stroke: "rgba(0,0,0,0.9)",
			strokeWidth: 5,
			align: "center",
		});
		// Signe %
		textWithShadow(ctx, "%", PCT_CX + 90, PCT_CY - 20, {
			font: "700 60px 'Google Sans Flex', sans-serif",
			color: input.accent,
			shadow: rgba(input.accent, 0.7),
			blur: 14,
			align: "left",
		});

		// ── Gauge horizontale bas ──────────────────────────────────────────
		const G_X = 180;
		const G_Y = 240;
		const G_W = W - G_X - 50;
		const G_H = 22;
		const clamped = Math.min(1, input.pct / 100);

		drawGauge(ctx, G_X, G_Y, G_W, G_H, clamped, {
			bg: "rgba(30, 30, 30, 0.7)",
			fill: input.accent,
			stroke: rgba(input.accent, 0.4),
		});
		// Overflow rouge si > 100
		if (input.pct > 100) {
			ctx.save();
			roundRectPath(ctx, G_X, G_Y, G_W, G_H, G_H / 2);
			ctx.clip();
			ctx.fillStyle = "#dc2626";
			ctx.globalAlpha = 0.4;
			ctx.fillRect(G_X, G_Y, G_W, G_H);
			ctx.restore();
		}

		// Sous-label
		textWithShadow(ctx, "POWER LEVEL / COMPATIBILITY", G_X, G_Y + G_H + 20, {
			font: "700 11px 'Google Sans Flex', sans-serif",
			color: rgba(input.accent, 0.6),
			align: "left",
		});
		textWithShadow(ctx, `${input.pct}/100`, G_X + G_W, G_Y + G_H + 20, {
			font: "700 13px 'Google Sans Flex', sans-serif",
			color: input.accent,
			align: "right",
		});

		ctx.restore();
		// `encode` est async via libuv threadpool — n'occupe pas l'event loop
		// pendant la compression PNG (~50-200ms sur 700×320). `toBuffer` reste
		// sync donc plus lent côté serveur multi-clients.
		return canvas.encode("png");
	}
}
