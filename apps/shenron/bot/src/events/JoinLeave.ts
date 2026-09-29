import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, Once, type ArgsOf } from "discordx";
import type { Client, Guild, GuildMember } from "discord.js";
import { LogService } from "~/services/LogService";
import { InviteTracker } from "~/services/InviteTracker";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { SettingsService } from "~/services/SettingsService";
import { DatabaseService } from "~/db/index";
import { users, invitesLog, jails } from "~/db/schema";
import { eq } from "drizzle-orm";
import { AUTO_ROLE_ID } from "~/lib/constants";
import { ModerationService } from "~/services/ModerationService";
import { LevelService } from "~/services/LevelService";
import { RACE_ROLE_IDS } from "~/lib/races";
import { levelOfRoleId, memberRaceId } from "~/lib/race-levels";
import { env } from "~/lib/env";

@Discord()
@Bot("shenron")
@injectable()
export class JoinLeaveEvent {
	constructor(
		@inject(LogService) private logs: LogService,
		@inject(InviteTracker) private invites: InviteTracker,
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(ModerationService) private mod: ModerationService,
		@inject(LevelService) private levels: LevelService
	) {}

	@Once({ event: "clientReady" })
	async init([client]: [Client]) {
		for (const g of client.guilds.cache.values()) {
			await this.invites.sync(g);
			await this.backfillAutoRole(g);
		}
	}

	@On({ event: "inviteCreate" })
	async onInviteCreate([invite]: ArgsOf<"inviteCreate">) {
		if (invite.guild) await this.invites.sync(invite.guild as import("discord.js").Guild);
	}

	@On({ event: "inviteDelete" })
	async onInviteDelete([invite]: ArgsOf<"inviteDelete">) {
		if (invite.guild) await this.invites.sync(invite.guild as import("discord.js").Guild);
	}

	@On({ event: "guildMemberAdd" })
	async onJoin([member]: ArgsOf<"guildMemberAdd">) {
		// 🎯 Sync structurel : tout nouveau membre Discord = row users immediate
		await this.dbs.db.insert(users).values({ id: member.id }).onConflictDoNothing();

		const activeJail = await this.mod.getActiveJail(member.id);
		let jailedOnRejoin = false;

		if (activeJail) {
			if (activeJail.expiresAt && activeJail.expiresAt.getTime() <= Date.now()) {
				// Expired while offline
				await this.dbs.db
					.update(jails)
					.set({ releasedAt: new Date() })
					.where(eq(jails.id, activeJail.id));
				await this.mod.log("UNJAIL", member.id, "bot", "Jail expired while offline");
			} else {
				// Still active! Re-jail them.
				const roleId = env.JAIL_ROLE_ID || process.env.JAIL_ROLE_ID;
				if (roleId) {
					const role =
						member.guild.roles.cache.get(roleId) ??
						(await member.guild.roles.fetch(roleId).catch(() => null));
					if (role) {
						await member.roles.add(role, "Re-jail on rejoin (attempted escape)").catch(() => {});
						jailedOnRejoin = true;

						const jailEmbed = this.logs
							.makeEmbed("⛓️ Re-jail automatique", 0xef4444)
							.setDescription(
								`<@${member.id}> a tenté de fuir en quittant le serveur, mais sa peine est toujours en cours. Le rôle de jail a été réappliqué.`
							)
							.addFields(
								{ name: "Cible", value: `${member.user} (${member.id})`, inline: true },
								{
									name: "Raison de base",
									value: activeJail.reason ?? "*(non précisée)*",
									inline: true,
								}
							);
						await this.logs.send(member.client, "sanction", jailEmbed);
					} else {
						await this.signalerEvasion(
							member,
							activeJail.reason,
							`rôle ${roleId} introuvable sur la guild`
						);
					}
				} else {
					await this.signalerEvasion(member, activeJail.reason, "JAIL_ROLE_ID non configuré");
				}
			}
		}

		if (!jailedOnRejoin) {
			await this.assignAutoRole(member);
		}
		const detected = await this.invites.detectInviter(member.guild);
		// Persiste la paire inviter→invited pour /invitations (best-effort).
		await this.dbs.db
			.insert(invitesLog)
			.values({
				userId: member.id,
				inviterId: detected.inviterId,
				code: detected.code,
			})
			.catch(() => {});
		const embed = this.logs
			.makeEmbed("Nouveau membre", 0x22c55e)
			.setThumbnail(member.user.displayAvatarURL())
			.addFields(
				{ name: "Membre", value: `${member} (${member.id})`, inline: true },
				{
					name: "Compte créé",
					value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
					inline: true,
				},
				{
					name: "Invité par",
					value: detected.inviterId
						? `<@${detected.inviterId}> (code ${detected.code})`
						: "Inconnu",
				}
			);
		await this.logs.send(member.client, "joinLeave", embed);

		// Annonce publique (templatable depuis /messages du dashboard).
		await this.msg.publish(
			"welcome",
			{
				user: `<@${member.id}>`,
				userName: member.user.username,
				userId: member.id,
				guildName: member.guild.name,
				memberCount: member.guild.memberCount,
				inviter: detected.inviterId ? `<@${detected.inviterId}>` : "—",
			},
			member.client
		);
	}

	/**
	 * Le re-cachot a échoué : la peine court toujours mais le rôle n'a pas pu
	 * être réappliqué. Sans ce signalement, l'évasion était TOTALEMENT muette —
	 * ni journal, ni salon de sanction — et le membre repartait blanchi.
	 */
	private async signalerEvasion(
		member: GuildMember,
		raison: string | null | undefined,
		cause: string
	): Promise<void> {
		console.error(
			`[JAIL] Évasion non contrée pour ${member.id} (${member.user.username}) : ${cause}`
		);
		const embed = this.logs
			.makeEmbed("⚠️ Évasion de cachot non contrée", 0xf59e0b)
			.setDescription(
				`<@${member.id}> est revenu avec une peine toujours en cours, mais le rôle de cachot n'a PAS pu être réappliqué. Sanction à reposer à la main.`
			)
			.addFields(
				{ name: "Cible", value: `${member.user} (${member.id})`, inline: true },
				{ name: "Cause", value: cause, inline: true },
				{ name: "Raison de base", value: raison ?? "*(non précisée)*" }
			);
		await this.logs.send(member.client, "sanction", embed).catch(() => {});
	}

	private async assignAutoRole(member: GuildMember): Promise<boolean> {
		if (member.user.bot) return false;
		// Setting `role.auto_join` override la constante AUTO_ROLE_ID — l'admin
		// peut désactiver le feature en ne configurant rien (et la const fallback
		// est aussi un placeholder valide que l'admin peut remplacer).
		const roleId = (await this.settings.getSnowflake("role.auto_join")) ?? AUTO_ROLE_ID;
		if (!roleId) return false;
		// Sécurité : un rôle de RACE ne doit JAMAIS être attribué automatiquement
		// (la race est un choix via /race) — empêche le re-bug « Saiyan auto à tous ».
		if (RACE_ROLE_IDS.includes(roleId)) return false;
		if (member.roles.cache.has(roleId)) return false;
		const role =
			member.guild.roles.cache.get(roleId) ??
			(await member.guild.roles.fetch(roleId).catch(() => null));
		if (!role) return false;
		const me = member.guild.members.me;
		if (me && role.position >= me.roles.highest.position) return false;
		try {
			await member.roles.add(role, "Auto-role Shenron");
			return true;
		} catch {
			return false;
		}
	}

	private async backfillAutoRole(guild: Guild): Promise<void> {
		try {
			await guild.members.fetch();
		} catch {
			return;
		}
		let granted = 0;
		for (const member of guild.members.cache.values()) {
			if (await this.assignAutoRole(member)) granted++;
		}
		if (granted > 0) {
			console.log(`[auto-role] ${granted} membre(s) ont reçu le rôle auto-join sur ${guild.name}`);
		}
	}

	@On({ event: "guildMemberRemove" })
	async onLeave([member]: ArgsOf<"guildMemberRemove">) {
		const embed = this.logs
			.makeEmbed("Départ", 0xef4444)
			.setThumbnail(member.user.displayAvatarURL())
			.addFields(
				{ name: "Membre", value: `${member.user.username} (${member.id})`, inline: true },
				{
					name: "A rejoint",
					value: member.joinedTimestamp
						? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
						: "—",
					inline: true,
				}
			);
		await this.logs.send(member.client, "joinLeave", embed);

		// Annonce publique départ (templatable).
		await this.msg.publish(
			"farewell",
			{
				userName: member.user.username,
				userId: member.id,
				memberCount: member.guild.memberCount,
			},
			member.client
		);
	}

	/**
	 * 🎯 Sync structurel : quand les rôles d'un membre changent, on re-dérive
	 * son `lastLevelReached` + `currentLevelRoleId` en se basant sur le plus
	 * haut rôle level-reward qu'il possède. Évite la dérive DB ↔ Discord.
	 */
	@On({ event: "guildMemberUpdate" })
	async onUpdate([oldM, newM]: ArgsOf<"guildMemberUpdate">) {
		if (oldM.partial) return;
		const oldRoles = new Set(oldM.roles.cache.keys());
		const newRoles = new Set(newM.roles.cache.keys());
		const added = [...newRoles].filter((r) => !oldRoles.has(r));
		const removed = [...oldRoles].filter((r) => !newRoles.has(r));
		if (added.length === 0 && removed.length === 0) return;

		// Changement d'un rôle de RACE (via /race OU le menu de rôles Discord) → on
		// persiste la race en base et on réaligne les rôles de palier : retire ceux
		// des AUTRES races, pose ceux de la nouvelle race jusqu'au niveau atteint.
		if ([...added, ...removed].some((r) => RACE_ROLE_IDS.includes(r))) {
			const race = memberRaceId(newM);
			await this.dbs.db
				.insert(users)
				.values({ id: newM.id, race })
				.onConflictDoUpdate({ target: users.id, set: { race, updatedAt: new Date() } });
			await this.levels.syncRaceLevelRoles(newM);
			return;
		}

		// Sinon : un rôle de palier a changé (action admin) → re-dérive UNIQUEMENT le
		// rôle de palier courant affiché. Le NIVEAU suit l'XP et n'est jamais re-dérivé
		// des rôles (une race sans paliers ne doit pas faire retomber le niveau à 0).
		if (![...added, ...removed].some((r) => levelOfRoleId(r) !== null)) return;
		let best: { level: number; roleId: string } | null = null;
		for (const rid of newRoles) {
			const lvl = levelOfRoleId(rid);
			if (lvl !== null && (!best || lvl > best.level)) best = { level: lvl, roleId: rid };
		}
		await this.dbs.db
			.update(users)
			.set({ currentLevelRoleId: best?.roleId ?? null, updatedAt: new Date() })
			.where(eq(users.id, newM.id));
	}
}
