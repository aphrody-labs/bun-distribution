import type { Client, Guild, SendableChannels } from "discord.js";
import { container } from "tsyringe";
import { env } from "~/lib/env";
import { SettingsService } from "~/services/SettingsService";

async function resolveById(
	client: Client,
	id: string | undefined,
	guild?: Guild
): Promise<SendableChannels | null> {
	if (!id) return null;
	const cached = (guild ?? client.guilds.cache.first())?.channels.cache.get(id);
	if (cached && "send" in cached) return cached as SendableChannels;
	const fetched = await client.channels.fetch(id).catch(() => null);
	if (fetched && "send" in fetched) return fetched as SendableChannels;
	return null;
}

/**
 * Résolution avec priorité runtime :
 *   1. SettingsService (override depuis dashboard / `/config channel`)
 *   2. env fallback
 */
async function resolveSettingChannel(
	client: Client,
	settingKey: string,
	envFallback: string | undefined,
	guild?: Guild
): Promise<SendableChannels | null> {
	const settings = container.resolve(SettingsService);
	const override = await settings.getSnowflake(settingKey);
	return resolveById(client, override ?? envFallback, guild);
}

async function resolveAnnounceChannel(
	client: Client,
	guild?: Guild
): Promise<SendableChannels | null> {
	return resolveSettingChannel(client, "channel.announce", env.ANNOUNCE_CHANNEL_ID, guild);
}

/**
 * Salon dédié aux level-up (`channel.level`) ; sinon retombe sur announce.
 */
export async function resolveLevelChannel(
	client: Client,
	guild?: Guild
): Promise<SendableChannels | null> {
	const settings = container.resolve(SettingsService);
	const levelOverride = await settings.getSnowflake("channel.level");
	if (levelOverride) {
		const ch = await resolveById(client, levelOverride, guild);
		if (ch) return ch;
	}
	const envFallback = await resolveById(client, env.LEVEL_CHANNEL_ID, guild);
	if (envFallback) return envFallback;

	return resolveAnnounceChannel(client, guild);
}

/**
 * Salon des messages "🏆 succès débloqué". Cascade :
 *   channel.achievement > env.ACHIEVEMENT_CHANNEL_ID > channel.announce > env.ANNOUNCE_CHANNEL_ID
 */
async function resolveAchievementChannel(
	client: Client,
	guild?: Guild
): Promise<SendableChannels | null> {
	const dedicated = await resolveSettingChannel(
		client,
		"channel.achievement",
		env.ACHIEVEMENT_CHANNEL_ID,
		guild
	);
	if (dedicated) return dedicated;
	return resolveAnnounceChannel(client, guild);
}
