import { injectable } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";
import { recordDiscordProfile } from "~/lib/discord-profiles";

/**
 * Keeps the persisted Discord profiles (username + avatar hash) in sync with
 * the gateway, so the public leaderboard and profile pages never build an
 * avatar URL from a hash Discord has already retired.
 *
 * discord.js emits `userUpdate` whenever a cached user changes, including the
 * user object carried by GUILD_MEMBER_UPDATE / PRESENCE_UPDATE. The
 * `guildMemberUpdate` handler covers members whose user was not cached yet.
 */
@Discord()
@Bot("shenron")
@injectable()
export class DiscordProfileSyncEvent {
	@On({ event: "userUpdate" })
	onUserUpdate([oldUser, newUser]: ArgsOf<"userUpdate">) {
		if (newUser.partial || newUser.bot) return;
		if (
			!oldUser.partial &&
			oldUser.avatar === newUser.avatar &&
			oldUser.username === newUser.username
		) {
			return;
		}
		try {
			recordDiscordProfile(newUser);
		} catch (err) {
			logger.warn({ err, userId: newUser.id }, "discord profile sync (userUpdate) failed");
		}
	}

	@On({ event: "guildMemberUpdate" })
	onGuildMemberUpdate([, newMember]: ArgsOf<"guildMemberUpdate">) {
		if (newMember.guild.id !== env.GUILD_ID) return;
		const user = newMember.user;
		if (user.partial || user.bot) return;
		try {
			// Writes only when the stored username/avatar differ.
			recordDiscordProfile(user);
		} catch (err) {
			logger.warn({ err, userId: user.id }, "discord profile sync (guildMemberUpdate) failed");
		}
	}
}
