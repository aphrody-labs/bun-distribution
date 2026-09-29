#!/usr/bin/env bun
/**
 * Backfill `db_news` depuis l'historique des salons d'annonces Discord.
 *
 * À lancer une fois (et idempotent) pour peupler la page Actualités avant que
 * l'event temps réel `NewsScan` ne prenne le relais. Capte :
 *   - tous les salons de type Annonce (`ChannelType.GuildAnnouncement`),
 *   - le salon configuré `channel.announce` (guild_settings),
 *   - posts humains + webhooks (pas les bots/personas).
 *
 * Usage :
 *   bun scripts/backfill-discord-news.ts                 # 50 derniers msgs/salon
 *   bun scripts/backfill-discord-news.ts --limit 200
 *   bun scripts/backfill-discord-news.ts --dry-run
 */
import "reflect-metadata";
import { container } from "tsyringe";
import { Client, GatewayIntentBits, ChannelType, type GuildTextBasedChannel } from "discord.js";
import { env } from "~/lib/env";
import { NewsService } from "~/services/NewsService";
import { SettingsService } from "~/services/SettingsService";

const argVal = (k: string, d: string) => {
	const i = process.argv.indexOf(k);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const LIMIT = Math.min(Number(argVal("--limit", "50")), 100);
const DRY_RUN = process.argv.includes("--dry-run");
const log = (...m: unknown[]) => console.log(...m);

const news = container.resolve(NewsService);
const settings = container.resolve(SettingsService);

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

await client.login(env.DISCORD_TOKEN_GRAND_PRETRE);
await new Promise<void>((r) => client.once("clientReady", () => r()));
log(`✓ connecté ${client.user?.tag}`);

const guild = await client.guilds.fetch(env.GUILD_ID);
const all = await guild.channels.fetch();
const configured = await settings.getSnowflake("channel.announce");

const targets = all
	.filter(
		(c): c is GuildTextBasedChannel =>
			!!c &&
			c.viewable === true &&
			(c.type === ChannelType.GuildAnnouncement || (!!configured && c.id === configured))
	)
	.toJSON();

log(
	`✓ ${targets.length} salon(s) d'annonces : ${targets.map((c) => `#${c.name}`).join(", ") || "(aucun)"}`
);

let saved = 0;
for (const ch of targets) {
	const msgs = await ch.messages.fetch({ limit: LIMIT });
	for (const m of msgs.values()) {
		const isHumanOrWebhook = !m.author.bot || !!m.webhookId;
		if (!isHumanOrWebhook) continue;
		if (DRY_RUN) {
			const preview = (m.content || m.embeds[0]?.title || "(image)").slice(0, 60);
			log(`  · #${ch.name} → ${preview}`);
			saved++;
			continue;
		}
		if (await news.saveFromDiscord(m)) saved++;
	}
}

log(`✓ ${saved} annonce(s) ${DRY_RUN ? "détectées (dry-run)" : "enregistrées"}`);
await client.destroy();
process.exit(0);
