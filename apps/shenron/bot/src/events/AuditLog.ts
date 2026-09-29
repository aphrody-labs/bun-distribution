/**
 * Capture les events Discord qui n'étaient PAS loggés jusqu'ici :
 *
 *   • `guildBanAdd` / `guildBanRemove` — bans manuels (hors /ban du bot)
 *   • `guildMemberUpdate` — diff de rôles (add/remove), nick change, timeout
 *   • `channelCreate` / `channelDelete` / `channelUpdate` (rename, topic)
 *   • `roleCreate` / `roleDelete` / `roleUpdate` (rename, perms, color)
 *   • `emojiCreate` / `emojiDelete`
 *   • `guildMemberRemove` (kick auto via audit log)
 *   • `voiceStateUpdate` — kick / déplacement vocal par un mod (via audit)
 *
 * Tout est routé vers la catégorie `audit` (setting `channel.log_audit`,
 * fallback sur le salon des sanctions).
 */
import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { AuditLogEvent, ChannelType, PermissionsBitField } from "discord.js";
import { LogService } from "~/services/LogService";
import { logger } from "~/lib/logger";
import { ModerationService } from "~/services/ModerationService";
import { env } from "~/lib/env";

@Discord()
@Bot("shenron")
@injectable()
export class AuditLogEventHandler {
	constructor(
		@inject(LogService) private logs: LogService,
		@inject(ModerationService) private mod: ModerationService
	) {}

	// ── Bans (hors bot) ────────────────────────────────────────────────
	@On({ event: "guildBanAdd" })
	async onBanAdd([ban]: ArgsOf<"guildBanAdd">) {
		const exec = await this.fetchExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
		const isBot = exec?.id === ban.client.user?.id;
		if (!isBot) {
			await this.mod.addBan(ban.user.id, exec?.id ?? "unknown", ban.reason ?? undefined);
		}
		// Skip si c'est notre bot (déjà loggé via LogService.sanction)
		if (isBot) return;
		const embed = this.logs
			.makeEmbed("🔨 Ban manuel", 0xef4444)
			.addFields(
				{ name: "Cible", value: `${ban.user} (${ban.user.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true },
				{ name: "Raison", value: ban.reason ?? "*(non précisée)*" }
			);
		await this.logs.send(ban.client, "audit", embed);
	}

	@On({ event: "guildBanRemove" })
	async onBanRemove([ban]: ArgsOf<"guildBanRemove">) {
		const exec = await this.fetchExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
		const isBot = exec?.id === ban.client.user?.id;
		if (!isBot) {
			await this.mod.removeBan(ban.user.id, exec?.id ?? "unknown", ban.reason ?? undefined);
		}
		if (isBot) return;
		const embed = this.logs
			.makeEmbed("🔓 Unban manuel", 0x22c55e)
			.addFields(
				{ name: "Cible", value: `${ban.user} (${ban.user.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		await this.logs.send(ban.client, "audit", embed);
	}

	// ── Diff de rôles, nick, timeout ───────────────────────────────────
	@On({ event: "guildMemberUpdate" })
	async onMemberUpdate([oldM, newM]: ArgsOf<"guildMemberUpdate">) {
		const fields: { name: string; value: string; inline?: boolean }[] = [];

		// Rôles ajoutés / retirés
		const oldRoles = new Set(oldM.roles.cache.keys());
		const newRoles = new Set(newM.roles.cache.keys());
		const added = [...newRoles].filter((r) => !oldRoles.has(r));
		const removed = [...oldRoles].filter((r) => !newRoles.has(r));

		const jailRoleId = env.JAIL_ROLE_ID;
		if (jailRoleId) {
			if (added.includes(jailRoleId)) {
				const exec = await this.fetchExecutor(newM.guild, AuditLogEvent.MemberRoleUpdate, newM.id);
				if (exec?.id !== newM.client.user?.id) {
					await this.mod.manuallyJail(newM.id, exec?.id ?? "unknown", [...oldRoles]);
				}
			}
			if (removed.includes(jailRoleId)) {
				const exec = await this.fetchExecutor(newM.guild, AuditLogEvent.MemberRoleUpdate, newM.id);
				if (exec?.id !== newM.client.user?.id) {
					await this.mod.unjail(newM.guild, newM.id, exec?.id ?? "unknown", "manual role removal");
				}
			}
		}

		if (added.length > 0)
			fields.push({
				name: "Rôle(s) ajouté(s)",
				value: added.map((r) => `<@&${r}>`).join(" "),
				inline: false,
			});
		if (removed.length > 0)
			fields.push({
				name: "Rôle(s) retiré(s)",
				value: removed.map((r) => `<@&${r}>`).join(" "),
				inline: false,
			});

		// Nick change
		if (oldM.nickname !== newM.nickname) {
			fields.push({
				name: "Pseudo",
				value: `\`${oldM.nickname ?? "*(none)*"}\` → \`${newM.nickname ?? "*(none)*"}\``,
			});
		}

		// Timeout (mute Discord natif)
		const oldTo = oldM.communicationDisabledUntilTimestamp ?? 0;
		const newTo = newM.communicationDisabledUntilTimestamp ?? 0;
		if (oldTo !== newTo) {
			if (newTo > Date.now()) {
				fields.push({ name: "Timeout", value: `Jusqu'à <t:${Math.floor(newTo / 1000)}:f>` });
			} else {
				fields.push({ name: "Timeout", value: "Levé" });
			}
		}

		if (fields.length === 0) return;
		const exec = await this.fetchExecutor(newM.guild, AuditLogEvent.MemberRoleUpdate, newM.id);
		const embed = this.logs
			.makeEmbed("👤 Membre modifié", 0xfbbf24)
			.setThumbnail(newM.user.displayAvatarURL())
			.addFields(
				{ name: "Membre", value: `${newM} (${newM.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true },
				...fields
			);
		await this.logs.send(newM.client, "audit", embed);
	}

	// ── Salons ─────────────────────────────────────────────────────────
	@On({ event: "channelCreate" })
	async onChannelCreate([channel]: ArgsOf<"channelCreate">) {
		if (!("guild" in channel) || !channel.guild) return;
		const exec = await this.fetchExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
		const embed = this.logs
			.makeEmbed("➕ Salon créé", 0x22c55e)
			.addFields(
				{ name: "Salon", value: `${channel} (${channel.id})`, inline: true },
				{ name: "Type", value: ChannelType[channel.type] ?? String(channel.type), inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		await this.logs.send(channel.client, "audit", embed);
	}

	@On({ event: "channelDelete" })
	async onChannelDelete([channel]: ArgsOf<"channelDelete">) {
		if (!("guild" in channel) || !channel.guild) return;
		const exec = await this.fetchExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
		const embed = this.logs.makeEmbed("➖ Salon supprimé", 0xef4444).addFields(
			{
				name: "Salon",
				value: `#${"name" in channel ? channel.name : "?"} (${channel.id})`,
				inline: true,
			},
			{ name: "Type", value: ChannelType[channel.type] ?? String(channel.type), inline: true },
			{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
		);
		await this.logs.send(channel.client, "audit", embed);
	}

	@On({ event: "channelUpdate" })
	async onChannelUpdate([oldC, newC]: ArgsOf<"channelUpdate">) {
		if (!("guild" in newC) || !newC.guild) return;
		const fields: { name: string; value: string; inline?: boolean }[] = [];
		if ("name" in oldC && "name" in newC && oldC.name !== newC.name) {
			fields.push({ name: "Nom", value: `\`${oldC.name}\` → \`${newC.name}\`` });
		}
		if ("topic" in oldC && "topic" in newC && oldC.topic !== newC.topic) {
			fields.push({
				name: "Topic",
				value: `${oldC.topic ?? "*(vide)*"} → ${newC.topic ?? "*(vide)*"}`.slice(0, 1024),
			});
		}
		if ("nsfw" in oldC && "nsfw" in newC && oldC.nsfw !== newC.nsfw) {
			fields.push({ name: "NSFW", value: `${oldC.nsfw} → ${newC.nsfw}` });
		}
		if (fields.length === 0) return;
		const exec = await this.fetchExecutor(newC.guild, AuditLogEvent.ChannelUpdate, newC.id);
		const embed = this.logs
			.makeEmbed("✏️ Salon modifié", 0xfbbf24)
			.addFields(
				{ name: "Salon", value: `${newC} (${newC.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true },
				...fields
			);
		await this.logs.send(newC.client, "audit", embed);
	}

	// ── Rôles ──────────────────────────────────────────────────────────
	@On({ event: "roleCreate" })
	async onRoleCreate([role]: ArgsOf<"roleCreate">) {
		const exec = await this.fetchExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
		const embed = this.logs
			.makeEmbed("➕ Rôle créé", 0x22c55e)
			.addFields(
				{ name: "Rôle", value: `${role} (${role.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		await this.logs.send(role.client, "audit", embed);
	}

	@On({ event: "roleDelete" })
	async onRoleDelete([role]: ArgsOf<"roleDelete">) {
		const exec = await this.fetchExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
		const embed = this.logs
			.makeEmbed("➖ Rôle supprimé", 0xef4444)
			.addFields(
				{ name: "Rôle", value: `\`${role.name}\` (${role.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		await this.logs.send(role.client, "audit", embed);
	}

	@On({ event: "roleUpdate" })
	async onRoleUpdate([oldR, newR]: ArgsOf<"roleUpdate">) {
		const fields: { name: string; value: string; inline?: boolean }[] = [];
		if (oldR.name !== newR.name)
			fields.push({ name: "Nom", value: `\`${oldR.name}\` → \`${newR.name}\`` });
		if (oldR.color !== newR.color) {
			fields.push({
				name: "Couleur",
				value: `\`#${oldR.color.toString(16).padStart(6, "0")}\` → \`#${newR.color.toString(16).padStart(6, "0")}\``,
			});
		}
		if (oldR.hoist !== newR.hoist)
			fields.push({ name: "Hoist", value: `${oldR.hoist} → ${newR.hoist}` });
		if (oldR.mentionable !== newR.mentionable)
			fields.push({ name: "Mentionnable", value: `${oldR.mentionable} → ${newR.mentionable}` });
		if (oldR.permissions.bitfield !== newR.permissions.bitfield) {
			const oldP = new PermissionsBitField(oldR.permissions.bitfield).toArray();
			const newP = new PermissionsBitField(newR.permissions.bitfield).toArray();
			const added = newP.filter((p) => !oldP.includes(p));
			const removed = oldP.filter((p) => !newP.includes(p));
			if (added.length > 0)
				fields.push({ name: "Permissions ajoutées", value: added.join(", ").slice(0, 1024) });
			if (removed.length > 0)
				fields.push({ name: "Permissions retirées", value: removed.join(", ").slice(0, 1024) });
		}
		if (fields.length === 0) return;
		const exec = await this.fetchExecutor(newR.guild, AuditLogEvent.RoleUpdate, newR.id);
		const embed = this.logs
			.makeEmbed("✏️ Rôle modifié", 0xfbbf24)
			.addFields(
				{ name: "Rôle", value: `${newR} (${newR.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true },
				...fields
			);
		await this.logs.send(newR.client, "audit", embed);
	}

	// ── Emojis ─────────────────────────────────────────────────────────
	@On({ event: "emojiCreate" })
	async onEmojiCreate([emoji]: ArgsOf<"emojiCreate">) {
		const exec = await this.fetchExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
		const embed = this.logs
			.makeEmbed("➕ Emoji ajouté", 0x22c55e)
			.addFields(
				{ name: "Emoji", value: `${emoji} \`:${emoji.name}:\` (${emoji.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		if (emoji.url) embed.setThumbnail(emoji.url);
		await this.logs.send(emoji.client, "audit", embed);
	}

	@On({ event: "emojiDelete" })
	async onEmojiDelete([emoji]: ArgsOf<"emojiDelete">) {
		const exec = await this.fetchExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
		const embed = this.logs
			.makeEmbed("➖ Emoji supprimé", 0xef4444)
			.addFields(
				{ name: "Emoji", value: `\`:${emoji.name}:\` (${emoji.id})`, inline: true },
				{ name: "Par", value: exec ? `<@${exec.id}>` : "Inconnu", inline: true }
			);
		await this.logs.send(emoji.client, "audit", embed);
	}

	// ── Voice : kick / move par un mod ─────────────────────────────────
	@On({ event: "voiceStateUpdate" })
	async onVoiceStateUpdate([oldState, newState]: ArgsOf<"voiceStateUpdate">) {
		const oldCh = oldState.channelId;
		const newCh = newState.channelId;
		if (oldCh === newCh) return; // mute/deaf/stream toggle, on ignore
		const guild = newState.guild;
		const userId = newState.id;
		const member = newState.member ?? oldState.member;
		const userTag = member ? `${member} (${member.id})` : `<@${userId}> (${userId})`;

		// KICK vocal : oldCh existe, newCh null
		if (oldCh && !newCh) {
			const exec = await this.fetchExecutor(guild, AuditLogEvent.MemberDisconnect);
			if (!exec) return; // départ volontaire
			const embed = this.logs
				.makeEmbed("🚫 Kick vocal", 0xef4444)
				.addFields(
					{ name: "Membre", value: userTag, inline: true },
					{ name: "Salon", value: `<#${oldCh}>`, inline: true },
					{ name: "Par", value: `<@${exec.id}>`, inline: true }
				);
			await this.logs.send(newState.client, "audit", embed);
			return;
		}

		// MOVE vocal : oldCh != newCh, les deux non nuls
		if (oldCh && newCh) {
			const exec = await this.fetchExecutor(guild, AuditLogEvent.MemberMove);
			if (!exec) return; // déplacement volontaire
			const embed = this.logs
				.makeEmbed("🔀 Déplacement vocal", 0xfbbf24)
				.addFields(
					{ name: "Membre", value: userTag, inline: true },
					{ name: "De", value: `<#${oldCh}>`, inline: true },
					{ name: "Vers", value: `<#${newCh}>`, inline: true },
					{ name: "Par", value: `<@${exec.id}>`, inline: false }
				);
			await this.logs.send(newState.client, "audit", embed);
		}
	}

	// ── Helper : récupère l'auteur de l'action via audit logs ──────────
	private async fetchExecutor(
		guild: import("discord.js").Guild,
		type: AuditLogEvent,
		targetId?: string
	): Promise<{ id: string } | null> {
		try {
			const logs = await guild.fetchAuditLogs({ type, limit: 5 });
			const entry = targetId
				? logs.entries.find(
						(e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 10_000
					)
				: logs.entries.find((e) => Date.now() - e.createdTimestamp < 5_000);
			return entry?.executor ? { id: entry.executor.id } : null;
		} catch (err) {
			logger.debug({ err, type, targetId }, "audit-log fetch failed (perms ?)");
			return null;
		}
	}
}
