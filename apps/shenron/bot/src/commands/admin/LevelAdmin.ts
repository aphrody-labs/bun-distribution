import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashOption } from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	MessageFlags,
	type CommandInteraction,
	type Role,
	type User,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { LevelService } from "~/services/LevelService";
import { levelForXP, xpRequiredForLevel } from "~/lib/xp";

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@injectable()
export class LevelAdminCommands {
	constructor(@inject(LevelService) private levels: LevelService) {}

	// /niveau : admin uniquement — modifie XP/niveau d'un membre, d'un rôle, ou de tous les inscrits
	@Slash({
		name: "niveau",
		description: "Admin: modifier niveau/xp",
	})
	async niveauAdmin(
		@SlashChoice({ name: "give", value: "give" })
		@SlashChoice({ name: "remove", value: "remove" })
		@SlashOption({
			name: "action",
			description: "give/remove",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "give" | "remove",
		@SlashChoice({ name: "niveau", value: "niveau" })
		@SlashChoice({ name: "exp", value: "exp" })
		@SlashOption({
			name: "type",
			description: "niveau ou exp",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		kind: "niveau" | "exp",
		@SlashOption({
			name: "montant",
			description: "Montant",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 1,
		})
		amount: number,
		@SlashOption(
			{
				name: "membre",
				description: "Membre",
				type: ApplicationCommandOptionType.User,
				required: false,
			},
			userTransformer
		)
		user: User | undefined,
		@SlashOption({
			name: "role",
			description: "Rôle",
			type: ApplicationCommandOptionType.Role,
			required: false,
		})
		role: Role | undefined,
		@SlashOption({
			name: "all",
			description: "Tous les inscrits",
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		})
		all: boolean | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const sign = action === "give" ? 1 : -1;

		const compute = (currentXP: number): number => {
			if (kind === "exp") return Math.max(0, currentXP + sign * amount);
			const currentLevel = levelForXP(currentXP);
			const newLevel = Math.max(0, currentLevel + sign * amount);
			if (newLevel === 0) return 0;
			return xpRequiredForLevel(newLevel);
		};

		const apply = async (id: string) => {
			const c = await this.levels.getUser(id);
			const res = await this.levels.setXP(id, compute(c?.xp ?? 0));
			if (res.levelUp) {
				const member = await interaction.guild?.members.fetch(id).catch(() => null);
				if (member) {
					await this.levels.handleLevelUp(member, res.newLevel);
				}
			}
		};

		if (user) {
			await apply(user.id);
			await interaction.editReply({ content: `✅ Appliqué à ${user}.` });
			return;
		}
		if (role) {
			const members = await interaction.guild.members.fetch();
			let count = 0;
			for (const m of members.values()) {
				if (m.roles.cache.has(role.id)) {
					await apply(m.id);
					count++;
				}
			}
			await interaction.editReply({ content: `✅ Appliqué à ${count} membres avec ${role}.` });
			return;
		}
		if (all) {
			const allUsers = await this.levels.top(10_000, 0);
			for (const u of allUsers) await apply(u.id);
			await interaction.editReply({
				content: `✅ Appliqué à ${allUsers.length} membres inscrits.`,
			});
			return;
		}
		await interaction.editReply({ content: "Spécifiez un membre, un rôle, ou all:true." });
	}
}
