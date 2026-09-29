import type { Guild, ModalSubmitInteraction } from "discord.js";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	escapeMarkdown,
	LabelBuilder,
	ModalBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import type { Client } from "@aphrody/discordx";

import type {
	Clan,
	ClanInvite,
	ClanMember,
	ClanTeam,
	Guild as GuildEntity,
	Interclan,
	InterclanLineup,
	Lobby,
} from "@/entities";
import {
	ClanMemberDistinction,
	ClanMemberRole,
	ClanTeamType,
	LobbyState,
	TEAM_MEMBER_ROLE_CONFIG,
	TeamMemberRole,
	TeamSide,
} from "@/utils/enums";

export function buildPaginationButtons(currentPage: number, totalPages: number, target?: string) {
	const previousBtn = new ButtonBuilder()
		.setLabel("Précédent")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`previous-page${target ? `:${target}` : ""}`)
		.setEmoji("◀️")
		.setDisabled(totalPages === 0 || currentPage === 1);

	const nextBtn = new ButtonBuilder()
		.setLabel("Suivant")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`next-page${target ? `:${target}` : ""}`)
		.setEmoji("▶️")
		.setDisabled(totalPages === 0 || currentPage === totalPages);

	const firstPageBtn = new ButtonBuilder()
		.setLabel("Début")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`first-page${target ? `:${target}` : ""}`)
		.setEmoji("⏪")
		.setDisabled(totalPages === 0 || currentPage === 1);

	const lastPageBtn = new ButtonBuilder()
		.setLabel("Fin")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`last-page${target ? `:${target}` : ""}`)
		.setEmoji("⏩")
		.setDisabled(totalPages === 0 || currentPage === totalPages);

	return [firstPageBtn, previousBtn, nextBtn, lastPageBtn];
}

export function buildReturnButton() {
	return new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("return")
		.setEmoji("↩️");
}

export function buildApproveDenyButtons() {
	const approveBtn = new ButtonBuilder()
		.setLabel("Approuver")
		.setStyle(ButtonStyle.Success)
		.setCustomId("approve")
		.setEmoji("✅");
	const denyBtn = new ButtonBuilder()
		.setLabel("Rejeter")
		.setStyle(ButtonStyle.Danger)
		.setCustomId("deny")
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);
}

export function buildConfirmCancelButtons() {
	const confirmBtn = new ButtonBuilder()
		.setLabel("Confirmer")
		.setStyle(ButtonStyle.Success)
		.setCustomId("confirm")
		.setEmoji("✅");
	const cancelBtn = new ButtonBuilder()
		.setLabel("Annuler")
		.setStyle(ButtonStyle.Danger)
		.setCustomId("cancel")
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

export function buildClanCreationModal() {
	const modal = new ModalBuilder().setTitle("Création de Clan").setCustomId("createClan1");
	const clanName = new TextInputBuilder()
		.setCustomId("clanName")
		.setStyle(TextInputStyle.Short)
		.setMinLength(2)
		.setMaxLength(30)
		.setPlaceholder("Les noms inappropriés seront rejetés");
	const clanNameLabel = new LabelBuilder().setLabel("Nom du Clan").setTextInputComponent(clanName);
	const clanShortenedName = new TextInputBuilder()
		.setCustomId("clanShortenedName")
		.setStyle(TextInputStyle.Short)
		.setPlaceholder("ex. PSG, 𝕯𝕽, etc.")
		.setMinLength(2)
		.setMaxLength(6);
	const clanShortenedNameLabel = new LabelBuilder()
		.setLabel("Sigle du Clan")
		.setTextInputComponent(clanShortenedName);
	const clanBiography = new TextInputBuilder()
		.setCustomId("clanBiography")
		.setStyle(TextInputStyle.Paragraph)
		.setMinLength(15)
		.setMaxLength(1500) // Limit so the embed is not disgusting
		.setPlaceholder("La présentation de votre Clan...");
	const clanBiographyLabel = new LabelBuilder()
		.setLabel("Biographie de Clan")
		.setTextInputComponent(clanBiography);
	const socialMedia = new TextInputBuilder()
		.setCustomId("socialMedia")
		.setStyle(TextInputStyle.Short)
		.setPlaceholder("Twitter, Instagram or TikTok")
		.setMaxLength(60);
	const socialMediaLabel = new LabelBuilder()
		.setLabel("Lien d'un réseau social")
		.setTextInputComponent(socialMedia);
	const guildId = new TextInputBuilder()
		.setCustomId("guildId")
		.setStyle(TextInputStyle.Short)
		.setPlaceholder(
			"Seuls les serveurs dont vous êtes le propriétaire et sur lequel se trouvent le bot seront acceptés"
		)
		.setMinLength(18) // Snowflakes are length 18 at least
		.setMaxLength(20) // Handling extreme cases
		.setRequired(false);
	const guildIdLabel = new LabelBuilder()
		.setLabel("ID Serveur Discord")
		.setTextInputComponent(guildId);

	modal.addLabelComponents(
		clanNameLabel,
		clanShortenedNameLabel,
		clanBiographyLabel,
		socialMediaLabel,
		guildIdLabel
	);

	return modal;
}

export function buildValidationModal(msgToValidate: string) {
	const modal = new ModalBuilder().setTitle("Validez votre action").setCustomId("modalValidation");
	const userInput = new TextInputBuilder()
		.setCustomId("userInput")
		.setStyle(TextInputStyle.Short)
		.setMaxLength(msgToValidate.length)
		.setMinLength(msgToValidate.length)
		.setPlaceholder(msgToValidate);
	const userInputLabel = new LabelBuilder()
		.setLabel("Réécrivez le message ci-dessous")
		.setTextInputComponent(userInput);

	modal.addLabelComponents(userInputLabel);

	return modal;
}

export function buildClanManagementMainMenuButtons() {
	const clanDataBtn = new ButtonBuilder()
		.setLabel("Infos")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanInfos")
		.setEmoji("📜");

	const clanMembersBtn = new ButtonBuilder()
		.setLabel("Membres")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanMembers")
		.setEmoji("👥");

	const invitesBtn = new ButtonBuilder()
		.setLabel("Invitations")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("invites")
		.setEmoji("📩");

	const clanSettingsBtn = new ButtonBuilder()
		.setLabel("Paramètres")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanSettings")
		.setEmoji("⚙️");

	// const clanCardBtn = new ButtonBuilder()
	// 	.setLabel('Card')
	// 	.setStyle(ButtonStyle.Primary)
	// 	.setCustomId('clanCard')
	// 	.setEmoji('🪪')
	// 	.setDisabled(true)

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		clanDataBtn,
		clanMembersBtn,
		invitesBtn,
		clanSettingsBtn
	);
}

export function buildClanManagementInfosEditButtons() {
	const clanNameBtn = new ButtonBuilder()
		.setLabel("Nom")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanName")
		.setEmoji("📝");

	const clanBiographyBtn = new ButtonBuilder()
		.setLabel("Biographie")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanBiography")
		.setEmoji("📖");

	const clanSocialBtn = new ButtonBuilder()
		.setLabel("Réseaux sociaux")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanSocials")
		.setEmoji("🌐");

	const clanLogoBtn = new ButtonBuilder()
		.setLabel("Logo")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanLogo")
		.setEmoji("🖼️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		clanNameBtn,
		clanBiographyBtn,
		clanSocialBtn,
		clanLogoBtn,
		buildReturnToMenuButton()
	);
}

export function buildReturnToMenuButton() {
	return new ButtonBuilder()
		.setLabel("Menu")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("returnToMenu")
		.setEmoji("↩️");
}

export function buildClansSelector(clans: Clan[]) {
	const stringOptions = clans.map((clan) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(`[${clan.shortenedName}] ${clan.name}`)
			.setValue(String(clan.id))
	);

	return new StringSelectMenuBuilder()
		.setCustomId("clanSelector")
		.setPlaceholder("Sélectionnez un Clan")
		.addOptions(stringOptions);
}

export function buildClanMembersSelector(clanMembers: ClanMember[], guild: Guild) {
	const stringOptions = clanMembers.map((member) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(guild.members.cache.get(member.user.id)?.displayName || "Unknown")
			.setValue(member.user.id)
	);

	return new StringSelectMenuBuilder()
		.setCustomId("clanMembersSelector")
		.setPlaceholder("Sélectionnez un Membre")
		.addOptions(stringOptions);
}

export function buildClanInvitesSelector(invites: ClanInvite[], guild: Guild) {
	const stringOptions = invites.map((invite) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(guild.members.cache.get(invite.user.id)?.displayName || "Unknown")
			.setValue(invite.user.id)
	);

	return new StringSelectMenuBuilder()
		.setCustomId("clanInvitesSelector")
		.setPlaceholder("Sélectionnez une invitation")
		.addOptions(stringOptions);
}

export function buildClanSettingsButtons(clan: Clan) {
	const recruitingBtn = new ButtonBuilder()
		.setLabel("Recrute")
		.setStyle(clan.isRecruiting ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId("clanRecruiting")
		.setEmoji(clan.isRecruiting ? "✅" : "✖️");

	const autoRecruitBtn = new ButtonBuilder()
		.setLabel("Recrutement auto")
		.setStyle(clan.autoAcceptMembers ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId("clanAutoRecruit")
		.setEmoji(clan.autoAcceptMembers ? "✅" : "✖️");

	const hiddenBtn = new ButtonBuilder()
		.setLabel("Clan caché")
		.setStyle(clan.isHidden ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId("clanHidden")
		.setEmoji(clan.isHidden ? "✅" : "✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		recruitingBtn,
		autoRecruitBtn,
		hiddenBtn,
		buildReturnToMenuButton()
	);
}

export function buildSimpleModal(
	modalId: string,
	modalTitle: string,
	textInputLabel: string,
	textLength: "short" | "long",
	value?: string,
	placeholder?: string
) {
	const modal = new ModalBuilder().setTitle(modalTitle).setCustomId(modalId);

	const textInput = new TextInputBuilder()
		.setCustomId("textInput")
		.setStyle(textLength === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
		.setRequired(true)
		.setMinLength(5)
		.setMaxLength(1500);

	const textInputLabelComponent = new LabelBuilder()
		.setLabel(textInputLabel)
		.setTextInputComponent(textInput);

	if (value) {
		textInput.setValue(value);
	}
	if (placeholder) {
		textInput.setPlaceholder(placeholder!);
	}

	modal.addLabelComponents(textInputLabelComponent);

	return modal;
}

export function buildNameChangeModal(nameValue: string, shortNameValue: string) {
	const modal = new ModalBuilder()
		.setTitle("Changement de nom du Clan")
		.setCustomId("clanNameModal");

	const nameInput = new TextInputBuilder()
		.setCustomId("nameInput")
		.setValue(nameValue)
		.setStyle(TextInputStyle.Short);
	const nameInputComponent = new LabelBuilder()
		.setLabel("Nom du Clan")
		.setTextInputComponent(nameInput);

	const shortNameInput = new TextInputBuilder()
		.setStyle(TextInputStyle.Short)
		.setCustomId("shortNameInput")
		.setValue(shortNameValue);
	const shortNameInputComponent = new LabelBuilder()
		.setLabel("Sigle du Clan")
		.setTextInputComponent(shortNameInput);

	modal.addLabelComponents(nameInputComponent, shortNameInputComponent);

	return modal;
}

export function buildClanSocialsModal(clan: Clan) {
	const modal = new ModalBuilder()
		.setTitle("Modifier les Réseaux du Clan")
		.setCustomId("clanSocialsModal");

	const xInput = new TextInputBuilder()
		.setLabel("Lien du compte X")
		.setCustomId("xInput")
		.setStyle(TextInputStyle.Short)
		.setRequired(false);

	if (clan.xUrl) {
		xInput.setValue(clan.xUrl);
	} else {
		xInput.setPlaceholder("https://twitter.com/youraccount");
	}

	const instagramInput = new TextInputBuilder()
		.setLabel("Lien du compte Instagram")
		.setCustomId("instagramInput")
		.setStyle(TextInputStyle.Short)
		.setRequired(false);

	if (clan.instagramUrl) {
		instagramInput.setValue(clan.instagramUrl);
	} else {
		instagramInput.setPlaceholder("https://instagram.com/youraccount");
	}

	const tikTokInput = new TextInputBuilder()
		.setLabel("Lien du compte TikTok")
		.setCustomId("tikTokInput")
		.setStyle(TextInputStyle.Short)
		.setRequired(false);

	if (clan.tiktokUrl) {
		tikTokInput.setValue(clan.tiktokUrl);
	} else {
		tikTokInput.setPlaceholder("https://tiktok.com/@youraccount");
	}

	const actionRows: ActionRowBuilder<TextInputBuilder>[] = [
		new ActionRowBuilder<TextInputBuilder>().addComponents(xInput),
		new ActionRowBuilder<TextInputBuilder>().addComponents(instagramInput),
		new ActionRowBuilder<TextInputBuilder>().addComponents(tikTokInput),
	];
	actionRows.forEach((aRow) => {
		modal.addComponents(aRow);
	});

	return modal;
}

export function buildClanMemberManagementButtons(
	member: ClanMember,
	cmdUser: ClanMember,
	maxSubCptCount: boolean
) {
	const promoteToMemberBtn = new ButtonBuilder()
		.setLabel("Promouvoir")
		.setStyle(ButtonStyle.Success)
		.setCustomId("promoteToMember")
		.setEmoji("⚽")
		.setDisabled(member.role >= ClanMemberRole.Member);

	const demoteToMemberBtn = new ButtonBuilder()
		.setLabel("Rétrograder")
		.setStyle(ButtonStyle.Danger)
		.setCustomId("demoteToMember")
		.setEmoji("⚽")
		.setDisabled(cmdUser.role <= member.role);

	const promoteToSubCaptainBtn = new ButtonBuilder()
		.setLabel("Promouvoir Vice-Président")
		.setStyle(ButtonStyle.Success)
		.setCustomId("promoteToSubCaptain")
		.setEmoji("🎖️")
		.setDisabled(
			cmdUser.role < ClanMemberRole.SubCaptain ||
				member.role > ClanMemberRole.Member ||
				maxSubCptCount
		);

	const manageDistinctions = new ButtonBuilder()
		.setLabel("Editer les distinctions")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`editDistinctions:${member.user.id}:${member.clan.id}`)
		.setEmoji("✏️")
		.setDisabled(cmdUser.role !== ClanMemberRole.Captain && cmdUser.role <= member.role);

	const kickBtn = new ButtonBuilder()
		.setLabel("Expulser")
		.setStyle(ButtonStyle.Danger)
		.setCustomId("kickMember")
		.setEmoji("👢")
		.setDisabled(cmdUser.role <= member.role || member.role === ClanMemberRole.Captain);

	const returnBtn = new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("clanMembers")
		.setEmoji("↩️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		member.role > ClanMemberRole.Member ? demoteToMemberBtn : promoteToMemberBtn,
		promoteToSubCaptainBtn,
		manageDistinctions,
		kickBtn,
		returnBtn
	);
}

export function buildClanInviteManagementButtons(
	inviter: ClanMember,
	interactionMember: ClanMember
) {
	const revokeBtn = new ButtonBuilder()
		.setLabel("Révoquer")
		.setStyle(ButtonStyle.Danger)
		.setCustomId("revokeInvite")
		.setEmoji("✖️")
		.setDisabled(inviter !== interactionMember && inviter.role <= interactionMember.role);

	const returnBtn = new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("invites")
		.setEmoji("↩️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(revokeBtn, returnBtn);
}

export function buildConfirmCancelInviteButtons(inviteId: string) {
	const confirmBtn = new ButtonBuilder()
		.setLabel("Confirmer")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`confirm_invite:${inviteId}`)
		.setEmoji("✅");
	const cancelBtn = new ButtonBuilder()
		.setLabel("Refuser")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`cancel_invite:${inviteId}`)
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

export function buildConfirmCancelApplicationButtons(applicationId: string) {
	const confirmBtn = new ButtonBuilder()
		.setLabel("Accepter")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`confirm_application:${applicationId}`)
		.setEmoji("✅");
	const cancelBtn = new ButtonBuilder()
		.setLabel("Refuser")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`refuse_application:${applicationId}`)
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

export function buildInviteToClanButton(targetId: string) {
	return new ButtonBuilder()
		.setLabel("Invitation de Clan")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`init_invite:${targetId}`)
		.setEmoji("📩")
		.setDisabled(false);
}

export function buildVoteButtons(proposalId: string) {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`vote:approve:${proposalId}`)
			.setStyle(ButtonStyle.Success)
			.setLabel("Approuver"),
		new ButtonBuilder()
			.setCustomId(`vote:reject:${proposalId}`)
			.setStyle(ButtonStyle.Danger)
			.setLabel("Rejeter")
	);
}

export function buildClanHistoryButton(userId: string, disabled: boolean = false) {
	return new ButtonBuilder()
		.setLabel("Carrière")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`get_clan_history:${userId}`)
		.setEmoji("📜")
		.setDisabled(disabled);
}

export function buildApplicationCreationButtons(clanId: string, distinctions: string) {
	const confirmBtn = new ButtonBuilder()
		.setLabel("Oui")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`create_application:${clanId}:${distinctions}`)
		.setEmoji("✅");
	const cancelBtn = new ButtonBuilder()
		.setLabel("Non")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`cancel_application:${clanId}`)
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

export function buildApplicationInitButton(clanId: string, disabled: boolean = false) {
	return new ButtonBuilder()
		.setLabel("Postuler")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`init_application:${clanId}`)
		.setEmoji("📝")
		.setDisabled(disabled);
}

export function buildClanTeamsMenuButtonRow(clan: Clan) {
	const team1 = new ButtonBuilder()
		.setLabel("Team 1")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_manager_btn:${clan.id}:1`)
		.setEmoji("1️⃣");

	const team2 = new ButtonBuilder()
		.setLabel("Team 2")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_manager_btn:${clan.id}:2`)
		.setEmoji("2️⃣");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(team1, team2);
}

export function buildClanTeamManagementButtonRow(team: ClanTeam) {
	const players = new ButtonBuilder()
		.setLabel("Joueurs")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_edit_btn:${team.type}:${TeamMemberRole.PLAYER}`);

	const subs = new ButtonBuilder()
		.setLabel("Remplaçants")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_edit_btn:${team.type}:${TeamMemberRole.SUB}`);

	const coach = new ButtonBuilder()
		.setLabel("Coach")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_edit_btn:${team.type}:${TeamMemberRole.COACH}`);

	const settings = new ButtonBuilder()
		.setLabel("Paramètres")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`team_settings_btn:${team.id}`);

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		players,
		subs,
		coach,
		settings,
		buildReturnToTeamsMenuButton()
	);
}

export async function buildTeamManagementModal(team: ClanTeam, role: TeamMemberRole) {
	const config = TEAM_MEMBER_ROLE_CONFIG[role];
	const roleLinks = (await team.links.loadItems()).filter((l) => l.role === role);
	const components = Array.from({ length: config.max }, (_, i) => {
		const link = roleLinks[i];

		const input = new TextInputBuilder()
			.setCustomId(`${config.inputPrefix}_${i + 1}:${team.type}:${team.clan.id}`)
			.setStyle(TextInputStyle.Short)
			.setMinLength(18)
			.setMaxLength(20)
			.setRequired(false);

		if (link)
			input.setValue(link.member.user.id); // 👈 use ID, not username
		else input.setPlaceholder(`ID ${config.label}`);

		return new LabelBuilder().setLabel(`${config.label} ${i + 1}`).setTextInputComponent(input);
	});

	if (components.length < 1)
		throw new Error(`Impossible de créer le modal de gestion d'équipe pour ${config.label}`);

	const modal = new ModalBuilder()
		.setCustomId(`team_manager_modal:${team.id}:${role}`)
		.setTitle(`Gestion ${config.frenchLabel === "coach" ? "du" : "des"} ${config.frenchLabel}`);

	modal.addLabelComponents(components);

	return modal;
}

export function buildTeamSettingsModal(team: ClanTeam) {
	const nameInput = new TextInputBuilder()
		.setCustomId(`team_settings_name:${team.id}`)
		.setStyle(TextInputStyle.Short)
		.setMinLength(3)
		.setMaxLength(30);

	if (team.name) nameInput.setValue(team.name);
	else
		nameInput.setPlaceholder(
			`Equipe ${team.type === ClanTeamType.MAIN ? "principale" : "secondaire"}`
		);

	const nameLabel = new LabelBuilder()
		.setLabel("Nom de l'équipe")
		.setTextInputComponent(nameInput)
		.setDescription(`Max. 30 caractères`);

	const teamMembers = team.links
		.filter((member) => member.role === TeamMemberRole.PLAYER)
		.map((member) => {
			const option = new StringSelectMenuOptionBuilder()
				.setLabel(escapeMarkdown(member.member.user.displayName))
				.setValue(member.member.user.id);

			if (team.captain && team.captain.member.user.id === member.member.user.id)
				option.setDefault(true);

			return option;
		});

	const modal = new ModalBuilder()
		.setCustomId(`team_settings_modal:${team.id}`)
		.setTitle("Paramètres de l'équipe");

	modal.addLabelComponents(nameLabel);

	if (team.captain) {
		const captainSelect = new StringSelectMenuBuilder()
			.addOptions(teamMembers)
			.setCustomId(`team_settings_captain:${team.id}`);

		const captainLabel = new LabelBuilder()
			.setLabel("Capitaine de l'équipe")
			.setStringSelectMenuComponent(captainSelect);

		modal.addLabelComponents(captainLabel);
	}

	return modal;
}

export function buildReturnToTeamsMenuButton() {
	return new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId("return_teams_menu")
		.setEmoji("↩️");
}

export function buildDedicatedApproveDenyButtons(target: string, targetId: string) {
	const approveBtn = new ButtonBuilder()
		.setLabel("Accepter")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`${target}:${targetId}:1`)
		.setEmoji("✅");
	const denyBtn = new ButtonBuilder()
		.setLabel("Refuser")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`${target}:${targetId}:0`)
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);
}

export function buildLineupsButtons(interclan: Interclan) {
	const isAValid = interclan.getLineupA()?.isValidLineup() ?? false;
	const isBValid = interclan.getLineupB()?.isValidLineup() ?? false;

	const isALocked = interclan.getLineupA()?.lockedIn ?? false;
	const isBLocked = interclan.getLineupB()?.lockedIn ?? false;

	const clanALineupBtn = new ButtonBuilder()
		.setLabel(`Lineup ${interclan.clanA.name}`)
		.setStyle(isAValid ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId(`interclan_lineup:${interclan.id}:0`)
		.setEmoji({ name: interclan.clanA.normalizedShortName, id: interclan.clanA.clanEmojiId })
		.setDisabled(isALocked);

	const clanBLineupBtn = new ButtonBuilder()
		.setLabel(`Lineup ${interclan.clanB.name}`)
		.setStyle(isBValid ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId(`interclan_lineup:${interclan.id}:1`)
		.setEmoji({ name: interclan.clanB.normalizedShortName, id: interclan.clanB.clanEmojiId })
		.setDisabled(isBLocked);

	const lockInBtnA = new ButtonBuilder()
		.setLabel("Verrouiller")
		.setStyle(ButtonStyle.Primary)
		.setEmoji("🔒")
		.setDisabled(!isAValid || isALocked)
		.setCustomId(`lock_interclan_lineup:${interclan.id}:0`);

	const lockInBtnB = new ButtonBuilder()
		.setLabel("Verrouiller")
		.setStyle(ButtonStyle.Primary)
		.setEmoji("🔒")
		.setDisabled(!isBValid || isBLocked)
		.setCustomId(`lock_interclan_lineup:${interclan.id}:1`);

	const cancelInterclan = new ButtonBuilder()
		.setLabel("Annuler")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`cancel_interclan:${interclan.id}`)
		.setEmoji("❌");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		clanALineupBtn,
		lockInBtnA,
		clanBLineupBtn,
		lockInBtnB,
		cancelInterclan
	);
}

export async function buildLineupManagementModal(lineup: InterclanLineup) {
	// 1️⃣ Load all members (with their member.user relation)
	const lineupMembers = await lineup.members.loadItems({
		populate: ["user"],
	});

	// 2️⃣ Sort members by their position (1..5)
	const orderedMembers = lineupMembers.toSorted((a, b) => a.position - b.position);

	// 3️⃣ Create 5 inputs (slots 1 → 5)
	const components = Array.from({ length: 5 }, (_, i) => {
		// Find the lineup member assigned to this position (positions start at 1)
		const lineupMember = orderedMembers.find((m) => m.position === i + 1);

		const input = new TextInputBuilder()
			.setCustomId(`lineup_member_${i + 1}`)
			.setStyle(TextInputStyle.Short)
			.setMinLength(18)
			.setMaxLength(20)
			.setRequired(false);

		if (lineupMember) {
			// Show the Discord ID of the player in that slot
			input.setValue(lineupMember.user.id);
		} else {
			input.setPlaceholder("ID Joueur");
		}

		return new LabelBuilder().setLabel(`Joueur ${i + 1}`).setTextInputComponent(input);
	});

	// 4️⃣ Safety check
	if (components.length < 1)
		throw new Error(`Unable to create team manager modal for lineup management`);

	// 5️⃣ Build the modal
	const modal = new ModalBuilder()
		.setCustomId(`lineup_manager_modal:${lineup.clan.id}:${lineup.event.id}`)
		.setTitle(`Gestion de la lineup ${lineup.clan.name}`);

	modal.addLabelComponents(components);

	return modal;
}

export function buildInterclanStartButtons(interclan: Interclan) {
	const startInterclan = new ButtonBuilder()
		.setLabel("Commencer")
		.setStyle(ButtonStyle.Success)
		.setCustomId(`start_interclan:${interclan.id}`)
		.setEmoji("⚽");

	const cancelInterclan = new ButtonBuilder()
		.setLabel("Annuler")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`cancel_interclan:${interclan.id}`)
		.setEmoji("❌");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(startInterclan, cancelInterclan);
}

export function buildInterclanMatchButtons(interclan: Interclan) {
	const lobbies = interclan.lobbies.getItems();

	if (lobbies.length === 0) {
		throw new Error("Aucun match trouvé pour cet interclan.");
	}

	// Build buttons (Discord: max 5 per row)
	const buttons = lobbies.slice(0, 5).map((lobby, index) => {
		const isFinished = lobby.state === LobbyState.FINISHED;

		return new ButtonBuilder()
			.setLabel(isFinished ? `Match ${index + 1} — Terminé` : `Match ${index + 1}`)
			.setStyle(isFinished ? ButtonStyle.Secondary : ButtonStyle.Primary)
			.setCustomId(`interclan_match:${interclan.id}:${lobby.id}`)
			.setEmoji(isFinished ? "✅" : "⚽")
			.setDisabled(isFinished);
	});

	return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

export function buildInterclanMatchScoreModal(lobby: Lobby) {
	const playerTeams = lobby.getTeams();
	const playerA = playerTeams[0].at(0);
	const playerB = playerTeams[1].at(0);

	if (!playerA || !playerB) throw new Error("Could not find players for this match");

	const modal = new ModalBuilder()
		.setCustomId(`interclan_match_result_modal:${lobby.id}`)
		.setTitle(`Résultat du match #${lobby.id}`);

	const scoreAInput = new TextInputBuilder()
		.setCustomId("score_a")
		.setValue(lobby.getTeamScore(TeamSide.TEAM_1).toString())
		.setMinLength(1)
		.setMaxLength(2)
		.setRequired(true)
		.setStyle(TextInputStyle.Short);

	const scoreBInput = new TextInputBuilder()
		.setCustomId("score_b")
		.setValue(lobby.getTeamScore(TeamSide.TEAM_2).toString())
		.setMinLength(1)
		.setMaxLength(2)
		.setRequired(true)
		.setStyle(TextInputStyle.Short);

	const labelA = new LabelBuilder()
		.setLabel(`${escapeMarkdown(playerA.user.displayName)}`)
		.setTextInputComponent(scoreAInput);

	const labelB = new LabelBuilder()
		.setLabel(`${escapeMarkdown(playerB.user.displayName)}`)
		.setTextInputComponent(scoreBInput);

	modal.addLabelComponents(labelA, labelB);

	return modal;
}

export function buildApplicationDistinctionSelector(
	clanId: number,
	target: "invite" | "apply",
	targetUserId?: string
) {
	const menu = new StringSelectMenuBuilder()
		.setCustomId(`${target}_distinctions:${target === "apply" ? clanId : targetUserId}`)
		.setPlaceholder("Choisissez vos distinctions")
		.setMinValues(1)
		.setMaxValues(Object.keys(ClanMemberDistinction).length);

	const options = Object.entries(ClanMemberDistinction).map(
		([key, value]) =>
			new StringSelectMenuOptionBuilder()
				.setLabel(value) // what the user sees
				.setValue(key) // what is sent back in interaction.values
	);
	menu.addOptions(options);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export async function buildGuildSettingsModal(guildEntity: GuildEntity, client: Client) {
	const guild = await client.guilds.fetch(guildEntity.id);
	await guild.channels.fetch();

	const textChannelCount = guild.channels.cache.filter((ch) =>
		[ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)
	).size;

	const modal = new ModalBuilder()
		.setCustomId(`modal_guild_broadcast_channel:${guildEntity.id}`)
		.setTitle("Sélection des salons de Guilde");

	if (textChannelCount > 25) {
		const broadcastChannelInput = new TextInputBuilder()
			.setCustomId(`input_guild_broadcast_channel`)
			.setStyle(TextInputStyle.Short)
			.setMinLength(18)
			.setMaxLength(20)
			.setRequired(false);

		if (guildEntity.broadcastChannel) broadcastChannelInput.setValue(guildEntity.broadcastChannel);
		else broadcastChannelInput.setPlaceholder(`ex. 1320451424689193070`);

		const nameLabel = new LabelBuilder()
			.setLabel("ID du salon des annonces du Clan")
			.setTextInputComponent(broadcastChannelInput);

		modal.addLabelComponents(nameLabel);

		return modal;
	}

	const menu = new ChannelSelectMenuBuilder()
		.setCustomId(`select_guild_broadcast_channel`)
		.setPlaceholder("Choisissez un salon")
		.setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]); // 👈 only allow text & announcement channels

	const menuLabel = new LabelBuilder()
		.setLabel("ID du salon des annonces du Clan")
		.setChannelSelectMenuComponent(menu);

	if (guildEntity.broadcastChannel) {
		const broadcastChannel = guild.channels.cache.get(guildEntity.broadcastChannel);

		if (broadcastChannel !== undefined) menu.setDefaultChannels(guildEntity.broadcastChannel);
	}

	modal.addLabelComponents(menuLabel);

	return modal;
}

export function buildGuildSettingsButtons(guildEntity: GuildEntity, isBoundToClan: boolean) {
	const broadcastChannel = new ButtonBuilder()
		.setLabel("Annonces de Clan")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`broadcast_channel_button:${guildEntity.id}`)
		.setEmoji("📢");

	const broadcastChannelManager = new ButtonBuilder()
		.setLabel("Gérer les annonces")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`broadcast_management_button:${guildEntity.id}`)
		.setEmoji("🔇")
		.setDisabled(guildEntity.broadcastChannel === null);

	const bindClan = new ButtonBuilder()
		.setLabel("Lier à un Clan")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`bind_clan_guild:${guildEntity.id}`)
		.setEmoji("🔗");

	const unbindClan = new ButtonBuilder()
		.setLabel("Dissocier du Clan")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`unbind_clan_guild:${guildEntity.id}`)
		.setEmoji("✖️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		broadcastChannel,
		broadcastChannelManager,
		isBoundToClan ? unbindClan : bindClan
	);
}

export function safeGetTextInput(
	interaction: ModalSubmitInteraction,
	customId: string
): string | null {
	try {
		return interaction.fields.getTextInputValue(customId);
	} catch {
		return null;
	}
}

export function safeGetSelectValue(
	interaction: ModalSubmitInteraction,
	customId: string
): string | null {
	try {
		// getStringSelectValues returns an array of string channel IDs
		return interaction.fields.getStringSelectValues(customId)?.at(0) ?? null;
	} catch {
		return null;
	}
}

export function buildGuildBroadcastManagementButtons(guildEntity: GuildEntity) {
	const deleteBroadcastChannel = new ButtonBuilder()
		.setLabel("Supprimer le salon d'annonces")
		.setStyle(ButtonStyle.Danger)
		.setCustomId(`delete_broadcast_channel_button:${guildEntity.id}`)
		.setEmoji("🔇");

	const rankedBroadcast = new ButtonBuilder()
		.setLabel("Annonces Ranked")
		.setStyle(guildEntity.rankedEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
		.setCustomId(`ranked_broadcast_toggle:${guildEntity.id}`)
		.setEmoji(guildEntity.rankedEnabled ? "📢" : "🔇");

	const returnBtn = new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`guild_settings_menu:${guildEntity.id}`)
		.setEmoji("↩️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		deleteBroadcastChannel,
		rankedBroadcast,
		returnBtn
	);
}

export function buildDistinctionsEditorSelector(clanMember: ClanMember) {
	const menu = new StringSelectMenuBuilder()
		.setCustomId(`edit_distinctions:${clanMember.user.id}:${clanMember.clan.id}`)
		.setPlaceholder("Choisissez les distinctions")
		.setMinValues(1)
		.setMaxValues(Object.keys(ClanMemberDistinction).length);

	const options = Object.entries(ClanMemberDistinction).map(([key, value]) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(value) // what the user sees
			.setValue(key) // what is sent back in interaction.values
			.setDefault(clanMember.distinctions.includes(value))
	);
	menu.addOptions(options);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildReturnButtonSelector(clanMember: ClanMember) {
	const returnBtn = new ButtonBuilder()
		.setLabel("Retour")
		.setStyle(ButtonStyle.Primary)
		.setCustomId(`return_to_member_menu:${clanMember.user.id}:${clanMember.clan.id}`)
		.setEmoji("↩️");

	return new ActionRowBuilder<ButtonBuilder>().addComponents(returnBtn);
}
