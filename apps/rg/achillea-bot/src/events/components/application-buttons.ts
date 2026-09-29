import type { BaseMessageOptions, ButtonInteraction } from "discord.js";
import { Colors, EmbedBuilder, MessageFlags, escapeMarkdown } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Guard, Injectable, SelectMenuComponent } from "@/decorators";
import { Clan, ClanApplication, ClanMember } from "@/entities";
import { ClanEnabled, ClanRole, NoClan } from "@/guards";
import { Database, Logger } from "@/services";
import {
	assignClanRoleToUser,
	buildClanMemberEmbed,
	buildErrorEmbed,
	buildSimpleUserEmbed,
	buildSuccessEmbed,
	buildUserEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	hasActiveClanMembership,
	resolveDependency,
} from "@/utils/functions";

import ClanApplyCommand from "../../commands/General/clan-apply";
import { ClanMemberDistinction, ClanMemberRole } from "../../utils/enums";
import {
	buildApplicationCreationButtons,
	buildApplicationDistinctionSelector,
} from "../../utils/functions/components";
import { logOnAchilleaGenericClanChannel, logOnClanChannels } from "../../utils/functions/messager";

@Discord()
@Injectable()
export class ApplicationButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^confirm_application:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async confirmApplication(interaction: ButtonInteraction, client: Client) {
		await interaction.deferUpdate();

		const [, applicationId] = interaction.customId.split(":");

		const clanApplicationRepo = this.db.get(ClanApplication);
		const application = await clanApplicationRepo.findOne(
			{ id: Number(applicationId) },
			{ populate: ["user", "clan"] }
		);

		if (!application) {
			const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
			newEmbed.setColor(Colors.Blue);
			await interaction.editReply({
				content: "",
				embeds: [newEmbed],
				components: [],
			});
			followUpWithErrorEmbed(
				interaction,
				`La candidature ID ${applicationId} n'existe pas ou a déjà été traitée.`,
				true
			);

			return;
		}

		// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
		const isInActiveClan = await hasActiveClanMembership(application.user.id, this.db.em);

		if (isInActiveClan) {
			followUpWithErrorEmbed(interaction, `L'utilisateur fait déjà partie d'un Clan.`, true);

			return;
		}

		const newMember = await this.db
			.get(ClanMember)
			.createMember(
				application.clan.id,
				application.user.id,
				ClanMemberRole.Trial,
				application.distinctions
			);

		await this.db.em.persist(newMember).flush();

		await assignClanRoleToUser(client, newMember, application.clan);

		await this.db.em.populate(newMember, ["user"]);

		const user = await client.users.fetch(newMember.user.id);

		await interaction.editReply({
			content: "",
			embeds: [
				await buildUserEmbed(application.user, client, "Candidature acceptée", Colors.Green),
			],
			components: [],
		});

		const msg: BaseMessageOptions = {
			embeds: [await buildClanMemberEmbed(newMember, client, "Nouveau membre")],
		};

		const logger = await resolveDependency(Logger);

		await this.db.em.populate(application.clan, ["guild"]);

		await logOnClanChannels(
			logger,
			{
				embeds: [
					buildSuccessEmbed(
						`La candidature de l'utilisateur ${escapeMarkdown(application.user.displayName)} a été acceptée par ${escapeMarkdown(interaction.user.displayName)}`
					),
				],
			},
			application.clan
		);
		await logOnClanChannels(logger, msg, application.clan);

		await logOnAchilleaGenericClanChannel(logger, {
			embeds: [
				await buildSimpleUserEmbed(
					user,
					"Nouveau membre",
					`${user.displayName} a rejoint ${application.clan.name} !`,
					0x57f287
				),
			],
		});
	}

	@ButtonComponent({ id: /^refuse_application:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async refuseApplication(interaction: ButtonInteraction, client: Client) {
		await interaction.deferUpdate();

		const [, applicationId] = interaction.customId.split(":");

		const application = await this.db
			.get(ClanApplication)
			.findOne({ id: Number(applicationId) }, { populate: ["user", "clan"] });

		if (!application) {
			const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
			newEmbed.setColor(Colors.Blue);
			await interaction.editReply({
				content: "",
				embeds: [newEmbed],
				components: [],
			});
			followUpWithErrorEmbed(
				interaction,
				`La candidature ID ${applicationId} n'existe pas ou a déjà été traitée.`,
				true
			);

			return;
		}

		await this.db.get(ClanApplication).nativeDelete({ id: Number(applicationId) });

		const logger = await resolveDependency(Logger);

		await interaction.editReply({
			content: "",
			embeds: [await buildUserEmbed(application.user, client, "Candidature rejetée", Colors.Red)],
			components: [],
		});

		await logOnClanChannels(
			logger,
			{
				embeds: [
					buildErrorEmbed(
						`La candidature de l'utilisateur ${escapeMarkdown(application.user.displayName)} a été refusée par ${escapeMarkdown(interaction.user.displayName)}`
					),
				],
			},
			application.clan
		);

		followUpWithSuccessEmbed(interaction, "Candidature refusée.", true);
	}

	@ButtonComponent({ id: /^init_application:.+/ })
	@Guard(NoClan)
	async initApplication(
		interaction: ButtonInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const [, targetClanId] = interaction.customId.split(":");

		const targetClan = await this.db
			.get(Clan)
			.findOne({ id: Number(targetClanId) }, { populate: ["guild"] });

		if (!targetClan) {
			followUpWithErrorEmbed(interaction, `Ce Clan n'existe plus`, true);

			return;
		}

		if (!targetClan.isRecruiting) {
			followUpWithErrorEmbed(interaction, "Ce Clan ne recrute pas pour le moment !", true);

			return;
		}

		const alreadyApplied = await this.db
			.get(ClanApplication)
			.findOne({ user: interaction.user.id, clan: targetClan });

		if (alreadyApplied) {
			followUpWithErrorEmbed(
				interaction,
				"Vous avez déjà une candidature en cours auprès de ce Clan !",
				true
			);

			return;
		}

		// await interaction.followUp({ content: `Voulez-vous postuler au Clan [${targetClan.shortenedName}] ${targetClan.name} ?`, flags: MessageFlags.Ephemeral, components: [buildApplicationCreationButtons(targetClan.id.toString()) as any] })
		await interaction.followUp({
			content: `Sélectionnez vos distinctions avant de postuler à [${targetClan.shortenedName}] ${targetClan.name} :`,
			flags: MessageFlags.Ephemeral,
			components: [buildApplicationDistinctionSelector(targetClan.id, "apply")],
		});
	}

	@ButtonComponent({ id: /^create_application:.+/ })
	@Guard(NoClan)
	async apply(interaction: ButtonInteraction, client: Client, { localize, clan }: InteractionData) {
		await interaction.deferUpdate();

		const [, clanIdStr, distinctionsStr] = interaction.customId.split(":");
		const targetClanId = Number(clanIdStr);
		const distinctions = distinctionsStr
			? distinctionsStr
					.split("|")
					.map((v) => ClanMemberDistinction[v as keyof typeof ClanMemberDistinction])
					.filter((v): v is ClanMemberDistinction => !!v)
			: [];

		const targetClan = await this.db.get(Clan).findOne({ id: Number(targetClanId) });

		if (!targetClan) {
			followUpWithErrorEmbed(interaction, "Clan introuvable", true);

			return;
		}

		const clanApplyCommand = await resolveDependency(ClanApplyCommand);
		// Apply to Clan
		await clanApplyCommand.applyToClan(targetClan, interaction, client, distinctions);
	}

	@ButtonComponent({ id: /^cancel_application:.+/ })
	async cancelApplication(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		await interaction.deleteReply();
	}

	@SelectMenuComponent({ id: /^apply_distinctions:\d+$/ })
	async handleDistinctionSelect(interaction: any, client: Client) {
		await interaction.deferUpdate();

		const [, clanIdStr] = interaction.customId.split(":");
		const clanId = Number(clanIdStr);
		const selectedValues: string[] = interaction.values; // e.g. ['Player', 'Staff']

		const clan = await this.db.get(Clan).findOne({ id: clanId });
		if (!clan) {
			await interaction.message.delete();

			return followUpWithErrorEmbed(interaction, `Clan introuvable.`, true);
		}

		const distinctionsDisplay = selectedValues
			.map((v) => ClanMemberDistinction[v as keyof typeof ClanMemberDistinction])
			.filter((v): v is ClanMemberDistinction => !!v);

		// Ask for confirmation — same as before, but show chosen distinctions
		await interaction.editReply({
			content: `Vous allez postuler au Clan [${clan.shortenedName}] ${clan.name} avec les distinctions suivantes : **${distinctionsDisplay.join(", ")}**.\nSouhaitez-vous confirmer ?`,
			flags: MessageFlags.Ephemeral,
			components: [buildApplicationCreationButtons(clan.id.toString(), selectedValues.join("|"))],
		});
	}
}
