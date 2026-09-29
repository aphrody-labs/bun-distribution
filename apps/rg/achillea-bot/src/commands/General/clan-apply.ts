import { Category } from "@aphrody/utilities";
import { rel } from "@mikro-orm/core";
import type { BaseMessageOptions, ButtonInteraction, CommandInteraction } from "discord.js";
import {
	ApplicationCommandOptionType,
	Colors,
	escapeMarkdown,
	MessageFlags,
	roleMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Clan, ClanApplication, ClanMember, User as UserEntity } from "@/entities";
import { NoClan } from "@/guards";
import { Database, Logger } from "@/services";
import {
	assignClanRoleToUser,
	buildClanMemberEmbed,
	buildSimpleUserEmbed,
	buildSuccessEmbed,
	buildUserEmbed,
	followUpWithErrorEmbed,
	resolveDependency,
	validateClanMemberLimits,
} from "@/utils/functions";

import type { ClanMemberDistinction } from "../../utils/enums";
import { ClanMemberRole } from "../../utils/enums";
import {
	buildApplicationDistinctionSelector,
	buildConfirmCancelApplicationButtons,
} from "../../utils/functions/components";
import {
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanChannels,
} from "../../utils/functions/messager";

@Discord()
@Guard(NoClan)
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class ClanApplyCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Apply to join a Clan",
		name: "apply",
	})
	async apply(
		@SlashOption({
			description: "Sigle du Clan auprès duquel vous souhaitez postuler",
			name: "shortname",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		shortenedName: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const clanShortenedName = shortenedName.trim().toUpperCase();
		const clan = await this.db.em.findOne(
			Clan,
			{ normalizedShortName: clanShortenedName },
			{ populate: ["guild"] }
		);

		if (!clan) {
			followUpWithErrorEmbed(
				interaction,
				`Clan with short name ${clanShortenedName} doesn't exist`,
				true
			);

			return;
		}

		if (!clan.isRecruiting) {
			followUpWithErrorEmbed(interaction, "This Clan is not currently recruiting !", true);

			return;
		}

		const clanApplicationsRepo = this.db.get(ClanApplication);
		const alreadyApplied = await clanApplicationsRepo.findOne({ user: interaction.user.id, clan });

		if (alreadyApplied) {
			followUpWithErrorEmbed(
				interaction,
				"You already have a pending application to this Clan !",
				true
			);

			return;
		}

		await interaction.followUp({
			content: `Sélectionnez vos distinctions avant de postuler à [${clan.shortenedName}] ${clan.name} :`,
			flags: MessageFlags.Ephemeral,
			components: [buildApplicationDistinctionSelector(clan.id, "apply")],
		});
	}

	public async applyToClan(
		clan: Clan,
		interaction: ButtonInteraction,
		client: Client,
		distinctions: ClanMemberDistinction[]
	) {
		try {
			await validateClanMemberLimits(clan, this.db.em, distinctions);

			if (clan.autoAcceptMembers) {
				await this.processAutoJoin(clan, interaction, client, distinctions);

				return;
			}

			const application = new ClanApplication();
			application.user = rel(UserEntity, interaction.user.id);
			application.clan = clan;
			application.distinctions = distinctions;

			await this.db.em.persist(application).flush();

			const logger = await resolveDependency(Logger);
			await this.db.em.populate(application, ["user"]);
			const msg: BaseMessageOptions = {
				content: `${roleMention(clan.roleId)} Cet utilisateur postule en tant que **${distinctions.join(", ")}**`,
				embeds: [await buildUserEmbed(application.user, client, "Candidature", Colors.Blue)],
				components: [buildConfirmCancelApplicationButtons(application.id.toString())],
			};

			await interaction.editReply({
				content: "",
				components: [],
				embeds: [buildSuccessEmbed(`Votre candidature a été envoyée à ${clan.name}`)],
			});

			const sentMsg = await logOnAchilleaSpecificClanChannel(logger, msg, clan.channelId);
			if (sentMsg) application.messageId = sentMsg.id;
			await this.db.em.persist(application).flush();
		} catch (err: any) {
			followUpWithErrorEmbed(interaction, err.message, true);

			return await interaction.deleteReply().catch(() => null);
		}
	}

	async processAutoJoin(
		clan: Clan,
		interaction: ButtonInteraction,
		client: Client,
		distinctions: ClanMemberDistinction[]
	) {
		const newMember = await this.db
			.get(ClanMember)
			.createMember(clan.id, interaction.user.id, ClanMemberRole.Trial, distinctions);

		await this.db.em.persist(newMember).flush();

		await assignClanRoleToUser(client, newMember, clan);

		await interaction.editReply({
			content: "",
			components: [],
			embeds: [buildSuccessEmbed(`Vous avez rejoint le Clan ${clan.name}`)],
		});

		await this.db.em.populate(newMember, ["user"]);

		const msg: BaseMessageOptions = {
			embeds: [await buildClanMemberEmbed(newMember, client, "Nouveau membre")],
		};

		const logger = await resolveDependency(Logger);

		await logOnClanChannels(logger, msg, clan);

		const user = await client.users.fetch(newMember.user.id);

		await logOnAchilleaGenericClanChannel(logger, {
			embeds: [
				await buildSimpleUserEmbed(
					user ?? newMember.user,
					"Nouveau membre",
					`${escapeMarkdown(user.displayName)} a rejoint ${clan.name} !`,
					0x57f287
				),
			],
		});
	}
}
