import { singleton, inject, container } from "tsyringe";
import { and, eq } from "drizzle-orm";
import {
	ChannelType,
	PermissionFlagsBits,
	type CategoryChannel,
	type Guild,
	type TextChannel,
	EmbedBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
} from "discord.js";
import { DatabaseService } from "~/db/index";
import { tickets } from "~/db/schema";
import { env } from "~/lib/env";
import { SettingsService, type TicketKind } from "./SettingsService";
import { MessageTemplateService } from "./MessageTemplateService";
import { executeWebhook, parseWebhookUrl, type Embed as WebhookEmbed } from "~/lib/discord-webhook";
import { logger } from "~/lib/logger";

export type { TicketKind };

@singleton()
export class TicketService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	private get db() {
		return this.dbs.db;
	}

	async create(
		guild: Guild,
		ownerId: string,
		kind: TicketKind,
		context: string
	): Promise<TextChannel> {
		const categoryId = env.TICKET_CATEGORY_ID;
		const category = categoryId
			? ((await guild.channels.fetch(categoryId).catch(() => null)) as CategoryChannel | null)
			: null;

		const owner = await guild.members.fetch(ownerId).catch(() => null);
		const username = owner?.user.username ?? "user";
		const name = `ticket-${kind}-${username}`
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "")
			.slice(0, 90);

		const channel = (await guild.channels.create({
			name,
			type: ChannelType.GuildText,
			parent: category?.id,
			topic: `Ticket ${kind} · <@${ownerId}>`,
			permissionOverwrites: [
				{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
				{
					id: ownerId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.ReadMessageHistory,
						PermissionFlagsBits.AttachFiles,
					],
				},
			],
		})) as TextChannel;

		await this.db.insert(tickets).values({ channelId: channel.id, ownerId, kind, context });
		await this.applyAccessRoles(guild, channel.id, kind);

		// Header templatable depuis /messages (toggle enabled + texte custom).
		// Si l'admin a désactivé l'événement, le canal du ticket reste créé mais
		// sans message d'accueil — on garde quand même le bouton de fermeture.
		const templates = container.resolve(MessageTemplateService);
		const ticketRender = await templates.render("ticket_opened", {
			ownerId,
			kind,
			context: context || "Aucun contexte fourni.",
		});

		const embed = new EmbedBuilder()
			.setTitle(`Ticket — ${kind}`)
			.setDescription(ticketRender?.rendered ?? (context || "Aucun contexte fourni."))
			.addFields({ name: "Ouvert par", value: `<@${ownerId}>` })
			.setColor(0xff9800)
			.setTimestamp();

		const closeBtn = new ButtonBuilder()
			.setCustomId("ticket:close")
			.setLabel("Fermer")
			.setStyle(ButtonStyle.Danger)
			.setEmoji("🔒");
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeBtn);

		if (ticketRender?.enabled !== false) {
			await channel.send({
				content: `<@${ownerId}>`,
				embeds: [embed],
				components: [row],
			});
		} else {
			// Bouton seul (admin a désactivé le message d'accueil)
			await channel.send({ content: `<@${ownerId}>`, components: [row] });
		}

		// Notification webhook (best-effort, n'échoue jamais le flow ticket)
		void this.notifyWebhook({
			title: `🎫 Ticket ouvert — ${kind}`,
			description: context || "Aucun contexte fourni.",
			color: 0xff9800,
			fields: [
				{ name: "Ouvert par", value: `<@${ownerId}>`, inline: true },
				{ name: "Salon", value: `<#${channel.id}>`, inline: true },
				{ name: "Type", value: kind, inline: true },
			],
		});

		return channel;
	}

	/**
	 * Pousse un embed sur le webhook configuré dans `webhook.tickets`.
	 * Best-effort silencieux : URL invalide / Discord 404 → log warn et drop.
	 */
	private async notifyWebhook(embed: WebhookEmbed): Promise<void> {
		try {
			const settings = container.resolve(SettingsService);
			const url = await settings.getRaw("webhook.tickets");
			if (!url) return;
			const parsed = parseWebhookUrl(url);
			if (!parsed) {
				logger.warn({ url }, "webhook.tickets: URL invalide");
				return;
			}
			const username = (await settings.getRaw("webhook.tickets_username")) || "Shenron · Tickets";
			await executeWebhook(url, {
				username,
				embeds: [{ ...embed, timestamp: new Date().toISOString() }],
				allowed_mentions: { parse: [] },
			});
		} catch (err) {
			logger.warn({ err }, "webhook.tickets: send failed");
		}
	}

	async findByChannel(channelId: string) {
		return this.db.query.tickets.findFirst({ where: eq(tickets.channelId, channelId) });
	}

	/**
	 * Pose les permission overwrites des rôles staff configurés (dashboard →
	 * Réglages → Tickets → `tickets.access.<kind>.<roleId>`) sur un salon de
	 * ticket. Rôles supprimés du serveur depuis leur config = ignorés
	 * silencieusement (jamais d'échec de création de ticket pour ça).
	 */
	async applyAccessRoles(guild: Guild, channelId: string, kind: TicketKind): Promise<void> {
		const roleIds = await this.settings.getTicketAccessRoles(kind);
		if (roleIds.length === 0) return;
		const ch = (await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
		if (!ch) return;
		for (const roleId of roleIds) {
			if (!guild.roles.cache.has(roleId)) continue;
			await ch.permissionOverwrites
				.edit(roleId, {
					ViewChannel: true,
					SendMessages: true,
					ReadMessageHistory: true,
					AttachFiles: true,
					ManageMessages: true,
				})
				.catch((err) => logger.warn({ err, roleId, channelId }, "ticket access role: edit failed"));
		}
	}

	/**
	 * Rejoue `applyAccessRoles` sur tous les tickets encore ouverts en DB —
	 * pour que changer la config de rôles côté dashboard s'applique aussi aux
	 * tickets déjà en cours (pas seulement aux futurs). Appelé à la demande
	 * (bouton dashboard), pas automatiquement à chaque `set()`.
	 */
	async syncOpenTicketsAccess(guild: Guild): Promise<{ updated: number; skipped: number }> {
		const open = await this.db.query.tickets.findMany({ where: eq(tickets.closed, false) });
		let updated = 0;
		let skipped = 0;
		for (const t of open) {
			const ch = await guild.channels.fetch(t.channelId).catch(() => null);
			if (!ch) {
				skipped++;
				continue;
			}
			await this.applyAccessRoles(guild, t.channelId, t.kind as TicketKind);
			updated++;
		}
		return { updated, skipped };
	}

	async close(channelId: string, closerId: string): Promise<boolean> {
		const t = await this.findByChannel(channelId);
		if (!t || t.closed) return false;
		await this.db
			.update(tickets)
			.set({ closed: true, closedAt: new Date(), closedBy: closerId })
			.where(eq(tickets.channelId, channelId));
		void this.notifyWebhook({
			title: `🔒 Ticket fermé — ${t.kind}`,
			description: t.context ?? "Aucun contexte.",
			color: 0x6b7280,
			fields: [
				{ name: "Ouvert par", value: `<@${t.ownerId}>`, inline: true },
				{ name: "Fermé par", value: `<@${closerId}>`, inline: true },
				{ name: "Durée", value: `<t:${Math.floor(t.createdAt.getTime() / 1000)}:R>`, inline: true },
			],
		});
		return true;
	}

	async addUser(guild: Guild, channelId: string, userId: string): Promise<boolean> {
		const ch = (await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
		if (!ch) return false;
		await ch.permissionOverwrites.edit(userId, {
			ViewChannel: true,
			SendMessages: true,
			ReadMessageHistory: true,
		});
		return true;
	}

	async removeUser(guild: Guild, channelId: string, userId: string): Promise<boolean> {
		const ch = (await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
		if (!ch) return false;
		await ch.permissionOverwrites.delete(userId).catch(() => {});
		return true;
	}
}
