import { singleton, inject } from "tsyringe";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { guildSettings } from "~/db/schema";
import { EventBusService } from "./EventBusService";
import {
	XP_MESSAGE_COOLDOWN_MS,
	XP_PER_MESSAGE_MAX,
	XP_PER_MESSAGE_MIN,
	XP_PER_VOICE_TICK,
} from "~/lib/constants";
import { RACE_IDS, RACES, REGEN_XP, REGEN_ZENI, setRaceTuning } from "~/lib/races";
import { DEFAULT_XP_BOOST_CONFIG as XP_BOOST } from "~/lib/xp-boosts";
import { DEFAULT_INTERNAL_SERVICES } from "@shenron/config/services";

/**
 * Settings runtime — table key/value persistée en SQLite.
 *
 * - Source de vérité dynamique : si une key existe → override l'env / les
 *   constantes hardcodées.
 * - Cache mémoire (TTL 30s) pour éviter de hammerer la DB depuis les events
 *   chauds (MessageXP, VoiceXP).
 *
 * **Mono-guild assumed** — le bot est verrouillé sur `env.GUILD_ID` (cf.
 * `lib/env.ts`). La table `guild_settings` n'a pas de colonne `guild_id` à
 * dessein. Si un jour on veut multi-guild, ajouter `guild_id text NOT NULL`
 * + PK composite et filtrer toutes les queries — voir `Pendu.ts` et
 * `Morpion.ts` Maps qui sont déjà global aussi.
 *
 * Toujours documenter une nouvelle key dans `SETTINGS_KEYS` ci-dessous : ça
 * sert de schéma + autocomplete pour /config.
 */

export interface SettingDef {
	key: string;
	type: "int" | "float" | "snowflake" | "string" | "bool";
	description: string;
	default?: number | string | boolean;
	min?: number;
	max?: number;
	/**
	 * Catégorie d'organisation pour le dashboard. Utilisée pour grouper les
	 * settings dans l'UI. Sans impact runtime.
	 */
	category?:
		| "xp"
		| "economy"
		| "channels"
		| "roles"
		| "moderation"
		| "features"
		| "translate"
		| "anti_invite"
		| "tickets"
		| "gifs"
		| "advanced";
	/** Si true, le rendu se fera comme un input vocal channel (type=2) au lieu de text. */
	channelType?: "text" | "voice" | "category" | "any";
	/**
	 * Si true, `key` est un préfixe et toutes les sous-clés (`<prefix><suffix>`)
	 * sont valides — utile pour des collections dynamiques où l'on ne connaît
	 * pas les ids à l'avance (ex: `xp.boost.role.<roleId>`).
	 */
	prefix?: boolean;
}

export const XP_BOOST_ROLE_PREFIX = "xp.boost.role.";

/** Types de ticket — cf. `TicketService`/`Ticket.ts` (garder synchro avec l'enum `db/schema.ts#tickets.kind`). */
export const TICKET_KINDS = ["report", "achat", "shop", "abus"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
/** Préfixe des rôles ayant accès à un type de ticket : `tickets.access.<kind>.<roleId>` = "1". */
export const TICKET_ACCESS_PREFIX = "tickets.access.";

export const SETTINGS_KEYS: SettingDef[] = [
	// ── XP / niveaux ───────────────────────────────────────────────
	{
		key: "xp.message.min",
		type: "int",
		category: "xp",
		description: "XP min par message",
		default: XP_PER_MESSAGE_MIN,
		min: 0,
		// Relevé le 2026-09-12 : l'économie d'XP du serveur a été recalibrée le
		// 07/09 (courbe de niveaux jusqu'à 6 × 10¹⁷) ; 1 000 rendait invalides les
		// valeurs choisies par l'admin.
		max: 20_000,
	},
	{
		key: "xp.message.max",
		type: "int",
		category: "xp",
		description: "XP max par message",
		default: XP_PER_MESSAGE_MAX,
		min: 0,
		max: 20_000,
	},
	{
		key: "xp.message.cooldown_ms",
		type: "int",
		category: "xp",
		description: "Délai minimal entre deux gains d'XP par message (ms)",
		default: XP_MESSAGE_COOLDOWN_MS,
		min: 0,
	},
	{
		key: "xp.voice.per_minute",
		type: "int",
		category: "xp",
		description: "XP gagnée par minute en vocal, avant multiplicateurs",
		default: XP_PER_VOICE_TICK,
		min: 0,
		max: 10_000,
	},
	{
		key: "xp.voice.min_members",
		type: "int",
		category: "xp",
		description:
			"Membres qui gagnent requis dans un salon pour que le vocal rapporte. 1 = on gagne seul, 2 = pas de gain seul.",
		default: XP_BOOST.voice.minMembers,
		min: 1,
		max: 10,
	},
	{
		key: "xp.voice.muted_ratio",
		type: "float",
		category: "xp",
		description: "Part du gain vocal micro coupé (1 = gain entier, 0 = rien).",
		default: XP_BOOST.voice.mutedRatio,
		min: 0,
		max: 1,
	},
	{
		key: "xp.voice.deafened_ratio",
		type: "float",
		category: "xp",
		description:
			"Part du gain vocal casque coupé (1 = gain entier, 0 = rien). Ignorée en sleepcall.",
		default: XP_BOOST.voice.deafenedRatio,
		min: 0,
		max: 1,
	},
	{
		key: "xp.voice.group.bonus_per_member",
		type: "float",
		category: "xp",
		description:
			"Vocal à plusieurs : bonus par membre au-delà du premier (0,1 = +10 % par membre).",
		default: XP_BOOST.group.bonusPerMember,
		min: 0,
		max: 1,
	},
	{
		key: "xp.voice.group.max_multiplier",
		type: "float",
		category: "xp",
		description: "Vocal à plusieurs : multiplicateur maximal du bonus de groupe.",
		default: XP_BOOST.group.maxMultiplier,
		min: 1,
		max: 10,
	},
	{
		key: "xp.night.enabled",
		type: "bool",
		category: "xp",
		description: "Boost d'XP de nuit (écrit et vocal) pendant la plage horaire définie.",
		default: XP_BOOST.night.enabled,
	},
	{
		key: "xp.night.start_hour",
		type: "int",
		category: "xp",
		description: "Heure locale de début de la nuit (0 = minuit).",
		default: XP_BOOST.night.startHour,
		min: 0,
		max: 23,
	},
	{
		key: "xp.night.end_hour",
		type: "int",
		category: "xp",
		description: "Heure locale de fin de la nuit (exclue). La plage peut passer minuit (22 → 7).",
		default: XP_BOOST.night.endHour,
		min: 0,
		max: 23,
	},
	{
		key: "xp.night.timezone",
		type: "string",
		category: "xp",
		description: "Fuseau horaire IANA des heures de nuit.",
		default: XP_BOOST.night.timezone,
	},
	{
		key: "xp.night.voice_multiplier",
		type: "float",
		category: "xp",
		description: "Multiplicateur d'XP vocale la nuit, hors sleepcall.",
		default: XP_BOOST.night.voiceMultiplier,
		min: 0,
		max: 10,
	},
	{
		key: "xp.night.message_multiplier",
		type: "float",
		category: "xp",
		description: "Multiplicateur d'XP par message la nuit.",
		default: XP_BOOST.night.messageMultiplier,
		min: 0,
		max: 10,
	},
	{
		key: "xp.sleepcall.enabled",
		type: "bool",
		category: "xp",
		description:
			"Sleepcall : la nuit, un vocal à plusieurs gagne un boost, micro et casque coupés compris.",
		default: XP_BOOST.sleepcall.enabled,
	},
	{
		key: "xp.sleepcall.min_members",
		type: "int",
		category: "xp",
		description: "Membres présents requis pour qu'un vocal de nuit devienne un sleepcall.",
		default: XP_BOOST.sleepcall.minMembers,
		min: 2,
		max: 10,
	},
	{
		key: "xp.sleepcall.multiplier",
		type: "float",
		category: "xp",
		description: "Multiplicateur d'XP vocale en sleepcall (remplace le boost de nuit).",
		default: XP_BOOST.sleepcall.multiplier,
		min: 0,
		max: 10,
	},
	{
		key: "xp.sleepcall.announce",
		type: "bool",
		category: "xp",
		description:
			"Annoncer le début et le bilan des sleepcalls (templates sleepcall_start et sleepcall_end).",
		default: XP_BOOST.sleepcall.announce,
	},
	{
		key: "xp.zenkai.multiplier",
		type: "float",
		category: "xp",
		description: "Multiplicateur Zenkai des Saiyans après un palier.",
		default: XP_BOOST.zenkai.multiplier,
		min: 1,
		max: 10,
	},
	{
		key: "xp.zenkai.minutes",
		type: "int",
		category: "xp",
		description: "Durée du Zenkai après un palier (minutes).",
		default: XP_BOOST.zenkai.minutes,
		min: 0,
		max: 1440,
	},
	...RACE_IDS.flatMap((id): SettingDef[] => [
		{
			key: `xp.race.${id}.message`,
			type: "float",
			category: "xp",
			description: `Multiplicateur d'XP par message de la race ${RACES[id].name}.`,
			default: XP_BOOST.race[id].message,
			min: 0,
			max: 10,
		},
		{
			key: `xp.race.${id}.voice`,
			type: "float",
			category: "xp",
			description: `Multiplicateur d'XP vocale de la race ${RACES[id].name}.`,
			default: XP_BOOST.race[id].voice,
			min: 0,
			max: 10,
		},
	]),
	{
		key: "xp.multiplier.max",
		type: "float",
		category: "xp",
		description: "Plafond du multiplicateur cumulé (rôle × race × groupe × nuit ou sleepcall).",
		default: XP_BOOST.maxMultiplier,
		min: 1,
	},
	{
		key: "xp.sleepcall.grace_minutes",
		type: "int",
		category: "xp",
		description:
			"Creux toléré (minutes) avant de clore un sleepcall qui ne remplit plus les conditions pendant la nuit.",
		default: XP_BOOST.sleepcall.graceMinutes,
		min: 0,
		max: 120,
	},
	{
		key: "xp.sleepcall.summary_min_minutes",
		type: "int",
		category: "xp",
		description: "Durée minimale (minutes) d'un sleepcall pour publier son bilan et le journaliser.",
		default: XP_BOOST.sleepcall.summaryMinMinutes,
		min: 0,
		max: 720,
	},

	// ── Races : zénis et régén ─────────────────────────────────────
	...RACE_IDS.flatMap((id): SettingDef[] => [
		{
			key: `race.${id}.zeni`,
			type: "float",
			category: "economy",
			description: `Multiplicateur de tous les gains de zénis de la race ${RACES[id].name}.`,
			default: RACES[id].zeni,
			min: 0,
			max: 10,
		},
		{
			key: `race.${id}.game_zeni`,
			type: "float",
			category: "economy",
			description: `Multiplicateur supplémentaire des zénis de mini-jeux de la race ${RACES[id].name}.`,
			default: RACES[id].gameZeni,
			min: 0,
			max: 10,
		},
	]),
	{
		key: "race.regen.xp",
		type: "int",
		category: "economy",
		description: "Régén passive (Namek) : XP offerte à la première activité de la période.",
		default: REGEN_XP,
		min: 0,
		max: 1_000_000,
	},
	{
		key: "race.regen.zeni",
		type: "int",
		category: "economy",
		description: "Régén passive (Namek) : zénis offerts à la première activité de la période.",
		default: REGEN_ZENI,
		min: 0,
		max: 1_000_000,
	},
	{
		key: "race.regen.hours",
		type: "float",
		category: "economy",
		description: "Régén passive (Namek) : intervalle en heures entre deux régénérations.",
		default: 24,
		min: 1,
		max: 168,
	},

	// ── Anti-triche zénis ──────────────────────────────────────────
	{
		key: "anticheat.zeni.max_single",
		type: "int",
		category: "economy",
		description: "Anti-triche : gain unitaire de zénis (hors admin) qui lève un signalement SPIKE et gèle.",
		default: 25_000,
		min: 1,
	},
	{
		key: "anticheat.zeni.max_hourly",
		type: "int",
		category: "economy",
		description: "Anti-triche : somme des gains de zénis sur 1 h au-delà de laquelle un signalement est levé.",
		default: 80_000,
		min: 1,
	},
	{
		key: "anticheat.zeni.max_daily",
		type: "int",
		category: "economy",
		description: "Anti-triche : somme des gains de zénis sur 24 h au-delà de laquelle un signalement est levé.",
		default: 250_000,
		min: 1,
	},
	{
		key: "anticheat.zeni.max_events_hour",
		type: "int",
		category: "economy",
		description: "Anti-triche : nombre de gains de zénis en 1 h qui lève un signalement VELOCITY.",
		default: 40,
		min: 1,
	},
	{
		key: "anticheat.zeni.max_game_hour",
		type: "int",
		category: "economy",
		description: "Anti-triche : gains de mini-jeux en 1 h qui lèvent un signalement GAME_BURST.",
		default: 25,
		min: 1,
	},
	{
		key: "anticheat.zeni.level_ratio",
		type: "int",
		category: "economy",
		description: "Anti-triche : solde plausible par niveau ((niveau + 1) × ratio) avant signalement RATIO.",
		default: 75_000,
		min: 1,
	},
	{
		key: "anticheat.zeni.auto_freeze_high",
		type: "bool",
		category: "economy",
		description: "Anti-triche : geler automatiquement les gains sur un signalement grave.",
		default: true,
	},
	{
		key: "features.level_role_sync",
		type: "bool",
		category: "features",
		description: "Réconciliation périodique des rôles de palier par race sur toute la guilde.",
		default: true,
	},
	{
		key: "game.pfc.duel_timeout_ms",
		type: "int",
		category: "features",
		description: "Pierre-feuille-ciseaux : délai (ms) avant expiration d'un duel sans réponse.",
		default: 10 * 60_000,
		min: 10_000,
		max: 24 * 60 * 60_000,
	},
	{
		key: "anticheat.xp.max_single",
		type: "int",
		category: "xp",
		description: "Gain d'XP unitaire (hors admin) au-delà duquel un signalement XP_SPIKE est levé.",
		default: 5_000_000,
		min: 1_000,
	},
	{
		key: "xp.fusion.bonus_ratio",
		type: "float",
		category: "xp",
		description: "Ratio XP fusion (partenaire reçoit X% du gain)",
		default: 0.25,
		min: 0,
		max: 1,
	},

	// ── Économie ───────────────────────────────────────────────────
	{
		key: "zeni.daily_quest",
		type: "int",
		category: "economy",
		description: "Récompense quête quotidienne (zeni)",
		default: 50,
		min: 0,
	},
	{
		key: "zeni.per_level",
		type: "int",
		category: "economy",
		description: "Bonus zenis par level-up",
		default: 1000,
		min: 0,
	},
	{
		key: "zeni.message_chance",
		type: "float",
		category: "economy",
		description: "Probabilité de drop zeni par message (0-1)",
		default: 0,
		min: 0,
		max: 1,
	},
	{
		key: "zeni.message_drop_min",
		type: "int",
		category: "economy",
		description: "Drop zeni min sur message",
		default: 5,
		min: 0,
	},
	{
		key: "zeni.message_drop_max",
		type: "int",
		category: "economy",
		description: "Drop zeni max sur message",
		default: 25,
		min: 0,
	},
	{
		key: "zeni.game.win",
		type: "int",
		category: "economy",
		description: "Gain zeni par victoire (Bingo/Morpion/Pendu/Pfc)",
		default: 100,
		min: 0,
	},
	{
		key: "zeni.game.loss_penalty",
		type: "int",
		category: "economy",
		description: "Pénalité zeni par défaite (0 = pas de pénalité)",
		default: 0,
		min: 0,
	},
	{
		key: "zeni.fusion.bonus_ratio",
		type: "float",
		category: "economy",
		description: "Ratio zeni fusion (partenaire reçoit X% du gain)",
		default: 0.1,
		min: 0,
		max: 1,
	},

	// ── Salons (toutes les surfaces) ───────────────────────────────
	{
		key: "channel.announce",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon des annonces",
	},
	{
		key: "chat.blacklist_channels",
		type: "string",
		category: "features",
		default: "",
		description:
			"Salons où les personas ne répondent JAMAIS (chat autonome désactivé). IDs séparés par des virgules. Les salons de type Annonces sont déjà exclus automatiquement.",
	},
	{
		key: "chat.autonomous_enabled",
		type: "bool",
		category: "features",
		default: false,
		description:
			"Réponses IA autonomes des bots sur le serveur (mention / nom / proactif). Désactivé : les personas n'engagent plus de conversation IA (l'indexation et les analytics restent actives). Réactiver ici pour rétablir le chat IA.",
	},
	{
		key: "channel.achievement",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon des accomplissements",
	},
	{
		key: "channel.level",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon des messages de niveau",
	},
	{
		key: "channel.commands",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon où /commandes sont autorisées",
	},
	{
		key: "channel.welcome",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon bienvenue (joinLeave)",
	},
	{
		key: "channel.farewell",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon au revoir",
	},
	{
		key: "channel.giveaway",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon tirages au sort",
	},
	{
		key: "channel.zeni",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon des récompenses zeni (drops, daily quest, gains de jeux)",
	},
	{
		key: "channel.mod_notify",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon notifications modération",
	},
	{
		key: "channel.log_sanction",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs sanctions (warn/mute/ban)",
	},
	{
		key: "channel.log_message",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs messages (edit/delete)",
	},
	{
		key: "channel.log_economy",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs économie (zeni transactions)",
	},
	{
		key: "channel.log_join_leave",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs entrées/sorties",
	},
	{
		key: "channel.log_level_role",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs attributions rôles level-up",
	},
	{
		key: "channel.log_ticket",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs ouverture/fermeture tickets",
	},
	{
		key: "channel.log_audit",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Logs audit serveur (bans manuels, rôles, salons, etc.)",
	},
	{
		key: "channel.ticket_category",
		type: "snowflake",
		category: "channels",
		channelType: "category",
		description: "Catégorie où les tickets sont créés",
	},
	{
		key: "channel.log_games",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon casino : journal des gains, mises et plafonds des mini-jeux",
	},
	{
		key: "channel.log_commands",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon bot : journal des commandes et des entrées utilisateur suspectes",
	},
	{
		key: "logs.commands.all",
		type: "bool",
		category: "channels",
		description: "Journaliser TOUTES les commandes dans le salon bot (sinon seulement les entrées suspectes)",
		default: false,
	},
	{
		key: "logs.commands.alert_score",
		type: "int",
		category: "channels",
		description: "Score d'analyse des entrées à partir duquel une commande est signalée",
		default: 4,
		min: 1,
		max: 50,
	},
	{
		key: "economy.inflation.enabled",
		type: "bool",
		category: "economy",
		description: "Indexer les prix de la boutique sur la masse monétaire (inflation)",
		default: false,
	},
	{
		key: "economy.inflation.elasticity",
		type: "float",
		category: "economy",
		description: "Élasticité prix / masse monétaire (0,5 = prix ×1,41 quand la masse double)",
		default: 0.5,
		min: 0,
		max: 1,
	},
	{
		key: "economy.inflation.max_daily_change",
		type: "float",
		category: "economy",
		description: "Variation maximale de l'indice par jour (0,02 = 2 %)",
		default: 0.02,
		min: 0,
		max: 0.2,
	},
	{
		key: "economy.inflation.ceiling",
		type: "float",
		category: "economy",
		description: "Plafond de l'indice. Défaut : inflation canon du Budokai (×2,96)",
		default: 2.96,
		min: 1,
		max: 10,
	},
	{
		key: "economy.inflation.reference_supply",
		type: "int",
		category: "economy",
		description: "Masse monétaire de référence (fixée automatiquement à l'activation)",
		default: 0,
		min: 0,
	},
	{
		key: "economy.ursaf.mode",
		type: "string",
		category: "economy",
		description: "URSAF : off | notice (avis sans prélèvement) | collect (prélèvement)",
		default: "off",
	},
	{
		key: "economy.ursaf.rate_medium",
		type: "float",
		category: "economy",
		description: "URSAF : taux d'imposition des signalements de sévérité moyenne",
		default: 0.25,
		min: 0,
		max: 1,
	},
	{
		key: "economy.ursaf.rate_high",
		type: "float",
		category: "economy",
		description: "URSAF : taux d'imposition des signalements de sévérité haute",
		default: 0.5,
		min: 0,
		max: 1,
	},
	{
		key: "economy.ursaf.rate_critical",
		type: "float",
		category: "economy",
		description: "URSAF : taux d'imposition des signalements critiques",
		default: 0.9,
		min: 0,
		max: 1,
	},
	{
		key: "channel.vocal_tempo_hub",
		type: "snowflake",
		category: "channels",
		channelType: "voice",
		description: "Salon vocal hub (auto-create vocaux temporaires)",
	},

	// ── Rôles ──────────────────────────────────────────────────────
	{
		key: "role.fusion",
		type: "snowflake",
		category: "roles",
		description: "Rôle attribué aux membres fusionnés",
	},
	{
		key: "role.jail",
		type: "snowflake",
		category: "roles",
		description: "Rôle prison (mute total)",
	},
	{
		key: "role.url_in_bio",
		type: "snowflake",
		category: "roles",
		description: "Rôle bio + URL (auto-attribué si /bio contient URL)",
	},
	{
		key: "role.muted",
		type: "snowflake",
		category: "roles",
		description: "Rôle mute (silenced channel access)",
	},
	{
		key: "role.auto_join",
		type: "snowflake",
		category: "roles",
		description: "Rôle auto-attribué à l'arrivée d'un nouveau membre (override AUTO_ROLE_ID)",
	},
	{
		key: "role.booster",
		type: "snowflake",
		category: "roles",
		description: "Rôle 'Héros du peuple' (booster serveur — boost XP auto via xp.boost.boosters)",
	},

	// ── Vocal éphémère ─────────────────────────────────────────────
	{
		key: "vocal.tempo_empty_delay_ms",
		type: "int",
		category: "advanced",
		description: "Délai (ms) avant suppression d'un vocal éphémère vide",
		default: 60_000,
		min: 5_000,
	},

	// ── Tuning jeux ────────────────────────────────────────────────
	{
		key: "game.bingo.limit_ms",
		type: "int",
		category: "advanced",
		description: "Durée max d'un bingo (ms)",
		default: 60_000,
		min: 10_000,
	},
	{
		key: "game.bingo.min",
		type: "int",
		category: "advanced",
		description: "Valeur min du bingo",
		default: 1,
		min: 1,
		max: 1000,
	},
	{
		key: "game.bingo.max",
		type: "int",
		category: "advanced",
		description: "Valeur max du bingo",
		default: 100,
		min: 10,
		max: 10000,
	},
	{
		key: "game.morpion.ttl_ms",
		type: "int",
		category: "advanced",
		description: "TTL d'une partie de morpion inactive (ms)",
		default: 300_000,
		min: 30_000,
	},
	{
		key: "game.pendu.max_errors",
		type: "int",
		category: "advanced",
		description: "Nb d'erreurs max avant défaite au pendu",
		default: 6,
		min: 3,
		max: 12,
	},
	{
		key: "game.max_stake",
		type: "int",
		category: "advanced",
		description: "Mise max autorisée tous jeux confondus",
		default: 1_000_000,
		min: 1,
		max: 100_000_000,
	},
	{
		key: "game.challenge_timeout_ms",
		type: "int",
		category: "advanced",
		description: "Timeout challenge multijoueur (Pendu/Bingo/PFC duel)",
		default: 300_000,
		min: 60_000,
		max: 1_800_000,
	},
	{
		key: "game.pfc.stake_cleanup_ms",
		type: "int",
		category: "advanced",
		description: "Cleanup auto stake PFC vs-bot inutilisé (ms)",
		default: 300_000,
		min: 60_000,
		max: 600_000,
	},
	{
		key: "game.ticket.close_delay_ms",
		type: "int",
		category: "advanced",
		description: "Délai avant fermeture effective d'un ticket (ms)",
		default: 10_000,
		min: 1_000,
		max: 60_000,
	},
	{
		key: "games.daily_reward_cap",
		type: "int",
		category: "economy",
		description:
			"Victoires récompensées par joueur sur 24 h glissantes (Bingo/Morpion/Pendu). Au-delà, la partie reste jouable sans gain",
		default: 20,
		min: 0,
		max: 1000,
	},
	{
		key: "games.pair_reward_cap",
		type: "int",
		category: "economy",
		description:
			"Victoires récompensées sur 24 h pour une même paire de joueurs en duel (anti-collusion)",
		default: 3,
		min: 0,
		max: 100,
	},

	// ── Translate / OCR ──────────────────────────────────────────
	{
		key: "translate.tesseract_timeout_ms",
		type: "int",
		category: "advanced",
		description: "Ancien délai Tesseract (conservé pour compatibilité, OCR délégué à Aphrody)",
		default: 30_000,
		min: 5_000,
		max: 120_000,
	},
	{
		key: "translate.libretranslate_timeout_ms",
		type: "int",
		category: "advanced",
		description: "Timeout LibreTranslate (ms)",
		default: 8_000,
		min: 1_000,
		max: 60_000,
	},
	{
		key: "translate.google_timeout_ms",
		type: "int",
		category: "advanced",
		description: "Timeout Google Translate (ms)",
		default: 8_000,
		min: 1_000,
		max: 60_000,
	},
	{
		key: "translate.fetch_image_timeout_ms",
		type: "int",
		category: "advanced",
		description: "Timeout fetch image (ms)",
		default: 10_000,
		min: 1_000,
		max: 60_000,
	},
	{
		key: "translate.max_image_bytes",
		type: "int",
		category: "advanced",
		description: "Taille max image OCR (octets)",
		default: 10_485_760,
		min: 100_000,
		max: 104_857_600,
	},
	{
		key: "translate.max_chars",
		type: "int",
		category: "advanced",
		description: "Caractères max texte traduit",
		default: 5_000,
		min: 100,
		max: 50_000,
	},
	{
		key: "translate.lingva_instances",
		type: "string",
		category: "advanced",
		description: "Instances Lingva (CSV ou JSON array)",
		default:
			"https://lingva.ml,https://lingva.lunar.icu,https://translate.plausibility.cloud,https://lingva.thedaviddelta.com",
	},

	// ── API session ────────────────────────────────────────────────
	{
		key: "api.session_ttl_days",
		type: "int",
		category: "advanced",
		description: "TTL session API admin (jours)",
		default: 7,
		min: 1,
		max: 90,
	},

	// ── Anti-invite / liens ────────────────────────────────────────
	{
		key: "anti_invite.enabled",
		type: "bool",
		category: "anti_invite",
		description: "Activer la détection d'invitations Discord",
		default: true,
	},
	{
		key: "anti_invite.whitelist_url",
		type: "string",
		category: "anti_invite",
		description:
			"Invitation supplémentaire autorisée — doit porter un chemin spécifique (ex: discord.gg/dragonball). L'invite du serveur (SERVER_INVITE_URL) reste toujours autorisée. Vide = pas de whitelist additionnelle.",
		default: "",
	},
	{
		key: "anti_invite.action",
		type: "string",
		category: "anti_invite",
		description: "Action sur invitation détectée (delete | warn | jail)",
		default: "jail",
	},

	// ── Modération ─────────────────────────────────────────────────
	{
		key: "moderation.warn_threshold_mute",
		type: "int",
		category: "moderation",
		description: "Nb warns avant mute auto",
		default: 3,
		min: 1,
		max: 20,
	},
	{
		key: "moderation.warn_threshold_kick",
		type: "int",
		category: "moderation",
		description: "Nb warns avant kick auto",
		default: 5,
		min: 1,
		max: 20,
	},
	{
		key: "moderation.warn_threshold_ban",
		type: "int",
		category: "moderation",
		description: "Nb warns avant ban auto",
		default: 7,
		min: 1,
		max: 50,
	},
	{
		key: "moderation.jail_default_duration_min",
		type: "int",
		category: "moderation",
		description: "Durée jail par défaut (minutes)",
		default: 60,
		min: 1,
	},
	{
		key: "moderation.hierarchy",
		type: "string",
		category: "moderation",
		description:
			'Hiérarchie staff (JSON, niveaux décroissants). Ex: [["adminId"],["modId1","modId2"]]. Un staff ne peut sanctionner qu\'un membre dont les rôles sont **strictement plus bas** dans la hiérarchie. Membres sans rôle staff = niveau 0 (sanctionnables par tous).',
		default: "[]",
	},

	// ── Tickets / Webhook ──────────────────────────────────────────
	{
		key: "webhook.tickets",
		type: "string",
		category: "tickets",
		description: "URL Webhook Discord pour notifier ouverture/fermeture des tickets (transcript)",
	},
	{
		key: "webhook.tickets_username",
		type: "string",
		category: "tickets",
		description: "Nom affiché pour le webhook tickets",
		default: "Shenron · Tickets",
	},
	{
		key: TICKET_ACCESS_PREFIX,
		type: "bool",
		category: "tickets",
		description:
			"Préfixe — accès rôle par type de ticket (ex: tickets.access.report.<roleId> = 1). Donne à ce rôle la visibilité + écriture sur les nouveaux tickets de ce type dès leur création. N'affecte pas les tickets déjà ouverts (bouton dédié dans /tickets).",
		prefix: true,
	},

	// ── GIFs sanctions (URL .gif/.mp4 — embed.image) ───────────────
	{ key: "gif.warn", type: "string", category: "gifs", description: "GIF avertissement (warn)" },
	{ key: "gif.mute", type: "string", category: "gifs", description: "GIF mute" },
	{ key: "gif.unmute", type: "string", category: "gifs", description: "GIF unmute" },
	{ key: "gif.kick", type: "string", category: "gifs", description: "GIF kick (ki blast)" },
	{ key: "gif.ban", type: "string", category: "gifs", description: "GIF ban (épique)" },
	{ key: "gif.unban", type: "string", category: "gifs", description: "GIF unban" },
	{ key: "gif.jail", type: "string", category: "gifs", description: "GIF jail (Mafuba)" },
	{ key: "gif.unjail", type: "string", category: "gifs", description: "GIF unjail (libération)" },
	{
		key: "gif.purge",
		type: "string",
		category: "gifs",
		description: "GIF purge (Vegeta sacrifice / Final Explosion)",
	},
	{ key: "gif.unwarn", type: "string", category: "gifs", description: "GIF unwarn (pardon)" },

	// ── Toggles features ───────────────────────────────────────────
	{
		key: "features.message_xp",
		type: "bool",
		category: "features",
		description: "Gagner XP en envoyant des messages",
		default: true,
	},
	{
		key: "features.voice_xp",
		type: "bool",
		category: "features",
		description: "Gagner XP en vocal",
		default: true,
	},
	{
		key: "features.giveaway",
		type: "bool",
		category: "features",
		description: "Système de tirages au sort",
		default: true,
	},
	{
		key: "features.tickets",
		type: "bool",
		category: "features",
		description: "Système de tickets",
		default: true,
	},
	{
		key: "features.bio_role",
		type: "bool",
		category: "features",
		description: "Auto-rôle sur bio contenant un lien",
		default: true,
	},
	{
		key: "features.translate",
		type: "bool",
		category: "features",
		description: "Commande /translate (OCR + cascade providers)",
		default: true,
	},
	{
		key: "features.fusion",
		type: "bool",
		category: "features",
		description: "Système de fusion DBZ",
		default: true,
	},
	{
		key: "features.wiki",
		type: "bool",
		category: "features",
		description: "Commande /wiki",
		default: true,
	},

	// ── Translate ──────────────────────────────────────────────────
	{
		key: "translate.libretranslate_url",
		type: "string",
		category: "translate",
		description: "URL LibreTranslate (fallback)",
		default: DEFAULT_INTERNAL_SERVICES.libreTranslate,
	},
	{
		key: "translate.libretranslate_key",
		type: "string",
		category: "translate",
		description: "Clé API LibreTranslate (optionnel)",
	},
	{
		key: "translate.lingva_instance",
		type: "string",
		category: "translate",
		description: "Instance Lingva (override la rotation)",
	},

	// ── Préfixe : multiplier XP par rôle ────────────────────────────
	{
		key: XP_BOOST_ROLE_PREFIX,
		type: "float",
		category: "xp",
		description:
			"Préfixe — multiplier XP par rôle (ex: xp.boost.role.<roleId> = 1.5). On prend le max parmi les rôles du membre.",
		prefix: true,
	},

	// ── Boost XP boosters serveur (Héros du peuple) ─────────────────
	{
		key: "xp.boost.boosters",
		type: "float",
		category: "xp",
		description:
			"Multiplier XP appliqué automatiquement aux boosters Discord (premiumSince) ou aux porteurs du rôle role.booster. 1 = désactivé.",
		default: 2.0,
		min: 1,
		max: 5,
	},

	// ── Présence publique (widget "connectés" de la home du site) ──
	{
		key: "presence.public",
		type: "bool",
		category: "features",
		description:
			"Exposer publiquement l'échantillon nominatif des membres en ligne (avatars + pseudos) via /api/public/presence. Le compteur reste public même si off.",
		default: true,
	},

	// ── Notifications TikTok (live + nouvelles vidéos) ──────────────
	{
		key: "tiktok.enabled",
		type: "bool",
		category: "features",
		description: "Active la surveillance TikTok (notif live + vidéos). Off par défaut.",
		default: false,
	},
	{
		key: "tiktok.username",
		type: "string",
		category: "features",
		description: "Pseudo TikTok à surveiller (sans @). Ex: goku_dbfr.",
		default: "goku_dbfr",
	},
	{
		key: "tiktok.channel",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon où poster les notifications TikTok (live + vidéos).",
	},
	{
		key: "tiktok.role",
		type: "snowflake",
		category: "roles",
		description: "Rôle opt-in mentionné lors d'une notif TikTok (ex: 'notif tiktok').",
	},
	{
		key: "tiktok.videos",
		type: "bool",
		category: "features",
		description:
			"Notifier aussi les nouvelles vidéos (best-effort : dépend du SSR TikTok, sinon proxy requis). Le live reste toujours détecté.",
		default: true,
	},
	{
		key: "tiktok.proxy",
		type: "string",
		category: "advanced",
		description:
			"Proxy HTTP(S) optionnel pour les requêtes TikTok (utile si l'IP du VPS est filtrée). Vide = direct.",
		default: "",
	},
	// État interne de dédup (écrit par TikTokService, pas un réglage à éditer).
	{
		key: "tiktok.live_active",
		type: "bool",
		category: "advanced",
		description: "État interne : le créateur était-il en live au dernier tick.",
		default: false,
	},
	{
		key: "tiktok.last_video_id",
		type: "string",
		category: "advanced",
		description: "État interne : id de la dernière vidéo TikTok annoncée.",
		default: "",
	},
	{
		key: "tiktok.last_video_time",
		type: "int",
		category: "advanced",
		description: "État interne : createTime (epoch s) de la dernière vidéo TikTok annoncée.",
		default: 0,
	},

	// ── Canon du jour (doctrine de canonicité du site) ─────────────
	{
		key: "canon.daily_enabled",
		type: "bool",
		category: "features",
		description: "Publie chaque jour un sujet tranché de la doctrine de canonicité (/wiki/canon). Off par défaut.",
		default: false,
	},
	{
		key: "canon.channel",
		type: "snowflake",
		category: "channels",
		channelType: "text",
		description: "Salon du « canon du jour » (sinon rien n'est publié).",
	},
	{
		key: "canon.daily_hour",
		type: "int",
		category: "features",
		description: "Heure UTC (0-23) à partir de laquelle le canon du jour est publié.",
		default: 18,
		min: 0,
		max: 23,
	},
	{
		key: "canon.rotation_index",
		type: "int",
		category: "advanced",
		description: "État interne : index du prochain sujet tranché à publier.",
		default: 0,
	},
	{
		key: "canon.last_posted_day",
		type: "string",
		category: "advanced",
		default: "",
		description: "État interne : jour UTC (AAAA-MM-JJ) de la dernière publication du canon du jour.",
	},
];

@singleton()
export class SettingsService {
	private cache = new Map<string, string>();
	private cacheTs = 0;
	private TTL = 30_000;

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(EventBusService) private bus: EventBusService
	) {}

	private async refresh() {
		const rows = await this.dbs.db.select().from(guildSettings);
		this.cache.clear();
		for (const r of rows) this.cache.set(r.key, r.value);
		this.cacheTs = Date.now();
		setRaceTuning(this.cache);
	}

	/** Force le rechargement du cache au prochain accès (appelé par /admin reload). */
	invalidate(): void {
		this.cacheTs = 0;
	}

	private async ensureFresh() {
		if (Date.now() - this.cacheTs > this.TTL) await this.refresh();
	}

	async getRaw(key: string): Promise<string | undefined> {
		await this.ensureFresh();
		return this.cache.get(key);
	}

	async getInt(key: string, fallback: number): Promise<number> {
		const v = await this.getRaw(key);
		if (!v) return fallback;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n : fallback;
	}

	async getFloat(key: string, fallback: number): Promise<number> {
		const v = await this.getRaw(key);
		if (!v) return fallback;
		const n = Number.parseFloat(v);
		return Number.isFinite(n) ? n : fallback;
	}

	async getBool(key: string, fallback: boolean): Promise<boolean> {
		const v = await this.getRaw(key);
		if (v === undefined) return fallback;
		return /^(true|1)$/i.test(v);
	}

	async getString(key: string, fallback: string): Promise<string> {
		return (await this.getRaw(key)) ?? fallback;
	}

	async getSnowflake(key: string): Promise<string | undefined> {
		const v = await this.getRaw(key);
		return v && /^\d{17,20}$/.test(v) ? v : undefined;
	}

	async set(key: string, value: string): Promise<void> {
		// Match exact d'abord, sinon match par préfixe (ex: xp.boost.role.<id>)
		let def = SETTINGS_KEYS.find((s) => s.key === key && !s.prefix);
		if (!def) {
			const prefixDef = SETTINGS_KEYS.find(
				(s) => s.prefix && key.startsWith(s.key) && key.length > s.key.length
			);
			if (prefixDef) {
				// Validation contextuelle pour les préfixes connus
				if (prefixDef.key === XP_BOOST_ROLE_PREFIX) {
					const roleId = key.slice(prefixDef.key.length);
					if (!/^\d{17,20}$/.test(roleId))
						throw new Error(`${key} : suffixe doit être un snowflake.`);
					const n = Number.parseFloat(value);
					if (!Number.isFinite(n) || n <= 0)
						throw new Error(`${key} attend un multiplier décimal > 0.`);
				}
				if (prefixDef.key === TICKET_ACCESS_PREFIX) {
					const suffix = key.slice(prefixDef.key.length);
					const dot = suffix.indexOf(".");
					const kind = dot === -1 ? suffix : suffix.slice(0, dot);
					const roleId = dot === -1 ? "" : suffix.slice(dot + 1);
					if (!(TICKET_KINDS as readonly string[]).includes(kind))
						throw new Error(`${key} : type de ticket inconnu (${TICKET_KINDS.join("/")}).`);
					if (!/^\d{17,20}$/.test(roleId))
						throw new Error(`${key} : suffixe doit être <kind>.<roleId> (snowflake).`);
					if (!/^(true|1)$/i.test(value))
						throw new Error(`${key} attend 1/true (présence = accès accordé).`);
				}
				def = prefixDef;
			}
		}
		if (!def) throw new Error(`Setting inconnue : ${key}`);
		if (key === "economy.ursaf.mode" && !/^(off|notice|collect)$/.test(value)) {
			throw new Error(`${key} attend off, notice ou collect.`);
		}
		if (key === "xp.night.timezone") {
			try {
				new Intl.DateTimeFormat("fr-FR", { timeZone: value });
			} catch {
				throw new Error(`${key} attend un fuseau horaire IANA (ex: Europe/Paris).`);
			}
		}
		// Validation des types non-prefix
		if (!def.prefix) {
			if (def.type === "int") {
				const n = Number.parseInt(value, 10);
				if (!Number.isFinite(n)) throw new Error(`${key} attend un entier.`);
				if (def.min !== undefined && n < def.min) throw new Error(`${key} ≥ ${def.min}.`);
				if (def.max !== undefined && n > def.max) throw new Error(`${key} ≤ ${def.max}.`);
			} else if (def.type === "float") {
				const n = Number.parseFloat(value);
				if (!Number.isFinite(n)) throw new Error(`${key} attend un nombre.`);
				if (def.min !== undefined && n < def.min) throw new Error(`${key} ≥ ${def.min}.`);
				if (def.max !== undefined && n > def.max) throw new Error(`${key} ≤ ${def.max}.`);
			} else if (def.type === "snowflake") {
				if (!/^\d{17,20}$/.test(value)) throw new Error(`${key} attend un snowflake Discord.`);
			} else if (def.type === "bool") {
				if (!/^(true|false|0|1)$/i.test(value)) throw new Error(`${key} attend true/false.`);
			}
		}
		await this.dbs.db
			.insert(guildSettings)
			.values({ key, value, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: guildSettings.key,
				set: { value, updatedAt: new Date() },
			});
		this.cache.set(key, value);
		this.cacheTs = Date.now(); // évite un refresh DB inutile juste après set
		setRaceTuning(this.cache);
		this.bus.emit("setting:changed", { key, value });
	}

	async unset(key: string): Promise<void> {
		await this.dbs.db.delete(guildSettings).where(eq(guildSettings.key, key));
		this.cache.delete(key);
		setRaceTuning(this.cache);
		this.bus.emit("setting:reset", { key });
	}

	async list(): Promise<Array<{ key: string; value: string; def?: SettingDef }>> {
		await this.refresh();
		return [...this.cache.entries()].map(([key, value]) => ({
			key,
			value,
			def:
				SETTINGS_KEYS.find((s) => s.key === key && !s.prefix) ??
				SETTINGS_KEYS.find((s) => s.prefix && key.startsWith(s.key) && key.length > s.key.length),
		}));
	}

	/**
	 * Scanne le cache pour toutes les keys préfixées `xp.boost.role.<roleId>`
	 * et retourne les couples `{roleId, multiplier}`. Les valeurs invalides
	 * (multiplier ≤ 0, NaN) sont silencieusement filtrées.
	 *
	 * Utilisé par `MessageXP` et `VoiceXP` pour appliquer le **plus grand**
	 * multiplier parmi les rôles du membre (ne stack pas — comportement
	 * standard sur les serveurs Discord).
	 */
	async getXpBoostRoles(): Promise<Array<{ roleId: string; multiplier: number }>> {
		await this.ensureFresh();
		const out: Array<{ roleId: string; multiplier: number }> = [];
		for (const [key, value] of this.cache) {
			if (!key.startsWith(XP_BOOST_ROLE_PREFIX)) continue;
			const roleId = key.slice(XP_BOOST_ROLE_PREFIX.length);
			if (!/^\d{17,20}$/.test(roleId)) continue;
			const m = Number.parseFloat(value);
			if (!Number.isFinite(m) || m <= 0) continue;
			out.push({ roleId, multiplier: m });
		}
		return out;
	}

	/**
	 * Rôles ayant accès à un type de ticket donné (`tickets.access.<kind>.<roleId>` = 1).
	 * Utilisé par `TicketService` pour poser les permission overwrites à la création
	 * du salon (et lors d'un resync manuel des tickets déjà ouverts).
	 */
	async getTicketAccessRoles(kind: TicketKind): Promise<string[]> {
		await this.ensureFresh();
		const prefix = `${TICKET_ACCESS_PREFIX}${kind}.`;
		const out: string[] = [];
		for (const [key, value] of this.cache) {
			if (!key.startsWith(prefix)) continue;
			if (!/^(true|1)$/i.test(value)) continue;
			const roleId = key.slice(prefix.length);
			if (!/^\d{17,20}$/.test(roleId)) continue;
			out.push(roleId);
		}
		return out;
	}
}
