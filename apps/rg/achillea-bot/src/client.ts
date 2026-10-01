import { GatewayIntentBits, Partials } from "discord.js";
import type { ClientOptions } from "discordx";
import {
	assertDiscordTokenMatchesProfile as assertTokenMatchesProfileKit,
	createProductionCacheOptions,
	FALLBACK_INTENTS,
	FULL_INTENTS,
	resolveGrantedIntents as resolveGrantedIntentsKit,
} from "@aphrody/discord-kit";

import { generalConfig, logsConfig } from "@/configs";
import { discordBotProfile } from "@/configs/discord-profile";
import { env } from "@/env";
import {
	ChannelRestriction,
	ExtractLocale,
	GuildOnly,
	Maintenance,
	NotBot,
	RequestContextIsolator,
} from "@/guards";
import { Blacklist } from "./guards/blacklist";

export { FALLBACK_INTENTS, FULL_INTENTS };

/**
 * Intents réellement utilisables avec ce token, résolus avant construction du client.
 */
export async function resolveGrantedIntents(botToken: string): Promise<GatewayIntentBits[]> {
	return resolveGrantedIntentsKit(botToken, {
		desiredIntents: FULL_INTENTS,
	});
}

export function clientConfig(intents: readonly GatewayIntentBits[] = FULL_INTENTS): ClientOptions {
	const commandGuilds = env.BOT_COMMAND_GUILDS
		?.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return {
		// to only use global commands (use @Guild for specific guild command), comment this line
		botGuilds:
			commandGuilds?.length
				? commandGuilds
				: env.NODE_ENV === "development" && env.TEST_GUILD_ID
					? [env.TEST_GUILD_ID]
					: undefined,

		// Intents résolus par `resolveGrantedIntents()` : demander un intent privilégié
		// non activé dans le Dev Portal fait refuser la connexion EN BLOC.
		intents: [...intents],

		partials: [Partials.Channel, Partials.Message, Partials.Reaction],

		// debug logs are disabled in silent mode
		silent: !logsConfig.debug,

		...createProductionCacheOptions(),

		guards: [
			RequestContextIsolator,
			NotBot,
			Maintenance,
			ExtractLocale,
			Blacklist,
			ChannelRestriction,
		],

		// configuration for @SimpleCommand
		simpleCommand: {
			prefix: generalConfig.simpleCommandsPrefix,
		},
	};
}

/** Refuse silencieusement les mélanges token/application avant le login Gateway. */
export async function assertDiscordTokenMatchesProfile(
	botToken: string,
	profile = discordBotProfile
): Promise<void> {
	await assertTokenMatchesProfileKit(botToken, profile);
}
