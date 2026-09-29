import {
	ApplicationCommandOptionType,
	ChannelType,
	MessageFlags,
	type CommandInteraction,
} from "discord.js";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashOption } from "discordx";
import { GuildOnly } from "~/guards/GuildOnly";

/**
 * /ids — liste tous les IDs de rôles / salons de la guild (ephemeral).
 * Pratique pour remplir `.env` (JAIL_ROLE_ID, LOG_*_CHANNEL_ID, etc.)
 * sans quitter Discord.
 */
@Discord()
@Bot("shenron")
@Guard(GuildOnly)
export class IdsCommand {
	@Slash({
		name: "ids",
		description: "Lister les IDs rôles/salons du serveur (admin only)",
	})
	async ids(
		@SlashChoice({ name: "roles", value: "roles" })
		@SlashChoice({ name: "salons", value: "channels" })
		@SlashChoice({ name: "tout", value: "all" })
		@SlashOption({
			name: "quoi",
			description: "roles | salons | tout (défaut : tout)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		what: "roles" | "channels" | "all" | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const scope = what ?? "all";
		const sections: string[] = [];
		const guild = interaction.guild;

		if (scope !== "channels") {
			const roles = [...guild.roles.cache.values()]
				.filter((r) => r.name !== "@everyone")
				.toSorted((a, b) => b.position - a.position);
			const lines = roles.map((r) => {
				const managed = r.managed ? " *(intégration)*" : "";
				return `\`${r.id}\` · ${r.name}${managed}`;
			});
			sections.push(`**Rôles (${roles.length})**\n${lines.join("\n") || "—"}`);
		}

		if (scope !== "roles") {
			const channels = [...guild.channels.cache.values()]
				.filter((c) => "position" in c)
				.toSorted(
					(a, b) =>
						a.type - b.type ||
						((a as { position: number }).position ?? 0) -
							((b as { position: number }).position ?? 0)
				);
			const groups = new Map<string, string[]>();
			const typeLabel = (t: ChannelType): string => {
				switch (t) {
					case ChannelType.GuildText:
						return "Textuels";
					case ChannelType.GuildVoice:
						return "Vocaux";
					case ChannelType.GuildCategory:
						return "Catégories";
					case ChannelType.GuildAnnouncement:
						return "Annonces";
					case ChannelType.GuildStageVoice:
						return "Stage";
					case ChannelType.GuildForum:
						return "Forums";
					case ChannelType.GuildMedia:
						return "Media";
					default:
						return `type-${t}`;
				}
			};
			for (const c of channels) {
				const label = typeLabel(c.type);
				if (!groups.has(label)) groups.set(label, []);
				groups.get(label)!.push(`\`${c.id}\` · ${c.name}`);
			}
			const parts: string[] = [];
			for (const [label, lines] of groups) {
				parts.push(`__${label}__\n${lines.join("\n")}`);
			}
			sections.push(`**Salons (${channels.length})**\n${parts.join("\n\n") || "—"}`);
		}

		// Discord limite à 2000 chars → chunke + followUp si besoin
		const full = sections.join("\n\n");
		const chunks = chunk(full, 1900);
		await interaction.reply({
			content: chunks[0]!,
			flags: MessageFlags.Ephemeral,
		});
		for (const c of chunks.slice(1)) {
			await interaction.followUp({ content: c, flags: MessageFlags.Ephemeral });
		}
	}
}

function chunk(text: string, maxLen: number): string[] {
	if (text.length <= maxLen) return [text];
	const out: string[] = [];
	let buf = "";
	for (const line of text.split("\n")) {
		if ((buf + line).length + 1 > maxLen) {
			out.push(buf);
			buf = line;
		} else {
			buf = buf ? `${buf}\n${line}` : line;
		}
	}
	if (buf) out.push(buf);
	return out;
}
