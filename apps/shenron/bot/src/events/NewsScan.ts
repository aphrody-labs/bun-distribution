import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { ChannelType } from "discord.js";
import { NewsService } from "~/services/NewsService";
import { SettingsService } from "~/services/SettingsService";
import { logger } from "~/lib/logger";

/**
 * Scanner des salons d'annonces → alimente `db_news` (page Actualités du site).
 *
 * Sources retenues :
 *   - tout salon Discord de type Annonce (`ChannelType.GuildAnnouncement`),
 *   - le salon configuré `channel.announce` (guild_settings).
 *
 * On capte les posts humains ET les webhooks (annonces officielles relayées),
 * mais on ignore les vrais bots (nos personas) pour ne pas polluer avec des
 * messages de level-up / giveaway. Sync complet : create / update / delete.
 *
 * Hébergé sur grandPretre (seul persona avec MessageContent + GuildMessages).
 */
@Discord()
@Bot("shenron")
@injectable()
export class NewsScanEvent {
	constructor(
		@inject(NewsService) private news: NewsService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	private async isAnnounceSource(channelId: string, channelType: number) {
		if (channelType === ChannelType.GuildAnnouncement) return true;
		const configured = await this.settings.getSnowflake("channel.announce");
		return !!configured && channelId === configured;
	}

	private isHumanOrWebhook(authorBot: boolean, webhookId: string | null) {
		// Webhook = annonce relayée (OK) ; bot pur (nos personas) = ignoré.
		return !authorBot || !!webhookId;
	}

	@On({ event: "messageCreate" })
	async onCreate([message]: ArgsOf<"messageCreate">) {
		if (!message.inGuild()) return;
		if (!this.isHumanOrWebhook(message.author.bot, message.webhookId)) return;
		if (!(await this.isAnnounceSource(message.channelId, message.channel.type))) return;
		const ok = await this.news.saveFromDiscord(message);
		if (ok) logger.info(`[NewsScan] annonce captée → ${message.url}`);
	}

	@On({ event: "messageUpdate" })
	async onUpdate([, newM]: ArgsOf<"messageUpdate">) {
		if (!newM.inGuild()) return;
		if (!this.isHumanOrWebhook(newM.author?.bot ?? true, newM.webhookId)) return;
		if (!(await this.isAnnounceSource(newM.channelId, newM.channel.type))) return;
		await this.news.saveFromDiscord(newM);
	}

	@On({ event: "messageDelete" })
	async onDelete([message]: ArgsOf<"messageDelete">) {
		if (!message.url) return;
		await this.news.deleteBySourceUrl(message.url);
	}
}
