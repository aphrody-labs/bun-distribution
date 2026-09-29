import { rel } from "@mikro-orm/core";
import { InternalError } from "@rushstack/node-core-library";
import { BadRequest, NotFound, Unauthorized } from "@tsed/exceptions";
import { plainToInstance } from "class-transformer";
import type { BaseMessageOptions, GuildMember, TextChannel, User } from "discord.js";
import { Colors, escapeMarkdown, roleMention, userMention } from "discord.js";
import { Client } from "@aphrody/discordx";

import type { ClanInviteDTO } from "@/api/models/dtos";
import { coreManagerConfig, urlsConfig } from "@/configs";
import { env } from "@/env";
import { Service } from "@/decorators";
import {
	Clan,
	ClanApplication,
	ClanExperience,
	ClanInvite,
	ClanMember,
	Notification,
	User as UserEntity,
	VoteProposal,
} from "@/entities";
import type { SocialMediaDTO } from "@/utils/functions";
import {
	assignClanRoleToUser,
	buildClanMemberEmbed,
	buildErrorEmbed,
	buildSimpleUserEmbed,
	buildSuccessEmbed,
	buildUserEmbed,
	createClanFoundationEmbed,
	createInviteThread,
	disbandClan,
	hasActiveClanMembership,
	isSocialMediaUrl,
	logDemote,
	logMemberDeparture,
	logPromote,
	onMembershipChange,
	removeClanRoleFromUser,
	resolveDependency,
	SocialMedia,
	syncUser,
	turnClanMemberIntoHistory,
	validateClanMemberLimits,
} from "@/utils/functions";

import { ClanDTO } from "../api/models/dtos/clanDTO";
import type { NewClanDTO } from "../api/models/dtos/newClanDTO";
import {
	ClanMemberDistinction,
	ClanMemberRole,
	ClanState,
	LeaveReason,
	ProposalType,
	VotingStrategy,
} from "../utils/enums";
import { ClanCreationErrors } from "../utils/enums/clanCreationErrors";
import { NotificationCategory, NotificationType } from "../utils/enums/notifications";
import {
	buildConfirmCancelApplicationButtons,
	buildVoteButtons,
} from "../utils/functions/components";
import {
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanChannels,
} from "../utils/functions/messager";
import { Database } from "./Database";
import { Logger } from "./Logger";
import { NotificationService } from "./NotificationService";
import type { UserDTO } from "./UserService";

@Service()
export class ClanService {
	constructor(
		private db: Database,
		private notifications: NotificationService
	) {}

	private get client(): Client {
		const client = (globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient;
		if (!client) throw new Error("Discord client is not initialized");
		return client;
	}

	async getMember(userId: string, em?: DatabaseEntityManager) {
		const usedEm = em ?? this.db.em;

		return await usedEm.findOne(
			ClanMember,
			{ user: userId },
			{ populate: ["clan", "user"], refresh: true }
		);
	}

	async UpdateMemberRolesAndDistinctions(
		role: ClanMemberRole,
		distinctions: ClanMemberDistinction[],
		memberEntity: ClanMember
	) {
		const isPromoted = role > memberEntity.role;
		const isDemoted = role < memberEntity.role;

		memberEntity.distinctions = distinctions;
		memberEntity.role = role;

		await this.db.em.persist(memberEntity).flush();

		if (!isPromoted && !isDemoted) return;
		if (isPromoted) return await logPromote(memberEntity.clan, memberEntity, this.client);
		if (isDemoted) return await logDemote(memberEntity.clan, memberEntity, this.client);
	}

	async tryDisbandingNewCreatedClan(clan: Clan) {
		await disbandClan(clan, this.db, this.client);
	}

	async kickMember(member: ClanMember, reason: string, executor: UserDTO) {
		const logger = await resolveDependency(Logger);
		await removeClanRoleFromUser(this.client, member, member.clan);
		await turnClanMemberIntoHistory(member, this.db, LeaveReason.Kick, reason);
		await logOnAchilleaSpecificClanChannel(
			logger,
			{
				embeds: [
					buildSuccessEmbed(
						`L'utilisateur ${escapeMarkdown(member.user.displayName)} a été expulsé par ${escapeMarkdown(executor.username)} !`
					),
				],
			},
			member.clan.channelId
		);
		await logMemberDeparture(this.client, logger, member.clan, member, reason);

		const kickNotif = new Notification();
		kickNotif.title = "Expulsion";
		kickNotif.message = `L'utilisateur ${escapeMarkdown(member.user.displayName)} a été expulsé par ${escapeMarkdown(executor.username)} !`;
		kickNotif.type = NotificationType.CLAN_MEMBER_KICK;
		kickNotif.category = NotificationCategory.CLAN;
		kickNotif.payload = {
			targetId: member.user.id,
			targetName: member.user.displayName,
			clanId: member.clan.id,
			clanName: member.clan.name,
			executorId: executor.id,
			executorName: executor.username,
		};

		await this.db.em.persist(kickNotif).flush();

		await this.notifications.sendClanNotification(member.clan, kickNotif);

		await onMembershipChange(member.clan, this.db, logger);
	}

	async getNewlyCreatedClanIfExists(newClanDto: NewClanDTO, userId: string) {
		const clan = await this.db.em.findOne(Clan, {
			name: newClanDto.name,
			shortenedName: newClanDto.shortName,
			normalizedShortName: newClanDto.normalizedShortName,
			clanBiography: newClanDto.description,
		});
		if (!clan) return null;
		const cpt = await this.db.get(Clan).getCaptain(clan);
		if (!cpt) return null;
		if (cpt.user.id !== userId) return null;

		return clan;
	}

	async getClans(
		page: number,
		pageSize: number,
		state: ClanState = ClanState.Approved
	): Promise<[ClanDTO[], number]> {
		const [clans, total] = await this.db.em.getRepository(Clan).getAllClans(page, pageSize, state);

		const dtos = await Promise.all(clans.map(async (clan) => this.toDTO(clan)));

		return [dtos, total];
	}

	async findById(id: number): Promise<ClanDTO> {
		const clan = await this.db.em.getRepository(Clan).findOne({ id });
		if (!clan) {
			throw new NotFound("Clan not found");
		}

		return this.toDTO(clan);
	}

	async toDTO(clan: Clan) {
		const dto = plainToInstance(ClanDTO, clan);
		const cap = await this.db.em.getRepository(Clan).getCaptain(clan);
		if (!cap) {
			throw new NotFound(`Captain not found for clan ${clan.id}`);
		}
		const clanXp = await this.db.em.findOne(ClanExperience, { clan });
		dto.experience = {
			currentLevel: clanXp?.currentLevel ?? 100,
			totalXp: clanXp?.totalXp ?? 100000,
		};
		dto.president = cap.user;
		dto.membersCount = await this.db.em.count(ClanMember, { clan: clan.id });

		return dto;
	}

	private async validateWithUnifiedApi(path: string, value: string) {
		const response = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/clans/validate/${path}`, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...(env.API_ADMIN_TOKEN ? { authorization: `Bearer ${env.API_ADMIN_TOKEN}` } : {}),
			},
			body: JSON.stringify(path === "name" ? { name: value } : { shortName: value }),
		});
		if (!response.ok) throw new Error(`Unified clan validation failed (${response.status})`);
		const result = await response.json() as { valid: boolean; code?: string };
		if (result.valid) return true;
		switch (result.code) {
			case "NAME_TAKEN": return ClanCreationErrors.NAME_TAKEN;
			case "INVALID_SHORTNAME": return ClanCreationErrors.INVALID_SHORTNAME;
			case "SHORTNAME_TAKEN": return ClanCreationErrors.SHORTNAME_TAKEN;
			default: return ClanCreationErrors.INVALID_NAME;
		}
	}

	async validateName(name: string) {
		return this.validateWithUnifiedApi("name", name);
	}

	async validateShortName(shortName: string) {
		return this.validateWithUnifiedApi("short-name", shortName);
	}

	/** Discord-only side effect kept at the bot boundary after API persistence. */
	async renameClanRole(roleId: string, clanId: number, name: string) {
		try {
			const achillea = await this.client.guilds.fetch(coreManagerConfig.coreGuildId);
			const role = await achillea.roles.fetch(roleId);
			await role?.setName(name, "Renommage du Clan (dashboard)");
		} catch (error) {
			console.error(`[ClanService] Échec du renommage du rôle Discord pour le clan ${clanId}:`, error);
		}
	}

	/**
	 * MàJ des infos éditables depuis l'onglet "Infos" du dashboard de clan (logo, nom, tag,
	 * bio, réseaux, recrutement). Permissions vérifiées côté controller (Président du clan
	 * ou admin site) — ce service ne fait que valider/persister les champs fournis.
	 */
	async validateFounders(founders: User[]) {
		const foundersIds = founders.map((founder) => founder.id);
		if (foundersIds.length !== 5) {
			return ClanCreationErrors.WRONG_FOUNDERS_NUMBER;
		}
		if (new Set(foundersIds).size !== foundersIds.length) {
			return ClanCreationErrors.DUPLICATE_FOUNDERS;
		}

		const clanMembersRepo = this.db.get(ClanMember);

		for (const member of founders) {
			await syncUser(member);
			const clanMember = await clanMembersRepo.findOne({ user: member.id });
			if (clanMember) {
				return ClanCreationErrors.FOUNDER_IN_CLAN;
			}
		}

		return true;
	}

	async validateSocials(socialUrls: string[]) {
		const socials = await Promise.all(
			socialUrls.map(async (url: string) => await isSocialMediaUrl(url))
		);

		return socials.filter((social) => social !== null);
	}

	async createAndSetupClanRole(name: string, presidentId: string, founders: GuildMember[]) {
		const achillea = await this.client.guilds.fetch(coreManagerConfig.coreGuildId);
		const newClanRole = await achillea.roles.create({
			name,
			mentionable: true,
			reason: `Rôle automatique suite à la création du Clan ${name}`,
		});

		const captainAsGuildMember = await achillea.members.fetch(presidentId);
		await captainAsGuildMember.roles.add(newClanRole, `Captain of the Clan ${name}`);
		founders.forEach((member) => member.roles.add(newClanRole, `Founder of the Clan ${name}`));

		return newClanRole;
	}

	async getAchillea() {
		return await this.client.guilds.fetch(coreManagerConfig.coreGuildId);
	}

	async createClan(
		dto: NewClanDTO,
		foundersIds: string[],
		validatedSocials: SocialMediaDTO[],
		clanChannelId: string,
		newRoleId: string,
		emojiId: string,
		presidentId: string
	) {
		try {
			const newClan = new Clan(
				foundersIds,
				dto.name,
				dto.shortName,
				dto.logo,
				dto.description,
				validatedSocials[0].platform,
				validatedSocials[0].canonicalUrl,
				clanChannelId,
				newRoleId
			);
			for (const social of validatedSocials.slice(1)) {
				switch (social.platform) {
					case SocialMedia.X:
						newClan.xUrl = social.canonicalUrl;
						break;

					case SocialMedia.Instagram:
						newClan.instagramUrl = social.canonicalUrl;
						break;

					case SocialMedia.TikTok:
						newClan.tiktokUrl = social.canonicalUrl;
						break;
				}
			}
			newClan.clanEmojiId = emojiId;
			newClan.origin = dto.origin?.code ?? "";
			newClan.languages = dto.languages?.map((lang) => lang.code) ?? [];

			await this.db.em.persist(newClan).flush();

			const founder = await this.db
				.get(ClanMember)
				.createMember(newClan.id, presidentId, ClanMemberRole.Captain, [
					ClanMemberDistinction.Staff,
				]);
			await this.db.em.persist(founder).flush();

			return { success: true, error: null, clan: newClan };
		} catch (err) {
			return { success: false, error: err, clan: null };
		}
	}

	async initFoundingVoteProcedure(foundersIds: string[], newClan: Clan, president: UserDTO) {
		const voters = await this.db.em.find(UserEntity, foundersIds);

		const voteProposal = new VoteProposal();
		voteProposal.type = ProposalType.CLAN_CREATION;
		voteProposal.strategy = VotingStrategy.MAJORITY;
		voteProposal.reason = `Proposition de création du Clan ${newClan.name} par ${escapeMarkdown(president.username)}`;
		voteProposal.eligibleVoters.set(voters);
		voteProposal.targetEntityType = "Clan";
		voteProposal.targetEntityId = newClan.id;
		voteProposal.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

		await this.db.em.persist(voteProposal).flush();

		const mentionsString = foundersIds.map((id) => userMention(id));

		const voteMsg: BaseMessageOptions = {
			content: `${mentionsString.join(", ")}\n${userMention(president.id)} souhaite fonder le clan ${newClan.name} avec vous ! Acceptez-vous ?`,
			embeds: [
				createClanFoundationEmbed(
					newClan,
					[president.id, ...foundersIds],
					voteProposal.votes.length
				) as any,
			],
			components: [buildVoteButtons(voteProposal.id.toString())],
		};

		const logger = await resolveDependency(Logger);
		await logOnAchilleaSpecificClanChannel(logger, voteMsg, newClan.channelId);
	}

	async verifyClanMemberManagementPermissions(executor: UserDTO, targetId: string) {
		const executorAsMember = await this.getMember(executor.id);
		if (!executorAsMember) {
			return {
				success: false,
				status: 403,
				error: "Vous n’êtes pas dans un Clan.",
			};
		}

		const targetAsMember = await this.getMember(targetId);
		if (!targetAsMember) {
			return {
				success: false,
				status: 404,
				error: "Impossible de trouver le Membre ciblé.",
			};
		}

		if (executorAsMember.clan.id !== targetAsMember.clan.id) {
			return {
				success: false,
				status: 401,
				error: "Vous ne pouvez pas gérer les Membres d'autres Clans.",
			};
		}

		if (
			executorAsMember.role < ClanMemberRole.SubCaptain ||
			(executorAsMember.role <= targetAsMember.role &&
				executorAsMember.role !== ClanMemberRole.Captain)
		) {
			return {
				success: false,
				status: 403,
				error: "Vous n’avez pas les permissions pour modifier ce membre.",
			};
		}

		// ✅ Success case — return both members for later use
		return { success: true, executorAsMember, targetAsMember };
	}

	async revokeInvite(invite: ClanInviteDTO) {
		const clanInvite = await this.db.em.findOne(ClanInvite, { id: invite.id }, { refresh: true });
		if (!clanInvite) {
			throw new BadRequest("Cette invitation n'existe pas. Essayez de synchroniser les données !");
		}

		try {
			await this.db.em.remove(clanInvite).flush();
		} catch {
			throw new InternalError("Impossible de supprimer cette invitation.");
		}

		try {
			if (invite.threadId) {
				this.client.channels.fetch(invite.threadId).then((channel) => {
					channel?.delete();
				});
			}
		} catch {
			throw new NotFound("Impossible de supprimer le thread discord lié à cette invitation");
		}
	}

	async sendInviteNotification(invite: ClanInviteDTO) {
		const clanInvite = await this.db.em.findOne(ClanInvite, { id: invite.id }, { refresh: true });
		if (!clanInvite) {
			throw new BadRequest("Cette invitation n'existe pas. Essayez de synchroniser les données !");
		}
		if ((Date.now() - clanInvite.lastNotifiedAt.getTime()) / (1000 * 60 * 60) < 12) {
			throw new BadRequest(
				"Vous avez notifié cet utilisateur trop récemment, veuillez patienter !"
			);
		}
		try {
			if (clanInvite.threadId) {
				const logger = await resolveDependency(Logger);

				return await logger.discordChannel(
					clanInvite.threadId,
					`${userMention(clanInvite.user.id)}, vous avez une invitation sans réponse de la part de ${userMention(clanInvite.inviter.id)} !`
				);
			}

			throw new Error("Le salon discord pour cette invitation est introuvable !");
		} catch (err: any) {
			console.info("Tried to notify an invite but failed", err);

			throw new NotFound(err.message);
		}
	}

	async inviteUser(
		userId: string,
		clanId: number,
		distinctions: ClanMemberDistinction[],
		inviter: UserDTO
	) {
		await this.db.em.transactional(async (em) => {
			const clan = await em.findOne(Clan, { id: clanId });
			if (!clan) {
				throw new BadRequest("Vous devez être dans un Clan pour effectuer cette action !");
			}
			const user = await em.findOne(UserEntity, { id: userId });
			if (!user) {
				throw new NotFound("L'Utilisateur ciblé est introuvable.");
			}
			// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
			const userInActiveClan = await hasActiveClanMembership(userId, em);
			if (userInActiveClan) {
				throw new BadRequest("L'Utilisateur ciblé fait déjà partie d'un Clan.");
			}
			const alreadyInvited = await em.findOne(
				ClanInvite,
				{ user: userId, clan },
				{ refresh: true }
			);
			if (alreadyInvited) {
				throw new BadRequest(
					"L'utilisateur ciblé a déjà une invitation en attente de votre part !"
				);
			}

			await validateClanMemberLimits(clan, em, distinctions);

			const invite = new ClanInvite();
			invite.user = user;
			invite.inviter = rel(UserEntity, inviter.id);
			invite.clan = clan;
			invite.distinctions = distinctions;

			await createInviteThread(this.client, user, invite, em, inviter);
		});
	}

	async rejectApplication(applicationId: number, executor: ClanMember) {
		const application = await this.db.em.findOne(
			ClanApplication,
			{ id: applicationId },
			{ populate: ["user"] }
		);
		if (!application) {
			throw new NotFound("Candidature introuvable.");
		}

		if (application.clan.id !== executor.clan.id) {
			throw new Unauthorized("Vous ne pouvez pas gérer les candidatures des autres Clans.");
		}

		await this.db.em.getRepository(ClanApplication).nativeDelete(application);

		const logger = await resolveDependency(Logger);
		if (application.messageId) {
			try {
				const clanChannel = (await this.client.channels.fetch(
					application.clan.channelId
				)) as TextChannel;
				const applicationMessage = await clanChannel.messages.fetch(application.messageId);

				await applicationMessage.edit({
					content: "",
					embeds: [
						await buildUserEmbed(application.user, this.client, "Candidature rejetée", Colors.Red),
					],
					components: [],
				});
			} catch (err) {
				logger.log(
					`[ClanService] Maj du message de candidature rejetée impossible (${application.messageId}): ${err instanceof Error ? err.message : String(err)}`,
					"warn",
					false
				);
			}
		}

		await logOnClanChannels(
			logger,
			{
				embeds: [
					buildErrorEmbed(
						`La candidature de l'utilisateur ${escapeMarkdown(application.user.displayName)} a été refusée par ${escapeMarkdown(executor.user.displayName)}`
					),
				],
			},
			executor.clan
		);
	}

	async acceptApplication(applicationId: number, executor?: ClanMember) {
		const [newMember, application] = await this.db.em.transactional(async (em) => {
			const application = await em.findOne(ClanApplication, {
				id: applicationId,
			});
			if (!application) {
				throw new NotFound("Candidature introuvable.");
			}

			if (executor && application.clan.id !== executor.clan.id) {
				throw new Unauthorized("Vous ne pouvez pas gérer les candidatures des autres Clans.");
			}

			// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
			const isInActiveClan = await hasActiveClanMembership(application.user.id, em);
			if (isInActiveClan) {
				throw new BadRequest("Cet Utilisateur fait déjà partie d'un Clan");
			}

			const applications = await em.find(ClanApplication, {
				user: application.user,
			});

			applications.forEach((a) => em.remove(a));

			const newMember = new ClanMember(
				application.clan.id,
				application.user.id,
				ClanMemberRole.Trial,
				application.distinctions
			);

			em.persist(newMember);

			return [newMember, application];
		});

		await this.db.em.populate(newMember, ["user", "clan.guild"]);

		await assignClanRoleToUser(this.client, newMember, newMember.clan);

		const user = await this.client.users.fetch(newMember.user.id);

		const msg: BaseMessageOptions = {
			embeds: [await buildClanMemberEmbed(newMember, this.client, "Nouveau membre")],
		};

		const logger = await resolveDependency(Logger);
		if (application.messageId) {
			try {
				const clanChannel = (await this.client.channels.fetch(
					application.clan.channelId
				)) as TextChannel;
				const applicationMessage = await clanChannel.messages.fetch(application.messageId);

				await applicationMessage.edit({
					content: "",
					embeds: [
						await buildUserEmbed(
							application.user,
							this.client,
							"Candidature acceptée",
							Colors.Green
						),
					],
					components: [],
				});
			} catch (err) {
				logger.log(
					`[ClanService] Maj du message de candidature acceptée impossible (${application.messageId}): ${err instanceof Error ? err.message : String(err)}`,
					"warn",
					false
				);
			}
		}

		if (executor)
			await logOnClanChannels(
				logger,
				{
					embeds: [
						buildSuccessEmbed(
							`La candidature de l'utilisateur ${escapeMarkdown(application.user.displayName)} a été acceptée par ${escapeMarkdown(executor.user.displayName)}`
						),
					],
				},
				executor.clan
			);
		await logOnClanChannels(logger, msg, newMember.clan);

		await logOnAchilleaGenericClanChannel(logger, {
			embeds: [
				await buildSimpleUserEmbed(
					user,
					"Nouveau membre",
					`${user.displayName} a rejoint ${newMember.clan.name} !`,
					0x57f287
				),
			],
		});

		return true;
	}

	async applyToClan(userId: string, clanId: number, distinctions: ClanMemberDistinction[]) {
		const newApplication = await this.db.em.transactional(async (em) => {
			const clan = await em.findOne(Clan, { id: clanId });
			if (!clan) {
				throw new NotFound("Clan introuvable.");
			}
			// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
			const userInActiveClan = await hasActiveClanMembership(userId, em);
			if (userInActiveClan) {
				throw new BadRequest("Vous faites déjà partie d'un Clan.");
			}
			const alreadyApplied = await em.findOne(
				ClanApplication,
				{ user: userId, clan },
				{ refresh: true }
			);
			if (alreadyApplied) {
				throw new BadRequest("Vous avez déjà soumis votre candidature auprès de ce Clan.");
			}

			await validateClanMemberLimits(clan, em, distinctions);

			const application = new ClanApplication();
			application.user = rel(UserEntity, userId);
			application.clan = clan;
			application.distinctions = distinctions;

			em.persist(application);

			return application;
		});

		if (newApplication.clan.autoAcceptMembers)
			return await this.acceptApplication(newApplication.id);

		await this.db.em.populate(newApplication, ["user", "clan"]);

		const logger = await resolveDependency(Logger);

		const msg: BaseMessageOptions = {
			content: `${roleMention(newApplication.clan.roleId)} Cet utilisateur postule en tant que **${distinctions.join(", ")}**`,
			embeds: [await buildUserEmbed(newApplication.user, this.client, "Candidature", Colors.Blue)],
			components: [buildConfirmCancelApplicationButtons(newApplication.id.toString())],
		};
		const sentMsg = await logOnAchilleaSpecificClanChannel(
			logger,
			msg,
			newApplication.clan.channelId
		);
		if (sentMsg) newApplication.messageId = sentMsg.id;
		await this.db.em.persist(newApplication).flush();

		return false;
	}
}
