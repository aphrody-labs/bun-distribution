import { Category } from "@aphrody/utilities";
import type {
	BaseMessageOptions,
	ButtonBuilder,
	CommandInteraction,
	StringSelectMenuBuilder,
} from "discord.js";
import { ActionRowBuilder, ApplicationCommandOptionType, MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Clan } from "@/entities";
import { Database } from "@/services";
import {
	createActiveClanInfosEmbed,
	createAllActiveClansEmbed,
	createDisbandedClanInfosEmbed,
	followUpWithErrorEmbed,
	normalizeNames,
	runInRequestContext,
} from "@/utils/functions";

import { ClanState } from "../../utils/enums";
import {
	buildApplicationInitButton,
	buildClansSelector,
	buildPaginationButtons,
	buildReturnButton,
} from "../../utils/functions/components";

@Discord()
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class ClanInfosCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Récupère les informations d'un clan",
		name: "infos",
	})
	async infos(
		@SlashOption({
			description: "Le sigle du Clan recherché",
			name: "sigle",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		clan: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const pagination = 15;
		let currentPage = 1;

		if (!clan) {
			const clans = await this.db.get(Clan).getAllClans(currentPage, pagination);
			const totalPages = Math.ceil(clans[1] / pagination);
			const embed = await createAllActiveClansEmbed(
				interaction,
				clans[0],
				this.db,
				currentPage,
				totalPages
			);

			const msgToSend: BaseMessageOptions = {
				embeds: [embed],
				components: [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						...buildPaginationButtons(currentPage, totalPages)
					),
				],
			};

			if (clans[0].length > 0) {
				// @ts-expect-error
				msgToSend.components.push(
					new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
						buildClansSelector(clans[0])
					)
				);
			}

			const msg = await interaction.followUp(msgToSend);

			const msgCollector = msg.createMessageComponentCollector({
				filter: (i) => i.user.id === interaction.user.id,
				idle: 20_000,
			});

			msgCollector.on("collect", async (i) => {
				// Collector hors pipeline discordx → RequestContext requis (la lecture DB
				// sur l'EM global est sinon refusée par MikroORM).
				await runInRequestContext(this.db, async () => {
					await i.deferUpdate();
					if (i.isStringSelectMenu() && i.customId === "clanSelector") {
						const selectedClan = await this.db
							.get(Clan)
							.findOne({ id: Number(i.values[0]), state: ClanState.Approved, isDisbanded: false });

						if (!selectedClan) {
							followUpWithErrorEmbed(
								interaction,
								`Le Clan sélectionné n'existe pas ou n'est pas actif.`
							);

							return;
						}

						const embed = await createActiveClanInfosEmbed(interaction, selectedClan, this.db);

						await msg.edit({
							embeds: [embed],
							components: [
								new ActionRowBuilder<ButtonBuilder>().addComponents(buildReturnButton()),
							],
						});

						msgCollector.stop("clanSelected");

						return;
					}

					switch (i.customId) {
						case "next-page":
							if (currentPage < totalPages) currentPage++;
							break;

						case "previous-page":
							if (currentPage > 1) currentPage--;
							break;

						case "first-page":
							currentPage = 1;
							break;

						case "last-page":
							currentPage = totalPages;
							break;

						case "return":
							break;

						default:
							return;
					}

					const [updatedClans] = await this.db.get(Clan).getAllClans(currentPage, pagination);
					const updatedEmbed = await createAllActiveClansEmbed(
						interaction,
						updatedClans,
						this.db,
						currentPage,
						totalPages
					);

					const components: any = [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							...buildPaginationButtons(currentPage, totalPages)
						),
					];
					if (updatedClans.length > 0) {
						components.push(
							new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
								buildClansSelector(updatedClans)
							)
						);
					}

					await msg.edit({
						embeds: [updatedEmbed],
						components,
					});
				});
			});

			msgCollector.on("end", async () => {
				await msg.edit({
					components: [], // Remove buttons when collector ends
				});
			});

			return;
		}

		const normalizedShortName = normalizeNames(clan);

		const targetClan = await this.db.get(Clan).findOne({ normalizedShortName });
		if (!targetClan) {
			followUpWithErrorEmbed(interaction, `Le Clan recherché avec le sigle ${clan} n'existe pas.`);

			return;
		}
		const embed = targetClan.isDisbanded
			? await createDisbandedClanInfosEmbed(interaction, targetClan)
			: await createActiveClanInfosEmbed(interaction, targetClan, this.db);

		const disableButton = !targetClan.isRecruiting;

		await interaction.editReply({
			embeds: [embed],
			components: targetClan.isDisbanded
				? []
				: [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							buildApplicationInitButton(targetClan.id.toString(), disableButton)
						) as any,
					],
		});
	}
}
