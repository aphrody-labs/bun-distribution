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

interface ClanPosterDatabase {
	clan: {
		id: number;
		name: string;
		shortened_name: string;
		clan_avatar_url: string;
		normalized_short_name: string;
		normalized_name: string;
	};
	clan_member: { clan_id: number; user_id: string };
	user: { id: string; display_name: string; username: string | null; avatar: string | null };
	user_elo: { user_id: string; mode: number; elo: number };
}

interface PosterClan {
	id: number;
	name: string;
	shortenedName: string;
	clanAvatarUrl: string;
	normalizedShortName: string;
	normalizedName: string;
}

const sql = createAchilleaSql<ClanPosterDatabase>() as Kysely<ClanPosterDatabase>;

const STORAGE_ROOT = join(process.cwd(), "storage", "clans");

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

// Palette source : apps/achillea-web/src/styles.css. Index 0 inutilisé (rank 1 → idx 1).
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

export interface PosterMember {
	userId: string;
	displayName: string;
	avatarUrl: string | null;
	elo: number;
	rankIndex: number;
}

export interface PosterData {
	clan: PosterClan;
	members: PosterMember[];
	averageElo: number;
	membersCount: number;
}

@singleton()
export class ClanPosterService {
	private db: Kysely<ClanPosterDatabase> = sql;

	/** Test-only dependency seam; production uses the shared Kysely pool. */
	withDatabase(db: Kysely<ClanPosterDatabase>): this {
		this.db = db;
		return this;
	}

	async generatePoster(clanId: number): Promise<Buffer> {
		const data = await this.loadPosterData(clanId);
		return await this.renderPoster(data);
	}

	async generateAndSave(clanId: number): Promise<string> {
		const buf = await this.generatePoster(clanId);
		await mkdir(STORAGE_ROOT, { recursive: true });
		const path = join(STORAGE_ROOT, `${clanId}-${Date.now()}.png`);
		await Bun.write(path, buf);
		return path;
	}

	private async loadPosterData(clanId: number): Promise<PosterData> {
		const clan = await this.db
			.selectFrom("clan")
			.select([
				"id",
				"name",
				"shortened_name as shortenedName",
				"clan_avatar_url as clanAvatarUrl",
				"normalized_short_name as normalizedShortName",
				"normalized_name as normalizedName",
			])
			.where("id", "=", clanId)
			.executeTakeFirst();
		if (!clan) throw new NotFound(`Clan ${clanId} introuvable`);

		const members = await this.db
			.selectFrom("clan_member")
			.innerJoin("user", "user.id", "clan_member.user_id")
			.leftJoin("user_elo", (join) =>
				join
					.onRef("user_elo.user_id", "=", "user.id")
					.on("user_elo.mode", "=", MatchMode.ONE_VS_ONE)
			)
			.select([
				"user.id as userId",
				"user.display_name as displayName",
				"user.username",
				"user.avatar as avatarUrl",
				"user_elo.elo",
			])
			.where("clan_member.clan_id", "=", clanId)
			.execute();

		const enriched: PosterMember[] = members.map((member) => {
			const elo = member.elo ?? 0;
			return {
				userId: member.userId,
				displayName: member.displayName || member.username || `User#${member.userId}`,
				avatarUrl: member.avatarUrl ?? null,
				elo,
				rankIndex: rankFromElo(elo),
			};
		});

		enriched.sort((a, b) => b.elo - a.elo);

		const top5 = enriched.slice(0, 5);
		const averageElo =
			enriched.length > 0
				? Math.round(enriched.reduce((acc, m) => acc + m.elo, 0) / enriched.length)
				: 0;

		return {
			clan,
			members: top5,
			averageElo,
			membersCount: enriched.length,
		};
	}

	private async renderPoster(data: PosterData): Promise<Buffer> {
		registerAchilleaFonts();
		const { clan, members, averageElo, membersCount } = data;

		const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
		const ctx = canvas.getContext("2d");

		const primary = pickClanPrimaryColor(clan);
		const secondary = pickClanSecondaryColor(clan);

		drawBackground(ctx, primary, secondary);
		drawHeader(ctx, clan);

		const logoSize = 280;
		const logoX = (CANVAS_WIDTH - logoSize) / 2;
		const logoY = 220;
		await drawClanLogo(ctx, clan.clanAvatarUrl, logoX, logoY, logoSize);

		drawNameAndTag(ctx, clan, logoY + logoSize + 60);

		const membersTopY = logoY + logoSize + 220;
		await drawTopMembers(ctx, members, membersTopY);

		drawFooter(ctx, averageElo, membersCount);

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

function pickClanPrimaryColor(clan: PosterClan): string {
	const seed = clan.normalizedShortName || clan.normalizedName || clan.name;
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	const idx = (hash % 11) + 1;
	return RANK_COLORS[idx];
}

function pickClanSecondaryColor(clan: PosterClan): string {
	const primary = pickClanPrimaryColor(clan);
	const idx = RANK_COLORS.indexOf(primary);
	const next = idx === 11 ? 1 : idx + 1;
	return RANK_COLORS[next];
}

function drawBackground(ctx: SKRSContext2D, primary: string, secondary: string) {
	const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
	bg.addColorStop(0, "#0b0b10");
	bg.addColorStop(1, "#1b1320");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	const accent = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	accent.addColorStop(0, hexWithAlpha(primary, 0.55));
	accent.addColorStop(1, hexWithAlpha(secondary, 0.4));
	ctx.fillStyle = accent;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	ctx.strokeStyle = hexWithAlpha(primary, 0.9);
	ctx.lineWidth = 8;
	ctx.strokeRect(20, 20, CANVAS_WIDTH - 40, CANVAS_HEIGHT - 40);
}

function drawHeader(ctx: SKRSContext2D, clan: PosterClan) {
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(40, 40, CANVAS_WIDTH - 80, 140);

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 64px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("ACHILLÉA — CLAN", CANVAS_WIDTH / 2, 100);

	ctx.fillStyle = "rgba(255,255,255,0.7)";
	ctx.font = "28px 'Achillea Sans', 'Achillea Body'";
	ctx.fillText(`Affiche officielle · #${clan.id}`, CANVAS_WIDTH / 2, 150);
}

async function drawClanLogo(
	ctx: SKRSContext2D,
	url: string | null,
	x: number,
	y: number,
	size: number
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
		ctx.font = "bold 96px 'Achillea Sans', 'Achillea Body'";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("?", x + size / 2, y + size / 2);
	}

	ctx.restore();

	ctx.beginPath();
	ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, Math.PI * 2);
	ctx.lineWidth = 8;
	ctx.strokeStyle = "#ffffff";
	ctx.stroke();
}

function drawNameAndTag(ctx: SKRSContext2D, clan: PosterClan, y: number) {
	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 88px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(truncate(clan.name, 22), CANVAS_WIDTH / 2, y);

	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.font = "44px 'Achillea Sans', 'Achillea Body'";
	ctx.fillText(`[${clan.shortenedName}]`, CANVAS_WIDTH / 2, y + 70);
}

async function drawTopMembers(ctx: SKRSContext2D, members: PosterMember[], topY: number) {
	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 48px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("TOP 5 MEMBRES", CANVAS_WIDTH / 2, topY);

	const rowHeight = 130;
	const startY = topY + 70;
	const padX = 80;
	const rowWidth = CANVAS_WIDTH - padX * 2;

	if (members.length === 0) {
		ctx.fillStyle = "rgba(255,255,255,0.6)";
		ctx.font = "36px 'Achillea Sans', 'Achillea Body'";
		ctx.fillText("Aucun membre classé", CANVAS_WIDTH / 2, startY + 60);
		return;
	}

	for (let i = 0; i < members.length; i++) {
		const m = members[i];
		const y = startY + i * rowHeight;

		ctx.fillStyle = "rgba(0,0,0,0.45)";
		roundRect(ctx, padX, y, rowWidth, rowHeight - 14, 24);
		ctx.fill();

		const avatarSize = rowHeight - 40;
		const avatarX = padX + 24;
		const avatarY = y + 13;
		await drawCircularAvatar(ctx, m.avatarUrl, avatarX, avatarY, avatarSize);

		ctx.fillStyle = "#ffffff";
		ctx.font = "bold 40px 'Achillea Sans', 'Achillea Body'";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(truncate(m.displayName, 22), avatarX + avatarSize + 30, y + 50);

		ctx.fillStyle = RANK_COLORS[m.rankIndex];
		ctx.font = "28px 'Achillea Sans', 'Achillea Body'";
		ctx.fillText(`${RANK_NAMES[m.rankIndex]} · ${m.elo} ELO`, avatarX + avatarSize + 30, y + 90);

		ctx.fillStyle = RANK_COLORS[m.rankIndex];
		ctx.font = "bold 64px 'Achillea Sans', 'Achillea Body'";
		ctx.textAlign = "right";
		ctx.fillText(`#${i + 1}`, padX + rowWidth - 32, y + (rowHeight - 14) / 2);
	}
}

async function drawCircularAvatar(
	ctx: SKRSContext2D,
	url: string | null,
	x: number,
	y: number,
	size: number
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
		ctx.fillStyle = "#3a2f44";
		ctx.fillRect(x, y, size, size);
		ctx.fillStyle = "#ffffff";
		ctx.font = `bold ${Math.floor(size / 2)}px 'Achillea Sans', 'Achillea Body'`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("?", x + size / 2, y + size / 2);
	}
	ctx.restore();
}

function drawFooter(ctx: SKRSContext2D, averageElo: number, membersCount: number) {
	const y = CANVAS_HEIGHT - 180;
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(40, y, CANVAS_WIDTH - 80, 140);

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 40px 'Achillea Sans', 'Achillea Body'";
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillText(`ELO moyen : ${averageElo}`, 80, y + 50);
	ctx.fillText(`Membres : ${membersCount}`, 80, y + 100);

	const date = new Date().toISOString().slice(0, 10);
	ctx.textAlign = "right";
	ctx.fillStyle = "rgba(255,255,255,0.7)";
	ctx.font = "28px 'Achillea Sans', 'Achillea Body'";
	ctx.fillText(`Généré le ${date}`, CANVAS_WIDTH - 80, y + 100);
	ctx.fillText(urlsConfig.websiteHost, CANVAS_WIDTH - 80, y + 50);
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1)}…`;
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
