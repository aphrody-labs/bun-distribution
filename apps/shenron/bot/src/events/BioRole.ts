import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, Once, type ArgsOf } from "discordx";
import type { Client, Guild, GuildMember, Presence } from "discord.js";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";
import { CronRegistry } from "~/api/cron-registry";
import { SettingsService } from "~/services/SettingsService";

/**
 * Détecte l'URL du serveur dans le statut custom / activité d'un membre.
 * Donne le rôle URL_IN_BIO_ROLE_ID si trouvé, le retire sinon.
 * Note: Discord ne permet pas de lire la "About Me" via bot API — on détecte
 * l'URL dans le custom status / activity.state uniquement.
 */
@Discord()
@Bot("shenron")
@injectable()
export class BioRoleEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(SettingsService) private settings: SettingsService
	) {}

	private key(guildId: string) {
		return env.SERVER_INVITE_URL.replace(/^https?:\/\//, "")
			.replace(/\/$/, "")
			.toLowerCase();
	}

	private hasInvite(member: GuildMember): boolean {
		const invitePattern = this.key(member.guild.id);
		if (!invitePattern) return false;
		for (const activity of member.presence?.activities ?? []) {
			const text =
				`${activity.name ?? ""} ${activity.state ?? ""} ${activity.details ?? ""} ${activity.url ?? ""}`.toLowerCase();
			if (text.includes(invitePattern)) return true;
		}
		return false;
	}

	async sync(member: GuildMember) {
		const roleId = env.URL_IN_BIO_ROLE_ID;
		if (!roleId) return;
		if (!(await this.settings.getBool("features.bio_role", true))) return;
		try {
			const has = this.hasInvite(member);
			const hasRole = member.roles.cache.has(roleId);
			if (has && !hasRole) await member.roles.add(roleId);
			else if (!has && hasRole) await member.roles.remove(roleId);
		} catch (err) {
			logger.warn({ err, userId: member.id }, "bio-role sync failed");
		}
	}

	@Once({ event: "clientReady" })
	async onReady([client]: [Client]) {
		this.cron.register({
			name: "bio-role-scan",
			description: "Scan complet des présences pour détecter l'invite serveur en bio",
			intervalMs: 3_600_000, // 1h
			fn: () => this.scanAll(client),
		});
		await this.scanAll(client);
	}

	async scanAll(client: Client) {
		for (const guild of client.guilds.cache.values()) {
			const members = await guild.members.fetch().catch(() => null);
			if (!members) continue;
			for (const m of members.values()) {
				await this.sync(m);
			}
		}
	}

	@On({ event: "presenceUpdate" })
	async onPresence([_oldP, newP]: ArgsOf<"presenceUpdate">) {
		const member = newP.member;
		if (member) await this.sync(member);
	}
}
