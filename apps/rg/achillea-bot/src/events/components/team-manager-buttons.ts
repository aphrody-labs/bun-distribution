import { rel } from "@mikro-orm/core";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Guard, Injectable, ModalComponent } from "@/decorators";
import { ClanMember, ClanTeamMember, User } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database } from "@/services";
import {
	createTeamDisplayEmbed,
	createTeamManagerEmbed,
	followUpWithErrorEmbed,
} from "@/utils/functions";

import { ClanTeam } from "../../entities/ClanTeam";
import { ClanMemberRole } from "../../utils/enums";
import { ClanTeamType } from "../../utils/enums/clanTeamType";
import { TEAM_MEMBER_ROLE_CONFIG, TeamMemberRole } from "../../utils/enums/teamMemberRole";
import {
	buildClanTeamManagementButtonRow,
	buildClanTeamsMenuButtonRow,
	buildTeamManagementModal,
	buildTeamSettingsModal,
} from "../../utils/functions/components";

@Discord()
@Injectable()
export class TeamManagerButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^team_manager_btn:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async manageTeam(interaction: ButtonInteraction, client: Client, { clan }: InteractionData) {
		await interaction.deferUpdate();
		const [, clanId, teamNb] = interaction.customId.split(":");

		if (clan.id !== Number(clanId)) return;

		const team = await this.db
			.get(ClanTeam)
			.findOne(
				{ clan: Number(clanId), type: Number(teamNb) === 1 ? ClanTeamType.MAIN : ClanTeamType.SUB },
				{ populate: ["clan", "links", "links.member.user", "captain.member.user"] }
			);

		if (!team) return followUpWithErrorEmbed(interaction, `Team ${teamNb} does not exist`);

		return await interaction.editReply({
			embeds: [await createTeamDisplayEmbed(team, this.db)],
			components: [buildClanTeamManagementButtonRow(team)],
		});
	}

	@ButtonComponent({ id: "return_teams_menu" })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async returnToTeamsMenu(
		interaction: ButtonInteraction,
		client: Client,
		{ clan }: InteractionData
	) {
		await interaction.deferUpdate();
		await interaction.editReply({
			embeds: [await createTeamManagerEmbed(clan, this.db)],
			components: [buildClanTeamsMenuButtonRow(clan)],
		});
	}

	@ButtonComponent({ id: /^team_edit_btn:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async editTeam(interaction: ButtonInteraction, client: Client, { clan }: InteractionData) {
		const [, teamType, target] = interaction.customId.split(":");

		const team = await this.db
			.get(ClanTeam)
			.findOne(
				{ clan: clan.id, type: Number(teamType) === 0 ? ClanTeamType.MAIN : ClanTeamType.SUB },
				{ populate: ["clan", "links", "links.member.user", "captain.member.user"] }
			);

		if (!team) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(interaction, `Team ${teamType + 1} does not exist`);
		}

		const targetAsNumber = Number(target);

		if (Number.isNaN(targetAsNumber)) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(interaction, `Target team ${target} is not valid`);
		}

		try {
			const modal = await buildTeamManagementModal(team, targetAsNumber);
			await interaction.showModal(modal);
		} catch (err: any) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(interaction, `${err.message}`);
		}
	}

	@ButtonComponent({ id: /^team_settings_btn:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async teamSettings(interaction: ButtonInteraction, client: Client, { clan }: InteractionData) {
		const [, teamIdStr] = interaction.customId.split(":");

		const teamId = Number(teamIdStr);

		if (Number.isNaN(teamId))
			return followUpWithErrorEmbed(interaction, `Target team ${teamIdStr} is not valid`);

		const team = await this.db
			.get(ClanTeam)
			.findOne(
				{ id: teamId },
				{ populate: ["clan", "links", "links.member.user", "captain.member.user"] }
			);

		if (!team) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(interaction, `Team ${teamIdStr} does not exist`);
		}

		try {
			const modal = buildTeamSettingsModal(team);
			await interaction.showModal(modal);
		} catch (err: any) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(interaction, `${err.message}`);
		}
	}

	@ModalComponent({ id: /^team_manager_modal:.+/ })
	async handleTeamManagerModal(interaction: ModalSubmitInteraction) {
		await interaction.deferUpdate();

		const [, teamIdStr, roleIndexStr] = interaction.customId.split(":");
		const teamId = Number(teamIdStr);
		const roleIndex = Number(roleIndexStr);

		if (Number.isNaN(teamId)) return followUpWithErrorEmbed(interaction, `Invalid team id`, true);

		if (Number.isNaN(roleIndex))
			return followUpWithErrorEmbed(interaction, "Invalid role index", true);

		const role = roleIndex as TeamMemberRole;
		if (!(role in TeamMemberRole)) {
			return followUpWithErrorEmbed(interaction, `Unknown role with index: ${roleIndex}`, true);
		}

		const team = await this.db
			.get(ClanTeam)
			.findOne({ id: teamId }, { populate: ["clan", "links.member.user", "captain.member.user"] });

		if (!team) return followUpWithErrorEmbed(interaction, `Team ${teamId} was not found`, true);

		const config = TEAM_MEMBER_ROLE_CONFIG[role];

		const inputIds: string[] = [];
		for (let i = 1; i <= config.max; i++) {
			try {
				const value = interaction.fields.getTextInputValue(
					`${config.inputPrefix}_${i}:${team.type}:${team.clan.id}`
				);
				if (value && value.trim() !== "") inputIds.push(value.trim());
			} catch {
				// Field might not exist (e.g., coach has only one)
			}
		}

		try {
			const validMembers = await this.validateIds(inputIds, team);
			await this.updateTeamLinksForRole(team, validMembers, role, interaction.user.id);
			await interaction.editReply({
				embeds: [await createTeamDisplayEmbed(team, this.db)],
				components: [buildClanTeamManagementButtonRow(team)],
			});
		} catch (err: any) {
			console.info(err);

			followUpWithErrorEmbed(interaction, err.message, true);
		}
	}

	private async validateIds(inputIds: string[], team: ClanTeam) {
		if (inputIds.length === 0) return [];

		const clanMembers = await this.db.em.find(ClanMember, {
			user: { $in: inputIds },
			clan: team.clan.id,
		});

		const validIds = new Set(clanMembers.map((m) => m.user.id));
		const invalidIds = inputIds.filter((id) => !validIds.has(id));

		if (invalidIds.length > 0) {
			throw new Error(`Les IDs suivants sont invalides: ${invalidIds.join(", ")}`);
		}

		return clanMembers;
	}

	private async updateTeamLinksForRole(
		team: ClanTeam,
		validMembers: ClanMember[],
		role: TeamMemberRole,
		updater: string
	) {
		// 1️⃣ Filter only links for this role

		const currentRoleLinks = (await team.links.loadItems()).filter((l) => l.role === role);
		const currentIds = new Set(currentRoleLinks.map((l) => l.member.user.id));
		const validIds = new Set(validMembers.map((m) => m.user.id));

		const toRemove = currentRoleLinks.filter((l) => !validIds.has(l.member.user.id));
		const toAdd = validMembers.filter((m) => !currentIds.has(m.user.id));

		// 3️⃣ Role limits
		const limitByRole: Record<TeamMemberRole, number> = {
			[TeamMemberRole.PLAYER]: 5,
			[TeamMemberRole.SUB]: 2,
			[TeamMemberRole.COACH]: 1,
		};

		if (validMembers.length > limitByRole[role]) {
			throw new Error(
				`Trop de ${
					role === TeamMemberRole.PLAYER
						? "joueurs"
						: role === TeamMemberRole.SUB
							? "remplaçants"
							: "coachs"
				} (limite ${limitByRole[role]}).`
			);
		}

		// 4️⃣ Transactional update
		try {
			await this.db.em.transactional(async (tem) => {
				// Remove outdated links (only for this role)
				for (const link of toRemove) tem.remove(link);

				const addedLinks: ClanTeamMember[] = [];

				// Add new ones
				for (const member of toAdd) {
					const link = new ClanTeamMember();
					link.role = role;
					link.member = member;
					link.team = team;
					link.addedBy = rel(User, updater);

					tem.persist(link);
					addedLinks.push(link);
				}

				if (role === TeamMemberRole.PLAYER) {
					const currentCaptain = team.captain;
					const remainingPlayers = (await team.links.loadItems()).filter(
						(l) => l.role === TeamMemberRole.PLAYER && !toRemove.includes(l)
					);

					// If no captain and at least one player, assign the first
					if (!currentCaptain && (addedLinks.length > 0 || remainingPlayers.length > 0)) {
						const newCaptain = addedLinks[0] ?? remainingPlayers[0];
						team.setCaptain(newCaptain);
					}

					// If captain removed, transfer to next available player
					const removedCaptain = currentCaptain && toRemove.some((l) => l.id === currentCaptain.id);
					if (removedCaptain) {
						const nextCaptain = remainingPlayers[0] ?? addedLinks[0] ?? null;
						team.setCaptain(nextCaptain);
					}
				}

				team.touch();
			});
		} catch (err) {
			console.error(err);

			throw new Error("Impossible de mettre à jour l'équipe, ce joueur est déjà utilisé", {
				cause: err,
			});
		}
	}

	@ModalComponent({ id: /^team_settings_modal:.+/ })
	async handleTeamSettingsModal(interaction: ModalSubmitInteraction) {
		await interaction.deferUpdate();

		// ─── 1️⃣ Parse modal id ───────────────────────────────────────────────
		const [, teamIdStr] = interaction.customId.split(":");
		const teamId = Number(teamIdStr);

		if (Number.isNaN(teamId)) {
			return followUpWithErrorEmbed(interaction, `Invalid team id`, true);
		}

		// ─── 2️⃣ Fetch team and populate ─────────────────────────────────────
		const team = await this.db
			.get(ClanTeam)
			.findOne({ id: teamId }, { populate: ["clan", "links.member.user", "captain.member.user"] });

		if (!team) {
			return followUpWithErrorEmbed(interaction, `Team ${teamId} not found`, true);
		}

		// ─── 3️⃣ Extract submitted fields ─────────────────────────────────────
		const newName = interaction.fields.getTextInputValue(`team_settings_name:${team.id}`)?.trim();

		// Captain select is optional (it’s a StringSelectMenuComponent)
		let newCaptainId: string | undefined;
		try {
			newCaptainId = interaction.fields
				.getStringSelectValues(`team_settings_captain:${team.id}`)
				.at(0);
		} catch {
			// no captain field in modal — ignore
		}

		// ─── 4️⃣ Validate and apply changes ──────────────────────────────────
		let changed = false;

		if (newName && newName !== team.name) {
			if (newName.length < 3 || newName.length > 30) {
				return followUpWithErrorEmbed(
					interaction,
					"Le nom de l’équipe doit contenir entre 3 et 30 caractères.",
					true
				);
			}
			team.name = newName;
			changed = true;
		}

		if (newCaptainId) {
			// Find the matching link
			const newCaptainLink = team.links.find(
				(l) => l.role === TeamMemberRole.PLAYER && l.member.user.id === newCaptainId
			);

			if (!newCaptainLink) {
				return followUpWithErrorEmbed(
					interaction,
					"Le capitaine choisi n’est pas un joueur de cette équipe.",
					true
				);
			}

			// Only update if different
			if (!team.captain || team.captain.id !== newCaptainLink.id) {
				team.captain = newCaptainLink;
				changed = true;
			}
		}

		if (!changed) {
			return interaction.followUp({
				content: "Aucun changement détecté.",
				flags: MessageFlags.Ephemeral,
			});
		}

		team.touch();
		await this.db.em.flush();

		await interaction.editReply({
			embeds: [await createTeamDisplayEmbed(team, this.db)],
			components: [buildClanTeamManagementButtonRow(team)],
		});
	}
}
