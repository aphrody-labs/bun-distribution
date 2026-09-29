import { Collection, rel } from "@mikro-orm/core";
import type { ButtonInteraction, ModalSubmitInteraction, TextChannel } from "discord.js";
import { escapeMarkdown, MessageFlags, roleMention } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { ButtonComponent, Discord, Guard, Injectable, ModalComponent } from "@/decorators";
import {
	ClanMember,
	Interclan,
	InterclanLineup,
	InterclanLineupMember,
	Lobby,
	User,
	User as UserEntity,
	VoteProposal,
} from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database, Logger } from "@/services";
import {
	buildErrorEmbed,
	buildInterclanLockedInEmbed,
	buildInterclanRecapEmbed,
	buildInterclanScoresEmbed,
	buildSuccessEmbed,
	createInterclanResultVoteEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	formatFrenchDate,
	interclanRecapLineupEmbed,
	resolveDependency,
} from "@/utils/functions";

import {
	ClanMemberRole,
	InterclanState,
	LobbyState,
	ProposalType,
	VotingStrategy,
} from "@/utils/enums";
import {
	buildDedicatedApproveDenyButtons,
	buildInterclanMatchButtons,
	buildInterclanMatchScoreModal,
	buildInterclanStartButtons,
	buildLineupManagementModal,
	buildLineupsButtons,
	buildVoteButtons,
} from "../../utils/functions/components";
import { cancelInterclan } from "../../utils/functions/interclans";
import { logOnAchilleaSpecificClanChannel } from "../../utils/functions/messager";

@Discord()
@Injectable()
export class InterclanButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^interclan_approval:\d+:[01]$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async handleInterclanApproval(
		interaction: ButtonInteraction,
		client: Client,
		{ clan, clanMember }: InteractionData
	) {
		await interaction.deferUpdate();

		let newChannel: TextChannel | null = null;

		try {
			const [, interclanIdStr, approvalFlag] = interaction.customId.split(":");
			const interclanId = Number(interclanIdStr);
			const isApproved = approvalFlag === "1";

			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{ populate: ["clanA", "clanB"] }
			);

			if (!interclan) {
				return followUpWithErrorEmbed(
					interaction,
					`Cet Interclan n'existe plus ou a été supprimé.`,
					true
				);
			}

			// ✅ Security: only members of the challenged clan can respond
			if (clan.id !== interclan.clanB.id) {
				return followUpWithErrorEmbed(
					interaction,
					`Seuls les membres du clan défié (${interclan.clanB.name}) peuvent répondre à ce défi.`,
					true
				);
			}

			// Check if already answered
			if (interclan.state !== InterclanState.PENDING_APPROVAL) {
				return followUpWithErrorEmbed(interaction, `Ce défi a déjà été traité.`, true);
			}

			// ✅ Update state
			interclan.state = isApproved ? InterclanState.APPROVED : InterclanState.DENIED;

			// ✅ Log or notify both clans
			const logger = await resolveDependency(Logger);
			const clanA = interclan.clanA;
			const clanB = interclan.clanB;

			const resultMsg = isApproved
				? `Le clan **${clanB.name}** a accepté le défi d'Interclan proposé par **${clanA.name}** !`
				: `Le clan **${clanB.name}** a refusé le défi d'Interclan proposé par **${clanA.name}**.`;

			// ✅ Send confirmation to the button clicker
			if (isApproved) {
				await this.db.get(Interclan).ensureLineups(interclan);

				const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);
				if (!guild)
					return followUpWithErrorEmbed(interaction, "Le serveur Achillea est injoignable");

				const channelName = interclan.name;
				const category = guild.channels.cache.find(
					(c) => c.type === 4 && c.id === coreManagerConfig.interclanCategoryId
				);

				if (!category)
					return followUpWithErrorEmbed(
						interaction,
						"La catégorie Interclans est actuellement indisponible"
					);

				newChannel = await guild.channels.create({
					name: channelName.slice(0, 90), // keep safe name length
					type: 0, // 0 = GUILD_TEXT
					parent: category.id,
					reason: `Création automatique d'un salon pour l'interclan #${interclan.id}`,
					permissionOverwrites: [
						{
							id: guild.roles.everyone.id,
							deny: ["ViewChannel"],
						},
						{
							id: interclan.clanA.roleId,
							allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
						},
						{
							id: interclan.clanB.roleId,
							allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
						},
						{
							id: client.user!.id,
							allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
						},
					],
				});

				interclan.discordChannelId = newChannel.id;

				await this.db.em.persist(interclan).flush();

				await logOnAchilleaSpecificClanChannel(
					logger,
					{ embeds: [isApproved ? buildSuccessEmbed(resultMsg) : buildErrorEmbed(resultMsg)] },
					clanA.channelId
				);

				// Build Interclan recap embed and send it into the channel
				await newChannel.send({
					content: `${roleMention(clanA.roleId)} ${roleMention(clanB.roleId)}`,
					embeds: [buildInterclanRecapEmbed(interclan)],
					components: [buildLineupsButtons(interclan)],
				});

				await interaction.editReply({
					embeds: [
						buildSuccessEmbed(
							`Vous avez accepté le défi. L'Interclan est maintenant en attente de planification !`
						),
					],
					components: [],
					content: "",
				});
			} else {
				await this.db.em.persist(interclan).flush();

				await logOnAchilleaSpecificClanChannel(
					logger,
					{ embeds: [isApproved ? buildSuccessEmbed(resultMsg) : buildErrorEmbed(resultMsg)] },
					clanA.channelId
				);

				await interaction.editReply({
					embeds: [buildErrorEmbed(`Vous avez refusé le défi. L'Interclan a été annulé.`)],
					components: [],
					content: "",
				});
			}
		} catch (error) {
			if (newChannel) {
				newChannel
					.delete("Rollback suite à une erreur pendant la création de l’interclan")
					.catch((deleteErr) => {
						console.error("Échec de la suppression du salon après erreur:", deleteErr.message);
					});
			}
			console.error(error);

			return followUpWithErrorEmbed(
				interaction,
				`Une erreur est survenue lors du traitement de la réponse à l'Interclan.`,
				true
			);
		}
	}

	@ButtonComponent({ id: /^interclan_lineup:\d+:[01]$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async handleLineupButton(
		interaction: ButtonInteraction,
		client: Client,
		{ clan, clanMember }: InteractionData
	) {
		try {
			const [, interclanIdStr, sideStr] = interaction.customId.split(":");
			const interclanId = Number(interclanIdStr);
			const side = Number(sideStr); // 0 = clanA, 1 = clanB

			// Fetch Interclan + related lineups
			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{
					populate: ["lineups.members.user", "clanA", "clanB"],
				}
			);

			if (!interclan) {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				return followUpWithErrorEmbed(interaction, `L'interclan n'existe plus.`, true);
			}

			// Pick correct lineup
			const lineup = side === 0 ? interclan.getLineupA() : interclan.getLineupB();

			if (!lineup) {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				return followUpWithErrorEmbed(interaction, `Aucune lineup trouvée pour ce clan.`, true);
			}

			// ✅ Security: only members of the challenged clan can respond
			if (clan.id !== lineup.clan.id) {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				return followUpWithErrorEmbed(
					interaction,
					`Seul le staff du clan ${lineup.clan.name} peut effectuer cette action`,
					true
				);
			}

			// Build and show modal
			const modal = await buildLineupManagementModal(lineup);
			await interaction.showModal(modal);
		} catch (err) {
			console.error(err);
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return followUpWithErrorEmbed(
				interaction,
				`Impossible d'ouvrir la gestion de la lineup.`,
				true
			);
		}
	}

	@ModalComponent({ id: /^lineup_manager_modal:\d+:\d+$/ })
	async handleLineupModal(interaction: ModalSubmitInteraction) {
		await interaction.deferUpdate();

		try {
			const [, clanIdStr, interclanIdStr] = interaction.customId.split(":");
			const clanId = Number(clanIdStr);
			const interclanId = Number(interclanIdStr);

			// Fetch lineup
			const lineup = await this.db.em.findOne(
				InterclanLineup,
				{
					event: interclanId,
					clan: clanId,
				},
				{ populate: ["clan", "event", "members.user"] }
			);

			if (!lineup) {
				return followUpWithErrorEmbed(interaction, `Lineup introuvable pour cet interclan.`, true);
			}

			// Extract up to 5 member IDs from inputs
			const memberTuples: { id: string; position: number }[] = [];

			for (let pos = 1; pos <= 5; pos++) {
				const value = interaction.fields.getTextInputValue(`lineup_member_${pos}`);
				if (value && value.trim() !== "") {
					memberTuples.push({ id: value.trim(), position: pos });
				}
			}

			// Validation (with helper)
			const validated = await this.validateTuples(memberTuples, lineup);

			// Update lineup (using your existing helper)
			await this.updateLineup(lineup, validated);

			await this.db.em.populate(lineup.event, ["lineups.members.user", "clanA", "clanB"]);

			// ✅ Confirmation
			await interaction.editReply({
				embeds: [buildInterclanRecapEmbed(lineup.event)],
				components: [buildLineupsButtons(lineup.event)],
				content: "",
			});

			await interaction.followUp({
				embeds: [interclanRecapLineupEmbed(lineup)],
				flags: MessageFlags.Ephemeral,
			});
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^lock_interclan_lineup:\d+:[01]$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async lockLineupButton(
		interaction: ButtonInteraction,
		client: Client,
		{ clan, clanMember }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, interclanIdStr, sideStr] = interaction.customId.split(":");
			const interclanId = Number(interclanIdStr);
			const side = Number(sideStr); // 0 = clanA, 1 = clanB

			// Fetch Interclan + related lineups
			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{
					populate: ["lineups.members.user", "clanA", "clanB"],
				}
			);

			if (!interclan)
				return followUpWithErrorEmbed(interaction, `L'interclan n'existe plus.`, true);

			if (!interclan.canLockIn())
				return followUpWithErrorEmbed(
					interaction,
					"Le verrouillage ne peut être effectué qu'une heure avant le début de l'Interclan.",
					true
				);

			// Pick correct lineup
			const lineup = side === 0 ? interclan.getLineupA() : interclan.getLineupB();

			if (!lineup)
				return followUpWithErrorEmbed(interaction, `Aucune lineup trouvée pour ce clan.`, true);

			// ✅ Security: only members of the challenged clan can respond
			if (clan.id !== lineup.clan.id)
				return followUpWithErrorEmbed(
					interaction,
					`Seul le staff du clan ${lineup.clan.name} peut effectuer cette action`,
					true
				);

			// Build and show modal
			lineup.lockedIn = true;
			await this.db.em.persist(lineup).flush();

			followUpWithSuccessEmbed(interaction, "La lineup a été verrouillée !", true);

			if (!interclan.isReady()) {
				await interaction.editReply({
					embeds: [buildInterclanRecapEmbed(lineup.event)],
					components: [buildLineupsButtons(lineup.event)],
					content: "",
				});
			} else {
				interclan.state = InterclanState.READY;

				await this.db.em.persist(interclan).flush();

				await interaction.editReply({
					embeds: [buildInterclanLockedInEmbed(lineup.event)],
					components: [buildInterclanStartButtons(lineup.event)],
					content: "",
				});
			}
		} catch (err: any) {
			return followUpWithErrorEmbed(
				interaction,
				`Impossible de verrouiller la lineup: ${err.message}`,
				true
			);
		}
	}

	private async validateTuples(
		tuples: { id: string; position: number }[],
		lineup: InterclanLineup
	): Promise<{ member: ClanMember; position: number }[]> {
		if (tuples.length === 0) return [];

		// Check for duplicate IDs
		const ids = tuples.map((t) => t.id);
		const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
		if (duplicates.length > 0) {
			const uniqueDupes = [...new Set(duplicates)];
			throw new Error(
				`Les joueurs suivants apparaissent plusieurs fois : ${uniqueDupes.join(", ")}`
			);
		}

		// Validate that all belong to this clan
		const clanMembers = await this.db.em.find(ClanMember, {
			user: { $in: ids },
			clan: lineup.clan.id,
		});

		const validIds = new Set(clanMembers.map((m) => m.user.id));
		const invalidIds = ids.filter((id) => !validIds.has(id));
		if (invalidIds.length > 0) {
			throw new Error(
				`Les IDs suivants ne sont pas des membres du clan : ${invalidIds.join(", ")}`
			);
		}

		// Map validated members to their positions
		return tuples.map((t) => ({
			member: clanMembers.find((m) => m.user.id === t.id)!,
			position: t.position,
		}));
	}

	private async updateLineup(
		lineup: InterclanLineup,
		validatedTuples: { member: ClanMember; position: number }[]
	) {
		if (lineup.lockedIn) throw new Error("Cette lineup est déjà verrouillée et immuable.");

		const maxPlayers = 5;
		if (validatedTuples.length > maxPlayers) {
			throw new Error(`La lineup ne peut contenir que ${maxPlayers} joueurs au maximum.`);
		}

		await this.db.em.transactional(async (tem) => {
			// Reattach the lineup in transactional EM
			const managedLineup = await tem.findOneOrFail(
				InterclanLineup,
				{ event: lineup.event.id, clan: lineup.clan.id },
				{ populate: ["members"] }
			);

			// Clear old entries
			managedLineup.members.removeAll();

			// Recreate lineup members with positions
			for (const { member, position } of validatedTuples) {
				const link = new InterclanLineupMember();
				link.lineup = managedLineup;
				link.user = rel(User, member.user.id);
				link.position = position;
				managedLineup.members.add(link);
			}

			await tem.flush();
		});
	}

	@ButtonComponent({ id: /^cancel_interclan:\d+$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.Captain))
	async handleInterclanCancel(
		interaction: ButtonInteraction,
		client: Client,
		{ clan }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const [, interclanIdStr] = interaction.customId.split(":");
			const interclanId = Number(interclanIdStr);

			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{ populate: ["clanA", "clanB"] }
			);

			if (!interclan)
				return followUpWithErrorEmbed(interaction, `Cet interclan n'existe plus.`, true);

			// ✅ Check permissions: only one of the two clans may cancel
			if (clan.id !== interclan.clanA.id && clan.id !== interclan.clanB.id) {
				return followUpWithErrorEmbed(
					interaction,
					`Seuls les membres des clans ${interclan.clanA.name} ou ${interclan.clanB.name} peuvent annuler cet interclan.`,
					true
				);
			}

			// ✅ Check if interclan is already completed
			if (interclan.state !== InterclanState.APPROVED && interclan.state !== InterclanState.READY) {
				return followUpWithErrorEmbed(
					interaction,
					`Cet interclan a déjà été ${interclan.state === InterclanState.CANCELED ? "annulé" : "terminé"}.`,
					true
				);
			}

			await interaction.followUp({
				content: "Souhaitez-vous annuler cet Interclan ?",
				components: [
					buildDedicatedApproveDenyButtons("cancel_interclan_confirmation", interclanIdStr),
				],
			});
		} catch (err) {
			console.error("[InterclanCancel] Error:", err);

			return followUpWithErrorEmbed(interaction, `Impossible d'annuler cet interclan.`, true);
		}
	}

	@ButtonComponent({ id: /^cancel_interclan_confirmation:\d+:[01]$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.Captain))
	async handleInterclanCancelConfirmation(
		interaction: ButtonInteraction,
		client: Client,
		{ clan }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, interclanIdStr, replyStr] = interaction.customId.split(":");
			const interclanId = Number(interclanIdStr);
			const reply = Number(replyStr);

			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{ populate: ["clanA", "clanB"] }
			);

			if (!interclan)
				return followUpWithErrorEmbed(interaction, `Cet interclan n'existe plus.`, true);

			// ✅ Check permissions: only one of the two clans may cancel
			if (clan.id !== interclan.clanA.id && clan.id !== interclan.clanB.id) {
				return followUpWithErrorEmbed(
					interaction,
					`Seuls les membres des clans ${interclan.clanA.name} ou ${interclan.clanB.name} peuvent annuler cet interclan.`,
					true
				);
			}

			// ✅ Check if interclan is already completed
			if (interclan.state !== InterclanState.APPROVED && interclan.state !== InterclanState.READY) {
				return followUpWithErrorEmbed(
					interaction,
					`Cet interclan a déjà été ${interclan.state === InterclanState.CANCELED ? "annulé" : "terminé"}.`,
					true
				);
			}

			if (reply === 1) {
				await cancelInterclan(interclan, client, this.db, clan);
			} else {
				await interaction.deleteReply();
			}
		} catch (err) {
			console.error("[InterclanCancel] Error:", err);

			return followUpWithErrorEmbed(interaction, `Impossible d'annuler cet interclan.`, true);
		}
	}

	@ButtonComponent({ id: /^start_interclan:\d+$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async handleStartInterclan(interaction: ButtonInteraction, client: Client) {
		await interaction.deferUpdate();

		const [, interclanIdStr] = interaction.customId.split(":");
		const interclanId = Number(interclanIdStr);

		try {
			// 1️⃣ Fetch interclan with all relations
			const interclan = await this.db.em.findOne(
				Interclan,
				{ id: interclanId },
				{ populate: ["clanA", "clanB", "lineups.members.user", "lobbies"] }
			);

			if (!interclan) return followUpWithErrorEmbed(interaction, "Interclan introuvable.", true);

			// 2️⃣ Validate state and readiness
			if (interclan.state !== InterclanState.READY) {
				return followUpWithErrorEmbed(
					interaction,
					"L'interclan n'est pas encore prêt à être lancé.",
					true
				);
			}

			if (!interclan.canBeStarted()) {
				return followUpWithErrorEmbed(
					interaction,
					`Le lancement de l'interclan doit s'effectuer à partir de ${formatFrenchDate(interclan.fixedDate)} avec une tolérance de 4 heures de retard.`,
					true
				);
			}

			// 3️⃣ Update state to STARTED
			interclan.state = InterclanState.ONGOING;

			// 4️⃣ Generate lobbies
			const lobbies = await this.db.get(Interclan).generateInterclanLobbies(interclan);

			// 5️⃣ Persist and notify
			await this.db.em.persist(interclan).flush();

			console.info(`✅ ${lobbies.length} lobbies générés pour l'interclan #${interclan.id}`);

			// Build confirmation embed
			const embed = buildSuccessEmbed(
				`Interclan **${interclan.name}** lancé avec succès ! Les lobbies ont été générés et les matchs peuvent commencer.`
			);

			// edit reply => embed + buttons
			await interaction.editReply({
				embeds: [buildInterclanScoresEmbed(interclan)],
				components: [buildInterclanMatchButtons(interclan)],
			});

			// 6️⃣ Optionally, announce in the interclan channel
			if (interaction.channel && interaction.channel.isTextBased()) {
				const txtChanel = interaction.channel as TextChannel;

				await txtChanel.send({
					embeds: [embed],
				});
			} else {
				await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
			}
		} catch (error: any) {
			console.error(error);

			return followUpWithErrorEmbed(
				interaction,
				`Erreur lors du lancement de l'interclan : ${error.message ?? error}`,
				true
			);
		}
	}

	@ButtonComponent({ id: /^interclan_match:\d+:\d+$/ })
	async openMatchResultModal(interaction: ButtonInteraction) {
		const [, interclanIdStr, lobbyIdStr] = interaction.customId.split(":");
		const lobbyId = Number(lobbyIdStr);
		const interclanId = Number(interclanIdStr);

		const lobby = await this.db.em.findOne(
			Lobby,
			{ id: lobbyId, event: interclanId },
			{ populate: ["lobbyUsers.user"] }
		);
		if (!lobby) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			return await interaction.followUp({
				content: `⚠️ Impossible de trouver le match #${lobbyId}.`,
			});
		}

		// modal
		const modal = buildInterclanMatchScoreModal(lobby);

		await interaction.showModal(modal);
	}

	@ModalComponent({ id: /^interclan_match_result_modal:\d+$/ })
	async handleMatchResultModal(interaction: ModalSubmitInteraction) {
		await interaction.deferUpdate();

		try {
			const [, lobbyIdStr] = interaction.customId.split(":");
			const lobbyId = Number(lobbyIdStr);

			const scoreA = Number(interaction.fields.getTextInputValue("score_a"));
			const scoreB = Number(interaction.fields.getTextInputValue("score_b"));

			if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0)
				throw new Error("Les scores doivent être des nombres positifs.");

			const lobby = await this.db.em.findOne(
				Lobby,
				{ id: lobbyId },
				{ populate: ["event", "lobbyUsers.user"] }
			);
			if (!lobby) throw new Error(`Match #${lobbyId} introuvable.`);

			// Update scores for each team
			const users = lobby.lobbyUsers.getItems();
			const team1 = users.find((u) => u.team === 1);
			const team2 = users.find((u) => u.team === 2);

			if (!team1 || !team2) throw new Error("Impossible de trouver les joueurs du match.");

			team1.score = scoreA;
			team2.score = scoreB;
			lobby.state = LobbyState.FINISHED;

			await this.db.em.flush();

			const interclan = lobby.event as Interclan;
			await this.db.em.populate(interclan, ["lineups.members.user", "lineups.clan", "lobbies.*"]);

			// ✅ Refresh main interclan channel message (embed with scores)
			if (!interclan.areAllMatchesFinished()) {
				await interaction.editReply({
					embeds: [buildInterclanScoresEmbed(interclan)],
					components: [buildInterclanMatchButtons(interclan)],
				});
			} else {
				const playersA = interclan
					.getLineupA()
					?.members.getItems()
					.map((lm) => lm.user);
				const playersB = interclan
					.getLineupB()
					?.members.getItems()
					.map((lm) => lm.user);

				if (!playersA || !playersB) {
					throw new Error("Unable to fetch players for one or both clans");
				}

				const voters = playersA.concat(playersB);

				const voteProposal = new VoteProposal();
				voteProposal.type = ProposalType.INTERCLAN_VALIDATION;
				voteProposal.strategy = VotingStrategy.UNANIMOUS;
				voteProposal.reason = `Demande de validation des résultats de l'interclan ${interclan.name}`;
				voteProposal.eligibleVoters.set(voters);
				voteProposal.targetEntityType = "Interclan";
				voteProposal.targetEntityId = interclan.id;
				voteProposal.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

				await this.db.em.persist(voteProposal).flush();

				await interaction.editReply({
					embeds: [buildInterclanScoresEmbed(interclan)],
					components: [],
				});

				if (!interaction.channelId)
					return followUpWithErrorEmbed(
						interaction,
						"L'interaction doit se faire depuis un salon textuel."
					);

				const logger = await resolveDependency(Logger);
				await logger.discordChannel(interaction.channelId, {
					content: `${roleMention(interclan.clanA.roleId)} ${roleMention(interclan.clanB.roleId)}`,
					embeds: [createInterclanResultVoteEmbed(interclan, voteProposal)],
					components: [buildVoteButtons(voteProposal.id.toString()) as any],
				});
			}

			return followUpWithSuccessEmbed(
				interaction,
				`Score mis à jour : ${escapeMarkdown(team1.user.displayName)} ${scoreA}–${scoreB} ${escapeMarkdown(team2.user.displayName)}`,
				true
			);
		} catch (err: any) {
			console.error(err);

			return followUpWithErrorEmbed(
				interaction,
				err.message ?? "Erreur lors de la mise à jour du score."
			);
		}
	}
}
