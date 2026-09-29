import type {
	ButtonInteraction,
	ColorResolvable,
	CommandInteraction,
	ModalSubmitInteraction,
	StringSelectMenuInteraction,
} from "discord.js";
import {
	channelMention,
	Colors,
	EmbedBuilder,
	escapeMarkdown,
	MessageFlags,
	User as DiscordUser,
	userMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { DateTime } from "luxon";

import { coreManagerConfig } from "@/configs";
import type { Guild, Interclan, InterclanLineup, Ranked, User, VoteProposal } from "@/entities";
import { Clan, ClanInvite, ClanMember, ClanMemberHistory, Lobby } from "@/entities";
import { env } from "@/env";
import type { UserService } from "@/services";
import { Database } from "../../services/Database";

import { ClanTeam } from "../../entities/ClanTeam";
import {
	ClanMemberRoleName,
	InterclanState,
	MatchMode,
	ProposalStatus,
	VoteChoice,
} from "../enums";
import { ClanTeamType } from "../enums/clanTeamType";
import { TeamMemberRole } from "../enums/teamMemberRole";
import type { LobbyStruct } from "../types/lobbyStruct";
import { resolveDependency } from "./dependency";
import { replyToInteraction } from "./interactions";

/**
 * Send a simple success embed
 * @param interaction - discord interaction
 * @param message - message to log
 */
export function simpleSuccessEmbed(interaction: CommandInteraction, message: string) {
	const embed = new EmbedBuilder()
		.setColor(0x57f287) // GREEN // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`✅ ${message}`);

	replyToInteraction(interaction, { embeds: [embed] });
}

export function replyWithSimpleSuccessEmbed(
	interaction: CommandInteraction | ButtonInteraction,
	message: string,
	ephemeral: boolean = true
) {
	const embed = new EmbedBuilder()
		.setColor(0x57f287) // GREEN // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`✅ ${message}`);

	interaction.reply({ embeds: [embed], flags: ephemeral ? MessageFlags.Ephemeral : undefined });
}

export function followUpWithSuccessEmbed(
	interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction,
	message: string,
	ephemeral: boolean = false
) {
	const embed = new EmbedBuilder()
		.setColor(0x57f287) // GREEN // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`✅ ${message}`);

	// Hérite de l'éphémère de la réponse différée : sinon un followUp après un
	// deferReply éphémère est posté EN PUBLIC (fuite de messages admin/confirmations).
	const isEphemeral = ephemeral || interaction.ephemeral === true;
	interaction
		.followUp({ embeds: [embed], flags: isEphemeral ? MessageFlags.Ephemeral : undefined })
		.catch(() => {});
}

/**
 * Send a simple error embed
 * @param interaction - discord interaction
 * @param message - message to log
 */
export function simpleErrorEmbed(interaction: CommandInteraction, message: string) {
	const embed = new EmbedBuilder()
		.setColor(0xed4245) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`❌ ${message}`);

	replyToInteraction(interaction, { embeds: [embed] });
}

/**
 * Reply with a simple error embed
 * @param interaction - discord interaction
 * @param message - message to log
 * @param ephemeral
 */
export function replyWithSimpleErrorEmbed(
	interaction: CommandInteraction | ButtonInteraction,
	message: string,
	ephemeral: boolean = true
) {
	const embed = new EmbedBuilder()
		.setColor(0xed4245) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`❌ ${message}`);

	interaction.reply({ embeds: [embed], flags: ephemeral ? MessageFlags.Ephemeral : undefined });
}

export function followUpWithErrorEmbed(
	interaction:
		| CommandInteraction
		| ButtonInteraction
		| ModalSubmitInteraction
		| StringSelectMenuInteraction,
	message: string,
	ephemeral: boolean = false
) {
	const embed = new EmbedBuilder()
		.setColor(Colors.Red) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`❌ ${message}`);

	// Hérite de l'éphémère de la réponse différée (cf. followUpWithSuccessEmbed).
	const isEphemeral = ephemeral || interaction.ephemeral === true;
	interaction
		.followUp({ embeds: [embed], flags: isEphemeral ? MessageFlags.Ephemeral : undefined })
		.catch(() => {});
}

/**
 * Send a simple informative embed
 * @param interaction - discord interaction
 * @param message - message to log
 */
export function simpleInfoEmbed(interaction: CommandInteraction, message: string) {
	const embed = new EmbedBuilder()
		.setColor(0x206694) // Dark-Blue // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`<:info:${env.isDev ? "1442247057850237190" : "1442247164100350013"}> ${message}`);

	replyToInteraction(interaction, { embeds: [embed] });
}

/**
 * Send a simple informative embed
 * @param interaction - discord interaction
 * @param message - message to log
 * @param customEmoji - custom emoji to use in the title
 * @param color - color of the embed
 */
export function simpleCustomEmojiEmbed(
	interaction: CommandInteraction,
	message: string,
	customEmoji: string,
	color: ColorResolvable
) {
	const embed = new EmbedBuilder()
		.setColor(color) // Any // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`${customEmoji} ${message}`);

	replyToInteraction(interaction, { embeds: [embed] });
}

function formatUrl(url: string) {
	if (!url.startsWith("https")) {
		return `https://${url}`;
	}

	return url;
}

function buildSocialMediaString(clan: Clan) {
	let socialString = "";
	socialString += clan.xUrl ? `[Twitter](${formatUrl(clan.xUrl)})\n` : "";
	socialString += clan.instagramUrl ? `[Instagram](${formatUrl(clan.instagramUrl)})\n` : "";
	socialString += clan.tiktokUrl ? `[TikTok](${formatUrl(clan.tiktokUrl)})\n` : "";

	return socialString;
}

export function createClanFoundationEmbed(clan: Clan, founders: string[], votes: number) {
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`[${clan.shortenedName}] ${clan.name} - Clan foundation`)
		.setDescription(clan.clanBiography ?? "Pas de biographie fournie")
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Président", value: userMention(founders[0]), inline: true },
			{ name: "Fondateurs", value: foundersString, inline: true },
			{ name: "Votes", value: `${votes} / ${founders.length - 1}`, inline: true }
		);
}

export async function createClanFileEmbed(clan: Clan) {
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`Dossier de création de clan : ${clan.name}\n`)
		.setDescription(clan.clanBiography)
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Président", value: userMention(clan.founders[0]), inline: true },
			{ name: "Fondateurs", value: foundersString, inline: true },
			{ name: " ", value: " ", inline: true },
			{ name: "Discord", value: clan.guild ? "✅" : "❌", inline: true },
			{ name: "Réseaux sociaux", value: buildSocialMediaString(clan), inline: true }
		);
}

export async function createActiveClanInfosEmbed(
	interaction: CommandInteraction,
	clan: Clan,
	db: Database
) {
	const clanMembersRepo = db.get(ClanMember);
	const cpt = await db.get(ClanMember).getClanCaptain(clan.id);
	const subCaptains = await clanMembersRepo.getClanSubCaptains(clan.id);
	const subCaptainsString =
		subCaptains.length > 0
			? subCaptains.map((sc) => `- ${userMention(sc.user.id)}`).join("\n")
			: "";
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`[${clan.shortenedName}] ${clan.name}\n`)
		.setDescription(clan.clanBiography)
		.setAuthor({
			iconURL: interaction.user.displayAvatarURL(),
			name: interaction.user.displayName,
		})
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Président", value: userMention(cpt!.user.id), inline: true },
			{ name: "Vice-Présidents", value: subCaptainsString, inline: true },
			{ name: "Fondateurs", value: foundersString, inline: true },
			{
				name: "Membres",
				value: `${await clanMembersRepo.countClanMembers(clan.id)}`,
				inline: true,
			},
			{ name: "Discord", value: clan.guild ? "Yes" : "No", inline: true },
			{ name: "Réseaux sociaux", value: buildSocialMediaString(clan), inline: true }
		);
}

export async function createDisbandedClanInfosEmbed(interaction: CommandInteraction, clan: Clan) {
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(Colors.Red)
		.setTitle(`[${clan.shortenedName}] ${clan.name}\n - Clan dissout`)
		.setDescription(clan.clanBiography)
		.setAuthor({
			iconURL: interaction.user.displayAvatarURL(),
			name: interaction.user.displayName,
		})
		.setThumbnail(clan.clanAvatarUrl)
		.setFields({ name: "Fondateurs", value: foundersString, inline: true });
}

export async function createAllActiveClansEmbed(
	interaction: CommandInteraction,
	clans: Clan[],
	db: Database,
	pageNb: number,
	totalPageNb: number
) {
	const captains = await Promise.all(
		clans.map(async (c) => {
			const captain = await db.get(ClanMember).getClanCaptain(c.id);

			return `${userMention(captain!.user.id)}`;
		})
	);

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle("Liste des Clans")
		.setDescription(
			"Liste des clans en activité. Sélectionnez-en un ci-dessous pour voir ses informations détaillées."
		)
		.setAuthor({
			iconURL: interaction.user.displayAvatarURL(),
			name: interaction.user.displayName,
		})
		.setFields(
			{ name: "Clan", value: clans.map((c) => `${c.name}`).join("\n"), inline: true },
			{ name: "Id", value: clans.map((c) => `${c.id}`).join("\n"), inline: true },
			{ name: "Présidence", value: captains.join("\n"), inline: true },
			{ name: `Page ${pageNb}/${totalPageNb}`, value: " ", inline: true }
		);
}

export function buildSuccessEmbed(message: string) {
	return new EmbedBuilder()
		.setColor(0x57f287) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`✅ ${message}`);
}

export function buildErrorEmbed(message: string) {
	return new EmbedBuilder()
		.setColor(0xed4245) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`❌ ${message}`);
}

export function buildWarningEmbed(message: string) {
	return new EmbedBuilder()
		.setColor(Colors.Orange) // RED // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`⚠️ ${message}`);
}

export function buildInfoEmbed(message: string) {
	return new EmbedBuilder()
		.setColor(0x206694) // Dark-Blue // see: https://github.com/discordjs/discord.js/blob/main/packages/discord.js/src/util/Colors.js
		.setTitle(`<:info:${env.isDev ? "1442247057850237190" : "1442247164100350013"}> ${message}`);
}

function formatDateForInvites(date: Date | string | null | undefined, locale: string) {
	// Garde-fou : une ligne hydratée depuis la DB peut avoir lastInteract = null
	// (le défaut `new Date()` ne s'applique qu'à `new User()`, pas à l'hydratation) →
	// `null.toLocaleDateString` faisait planter la commande (ex. /player infos).
	if (!date) return "—";
	const d = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString(locale, {
		day: "2-digit",
		month: "short",
	});
}

export async function buildClanInvitesEmbed(
	interaction: CommandInteraction,
	clan: Clan,
	db: Database,
	currentPage: number,
	lastPage: number
) {
	const clanInvitesRepo = db.get(ClanInvite);
	const invites = await clanInvitesRepo.find({ clan: clan.id }, { orderBy: { createdAt: "desc" } });
	const usersString =
		invites.length > 0 ? invites.map((m) => `${userMention(m.user.id)}`).join("\n") : "-";
	const invitersString =
		invites.length > 0 ? invites.map((m) => `${userMention(m.inviter.id)}`).join("\n") : "-";
	const inviteDate =
		invites.length > 0
			? invites
					.map((m) => `${formatDateForInvites(m.createdAt, interaction.guild!.preferredLocale)}`)
					.join("\n")
			: "-";

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`[${clan.shortenedName}] ${clan.name} - Invites`)
		.setDescription(
			`Liste des invitations émises par le clan ordonnées par ancienneté\n\n**${invites.length}/100** - Page ${currentPage}/${lastPage === 0 ? 1 : lastPage}`
		)
		.setAuthor({
			iconURL: interaction.user.displayAvatarURL(),
			name: interaction.user.displayName,
		})
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Invité", value: usersString, inline: true },
			{ name: "Invitant", value: invitersString, inline: true },
			{ name: "Invité le", value: inviteDate, inline: true }
		);
}

export async function buildClanInviteManagementEmbed(
	interaction: CommandInteraction,
	clanInvite: ClanInvite,
	client: Client
) {
	const discordUser = await client.users.fetch(clanInvite.user.id);

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`${discordUser.displayName} - Gestion de l'invitation`)
		.setDescription(
			`__*Invitation émise le ${formatDateForInvites(clanInvite.createdAt, interaction.guild!.preferredLocale)}*__`
		)
		.setAuthor({
			iconURL: interaction.user?.displayAvatarURL(),
			name: interaction.user?.displayName,
		})
		.setThumbnail(discordUser.displayAvatarURL())
		.setFields(
			{
				name: "Dernière activité",
				value: `${formatDateForInvites(clanInvite.user.lastInteract, "fr-FR")}`,
				inline: true,
			},
			{
				name: "Elo",
				value: `Non classé`,
				inline: true,
			},
			{
				name: "Tournois gagnés",
				value: `0`,
				inline: true,
			},
			{
				name: "Participations Interclan",
				value: `0`,
				inline: true,
			},
			{
				name: "Victoires Interclan",
				value: `0`,
				inline: true,
			},
			{
				name: "Victoires Coupes des Clans",
				value: `0`,
				inline: true,
			}
		);
}

export async function buildAllClanMembersEmbed(
	interaction: CommandInteraction,
	clan: Clan,
	clanMembers: ClanMember[],
	totalMemberCount: number,
	currentPage: number,
	lastPage: number
) {
	const membersString = clanMembers.map((m) => `${userMention(m.user.id)}`).join("\n");
	const rolesString = clanMembers.map((m) => `${ClanMemberRoleName[m.role]}`).join("\n");
	const activityString = clanMembers
		.map((m) => `${formatDateForInvites(m.user.lastInteract, "fr-FR")}`)
		.join("\n");

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`[${clan.shortenedName}] ${clan.name} - Members`)
		.setDescription(
			`Liste des membres du clan ordonnées par rôle et ancienneté\n\n**${totalMemberCount} Membres** - Page ${currentPage}/${lastPage}`
		)
		.setAuthor({
			iconURL: interaction.user.displayAvatarURL(),
			name: interaction.user.displayName,
		})
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Membre", value: membersString, inline: true },
			{ name: "Rôle", value: rolesString, inline: true },
			{ name: "Dernière activité", value: activityString, inline: true }
		);
}

export async function buildClanMemberEmbed(clanMember: ClanMember, client: Client, title: string) {
	const discordUser = await client.users.fetch(clanMember.user.id);

	return new EmbedBuilder()
		.setColor(title.toLowerCase().includes("nouveau") ? 0x57f287 : 0x206694) // GREEN for new members, BLUE for others
		.setTitle(`${discordUser.displayName} - ${title}`)
		.setDescription(`__*Clan rejoint le ${clanMember.createdAt.toLocaleDateString("fr-FR")}*__`)
		.setThumbnail(discordUser.displayAvatarURL())
		.setFields(
			{ name: "Rôle", value: `${ClanMemberRoleName[clanMember.role]}`, inline: true },
			{ name: "Distinctions", value: `${clanMember.distinctions.join("\n")}`, inline: true },
			{
				name: "Dernière activité",
				value: `${formatDateForInvites(clanMember.user.lastInteract, "fr-FR")}`,
				inline: true,
			},
			{ name: "Contributions", value: `0`, inline: true },
			{ name: "Stats Interclan", value: `0`, inline: true },
			{ name: "Stats Coupes des Clans", value: `0`, inline: true }
		);
}

export async function buildUserEmbed(user: User, client: Client, title: string, color: number) {
	const discordUser = await client.users.fetch(user.id);
	const embed = new EmbedBuilder()
		.setColor(color)
		.setTitle(`${discordUser.displayName} - ${title}`)
		.setThumbnail(discordUser.displayAvatarURL())
		.setFields(
			{
				name: "Dernière activité",
				value: `${formatDateForInvites(user.lastInteract, "fr-FR")}`,
				inline: true,
			},
			{
				name: "Elo",
				value: `Non classé`,
				inline: true,
			},
			{
				name: "Tournois gagnés",
				value: `0`,
				inline: true,
			},
			{
				name: "Participations Interclan",
				value: `0`,
				inline: true,
			},
			{
				name: "Victoires Interclan",
				value: `0`,
				inline: true,
			},
			{
				name: "Victoires Coupes des Clans",
				value: `0`,
				inline: true,
			}
		);

	if (title.includes("Candidature")) {
		embed.setDescription("Souhaitez-vous intégrer ce joueur à votre Clan ?");
	}

	return embed;
}

export async function buildMemberLeftEmbed(
	clanMember: ClanMember,
	client: Client,
	title: string,
	reason?: string
) {
	const discordUser = await client.users.fetch(clanMember.user.id);

	const embed = new EmbedBuilder()
		.setColor(0xed4245)
		.setTitle(`${discordUser.displayName} - ${title}`)
		.setThumbnail(discordUser.displayAvatarURL())
		.setFields(
			{ name: "Contribution", value: `0`, inline: true },
			{ name: " ", value: ` `, inline: true },
			{ name: "Participations Interclan", value: `0`, inline: true },
			{ name: "Victoires Interclan", value: `0`, inline: true },
			{ name: " ", value: ` `, inline: true },
			{ name: "Victories Coupes des Clans", value: `0`, inline: true }
		);

	if (reason) {
		embed.setDescription(`**Raison :** ${reason}`);
	}

	return embed;
}

export async function buildSimpleUserEmbed(
	user: DiscordUser | User,
	title: string,
	description: string,
	color: ColorResolvable
) {
	if (user instanceof DiscordUser) {
		return new EmbedBuilder()
			.setColor(color)
			.setTitle(`${user.displayName} - ${title}`)
			.setDescription(description)
			.setThumbnail(user.displayAvatarURL());
	}

	return new EmbedBuilder()
		.setColor(color)
		.setTitle(`${escapeMarkdown(user.displayName)} - ${title}`)
		.setDescription(description)
		.setThumbnail(user.avatar);
}

export async function buildNewClanEmbed(clan: Clan, clanCaptainId: string) {
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(0x57f287)
		.setTitle(`Nouveau Clan : ${clan.name}\n`)
		.setDescription(clan.clanBiography)
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Président", value: userMention(clanCaptainId), inline: true },
			{ name: "Fondateurs", value: foundersString, inline: true },
			{ name: "Réseaux sociaux", value: buildSocialMediaString(clan), inline: true }
		);
}

export async function buildClanDisbandEmbed(clan: Clan) {
	let foundersString = "";
	clan.founders.forEach((founder) => {
		foundersString += `- ${userMention(founder)}\n`;
	});

	return new EmbedBuilder()
		.setColor(0xed4245)
		.setTitle(`Dissolution de Clan : ${clan.name}\n`)
		.setDescription(`__*Clan dissout le ${new Date().toLocaleDateString("FR-fr")}*__`)
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Fondateurs", value: foundersString, inline: true },
			{ name: "Fondé le", value: clan.createdAt.toLocaleDateString("FR-fr"), inline: true },
			{ name: "Fame accumulée", value: clan.clanFame.toString(), inline: true }
		);
}

export function formatFrenchDate(x: Date): string {
	return x
		.toLocaleString("fr-FR", {
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZone: "Europe/Paris",
		})
		.replace(",", " à") // make it "27 oct. à 12:02"
		.replace(":", "h");
}

export async function createClanCreationVoteEmbed(clan: Clan, voteProposal: VoteProposal) {
	let foundersString = "";
	const db = await resolveDependency(Database);
	const foundersAsUsers = await db.em.getRepository(Clan).getFounders(clan);
	foundersAsUsers.forEach((founder) => {
		foundersString += `- ${founder.displayName}\n`;
	});

	const votes = voteProposal.votes.getItems();
	const totalEligible = voteProposal.eligibleVoters.length;
	const requiredParticipation = Math.ceil(totalEligible * voteProposal.minParticipationRatio);

	const approvals = votes.filter((v) => v.vote === VoteChoice.APPROVE).length;
	const rejections = votes.filter((v) => v.vote === VoteChoice.REJECT).length;
	const approvePercent = votes.length > 0 ? Math.round((approvals / votes.length) * 100) : 0;
	const rejectPercent = votes.length > 0 ? Math.round((rejections / votes.length) * 100) : 0;
	const participationPercent = voteProposal.minParticipationRatio * 100;

	const embed = new EmbedBuilder()
		.setColor(0x206694)
		.setDescription(clan.clanBiography)
		.setThumbnail(clan.clanAvatarUrl)
		.setFields(
			{ name: "Président", value: userMention(clan.founders[0]), inline: true },
			{ name: "Fondateurs", value: foundersString, inline: true },
			{ name: "Réseaux sociaux", value: buildSocialMediaString(clan), inline: true },
			{
				name: "Requis",
				value: `${requiredParticipation}/${totalEligible} (${participationPercent}%)`,
				inline: true,
			},
			{ name: "Pour", value: `✅ ${approvals}/${votes.length} (${approvePercent}%)`, inline: true },
			{
				name: "Contre",
				value: `❌ ${rejections}/${votes.length} (${rejectPercent}%)`,
				inline: true,
			}
		);

	if (voteProposal.status === ProposalStatus.PENDING) {
		embed.setTitle(`🗳️ Vote en cours - Création du Clan [${clan.shortenedName}] ${clan.name}\n`);
	} else if (voteProposal.status === ProposalStatus.EXPIRED) {
		embed.setTitle(`🕛 Expirée - Création du Clan [${clan.shortenedName}] ${clan.name}\n`);
	} else if (voteProposal.status === ProposalStatus.APPROVED) {
		embed.setTitle(`✅ Approuvée - Création du Clan [${clan.shortenedName}] ${clan.name}\n`);
	} else {
		embed.setTitle(`❌ Refusée - Création du Clan [${clan.shortenedName}] ${clan.name}\n`);
	}

	if (voteProposal.closedAt) {
		embed.addFields({
			name: `Vote clôturé le ${formatFrenchDate(voteProposal.closedAt)}`,
			value: `__*Issue du vote :* ${voteProposal.status === ProposalStatus.APPROVED ? "Approuvé" : "Rejeté"}__`,
			inline: true,
		});
	} else {
		embed.addFields({
			name: `Le vote termine le ${formatFrenchDate(voteProposal.expiresAt)}`,
			value: " ",
		});
	}

	return embed;
}

function formatDateToSlashDate(date: Date): string {
	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0"); // months are 0-based
	const year = date.getFullYear();

	return `${day}/${month}/${year}`;
}

export async function createMemberHistoryEmbed(user: DiscordUser, botUser: User, db: Database) {
	const history = await db
		.get(ClanMemberHistory)
		.find({ user: user.id }, { populate: ["clan"], orderBy: { createdAt: "desc" } });
	const actualMembership = await db
		.get(ClanMember)
		.findOne({ user: user.id }, { populate: ["clan"] });

	let clanString = history
		.map((h) => `<:${h.clan.normalizedShortName}:${h.clan.clanEmojiId}> ${h.clan.name}`)
		.join("\n");
	let joinString = history
		.map(
			(h) =>
				`<:green_arrow:${env.isDev ? "1390816412624490626" : "1436631712368168971"}> ${formatDateToSlashDate(h.joinDate)}`
		)
		.join("\n");
	let leaveString = history
		.map(
			(h) =>
				`<:red_arrow:${env.isDev ? "1390816369427222588" : "1436631768483627068"}> ${formatDateToSlashDate(h.createdAt)}`
		)
		.join("\n");

	if (actualMembership) {
		clanString += `\n<:${actualMembership.clan.normalizedShortName}:${actualMembership.clan.clanEmojiId}> ${actualMembership.clan.name}`;
		joinString += `\n<:green_arrow:${env.isDev ? "1390816412624490626" : "1436631712368168971"}> ${formatDateToSlashDate(actualMembership.createdAt)}`;
		leaveString += `\n-`;
	}

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`${escapeMarkdown(user.displayName)} - Carrière`)
		.setDescription(
			`Historique des clans auxquels ${escapeMarkdown(user.displayName)} a appartenu\n\n*__Ce joueur a débuté sa carrière le ${formatDateToSlashDate(botUser.createdAt)}__*`
		)
		.setThumbnail(user.displayAvatarURL())
		.setFields(
			{ name: "Clan", value: clanString, inline: true },
			{ name: "Rejoint le", value: joinString, inline: true },
			{ name: "Quitté le", value: leaveString, inline: true }
		);
}

export function createRankedQueueEmbed(ranked: Ranked, queueLength: number) {
	const text =
		"Règles de la file classée:\n- Un match est joué avec un joueur hôte choisi au hasard\n- Des points d'elo sont gagnés ou perdus selon l'issue du match\n- Terminer sur une égalité implique des fluctuations d'elo minimes\n**__Good luck & have fun !__**";

	return new EmbedBuilder()
		.setColor(0x206694)
		.setTitle(`🎖️ ${ranked.name} - Inscriptions`)
		.setDescription(text)
		.setImage("https://i.pinimg.com/736x/b3/70/8d/b3708d354bfd3a63f633a265b79769af.jpg")
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp(new Date())
		.setFields(
			{ name: "Inscrits", value: `${queueLength} joueurs`, inline: true },
			{
				name: "Mode",
				value: `${ranked.mode === MatchMode.ONE_VS_ONE ? "Standard" : "Double"}`,
				inline: true,
			},
			{
				name: "Commence à",
				value: `${formaTimeToFrenchHourWithOffset(ranked.queueEndsAt)} (UTC +${ranked.queueEndsAt.getTimezoneOffset() / -60})`,
				inline: true,
			}
		);
}

export function createRankedCanceledEmbed(ranked: Ranked, raison: string) {
	return new EmbedBuilder()
		.setColor(0xed4245)
		.setTitle(`🎖️ ${ranked.name} - Annulée`)
		.setDescription(`La session a été annulée pour la raison suivante :\n- ${raison}`)
		.setImage("https://i.pinimg.com/736x/95/20/ec/9520ec5fd44422fa0551098854afd472.jpg")
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp(new Date());
}

export async function createRankedOngoingEmbed(
	ranked: Ranked,
	displayedLobbies: LobbyStruct[],
	liveTwitchIds: Set<string>,
	db: Database,
	client: Client,
	userService: UserService
) {
	const ongoingLobbies = await db.em.findAndCount(
		Lobby,
		{ event: ranked.id },
		{ populate: ["lobbyUsers", "lobbyUsers.user", "lobbyUsers.user.elos"] }
	);
	const elos = ongoingLobbies[0].flatMap((l) => [
		l.lobbyUsers.getItems()[0].user.getElo(ranked.mode)?.elo ?? 0,
		l.lobbyUsers.getItems()[1].user.getElo(ranked.mode)?.elo ?? 0,
	]);
	const eloMoyen = Math.round(
		ongoingLobbies[0].reduce(
			(acc, l) =>
				acc +
				((l.lobbyUsers.getItems()[0].user.getElo(ranked.mode)?.elo ?? 0) +
					(l.lobbyUsers.getItems()[1].user.getElo(ranked.mode)?.elo ?? 0)) /
					2,
			0
		) / ongoingLobbies[0].length
	);
	const eloMedian = Math.round(median(elos));
	const eloMin = Math.min(...elos);
	const eloMax = Math.max(...elos);

	const embed = new EmbedBuilder()
		.setColor(0x206694)
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp(new Date())
		.setTitle(`🎖️ ${ranked.name} - En cours`)
		.setDescription(
			"Stats et liste des matchs chauds en cours pour la session.\n__Les utilisateurs en bleu sont en stream, n'hésitez pas à faire un tour sur leur chaîne !__\n\n*Vous ne trouvez pas votre lobby ?*\n Rejoignez-le en cliquant sur le bouton juste en-dessous !"
		)
		.setImage("https://i.pinimg.com/736x/f2/dd/c9/f2ddc9796a2feeeb8bb2daae61d8d42d.jpg")
		.setFields(
			{ name: "Matchs en cours", value: ongoingLobbies[1].toString(), inline: true },
			{
				name: "Mode",
				value: ranked.mode === MatchMode.ONE_VS_ONE ? "Standard" : "Double",
				inline: true,
			},
			{
				name: "Finis à",
				value: `${formaTimeToFrenchHourWithOffset(ranked.queueEndsAt, 30)} (UTC +${ranked.queueEndsAt.getTimezoneOffset() / -60})`,
				inline: true,
			},
			{ name: "Elo moyen", value: eloMoyen.toString(), inline: true },
			{ name: "Elo médian", value: eloMedian.toString(), inline: true },
			{ name: "Elo min/max", value: `[${eloMin} - ${eloMax}]`, inline: true }
		);

	const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);

	// chunk into blocks of 10 lobbies each (so 2 blocks max)
	for (let i = 0; i < displayedLobbies.length; i += 10) {
		const block = displayedLobbies.slice(i, i + 10);

		const p1Names = await Promise.all(
			block.map(async (l) => {
				const name = await userService.getDisplayNameWithClan(l.p1.userId, true, achillea);
				const truncatedName = truncatePlayerName(name);

				if (l.p1.twitchId && liveTwitchIds.has(l.p1.twitchId)) {
					return `[${truncatedName}](https://twitch.tv/${l.p1.twitchLogin})`;
				} else {
					return truncatedName;
				}
			})
		);

		const p2Names = await Promise.all(
			block.map(async (l) => {
				const name = await userService.getDisplayNameWithClan(l.p2.userId, false, achillea);
				const truncatedName = truncatePlayerName(name);

				if (l.p2.twitchId && liveTwitchIds.has(l.p2.twitchId)) {
					return `[${truncatedName}](https://twitch.tv/${l.p2.twitchLogin})`;
				} else {
					return truncatedName;
				}
			})
		);

		// three inline columns: Player1, Player2, Lobby
		embed.addFields([
			{
				name: "Player 1",
				value: p1Names.join("\n"),
				inline: true,
			},
			{
				name: "VS",
				value: block
					.map(() => `<:vs:${env.isDev ? "1391907918064128020" : "1436631555043889245"}>`)
					.join("\n"),
				inline: true,
			},
			{
				name: "Player 2",
				value: p2Names.join("\n"),
				inline: true,
			},
		]);
	}

	return embed;
}

function median(arr: number[]): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formaTimeToFrenchHourWithOffset(date: Date, offset: number = 0): string {
	return DateTime.fromJSDate(date)
		.plus({ minutes: offset })
		.setZone("Europe/Paris")
		.toFormat("HH:mm");
}

function truncatePlayerName(name: string, maxLength = 15): string {
	if (name.length <= maxLength) return name;

	const parts = name.split(" ");
	// if there are multiple words, keep the first word and one letter of the second
	if (parts.length > 1) {
		const [first, second] = parts;
		// only include “first + space + first letter of second” if it still fits
		if (first.length + 2 <= maxLength) {
			return `${first} ${second.charAt(0)}`;
		}

		// otherwise, just hard‐cut the first word
		return first.slice(0, maxLength);
	}

	// single long word → hard cut
	return name.slice(0, maxLength);
}

export async function createTeamManagerEmbed(clan: Clan, db: Database) {
	const team1 = await db.em.findOne(
		ClanTeam,
		{ clan, type: ClanTeamType.MAIN },
		{ populate: ["links"] }
	);

	if (!team1) throw new Error("Main team not found");

	const team2 = await db.em.findOne(
		ClanTeam,
		{ clan, type: ClanTeamType.SUB },
		{ populate: ["links"] }
	);

	if (!team2) throw new Error("Sub team not found");

	const validityTeam1 = team1.isValidTeam()
		? "Valide ✅"
		: `Invalide ❌\n*${team1.getValidityErrors().join("\n")}*`;
	const validityTeam2 = team2.isValidTeam()
		? "Valide ✅"
		: `Invalide ❌\n*${team2.getValidityErrors().join("\n")}*`;

	return new EmbedBuilder()
		.setColor(Colors.Blue)
		.setTitle(`🏆 [${clan.shortenedName}] ${clan.name} - Equipes`)
		.setDescription(`Gérez vos équipes comme bon vous semble !\n\nUne équipe est composée de :\n- 3 à 5 joueurs, dont 1 Capitaine\n- 2 remplaçants (optionnel)
			\n- 1 coach (optionnel)\n\nSpécificités :\n- Un joueur/remplaçant ne peut être que dans une équipe\n- Un coach peut être dans plusieurs équipes`)
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp(new Date())
		.addFields(
			{ name: "Team 1", value: validityTeam1, inline: true },
			{ name: "Team 2", value: validityTeam2, inline: true },
			{ name: "", value: "", inline: true }
		);
}

export async function createTeamDisplayEmbed(team: ClanTeam, db: Database) {
	await db.em.populate(team, ["clan", "links.member.user", "captain.member.user"]);

	// Identify captain's user ID (if any)
	const captainUserId = team.captain?.member.user.id;

	const players = team.links
		.filter((l) => l.role === TeamMemberRole.PLAYER)
		.map((l) => {
			const username = l.member.user.displayName;

			// Append [C] if this player is the captain
			return captainUserId && l.member.user.id === captainUserId ? `**[C]** ${username}` : username;
		})
		.filter(Boolean);

	const subs = team.links
		.filter((l) => l.role === TeamMemberRole.SUB)
		.map((l) => l.member.user.displayName)
		.filter(Boolean);

	const coach = team.links.find((l) => l.role === TeamMemberRole.COACH)?.member.user.displayName;

	// Safely coerce all fields to strings
	const safe = (v?: string) => (typeof v === "string" && v.trim() ? v : "Aucun");

	return new EmbedBuilder()
		.setColor(Colors.Blue)
		.setTitle(`🏆 [${team.clan.shortenedName}] ${team.clan.name} - ${team.name}`)
		.setDescription(`*Dernière mise à jour le ${formatFrenchDate(team.updatedAt)}*`)
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp(new Date())
		.addFields(
			{
				name: "Joueurs",
				value: safe(players.join("\n")),
				inline: true,
			},
			{
				name: "Remplaçants",
				value: safe(subs.join("\n")),
				inline: true,
			},
			{
				name: "Coach",
				value: safe(coach),
				inline: true,
			},
			{ name: "Participations", value: "0", inline: true },
			{ name: "Victoires/Défaites", value: "0/0", inline: true },
			{ name: "Phases finales", value: "0", inline: true }
		);
}

export function createInterclanChallengeEmbed(
	challengerUsername: string,
	challengerClan: Clan,
	interclan: Interclan
) {
	return new EmbedBuilder()
		.setColor(Colors.DarkGold)
		.setTitle(`${interclan.name} - Proposition d'Interclan`)
		.setDescription(
			`Vous êtes défié à un Interclan par le clan ${challengerClan.name} !\nMotif: ${interclan.description}`
		)
		.setThumbnail(challengerClan.clanAvatarUrl)
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setFields(
			{ name: "Proposé par", value: challengerUsername, inline: true },
			{ name: "Clan rival", value: `${challengerClan.name}`, inline: true },
			{ name: "Date proposée", value: `${formatFrenchDate(interclan.fixedDate)}`, inline: true },
			{
				name: "Expire le",
				value: `${formatFrenchDate(new Date(interclan.createdAt.getTime() + 24 * 60 * 60 * 1000))}`,
				inline: true,
			}
		);
}

export function buildInterclanRecapEmbed(interclan: Interclan): EmbedBuilder {
	const isValidLineupA = interclan.getLineupA()?.isValidLineup() ?? false;
	const isValidLineupB = interclan.getLineupB()?.isValidLineup() ?? false;
	const isLockedInLineupA = interclan.getLineupA()?.lockedIn ?? false;
	const isLockedInLineupB = interclan.getLineupB()?.lockedIn ?? false;

	const statusA = getLineupStatus(isValidLineupA, isLockedInLineupA);
	const statusB = getLineupStatus(isValidLineupB, isLockedInLineupB);

	const embed = new EmbedBuilder()
		.setColor(Colors.Blue)
		.setTitle(`🏆 Interclan — ${interclan.name}`)
		.setDescription(`Voici le récapitulatif de l'Interclan à venir.`)
		.addFields(
			{ name: "Clan challenger", value: interclan.clanA.name, inline: true },
			{ name: "Clan défié", value: interclan.clanB.name, inline: true },
			{ name: "État", value: "🟢 Accepté", inline: true },
			{ name: "Initié le", value: `${formatFrenchDate(interclan.createdAt)}`, inline: true },
			{ name: "Débute le", value: `${formatFrenchDate(interclan.fixedDate)}`, inline: true },
			{ name: "", value: "", inline: true },
			{ name: `Lineup ${interclan.clanA.shortenedName}`, value: statusA, inline: true },
			{ name: `Lineup ${interclan.clanB.shortenedName}`, value: statusB, inline: true },
			{ name: "", value: "", inline: true }
		)
		.setFooter({
			text: "Powered by alessss_",
			iconURL:
				"https://cdn.discordapp.com/avatars/238660901375442954/00febf9a57a91e1f922411b0531a9684",
		})
		.setTimestamp();

	if (interclan.description)
		embed.addFields({ name: "Motif", value: interclan.description, inline: false });

	return embed;
}

function getLineupStatus(isValid: boolean, isLockedIn: boolean): string {
	if (isLockedIn && isValid) return "🔒 Locked in";
	if (!isValid && !isLockedIn) return "❌ Invalide";
	if (isValid && !isLockedIn) return "✅ Valide";

	return "❌ Invalide";
}

export function buildInterclanLockedInEmbed(interclan: Interclan) {
	const lineupA = interclan.getLineupA();
	const lineupB = interclan.getLineupB();

	const clanAName = interclan.clanA.name;
	const clanBName = interclan.clanB.name;

	// Defensive: handle missing lineups
	const lineupAPlayers =
		lineupA?.members
			.getItems()
			.toSorted((a, b) => a.position - b.position)
			.map((m, i) => `**${i + 1}.** ${m.user.displayName}`)
			.join("\n") || "*Aucun joueur*";

	const lineupBPlayers =
		lineupB?.members
			.getItems()
			.toSorted((a, b) => a.position - b.position)
			.map((m, i) => `**${i + 1}.** ${m.user.displayName}`)
			.join("\n") || "*Aucun joueur*";

	const vsStr =
		lineupB?.members
			.getItems()
			.map((m) => "VS")
			.join("\n") || "";

	const fixedDateStr = interclan.fixedDate
		? formatFrenchDate(interclan.fixedDate)
		: "Date à définir";

	return new EmbedBuilder()
		.setColor(Colors.Blurple)
		.setTitle(`🏆 Interclan confirmé — ${clanAName} vs ${clanBName}`)
		.setDescription(`**Date prévue :** ${fixedDateStr}\nLes deux clans ont verrouillé leur lineup.`)
		.addFields(
			{ name: clanAName, value: lineupAPlayers, inline: true },
			{ name: "-", value: vsStr, inline: true },
			{ name: clanBName, value: lineupBPlayers, inline: true }
		)
		.setTimestamp();
}

export function buildInterclanScoresEmbed(interclan: Interclan) {
	const lineupA = interclan.getLineupA();
	const lineupB = interclan.getLineupB();

	const clanAName = interclan.clanA.name;
	const clanBName = interclan.clanB.name;

	// Defensive: if no lineups, fallback
	if (!lineupA || !lineupB) throw new Error("Erreur au niveau des lineups");

	// 1️⃣ Sort players by position
	const lineupAPlayers = lineupA.members.getItems().toSorted((a, b) => a.position - b.position);
	const lineupBPlayers = lineupB.members.getItems().toSorted((a, b) => a.position - b.position);

	// 2️⃣ Sort lobbies (so we can match 1v1)
	const lobbies = interclan.lobbies.getItems().toSorted((a, b) => a.id - b.id);

	// 3️⃣ Build rows with player names and scores
	const rows = lobbies.map((lobby, i) => {
		const [team1, team2] = lobby.getTeams();

		const playerA = team1[0]?.user?.displayName ?? lineupAPlayers[i]?.user.displayName ?? "—";
		const playerB = team2[0]?.user?.displayName ?? lineupBPlayers[i]?.user.displayName ?? "—";

		const scoreA = team1[0]?.score ?? 0;
		const scoreB = team2[0]?.score ?? 0;

		return {
			playerA: `**${i + 1}.** ${playerA}`,
			vs: `${scoreA} — ${scoreB}`,
			playerB,
		};
	});

	// 4️⃣ Turn rows into aligned embed fields
	const fieldA = rows.map((r) => r.playerA).join("\n") || "*Aucun joueur*";
	const fieldVS = rows.map((r) => r.vs).join("\n") || "";
	const fieldB = rows.map((r) => r.playerB).join("\n") || "*Aucun joueur*";

	return new EmbedBuilder()
		.setColor(Colors.Gold)
		.setTitle(`🏆 Interclan — ${clanAName} vs ${clanBName}`)
		.setDescription(
			`**Dernière mise à jour:** ${formatFrenchDate(interclan.updatedAt)}\n` +
				`${interclan.state === InterclanState.ONGOING ? "Les matchs sont en cours. Voici les scores actuels :" : "Interclan terminé, voici les résultats finaux:"}`
		)
		.addFields(
			{ name: clanAName, value: fieldA, inline: true },
			{ name: "Score", value: fieldVS, inline: true },
			{ name: clanBName, value: fieldB, inline: true }
		)
		.setTimestamp();
}

export function createInterclanResultVoteEmbed(interclan: Interclan, voteProposal: VoteProposal) {
	const lineupA = interclan.getLineupA();
	const lineupB = interclan.getLineupB();

	const clanAName = interclan.clanA.name;
	const clanBName = interclan.clanB.name;

	// Defensive: if no lineups, fallback
	if (!lineupA || !lineupB) throw new Error("Erreur au niveau des lineups");

	// 1️⃣ Sort players by position
	const lineupAPlayers = lineupA.members.getItems().toSorted((a, b) => a.position - b.position);
	const lineupBPlayers = lineupB.members.getItems().toSorted((a, b) => a.position - b.position);

	// 2️⃣ Sort lobbies (so we can match 1v1)
	const lobbies = interclan.lobbies.getItems().toSorted((a, b) => a.id - b.id);

	// 3️⃣ Build rows with player names and scores
	const rows = lobbies.map((lobby, i) => {
		const [team1, team2] = lobby.getTeams();

		const playerA = team1[0]?.user?.displayName ?? lineupAPlayers[i]?.user.displayName ?? "—";
		const playerB = team2[0]?.user?.displayName ?? lineupBPlayers[i]?.user.displayName ?? "—";

		const scoreA = team1[0]?.score ?? 0;
		const scoreB = team2[0]?.score ?? 0;

		return {
			playerA: `**${i + 1}.** ${playerA}`,
			vs: `${scoreA} — ${scoreB}`,
			playerB,
		};
	});

	// 4️⃣ Turn rows into aligned embed fields
	const fieldA = rows.map((r) => r.playerA).join("\n") || "*Aucun joueur*";
	const fieldVS = rows.map((r) => r.vs).join("\n") || "";
	const fieldB = rows.map((r) => r.playerB).join("\n") || "*Aucun joueur*";

	const votes = voteProposal.votes.getItems();
	const totalEligible = voteProposal.eligibleVoters.length;
	const requiredParticipation = Math.ceil(totalEligible * voteProposal.minParticipationRatio);

	const approvals = votes.filter((v) => v.vote === VoteChoice.APPROVE).length;
	const rejections = votes.filter((v) => v.vote === VoteChoice.REJECT).length;
	const approvePercent = votes.length > 0 ? Math.round((approvals / votes.length) * 100) : 0;
	const rejectPercent = votes.length > 0 ? Math.round((rejections / votes.length) * 100) : 0;
	const participationPercent = voteProposal.minParticipationRatio * 100;

	const embed = new EmbedBuilder().setColor(0x206694).setFields(
		{ name: clanAName, value: fieldA, inline: true },
		{ name: "Score", value: fieldVS, inline: true },
		{ name: clanBName, value: fieldB, inline: true },
		{
			name: "Requis",
			value: `${requiredParticipation}/${totalEligible} (${participationPercent}%)`,
			inline: true,
		},
		{ name: "Pour", value: `✅ ${approvals}/${votes.length} (${approvePercent}%)`, inline: true },
		{
			name: "Contre",
			value: `❌ ${rejections}/${votes.length} (${rejectPercent}%)`,
			inline: true,
		}
	);

	if (voteProposal.status === ProposalStatus.PENDING) {
		embed.setTitle(`🗳️ Vote en cours - Validation Interclan ${interclan.name}`);
	} else if (voteProposal.status === ProposalStatus.EXPIRED) {
		embed.setTitle(`🕛 Expirée - Validation Interclan ${interclan.name}`);
	} else if (voteProposal.status === ProposalStatus.APPROVED) {
		embed.setTitle(`✅ Approuvée - Validation Interclan ${interclan.name}`);
	} else {
		embed.setTitle(`❌ Refusée - Validation Interclan ${interclan.name}`);
	}

	if (voteProposal.closedAt) {
		embed.addFields({
			name: `Vote clôturé le ${formatFrenchDate(voteProposal.closedAt)}`,
			value: `__*Issue du vote :* ${voteProposal.status === ProposalStatus.APPROVED ? "Approuvé" : "Rejeté"}__`,
			inline: true,
		});
	} else {
		embed.addFields({
			name: `Le vote termine le ${formatFrenchDate(voteProposal.expiresAt)}`,
			value: " ",
		});
	}

	return embed;
}

export function interclanLineupRemovalEmbed(clanMember: ClanMember, removalSummary: string[]) {
	return new EmbedBuilder()
		.setColor(Colors.Blue)
		.setTitle("Mise à jour des lineups Interclan")
		.setDescription(
			`Le joueur **${clanMember.user.displayName}** a été retiré des lineups suivantes :`
		)
		.addFields({ name: "Interclans", value: removalSummary.join("\n") })
		.setTimestamp();
}

export function interclanRecapLineupEmbed(lineup: InterclanLineup) {
	const lineupMembers = lineup.members.getItems();
	const usernames = lineupMembers.map((lm) => lm.user.displayName);

	return new EmbedBuilder()
		.setColor(Colors.Green)
		.setTitle(`${lineup.clan.shortenedName} - Mise à jour de la lineup`)
		.addFields({
			name: "Lineup",
			value: usernames.length > 0 ? usernames.join("\n") : "Aucun joueur",
		})
		.setTimestamp();
}

export function guildSettingsEmbed(guild: Guild, clan: Clan | null) {
	return new EmbedBuilder()
		.setColor(Colors.Blue)
		.setTitle("Mise à jour des paramètres de la Guilde")
		.addFields(
			{
				name: "Salon des annonces de Clan",
				value: `${guild.broadcastChannel ? channelMention(guild.broadcastChannel) : "Aucun"}`,
				inline: true,
			},
			// Champ espaceur (grille 2 colonnes) : Discord REFUSE name/value vides (erreur 50035)
			// → espace insécable de largeur nulle obligatoire.
			{ name: "\u200b", value: "\u200b", inline: true },
			{ name: "Clan lié", value: `${clan ? clan.name : "Aucun"}`, inline: true },
			{ name: "Annonces Ranked", value: `${guild.rankedEnabled ? "✅" : "❌"}`, inline: true }
		)
		.setTimestamp();
}

export function blacklistedUserEmbed(user: User) {
	return new EmbedBuilder()
		.setColor(Colors.NotQuiteBlack)
		.setTitle(`${user.displayName} - Liste Noire`)
		.setDescription(
			`**Raison:** ${user.blacklist?.reason ?? "Cet utilisateur est présent sur la Liste Noire d'Achillea sur décision des Administrateurs."}`
		)
		.addFields(
			{ name: "Identifiant", value: `${user.id}`, inline: true },
			{ name: "Nom d'utilisateur", value: `${user.username}`, inline: true },
			{
				name: "Depuis le",
				value: formatFrenchDate(user.blacklist?.createdAt ?? new Date()),
				inline: true,
			}
		)
		.setTimestamp();
}
