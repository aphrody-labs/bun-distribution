import { injectable, inject } from "tsyringe";
import {
	Bot,
	ButtonComponent,
	Discord,
	Guard,
	ModalComponent,
	Slash,
	SlashChoice,
	SlashOption,
} from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	PermissionFlagsBits,
	type ButtonInteraction,
	type CommandInteraction,
	type ModalSubmitInteraction,
	type Role,
	type TextChannel,
	type User,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { AdminOnly } from "~/guards/AdminOnly";
import { FeatureEnabled } from "~/guards/FeatureEnabled";
import { TicketService } from "~/services/TicketService";
import { LogService } from "~/services/LogService";
import { env } from "~/lib/env";

const KIND_LABELS = {
	report: "Signaler",
	achat: "Achat",
	shop: "Shop",
	abus: "Abus de perm",
} as const;

@Discord()
@Bot("shenron")
@Guard(GuildOnly, FeatureEnabled("features.tickets", "Le système de tickets"))
@injectable()
export class TicketCommands {
	constructor(
		@inject(TicketService) private tickets: TicketService,
		@inject(LogService) private logs: LogService
	) {}

	// Admin : publier le panel
	@Slash({
		name: "ticket-panel",
		description: "Publier le panel de tickets",
		defaultMemberPermissions: PermissionFlagsBits.Administrator,
	})
	@Guard(AdminOnly)
	async publishPanel(interaction: CommandInteraction) {
		const embed = new EmbedBuilder()
			.setTitle("🎫 Ouvrir un ticket")
			.setDescription(
				"Cliquez sur le bouton correspondant à votre besoin. Un salon privé sera créé avec l'équipe."
			)
			.addFields(
				{ name: "🚨 Signaler", value: "Signaler un comportement", inline: true },
				{ name: "🛒 Achat", value: "Question sur un achat", inline: true },
				{ name: "🏪 Shop", value: "Problème shop / custom", inline: true },
				{ name: "⚠️ Abus de perm", value: "Rapport staff", inline: true }
			)
			.setColor(0xff9800);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("ticket:open:report")
				.setLabel("Signaler")
				.setEmoji("🚨")
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId("ticket:open:achat")
				.setLabel("Achat")
				.setEmoji("🛒")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("ticket:open:shop")
				.setLabel("Shop")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("ticket:open:abus")
				.setLabel("Abus de perm")
				.setEmoji("⚠️")
				.setStyle(ButtonStyle.Danger)
		);

		await interaction.reply({ embeds: [embed], components: [row] });
	}

	// Bouton Ouvrir → affiche la modal de contexte
	@ButtonComponent({ id: /^ticket:open:(report|achat|shop|abus)$/ })
	async openModal(interaction: ButtonInteraction) {
		const kind = interaction.customId.split(":")[2] as keyof typeof KIND_LABELS;
		const modal = new ModalBuilder()
			.setCustomId(`ticket:submit:${kind}`)
			.setTitle(`Ticket — ${KIND_LABELS[kind]}`);
		const input = new TextInputBuilder()
			.setCustomId("context")
			.setLabel("Contexte (décrivez votre demande)")
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(1500);
		modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
		await interaction.showModal(modal);
	}

	// Soumission modal → création du ticket
	@ModalComponent({ id: /^ticket:submit:(report|achat|shop|abus)$/ })
	async submitModal(interaction: ModalSubmitInteraction) {
		if (!interaction.guild) return;
		const kind = interaction.customId.split(":")[2] as keyof typeof KIND_LABELS;
		const context = interaction.fields.getTextInputValue("context");
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const channel = await this.tickets.create(
			interaction.guild,
			interaction.user.id,
			kind,
			context
		);
		await interaction.editReply({ content: `✅ Ticket créé : ${channel}` });

		// Notif mod
		const embed = this.logs
			.makeEmbed(`Nouveau ticket — ${KIND_LABELS[kind]}`, 0xff9800)
			.addFields(
				{ name: "Ouvert par", value: `<@${interaction.user.id}>`, inline: true },
				{ name: "Salon", value: `${channel}`, inline: true },
				{ name: "Contexte", value: context.slice(0, 1024) }
			);
		await this.logs.send(interaction.client, "modNotify", embed);
		await this.logs.send(interaction.client, "ticket", embed);
	}

	// Bouton Fermer dans le ticket
	@ButtonComponent({ id: "ticket:close" })
	async closeButton(interaction: ButtonInteraction) {
		await this.closeTicket(interaction);
	}

	private async closeTicket(interaction: ButtonInteraction | CommandInteraction) {
		if (!interaction.channel || !interaction.guild) return;
		const ok = await this.tickets.close(interaction.channel.id, interaction.user.id);
		if (!ok) {
			if (interaction.isRepliable()) {
				await interaction.reply({
					content: "Ce salon n'est pas un ticket actif.",
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}
		const closeDelayMs = await (
			await import("tsyringe")
		).container
			.resolve((await import("~/services/SettingsService")).SettingsService)
			.getInt("game.ticket.close_delay_ms", 10_000)
			.catch(() => 10_000);
		const closeSec = Math.round(closeDelayMs / 1000);
		if (interaction.isRepliable()) {
			await interaction.reply({
				content: `🔒 Ticket fermé par <@${interaction.user.id}>. Suppression dans ${closeSec} secondes…`,
			});
		}
		setTimeout(async () => {
			await (interaction.channel as TextChannel).delete().catch(() => {});
		}, closeDelayMs);

		const embed = this.logs
			.makeEmbed("Ticket fermé", 0x6b7280)
			.addFields(
				{ name: "Fermé par", value: `<@${interaction.user.id}>` },
				{ name: "Salon", value: `#${(interaction.channel as TextChannel).name}` }
			);
		await this.logs.send(interaction.client, "ticket", embed);
	}

	// /close
	@Slash({ name: "close", description: "Fermer le ticket courant" })
	async close(interaction: CommandInteraction) {
		if (!interaction.channel) return;
		const t = await this.tickets.findByChannel(interaction.channel.id);
		if (!t) {
			await interaction.reply({
				content: "Ce salon n'est pas un ticket.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await this.closeTicket(interaction as unknown as ButtonInteraction);
	}

	// /ticket add / remove
	@Slash({ name: "ticket", description: "Ajouter/retirer quelqu'un du ticket courant" })
	async manage(
		@SlashChoice({ name: "add", value: "add" })
		@SlashChoice({ name: "remove", value: "remove" })
		@SlashOption({
			name: "action",
			description: "add/remove",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "add" | "remove",
		@SlashOption(
			{
				name: "utilisateur",
				description: "Utilisateur",
				type: ApplicationCommandOptionType.User,
				required: false,
			},
			userTransformer
		)
		user: User | undefined,
		@SlashOption({
			name: "role",
			description: "Rôle",
			type: ApplicationCommandOptionType.Role,
			required: false,
		})
		role: Role | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.guild || !interaction.channel) return;
		const t = await this.tickets.findByChannel(interaction.channel.id);
		if (!t) {
			await interaction.reply({
				content: "Utilisable uniquement dans un ticket.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const targetId = user?.id ?? role?.id;
		if (!targetId) {
			await interaction.reply({
				content: "Spécifiez un utilisateur ou un rôle.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (action === "add")
			await this.tickets.addUser(interaction.guild, interaction.channel.id, targetId);
		else await this.tickets.removeUser(interaction.guild, interaction.channel.id, targetId);
		await interaction.reply({
			content: `✅ ${action === "add" ? "Ajouté" : "Retiré"} <@${targetId}>.`,
		});
	}
}
