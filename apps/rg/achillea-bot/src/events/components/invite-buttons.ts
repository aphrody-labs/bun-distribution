import { RequestContext } from "@mikro-orm/core";
import type { BaseMessageOptions, ButtonInteraction } from "discord.js";
import { MessageFlags, escapeMarkdown } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Guard, Injectable, SelectMenuComponent } from "@/decorators";
import { ClanInvite, ClanMember } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database, Logger } from "@/services";
import {
	assignClanRoleToUser,
	buildClanMemberEmbed,
	buildSimpleUserEmbed,
	followUpWithErrorEmbed,
	hasActiveClanMembership,
	inviteToClan,
	resolveChannel,
	resolveDependency,
} from "@/utils/functions";

import { ClanMemberDistinction, ClanMemberRole } from "../../utils/enums";
import { buildApplicationDistinctionSelector } from "../../utils/functions/components";
import {
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanGuildChannel,
} from "../../utils/functions/messager";

@Discord()
@Injectable()
export class InviteButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^confirm_invite:.+/ })
	async confirmInvite(interaction: ButtonInteraction, client: Client) {
		await interaction.deferUpdate();
		const usedEm = RequestContext.getEntityManager() || this.db.em;

		const [, inviteId] = interaction.customId.split(":");

		const clanInvitesRepo = usedEm.getRepository(ClanInvite);
		const invite = await clanInvitesRepo.findOne(
			{ id: Number(inviteId) },
			{
				populate: ["user", "clan", "clan.guild"],
				logging: { label: "Fetching invite" },
			}
		);

		if (!invite) {
			return followUpWithErrorEmbed(interaction, `Invite with ID ${inviteId} not found.`, true);
		}

		if (invite.user.id !== interaction.user.id) {
			return;
		}

		try {
			// 🔹 Step 2. Transaction: only DB operations
			await usedEm.transactional(async (tem) => {
				const clanMemberRepo = tem.getRepository(ClanMember);
				// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
				const isInActiveClan = await hasActiveClanMembership(
					invite.user.id,
					tem as unknown as DatabaseEntityManager
				);

				if (isInActiveClan) throw new Error("Vous êtes déjà dans un Clan !");
				if (invite.clan.isDisbanded)
					throw new Error("Le Clan que vous essayez de rejoindre a été dissout !");

				const newMember = await clanMemberRepo.createMember(
					invite.clan.id,
					invite.user.id,
					ClanMemberRole.Trial,
					invite.distinctions
				);

				tem.persist(newMember);
				await tem.remove(invite).flush();
			});
		} catch (err) {
			return followUpWithErrorEmbed(
				interaction,
				err instanceof Error ? err.message : "Une erreur est survenue.",
				true
			);
		}

		const newMember = await usedEm.findOne(ClanMember, { user: invite.user.id });
		if (!newMember)
			return followUpWithErrorEmbed(
				interaction,
				`Une erreur est survenue lors de l'ajout du membre au Clan`,
				true
			);

		await assignClanRoleToUser(client, newMember, invite.clan).catch(() =>
			followUpWithErrorEmbed(interaction, "Une erreur est survenue lors de l'ajout des rôles", true)
		);

		await resolveChannel(interaction)!
			.delete()
			.catch(() =>
				followUpWithErrorEmbed(
					interaction,
					"Une erreur est survenue lors de l'ajout des permissions",
					true
				)
			);

		const logger = await resolveDependency(Logger);

		const msg: BaseMessageOptions = {
			embeds: [await buildClanMemberEmbed(newMember, client, "Nouveau membre")],
		};

		await Promise.all([
			logOnClanGuildChannel(logger, msg, invite.clan.guild),
			logOnAchilleaSpecificClanChannel(logger, msg, invite.clan.channelId),
			logOnAchilleaGenericClanChannel(logger, {
				embeds: [
					await buildSimpleUserEmbed(
						interaction.user,
						"Nouveau membre",
						`${escapeMarkdown(interaction.user.displayName)} a rejoint ${invite.clan.name} !`,
						0x57f287
					),
				],
			}),
		]);
	}

	@ButtonComponent({ id: /^cancel_invite:.+/ })
	async cancelInvite(interaction: ButtonInteraction) {
		await interaction.deferUpdate();

		const [, inviteId] = interaction.customId.split(":");

		const clanInvitesRepo = this.db.get(ClanInvite);
		const invite = await clanInvitesRepo.findOne({ id: Number(inviteId) });

		if (invite && invite.user.id !== interaction.user.id) {
			return;
		}

		await this.db.get(ClanInvite).nativeDelete({ id: Number(inviteId) });

		await resolveChannel(interaction)!.delete();
	}

	@ButtonComponent({ id: /^init_invite:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async invite(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();

		const [, targetUserId] = interaction.customId.split(":");

		const targetUser = await client.users.fetch(targetUserId).catch(() => null);

		if (!targetUser) {
			followUpWithErrorEmbed(interaction, "Utilisateur cible introuvable.", true);

			return;
		}

		await interaction.followUp({
			content: `Sélectionnez les distinctions à proposer à l'utilisateur à inviter:`,
			flags: MessageFlags.Ephemeral,
			components: [buildApplicationDistinctionSelector(clan.id, "invite", targetUserId)],
		});
	}

	@SelectMenuComponent({ id: /^invite_distinctions:\d+$/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async handleInviteDistinctionSelect(
		interaction: any,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, targetUserId] = interaction.customId.split(":");
			const selectedValues: string[] = interaction.values; // e.g. ['Player', 'Staff']

			const user = await client.users.fetch(targetUserId).catch(() => null);
			if (!user) throw new Error(`Utilisateur cible introuvable.`);

			const distinctions = selectedValues
				.map((v) => ClanMemberDistinction[v as keyof typeof ClanMemberDistinction])
				.filter((v): v is ClanMemberDistinction => !!v);

			// Ask for confirmation — same as before, but show chosen distinctions
			await inviteToClan(this.db, client, interaction, user, clan, distinctions);

			await interaction.deleteReply();
		} catch (err: any) {
			followUpWithErrorEmbed(interaction, `${err.message}`, true);

			return await interaction.message.delete().catch(() => null);
		}
	}
}
