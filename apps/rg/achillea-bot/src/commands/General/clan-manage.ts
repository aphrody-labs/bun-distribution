import { Category } from "@aphrody/utilities";
import type {
	BaseMessageOptions,
	BooleanCache,
	ButtonBuilder,
	ButtonInteraction,
	CacheType,
	ChannelSelectMenuInteraction,
	CommandInteraction,
	MentionableSelectMenuInteraction,
	Message,
	RoleSelectMenuInteraction,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextChannel,
	User,
	UserSelectMenuInteraction,
	WrapBooleanCache,
} from "discord.js";
import {
	ActionRowBuilder,
	ComponentType,
	escapeMarkdown,
	MessageFlags,
	userMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import type { Clan } from "@/entities";
import { ClanInvite, ClanMember, Image } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { CustomImagesUpload, Database, Logger } from "@/services";
import {
	buildAllClanMembersEmbed,
	buildClanInviteManagementEmbed,
	buildClanInvitesEmbed,
	buildClanMemberEmbed,
	buildInfoEmbed,
	buildSimpleUserEmbed,
	checkClanNameValidity,
	checkClanShortNameValidity,
	createActiveClanInfosEmbed,
	editClanSocials,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	kickMember,
	logMemberDeparture,
	normalizeNames,
	resolveDependency,
	revokeInvite,
	runInRequestContext,
} from "@/utils/functions";

import { ClanMemberRole, ClanMemberRoleName } from "../../utils/enums";
import {
	buildClanInviteManagementButtons,
	buildClanInvitesSelector,
	buildClanManagementInfosEditButtons,
	buildClanManagementMainMenuButtons,
	buildClanMemberManagementButtons,
	buildClanMembersSelector,
	buildClanSettingsButtons,
	buildClanSocialsModal,
	buildConfirmCancelButtons,
	buildNameChangeModal,
	buildPaginationButtons,
	buildReturnToMenuButton,
	buildSimpleModal,
} from "../../utils/functions/components";
import { logOnClanChannels } from "../../utils/functions/messager";

@Discord()
@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
@Injectable()
@Category("General")
@SlashGroup({ description: "Manage clans", name: "clan" })
@SlashGroup("clan")
export default class ManageClanCommand {
	constructor(
		private db: Database,
		private imgUploader: CustomImagesUpload
	) {}

	@Slash({
		description: "Gérez votre Clan",
		name: "manage",
	})
	async manageClan(
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply();

		const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);

		const msg = await interaction.followUp({
			embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
			components: [buildClanManagementMainMenuButtons()],
		});

		const userTarget = new Map<string, ClanMember>();
		const inviteTarget = new Map<string, ClanInvite>();
		// Page courante PERSISTANTE entre les clics : elle était re-déclarée à 1 dans CHAQUE
		// callback collect → la pagination des membres était cassée (Suivant→toujours 2,
		// Précédent→toujours 1). On la sort donc du callback.
		let currentPage = 1;

		const msgCollector = msg.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id,
			idle: 120_000,
		});

		msgCollector.on("collect", async (i) => {
			// Collector hors pipeline discordx → aucun RequestContext actif. On force un
			// fork de contexte : il couvre les branches synchrones du switch ET les
			// callbacks `.then` de modals/sélecteurs enregistrés ici (l'AsyncLocalStorage
			// se propage à travers les chaînes de Promise). Seuls les SOUS-COLLECTORS
			// EventEmitter (handleAvatar / handleRevokeInvite) perdent le contexte et
			// portent donc leur propre runInRequestContext.
			await runInRequestContext(this.db, async () => {
				let clanMembers;
				let invites;
				let totalPages;
				const pagination = 15;
				switch (i.customId) {
					case "clanInfos":
						await i.deferUpdate();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanManagementInfosEditButtons()],
						});
						break;

					case "clanMembers":
						await i.deferUpdate();
						currentPage = 1; // ouverture de l'onglet membres : toujours page 1
						clanMembers = await this.db.em.findAndCount(
							ClanMember,
							{ clan: clan.id },
							{
								populate: ["user"],
								limit: pagination,
								offset: (currentPage - 1) * pagination,
								orderBy: { role: "desc", createdAt: "desc" },
							}
						);
						totalPages = Math.ceil(clanMembers[1] / pagination);
						console.info(clanMembers);
						await msg.edit({
							embeds: [
								await buildAllClanMembersEmbed(
									interaction,
									clan,
									clanMembers[0],
									clanMembers[1],
									currentPage,
									totalPages
								),
							],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents([
									...buildPaginationButtons(1, totalPages, "members"),
									buildReturnToMenuButton(),
								]),
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanMembersSelector(clanMembers[0], guild)
								),
							],
						});
						break;

					case "previous-page:members":
						currentPage = Math.max(1, currentPage - 1);
						await i.deferUpdate();
						clanMembers = await this.db.em.findAndCount(
							ClanMember,
							{ clan: clan.id },
							{
								populate: ["user"],
								limit: pagination,
								offset: (currentPage - 1) * pagination,
								orderBy: { role: "desc", createdAt: "desc" },
							}
						);
						totalPages = Math.ceil(clanMembers[1] / pagination);
						await msg.edit({
							embeds: [
								await buildAllClanMembersEmbed(
									interaction,
									clan,
									clanMembers[0],
									clanMembers[1],
									currentPage,
									totalPages
								),
							],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents([
									...buildPaginationButtons(currentPage, totalPages, "members"),
									buildReturnToMenuButton(),
								]),
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanMembersSelector(clanMembers[0], guild)
								),
							],
						});
						break;

					case "next-page:members":
						currentPage = currentPage + 1;
						await i.deferUpdate();
						clanMembers = await this.db.em.findAndCount(
							ClanMember,
							{ clan: clan.id },
							{
								populate: ["user"],
								limit: pagination,
								offset: (currentPage - 1) * pagination,
								orderBy: { role: "desc", createdAt: "desc" },
							}
						);
						totalPages = Math.ceil(clanMembers[1] / pagination);
						if (currentPage + 1 > totalPages && clanMembers[0].length === 0) {
							currentPage = currentPage - 1;
							clanMembers = await this.db
								.get(ClanMember)
								.getAllMembers(clan.id, currentPage + 1, 15);
						}
						await msg.edit({
							embeds: [
								await buildAllClanMembersEmbed(
									interaction,
									clan,
									clanMembers[0],
									clanMembers[1],
									currentPage,
									totalPages
								),
							],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents([
									...buildPaginationButtons(currentPage, totalPages, "members"),
									buildReturnToMenuButton(),
								]),
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanMembersSelector(clanMembers[0], guild)
								),
							],
						});
						break;

					case "first-page:members":
						currentPage = 1;
						await i.deferUpdate();
						clanMembers = await this.db.em.findAndCount(
							ClanMember,
							{ clan: clan.id },
							{
								populate: ["user"],
								limit: pagination,
								offset: (currentPage - 1) * pagination,
								orderBy: { role: "desc", createdAt: "desc" },
							}
						);
						totalPages = Math.ceil(clanMembers[1] / pagination);
						await msg.edit({
							embeds: [
								await buildAllClanMembersEmbed(
									interaction,
									clan,
									clanMembers[0],
									clanMembers[1],
									currentPage,
									totalPages
								),
							],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents([
									...buildPaginationButtons(1, totalPages, "members"),
									buildReturnToMenuButton(),
								]),
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanMembersSelector(clanMembers[0], guild)
								),
							],
						});
						break;

					case "last-page:members":
						await i.deferUpdate();
						// eslint-disable-next-line no-case-declarations
						const totalMembers = await this.db.get(ClanMember).countClanMembers(clan.id);
						totalPages = Math.ceil(totalMembers / pagination);
						currentPage = totalPages;
						clanMembers = await this.db.em.findAndCount(
							ClanMember,
							{ clan: clan.id },
							{
								populate: ["user"],
								limit: pagination,
								offset: (currentPage - 1) * pagination,
								orderBy: { role: "desc", createdAt: "desc" },
							}
						);
						await msg.edit({
							embeds: [
								await buildAllClanMembersEmbed(
									interaction,
									clan,
									clanMembers[0],
									clanMembers[1],
									currentPage,
									totalPages
								),
							],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents([
									...buildPaginationButtons(currentPage, totalPages, "members"),
									buildReturnToMenuButton(),
								]),
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanMembersSelector(clanMembers[0], guild)
								),
							],
						});
						break;

					case "clanSettings":
						await i.deferUpdate();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanSettingsButtons(clan)],
						});
						break;

					case "returnToMenu":
						await i.deferUpdate();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanManagementMainMenuButtons()],
						});
						break;

					case "clanRecruiting":
						await i.deferUpdate();
						clan.isRecruiting = !clan.isRecruiting;
						await this.db.em.persist(clan).flush();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanSettingsButtons(clan)],
						});
						break;

					case "clanAutoRecruit":
						await i.deferUpdate();
						clan.autoAcceptMembers = !clan.autoAcceptMembers;
						await this.db.em.persist(clan).flush();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanSettingsButtons(clan)],
						});
						break;

					case "clanHidden":
						await i.deferUpdate();
						clan.isHidden = !clan.isHidden;
						await this.db.em.persist(clan).flush();
						await msg.edit({
							embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
							components: [buildClanSettingsButtons(clan)],
						});
						break;

					case "clanName":
						await i.showModal(buildNameChangeModal(clan.name, clan.shortenedName));
						handleModal(i).then(async (submittedInteraction) => {
							if (!submittedInteraction) {
								return;
							}

							const wasDeferred = await submittedInteraction.deferUpdate().catch(() => {
								console.warn("Caught old modal interaction and filtered it out.");

								return false;
							});

							if (!wasDeferred) {
								return;
							}

							const clanName = submittedInteraction.fields.getTextInputValue("nameInput");
							const clanShortName = submittedInteraction.fields.getTextInputValue("shortNameInput");

							if (clan.name === clanName && clan.shortenedName === clanShortName) {
								followUpWithErrorEmbed(
									interaction,
									"Ces noms sont déjà employés par votre Clan !",
									true
								);

								return;
							}

							if (clanName !== clan.name) {
								const isValidName = await checkClanNameValidity(
									clanName,
									submittedInteraction,
									this.db
								);
								if (!isValidName) {
									return;
								}

								const channel = (await guild.channels.fetch(clan.channelId)) as TextChannel;

								if (!channel)
									followUpWithErrorEmbed(interaction, "Salon du clan introuvable", true);
								await channel.setName(normalizeNames(clanName));
							}

							if (clan.shortenedName !== clanShortName) {
								const isValidShortName = await checkClanShortNameValidity(
									clanShortName,
									submittedInteraction,
									this.db
								);
								if (!isValidShortName) {
									return;
								}

								await this.imgUploader
									.editEmoji(clan.clanEmojiId, normalizeNames(clanShortName))
									.catch(() => {});
							}

							clan.name = clanName;
							clan.normalizedName = normalizeNames(clanName);
							clan.shortenedName = clanShortName;
							clan.normalizedShortName = normalizeNames(clanShortName);
							await this.db.em.persist(clan).flush();
							followUpWithSuccessEmbed(
								submittedInteraction,
								"Nom du clan changé avec succès !",
								true
							);

							await msg.edit({
								embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
								components: [buildClanManagementInfosEditButtons()],
							});
						});
						break;

					case "clanBiography":
						await i.showModal(
							buildSimpleModal(
								"clanBiographyModal",
								"Change Clan Biography",
								"Clan biography",
								"long",
								clan.clanBiography
							)
						);
						handleModal(i).then(async (submittedInteraction) => {
							if (!submittedInteraction) {
								return;
							}
							await submittedInteraction.deferUpdate();
							clan.clanBiography = submittedInteraction.fields.getTextInputValue("textInput");
							await this.db.em.persist(clan).flush();
							followUpWithSuccessEmbed(
								submittedInteraction,
								"Biographie du clan changée avec succès !",
								true
							);

							await msg.edit({
								embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
								components: [buildClanManagementInfosEditButtons()],
							});
						});
						break;

					case "clanLogo":
						await i.deferReply();
						await i.followUp({
							content:
								"Envoyez le nouveau logo du Clan dans les 60 prochaines secondes (fichiers jpg, jpeg & png uniquement)",
						});
						await handleAvatar(
							interaction,
							interaction.channel as TextChannel,
							clan,
							this.db,
							i as ButtonInteraction<CacheType>,
							this.imgUploader,
							msg
						);

						break;

					case "clanSocials":
						await i.showModal(buildClanSocialsModal(clan));
						handleModal(i).then(async (submittedInteraction) => {
							if (!submittedInteraction) {
								return;
							}
							await submittedInteraction.deferUpdate();
							const xUrl = submittedInteraction.fields.getTextInputValue("xInput");
							const instagramUrl = submittedInteraction.fields.getTextInputValue("instagramInput");
							const tiktokUrl = submittedInteraction.fields.getTextInputValue("tikTokInput");
							editClanSocials(
								submittedInteraction,
								clan,
								xUrl,
								instagramUrl,
								tiktokUrl,
								this.db
							).then(async () => {
								await msg.edit({
									embeds: [await createActiveClanInfosEmbed(interaction, clan, this.db)],
									components: [buildClanManagementInfosEditButtons()],
								});
							});
						});

						break;

					case "clanMembersSelector":
						await i.deferUpdate();
						handleMemberSelection(i as StringSelectMenuInteraction, this.db).then(
							async (targetMember) => {
								if (!targetMember) {
									followUpWithErrorEmbed(
										i as StringSelectMenuInteraction,
										"Membre du Clan introuvable !"
									);

									return;
								}
								userTarget.set(interaction.user.id, targetMember);

								await msg.edit({
									embeds: [await buildClanMemberEmbed(targetMember, client, "Gestion du membre")],
									components: [buildClanMemberManagementButtons(targetMember, clanMember, false)],
								});
							}
						);

						break;

					case "invites":
						await i.deferUpdate();
						invites = await this.db.get(ClanInvite).getAllInvites(clan.id, 1, 15);
						totalPages = Math.ceil(invites[1] / pagination);
						// eslint-disable-next-line no-case-declarations
						const componentsInv: any = [
							new ActionRowBuilder<ButtonBuilder>().addComponents([
								...buildPaginationButtons(1, totalPages, "invites"),
								buildReturnToMenuButton(),
							]),
						];
						if (invites[0].length > 0) {
							componentsInv.push(
								new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
									buildClanInvitesSelector(invites[0], guild)
								)
							);
						}
						await msg.edit({
							embeds: [await buildClanInvitesEmbed(interaction, clan, this.db, 1, totalPages)],
							components: componentsInv,
						});
						break;

					case "clanInvitesSelector":
						await i.deferUpdate();
						handleInviteSelection(i as StringSelectMenuInteraction, this.db).then(
							async (targetInvite) => {
								if (!targetInvite) {
									followUpWithErrorEmbed(
										i as StringSelectMenuInteraction,
										"Invitation de Clan introuvable !"
									);

									return;
								}
								inviteTarget.set(interaction.user.id, targetInvite);

								// findOne peut renvoyer null (l'inviteur a quitté le clan) → garde scopée au clan
								const inviterMember = await this.db
									.get(ClanMember)
									.findOne({ user: targetInvite.inviter, clan: clan.id });
								if (!inviterMember) {
									followUpWithErrorEmbed(interaction, "L'inviteur n'est plus membre de ce clan.");

									return;
								}
								await msg.edit({
									embeds: [await buildClanInviteManagementEmbed(interaction, targetInvite, client)],
									components: [buildClanInviteManagementButtons(inviterMember, clanMember)],
								});
							}
						);

						break;

					case "promoteToMember":
						await i.deferUpdate();
						if (userTarget.get(interaction.user.id)) {
							await this.db.em.refresh(userTarget.get(interaction.user.id)!);
							userTarget.get(interaction.user.id)!.role = ClanMemberRole.Member;
							await this.db.em.persist(userTarget.get(interaction.user.id)!).flush();
							await i.followUp({
								content: `L'utilisateur ${escapeMarkdown(<string>client.users.cache.get(userTarget.get(interaction.user.id)!.user.id)?.displayName)} a été promu au rang de membre.`,
								flags: MessageFlags.Ephemeral,
							});

							await msg.edit({
								embeds: [
									await buildClanMemberEmbed(
										userTarget.get(interaction.user.id)!,
										client,
										"Gestion du membre"
									),
								],
								components: [
									buildClanMemberManagementButtons(
										userTarget.get(interaction.user.id)!,
										clanMember,
										false
									),
								],
							});
							await this.logPromote(clan, userTarget.get(interaction.user.id)!, client);
						}
						break;

					case "demoteToMember":
						await i.deferUpdate();
						if (userTarget.get(interaction.user.id)) {
							await this.db.em.refresh(userTarget.get(interaction.user.id)!);
							userTarget.get(interaction.user.id)!.role = ClanMemberRole.Member;
							await this.db.em.persist(userTarget.get(interaction.user.id)!).flush();
							await i.followUp({
								content: `L'utilisateur ${escapeMarkdown(<string>client.users.cache.get(userTarget.get(interaction.user.id)!.user.id)?.displayName)} a été rétrogradé au rang de membre.`,
								flags: MessageFlags.Ephemeral,
							});

							await msg.edit({
								embeds: [
									await buildClanMemberEmbed(
										userTarget.get(interaction.user.id)!,
										client,
										"Gestion du membre"
									),
								],
								components: [
									buildClanMemberManagementButtons(
										userTarget.get(interaction.user.id)!,
										clanMember,
										false
									),
								],
							});
							await this.logDemote(clan, userTarget.get(interaction.user.id)!, client);
						}
						break;

					case "promoteToSubCaptain":
						await i.deferUpdate();
						if (userTarget.get(interaction.user.id)) {
							await this.db.em.refresh(userTarget.get(interaction.user.id)!);
							userTarget.get(interaction.user.id)!.role = ClanMemberRole.SubCaptain;
							await this.db.em.flush();
							await i.followUp({
								content: `L'utilisateur ${escapeMarkdown(<string>client.users.cache.get(userTarget.get(interaction.user.id)!.user.id)?.displayName)} a été promu au rang de vice-président.`,
								flags: MessageFlags.Ephemeral,
							});

							await msg.edit({
								embeds: [
									await buildClanMemberEmbed(
										userTarget.get(interaction.user.id)!,
										client,
										"Gestion du membre"
									),
								],
								components: [
									buildClanMemberManagementButtons(
										userTarget.get(interaction.user.id)!,
										clanMember,
										false
									),
								],
							});
							await this.logPromote(clan, userTarget.get(interaction.user.id)!, client);
						}
						break;

					case "kickMember":
						await this.db.em.refresh(userTarget.get(interaction.user.id)!);
						await this.kickMember(
							interaction,
							i as ButtonInteraction<CacheType>,
							client.users.cache.get(userTarget.get(interaction.user.id)!.user.id)!,
							clan,
							msg,
							client
						);
						break;

					case "revokeInvite":
						await i.deferUpdate();
						await handleRevokeInvite(
							interaction,
							i as ButtonInteraction<CacheType>,
							inviteTarget.get(interaction.user.id)!,
							clan,
							new HandlerDTO(this.db, client),
							msg
						);
						break;
				}
			});
		});

		msgCollector.on("end", async () => {
			if (msgCollector.endReason === "idle") {
				await msg.edit({
					embeds: [buildInfoEmbed("Limite d'inactivité : Gestion terminée.")],
					components: [],
				});
			} else {
				console.info(`Collector ended with unhandled reason: ${msgCollector.endReason}`);
			}
		});
	}

	async logPromote(clan: Clan, promotedMember: ClanMember, client: Client) {
		const logger = await resolveDependency(Logger);
		const user = await client.users.fetch(promotedMember.user.id).catch(() => null);
		const msg: BaseMessageOptions = {
			embeds: [
				await buildSimpleUserEmbed(
					user ?? promotedMember.user,
					"Promotion",
					`Promotion au rôle de ${ClanMemberRoleName[promotedMember.role]}`,
					0x57f287
				),
			],
		};

		if (promotedMember.role >= ClanMemberRole.SubCaptain) {
			msg.content = `${userMention(promotedMember.user.id)}`;
		}
		await logOnClanChannels(logger, msg, clan);
	}

	async logDemote(clan: Clan, demotedMember: ClanMember, client: Client) {
		const logger = await resolveDependency(Logger);
		const user = await client.users.fetch(demotedMember.user.id).catch(() => null);
		const msg: BaseMessageOptions = {
			embeds: [
				await buildSimpleUserEmbed(
					user ?? demotedMember.user,
					"Rétrogradation",
					`Rétrogradation au rôle de ${ClanMemberRoleName[demotedMember.role]}`,
					0xed4245
				),
			],
			content: `${userMention(demotedMember.user.id)}`,
		};

		await logOnClanChannels(logger, msg, clan);
	}

	async kickMember(
		baseInteraction: CommandInteraction,
		interaction: ButtonInteraction<CacheType>,
		user: User,
		clan: Clan,
		baseMessage: Message<boolean>,
		client: Client
	) {
		await interaction.showModal(
			buildSimpleModal(
				"kickModal",
				`Expulser ${escapeMarkdown(user.displayName)} du Clan`,
				"Raison de l'expulsion",
				"long"
			)
		);
		handleModal(interaction).then(async (submittedInteraction) => {
			if (!submittedInteraction) {
				return;
			}

			const wasDeferred = await submittedInteraction.deferReply().catch(() => {
				return false;
			});

			if (!wasDeferred) {
				return;
			}

			const reason = submittedInteraction.fields.getTextInputValue("textInput");
			const clanMember = await this.db.get(ClanMember).findOne({ user: user.id, clan: clan.id });

			kickMember(user, clan, submittedInteraction, this.db, client, clanMember, reason).then(
				async (success) => {
					if (success) {
						const logger = await resolveDependency(Logger);
						await baseMessage.edit({
							embeds: [await createActiveClanInfosEmbed(baseInteraction, clan, this.db)],
							components: [buildClanManagementMainMenuButtons()],
						});
						await logMemberDeparture(client, logger, clan, clanMember!, reason);
					}
				}
			);
		});
	}
}

async function handleModal(
	interaction:
		| ButtonInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
		| StringSelectMenuInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
		| UserSelectMenuInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
		| RoleSelectMenuInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
		| MentionableSelectMenuInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
		| ChannelSelectMenuInteraction<WrapBooleanCache<BooleanCache<CacheType>>>
) {
	return await interaction
		.awaitModalSubmit({
			filter: (i) => i.user.id === interaction.user.id,
			time: 60_000,
		})
		.catch((error) => {
			console.info(error);

			return null;
		});
}

async function handleAvatar(
	interaction: CommandInteraction,
	clanChannel: TextChannel,
	clan: Clan,
	db: Database,
	btnInteraction: ButtonInteraction<CacheType>,
	imgUploader: CustomImagesUpload,
	msg: Message<boolean>
) {
	const channelCollector = clanChannel.createMessageCollector({
		filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
		time: 60_000,
	});

	channelCollector.on("collect", async (logoMessage) => {
		// Sous-collector EventEmitter → le contexte du collector parent ne se propage
		// pas jusqu'ici → RequestContext dédié pour la transaction de changement de logo.
		await runInRequestContext(db, async () => {
			const attachment = logoMessage.attachments.first()!;
			if (!(attachment.contentType && attachment.contentType.includes("image"))) {
				await logoMessage.delete();
				await btnInteraction.followUp({
					content: "Ce logo n'est pas une image !",
					flags: MessageFlags.Ephemeral,
				});

				return;
			}
			const imgExtension = attachment.contentType.split("/")[1];
			const validExtensions = ["png", "jpg", "jpeg"];
			if (!validExtensions.includes(imgExtension)) {
				await logoMessage.delete();
				await btnInteraction.followUp({
					content: "Ce logo n'est pas un format d'image pris en charge !",
					flags: MessageFlags.Ephemeral,
				});

				return;
			}
			try {
				await db.em.transactional(async (tem) => {
					const imagesRepo = tem.getRepository(Image);
					const actualLogo = await imagesRepo.findOneOrFail({ url: clan.clanAvatarUrl });

					const newLogoResult = (await imgUploader.processAttachment(
						attachment,
						true,
						true,
						clan.normalizedShortName,
						clan.clanEmojiId
					)) as { url: string; emojiId?: string };

					if (!newLogoResult || !newLogoResult.emojiId || !newLogoResult.url)
						throw new Error("Impossible de parser cette image, veuillez réessayer");

					const newLogoUrl = newLogoResult.url;

					if (actualLogo.url === newLogoUrl) {
						await logoMessage.delete();
						await btnInteraction.followUp({
							content: "Ce logo est déjà en cours d'utilisation, veuillez réessayer !",
							flags: MessageFlags.Ephemeral,
						});
						throw new Error("Same logo uploaded"); // ensures rollback
					}

					// Delete old image remotely (non-blocking, but rollback-safe)
					await imgUploader.deleteDistantImage(actualLogo).catch((err) => {
						console.info(`Image was not found on distant server: ${err}`);
					});

					tem.remove(actualLogo);

					console.info(newLogoUrl, newLogoResult.emojiId);

					clan.clanAvatarUrl = newLogoUrl;
					clan.clanEmojiId = newLogoResult.emojiId ?? "";
					await tem.persist(clan).flush();
				});

				await logoMessage.delete().catch((err) => {
					console.info(`Bot lacks permission to delete messages: ${err}`);
				});
				await btnInteraction.deleteReply().catch((err) => {
					console.info(`Bot lacks permission to delete messages: ${err}`);
				});
				await btnInteraction.followUp({ content: `Logo changé !` });

				await msg.edit({
					embeds: [await createActiveClanInfosEmbed(interaction, clan, db)],
					components: [buildClanManagementInfosEditButtons()],
				});
				channelCollector.stop("logo-downloaded");
			} catch (error) {
				await logoMessage.delete().catch((err) => {
					console.info(`Bot lacks permission to delete messages: ${err}`);
				});
				await btnInteraction
					.followUp({
						content: "Echec du téléchargement du logo, veuillez réessayer !",
						flags: MessageFlags.Ephemeral,
					})
					.catch((err) => {
						console.info(err);
					});
				console.info(error);
				// No stop() here, collector keeps listening
			}
		});
	});

	channelCollector.on("end", async () => {
		if (channelCollector.endReason === "time" || !channelCollector.endReason) {
			await btnInteraction.deleteReply();
			await btnInteraction.followUp({ content: "Délai d'attente dépassé, veuillez réessayer" });
		}
	});
}

async function handleMemberSelection(interaction: StringSelectMenuInteraction, db: Database) {
	return db
		.get(ClanMember)
		.findOne({ user: interaction.values[0] }, { populate: ["clan", "user", "distinctions"] });
}

async function handleInviteSelection(interaction: StringSelectMenuInteraction, db: Database) {
	return db
		.get(ClanInvite)
		.findOne({ user: interaction.values[0] }, { populate: ["clan", "user"] });
}

async function handleRevokeInvite(
	baseInteraction: CommandInteraction,
	interaction: ButtonInteraction<CacheType>,
	invite: ClanInvite,
	clan: Clan,
	handler: HandlerDTO,
	baseMessage: Message<boolean>
) {
	const msg = await interaction.followUp({
		content: `Voulez-vous révoquer l'invitation envoyée à ${escapeMarkdown(invite.user.displayName)} ?`,
		flags: MessageFlags.Ephemeral,
		components: [buildConfirmCancelButtons()],
	});
	const revokeCollector = msg.createMessageComponentCollector({
		componentType: ComponentType.Button,
		filter: (i) => i.user.id === interaction.user.id,
		time: 10_000,
		max: 1,
	});

	revokeCollector.on("collect", async (btnInteraction) => {
		// Sous-collector EventEmitter → contexte non propagé → RequestContext dédié.
		await runInRequestContext(handler.db, async () => {
			if (btnInteraction.customId === "confirm") {
				await btnInteraction.deferUpdate();
				revokeInvite(invite, btnInteraction as ButtonInteraction<CacheType>, handler.db).then(
					async (success) => {
						handler.client.channels.fetch(invite.threadId).then((channel) => {
							channel?.delete();
						});
						await btnInteraction.deleteReply();
						if (success) {
							await baseMessage.edit({
								embeds: [await createActiveClanInfosEmbed(baseInteraction, clan, handler.db)],
								components: [buildClanManagementMainMenuButtons()],
							});
						}
					}
				);
			} else if (btnInteraction.customId === "cancel") {
				await btnInteraction.deferUpdate();
				await btnInteraction.deleteReply();
			}
		});
	});
}

class HandlerDTO {
	constructor(
		public db: Database,
		public client: Client
	) {}
}
