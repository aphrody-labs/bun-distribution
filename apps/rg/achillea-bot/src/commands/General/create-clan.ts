import { Category } from "@aphrody/utilities";
import { rel } from "@mikro-orm/core";
import type { BaseMessageOptions, CommandInteraction, GuildMember } from "discord.js";
import {
	ApplicationCommandOptionType,
	channelMention,
	escapeMarkdown,
	MessageFlags,
	User,
	userMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard, Guild } from "@aphrody/discordx";
import { container } from "tsyringe";

import { coreManagerConfig } from "@/configs";
import { Discord, Injectable, Slash, SlashOption } from "@/decorators";
import {
	Clan,
	ClanMember,
	Guild as GuildEntity,
	User as UserEntity,
	VoteProposal,
} from "@/entities";
import { NoClan } from "@/guards";
import { CustomImagesUpload, Database, Logger } from "@/services";
import {
	checkClanNameValidity,
	checkClanShortNameValidity,
	createClanFoundationEmbed,
	followUpWithErrorEmbed,
	isSocialMediaUrl,
	normalizeNames,
	replyWithSimpleErrorEmbed,
	runInRequestContext,
	syncUser,
} from "@/utils/functions";

import {
	ClanMemberDistinction,
	ClanMemberRole,
	ProposalType,
	VotingStrategy,
} from "../../utils/enums";
import { createClanSpecificChannel } from "../../utils/functions/channel";
import { buildClanCreationModal, buildVoteButtons } from "../../utils/functions/components";
import { logOnAchilleaSpecificClanChannel, sendMessage } from "../../utils/functions/messager";
import type { ClanData } from "../../utils/types/clanData";

@Discord()
@Guild(coreManagerConfig.coreGuildId)
@Guard(NoClan)
@Injectable()
@Category("General")
export default class CreateClanCommand {
	constructor(
		private db: Database,
		private imgUploader: CustomImagesUpload
	) {}

	@Slash({
		description: "Créez votre propre Clan",
		name: "create-clan",
	})
	async createClan(
		@SlashOption({
			description: "Premier membre fondateur",
			name: "member_1",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		member1: GuildMember,
		@SlashOption({
			description: "Deuxième membre fondateur",
			name: "member_2",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		member2: GuildMember,
		@SlashOption({
			description: "Troisième membre fondateur",
			name: "member_3",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		member3: GuildMember,
		@SlashOption({
			description: "Quatrième membre fondateur",
			name: "member_4",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		member4: GuildMember,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		const clanMembers = [member1, member2, member3, member4];
		const clanMembersIds = [member1.id, member2.id, member3.id, member4.id];
		const founders = [interaction.user.id, ...clanMembersIds];
		if (new Set(founders).size !== founders.length) {
			replyWithSimpleErrorEmbed(
				interaction,
				`Vous ne pouvez pas créer un Clan avec des utilisateurs dupliqués !`
			);

			return;
		}

		const clanMembersRepo = this.db.get(ClanMember);

		for (const member of clanMembers) {
			if (member instanceof User) {
				replyWithSimpleErrorEmbed(
					interaction,
					`L'utilisateur ${escapeMarkdown(member.displayName)} n'est pas présent sur ce serveur !`
				);

				return;
			}
			await syncUser(member.user);
			const clanMember = await clanMembersRepo.findOne({ user: member.id });
			if (clanMember) {
				replyWithSimpleErrorEmbed(
					interaction,
					`L'utilisateur ${escapeMarkdown(member.user.displayName)} est déjà dans un Clan !`
				);

				return;
			}
		}

		// @ts-ignore
		await interaction.showModal(buildClanCreationModal());
		const submittedModal = await interaction
			.awaitModalSubmit({
				filter: (i) => i.user.id === interaction.user.id,
				time: 300_000,
			})
			.catch(() => {
				if (interaction.replied || interaction.deferred) return;

				try {
					replyWithSimpleErrorEmbed(
						interaction,
						`Délai d'attente maximum dépassé ! Veuillez réessayer.`
					);
				} catch (err) {
					console.error("Failed to send timeout message:", err);
				}

				return null;
			});

		if (submittedModal) {
			const wasDeferred = await submittedModal
				.deferReply({ flags: MessageFlags.Ephemeral })
				.catch(() => {
					return false;
				});

			if (!wasDeferred) {
				return;
			}

			const clanName = submittedModal.fields.getTextInputValue("clanName");
			const clanShortenedName = submittedModal.fields.getTextInputValue("clanShortenedName");
			const clanBiography = submittedModal.fields.getTextInputValue("clanBiography");
			const socialMediaUrl = submittedModal.fields.getTextInputValue("socialMedia");
			const guildId = submittedModal.fields.getTextInputValue("guildId");

			// Checks for clan name
			const validName = await checkClanNameValidity(clanName, submittedModal, this.db);

			if (!validName) {
				return;
			}

			// Checks for shortened name
			const validShortName = await checkClanShortNameValidity(
				clanShortenedName,
				submittedModal,
				this.db
			);

			if (!validShortName) {
				return;
			}

			// Check if social media url is a valid url
			const socialMediaDTO = await isSocialMediaUrl(socialMediaUrl);
			if (!socialMediaDTO) {
				followUpWithErrorEmbed(submittedModal, "L'url de ce réseau est invalide !");

				return;
			}

			if (guildId) {
				const guildsRepo = this.db.get(GuildEntity);
				const discordGuild = await client.guilds.fetch(guildId).catch(() => {
					followUpWithErrorEmbed(submittedModal, "Le bot n'est pas présent dans cette Guilde !");

					return null;
				});
				if (!discordGuild) return;
				const clanGuild = await guildsRepo.findOne({ id: discordGuild.id });
				if (!clanGuild || clanGuild.deleted) {
					followUpWithErrorEmbed(submittedModal, "Le bot n'est pas présent dans cette Guilde !");

					return;
				}
				if (discordGuild.ownerId !== interaction.user.id) {
					followUpWithErrorEmbed(submittedModal, "Vous n'êtes pas propriétaire de cette Guilde !");

					return;
				}
				if (!clanGuild.broadcastChannel) {
					followUpWithErrorEmbed(
						submittedModal,
						"Votre Guilde n'a pas paramétré de salon d'alerte pour votre Clan !"
					);

					return;
				}
			}

			const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
			const newClanRole = await achillea.roles.create({
				name: clanName,
				mentionable: true,
				reason: `Rôle automatique suite à la création du Clan ${clanName}`,
			});

			const captainAsGuildMember = await achillea.members.fetch(interaction.user.id);
			await captainAsGuildMember.roles.add(newClanRole, `Président du Clan ${clanName}`);
			clanMembers.forEach((member) =>
				member.roles.add(newClanRole, `Fondateur du Clan ${clanName}`)
			);

			const clanChannel = await createClanSpecificChannel(
				achillea,
				coreManagerConfig.clanCategoryId,
				clanName,
				newClanRole.id,
				interaction.user.id
			);

			await submittedModal.followUp({
				content: `Go to ${channelMention(clanChannel.id)}`,
				flags: MessageFlags.Ephemeral,
			});

			const logger = container.resolve(Logger);
			await sendMessage(
				`${userMention(interaction.user.id)}, toutes les informations ont été vérifiées. Finissez le procesus en joignant le logo de votre Clan à votre prochain message dans un délai de 5 minutes !`,
				clanChannel.id,
				logger
			);

			const channelCollector = clanChannel.createMessageCollector({
				filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
				time: 600_000, // 5 mins
			});

			channelCollector.on("collect", async (logoMessage) => {
				const attachment = logoMessage.attachments.first()!;
				if (!(attachment.contentType && attachment.contentType.includes("image"))) {
					await logoMessage.reply({
						content: "Ce fichier n'est pas une image ! Veuillez réessayer",
					});

					return;
				}
				const imgExtension = attachment.contentType.split("/")[1];
				const validExtensions = ["png", "jpg", "jpeg"];
				if (!validExtensions.includes(imgExtension)) {
					await logoMessage.reply(
						"Ce format d'image n'est pas pris en charge, veuillez réessayer !"
					);

					return;
				}
				try {
					// Le collector se déclenche hors pipeline discordx → aucun RequestContext
					// actif → `db.em` / `db.get()` retomberaient sur l'EM global (MikroORM v7
					// refuse : « Using global EntityManager… »). On force un fork de contexte
					// pour TOUT le travail DB (lookup Image/Clan + persistance du Clan/vote).
					await runInRequestContext(this.db, async () => {
						const newLogoResult = await this.imgUploader.processAttachment(
							attachment,
							true,
							false,
							normalizeNames(clanShortenedName)
						);
						// processAttachment renvoie une STRING (hash déjà connu, ou pas d'upload emoji)
						// OU { url, emojiId } (nouvel emoji). L'ancien cast forcé donnait url=undefined
						// quand le logo existait déjà → garde « logo dupliqué » court-circuitée + logoUrl vide.
						const newLogoUrl =
							typeof newLogoResult === "string" ? newLogoResult : newLogoResult.url;
						const newLogoEmojiId =
							typeof newLogoResult === "string"
								? ""
								: ((newLogoResult as { emojiId?: string }).emojiId ?? "");

						const clanUsingImage = await this.db.get(Clan).findOne({ clanAvatarUrl: newLogoUrl });

						if (clanUsingImage) {
							await logoMessage.reply("Ce logo est déjà utilisé, veuillez réessayer !");

							return;
						}

						await logoMessage.reply({ content: "Logo téléchargé !" });
						const clanData: ClanData = {
							name: clanName,
							shortName: clanShortenedName,
							logoUrl: newLogoUrl,
							socialType: socialMediaDTO.platform,
							socialUrl: socialMediaDTO.canonicalUrl,
							biography: clanBiography,
							founders: clanMembersIds,
							roleId: newClanRole.id,
							emojiId: newLogoEmojiId,
						};

						if (guildId) {
							clanData.guild = rel(GuildEntity, guildId);
						}
						await this.verifyClanFoundersConfirmation(
							interaction,
							clanData,
							clanChannel.id,
							logger
						);
						channelCollector.stop("logo-received"); // Only stop if everything succeeded
					});
				} catch (error) {
					await logoMessage.reply("Téléchargement du logo échoué ! L'image est invalide...");
					console.info(error);
				}
			});

			channelCollector.on("end", async () => {
				if (channelCollector.endReason !== "logo-received") {
					followUpWithErrorEmbed(
						interaction,
						`Echec de la création du clan ${clanName} ! Le délai d'attente maximum a été dépassé.`,
						true
					);
					await newClanRole.delete(`Echec de la création du clan ${clanName}`);
					await clanChannel.delete(`Echec de la création du clan ${clanName}`);
					await captainAsGuildMember.roles.remove(
						[coreManagerConfig.captainRoleId],
						`Echec de la création du clan ${clanName}`
					);
				} else {
					await clanChannel.permissionOverwrites.delete(interaction.user.id);
					await clanChannel.permissionOverwrites.edit(newClanRole.id, {
						SendMessages: true,
					});
				}
			});
		}
	}

	async verifyClanFoundersConfirmation(
		interaction: CommandInteraction,
		clanData: ClanData,
		channelId: string,
		logger: Logger
	) {
		const clanMembersRepo = this.db.get(ClanMember);
		const newClan = new Clan(
			[interaction.user.id, ...clanData.founders],
			clanData.name,
			clanData.shortName,
			clanData.logoUrl,
			clanData.biography,
			clanData.socialType,
			clanData.socialUrl,
			channelId,
			clanData.roleId,
			clanData.guild?.id
		);
		newClan.clanEmojiId = clanData.emojiId;
		await this.db.em.persist(newClan).flush();

		const founder = await clanMembersRepo.createMember(
			newClan.id,
			interaction.user.id,
			ClanMemberRole.Captain,
			[ClanMemberDistinction.Staff]
		);
		await this.db.em.persist(founder).flush();

		const voters = await this.db.em.find(UserEntity, [...clanData.founders]);

		const voteProposal = new VoteProposal();
		voteProposal.type = ProposalType.CLAN_CREATION;
		voteProposal.strategy = VotingStrategy.MAJORITY;
		voteProposal.reason = `Proposition de création du Clan ${clanData.name} par ${escapeMarkdown(interaction.user.displayName)}`;
		voteProposal.eligibleVoters.set(voters);
		voteProposal.targetEntityType = "Clan";
		voteProposal.targetEntityId = newClan.id;
		voteProposal.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

		await this.db.em.persist(voteProposal).flush();

		const mentionsString = clanData.founders.map((id) => userMention(id));
		const voteMsg: BaseMessageOptions = {
			content: `${mentionsString.join(", ")}\n${userMention(interaction.user.id)} souhaite fonder le clan ${clanData.name} avec vous ! Acceptez-vous ?`,
			embeds: [
				createClanFoundationEmbed(
					newClan,
					[interaction.user.id, ...clanData.founders],
					voteProposal.votes.length
				) as any,
			],
			components: [buildVoteButtons(voteProposal.id.toString()) as any],
		};
		await logOnAchilleaSpecificClanChannel(logger, voteMsg, newClan.channelId);
	}
}
