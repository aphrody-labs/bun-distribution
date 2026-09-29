import { BodyParams, Controller, Delete, Get, PathParams, Post, UseBefore } from "@tsed/common";
import { NotFound, Unauthorized } from "@tsed/exceptions";
import { Required } from "@tsed/schema";
import type { BaseGuildTextChannel, BaseGuildVoiceChannel, NewsChannel } from "discord.js";
import { ChannelType, PermissionsBitField } from "discord.js";
import { Client, MetadataStorage } from "@aphrody/discordx";

import { BotOnline, DevAuthenticated } from "@/api/middlewares";
import { generalConfig } from "@/configs";
import { Guild, User } from "@/entities";
import { Database } from "@/services";
import { BaseController } from "@/utils/classes";
import {
	getDevs,
	isDev,
	isInMaintenance,
	resolveDependenciesSync,
	setMaintenance,
} from "@/utils/functions";

@Controller("/bot")
@UseBefore(BotOnline, DevAuthenticated)
export class BotController extends BaseController {
	private client: Client;

	// test
	private db: Database;

	constructor() {
		super();
		const runtimeClient = (globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient;
		this.client = runtimeClient ?? resolveDependenciesSync([Client])[0];
		[this.db] = resolveDependenciesSync([Database]);
	}

	@Get("/info")
	async info() {
		const user: any = this.client.user?.toJSON();
		if (user) {
			user.iconURL = this.client.user?.displayAvatarURL();
			user.bannerURL = this.client.user?.bannerURL();
		}

		return {
			user,
			owner: (await this.client.users.fetch(generalConfig.ownerId).catch(() => null))?.toJSON(),
		};
	}

	@Get("/commands")
	async commands() {
		const commands = MetadataStorage.instance.applicationCommands;

		return commands.map((command) => command.toJSON());
	}

	@Get("/guilds")
	async guilds() {
		const body: any[] = [];

		for (const discordRawGuild of this.client.guilds.cache.values()) {
			const discordGuild: any = discordRawGuild.toJSON();
			discordGuild.iconURL = discordRawGuild.iconURL();
			discordGuild.bannerURL = discordRawGuild.bannerURL();

			const databaseGuild = await this.db.get(Guild).findOne({ id: discordGuild.id });

			body.push({
				discord: discordGuild,
				database: databaseGuild,
			});
		}

		return body;
	}

	@Get("/guilds/:id")
	async guild(@PathParams("id") id: string) {
		// get discord guild
		const discordRawGuild = await this.client.guilds.fetch(id).catch(() => null);
		if (!discordRawGuild) throw new NotFound("Guild not found");

		const discordGuild: any = discordRawGuild.toJSON();
		discordGuild.iconURL = discordRawGuild.iconURL();
		discordGuild.bannerURL = discordRawGuild.bannerURL();

		// get database guild
		const databaseGuild = await this.db.get(Guild).findOne({ id });

		return {
			discord: discordGuild,
			database: databaseGuild,
		};
	}

	@Delete("/guilds/:id")
	async deleteGuild(@PathParams("id") id: string) {
		const guild = await this.client.guilds.fetch(id).catch(() => null);
		if (!guild) throw new NotFound("Guild not found");

		await guild.leave();

		return {
			success: true,
			message: "Guild deleted",
		};
	}

	@Get("/guilds/:id/invite")
	async invite(@PathParams("id") id: string) {
		const guild = await this.client.guilds.fetch(id).catch(() => null);
		if (!guild) throw new NotFound("Guild not found");

		const guildChannels = await guild.channels.fetch();

		let invite: any;
		for (const channel of guildChannels.values()) {
			if (
				channel &&
				(guild.members.me
					?.permissionsIn(channel)
					.has(PermissionsBitField.Flags.CreateInstantInvite) ||
					false) &&
				[ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement].includes(
					channel.type
				)
			) {
				invite = await (
					channel as BaseGuildTextChannel | BaseGuildVoiceChannel | NewsChannel | undefined
				)?.createInvite();
				if (invite) break;
			}
		}

		if (invite) return invite.toJSON();
		else throw new Unauthorized("Missing permission to create an invite in this guild");
	}

	@Get("/users")
	async users() {
		const users: any[] = [];
		const guilds = this.client.guilds.cache.values();

		for (const guild of guilds) {
			const members = await guild.members.fetch();

			for (const member of members.values()) {
				if (!users.find((user) => user.id === member.id)) {
					const discordUser: any = member.user.toJSON();
					discordUser.iconURL = member.user.displayAvatarURL();
					discordUser.bannerURL = member.user.bannerURL();

					const databaseUser = await this.db.get(User).findOne({ id: discordUser.id });

					users.push({
						discord: discordUser,
						database: databaseUser,
					});
				}
			}
		}

		return users;
	}

	// DOIT rester déclarée AVANT `@Get("/users/:id")` : les routes sont montées
	// dans l'ordre de déclaration, et `/users/:id` capturait « cached » comme
	// identifiant Discord — la route ne répondait jamais.
	@Get("/users/cached")
	async cachedUsers() {
		return this.client.users.cache.map((user) => user.toJSON());
	}

	@Get("/users/:id")
	async user(@PathParams("id") id: string) {
		// get discord user
		const discordRawUser = await this.client.users.fetch(id).catch(() => null);
		if (!discordRawUser) throw new NotFound("User not found");

		const discordUser: any = discordRawUser.toJSON();
		discordUser.iconURL = discordRawUser.displayAvatarURL();
		discordUser.bannerURL = discordRawUser.bannerURL();

		// get database user
		const databaseUser = await this.db.get(User).findOne({ id });

		return {
			discord: discordUser,
			database: databaseUser,
		};
	}

	@Get("/maintenance")
	async maintenance() {
		return {
			maintenance: await isInMaintenance(),
		};
	}

	@Post("/maintenance")
	async setMaintenance(@Required() @BodyParams("maintenance") maintenance: boolean) {
		await setMaintenance(maintenance);

		return {
			maintenance,
		};
	}

	@Get("/devs")
	async devs() {
		return getDevs();
	}

	@Get("/devs/:id")
	async dev(@PathParams("id") id: string) {
		return isDev(id);
	}
}
