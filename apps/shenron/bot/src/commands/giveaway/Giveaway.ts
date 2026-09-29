import { injectable, inject } from "tsyringe";
import { Bot, ButtonComponent, Discord, Guard, Slash, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	type ButtonInteraction,
	type CommandInteraction,
	type TextChannel,
} from "discord.js";
import { and, eq, lte } from "drizzle-orm";
import { GuildOnly } from "~/guards/GuildOnly";
import { ModOnly } from "~/guards/ModOnly";
import { FeatureEnabled } from "~/guards/FeatureEnabled";
import { DatabaseService } from "~/db/index";
import { giveaways, giveawayEntries } from "~/db/schema";
import { MessageTemplateService } from "~/services/MessageTemplateService";

function parseDuration(input: string): number | undefined {
	const m = input.match(/^(\d+)\s*([smhdw])$/i);
	if (!m) return undefined;
	const n = parseInt(m[1]!, 10);
	const mult =
		{ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]!.toLowerCase()] ?? 0;
	return n * mult;
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly, FeatureEnabled("features.giveaway", "Le système de giveaway"))
@injectable()
export class GiveawayCommands {
	constructor(@inject(DatabaseService) private dbs: DatabaseService) {}

	@Slash({
		name: "giveaway",
		description: "Créer un giveaway",
		defaultMemberPermissions: PermissionFlagsBits.ManageEvents,
	})
	@Guard(ModOnly)
	async create(
		@SlashOption({
			name: "titre",
			description: "Titre",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		title: string,
		@SlashOption({
			name: "recompense",
			description: "Récompense",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reward: string,
		@SlashOption({
			name: "gagnants",
			description: "Nombre de gagnants",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 1,
			maxValue: 20,
		})
		winners: number,
		@SlashOption({
			name: "duree",
			description: "Durée (ex: 1h, 1d)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		duration: string,
		@SlashOption({
			name: "salon",
			description: "Salon de publication",
			type: ApplicationCommandOptionType.Channel,
			required: false,
		})
		channel: TextChannel | undefined,
		@SlashOption({
			name: "description",
			description: "Description",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		description: string | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const ms = parseDuration(duration);
		if (!ms) {
			await interaction.reply({
				content: "Durée invalide (ex: 1h, 1d).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const ch = channel ?? (interaction.channel as TextChannel);
		const endsAt = new Date(Date.now() + ms);

		const embed = new EmbedBuilder()
			.setTitle(`🎁 ${title}`)
			.setDescription(
				`${description ?? ""}\n\n**Récompense** : ${reward}\n**Gagnants** : ${winners}\n**Fin** : <t:${Math.floor(endsAt.getTime() / 1000)}:R>\n\nCliquez sur le bouton pour participer.`
			)
			.setColor(0xfbbf24)
			.setTimestamp();
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("giveaway:enter")
				.setLabel("Participer")
				.setEmoji("🎉")
				.setStyle(ButtonStyle.Success)
		);
		const msg = await ch.send({ embeds: [embed], components: [row] });
		await this.dbs.db.insert(giveaways).values({
			messageId: msg.id,
			channelId: ch.id,
			hostId: interaction.user.id,
			title,
			reward,
			description: description ?? null,
			winners,
			endsAt,
		});
		await interaction.reply({
			content: `✅ Giveaway publié dans ${ch}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	@ButtonComponent({ id: "giveaway:enter" })
	async enter(interaction: ButtonInteraction) {
		if (!interaction.message) return;
		const gw = await this.dbs.db.query.giveaways.findFirst({
			where: eq(giveaways.messageId, interaction.message.id),
		});
		if (!gw || gw.ended) {
			await interaction.reply({ content: "Giveaway terminé.", flags: MessageFlags.Ephemeral });
			return;
		}
		try {
			await this.dbs.db
				.insert(giveawayEntries)
				.values({ giveawayId: gw.id, userId: interaction.user.id });
			await interaction.reply({
				content: "🎉 Participation enregistrée !",
				flags: MessageFlags.Ephemeral,
			});
		} catch {
			await interaction.reply({ content: "Tu participes déjà.", flags: MessageFlags.Ephemeral });
		}
	}
}

import { Once } from "discordx";
import type { Client } from "discord.js";

@Discord()
@Bot("shenron")
@injectable()
export class GiveawayTicker {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(MessageTemplateService) private msg: MessageTemplateService
	) {}

	@Once({ event: "clientReady" })
	async start([client]: [Client]) {
		setInterval(() => this.tick(client).catch(() => {}), 60_000).unref();
	}

	async tick(client: Client) {
		const now = new Date();
		const ready = await this.dbs.db
			.select()
			.from(giveaways)
			.where(and(eq(giveaways.ended, false), lte(giveaways.endsAt, now)));
		for (const gw of ready) {
			const entries = await this.dbs.db
				.select()
				.from(giveawayEntries)
				.where(eq(giveawayEntries.giveawayId, gw.id));
			const picked: string[] = [];
			const pool = entries.map((e) => e.userId);
			const n = Math.min(gw.winners, pool.length);
			for (let i = 0; i < n; i++) {
				const idx = Math.floor(Math.random() * pool.length);
				picked.push(pool.splice(idx, 1)[0]!);
			}
			await this.dbs.db
				.update(giveaways)
				.set({ ended: true, winnerIds: JSON.stringify(picked) })
				.where(eq(giveaways.id, gw.id));

			// Annonce templatable (channel.giveaway) si gagnants — sinon fallback dans
			// le salon d'origine du giveaway pour signaler l'absence de participants.
			if (picked.length) {
				const target = await this.msg.resolveTarget("giveaway_winner", client);
				if (target?.enabled !== false) {
					const published = await this.msg.publish(
						"giveaway_winner",
						{
							winners: picked.map((id) => `<@${id}>`).join(" "),
							prize: gw.reward,
							title: gw.title,
						},
						client
					);
					if (!published) {
						const channel = (await client.channels
							.fetch(gw.channelId)
							.catch(() => null)) as TextChannel | null;
						await channel
							?.send({
								content: `🎉 Résultat du giveaway **${gw.title}**\nGagnant${picked.length > 1 ? "s" : ""} : ${picked.map((id) => `<@${id}>`).join(", ")}\nRécompense : ${gw.reward}`,
							})
							.catch(() => {});
					}
				}
			} else {
				const channel = (await client.channels
					.fetch(gw.channelId)
					.catch(() => null)) as TextChannel | null;
				await channel
					?.send({ content: `😔 Giveaway **${gw.title}** terminé sans participants.` })
					.catch(() => {});
			}
		}
	}
}
