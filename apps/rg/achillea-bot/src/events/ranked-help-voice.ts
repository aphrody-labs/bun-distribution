import type { ArgsOf, Client } from "@aphrody/discordx";
import type { TextChannel } from "discord.js";

import { coreManagerConfig } from "@/configs";
import { Discord, On } from "@/decorators";

/**
 * Salon 🛑・Aide Ranked (vocal) : quand un joueur rejoint le vocal de support,
 * on alerte le staff / les Tournament Organizers dans leur salon dédié.
 */
@Discord()
export default class RankedHelpVoiceEvent {
	@On("voiceStateUpdate")
	async onVoiceStateUpdate(
		[oldState, newState]: ArgsOf<"voiceStateUpdate">,
		client: Client
	): Promise<void> {
		const voiceId = coreManagerConfig.helpRankedVoiceId;
		const toId = coreManagerConfig.toChannelId;
		if (!voiceId || !toId) return;

		// uniquement une ENTRÉE dans le vocal d'aide (pas un départ ni un mute/déplacement interne)
		const joined = newState.channelId === voiceId && oldState.channelId !== voiceId;
		if (!joined) return;

		const channel = (await client.channels.fetch(toId).catch(() => null)) as TextChannel | null;
		if (!channel || typeof channel.send !== "function") return;

		await channel
			.send(
				`🔔 <@${newState.id}> vient de rejoindre le vocal **Aide Ranked** — assistance / arbitrage demandé.`
			)
			.catch((e) => console.error("[ranked-help-voice] envoi alerte TO KO", e));
	}
}
