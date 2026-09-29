import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas, loadImage, type SKRSContext2D } from "@aphrody/canvas";
import type { Kysely } from "kysely";
import { NotFound } from "@tsed/exceptions";
import { singleton } from "tsyringe";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { urlsConfig } from "@/configs/urls";
import { MatchMode } from "@/utils/enums/eventEnums";
import { registerAchilleaFonts } from "@/utils/functions/registerFonts";

interface PlayerCardDatabase {
	user: {
		id: string;
		display_name: string;
		normalized_display_name: string;
		username: string | null;
		avatar: string | null;
	};
	user_elo: {
		user_id: string;
		mode: number;
		elo: number;
		wins: number;
		losses: number;
	};
}

const sql = createAchilleaSql<PlayerCardDatabase>() as Kysely<PlayerCardDatabase>;

const STORAGE_ROOT = join(process.cwd(), "storage", "cards");

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

// Palette source : apps/achillea-web/src/styles.css. Index 0 = "Non classé" (rank 1 → idx 1).
const RANK_COLORS: ReadonlyArray<string> = [
	"#000000",
	"#959595",
	"#B17253",
	"#7FACB8",
	"#C2AD88",
	"#897E8B",
	"#88F6FF",
	"#2D925C",
	"#FF5648",
	"#7EDCB5",
	"#F010FF",
	"#FFA910",
];

const RANK_NAMES: ReadonlyArray<string> = [
	"Non classé",
	"Fer",
	"Bronze",
	"Argent",
	"Or",
	"Platine",
	"Diamant",
	"Émeraude",
	"Rubis",
	"Divin",
	"Supernova",
	"Légendaire",
];

const RANK_THRESHOLDS: ReadonlyArray<number> = [
	0, 50, 200, 400, 600, 800, 1000, 1200, 1400, 1700, 2100,
];

export interface PlayerCardData {
	userId: string;
	displayName: string;
	normalizedDisplayName: string;
	avatarUrl: string | null;
	elo: number;
	rankIndex: number;
	wins: number;
	losses: number;
	winrate: number;
	season: string;
}

@singleton()
export class PlayerCardService {
	private db: Kysely<PlayerCardDatabase> = sql;

	/** Test-only dependency seam; production uses the shared Kysely pool. */
	withDatabase(db: Kysely<PlayerCardDatabase>): this {
		this.db = db;
		return this;
	}

	async generateCard(userId: string): Promise<Buffer> {
		const data = await this.loadCardData(userId);
		return await this.renderCard(data);
	}

	async generateAndSave(userId: string): Promise<string> {
		const buf = await this.generateCard(userId);
		await mkdir(STORAGE_ROOT, { recursive: true });
		const path = join(STORAGE_ROOT, `${userId}.png`);
		await Bun.write(path, buf);
		return path;
	}

	private async loadCardData(userId: string): Promise<PlayerCardData> {
		const user = await this.db
			.selectFrom("user")
			.leftJoin("user_elo", (join) =>
				join
					.onRef("user_elo.user_id", "=", "user.id")
					.on("user_elo.mode", "=", MatchMode.ONE_VS_ONE)
			)
			.select([
				"user.id",
				"user.display_name",
				"user.normalized_display_name",
				"user.username",
				"user.avatar",
				"user_elo.elo",
				"user_elo.wins",
				"user_elo.losses",
			])
			.where("user.id", "=", userId)
			.executeTakeFirst();
		if (!user) throw new NotFound(`User ${userId} introuvable`);

		const rating = user.elo ?? 0;
		const wins = user.wins ?? 0;
		const losses = user.losses ?? 0;
		const winrate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

		const rawName = user.display_name || user.username || `User#${user.id}`;
		const displayName = sanitizeName(rawName) || user.username || `User#${user.id}`;

		return {
			userId: user.id,
			displayName,
			normalizedDisplayName: sanitizeName(user.normalized_display_name || ""),
			avatarUrl: user.avatar ?? null,
			elo: rating,
			rankIndex: rankFromElo(rating),
			wins,
			losses,
			winrate,
			season: currentSeasonLabel(),
		};
	}

	private async renderCard(data: PlayerCardData): Promise<Buffer> {
		registerAchilleaFonts();
		const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
		const ctx = canvas.getContext("2d");

		const rankColor = RANK_COLORS[data.rankIndex];
		const rankName = RANK_NAMES[data.rankIndex];

		drawBackground(ctx, rankColor);
		drawHeader(ctx, data.season);

		const avatarSize = 360;
		const avatarX = (CANVAS_WIDTH - avatarSize) / 2;
		const avatarY = 220;
		await drawCircularAvatar(ctx, data.avatarUrl, avatarX, avatarY, avatarSize, rankColor);

		drawIdentity(ctx, data, avatarY + avatarSize + 60);

		drawRankBadge(ctx, rankName, rankColor, data.elo, avatarY + avatarSize + 230);

		drawStats(ctx, data, avatarY + avatarSize + 410);

		drawFooter(ctx, data.userId);

		return canvas.toBuffer("image/png");
	}
}

function rankFromElo(elo: number): number {
	let idx = 0;
	for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
		if (elo >= RANK_THRESHOLDS[i]) idx = i + 1;
	}
	return Math.min(Math.max(idx, 1), 11);
}

function currentSeasonLabel(): string {
	const d = new Date();
	return `Saison ${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function drawBackground(ctx: SKRSContext2D, accent: string) {
	const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
	bg.addColorStop(0, "#0b0b10");
	bg.addColorStop(1, "#1b1320");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	const halo = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	halo.addColorStop(0, hexWithAlpha(accent, 0.45));
	halo.addColorStop(1, hexWithAlpha(accent, 0.1));
	ctx.fillStyle = halo;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	ctx.strokeStyle = hexWithAlpha(accent, 0.95);
	ctx.lineWidth = 8;
	ctx.strokeRect(20, 20, CANVAS_WIDTH - 40, CANVAS_HEIGHT - 40);
}

function drawHeader(ctx: SKRSContext2D, season: string) {
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(40, 40, CANVAS_WIDTH - 80, 140);

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 60px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("ACHILLÉA — CARTE JOUEUR", CANVAS_WIDTH / 2, 95);

	ctx.fillStyle = "rgba(255,255,255,0.7)";
	ctx.font = "26px 'Achillea Sans', 'Achillea Body'";
	ctx.fillText(season, CANVAS_WIDTH / 2, 145);
}

async function drawCircularAvatar(
	ctx: SKRSContext2D,
	url: string | null,
	x: number,
	y: number,
	size: number,
	ringColor: string
) {
	ctx.save();
	ctx.beginPath();
	ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
	ctx.closePath();
	ctx.clip();

	let drew = false;
	if (url) {
		try {
			const buf = await fetchAsBuffer(url);
			if (buf) {
				const img = await loadImage(buf);
				ctx.drawImage(img, x, y, size, size);
				drew = true;
			}
		} catch {
			// fallback below
		}
	}

	if (!drew) {
		ctx.fillStyle = "#2a2233";
		ctx.fillRect(x, y, size, size);
		ctx.fillStyle = "#ffffff";
		ctx.font = `bold ${Math.floor(size / 2)}px 'Achillea Sans', 'Achillea Body'`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("?", x + size / 2, y + size / 2);
	}
	ctx.restore();

	ctx.beginPath();
	ctx.arc(x + size / 2, y + size / 2, size / 2 + 8, 0, Math.PI * 2);
	ctx.lineWidth = 10;
	ctx.strokeStyle = ringColor;
	ctx.stroke();
}

function drawIdentity(ctx: SKRSContext2D, data: PlayerCardData, y: number) {
	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 72px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(truncate(data.displayName, 22), CANVAS_WIDTH / 2, y);

	if (data.normalizedDisplayName && data.normalizedDisplayName !== data.displayName) {
		ctx.fillStyle = "rgba(255,255,255,0.7)";
		ctx.font = "32px 'Achillea Sans', 'Achillea Body'";
		ctx.fillText(`@${truncate(data.normalizedDisplayName, 26)}`, CANVAS_WIDTH / 2, y + 60);
	}
}

function drawRankBadge(
	ctx: SKRSContext2D,
	rankName: string,
	rankColor: string,
	elo: number,
	y: number
) {
	const padX = 140;
	const w = CANVAS_WIDTH - padX * 2;
	const h = 130;

	ctx.fillStyle = "rgba(0,0,0,0.55)";
	roundRect(ctx, padX, y, w, h, 28);
	ctx.fill();

	ctx.strokeStyle = rankColor;
	ctx.lineWidth = 4;
	roundRect(ctx, padX, y, w, h, 28);
	ctx.stroke();

	ctx.fillStyle = rankColor;
	ctx.font = "bold 52px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(rankName, CANVAS_WIDTH / 2, y + 50);

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 44px 'Achillea Display Num', 'Achillea Sans'";
	ctx.fillText(`${elo} ELO`, CANVAS_WIDTH / 2, y + 96);
}

function drawStats(ctx: SKRSContext2D, data: PlayerCardData, y: number) {
	const padX = 100;
	const w = CANVAS_WIDTH - padX * 2;
	const h = 220;

	ctx.fillStyle = "rgba(0,0,0,0.45)";
	roundRect(ctx, padX, y, w, h, 24);
	ctx.fill();

	ctx.fillStyle = "rgba(255,255,255,0.7)";
	ctx.font = "26px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("STATISTIQUES SAISON", CANVAS_WIDTH / 2, y + 36);

	const colW = w / 3;
	const blockY = y + 110;

	drawStatBlock(ctx, "Victoires", String(data.wins), padX + colW / 2, blockY, "#7EDCB5");
	drawStatBlock(
		ctx,
		"Défaites",
		String(data.losses),
		padX + colW * 1 + colW / 2,
		blockY,
		"#FF5648"
	);
	drawStatBlock(ctx, "Winrate", `${data.winrate}%`, padX + colW * 2 + colW / 2, blockY, "#FFA910");
}

function drawStatBlock(
	ctx: SKRSContext2D,
	label: string,
	value: string,
	cx: number,
	cy: number,
	color: string
) {
	ctx.fillStyle = color;
	ctx.font = "bold 58px 'Achillea Display Num', 'Achillea Sans'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(value, cx, cy);

	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.font = "24px 'Achillea Sans', 'Achillea Body'";
	ctx.fillText(label, cx, cy + 50);
}

function drawFooter(ctx: SKRSContext2D, userId: string) {
	const y = CANVAS_HEIGHT - 110;
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(40, y, CANVAS_WIDTH - 80, 70);

	const date = new Date().toISOString().slice(0, 10);
	ctx.fillStyle = "rgba(255,255,255,0.75)";
	ctx.font = "22px 'Achillea Sans', 'Achillea Body'";
	ctx.textBaseline = "middle";

	ctx.textAlign = "left";
	ctx.fillText(`ID ${userId}`, 70, y + 35);

	ctx.textAlign = "right";
	ctx.fillText(`Généré le ${date} · ${urlsConfig.websiteHost}`, CANVAS_WIDTH - 70, y + 35);
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1)}…`;
}

// Inter (police de corps) ne contient ni les pseudo-styles mathématiques Unicode (𝒜𝓎𝒶𝓃ℯ)
// ni les emoji → ils sortent en tofu (▯). NFKC réduit ces variantes stylées en ASCII
// (𝒜𝓎𝒶𝓃ℯ → "Ayane"), puis on retire emoji/pictogrammes/diacritiques combinants et on
// normalise les espaces. Le CJK survit (repli MSGothic « Achillea Body »).
function sanitizeName(name: string): string {
	return (
		name
			.normalize("NFKC")
			// emoji et pictogrammes (non présents dans Inter)
			.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
			// caractères invisibles (joiners, sélecteurs de variation) + modificateurs de teint emoji
			.replace(/[\p{Default_Ignorable_Code_Point}\p{Emoji_Modifier}]/gu, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

function hexWithAlpha(hex: string, alpha: number): string {
	const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
		.toString(16)
		.padStart(2, "0");
	if (/^#[0-9a-f]{6}$/i.test(hex)) return `${hex}${a}`;
	return hex;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

async function fetchAsBuffer(url: string): Promise<Buffer | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return Buffer.from(await res.arrayBuffer());
	} catch {
		return null;
	}
}
