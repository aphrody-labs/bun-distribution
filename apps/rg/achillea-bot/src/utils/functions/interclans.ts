import type { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import type { Clan, Interclan } from "@/entities";
import type { Database } from "@/services";
import { Logger } from "@/services";

import { InterclanState } from "../enums";
import { resolveDependency } from "./dependency";
import { buildErrorEmbed } from "./embeds";
import { logOnAchilleaSpecificClanChannel } from "./messager";

export async function cancelInterclan(
	interclan: Interclan,
	client: Client,
	db: Database,
	clan?: Clan
) {
	// ✅ Set to cancelled
	interclan.state = InterclanState.CANCELED;

	// Delete its Discord channel if exists
	if (interclan.discordChannelId) {
		try {
			const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);
			const channel = await guild.channels.fetch(interclan.discordChannelId);
			if (channel) await channel.delete(`Interclan #${interclan.id} annulé`);
		} catch (err) {
			console.warn(
				`[InterclanCancel] Impossible de supprimer le salon pour interclan ${interclan.id}:`,
				err
			);
		}
	}

	await db.em.persist(interclan).flush();

	// ✅ Log the event in both clan channels
	const logger = await resolveDependency(Logger);

	const cancelMsg = buildErrorEmbed(
		`L'interclan entre **${interclan.clanA.name}** et **${interclan.clanB.name}** a été annulé ${clan ? `par ${clan.name}` : "pour expiration de la procédure de vote."}.`
	);

	await logOnAchilleaSpecificClanChannel(
		logger,
		{ embeds: [cancelMsg] },
		interclan.clanA.channelId
	);
	await logOnAchilleaSpecificClanChannel(
		logger,
		{ embeds: [cancelMsg] },
		interclan.clanB.channelId
	);
}
