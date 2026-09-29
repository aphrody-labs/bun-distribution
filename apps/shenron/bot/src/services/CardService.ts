import { singleton, inject } from "tsyringe";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { BackgroundCacheService } from "./BackgroundCacheService";
import type { User } from "discord.js";
import { formatXP, levelForXP, nextThresholdFrom, xpRequiredForLevel } from "~/lib/xp";
import { logger } from "~/lib/logger";
import { DatabaseService } from "~/db/index";
import { cardThemes } from "~/db/schema";
import { container } from "tsyringe";
import {
	drawDragonBall,
	drawImageCover,
	drawStar,
	fillRadialGlow,
	hexToRgb,
	kiScouterLabel,
	rgba,
	roundRectPath,
	textStroked,
	textWithShadow,
} from "~/lib/canvas-kit";

interface CardTheme {
	name: string;
	accent: string; // couleur principale (ring, highlights)
	aura: string; // couleur de l'aura avatar + barre XP
	bgGrad: readonly [string, string, string]; // dégradé de fond si pas d'image
	bgFile?: string; // chemin relatif (assets/banners|backgrounds/...) — overlay obscurci en top
	textShadow: string;
	overlayOpacity?: number; // assombrissement de l'image de fond (0-1), défaut 0.78
	tintStrength?: number; // teinte aura par-dessus le fond (0-1), défaut 0.08
	gradientAngle?: number; // angle du dégradé sans image (deg), défaut 135
}

// Valeurs par défaut du rendu (= anciens hardcodes). Utilisées si non définies
// (thèmes hardcodés CARDS) ; les thèmes DB portent toujours une valeur.
const DEFAULT_OVERLAY = 0.78;
const DEFAULT_TINT = 0.08;
const DEFAULT_ANGLE = 135;

// Palettes calquées sur les couleurs officielles de l'anime/manga DBZ.
// Sources : brandpalettes.com pour le logo, schemecolor.com pour Goku/Vegeta.
const CARDS: Record<string, CardTheme> = {
	default: {
		name: "DB Classic",
		accent: "#F3E603",
		aura: "#D67711",
		bgGrad: ["#550000", "#D67711", "#1a0a00"],
		bgFile: "assets/banners/banner-17.jpg", // Goku enfant + Shenron
		textShadow: "rgba(0,0,0,0.8)",
	},
	goku: {
		name: "Goku",
		accent: "#F85B1A",
		aura: "#FA5A1E",
		bgGrad: ["#3b0d00", "#F85B1A", "#072083"],
		bgFile: "assets/banners/banner-08.jpg", // Goku SSJ Kamehameha
		textShadow: "rgba(7,32,131,0.8)",
	},
	vegeta: {
		name: "Vegeta",
		accent: "#2955DC",
		aura: "#4169E1",
		bgGrad: ["#0a0f3d", "#2955DC", "#181463"],
		bgFile: "assets/banners/banner-03.png", // Z Warriors (Vegeta)
		textShadow: "rgba(24,20,99,0.9)",
	},
	kaio: {
		name: "Kaio-ken",
		accent: "#FA0011",
		aura: "#FF3030",
		bgGrad: ["#4a0000", "#FA0011", "#1a0000"],
		bgFile: "assets/banners/banner-10.jpg", // Goku SSG (rouge) vs Beerus
		textShadow: "rgba(74,0,0,0.9)",
	},
	ssj: {
		name: "Super Saiyan",
		accent: "#F9EE54",
		aura: "#FFD700",
		bgGrad: ["#422006", "#F3A903", "#0f0800"],
		bgFile: "assets/banners/banner-04.jpg", // 5 SSJ ère Cell
		textShadow: "rgba(66,32,6,0.9)",
	},
	blue: {
		name: "Super Saiyan Blue",
		accent: "#00E5FF",
		aura: "#00B8FF",
		bgGrad: ["#001a3d", "#0369a1", "#00091f"],
		bgFile: "assets/banners/banner-15.jpg", // Vegito SSB
		textShadow: "rgba(0,26,61,0.9)",
	},
	rose: {
		name: "Super Saiyan Rosé",
		accent: "#FF4FB0",
		aura: "#FF1493",
		bgGrad: ["#3a0420", "#9d174d", "#0a0208"],
		bgFile: "assets/banners/banner-16.png", // Goku Black Rosé (miroir brisé)
		textShadow: "rgba(58,4,32,0.9)",
	},
	ultra: {
		name: "Ultra Instinct",
		accent: "#E5E9F0",
		aura: "#B4C4DD",
		bgGrad: ["#000814", "#475569", "#000000"],
		bgFile: "assets/banners/banner-02.jpg", // Goku silhouette UI arc-en-ciel
		textShadow: "rgba(0,8,20,0.95)",
	},
};

export interface CardInput {
	discordUser: User;
	xp: number;
	zeni: number;
	messageCount: number;
	cardKey?: string | null;
	bannerKey?: string | null;
	bannerPath?: string | null;
	badge?: string | null;
	title?: string | null;
	color?: string | null;
	fused?: boolean;
	rank?: number | null;
}

@singleton()
export class CardService {
	private avatarCache = new Map<string, { image: Image; ts: number }>();
	private bgCache = new Map<string, Image | null>();
	// Cache thèmes DB — refresh 60s. Fallback CARDS hardcoded si DB inaccessible.
	private themesCache: Map<string, CardTheme> | null = null;
	private themesCacheAt = 0;

	constructor(@inject(BackgroundCacheService) private bgs: BackgroundCacheService) {}

	/**
	 * Retourne la map active des thèmes (DB > fallback CARDS hardcoded).
	 * Cache TTL 60s — admin peut éditer via dashboard et voir le résultat
	 * en max 1 minute (ou via /reload).
	 */
	private async getThemes(): Promise<Map<string, CardTheme>> {
		const now = Date.now();
		if (this.themesCache && now - this.themesCacheAt < 60_000) {
			return this.themesCache;
		}
		const out = new Map<string, CardTheme>(Object.entries(CARDS));
		try {
			const dbs = container.resolve(DatabaseService);
			const rows = await dbs.db.select().from(cardThemes);
			for (const r of rows) {
				if (!r.enabled) continue;
				out.set(r.id, {
					name: r.name,
					accent: r.accent,
					aura: r.aura,
					bgGrad: [r.bgGrad1, r.bgGrad2, r.bgGrad3] as const,
					bgFile: r.bgFile ?? undefined,
					textShadow: r.textShadow,
					overlayOpacity: r.overlayOpacity,
					tintStrength: r.tintStrength,
					gradientAngle: r.gradientAngle,
				});
			}
		} catch (err) {
			logger.warn({ err }, "CardService.getThemes — fallback CARDS hardcoded");
		}
		this.themesCache = out;
		this.themesCacheAt = now;
		return out;
	}

	/** Invalide le cache thèmes (appelé par admin POST/PUT/DELETE card-themes). */
	invalidateThemes(): void {
		this.themesCache = null;
		this.bgCache.clear();
	}

	private async loadAvatar(user: User): Promise<Image | null> {
		const cached = this.avatarCache.get(user.id);
		if (cached && Date.now() - cached.ts < 60 * 60_000) return cached.image;
		const url = user.displayAvatarURL({
			extension: "png",
			size: 512,
			forceStatic: true,
		});
		try {
			const img = await loadImage(url);
			this.avatarCache.set(user.id, { image: img, ts: Date.now() });
			return img;
		} catch {
			return null;
		}
	}

	async resolveBannerPath(bannerKey: string): Promise<string | null> {
		if (!bannerKey) return null;
		if (bannerKey.startsWith("assets/banners/")) return bannerKey;
		if (bannerKey.startsWith("banner-")) return `assets/banners/${bannerKey}`;
		try {
			const dbs = container.resolve(DatabaseService);
			const item = await dbs.db.query.shopItems.findFirst({
				where: (s, { eq }) => eq(s.key, bannerKey),
			});
			if (item?.meta) {
				const parsed = JSON.parse(item.meta) as { bannerPath?: string };
				if (parsed.bannerPath) return parsed.bannerPath;
			}
		} catch {}
		return null;
	}

	private async loadBackground(key: string, bannerFile?: string | null): Promise<Image | null> {
		if (bannerFile) {
			const bannerImg = await this.bgs.get(bannerFile);
			if (bannerImg) return bannerImg;
			for (const ext of ["webp", "png", "jpg"]) {
				const img = await this.bgs.get(`assets/banners/${bannerFile}.${ext}`);
				if (img) return img;
			}
		}
		if (this.bgCache.has(key)) return this.bgCache.get(key) ?? null;
		// 1) bgFile explicite du thème (assets/backgrounds/...) — délégué au cache partagé
		const themes = await this.getThemes();
		const theme = themes.get(key);
		if (theme?.bgFile) {
			const img = await this.bgs.get(theme.bgFile);
			if (img) {
				this.bgCache.set(key, img);
				return img;
			}
		}
		// 2) convention legacy assets/cards/<key>.(webp|png|jpg) — backgrounds achetables via shop
		for (const ext of ["webp", "png", "jpg"]) {
			const img = await this.bgs.get(`assets/cards/${key}.${ext}`);
			if (img) {
				this.bgCache.set(key, img);
				return img;
			}
		}
		this.bgCache.set(key, null);
		return null;
	}

	async listCards(): Promise<string[]> {
		const themes = await this.getThemes();
		return [...themes.keys()];
	}

	async describeCard(key: string): Promise<CardTheme | undefined> {
		const themes = await this.getThemes();
		return themes.get(key);
	}

	/**
	 * Render the profile card at 2× internal resolution (retina)
	 * then return a high-quality PNG buffer.
	 */
	async render(input: CardInput): Promise<Buffer> {
		const SCALE = 2;
		const W = 1000 * SCALE;
		const H = 360 * SCALE;
		const canvas = createCanvas(W, H);
		const ctx = canvas.getContext("2d") as SKRSContext2D;
		ctx.scale(SCALE, SCALE);

		const themes = await this.getThemes();
		const rawKey = input.cardKey
			? themes.has(input.cardKey)
				? input.cardKey
				: input.cardKey.replace(/^card_/, "")
			: "default";
		const cardKey = themes.has(rawKey) ? rawKey : "default";
		const theme = themes.get(cardKey) ?? CARDS.default!;

		// Sécurisation absolue de la couleur : doit être un format CSS valide (#hex, rgb(), hsl())
		let userColor = theme.accent;
		if (input.color && typeof input.color === "string") {
			const c = input.color.trim();
			if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c) || /^(rgb|rgba|hsl|hsla)\(/.test(c)) {
				userColor = c;
			}
		}

		const width = 1000;
		const height = 360;
		const PAD = 24;

		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		const CARD_R = 28;
		ctx.save();
		roundRectPath(ctx, 0, 0, width, height, CARD_R);
		ctx.clip();

		const overlayOpacity = theme.overlayOpacity ?? DEFAULT_OVERLAY;
		const tintStrength = theme.tintStrength ?? DEFAULT_TINT;
		const gradientAngle = theme.gradientAngle ?? DEFAULT_ANGLE;

		const bannerFile = input.bannerPath || (input.bannerKey ? await this.resolveBannerPath(input.bannerKey) : null);
		const bg = await this.loadBackground(cardKey, bannerFile);
		if (bg) {
			// object-fit: cover — préserve le ratio, crop ce qui dépasse
			drawImageCover(ctx, bg, 0, 0, width, height);
			// Overlay dégradé : obscurci à gauche pour lisibilité de l'avatar/texte.
			// Les 3 stops sont pilotés par overlayOpacity (défaut 0.78 → 0.78/0.45/0.22).
			const overlay = ctx.createLinearGradient(0, 0, width, 0);
			overlay.addColorStop(0, `rgba(0,0,0,${overlayOpacity})`);
			overlay.addColorStop(0.55, `rgba(0,0,0,${overlayOpacity * 0.577})`);
			overlay.addColorStop(1, `rgba(0,0,0,${overlayOpacity * 0.282})`);
			ctx.fillStyle = overlay;
			ctx.fillRect(0, 0, width, height);
			// Teinte thématique pour marier bg + palette
			ctx.fillStyle = rgba(theme.aura, tintStrength);
			ctx.fillRect(0, 0, width, height);
		} else {
			// Multi-stop linear gradient orienté par gradientAngle (deg, repère écran)
			const rad = (gradientAngle * Math.PI) / 180;
			const hx = (Math.cos(rad) * width) / 2;
			const hy = (Math.sin(rad) * height) / 2;
			const grad = ctx.createLinearGradient(
				width / 2 - hx,
				height / 2 - hy,
				width / 2 + hx,
				height / 2 + hy
			);
			grad.addColorStop(0, theme.bgGrad[0]);
			grad.addColorStop(0.5, theme.bgGrad[1]);
			grad.addColorStop(1, theme.bgGrad[2]);
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, width, height);

			// Halo coloré haut-gauche
			const radial = ctx.createRadialGradient(200, 140, 20, 200, 140, 520);
			radial.addColorStop(0, rgba(theme.aura, 0.35));
			radial.addColorStop(1, rgba(theme.aura, 0));
			ctx.fillStyle = radial;
			ctx.fillRect(0, 0, width, height);
		}

		// Groupe de droite — bien visibles derrière le rang
		ctx.save();
		ctx.globalAlpha = 0.35;
		drawDragonBall(ctx, width - 110, 85, 38, 4);
		drawDragonBall(ctx, width - 55, 155, 26, 5);
		drawDragonBall(ctx, width - 170, 115, 22, 1);
		// Groupe bas-gauche plus discret
		ctx.globalAlpha = 0.18;
		drawDragonBall(ctx, 35, height - 40, 20, 7);
		drawDragonBall(ctx, 85, height - 55, 14, 2);
		ctx.restore();

		// Bande lumineuse en haut
		const topGlow = ctx.createLinearGradient(0, 0, 0, 90);
		try {
			topGlow.addColorStop(0, rgba(userColor, 0.22));
			topGlow.addColorStop(1, rgba(userColor, 0));
		} catch {
			topGlow.addColorStop(0, rgba(theme.accent, 0.22));
			topGlow.addColorStop(1, rgba(theme.accent, 0));
		}
		ctx.fillStyle = topGlow;
		ctx.fillRect(0, 0, width, 90);

		// Ombre basse pour la profondeur
		const bottomShade = ctx.createLinearGradient(0, height - 80, 0, height);
		bottomShade.addColorStop(0, "rgba(0,0,0,0)");
		bottomShade.addColorStop(1, "rgba(0,0,0,0.55)");
		ctx.fillStyle = bottomShade;
		ctx.fillRect(0, height - 80, width, 80);

		const avatar = await this.loadAvatar(input.discordUser);
		const AV_CX = 130;
		const AV_CY = height / 2;
		const AV_R = 85;

		// Aura avatar : trois couches en blend "screen" = effet lumière additive
		ctx.save();
		ctx.globalCompositeOperation = "screen";
		for (let i = 3; i > 0; i--) {
			const auraR = AV_R + i * 18;
			const auraGrad = ctx.createRadialGradient(AV_CX, AV_CY, AV_R, AV_CX, AV_CY, auraR);
			auraGrad.addColorStop(0, rgba(theme.aura, 0.55));
			auraGrad.addColorStop(0.6, rgba(theme.aura, 0.18));
			auraGrad.addColorStop(1, rgba(theme.aura, 0));
			ctx.fillStyle = auraGrad;
			ctx.beginPath();
			ctx.arc(AV_CX, AV_CY, auraR, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();

		// Avatar (découpe ronde)
		ctx.save();
		ctx.beginPath();
		ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		if (avatar) {
			ctx.drawImage(avatar, AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
		} else {
			// Avatar introuvable → carré gris
			ctx.fillStyle = "#1f2937";
			ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
		}
		ctx.restore();

		// Ring avatar, couleur équipée
		ctx.lineWidth = 5;
		const ringGrad = ctx.createLinearGradient(
			AV_CX - AV_R,
			AV_CY - AV_R,
			AV_CX + AV_R,
			AV_CY + AV_R
		);
		try {
			ringGrad.addColorStop(0, userColor);
		} catch {
			ringGrad.addColorStop(0, theme.accent);
		}
		try {
			ringGrad.addColorStop(1, theme.accent);
		} catch {}
		ctx.strokeStyle = ringGrad;
		ctx.beginPath();
		ctx.arc(AV_CX, AV_CY, AV_R + 3, 0, Math.PI * 2);
		ctx.stroke();

		// Ring intérieur pour le relief
		ctx.strokeStyle = "rgba(255,255,255,0.3)";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
		ctx.stroke();

		const TXT_X = AV_CX + AV_R + 40;
		const name = input.discordUser.displayName || input.discordUser.username;
		const level = levelForXP(input.xp);
		const next = nextThresholdFrom(input.xp);

		// Titre (petit, italique)
		if (input.title) {
			textWithShadow(ctx, input.title, TXT_X, 72, {
				color: "#cbd5e1",
				font: "italic 600 18px 'Google Sans Flex', sans-serif",
				shadow: theme.textShadow,
				blur: 4,
			});
		}

		// Pseudo en Google Sans Flex (800, lisible)
		const displayName = name.toUpperCase();
		textStroked(ctx, displayName, TXT_X, 120, {
			color: userColor,
			stroke: "rgba(0,0,0,0.8)",
			strokeWidth: 7,
			font: "800 48px 'Google Sans Flex', sans-serif",
		});

		// Badge : pastille ronde à côté du pseudo
		if (input.badge) {
			ctx.save();
			ctx.font = "800 48px 'Google Sans Flex', sans-serif";
			const nameWidth = ctx.measureText(displayName).width;
			const BADGE_CX = TXT_X + nameWidth + 40;
			const BADGE_CY = 108;
			const BADGE_R = 26;
			// Chip background
			const chipGrad = ctx.createLinearGradient(0, BADGE_CY - BADGE_R, 0, BADGE_CY + BADGE_R);
			chipGrad.addColorStop(0, rgba(theme.accent, 0.9));
			chipGrad.addColorStop(1, rgba(theme.aura, 0.9));
			ctx.fillStyle = chipGrad;
			ctx.beginPath();
			ctx.arc(BADGE_CX, BADGE_CY, BADGE_R, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = "rgba(0,0,0,0.5)";
			ctx.lineWidth = 2;
			ctx.stroke();
			// Contenu du badge : emoji couleur (Noto) ou texte court
			ctx.font = "30px 'Noto Color Emoji', 'Google Sans Flex', sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillStyle = "#1f2937";
			ctx.fillText(input.badge.slice(0, 2), BADGE_CX, BADGE_CY + 2);
			ctx.restore();
		}

		// Ligne de stats (Niveau, Zéni, Fusion)
		const STATS_Y = 165;
		// Chip Niveau
		const levelLabel = `NIVEAU ${level}`;
		const levelW = 140;
		const levelH = 38;
		ctx.save();
		roundRectPath(ctx, TXT_X, STATS_Y - levelH + 6, levelW, levelH, 10);
		ctx.fillStyle = rgba(theme.accent, 0.25);
		ctx.fill();
		ctx.strokeStyle = rgba(theme.accent, 0.6);
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();
		textWithShadow(ctx, levelLabel, TXT_X + levelW / 2, STATS_Y, {
			color: theme.accent,
			font: "700 28px 'Google Sans Flex', sans-serif",
			align: "center",
			shadow: theme.textShadow,
			blur: 3,
		});

		// Chip Zéni
		const zeniX = TXT_X + levelW + 14;
		const zeniLabel = `${formatXP(input.zeni)} Z`;
		ctx.save();
		ctx.font = "700 28px 'Google Sans Flex', sans-serif";
		const zeniW = Math.max(130, ctx.measureText(zeniLabel).width + 30);
		roundRectPath(ctx, zeniX, STATS_Y - levelH + 6, zeniW, levelH, 10);
		ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
		ctx.fill();
		ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();
		textWithShadow(ctx, zeniLabel, zeniX + zeniW / 2, STATS_Y, {
			color: "#fde047",
			font: "700 28px 'Google Sans Flex', sans-serif",
			align: "center",
			shadow: "rgba(0,0,0,0.7)",
			blur: 3,
		});

		// Rang (aligné à droite)
		if (input.rank) {
			textWithShadow(ctx, `#${input.rank}`, width - PAD - 30, 90, {
				color: "#f1f5f9",
				font: "700 48px 'Google Sans Flex', sans-serif",
				align: "right",
				shadow: "rgba(0,0,0,0.7)",
				blur: 4,
			});
			ctx.save();
			ctx.letterSpacing = "3px";
			textWithShadow(ctx, "RANG", width - PAD - 30, 115, {
				color: "#94a3b8",
				font: "600 14px 'Google Sans Flex', sans-serif",
				align: "right",
			});
			ctx.restore();
		}

		// Chip Fusion, à la suite du zéni
		if (input.fused) {
			const fusedX = zeniX + zeniW + 14;
			const fusedW = 150;
			ctx.save();
			roundRectPath(ctx, fusedX, STATS_Y - levelH + 6, fusedW, levelH, 10);
			ctx.fillStyle = "rgba(236, 72, 153, 0.22)";
			ctx.fill();
			ctx.strokeStyle = "rgba(236, 72, 153, 0.55)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.restore();
			textWithShadow(ctx, "💞 FUSIONNÉ", fusedX + fusedW / 2, STATS_Y, {
				color: "#f9a8d4",
				font: "700 22px 'Google Sans Flex', sans-serif",
				align: "center",
				shadow: "rgba(80,7,36,0.8)",
				blur: 3,
			});
		}

		const BAR_X = TXT_X;
		const BAR_Y = 238;
		const BAR_W = width - TXT_X - PAD - 20;
		const BAR_H = 28;

		const baseXp = xpRequiredForLevel(level);
		const thresholdMin = level === 0 || !Number.isFinite(baseXp) ? 0 : baseXp;
		const thresholdMax = next?.xp ?? input.xp;
		const progress =
			thresholdMax > thresholdMin
				? Math.max(0, Math.min(1, (input.xp - thresholdMin) / (thresholdMax - thresholdMin)))
				: 1;

		// Fond sombre de la barre
		ctx.save();
		roundRectPath(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
		ctx.fillStyle = "rgba(0,0,0,0.55)";
		ctx.fill();
		// Ombre interne
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();

		// Remplissage
		if (progress > 0) {
			ctx.save();
			roundRectPath(ctx, BAR_X, BAR_Y, BAR_W * progress, BAR_H, BAR_H / 2);
			ctx.clip();
			const fillGrad = ctx.createLinearGradient(BAR_X, BAR_Y, BAR_X + BAR_W * progress, BAR_Y);
			fillGrad.addColorStop(0, theme.aura);
			fillGrad.addColorStop(0.5, theme.accent);
			try {
				fillGrad.addColorStop(1, userColor);
			} catch {
				fillGrad.addColorStop(1, theme.accent);
			}
			ctx.fillStyle = fillGrad;
			ctx.fillRect(BAR_X, BAR_Y, BAR_W * progress, BAR_H);

			// Reflet du haut
			const hi = ctx.createLinearGradient(0, BAR_Y, 0, BAR_Y + BAR_H / 2);
			hi.addColorStop(0, "rgba(255,255,255,0.35)");
			hi.addColorStop(1, "rgba(255,255,255,0)");
			ctx.fillStyle = hi;
			ctx.fillRect(BAR_X, BAR_Y, BAR_W * progress, BAR_H / 2);

			// Étincelle d'énergie au bout
			const endX = BAR_X + BAR_W * progress;
			const sparkle = ctx.createRadialGradient(
				endX,
				BAR_Y + BAR_H / 2,
				0,
				endX,
				BAR_Y + BAR_H / 2,
				20
			);
			sparkle.addColorStop(0, "rgba(255,255,255,0.9)");
			sparkle.addColorStop(1, "rgba(255,255,255,0)");
			ctx.fillStyle = sparkle;
			ctx.fillRect(endX - 20, BAR_Y - 5, 40, BAR_H + 10);
			ctx.restore();
		}

		// Bordure
		ctx.save();
		roundRectPath(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
		ctx.strokeStyle = rgba(userColor, 0.6);
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.restore();

		// Label XP au-dessus de la barre
		const xpCurrent = formatXP(input.xp);
		const xpMax = next ? formatXP(next.xp) : "MAX";
		ctx.save();
		ctx.letterSpacing = "2px";
		textWithShadow(ctx, "UNITÉS", BAR_X, BAR_Y - 12, {
			color: "#94a3b8",
			font: "700 12px 'Google Sans Flex', sans-serif",
		});
		ctx.restore();
		textWithShadow(ctx, `${xpCurrent} / ${xpMax}`, BAR_X + BAR_W, BAR_Y - 10, {
			color: "#f1f5f9",
			font: "700 18px 'Google Sans Flex', sans-serif",
			align: "right",
			shadow: theme.textShadow,
			blur: 3,
		});

		// % dans la barre
		if (progress > 0.15) {
			const pctText = `${Math.round(progress * 100)}%`;
			textStroked(ctx, pctText, BAR_X + (BAR_W * progress) / 2, BAR_Y + BAR_H / 2 + 5, {
				color: "#ffffff",
				stroke: "rgba(0,0,0,0.5)",
				strokeWidth: 3,
				font: "700 14px 'Google Sans Flex', sans-serif",
				align: "center",
			});
		}

		const FOOTER_Y = 310;
		ctx.save();
		ctx.fillStyle = "rgba(255,255,255,0.08)";
		ctx.fillRect(BAR_X, FOOTER_Y, BAR_W, 1);
		ctx.restore();

		const footerItems: Array<{ label: string; value: string }> = [
			{ label: "MESSAGES", value: formatXP(input.messageCount) },
			{ label: "CARTE", value: theme.name.toUpperCase() },
		];
		let footerX = BAR_X;
		for (const item of footerItems) {
			ctx.save();
			// Tracking typographique pour les labels uppercase (style petite capitale)
			ctx.letterSpacing = "1.5px";
			textWithShadow(ctx, item.label, footerX, FOOTER_Y + 18, {
				color: "#64748b",
				font: "700 11px 'Google Sans Flex', sans-serif",
			});
			ctx.restore();
			textWithShadow(ctx, item.value, footerX, FOOTER_Y + 36, {
				color: "#e2e8f0",
				font: "600 18px 'Google Sans Flex', sans-serif",
			});
			ctx.save();
			ctx.font = "600 18px 'Google Sans Flex', sans-serif";
			footerX += Math.max(120, ctx.measureText(item.value).width + 36);
			ctx.restore();
		}

		const kiLabel = kiScouterLabel(input.xp).toUpperCase();
		const SCOUTER_R_X = width - PAD - 14;
		const SCOUTER_H = 28;
		const CHIP_H = SCOUTER_H + 18;
		// Chip aligné sur la baseline du footer pour rester dans le canvas (height=360)
		const SCOUTER_Y = height - CHIP_H - 8;

		ctx.save();
		// Mesure texte scouter
		ctx.font = "700 30px 'Google Sans Flex', sans-serif";
		const scouterTextW = ctx.measureText(kiLabel).width;
		ctx.font = "700 10px 'Google Sans Flex', sans-serif";
		const kiLabelW = ctx.measureText("KI LEVEL").width;
		const chipW = Math.max(scouterTextW, kiLabelW) + 26;
		const chipX = SCOUTER_R_X - chipW;
		// Chip bg — écran scouter (vert/ambre selon intensité)
		const kiIntensity = Math.min(1, input.xp / 1_000_000);
		const chipBg = kiIntensity > 0.5 ? "#22c55e" : "#f59e0b"; // vert > 500k, sinon ambre
		roundRectPath(ctx, chipX, SCOUTER_Y, chipW, CHIP_H, 6);
		ctx.fillStyle = "rgba(0,0,0,0.85)";
		ctx.fill();
		ctx.strokeStyle = rgba(chipBg, 0.7);
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// Label "KI LEVEL" avec tracking pour le côté scouter
		ctx.fillStyle = rgba(chipBg, 0.9);
		ctx.font = "700 9px 'Google Sans Flex', sans-serif";
		ctx.textAlign = "center";
		ctx.letterSpacing = "2.5px";
		ctx.fillText("KI LEVEL", chipX + chipW / 2, SCOUTER_Y + 11);
		ctx.letterSpacing = "0px";

		// Valeur en font Scouter avec glow
		ctx.shadowColor = chipBg;
		ctx.shadowBlur = 8;
		ctx.fillStyle = chipBg;
		ctx.font = "700 30px 'Google Sans Flex', sans-serif";
		ctx.fillText(kiLabel, chipX + chipW / 2, SCOUTER_Y + 36);
		ctx.restore();

		textWithShadow(ctx, `#${input.discordUser.id.slice(-6)}`, width - PAD - 30, 135, {
			color: "rgba(148,163,184,0.3)",
			font: "500 10px 'Google Sans Flex', sans-serif",
			align: "right",
		});

		ctx.restore(); // undo clip
		ctx.save();
		roundRectPath(ctx, 0, 0, width, height, CARD_R);
		ctx.strokeStyle = rgba(userColor, 0.4);
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.restore();

		// Encodage WebP async (thread pool libuv, non-bloquant, ~40% plus petit qu'un PNG)
		return await canvas.encode("webp", 92);
	}
}
