import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import { ClanEnabled } from "@/guards";
import { Database, Logger } from "@/services";
import {
	buildSuccessEmbed,
	followUpWithErrorEmbed,
	leaveClan,
	logMemberDeparture,
	resolveDependency,
	runInRequestContext,
} from "@/utils/functions";

import { ClanMemberRole } from "../../utils/enums";
import { buildConfirmCancelButtons } from "../../utils/functions/components";

@Discord()
@Guard(ClanEnabled)
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class LeaveClanCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Quittez votre Clan",
		name: "leave",
	})
	async leave(
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await this.db.em.populate(clan, ["guild"]);

		if (clanMember.role === ClanMemberRole.Captain) {
			followUpWithErrorEmbed(interaction, "Le Président ne peut pas quitter son Clan !");

			return;
		}

		// @ts-ignore
		const reply = await interaction.followUp({
			content: `Souhaitez-vous quitter le clan ${clan.name} ?`,
			withResponse: true,
			components: [buildConfirmCancelButtons()],
		});
		const leaveCollector = reply.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === interaction.user.id,
			time: 10_000,
			max: 1,
		});

		leaveCollector.on("collect", async (btnInteraction) => {
			if (btnInteraction.customId === "confirm") {
				await btnInteraction.deferUpdate();

				const logger = await resolveDependency(Logger);

				// Le collector se déclenche hors pipeline discordx → aucun RequestContext
				// actif → `db.em` retomberait sur l'EM global (MikroORM refuse). On force
				// un fork de contexte pour toute la mutation de départ.
				await runInRequestContext(this.db, async () => {
					try {
						await leaveClan(this.db, clanMember, clan, client, logger);
						// éditer le message PORTEUR des boutons (followUp), pas le placeholder éphémère
						await btnInteraction.editReply({
							content: "",
							components: [],
							embeds: [buildSuccessEmbed(`Vous avez quitté le Clan ${clan.name} !`)],
						});

						await logMemberDeparture(client, logger, clan, clanMember);
					} catch (err) {
						await followUpWithErrorEmbed(interaction, (err as Error).message, true);
					}
				});
			} else if (btnInteraction.customId === "cancel") {
				await btnInteraction.deferUpdate();
				await btnInteraction.deleteReply();
			}
		});

		leaveCollector.on("end", async () => {
			if (leaveCollector.endReason === "time") {
				await reply.edit({
					content: "Délai d'attente dépassé, veuillez réessayer.",
					components: [],
				});
			}
		});
	}
}
