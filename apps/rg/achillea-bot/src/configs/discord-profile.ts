import { env } from "@/env";

export type DiscordBotProfileName = "legacy" | "current";

export interface DiscordBotProfile {
	name: DiscordBotProfileName;
	token: string | undefined;
	clientId: string | undefined;
	clientSecret: string | undefined;
	publicKey: string | undefined;
}

/**
 * Identite Discord atomique du processus.
 *
 * Ne jamais selectionner le token et l'application separement : un token legacy
 * associe a l'ID de la nouvelle application peut se connecter, mais les emojis,
 * webhooks et messages produits appartiennent alors a une autre application.
 */
export function resolveDiscordBotProfile(
	name: DiscordBotProfileName = env.BOT_PROFILE
): DiscordBotProfile {
	if (name === "current") {
		return {
			name,
			token: env.BOT_TOKEN,
			clientId: env.DISCORD_CLIENT_ID,
			clientSecret: env.DISCORD_CLIENT_SECRET,
			publicKey: env.DISCORD_PUBLIC_KEY,
		};
	}

	return {
		name,
		token: env.DEV_BOT_TOKEN,
		clientId: env.DISCORD_CLIENT_ID_DEV,
		clientSecret: env.DISCORD_CLIENT_SECRET_DEV,
		publicKey: env.DISCORD_PUBLIC_KEY_DEV,
	};
}

export const discordBotProfile = resolveDiscordBotProfile();
export function assertDiscordBotProfile(profile: DiscordBotProfile): void {
	if (!profile.token) throw new Error(`Token Discord absent pour le profil ${profile.name}`);
	if (!profile.clientId) {
		throw new Error(`Client ID Discord absent pour le profil ${profile.name}`);
	}
}
