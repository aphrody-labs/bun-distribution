import type { EntityManager } from "@mikro-orm/core";
import type { BaseMessageOptions, ButtonInteraction } from "discord.js";
import { escapeMarkdown, userMention } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import type { Vote } from "@/entities";
import { Clan, ClanExperience, ClanMember, ClanTeam, VoteProposal } from "@/entities";
import type { Logger } from "@/services";
import { CustomImagesUpload, Database } from "@/services";
import { ClanMemberRole, ClanState, ClanTeamType, ProposalStatus, VoteChoice } from "@/utils/enums";
import {
	buildErrorEmbed,
	buildNewClanEmbed,
	buildSuccessEmbed,
	createClanFoundationEmbed,
	deleteClan,
	followUpWithSuccessEmbed,
	resolveDependency,
} from "@/utils/functions";

import { buildVoteButtons } from "../functions/components";
import {
	logOnAchilleaDefaultBotChannel,
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanGuildChannel,
} from "../functions/messager";
import type { VotingEventHandler } from "../interfaces/voteWorkflowHandler";

export class ClanFoundationVoteHandler implements VotingEventHandler {
	async onVoteCast(
		proposal: VoteProposal,
		vote: Vote,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		isVoteRemoved: boolean,
		em: EntityManager
	): Promise<void> {
		if (proposal.expiresAt && proposal.expiresAt <= new Date()) return;

		const clan = await em.findOneOrFail(Clan, { id: proposal.targetEntityId });
		const newMember = new ClanMember(clan.id, vote.voter.id, ClanMemberRole.Member);
		await em.persist(newMember);

		const memberCount = await em.getRepository(ClanMember).countClanMembers(clan.id);
		const founders = proposal.eligibleVoters.toArray().map((v) => v.id);
		const mentionFounders = founders.map((id) => userMention(id)).join(", ");
		const captain = await em.getRepository(Clan).getCaptain(clan);

		if (memberCount < founders.length + 1) {
			const voteMsg: BaseMessageOptions = {
				content: `${mentionFounders}\n${userMention(captain ? captain.user.id : interaction.user.id)} veut créer le Clan ${clan.name} avec vous ! Acceptez-vous ?`,
				embeds: [
					createClanFoundationEmbed(
						clan,
						[captain ? captain.user.id : interaction.user.id, ...founders],
						proposal.votes.length
					),
				],
				components: [buildVoteButtons(proposal.id.toString()) as any],
			};

			await interaction.message.edit(voteMsg);
		}

		if (vote.vote === VoteChoice.APPROVE)
			followUpWithSuccessEmbed(interaction, `Vous avez rejoint le Clan ${clan.name} !`, true);
	}

	async onProposalComplete(
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		em: EntityManager
	): Promise<void> {
		if (proposal.status === ProposalStatus.PENDING) return;

		const clan = await em.findOneOrFail(Clan, { id: proposal.targetEntityId });

		if (proposal.status === ProposalStatus.EXPIRED) {
			await this.handleExpiredProposal(clan, interaction, em, client, logger);

			return;
		}

		if (proposal.status === ProposalStatus.APPROVED)
			await this.handleApproval(clan, interaction, em, logger, client);
		else if (proposal.status === ProposalStatus.REJECTED)
			await this.handleRejection(clan, interaction, em, client, logger);
	}

	/**
	 * Une fois tous les fondateurs rejoints, le clan est directement approuvé — plus de
	 * vote d'administrateurs (retiré à la demande produit : la création est auto-approuvée).
	 * Reprend telle quelle la logique d'approbation qui vivait dans
	 * `ClanApprovalVoteHandler.handleApproval` (rôle capitaine, annonces).
	 */
	private async handleApproval(
		clan: Clan,
		interaction: ButtonInteraction,
		em: EntityManager,
		logger: Logger,
		client: Client
	) {
		clan.state = ClanState.Approved;

		const xp = new ClanExperience();
		xp.clan = clan;
		clan.xp = xp;

		const mainTeam = new ClanTeam();
		const subTeam = new ClanTeam();
		mainTeam.clan = clan;
		subTeam.clan = clan;
		mainTeam.name = "Equipe principale";
		subTeam.name = "Equipe secondaire";
		mainTeam.type = ClanTeamType.MAIN;
		subTeam.type = ClanTeamType.SUB;

		await em.persist([clan, mainTeam, subTeam]).flush();

		const captain = await em.getRepository(ClanMember).getClanCaptain(clan.id);

		const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
		const captainAsGuildMember = await achillea.members.fetch(captain!.user.id);
		await captainAsGuildMember.roles.add(coreManagerConfig.captainRoleId);

		await interaction.message.edit({
			embeds: [
				buildSuccessEmbed(
					`All founders of the clan ${clan.name} have joined ! Your clan is now approved !`
				),
			],
			components: [],
			content: "",
		});

		const msg: BaseMessageOptions = {
			content: userMention(captain!.user.id),
			embeds: [buildSuccessEmbed(`Félicitations, votre Clan ${clan.name} a été créé !`)],
		};
		await logOnAchilleaSpecificClanChannel(logger, msg, clan.channelId);
		await logOnClanGuildChannel(logger, msg, clan.guild);

		await logOnAchilleaGenericClanChannel(logger, {
			embeds: [await buildNewClanEmbed(clan, captain!.user.id)],
		});
	}

	private async handleRejection(
		clan: Clan,
		interaction: ButtonInteraction,
		em: EntityManager,
		client: Client,
		logger: Logger
	) {
		const captain = await em.findOneOrFail(ClanMember, {
			clan: clan.id,
			role: ClanMemberRole.Captain,
		});
		const msg: BaseMessageOptions = {
			content: userMention(captain.user.id),
			embeds: [
				buildErrorEmbed(
					`La création du Clan ${clan.name} a été annulée par ${escapeMarkdown(interaction.user.displayName)}.`
				),
			],
		};
		await logOnAchilleaDefaultBotChannel(logger, msg);
		const imgService = await resolveDependency(CustomImagesUpload);

		const db = await resolveDependency(Database);

		await deleteClan(clan, db, imgService, client);
	}

	private async handleExpiredProposal(
		clan: Clan,
		interaction: ButtonInteraction,
		em: EntityManager,
		client: Client,
		logger: Logger
	): Promise<void> {
		const captain = await em.findOneOrFail(ClanMember, {
			clan: clan.id,
			role: ClanMemberRole.Captain,
		});
		const msg: BaseMessageOptions = {
			content: userMention(captain.user.id),
			embeds: [
				buildErrorEmbed(
					`La procédure de vote a expiré, la fondation du Clan ${clan.name} a donc été annulée.`
				),
			],
		};
		await logOnAchilleaDefaultBotChannel(logger, msg);
		const imgService = await resolveDependency(CustomImagesUpload);

		const db = await resolveDependency(Database);

		await deleteClan(clan, db, imgService, client);
	}
}
