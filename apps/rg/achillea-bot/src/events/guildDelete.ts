import type { ArgsOf, Client } from "@aphrody/discordx";
import { markDiscordGuildLeft } from "@rosegriffon/discord-sync";

import { discordBotProfile } from "@/configs";
import { Discord, On } from "@/decorators";

@Discord()
export default class GuildDeleteEvent {
	@On("guildDelete")
	async guildDeleteHandler([oldGuild]: ArgsOf<"guildDelete">, client: Client) {
		if (process.env.RG_DISCORD_SYNC_SQLITE_PATH && client.user) {
			try {
				markDiscordGuildLeft({ sourceBotId: client.user.id, profile: discordBotProfile.name }, oldGuild.id);
			} catch (error) {
				console.error(`[discord-sync] guild=${oldGuild.id} leave failed:`, error instanceof Error ? error.message : String(error));
			}
		}
	}
}
