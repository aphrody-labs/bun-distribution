import { singleton, inject, container } from "tsyringe";
import type { Client, SendableChannels } from "discord.js";
import { eq } from "drizzle-orm";
import { Client as DiscordxClient } from "discordx";
import { DatabaseService } from "~/db/index";
import { EventBusService } from "./EventBusService";
import { messageTemplates, guildSettings, type MessageTemplate } from "~/db/schema";
import {
	EVENTS,
	findEvent,
	renderTemplate,
	VIRTUAL_CHANNEL_KEYS,
	type EventDef,
} from "~/lib/message-templates";
import { brandedEmbed } from "~/lib/embeds";
import { logger } from "~/lib/logger";
import { env } from "~/lib/env";

/**
 * Couche centrale pour publier les messages "événementiels" du bot. Tous les
 * call sites (events `MessageXP`, `JoinLeave`, `LevelService.handleLevelUp`,
 * `JailExpiry`, etc.) doivent passer par `publish(event, vars)` au lieu de
 * formater + envoyer eux-mêmes.
 *
 * Lit `message_templates` (cache 30s) + `guild_settings` pour résoudre :
 *   1. Le canal cible (override DB > clé du catalogue > `ANNOUNCE_CHANNEL_ID` env)
 *   2. Le texte rendu (template DB > défaut catalogue)
 *   3. Le flag `enabled` — false → skip silencieux
 *
 * Renvoie le message Discord envoyé, ou null si désactivé / canal introuvable.
 */
@singleton()
export class MessageTemplateService {
	private templateCache = new Map<string, MessageTemplate | null>();
	private settingsCache = new Map<string, string>();
	private cacheTs = 0;
	private TTL = 30_000;

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(EventBusService) private bus: EventBusService
	) {}

	private async refresh(): Promise<void> {
		const [templates, settings] = await Promise.all([
			this.dbs.db.select().from(messageTemplates),
			this.dbs.db.select().from(guildSettings),
		]);
		this.templateCache.clear();
		for (const t of templates) this.templateCache.set(t.event, t);
		this.settingsCache.clear();
		for (const s of settings) this.settingsCache.set(s.key, s.value);
		this.cacheTs = Date.now();
	}

	private async ensureFresh(): Promise<void> {
		if (Date.now() - this.cacheTs > this.TTL) await this.refresh();
	}

	/** Force le reload du cache (appelé par l'API après un upsert). */
	async invalidate(): Promise<void> {
		this.cacheTs = 0;
	}

	async resolveChannel(channelKey: string, client: Client): Promise<SendableChannels | null> {
		// Clés virtuelles (DM, canal d'invocation, canal du ticket) → le caller
		// fournit son propre canal, on ne tente AUCUNE résolution settings/env.
		if (VIRTUAL_CHANNEL_KEYS.has(channelKey)) return null;
		await this.ensureFresh();
		const id = this.settingsCache.get(channelKey) ?? this.envFallback(channelKey);
		if (!id) return null;
		const guild = client.guilds.cache.get(env.GUILD_ID);
		const cached = guild?.channels.cache.get(id);
		if (cached && "send" in cached) return cached as SendableChannels;
		const fetched = await client.channels.fetch(id).catch(() => null);
		if (fetched && "send" in fetched) return fetched as SendableChannels;
		return null;
	}

	/**
	 * Rend un template sans envoi. Utilisé par les call-sites qui composent leur
	 * propre embed riche / canal contextuel (DM, canal d'invocation, ticket).
	 *
	 * Retourne `enabled=false` → le caller DOIT skip l'envoi.
	 * Retourne null si l'événement n'existe pas.
	 */
	async render(
		event: string,
		vars: Record<string, unknown>
	): Promise<{ enabled: boolean; rendered: string; def: EventDef } | null> {
		const def = findEvent(event);
		if (!def) {
			logger.warn({ event }, "render: événement inconnu");
			return null;
		}
		await this.ensureFresh();
		const tmpl = this.templateCache.get(event);
		const enabled = tmpl?.enabled ?? true;
		const rendered = renderTemplate(tmpl?.template ?? def.defaultTemplate, vars);
		return { enabled, rendered, def };
	}

	/**
	 * Résout l'état d'un événement (canal cible + enabled) pour les callers qui
	 * ont besoin d'envoyer un payload custom (embed riche, components, etc.) tout
	 * en respectant le toggle `enabled` + l'override `channelKey` du dashboard.
	 *
	 * Retourne `enabled=false` → le caller DOIT skip l'envoi (pas de fallback).
	 * Retourne `channel=null` quand le canal configuré est introuvable.
	 */
	async resolveTarget(
		event: string,
		client: Client
	): Promise<{ enabled: boolean; channel: SendableChannels | null; def: EventDef } | null> {
		const def = findEvent(event);
		if (!def) {
			logger.warn({ event }, "resolveTarget: événement inconnu");
			return null;
		}
		await this.ensureFresh();
		const tmpl = this.templateCache.get(event);
		const enabled = tmpl?.enabled ?? true;
		if (!enabled) return { enabled: false, channel: null, def };
		const channelKey = tmpl?.channelKey ?? def.defaultChannelKey;
		const channel = await this.resolveChannel(channelKey, client);
		return { enabled: true, channel, def };
	}

	/**
	 * Publie un message évenementiel. Retourne null si désactivé ou canal absent.
	 *
	 * @param event  clé du catalogue (ex: "level_up")
	 * @param vars   variables à substituer dans le template
	 * @param client client Discord (peut être omis → resolve via DI)
	 */
	async publish(
		event: string,
		vars: Record<string, unknown>,
		client?: Client
	): Promise<unknown | null> {
		const def = findEvent(event);
		if (!def) {
			logger.warn({ event }, "publish: événement inconnu");
			return null;
		}
		await this.ensureFresh();
		const tmpl = this.templateCache.get(event);
		if (tmpl?.enabled === false) return null;
		const cli = client ?? container.resolve(DiscordxClient);
		const channelKey = tmpl?.channelKey ?? def.defaultChannelKey;
		const channel = await this.resolveChannel(channelKey, cli);
		if (!channel) {
			logger.debug({ event, channelKey }, "publish: canal introuvable, skip");
			return null;
		}
		const content = renderTemplate(tmpl?.template ?? def.defaultTemplate, vars);
		try {
			if (def.embed) {
				const userMention = typeof vars.user === "string" ? vars.user : undefined;
				return await channel.send({
					content: userMention,
					embeds: [
						brandedEmbed({
							title: this.guessTitle(def),
							description: content,
							kind: "brand",
						}),
					],
				});
			}
			return await channel.send({ content });
		} catch (err) {
			logger.warn({ err, event }, "publish: send failed");
			return null;
		}
	}

	/** Render preview pour l'API (sans envoi Discord). */
	async preview(
		event: string,
		vars: Record<string, unknown>
	): Promise<{
		event: string;
		template: string;
		rendered: string;
		channelKey: string;
		enabled: boolean;
		isOverridden: { template: boolean; channel: boolean };
	}> {
		const def = findEvent(event);
		if (!def) throw new Error(`Événement inconnu : ${event}`);
		await this.ensureFresh();
		const tmpl = this.templateCache.get(event);
		const template = tmpl?.template ?? def.defaultTemplate;
		const channelKey = tmpl?.channelKey ?? def.defaultChannelKey;
		return {
			event,
			template,
			rendered: renderTemplate(template, vars),
			channelKey,
			enabled: tmpl?.enabled ?? true,
			isOverridden: {
				template: tmpl?.template != null && tmpl.template !== def.defaultTemplate,
				channel: tmpl?.channelKey != null && tmpl.channelKey !== def.defaultChannelKey,
			},
		};
	}

	async list(): Promise<
		Array<
			EventDef & {
				template: string;
				channelKey: string;
				enabled: boolean;
				isCustom: boolean;
			}
		>
	> {
		await this.ensureFresh();
		return EVENTS.map((def) => {
			const tmpl = this.templateCache.get(def.event);
			return Object.assign({}, def, {
				template: tmpl?.template ?? def.defaultTemplate,
				channelKey: tmpl?.channelKey ?? def.defaultChannelKey,
				enabled: tmpl?.enabled ?? true,
				isCustom: !!tmpl,
			});
		});
	}

	async upsert(input: {
		event: string;
		template?: string | null;
		channelKey?: string | null;
		enabled?: boolean;
	}): Promise<void> {
		const def = findEvent(input.event);
		if (!def) throw new Error(`Événement inconnu : ${input.event}`);
		const values = {
			event: input.event,
			template: input.template ?? null,
			channelKey: input.channelKey ?? null,
			enabled: input.enabled ?? true,
			updatedAt: new Date(),
		};
		await this.dbs.db
			.insert(messageTemplates)
			.values(values)
			.onConflictDoUpdate({
				target: messageTemplates.event,
				set: {
					template: values.template,
					channelKey: values.channelKey,
					enabled: values.enabled,
					updatedAt: values.updatedAt,
				},
			});
		await this.invalidate();
		this.bus.emit("messages:template:changed", { event: input.event, action: "set" });
	}

	async reset(event: string): Promise<void> {
		await this.dbs.db.delete(messageTemplates).where(eq(messageTemplates.event, event));
		await this.invalidate();
		this.bus.emit("messages:template:changed", { event, action: "reset" });
	}

	private envFallback(channelKey: string): string | undefined {
		// Mapping des clés `channel.*` vers les env vars existantes pour rétro-compat.
		const map: Record<string, string | undefined> = {
			"channel.announce": env.ANNOUNCE_CHANNEL_ID,
			"channel.achievement": env.ACHIEVEMENT_CHANNEL_ID ?? env.ANNOUNCE_CHANNEL_ID,
			"channel.level": env.LEVEL_CHANNEL_ID ?? env.ANNOUNCE_CHANNEL_ID,
			"channel.welcome": env.LOG_JOIN_LEAVE_CHANNEL_ID,
			"channel.farewell": env.LOG_JOIN_LEAVE_CHANNEL_ID,
			"channel.giveaway": env.ANNOUNCE_CHANNEL_ID,
			"channel.zeni": env.LOG_ECONOMY_CHANNEL_ID ?? env.ANNOUNCE_CHANNEL_ID,
			"channel.mod_notify": env.MOD_NOTIFY_CHANNEL_ID,
			"channel.log_sanction": env.LOG_SANCTION_CHANNEL_ID,
		};
		return map[channelKey];
	}

	private guessTitle(def: EventDef): string {
		switch (def.event) {
			case "welcome":
				return "🌟 Nouveau combattant !";
			case "farewell":
				return "👋 Au revoir guerrier";
			case "level_up":
				return "🚀 Nouveau palier atteint !";
			case "achievement_unlocked":
			case "first_message":
				return "🏆 Accomplissement débloqué";
			case "daily_quest":
				return "🎯 Quête quotidienne";
			case "anti_link_jail":
				return "⛓️ Jail automatique";
			case "jail_expired":
				return "🕊️ Libération";
			case "giveaway_winner":
				return "🎁 Tirage au sort";
			case "vocal_tempo_created":
				return "🔊 Vocal éphémère créé";
			case "vocal_tempo_destroyed":
				return "🔇 Vocal éphémère supprimé";
			default:
				return def.description;
		}
	}
}
