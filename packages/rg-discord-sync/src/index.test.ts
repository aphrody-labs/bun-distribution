import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Guild } from "discord.js";
import { markDiscordGuildLeft, openDiscordSnapshot, syncDiscordGuildSnapshot } from "./index";

const directory = mkdtempSync(join(tmpdir(), "rg-discord-sync-"));
Bun.env.RG_DISCORD_SYNC_SQLITE_PATH = join(directory, "shared.sqlite");
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("two bot identities retain independent guild presence and snapshots", async () => {
	const member = {
		guild: { id: "guild-1" }, id: "user-1",
		user: { username: "player", globalName: "Player", bot: false, avatarURL: () => null },
		nickname: null, avatarURL: () => null, joinedAt: new Date("2026-01-01"),
		premiumSince: null, roles: { cache: new Map([["guild-1", {}], ["role-1", {}]]) },
	};
	const guild = {
		id: "guild-1", name: "Shared", description: null, memberCount: 1,
		iconURL: () => null,
		client: { options: { intents: { has: () => false } } },
		roles: { fetch: async () => new Map([["role-1", {
			id: "role-1", name: "Players", color: 10, position: 1,
			permissions: { bitfield: 8n }, managed: false, mentionable: true,
		}]]) },
		channels: { fetch: async () => new Map([["channel-1", {
			id: "channel-1", name: "general", type: 0, parentId: null, position: 0,
		}]]), fetchActiveThreads: async () => ({ threads: new Map() }) },
		emojis: { fetch: async () => new Map(), cache: new Map() },
		scheduledEvents: { fetch: async () => new Map(), cache: new Map() },
		members: { cache: new Map([["user-1", member]]) },
	} as unknown as Guild;
	const rg = { sourceBotId: "rg-bot", profile: "rg" };
	const legacy = { sourceBotId: "legacy-bot", profile: "achillea-legacy" };
	expect((await syncDiscordGuildSnapshot(guild, rg))?.membersComplete).toBe(false);
	expect((await syncDiscordGuildSnapshot(guild, legacy))?.guildId).toBe("guild-1");
	markDiscordGuildLeft(legacy, guild.id);
	const db = openDiscordSnapshot();
	try {
		const rows = db!.query("SELECT source_bot_id, present FROM rg_discord_guild_presence ORDER BY source_bot_id").all() as { source_bot_id: string; present: number }[];
		expect(rows).toEqual([
			{ source_bot_id: "legacy-bot", present: 0 },
			{ source_bot_id: "rg-bot", present: 1 },
		]);
		expect(db!.query("SELECT count(*) AS n FROM rg_discord_guilds").get()).toEqual({ n: 2 });
		expect(db!.query("SELECT count(*) AS n FROM rg_discord_members").get()).toEqual({ n: 2 });
		expect(db!.query("SELECT count(*) AS n FROM rg_discord_roles").get()).toEqual({ n: 2 });
		expect(db!.query("SELECT count(*) AS n FROM rg_discord_channels").get()).toEqual({ n: 2 });
	} finally {
		db?.close();
	}
});
