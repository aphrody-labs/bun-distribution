import { GatewayIntentBits, Partials } from "discord.js";
import type { ClientOptions } from "@aphrody/discordx";

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

/**
 * Intents demandés en marche nominale. Les trois derniers (GuildMembers,
 * GuildPresences, MessageContent) sont PRIVILÉGIÉS : ils exigent un interrupteur
 * activé dans Discord Dev Portal → Bot. S'ils sont refusés, Discord ne dégrade pas,
 * il ferme la connexion (« Used disallowed intents ») — le bot est alors totalement
 * absent, commandes slash comprises.
 */
export const FULL_INTENTS = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.GuildMessageReactions,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.GuildPresences,
	GatewayIntentBits.DirectMessages,
	GatewayIntentBits.MessageContent,
] as const;

/**
 * Repli sans aucun intent privilégié. Un bot avec des commandes slash dégradées
 * (pas de liste de membres, pas de contenu de message) rend infiniment plus de
 * service qu'un bot hors ligne : les tournois, clans et le ranked passent par
 * les interactions, qui ne demandent aucun intent privilégié.
 */
export const FALLBACK_INTENTS = FULL_INTENTS.filter(
	(i) =>
		i !== GatewayIntentBits.GuildMembers &&
		i !== GatewayIntentBits.GuildPresences &&
		i !== GatewayIntentBits.MessageContent
);

/** Bits de `application.flags` qui attestent qu'un intent privilégié est accordé. */
const GRANT_BITS = {
	// approuvé (bot vérifié) ou activé manuellement sur une app < 100 serveurs
	presence: [1 << 12, 1 << 13],
	members: [1 << 14, 1 << 15],
	messageContent: [1 << 18, 1 << 19],
} as const;

/**
 * Intents réellement utilisables avec ce token.
 *
 * Le repli ne peut PAS se faire après coup : `client.options.intents` est figé à la
 * construction, et retenter un login avec une liste réduite laisse discord.js
 * s'identifier avec l'ancienne — la connexion est refusée une seconde fois. On
 * interroge donc l'application AVANT de construire le client, et on n'en demande
 * que ce qui est accordé.
 *
 * En cas d'appel impossible (réseau, API en panne), on demande la liste complète :
 * l'hypothèse optimiste est la bonne quand le bot est correctement configuré, et
 * l'erreur de login reste rattrapée en aval.
 */
export async function resolveGrantedIntents(botToken: string): Promise<GatewayIntentBits[]> {
	let flags = 0;
	try {
		const res = await fetch("https://discord.com/api/v10/applications/@me", {
			headers: { Authorization: `Bot ${botToken}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return [...FULL_INTENTS];
		flags = ((await res.json()) as { flags?: number }).flags ?? 0;
	} catch {
		return [...FULL_INTENTS];
	}

	const granted = (bits: readonly number[]) => bits.some((b) => (flags & b) !== 0);
	const refused: string[] = [];
	const intents = FULL_INTENTS.filter((i) => {
		if (i === GatewayIntentBits.GuildMembers && !granted(GRANT_BITS.members)) {
			refused.push("GuildMembers");
			return false;
		}
		if (i === GatewayIntentBits.GuildPresences && !granted(GRANT_BITS.presence)) {
			refused.push("GuildPresences");
			return false;
		}
		if (i === GatewayIntentBits.MessageContent && !granted(GRANT_BITS.messageContent)) {
			refused.push("MessageContent");
			return false;
		}
		return true;
	});

	if (refused.length > 0) {
		console.error(
			`[bot] Intents privilégiés NON activés sur l'application : ${refused.join(", ")}. ` +
				"Discord refuserait la connexion en bloc (« Used disallowed intents ») — on se connecte " +
				"donc sans eux, en mode dégradé. Pour rétablir : Discord Dev Portal → Bot → " +
				"Privileged Gateway Intents."
		);
	}
	return [...intents];
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

/** Refuse silencieusement les melanges token/application avant le login Gateway. */
export async function assertDiscordTokenMatchesProfile(
	botToken: string,
	profile = discordBotProfile
): Promise<void> {
	if (!profile.clientId) throw new Error(`Client ID Discord absent pour le profil ${profile.name}`);
	const response = await fetch("https://discord.com/api/v10/applications/@me", {
		headers: { Authorization: `Bot ${botToken}` },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(`Token Discord invalide pour le profil ${profile.name} (HTTP ${response.status})`);
	}
	const application = (await response.json()) as { id?: string };
	if (application.id !== profile.clientId) {
		throw new Error(
			`Profil Discord incoherent : token=${application.id ?? "inconnu"}, clientId=${profile.clientId}`
		);
	}
}
