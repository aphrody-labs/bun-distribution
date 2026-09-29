import { inject, injectable } from "tsyringe";
import { Bot, ButtonComponent, Discord, Guard, Slash } from "discordx";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type ButtonInteraction,
	type CommandInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { DatabaseService } from "~/db/index";
import { users } from "~/db/schema";
import { LevelService } from "~/services/LevelService";
import { RACES, RACE_IDS, RACE_ROLE_IDS, getRace, type RaceId } from "~/lib/races";
import { logger } from "~/lib/logger";

/**
 * /race — choisir/consulter sa race (système inspiré Xenoverse 2).
 * La race module la progression (XP, vocal, zéni, jeux) via lib/races.ts.
 */
@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class RaceCommands {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(LevelService) private levels: LevelService
	) {}

	private overview(currentRace: string | null): EmbedBuilder {
		const cur = getRace(currentRace);
		const embed = new EmbedBuilder()
			.setTitle("🐉 Choisis ta race")
			.setColor(cur?.color ?? 0xfbbf24)
			.setDescription(
				cur
					? `Ta race actuelle : **${cur.emoji} ${cur.name}**\n*${cur.perk}*\n\nClique pour en changer :`
					: "Chaque race modifie ta **progression** (XP, vocal, zéni, jeux). Choisis la tienne :"
			);
		for (const id of RACE_IDS) {
			const r = RACES[id];
			embed.addFields({
				name: `${r.emoji} ${r.name}${cur?.id === id ? "  ✓" : ""}`,
				value: `${r.perk}\n*${r.trait}*`,
			});
		}
		return embed;
	}

	private buttons(currentRace: string | null) {
		const row = new ActionRowBuilder<ButtonBuilder>();
		for (const id of RACE_IDS) {
			const r = RACES[id];
			row.addComponents(
				new ButtonBuilder()
					.setCustomId(`race:set:${id}`)
					.setLabel(r.name)
					.setEmoji(r.emoji)
					.setStyle(currentRace === id ? ButtonStyle.Success : ButtonStyle.Secondary)
					.setDisabled(currentRace === id)
			);
		}
		return row;
	}

	@Slash({
		name: "race",
		description: "Choisis ta race (modifie ta progression : XP, vocal, zéni, jeux)",
	})
	async race(interaction: CommandInteraction) {
		const u = await this.levels.getUser(interaction.user.id);
		await interaction.reply({
			embeds: [this.overview(u?.race ?? null)],
			components: [this.buttons(u?.race ?? null)],
			flags: MessageFlags.Ephemeral,
		});
	}

	@ButtonComponent({ id: /^race:set:(saiyan|humain|namek|mutant|cyborg|majin)$/ })
	async setRace(interaction: ButtonInteraction) {
		const id = interaction.customId.split(":")[2] as RaceId;
		const def = RACES[id];
		await this.levels.ensureUser(interaction.user.id);
		await this.dbs.db
			.update(users)
			.set({ race: id, raceChosenAt: new Date() })
			.where(eq(users.id, interaction.user.id));

		// Rôle Discord exclusif : pose celui de la race choisie, retire les autres.
		try {
			const member = await interaction.guild?.members.fetch(interaction.user.id);
			if (member) {
				const toRemove = RACE_ROLE_IDS.filter((r) => r !== def.roleId && member.roles.cache.has(r));
				if (toRemove.length) await member.roles.remove(toRemove, "Changement de race");
				if (!member.roles.cache.has(def.roleId))
					await member.roles.add(def.roleId, `Race : ${def.name}`);
				// Réaligne les rôles de palier sur la nouvelle race (retire ceux des
				// autres races, pose ceux de la race choisie jusqu'au niveau atteint).
				await this.levels.syncRaceLevelRoles(member);
			}
		} catch (err) {
			logger.warn({ err, race: id }, "race role assignment failed");
		}

		await interaction.update({
			embeds: [
				this.overview(id)
					.setTitle(`${def.emoji} Tu es désormais ${def.name} !`)
					.setColor(def.color),
			],
			components: [this.buttons(id)],
		});
	}
}
