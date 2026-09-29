/** One-shot, metadata-only mirror for an Achilléa Discord bot identity. */
import { Client, GatewayIntentBits } from "discord.js";
import { syncDiscordGuildSnapshot } from "@rosegriffon/discord-sync";

const profile = process.argv[2];
if (profile !== "legacy" && profile !== "current") {
	throw new Error("usage: bun scripts/sync-discord-profile.ts legacy|current");
}
const token = profile === "legacy" ? process.env.DEV_BOT_TOKEN : process.env.BOT_TOKEN;
if (!token) throw new Error(`Discord token unavailable for ${profile}`);
if (!process.env.RG_DISCORD_SYNC_SQLITE_PATH) {
	throw new Error("RG_DISCORD_SYNC_SQLITE_PATH is required");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
try {
	const ready = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Discord gateway ready timeout")), 30_000);
		client.once("ready", () => { clearTimeout(timeout); resolve(); });
		client.once("error", (error) => { clearTimeout(timeout); reject(error); });
	});
	await client.login(token);
	await ready;
	if (!client.user) throw new Error("Discord bot identity unavailable");
	let succeeded = 0;
	let failed = 0;
	for (const guild of client.guilds.cache.values()) {
		try {
			const report = await syncDiscordGuildSnapshot(guild, {
				sourceBotId: client.user.id,
				profile,
			});
			if (report) succeeded++;
		} catch (error) {
			failed++;
			console.error(`[discord-sync] ${profile} guild=${guild.id} failed:`, error instanceof Error ? error.message : String(error));
		}
	}
	console.log(`[discord-sync] ${profile} guilds=${client.guilds.cache.size} succeeded=${succeeded} failed=${failed}`);
	if (failed) process.exitCode = 1;
} finally {
	client.destroy();
}
