import type { ArgsOf, Client } from "@aphrody/discordx";
import { syncDiscordGuildSnapshot } from "@rosegriffon/discord-sync";

import { discordBotProfile } from "@/configs";
import { Discord, On } from "@/decorators";
import { syncGuild } from "@/utils/functions";

@Discord()
export default class GuildCreateEvent {
	@On("guildCreate")
	async guildCreateHandler([newGuild]: ArgsOf<"guildCreate">, client: Client) {
		await syncGuild(newGuild.id, client);
		if (process.env.RG_DISCORD_SYNC_SQLITE_PATH && client.user) {
			try {
				await syncDiscordGuildSnapshot(newGuild, {
					sourceBotId: client.user.id,
					profile: discordBotProfile.name,
				});
			} catch (error) {
				console.error(`[discord-sync] guild=${newGuild.id} failed:`, error instanceof Error ? error.message : String(error));
			}
		}
	}
}
