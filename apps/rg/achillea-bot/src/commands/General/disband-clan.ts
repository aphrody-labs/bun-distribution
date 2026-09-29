import { Category } from "@aphrody/utilities";
import type { ButtonInteraction, CommandInteraction, ModalSubmitInteraction } from "discord.js";
import { ComponentType, escapeMarkdown, MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import type { Clan } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database, Logger } from "@/services";
import {
	buildClanDisbandEmbed,
	buildInfoEmbed,
	buildSuccessEmbed,
	disbandClan,
	followUpWithErrorEmbed,
	resolveDependency,
	runInRequestContext,
} from "@/utils/functions";

import { ClanMemberRole } from "../../utils/enums";
import { buildConfirmCancelButtons } from "../../utils/functions/components";
import {
	logOnAchilleaGenericClanChannel,
	logOnClanGuildChannel,
} from "../../utils/functions/messager";

@Discord()
@Guard(ClanEnabled, ClanRole(ClanMemberRole.Captain))
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class DisbandClanCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Disband your Clan",
		name: "disband",
	})
	async disband(
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// @ts-ignore
		const reply = await interaction.followUp({
			content: `Do you really want to __disband__ ${clan.name} ?`,
			fetchReply: true,
			components: [buildConfirmCancelButtons()],
		});
		const disbandCollector = reply.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === interaction.user.id,
			time: 10_000,
			max: 1,
		});

		disbandCollector.on("collect", async (btnInteraction) => {
			if (btnInteraction.customId === "confirm") {
				await btnInteraction.deferUpdate();
				// Collector hors pipeline discordx → on force un RequestContext pour que
				// `db.em` résolve un fork (sinon EM global refusé par MikroORM).
				await runInRequestContext(this.db, async () => {
					try {
						await disbandClan(clan, this.db, client);
						await btnInteraction
							.editReply({
								content: "",
								components: [],
								embeds: [buildSuccessEmbed(`Clan ${clan.name} has been disbanded successfully !`)],
							})
							.catch(() => {});
						await this.logDisband(clan, btnInteraction);
					} catch (err) {
						console.error("[disband-clan] échec de la dissolution:", err);
						followUpWithErrorEmbed(
							btnInteraction,
							err instanceof Error ? err.message : "La dissolution du clan a échoué.",
							true
						);
					}
				});
			} else if (btnInteraction.customId === "cancel") {
				await btnInteraction.deferUpdate();
				await btnInteraction.deleteReply();
			}
		});

		disbandCollector.on("end", async () => {
			if (disbandCollector.endReason === "time") {
				await reply.edit({
					content: "You took too long to respond, please try again.",
					components: [],
				});
			}
		});
	}

	async logDisband(
		clan: Clan,
		interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction
	) {
		const logger = await resolveDependency(Logger);
		await logOnClanGuildChannel(
			logger,
			{
				embeds: [
					buildInfoEmbed(
						`Votre Clan a été dissout par ${escapeMarkdown(interaction.user.displayName)} ! Merci d'avoir contribué à la communauté et au plaisir de vous revoir.`
					),
				],
			},
			clan.guild
		);

		await logOnAchilleaGenericClanChannel(logger, { embeds: [await buildClanDisbandEmbed(clan)] });
	}
}
