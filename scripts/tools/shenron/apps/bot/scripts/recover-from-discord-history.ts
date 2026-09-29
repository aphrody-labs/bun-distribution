#!/usr/bin/env bun
/**
 * GODMODE RECOVERY — scan exhaustif de l'historique Discord pour reconstruire
 * un MAX de data perdu dans bot.db (perte du 2026-05-16).
 *
 * Stratégie :
 *   1. Connecte un client Discord léger (Grand Prêtre token = MESSAGE_CONTENT intent)
 *   2. Liste TOUS les salons texte de la guild
 *   3. Pour chaque salon, paginate `messages.fetch` rétrograde (par batches de 100)
 *   4. Pour CHAQUE message rencontré :
 *      - Auteur = bot Shenron/Kaio/etc → parse annonces :
 *          • Level-up   (embed title "Niveau X atteint !")
 *          • Achievement (embed title "🏆 Succès débloqué !")
 *          • Daily quest, fusion, sanctions (warns/jails/mutes/bans)
 *      - Auteur = user humain → increment messageCount + lastMessageAt
 *   5. Aggregation parallèle puis UPSERT batché dans bot.db
 *
 * Concurrence : 6 salons en parallèle, rate-limit Discord 50 req/s respecté.
 * Limites : 30 derniers jours par défaut (configurable). Persiste checkpoint
 * pour resume après crash.
 *
 * Usage :
 *   bun scripts/recover-from-discord-history.ts                  # 30j, concurrence 6
 *   bun scripts/recover-from-discord-history.ts --days 90 --concurrency 4
 *   bun scripts/recover-from-discord-history.ts --resume         # reprend le checkpoint
 *   bun scripts/recover-from-discord-history.ts --dry-run        # parse mais n'écrit pas
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { users, achievements, actionLogs, warns, jails } from "~/db/schema";
import { eq, sql as dsql } from "drizzle-orm";
import {
	Client,
	GatewayIntentBits,
	ChannelType,
	type TextChannel,
	type GuildTextBasedChannel,
} from "discord.js";
import { env } from "~/lib/env";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// ─── Args ───────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const argVal = (k: string, d: string) => {
	const i = process.argv.indexOf(k);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DAYS = Number(argVal("--days", "30"));
const CONCURRENCY = Number(argVal("--concurrency", "6"));
const DRY_RUN = args.has("--dry-run");
const RESUME = args.has("--resume");
const CHECKPOINT_PATH = new URL("../data/.recovery-checkpoint.json", import.meta.url).pathname;
const CUTOFF_MS = Date.now() - DAYS * 86_400_000;

const log = (...m: unknown[]) => console.log(...m);
log(
	`🎯 GODMODE RECOVERY — last ${DAYS}d · concurrency ${CONCURRENCY} · ${DRY_RUN ? "DRY-RUN" : "WRITE"}`
);

// ─── Connect Discord (Grand Prêtre = MESSAGE_CONTENT + MEMBERS) ─────────
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
	],
});

await client.login(env.DISCORD_TOKEN_GRAND_PRETRE);
await new Promise<void>((r) => client.once("clientReady", () => r()));
log(`✓ Connected as ${client.user?.tag}`);

const guild = await client.guilds.fetch(env.GUILD_ID);
const channels = await guild.channels.fetch();
const textChannels = channels
	.filter(
		(c): c is GuildTextBasedChannel =>
			!!c &&
			(c.type === ChannelType.GuildText ||
				c.type === ChannelType.GuildAnnouncement ||
				c.type === ChannelType.PublicThread ||
				c.type === ChannelType.PrivateThread) &&
			c.viewable === true
	)
	.toJSON();

log(`✓ ${textChannels.length} text channels viewable`);

// ─── Bot persona IDs (Shenron + co — pour parser leurs annonces) ────────
const BOT_PERSONA_IDS = new Set(
	[
		env.APPLICATION_ID_SHENRON,
		env.APPLICATION_ID_BEERUS,
		env.APPLICATION_ID_WHIS,
		env.APPLICATION_ID_GRAND_PRETRE,
		env.APPLICATION_ID_ENMA,
		env.APPLICATION_ID_KAIO,
	].filter(Boolean) as string[]
);

// ─── Aggregators ────────────────────────────────────────────────────────
type UserAgg = {
	messageCount: number;
	lastMessageAt: number;
	firstMessageAt: number;
};
const userAgg = new Map<string, UserAgg>();

type LevelUp = { userId: string; level: number; xp: number | null; ts: number };
const levelUps: LevelUp[] = [];

type AchievementHit = {
	userId: string;
	code: string | null;
	name: string | null;
	ts: number;
};
const achievementHits: AchievementHit[] = [];

type SanctionHit = {
	type: "warn" | "jail" | "mute" | "ban" | "kick";
	userId: string;
	moderatorId: string | null;
	reason: string | null;
	ts: number;
};
const sanctionHits: SanctionHit[] = [];

type FusionHit = { userA: string; userB: string; ts: number };
const fusionHits: FusionHit[] = [];

// ─── Regex parsing helpers ──────────────────────────────────────────────
const RX_USER_MENTION = /<@!?(\d{17,20})>/g;
const RX_NIVEAU = /[Nn]iveau\s*(\d{1,2})/;
const RX_XP_NUMBER = /(\d[\d\s,.]*)\s*[Xx][Pp]/;

function extractMentions(s: string): string[] {
	const ids: string[] = [];
	for (const m of s.matchAll(RX_USER_MENTION)) ids.push(m[1]);
	return ids;
}

function parseBotMessage(msg: {
	id: string;
	createdTimestamp: number;
	content: string;
	embeds: Array<{
		title?: string | null;
		description?: string | null;
		fields?: Array<{ name: string; value: string }>;
	}>;
}) {
	// Concat tout le texte (content + embed titles/descriptions/fields)
	let title = "";
	let desc = "";
	const fields: Array<{ name: string; value: string }> = [];
	for (const e of msg.embeds) {
		if (e.title) title += " " + e.title;
		if (e.description) desc += " " + e.description;
		if (e.fields) fields.push(...e.fields);
	}
	const all = [msg.content, title, desc, ...fields.map((f) => `${f.name}:${f.value}`)]
		.join(" ")
		.trim();
	const lower = all.toLowerCase();

	// LEVEL UP — "Niveau X atteint !" + mention
	if (/niveau\s+\d+\s+atteint/i.test(title)) {
		const ids = extractMentions(msg.content + " " + desc);
		const lvlMatch = title.match(RX_NIVEAU);
		const xpField = fields.find((f) => /xp total/i.test(f.name));
		const xpNum = xpField ? Number(xpField.value.replace(/[^\d]/g, "")) : null;
		if (ids.length && lvlMatch) {
			levelUps.push({
				userId: ids[0],
				level: Number(lvlMatch[1]),
				xp: xpNum,
				ts: msg.createdTimestamp,
			});
		}
	}

	// ACHIEVEMENT — "🏆 Succès débloqué !"
	if (/succès|succes|achievement|débloqué|debloque/i.test(title) || /🏆/.test(title)) {
		const ids = extractMentions(msg.content + " " + desc);
		const codeMatch = (desc + " " + all).match(/`([A-Z_0-9]{3,40})`/);
		const nameField = fields.find((f) => /nom|name|titre/i.test(f.name));
		if (ids.length) {
			achievementHits.push({
				userId: ids[0],
				code: codeMatch ? codeMatch[1] : null,
				name: nameField?.value ?? null,
				ts: msg.createdTimestamp,
			});
		}
	}

	// SANCTIONS — patterns flexibles
	const sanctionType: SanctionHit["type"] | null = /\bwarn(ed|é)?\b|avertissement/i.test(all)
		? "warn"
		: /\bjail(ed|é)?\b|emprisonn/i.test(all)
			? "jail"
			: /\bmute(d|é)?\b|réduit au silence/i.test(all)
				? "mute"
				: /\bban(ned|ni)?\b|banni/i.test(all)
					? "ban"
					: /\bkick(ed|é)?\b|expulsé/i.test(all)
						? "kick"
						: null;
	if (sanctionType) {
		const ids = extractMentions(all);
		const reasonField = fields.find((f) => /raison|reason/i.test(f.name));
		if (ids.length >= 1) {
			sanctionHits.push({
				type: sanctionType,
				userId: ids[0],
				moderatorId: ids.length >= 2 ? ids[1] : null,
				reason: reasonField?.value ?? null,
				ts: msg.createdTimestamp,
			});
		}
	}

	// FUSION — "fusion" entre 2 users
	if (/fusion/i.test(all) && /créée|created|nouvelle|réussi/i.test(lower)) {
		const ids = extractMentions(all);
		if (ids.length >= 2) {
			fusionHits.push({
				userA: ids[0],
				userB: ids[1],
				ts: msg.createdTimestamp,
			});
		}
	}
}

// ─── Channel scanner with rate-limit awareness ──────────────────────────
async function scanChannel(channel: GuildTextBasedChannel): Promise<{
	channelId: string;
	messageCount: number;
	stoppedReason: string;
}> {
	const channelName = "name" in channel ? channel.name : channel.id;
	let lastId: string | undefined = undefined;
	let totalScanned = 0;
	let stoppedReason = "cutoff_reached";
	const MAX_BATCHES_PER_CHANNEL = 500; // = 50k messages max par salon
	let batches = 0;

	try {
		while (batches++ < MAX_BATCHES_PER_CHANNEL) {
			const messages = await channel.messages.fetch({
				limit: 100,
				before: lastId,
			});
			if (messages.size === 0) {
				stoppedReason = "empty_channel";
				break;
			}
			let allOldEnough = true;
			for (const m of messages.values()) {
				totalScanned++;
				if (m.createdTimestamp < CUTOFF_MS) {
					allOldEnough = true;
					continue;
				}
				allOldEnough = false;
				// USER message
				if (!m.author.bot) {
					const id = m.author.id;
					const cur = userAgg.get(id);
					if (cur) {
						cur.messageCount++;
						cur.lastMessageAt = Math.max(cur.lastMessageAt, m.createdTimestamp);
						cur.firstMessageAt = Math.min(cur.firstMessageAt, m.createdTimestamp);
					} else {
						userAgg.set(id, {
							messageCount: 1,
							lastMessageAt: m.createdTimestamp,
							firstMessageAt: m.createdTimestamp,
						});
					}
				}
				// BOT message — parse pour annonces (filtre nos personas)
				else if (m.author.bot && BOT_PERSONA_IDS.has(m.author.id)) {
					try {
						parseBotMessage({
							id: m.id,
							createdTimestamp: m.createdTimestamp,
							content: m.content,
							embeds: m.embeds.map((e) => ({
								title: e.title,
								description: e.description,
								fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
							})),
						});
					} catch {}
				}
			}
			// Check if we passed the cutoff
			const oldest = messages.last();
			if (!oldest || oldest.createdTimestamp < CUTOFF_MS) {
				stoppedReason = "cutoff_reached";
				break;
			}
			lastId = oldest.id;

			// Petit throttle pour rester sous le rate-limit (Discord = 50/s global)
			await new Promise((r) => setTimeout(r, 50));
		}
	} catch (e) {
		stoppedReason = `error: ${e instanceof Error ? e.message : String(e)}`;
	}
	log(
		`  ✓ #${channelName.padEnd(28)} scanned ${totalScanned.toString().padStart(6)} msgs (${stoppedReason})`
	);
	return { channelId: channel.id, messageCount: totalScanned, stoppedReason };
}

// ─── Concurrent pool ────────────────────────────────────────────────────
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let idx = 0;
	const workers: Promise<void>[] = [];
	for (let i = 0; i < limit; i++) {
		workers.push(
			(async () => {
				while (idx < items.length) {
					const myIdx = idx++;
					results[myIdx] = await fn(items[myIdx]);
				}
			})()
		);
	}
	await Promise.all(workers);
	return results;
}

// ─── Checkpoint resume ──────────────────────────────────────────────────
let processedChannels = new Set<string>();
if (RESUME && existsSync(CHECKPOINT_PATH)) {
	const cp = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf-8"));
	processedChannels = new Set(cp.processedChannels ?? []);
	log(`▶ Resuming, ${processedChannels.size} channels already done`);
}
const todo = textChannels.filter((c) => !processedChannels.has(c.id));
log(`▶ Scanning ${todo.length} channels (${textChannels.length - todo.length} skipped)`);

// ─── Main scan ──────────────────────────────────────────────────────────
const startScan = Date.now();
const results = await runPool(todo, CONCURRENCY, async (ch) => {
	const r = await scanChannel(ch);
	processedChannels.add(ch.id);
	// Save checkpoint after each channel
	writeFileSync(
		CHECKPOINT_PATH,
		JSON.stringify({ processedChannels: [...processedChannels], at: Date.now() }, null, 2)
	);
	return r;
});

const totalMessages = results.reduce((s, r) => s + r.messageCount, 0);
const duration = ((Date.now() - startScan) / 1000).toFixed(1);
log(`\n📊 SCAN COMPLETE in ${duration}s`);
log(`   • ${results.length} channels`);
log(`   • ${totalMessages.toLocaleString()} messages scanned`);
log(`   • ${userAgg.size.toLocaleString()} unique authors humans`);
log(`   • ${levelUps.length} level-up announcements parsed`);
log(`   • ${achievementHits.length} achievement announcements parsed`);
log(`   • ${sanctionHits.length} sanctions parsed`);
log(`   • ${fusionHits.length} fusions parsed`);

if (DRY_RUN) {
	log("\n🔵 DRY-RUN — nothing written. Sample:");
	log("  Top 10 message senders:");
	[...userAgg.entries()]
		.toSorted((a, b) => b[1].messageCount - a[1].messageCount)
		.slice(0, 10)
		.forEach(([id, agg]) =>
			log(
				`    ${id}  ${agg.messageCount.toString().padStart(5)} msgs · last ${new Date(agg.lastMessageAt).toISOString()}`
			)
		);
	if (levelUps.length) log(`  Sample level-up: ${JSON.stringify(levelUps[0])}`);
	if (achievementHits.length) log(`  Sample achievement: ${JSON.stringify(achievementHits[0])}`);
	await client.destroy();
	process.exit(0);
}

// ─── Write to bot.db (batched UPSERT) ───────────────────────────────────
log("\n💾 Writing reconstruction to bot.db...");
const dbs = container.resolve(DatabaseService);
const db = dbs.db;

// 1. Users : merge messageCount + lastMessageAt (sans toucher au xp/zeni déjà reconstruit)
let userUpdates = 0;
for (const [id, agg] of userAgg) {
	const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
	if (existing.length === 0) {
		// Nouvel utilisateur, insère
		await db.insert(users).values({
			id,
			xp: 0,
			zeni: 1000,
			lastLevelReached: 0,
			messageCount: agg.messageCount,
			lastMessageAt: new Date(agg.lastMessageAt),
			totalVoiceMs: 0,
			dailyStreak: 0,
			createdAt: new Date(agg.firstMessageAt),
		});
	} else {
		await db
			.update(users)
			.set({
				messageCount: agg.messageCount,
				lastMessageAt: new Date(agg.lastMessageAt),
			})
			.where(eq(users.id, id));
	}
	userUpdates++;
}
log(`  ✓ ${userUpdates} users with messageCount + lastMessageAt`);

// 2. Level-ups parsés → update lastLevelReached si plus haut
const maxLevelByUser = new Map<string, { level: number; xp: number | null }>();
for (const lu of levelUps) {
	const cur = maxLevelByUser.get(lu.userId);
	if (!cur || lu.level > cur.level) maxLevelByUser.set(lu.userId, { level: lu.level, xp: lu.xp });
}
let levelUpdates = 0;
for (const [id, info] of maxLevelByUser) {
	await db
		.update(users)
		.set({
			lastLevelReached: info.level,
			...(info.xp ? { xp: info.xp } : {}),
		})
		.where(eq(users.id, id));
	levelUpdates++;
}
log(`  ✓ ${levelUpdates} users with level-up parsed`);

// 3. Achievements
let achInserted = 0;
for (const a of achievementHits) {
	if (!a.code) continue;
	try {
		await db.insert(achievements).values({
			userId: a.userId,
			code: a.code,
			unlockedAt: new Date(a.ts),
		});
		achInserted++;
	} catch {} // unique constraint = already exists
}
log(`  ✓ ${achInserted} achievements restored`);

// 4. Warns (sanctions type warn)
let warnInserted = 0;
for (const s of sanctionHits.filter((x) => x.type === "warn")) {
	try {
		await db.insert(warns).values({
			userId: s.userId,
			moderatorId: s.moderatorId ?? "0",
			reason: s.reason,
			active: true,
			createdAt: new Date(s.ts),
		});
		warnInserted++;
	} catch {}
}
log(`  ✓ ${warnInserted} warns restored`);

// 5. Jails (sanctions type jail)
let jailInserted = 0;
for (const s of sanctionHits.filter((x) => x.type === "jail")) {
	try {
		await db.insert(jails).values({
			userId: s.userId,
			moderatorId: s.moderatorId ?? "0",
			reason: s.reason,
			createdAt: new Date(s.ts),
		});
		jailInserted++;
	} catch {}
}
log(`  ✓ ${jailInserted} jails restored`);

// 6. Action logs (tous les sanctions pour traçabilité)
let logInserted = 0;
for (const s of sanctionHits) {
	try {
		await db.insert(actionLogs).values({
			actorId: s.moderatorId ?? "system",
			targetId: s.userId,
			action: s.type,
			reason: s.reason,
			createdAt: new Date(s.ts),
		});
		logInserted++;
	} catch {}
}
log(`  ✓ ${logInserted} action_logs restored`);

log(`\n🎉 RECOVERY DONE`);
const totalUsers = await db.select({ c: dsql<number>`count(*)` }).from(users);
log(`   Total users in DB now : ${Number(totalUsers[0]?.c ?? 0)}`);

dbs.close();
await client.destroy();
process.exit(0);
