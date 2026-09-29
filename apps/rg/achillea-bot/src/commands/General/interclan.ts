import { Category } from "@aphrody/utilities";
import type { BaseMessageOptions, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags, userMention } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";
import { DateTime } from "luxon";

import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Clan, Interclan } from "@/entities";
import { ClanEnabled, Disabled } from "@/guards";
import { Database, Logger } from "@/services";
import {
	createInterclanChallengeEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	normalizeNames,
	resolveDependency,
} from "@/utils/functions";

import { InterclanState } from "../../utils/enums";
import { buildDedicatedApproveDenyButtons } from "../../utils/functions/components";
import { logOnAchilleaSpecificClanChannel } from "../../utils/functions/messager";

@Discord()
@Guard(Disabled, ClanEnabled)
@Injectable()
@Category("General")
@SlashGroup({ description: "Gestion des interclans", name: "interclan" })
@SlashGroup("interclan")
export default class InterclanCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Défier un clan rival (délai max. de 7 jours)",
		name: "request",
	})
	async requestInterclan(
		@SlashOption({
			description: "Le sigle du Clan recherché",
			name: "sigle",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		clanSigle: string,
		@SlashOption({
			description: "La date et l'heure du défi au format JJ/mm HH:MM",
			name: "date",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		date: string,
		@SlashOption({
			description: "Une raison/message à déclarer au clan défié",
			name: "motif",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		motif: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// normaliser la saisie : la colonne stocke le sigle normalisé (sinon clan introuvable)
		const challengedClan = await this.db.em.findOne(Clan, {
			normalizedShortName: normalizeNames(clanSigle),
		});

		if (!challengedClan)
			return followUpWithErrorEmbed(
				interaction,
				`Aucun clan avec le sigle ${clanSigle} n'a été trouvé.`
			);

		if (challengedClan.id === clan.id)
			return followUpWithErrorEmbed(interaction, `Vous ne pouvez pas vous auto-défier !`);

		try {
			const parsedDate = this.isValidFutureDate(date);

			const conflict = await this.checkInterclanConflict(clan.id, challengedClan.id, parsedDate);

			if (conflict)
				return followUpWithErrorEmbed(
					interaction,
					`Un interclan est déjà prévu à cette date pour ${clan.id === conflict ? clan.name : challengedClan.name}.`
				);

			const interclan = new Interclan(
				`${clan.shortenedName} vs ${challengedClan.shortenedName}`,
				motif ?? "Aucun motif fourni",
				clan,
				challengedClan,
				parsedDate
			);

			await this.db.em.persist(interclan).flush();

			const captain = await this.db.get(Clan).getCaptain(challengedClan);
			const subCaptains = await this.db.get(Clan).getSubCaptains(challengedClan);

			const mentionsString = [captain, ...subCaptains]
				.filter((member) => member !== null)
				.map((member) => userMention(member.user.id));
			const challengeMsg: BaseMessageOptions = {
				content: `${mentionsString.join(", ")}\n${userMention(interaction.user.id)} du clan ${clan.name} vous défie ! Acceptez-vous ?`,
				embeds: [createInterclanChallengeEmbed(interaction.user.displayName, clan, interclan)],
				components: [
					buildDedicatedApproveDenyButtons("interclan_approval", interclan.id.toString()),
				],
			};

			const logger = await resolveDependency(Logger);

			await logOnAchilleaSpecificClanChannel(logger, challengeMsg, challengedClan.channelId);

			followUpWithSuccessEmbed(
				interaction,
				`Proposition d'Interclan envoyée avec succès au Clan ${challengedClan.name}`,
				true
			);
		} catch (err) {
			return followUpWithErrorEmbed(interaction, `${err}`);
		}
	}

	/**
	 * Checks if a date string in format "DD/mm HH:MM" is valid,
	 * represents a future date, and is within the next 7 days.
	 *
	 * Example valid input: "28/10 14:30"
	 */
	private isValidFutureDate(dateStr: string): Date {
		const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
		if (!match) throw new Error(`Le format de la date ${dateStr} est invalide.`);

		const [, dayStr, monthStr, hourStr, minuteStr] = match;
		const day = Number(dayStr);
		const month = Number(monthStr);
		const hour = Number(hourStr);
		const minute = Number(minuteStr);

		const now = DateTime.now().setZone("Europe/Paris");

		// Interprète "JJ/MM HH:MM" en heure de Paris — DST géré dynamiquement par luxon
		// (l'ancien `hour - 1` figeait CET → décalage d'1 h tout l'été en CEST).
		let parsed = DateTime.fromObject(
			{ year: now.year, month, day, hour, minute, second: 0 },
			{ zone: "Europe/Paris" }
		);

		if (!parsed.isValid) throw new Error(`La date ${dateStr} est invalide.`);

		// Bascule d'année : une date JJ/MM déjà passée (saisie fin décembre pour janvier)
		// est reportée à l'année suivante (l'année n'est plus figée à l'année courante).
		if (parsed < now) parsed = parsed.plus({ years: 1 });

		const oneWeekFromNow = now.plus({ days: 7 });
		if (parsed <= now || parsed > oneWeekFromNow)
			throw new Error(`La date doit être au plus 7 jours dans le futur.`);

		return parsed.toJSDate();
	}

	private async checkInterclanConflict(
		clanAId: number,
		clanBId: number,
		wantedDate: Date
	): Promise<number | null> {
		const now = new Date();
		const weekFromNow = new Date();
		weekFromNow.setDate(now.getDate() + 7);

		const eightHoursMs = 8 * 60 * 60 * 1000;

		// 1️⃣ Find all upcoming interclans for either clan within 7 days
		const interclans = await this.db.em.find(
			Interclan,
			{
				fixedDate: { $gte: now, $lte: weekFromNow },
				state: {
					$in: [
						InterclanState.APPROVED,
						InterclanState.PENDING_APPROVAL,
						InterclanState.ONGOING,
						InterclanState.READY,
					],
				},
				$or: [{ clanA: clanAId }, { clanB: clanAId }, { clanA: clanBId }, { clanB: clanBId }],
			},
			{ populate: ["clanA", "clanB"] }
		);

		// 2️⃣ Compare time difference with wantedDate
		for (const ic of interclans) {
			if (!ic.fixedDate) continue;

			const diffMs = Math.abs(ic.fixedDate.getTime() - wantedDate.getTime());
			if (diffMs < eightHoursMs) {
				// 🚨 Conflict found — figure out which clan caused it
				if (ic.clanA.id === clanAId || ic.clanB.id === clanAId) {
					return clanAId;
				}
				if (ic.clanA.id === clanBId || ic.clanB.id === clanBId) {
					return clanBId;
				}
			}
		}

		return null; // ✅ No conflict
	}
}
