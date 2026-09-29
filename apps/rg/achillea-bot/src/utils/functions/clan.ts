import { rel } from "@mikro-orm/core";
import { normalizeNames } from "@rosegriffon/achillea-core";
import type {
	BaseMessageOptions,
	ButtonInteraction,
	CacheType,
	CommandInteraction,
	ForumChannel,
	ModalSubmitInteraction,
	User as DiscordUser,
} from "discord.js";
import { escapeMarkdown, userMention } from "discord.js";
import type { Client } from "@aphrody/discordx";
import GraphemeSplitter from "grapheme-splitter";

import { coreManagerConfig } from "@/configs";
import {
	Clan,
	ClanInvite,
	ClanMember,
	ClanMemberHistory,
	ClanTeamMember,
	Image,
	Interclan,
	User,
	User as UserEntity,
} from "@/entities";
import type { CustomImagesUpload, Database, UserDTO } from "@/services";
import { Logger } from "../../services/Logger";

import { scheduleClanCheck } from "../../queues/clan.queues";
import {
	ClanMemberDistinction,
	ClanMemberRole,
	ClanMemberRoleName,
	InterclanState,
	LeaveReason,
} from "../enums";
import { buildConfirmCancelInviteButtons } from "./components";
import { checkClanMemberLimitExceeded, getClanMemberLimits } from "./clanLimits";
import { resolveDependency } from "./dependency";
import {
	buildClanDisbandEmbed,
	buildInfoEmbed,
	buildMemberLeftEmbed,
	buildSimpleUserEmbed,
	buildWarningEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	interclanLineupRemovalEmbed,
} from "./embeds";
import {
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanChannels,
	logOnClanGuildChannel,
} from "./messager";

export enum SocialMedia {
	X,
	Instagram,
	TikTok,
	Twitch,
	Youtube,
}

export type SocialMediaDTO = {
	platform: SocialMedia;
	username: string;
	canonicalUrl: string;
};

export function parseSocialMediaUrl(url: string): SocialMediaDTO | null {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace("www.", "");
		const pathParts = parsed.pathname.split("/").filter(Boolean); // removes empty strings

		if (pathParts.length < 1) return null;

		let username = pathParts[0];
		let platform: SocialMedia | null = null;
		let canonicalUrl: string;

		if (host === "instagram.com") {
			platform = SocialMedia.Instagram;
			canonicalUrl = `https://instagram.com/${username}`;
		} else if (host === "tiktok.com") {
			platform = SocialMedia.TikTok;
			username = username.replace(/^@/, "");
			canonicalUrl = `https://tiktok.com/@${username}`;
		} else if (host === "x.com" || host === "twitter.com") {
			platform = SocialMedia.X;
			canonicalUrl = `https://x.com/${username}`;
		} else if (host === "twitch.com") {
			platform = SocialMedia.Twitch;
			canonicalUrl = `https://twitch.com/${username}`;
		} else if (host === "youtube.com") {
			platform = SocialMedia.Youtube;
			canonicalUrl = `https://youtube.com/${username}`;
		} else {
			return null;
		}

		if (!/^[\w.-]{1,30}$/.test(username)) return null;

		return { platform, username, canonicalUrl };
	} catch {
		return null;
	}
}

export async function isSocialMediaUrl(url: string) {
	if (!url || url.trim() === "") return null;
	const socialDTO = parseSocialMediaUrl(url);
	if (!socialDTO) return null;

	return socialDTO;
}

export async function emptyClan(clan: Clan, db: Database) {
	const clanMembers = await db.get(ClanMember).getAllMembers(clan.id);
	await db.em.remove(clanMembers[0]).flush();
}

export async function deleteClan(
	clan: Clan,
	db: Database,
	imgUploader: CustomImagesUpload,
	client: Client
) {
	await achilleaRolesAndChannelsDeletionOnClanDisbandOrDeletion(client, clan, db);
	await emptyClan(clan, db);
	await deleteDistantImage(db, imgUploader, clan);
	await imgUploader.deleteEmoji(clan.clanEmojiId);
	await db.em.remove(clan).flush();
}

export async function deleteDistantImage(
	db: Database,
	imgUploader: CustomImagesUpload,
	clan: Clan
) {
	const logo = await db.get(Image).findOne({ url: clan.clanAvatarUrl });
	if (logo) {
		await imgUploader.deleteDistantImage(logo);
		await db.em.remove(logo).flush();
	}
}

export async function disbandClan(clan: Clan, db: Database, client: Client, job: boolean = false) {
	await achilleaRolesAndChannelsDeletionOnClanDisbandOrDeletion(client, clan, db);
	await emptyClan(clan, db);
	clan.isDisbanded = true;
	await db.em.persist(clan).flush();

	if (job) {
		const logger = await resolveDependency(Logger);
		await logOnClanGuildChannel(
			logger,
			{
				embeds: [
					buildInfoEmbed(
						`Votre Clan a été dissout car il ne respectait plus le minimum de membres requis ! Merci d'avoir contribué à la communauté et au plaisir de vous revoir.`
					),
				],
			},
			clan.guild
		);

		await logOnAchilleaGenericClanChannel(logger, { embeds: [await buildClanDisbandEmbed(clan)] });
	}
}

export async function achilleaRolesAndChannelsDeletionOnClanDisbandOrDeletion(
	client: Client,
	clan: Clan,
	db: Database
) {
	try {
		const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);

		await Promise.all([
			guild.channels.delete(clan.channelId, `Clan ${clan.name} deleted or disbanded`),
			guild.roles.delete(clan.roleId, `Clan ${clan.name} deleted or disbanded`),
		]);

		const captain = await db.get(Clan).getCaptain(clan);
		const captainAsGuildMember = await guild.members.fetch(captain!.user.id);
		await captainAsGuildMember.roles.remove(
			coreManagerConfig.captainRoleId,
			`Clan ${clan.name} deleted or disbanded`
		);
	} catch (error) {
		console.error("Error while cleaning up clan:", error);
	}
}

export async function editClanSocials(
	modalInteraction: ModalSubmitInteraction,
	clan: Clan,
	xurl: string,
	instagramUrl: string,
	tiktokUrl: string,
	db: Database
) {
	if (!clan) {
		await modalInteraction.followUp({ content: "Clan not found !" });

		return;
	}
	if (!xurl && !instagramUrl && !tiktokUrl) {
		await modalInteraction.followUp({
			content: "You need to provide at least one social media link !",
		});

		return;
	}
	const xSocialDTO = await isSocialMediaUrl(xurl);
	const instagramSocialDTO = await isSocialMediaUrl(instagramUrl);
	const tiktokSocialDTO = await isSocialMediaUrl(tiktokUrl);
	if (xurl === "" || xSocialDTO?.platform === SocialMedia.X) {
		clan.xUrl = xurl;
	} else {
		await modalInteraction.followUp({ content: "Invalid X link provided !" });

		return;
	}
	if (instagramUrl === "" || instagramSocialDTO?.platform === SocialMedia.Instagram) {
		clan.instagramUrl = instagramUrl;
	} else {
		await modalInteraction.followUp({ content: "Invalid Instagram link provided !" });

		return;
	}
	if (tiktokUrl === "" || tiktokSocialDTO?.platform === SocialMedia.TikTok) {
		clan.tiktokUrl = tiktokUrl;
	} else {
		await modalInteraction.followUp({ content: "Invalid TikTok link provided !" });

		return;
	}
	if (!clan.xUrl && !clan.instagramUrl && !clan.tiktokUrl) {
		await modalInteraction.followUp({
			content: "You need to provide at least one social media link !",
		});

		return;
	}
	await db.em.persist(clan).flush();
	followUpWithSuccessEmbed(modalInteraction, "Clan socials changed successfully !", true);
}

export { normalizeNames };
export async function checkClanShortNameValidity(
	clanShortName: string,
	interaction: ModalSubmitInteraction,
	db: Database
) {
	// Checks for clan short name
	const splitter = new GraphemeSplitter();
	const count = splitter.countGraphemes(clanShortName);
	const normalizedShortName = normalizeNames(clanShortName);
	if (count < 2 || count > 3 || !normalizedShortName) {
		followUpWithErrorEmbed(
			interaction,
			"Invalid Clan short name, only letters, numbers and supported styled writings are allowed !",
			true
		);

		return false;
	}
	const clanExists = await db.get(Clan).findOne({ normalizedShortName });
	if (clanExists) {
		followUpWithErrorEmbed(interaction, "Clan short name is already taken !", true);

		return false;
	}

	return true;
}

export async function checkClanNameValidity(
	clanName: string,
	interaction: ModalSubmitInteraction,
	db: Database
) {
	// Checks for clan name
	const splitter = new GraphemeSplitter();
	const count = splitter.countGraphemes(clanName);
	const normalizedName = normalizeNames(clanName);
	if (count < 3 || count > 30 || !normalizedName) {
		followUpWithErrorEmbed(interaction, "Invalid Clan name !", true);

		return false;
	}
	const clanExists = await db.get(Clan).findOne({ name: clanName });
	if (clanExists) {
		followUpWithErrorEmbed(interaction, "Clan name is already taken !", true);

		return false;
	}

	return true;
}

export async function kickMember(
	targetUser: DiscordUser,
	clan: Clan,
	interaction: ModalSubmitInteraction<CacheType>,
	db: Database,
	client: Client,
	clanMember: ClanMember | null,
	reason: string
) {
	if (!clanMember) {
		followUpWithErrorEmbed(
			interaction,
			`Target user ${escapeMarkdown(targetUser.displayName)} is not a member of this clan !`,
			true
		);

		return false;
	}
	const logger = await resolveDependency(Logger);
	await removeClanRoleFromUser(client, clanMember, clan);
	await turnClanMemberIntoHistory(clanMember, db, LeaveReason.Kick, reason);
	await onMembershipChange(clan, db, logger);

	followUpWithSuccessEmbed(
		interaction,
		`User ${escapeMarkdown(targetUser.displayName)} kicked from clan by ${escapeMarkdown(interaction.user.displayName)} !`
	);

	return true;
}

export async function revokeInvite(
	targetInvite: ClanInvite,
	btnInteraction: ButtonInteraction<CacheType>,
	db: Database
) {
	const clanInvite = await db.get(ClanInvite).findOne({ id: targetInvite.id });
	if (!clanInvite) {
		followUpWithErrorEmbed(btnInteraction, "Target invite does not exist!", true);

		return false;
	}

	await db.em.remove(clanInvite).flush();

	followUpWithSuccessEmbed(btnInteraction, "Invite successfully revoked !", true);

	return clanInvite.threadId;
}

export async function leaveClan(
	db: Database,
	clanMember: ClanMember,
	clan: Clan,
	client: Client,
	logger: Logger
) {
	await isMemberInALockedInterclan(logger, db, clanMember);
	await leaveTeam(db, clanMember, clan, logger);
	await removeClanRoleFromUser(client, clanMember, clan);
	await turnClanMemberIntoHistory(clanMember, db, LeaveReason.Leave);
	await onMembershipChange(clan, db, logger);
}

export async function turnClanMemberIntoHistory(
	clanMember: ClanMember,
	db: Database,
	leaveReason: LeaveReason,
	kickReason?: string
) {
	const clanMemberHistory = new ClanMemberHistory();
	clanMemberHistory.user = clanMember.user;
	clanMemberHistory.clan = clanMember.clan;
	clanMemberHistory.role = clanMember.role;
	clanMemberHistory.joinDate = clanMember.createdAt;
	clanMemberHistory.leaveReason = leaveReason;
	clanMemberHistory.clanFameContributed = clanMember.clanFameContributed;
	if (kickReason) {
		clanMemberHistory.kickReason = kickReason;
	}
	db.em.persist(clanMemberHistory);
	await db.em.remove(clanMember).flush();

	return clanMemberHistory;
}

export async function removeClanRoleFromUser(client: Client, clanMember: ClanMember, clan: Clan) {
	try {
		const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
		const member = await achillea.members.fetch(clanMember.user.id);
		await member.roles.remove(clan.roleId);
	} catch {
		console.info(
			`Unable to find or remove role from user: ${clanMember.user.displayName}, skipping`
		);
	}
}

export async function assignClanRoleToUser(client: Client, clanMember: ClanMember, clan: Clan) {
	const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
	const member = await achillea.members.fetch(clanMember.user.id);
	await member.roles.add(clan.roleId);
}

export async function logMemberDeparture(
	client: Client,
	logger: Logger,
	clan: Clan,
	clanMember: ClanMember,
	reason?: string
) {
	const memberAsDiscordUser = await client.users.fetch(clanMember.user.id).catch(() => null);

	const msg: BaseMessageOptions = {
		embeds: [
			await buildMemberLeftEmbed(clanMember, client, reason ? "Expulsion" : "Départ", reason),
		],
	};

	await logOnClanGuildChannel(logger, msg, clan.guild);

	await logOnAchilleaSpecificClanChannel(logger, msg, clan.channelId);

	await logOnAchilleaGenericClanChannel(logger, {
		embeds: [
			await buildSimpleUserEmbed(
				memberAsDiscordUser ?? clanMember.user,
				reason ? "Expulsion" : "Départ",
				reason
					? `${memberAsDiscordUser?.displayName ?? clanMember.user.displayName} a été exclu du Clan ${clan.name}\n\n**Raison :** ${reason}`
					: `${memberAsDiscordUser?.displayName ?? clanMember.user.displayName} a quitté le Clan ${clan.name}`,
				0xed4245
			),
		],
	});
}

export async function inviteToClan(
	db: Database,
	client: Client,
	interaction: CommandInteraction | ButtonInteraction,
	targetUser: DiscordUser,
	clan: Clan,
	distinctions: ClanMemberDistinction[]
) {
	await validateClanMemberLimits(clan, db.em, distinctions);

	// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
	const targetInActiveClan = await hasActiveClanMembership(targetUser.id, db.em);

	if (targetInActiveClan) {
		followUpWithErrorEmbed(interaction, "L'utilisateur ciblé est déjà dans un Clan !", true);

		return;
	}

	const clanInvitesRepo = db.get(ClanInvite);
	const alreadyInvited = await clanInvitesRepo.findOne({ user: targetUser.id, clan });

	if (alreadyInvited) {
		followUpWithErrorEmbed(
			interaction,
			"L'utilisateur ciblé a déjà une invitation en attente de votre part !",
			true
		);

		return;
	}

	const invite = new ClanInvite();
	invite.user = rel(UserEntity, targetUser.id);
	invite.inviter = rel(User, interaction.user.id);
	invite.clan = clan;
	invite.distinctions = distinctions;

	await createInviteThread(client, targetUser, invite, db.em, interaction.user);

	followUpWithSuccessEmbed(
		interaction,
		`${escapeMarkdown(targetUser.displayName)} a été invité à rejoindre le Clan !`,
		true
	);
}

export async function createInviteThread(
	client: Client,
	targetUser: DiscordUser | UserEntity | UserDTO,
	invite: ClanInvite,
	em: DatabaseEntityManager,
	inviter: DiscordUser | UserEntity | UserDTO
) {
	const forumChannel = (await client.channels.fetch(
		coreManagerConfig.clanInvitesForumId
	)) as ForumChannel;

	// Create the post (thread)
	const thread = await forumChannel.threads.create({
		name: targetUser.username,
		message: { content: "En cours de traitement..." },
	});

	invite.threadId = thread.id;

	await em.persist(invite).flush();

	const msg = {
		content: `${userMention(targetUser.id)}, vous avez été invité à rejoindre le Clan ${invite.clan.name} par ${userMention(inviter.id)} en qualité de **${invite.distinctions.join(", ")}**`,
		// @ts-ignore
		components: [buildConfirmCancelInviteButtons(invite.id)],
	};

	const threadMsg = await thread.fetchStarterMessage();
	await threadMsg?.edit(msg);
}

async function isMemberInALockedInterclan(logger: Logger, db: Database, clanMember: ClanMember) {
	const finishedStates = [InterclanState.RESULT_OK, InterclanState.CANCELED, InterclanState.DENIED];
	const removalSummary: string[] = [];

	await db.em.transactional(async (tem) => {
		// 🛑 1. Check interclan participation locks
		const activeInterclans = await db.em.find(
			Interclan,
			{
				state: { $nin: finishedStates },
				$or: [{ clanA: clanMember.clan.id }, { clanB: clanMember.clan.id }],
			},
			{ populate: ["lineups.clan", "lineups.members.user"] }
		);

		for (const interclan of activeInterclans) {
			let removedCount = 0;
			// find any lineup (of either clan) where this user appears
			for (const lineup of interclan.lineups.getItems()) {
				const containsUser = lineup.members
					.getItems()
					.some((m) => m.user.id === clanMember.user.id);
				if (!containsUser) continue;
				if (finishedStates.includes(interclan.state)) continue;

				if (lineup.lockedIn) {
					throw new Error(
						`Impossible de quitter le clan : le joueur est dans une lineup verrouillée (interclan "${interclan.name}").`
					);
				}

				// If not blocking, remove the user from this lineup (only if still relevant)
				const toRemove = lineup.members.getItems().filter((m) => m.user.id === clanMember.user.id);
				if (toRemove.length) {
					lineup.members.remove(toRemove);
					tem.persist(lineup);
					removedCount++;
				}
			}

			if (removedCount !== 0) removalSummary.push(interclan.name);
		}

		if (removalSummary.length > 0) {
			const embed = interclanLineupRemovalEmbed(clanMember, removalSummary);

			await logOnAchilleaSpecificClanChannel(
				logger,
				{ embeds: [embed] },
				clanMember.clan.channelId
			);
		}
	});
}

async function leaveTeam(db: Database, clanMember: ClanMember, clan: Clan, logger: Logger) {
	const teamMember = await db.em.findOne(
		ClanTeamMember,
		{ member: clanMember },
		{ populate: ["team"] }
	);
	if (!teamMember) return;

	await db.em.nativeDelete(ClanTeamMember, { member: clanMember });
	await logOnAchilleaSpecificClanChannel(
		logger,
		{
			embeds: [
				buildInfoEmbed(
					`Le joueur **${escapeMarkdown(clanMember.user.displayName)}** a quitté l'équipe **${teamMember.team.name}**`
				),
			],
		},
		clan.channelId
	);
}

/**
 * Un membre n'est considéré "bloquant" pour rejoindre un autre Clan que s'il a
 * une adhésion à un Clan encore ACTIF. Une adhésion à un Clan marqué inactif
 * (Clan.isInactive) ne bloque plus une nouvelle candidature/invitation :
 * l'ancienne adhésion reste en base telle quelle (transfert/prêt implicite),
 * l'utilisateur devant la quitter explicitement via /clan-leave s'il le souhaite.
 */
export async function hasActiveClanMembership(
	userId: string,
	em: DatabaseEntityManager
): Promise<boolean> {
	const memberships = await em.find(ClanMember, { user: userId }, { populate: ["clan"] });

	return memberships.some((membership) => !membership.clan.isInactive);
}

export async function validateClanMemberLimits(
	clan: Clan,
	em: DatabaseEntityManager,
	desiredDistinctions: ClanMemberDistinction[]
) {
	const limits = await getClanMemberLimits();

	if (
		!desiredDistinctions.includes(ClanMemberDistinction.Player) &&
		!desiredDistinctions.includes(ClanMemberDistinction.Staff)
	)
		return;

	const members = await em.find(ClanMember, { clan }, { refresh: true });
	const exceeded = checkClanMemberLimitExceeded(
		{
			players: members.filter((m) => m.isPlayer).length,
			staff: members.filter((m) => m.isStaff).length,
		},
		limits,
		desiredDistinctions
	);

	if (exceeded === "player") {
		throw new Error(`Le clan a déjà atteint la limite de ${limits.playerLimit} joueurs.`);
	}

	if (exceeded === "staff") {
		throw new Error(`Le clan a déjà atteint la limite de ${limits.staffLimit} staff.`);
	}
}

export async function onMembershipChange(clan: Clan, db: Database, logger: Logger) {
	const count = await db.em.count(ClanMember, { clan });
	const minMemberAmountAllowed = 5;

	// 🧠 CASE 1 — clan just dropped below 5 members
	if (count < minMemberAmountAllowed && !clan.underMemberLimit) {
		clan.underMemberLimit = true;
		await db.em.flush();

		console.info(`⚠️ Clan ${clan.name} has dropped to ${count} members. Warning + timer started.`);

		await logOnClanChannels(
			logger,
			{
				embeds: [
					buildWarningEmbed(
						`Nombre de membres inférieur au minimum autorisé ${minMemberAmountAllowed} ! Le clan sera dissout dans 24h si la situation n'a pas évolué.`
					),
				],
			},
			clan
		);

		// Schedule the check job for 24 hours later
		return await scheduleClanCheck(clan.id);
	}
}

export async function logPromote(clan: Clan, promotedMember: ClanMember, client: Client) {
	const logger = await resolveDependency(Logger);
	const user = await client.users.fetch(promotedMember.user.id).catch(() => null);
	const msg: BaseMessageOptions = {
		embeds: [
			await buildSimpleUserEmbed(
				user!,
				"Promotion",
				`Promotion au rôle de ${ClanMemberRoleName[promotedMember.role]}`,
				0x57f287
			),
		],
	};

	if (promotedMember.role >= ClanMemberRole.SubCaptain) {
		msg.content = `${userMention(user!.id)}`;
	}
	await logOnClanChannels(logger, msg, clan);
}

export async function logDemote(clan: Clan, demotedMember: ClanMember, client: Client) {
	const logger = await resolveDependency(Logger);
	const user = await client.users.fetch(demotedMember.user.id).catch(() => null);
	const msg: BaseMessageOptions = {
		embeds: [
			await buildSimpleUserEmbed(
				user!,
				"Rétrogradation",
				`Rétrogradation au rôle de ${ClanMemberRoleName[demotedMember.role]}`,
				0xed4245
			),
		],
		content: `${userMention(user!.id)}`,
	};

	await logOnClanChannels(logger, msg, clan);
}
