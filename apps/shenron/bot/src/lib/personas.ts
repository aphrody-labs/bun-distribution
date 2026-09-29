import { IntentsBitField } from "discord.js";
import { env } from "./env";

/**
 * Liste des personas du bot Shenron.
 * Chaque persona = 1 application Discord = 1 token + 1 client_id.
 * Le routage des commands/events se fait via `@Discord({ botIds: [<id>] })`.
 *
 * - shenron      : admin + /config + héberge l'API REST + ready event
 * - beerus       : modération (warn/mute/ban/kick/clear/purge/role/lock/...)
 * - whis         : utility user-facing (/help, tickets, wiki, scan)
 * - grandPretre  : logs (MessageLog, JoinLeave, BioRole, InteractionLog, AuditLog)
 * - enma         : /jail, /unjail + JailExpiry + cron jail-expiry
 * - kaio         : jeux + économie + level + giveaway + vocal + fun + MessageXP/VoiceXP
 */
export const PERSONA_IDS = ["shenron", "beerus", "whis", "grandPretre", "enma", "kaio"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export interface PersonaConfig {
	readonly id: PersonaId;
	readonly name: string;
	readonly token: string;
	readonly appId?: string;
	readonly intents: number[];
}

const I = IntentsBitField.Flags;

export const PERSONAS: Record<PersonaId, PersonaConfig> = {
	// Shenron : slash commands (REST fetch suffit) + relais de messages privés.
	//
	// `DirectMessages` porte le relais `DirectMessageRelay` : sans lui, l'event
	// `messageCreate` ne se déclenche jamais en privé et le relais est
	// silencieusement mort — le mismatch intent↔event habituel. Le partial
	// `Channel` est déjà accordé à toutes les personas (`partialsFor` défaut),
	// il est indispensable ici : un salon privé n'est pas en cache au démarrage.
	//
	// `MessageContent` n'est PAS requis : Discord livre toujours le contenu des
	// messages envoyés en privé au bot. Inutile de demander un intent privilégié.
	//
	// Effet de bord vérifié : `ShenronAutonomousChat` écoute aussi `messageCreate`,
	// mais `handleMessage` sort sur `!message.inGuild()` — un privé ne peut donc
	// pas déclencher de réponse IA autonome.
	shenron: {
		id: "shenron",
		name: "Shenron",
		token: env.DISCORD_TOKEN_SHENRON,
		appId: env.APPLICATION_ID_SHENRON,
		intents: [I.Guilds, I.DirectMessages],
	},
	// Beerus : ban/kick via REST, GuildModeration pour audit log entries
	beerus: {
		id: "beerus",
		name: "Beerus",
		token: env.DISCORD_TOKEN_BEERUS,
		appId: env.APPLICATION_ID_BEERUS,
		intents: [I.Guilds, I.GuildModeration],
	},
	// Whis : tickets + wiki, /scan ; GuildMessages pour observer panneau de tickets
	whis: {
		id: "whis",
		name: "Whis",
		token: env.DISCORD_TOKEN_WHIS,
		appId: env.APPLICATION_ID_WHIS,
		intents: [I.Guilds, I.GuildMessages],
	},
	// Grand Prêtre : logs complets — REQUIRES privileged intents activés sur le portal
	// (Server Members + Presence + Message Content)
	grandPretre: {
		id: "grandPretre",
		name: "Grand Prêtre",
		token: env.DISCORD_TOKEN_GRAND_PRETRE,
		appId: env.APPLICATION_ID_GRAND_PRETRE,
		intents: [
			I.Guilds,
			I.GuildMembers,
			I.GuildMessages,
			I.MessageContent,
			I.GuildInvites,
			I.GuildModeration,
			I.GuildPresences,
		],
	},
	// Enma : jail/unjail, REST suffit
	enma: {
		id: "enma",
		name: "Enma",
		token: env.DISCORD_TOKEN_ENMA,
		appId: env.APPLICATION_ID_ENMA,
		intents: [I.Guilds],
	},
	// Kaïo : XP via messageCreate (Message Content privileged) + voice + GuildMembers
	// requis pour récupérer member.roles / poser les rôles level via handleLevelUp.
	kaio: {
		id: "kaio",
		name: "Kaïo",
		token: env.DISCORD_TOKEN_KAIO,
		appId: env.APPLICATION_ID_KAIO,
		intents: [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent, I.GuildVoiceStates],
	},
};
