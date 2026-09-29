import { Client } from "@aphrody/discordx";
import type { Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { coreManagerConfig } from "@/configs";
import { Service } from "@/decorators";
import type { Tournament } from "@/entities";


interface TournamentRoleDatabase {
	event: {
		id: number;
		discord_role_id: string | null;
		discord_guild_id: string | null;
	};
}

const sql = createAchilleaSql<TournamentRoleDatabase>() as Kysely<TournamentRoleDatabase>;

/**
 * Rôle Discord attribué automatiquement aux inscrits d'un tournoi.
 *
 * Reprend le mécanisme des rôles de clan (`ClanService.createAndSetupClanRole`,
 * `utils/functions/clan.ts`) avec les mêmes garde-fous, appris en production :
 * le joueur peut ne pas être sur le serveur, le rôle peut avoir été supprimé à la
 * main, le bot peut manquer de permission ou être sous la cible dans la hiérarchie.
 * Aucun de ces cas ne doit faire échouer l'inscription elle-même — une inscription
 * refusée parce qu'un rôle Discord manque serait un contresens.
 */
@Service()
export class TournamentRoleService {
	private get client(): Client {
		const client = (globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient;
		if (!client) throw new Error("Discord client is not initialized");
		return client;
	}

	/**
	 * Crée le rôle du tournoi s'il n'en a pas déjà un, et le mémorise sur l'entité.
	 * Renvoie l'id du rôle, ou null si Discord n'a pas pu le créer.
	 */
	async ensureRole(tournament: Tournament): Promise<string | null> {
		// Case décochée : aucun rôle n'est créé, et les appels d'attribution qui suivent
		// deviennent des no-op puisqu'il n'y a pas d'id à distribuer.
		if (!tournament.discordRoleEnabled) return null;

		if (tournament.discordRoleId) return tournament.discordRoleId;

		try {
			const guildId = tournament.discordGuildId || coreManagerConfig.coreGuildId;
			const guild = await this.client.guilds.fetch(guildId);

			const role = await guild.roles.create({
				name: this.roleName(tournament),
				mentionable: true,
				reason: `Rôle automatique du tournoi ${tournament.name} (#${tournament.id})`,
			});

			tournament.discordRoleId = role.id;
			tournament.discordGuildId = guild.id;
			await sql
				.updateTable("event")
				.set({ discord_role_id: role.id, discord_guild_id: guild.id })
				.where("id", "=", tournament.id)
				.executeTakeFirstOrThrow();

			return role.id;
		} catch (error) {
			console.warn(
				`[TournamentRoleService] création du rôle impossible (tournoi ${tournament.id}) :`,
				(error as Error)?.message
			);
			return null;
		}
	}

	/** Attribue le rôle du tournoi à un joueur. Sans effet si le tournoi n'en a pas. */
	async assign(tournament: Tournament, userId: string): Promise<boolean> {
		const roleId = tournament.discordRoleId;
		if (!roleId) return false;

		try {
			const guild = await this.client.guilds.fetch(
				tournament.discordGuildId || coreManagerConfig.coreGuildId
			);
			const member = await guild.members.fetch(userId);
			await member.roles.add(roleId, `Inscription au tournoi ${tournament.name}`);
			return true;
		} catch (error) {
			// Cas courant et sans gravité : le joueur s'inscrit depuis le site sans être
			// (ou plus) sur le serveur Discord.
			console.info(
				`[TournamentRoleService] rôle non attribué à ${userId} (tournoi ${tournament.id}) :`,
				(error as Error)?.message
			);
			return false;
		}
	}

	async unassign(tournament: Tournament, userId: string): Promise<boolean> {
		const roleId = tournament.discordRoleId;
		if (!roleId) return false;

		try {
			const guild = await this.client.guilds.fetch(
				tournament.discordGuildId || coreManagerConfig.coreGuildId
			);
			const member = await guild.members.fetch(userId);
			await member.roles.remove(roleId, `Retrait du tournoi ${tournament.name}`);
			return true;
		} catch (error) {
			console.info(
				`[TournamentRoleService] rôle non retiré à ${userId} (tournoi ${tournament.id}) :`,
				(error as Error)?.message
			);
			return false;
		}
	}

	/** Supprime le rôle du serveur (annulation de tournoi) et oublie la référence. */
	async deleteRole(tournament: Tournament, reason: string): Promise<void> {
		const roleId = tournament.discordRoleId;
		if (!roleId) return;

		try {
			const guild = await this.client.guilds.fetch(
				tournament.discordGuildId || coreManagerConfig.coreGuildId
			);
			const role = await guild.roles.fetch(roleId);
			if (role) await role.delete(reason);
		} catch (error) {
			console.warn(
				`[TournamentRoleService] suppression du rôle impossible (tournoi ${tournament.id}) :`,
				(error as Error)?.message
			);
		} finally {
			// La référence est oubliée même si Discord a refusé : garder l'id d'un rôle
			// qu'on ne sait plus manipuler ferait échouer chaque attribution suivante.
			tournament.discordRoleId = null;
			await sql
				.updateTable("event")
				.set({ discord_role_id: null })
				.where("id", "=", tournament.id)
				.executeTakeFirst()
				.catch(() => undefined);
		}
	}

	/** `Nom du tournoi` tronqué à la limite Discord (100 caractères). */
	private roleName(tournament: Tournament): string {
		const name = tournament.name.trim();
		return name.length <= 100 ? name : `${name.slice(0, 97)}...`;
	}
}
