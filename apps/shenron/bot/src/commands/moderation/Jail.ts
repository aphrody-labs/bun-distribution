import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashOption } from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ChannelType,
	type CommandInteraction,
	type GuildChannel,
	type User,
	MessageFlags,
	PermissionFlagsBits,
} from "discord.js";
import { existsSync } from "node:fs";
import { GuildOnly } from "~/guards/GuildOnly";
import { ModerationService } from "~/services/ModerationService";
import { LogService } from "~/services/LogService";
import {
	sanctionEmbed,
	sanctionLogEmbed,
	brandedEmbed,
	errorEmbed,
	successEmbed,
} from "~/lib/embeds";
import { canModerate } from "~/lib/hierarchy";
import { gifFor } from "~/lib/sanction-gif";
import { parseDuration, formatDuration, notifyMember } from "~/lib/sanction-helpers";
import { env } from "~/lib/env";

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@injectable()
export class JailCommands {
	constructor(
		@inject(ModerationService) private mod: ModerationService,
		@inject(LogService) private logs: LogService
	) {}

	// ────────────────────────────── /jail
	@Slash({ name: "jail", description: "Envoyer un membre en jail" })
	async jail(
		@SlashOption(
			{
				name: "membre",
				description: "Membre à jail",
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			userTransformer
		)
		target: User,
		@SlashOption({
			name: "duree",
			description: "Durée optionnelle (ex: 1h)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		duration: string | undefined,
		@SlashOption({
			name: "raison",
			description: "Raison",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		reason: string | undefined,
		@SlashOption({
			name: "discret",
			description: "Réponse visible uniquement par toi (cache le GIF)",
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		})
		discret: boolean | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const isEphemeral = !!discret;
		await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined });

		const member = await interaction.guild.members.fetch(target.id).catch(() => null);
		if (!member) {
			await interaction.editReply({ embeds: [errorEmbed("Membre introuvable")] });
			return;
		}
		const allowed = await canModerate(interaction.member, member);
		if (!allowed.ok) {
			await interaction.editReply({
				embeds: [errorEmbed("Hiérarchie staff", allowed.reason ?? "")],
			});
			return;
		}
		if (!member.manageable) {
			await interaction.editReply({
				embeds: [
					errorEmbed(
						"Hiérarchie",
						`Le bot ne peut pas modifier les rôles de ${target} (rôle plus haut).`
					),
				],
			});
			return;
		}
		const ms = parseDuration(duration);
		try {
			await this.mod.jail(member, interaction.user.id, reason, ms);
		} catch (err) {
			await interaction.editReply({
				embeds: [errorEmbed("Échec jail", (err as Error).message)],
			});
			return;
		}

		let gifUrl = await gifFor("jail");

		// Discord (depuis fin 2024) n'auto-anime PLUS les GIFs setImage via URL externe :
		// il faut les attacher comme AttachmentBuilder + référencer attachment://name.
		// On essaie d'abord le fichier local assets/sanctions/jail.gif.
		let jailLocal = `${process.cwd()}/assets/sanctions/jail.gif`;
		if (!existsSync(jailLocal)) {
			jailLocal = `${process.cwd()}/apps/shenron/bot/assets/sanctions/jail.gif`;
		}
		if (!existsSync(jailLocal)) {
			jailLocal = `${import.meta.dir}/../../../assets/sanctions/jail.gif`;
		}

		const jailAttachment = existsSync(jailLocal)
			? new AttachmentBuilder(jailLocal, { name: "jail.gif" })
			: null;
		if (jailAttachment) gifUrl = "attachment://jail.gif";
		const detailedEmbed = sanctionEmbed({
			target,
			moderator: interaction.user,
			action: "jail",
			reason,
			duration: ms ? formatDuration(ms) : "Indéfinie",
			gifUrl,
		});
		const dmOk = await notifyMember(
			target,
			brandedEmbed({
				title: "⛓️ Tu as été jailé",
				description: `Tu es en jail sur **${interaction.guild.name}**${ms ? ` pour **${formatDuration(ms)}**` : ""}.\n\nMotif : ${reason ?? "*(non précisé)*"}`,
				kind: "error",
			}),
			{
				kind: "jail",
				reason: reason ?? "*(non précisé)*",
				duration: ms ? formatDuration(ms) : "Indéfinie",
				moderator: interaction.user.username,
				guildName: interaction.guild.name,
			}
		);

		// Public : embed compact "log style" (gif + nom + "envoyé en enfer !")
		// Détaillé : log sanction (modérateur, motif, durée, DM) — invisible côté membres.
		if (discret) {
			await interaction.editReply({
				embeds: [
					detailedEmbed.addFields({
						name: "DM",
						value: dmOk ? "✅ envoyé" : "❌ DM fermés",
						inline: true,
					}),
				],
				files: jailAttachment ? [jailAttachment] : undefined,
			});
		} else {
			const publicEmbed = sanctionLogEmbed({ target, action: "jail", gifUrl });
			await interaction.editReply({
				embeds: [publicEmbed],
				files: jailAttachment ? [jailAttachment] : undefined,
			});
			// Log détaillé en log channel uniquement (pas de bruit dans le salon courant).
			detailedEmbed.addFields({
				name: "DM",
				value: dmOk ? "✅ envoyé" : "❌ DM fermés",
				inline: true,
			});
		}
		await this.logs.send(
			interaction.client,
			"sanction",
			detailedEmbed,
			jailAttachment ? [jailAttachment] : undefined
		);
	}

	// ────────────────────────────── /unjail
	@Slash({ name: "unjail", description: "Libérer un membre de jail" })
	async unjail(
		@SlashOption(
			{
				name: "membre",
				description: "Membre",
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			userTransformer
		)
		target: User,
		@SlashOption({
			name: "raison",
			description: "Raison",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		reason: string | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		// unjail effectue 1 PATCH role.remove + N PATCH role.add → peut dépasser les
		// 3s d'ack Discord. defer immédiat sinon "Unknown interaction" (10062).
		await interaction.deferReply();
		const ok = await this.mod.unjail(interaction.guild, target.id, interaction.user.id, reason);
		if (!ok) {
			await interaction.editReply({ embeds: [errorEmbed("Membre introuvable ou pas en jail")] });
			return;
		}
		const embed = sanctionEmbed({
			target,
			moderator: interaction.user,
			action: "unjail",
			reason,
			gifUrl: await gifFor("unjail"),
		});
		await interaction.editReply({ embeds: [embed] });
		await this.logs.send(interaction.client, "sanction", embed);
	}

	// ────────────────────────────── /jail-setup
	/**
	 * Verrouille le rôle `JAIL_ROLE_ID` sur **TOUS** les salons individuellement
	 * (catégories + salons texte/vocal/annonce/forum/media/stage). On n'applique
	 * pas seulement aux catégories : un salon enfant qui a un override custom
	 * (même pour @everyone) ne synchronise pas avec sa catégorie, donc l'override
	 * sur la catégorie n'est pas hérité. Pour garantir le deny partout, on
	 * applique l'override directement sur chaque salon.
	 *
	 * Si `salon-jail` est fourni, le rôle reçoit un override **allow ViewChannel
	 * + SendMessages + ReadMessageHistory** sur ce salon spécifique pour pouvoir
	 * communiquer avec les mods. Ce salon est exclu de la boucle de deny.
	 *
	 * Pré-vérifie la **hiérarchie de rôles** : le rôle jail doit être strictement
	 * en-dessous du plus haut rôle du bot (sinon Discord refuse `Missing Permissions`
	 * sur chaque appel et rien ne se passe).
	 *
	 * Idempotent : applique `permissionOverwrites.edit` (merge) plutôt que
	 * `set` (replace) — relancer la commande ne casse pas les overrides
	 * existants pour d'autres rôles.
	 */
	@Slash({
		name: "jail-setup",
		description: "Verrouiller le rôle jail dans tous les salons (rouge partout)",
	})
	async jailSetup(
		@SlashOption({
			name: "salon-jail",
			description: "Salon où le rôle jail garde l'accès (lecture+écriture). Optionnel.",
			type: ApplicationCommandOptionType.Channel,
			required: false,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
		})
		jailChannel: GuildChannel | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const roleId = env.JAIL_ROLE_ID;
		if (!roleId) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"JAIL_ROLE_ID non configuré",
						"Définis `JAIL_ROLE_ID` dans `.env` puis redémarre Shenron."
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const role =
			interaction.guild.roles.cache.get(roleId) ??
			(await interaction.guild.roles.fetch(roleId).catch(() => null));
		if (!role) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Rôle introuvable",
						`JAIL_ROLE_ID=\`${roleId}\` ne correspond à aucun rôle de la guild.`
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const me = await interaction.guild.members.fetchMe();
		if (
			!me.permissions.has(PermissionFlagsBits.ManageChannels) ||
			!me.permissions.has(PermissionFlagsBits.ManageRoles)
		) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Perms bot insuffisantes",
						"Le bot a besoin de `Manage Channels` + `Manage Roles`."
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		// Pré-vérif hiérarchie : Discord refuse de modifier un override pour un rôle
		// au-dessus (ou égal) au plus haut rôle du bot. Sans ce check, chaque
		// permissionOverwrites.edit() lance "Missing Permissions" en silence.
		const myTop = me.roles.highest;
		if (role.position >= myTop.position) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Hiérarchie cassée",
						`Le rôle <@&${role.id}> est **au-dessus ou au même niveau** que le plus haut rôle du bot **${myTop.name}**.\n\nDans **Paramètres serveur → Rôles**, déplace **${role.name}** strictement en-dessous de **${myTop.name}**, puis relance \`/jail-setup\`.`
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply();

		// Deny massif : tout ce qui permet de voir, écrire, parler, réagir.
		// ViewChannel:false suffirait à tout cacher mais on est defensive in depth
		// au cas où un override allow plus haut force ViewChannel sur un enfant.
		const denyAll = {
			ViewChannel: false,
			SendMessages: false,
			AddReactions: false,
			AttachFiles: false,
			EmbedLinks: false,
			Connect: false,
			Speak: false,
			Stream: false,
			SendMessagesInThreads: false,
			CreatePublicThreads: false,
			CreatePrivateThreads: false,
			UseApplicationCommands: false,
			UseExternalEmojis: false,
			UseExternalStickers: false,
		} as const;

		// Tous les salons qui supportent des overrides (= tout sauf threads).
		// On applique sur chaque salon directement plutôt que de compter sur
		// l'héritage parent → enfant (qui ne se déclenche que si l'enfant
		// synchronise avec sa catégorie, ce qui n'est presque jamais le cas
		// dès qu'un override custom existe sur l'enfant).
		const overridableTypes = new Set<number>([
			ChannelType.GuildCategory,
			ChannelType.GuildText,
			ChannelType.GuildVoice,
			ChannelType.GuildAnnouncement,
			ChannelType.GuildStageVoice,
			ChannelType.GuildForum,
			ChannelType.GuildMedia,
		]);
		await interaction.guild.channels.fetch().catch(() => null);
		const allChannels = [...interaction.guild.channels.cache.values()].filter((c) =>
			overridableTypes.has(c.type)
		) as GuildChannel[];

		let okCat = 0;
		let okCh = 0;
		const failed: string[] = [];

		for (const ch of allChannels) {
			// On exclut le salon-jail explicite : il reçoit un override allow plus bas.
			if (jailChannel && ch.id === jailChannel.id) continue;
			try {
				await ch.permissionOverwrites.edit(role.id, denyAll, {
					reason: `jail-setup by ${interaction.user.username}`,
				});
				if (ch.type === ChannelType.GuildCategory) okCat++;
				else okCh++;
			} catch (err) {
				const prefix = ch.type === ChannelType.GuildCategory ? "📁" : "#";
				failed.push(`${prefix}${ch.name}: ${(err as Error).message}`);
			}
		}

		// Override allow sur le salon de jail dédié
		let jailChannelStatus = "*non configuré*";
		if (jailChannel) {
			try {
				await jailChannel.permissionOverwrites.edit(
					role.id,
					{
						ViewChannel: true,
						SendMessages: true,
						ReadMessageHistory: true,
						AddReactions: false,
						AttachFiles: false,
						EmbedLinks: false,
						UseApplicationCommands: false,
						CreatePublicThreads: false,
						CreatePrivateThreads: false,
						SendMessagesInThreads: false,
					},
					{ reason: `jail-setup salon dédié by ${interaction.user.username}` }
				);
				jailChannelStatus = `<#${jailChannel.id}> ✅`;
			} catch (err) {
				jailChannelStatus = `<#${jailChannel.id}> ❌ ${(err as Error).message}`;
			}
		}

		const totalCats = allChannels.filter((c) => c.type === ChannelType.GuildCategory).length;
		const totalChs = allChannels.length - totalCats - (jailChannel ? 1 : 0);

		await this.mod.log("JAIL_SETUP", null, interaction.user.id, undefined, {
			roleId: role.id,
			categories: okCat,
			channels: okCh,
			jailChannelId: jailChannel?.id,
			failed: failed.length,
		});

		const desc = [
			`**Rôle ciblé :** <@&${role.id}>`,
			`**Catégories verrouillées :** ${okCat}/${totalCats}`,
			`**Salons verrouillés :** ${okCh}/${totalChs}`,
			`**Salon jail (allow) :** ${jailChannelStatus}`,
			failed.length
				? `\n**Échecs (${failed.length}) :**\n${failed
						.slice(0, 10)
						.map((f) => `• ${f}`)
						.join("\n")}${failed.length > 10 ? `\n…+${failed.length - 10}` : ""}`
				: "",
		]
			.filter(Boolean)
			.join("\n");

		await interaction.editReply({
			embeds: [successEmbed("⛓️ Jail-setup terminé", desc)],
		});
	}
}
