import { resolveSiteUrl } from "@shenron/config/public-urls";
import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type APIEmbed,
	type CommandInteraction,
	type AutocompleteInteraction,
} from "discord.js";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { Pagination } from "@discordx/pagination";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { FeatureEnabled } from "~/guards/FeatureEnabled";
import {
	WikiService,
	type CharacterWithRelations,
	type DBTransformation,
} from "~/services/WikiService";
import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

const SITE = resolveSiteUrl(Bun.env);

const RACE_COLORS: Record<string, number> = {
	Saiyan: SHENRON_THEME.orange,
	Namekian: SHENRON_THEME.kiGreen,
	Human: SHENRON_THEME.saiyanBlue,
	Android: 0x94a3b8,
	"Frieza Race": 0xa855f7,
	"Jiren Race": SHENRON_THEME.majinRed,
	God: SHENRON_THEME.gold,
	Majin: 0xec4899,
	Angel: 0xe2e8f0,
	Evil: 0x991b1b,
	"Nucleico benigno": 0x14b8a6,
	Nucleico: 0x6366f1,
	Unknown: 0x64748b,
};

function wikiButtons(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Explorer le Wiki")
			.setEmoji("🌐")
			.setURL(`${SITE}/wiki`),
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Arbitre de Canonicité")
			.setEmoji("📜")
			.setURL(`${SITE}/wiki/canon`),
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Guides & Databooks")
			.setEmoji("📚")
			.setURL(`${SITE}/wiki/databooks`)
	);
}

/**
 * Si `image` est un path local, retourne un Attachment + URL attachment://
 * Sinon retourne juste l'URL (HTTP).
 */
function asEmbedImage(imagePath: string): { url: string; attachment: AttachmentBuilder | null } {
	if (imagePath.startsWith("http")) return { url: imagePath, attachment: null };
	if (!existsSync(imagePath)) return { url: imagePath, attachment: null };
	const filename = basename(imagePath).replace(/[^a-zA-Z0-9._-]/g, "_");
	const att = new AttachmentBuilder(imagePath, { name: filename });
	return { url: `attachment://${filename}`, attachment: att };
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly, FeatureEnabled("features.wiki", "Le wiki"))
@injectable()
export class WikiCommands {
	constructor(@inject(WikiService) private api: WikiService) {}

	private charEmbed(c: CharacterWithRelations): {
		embed: EmbedBuilder;
		attachment: AttachmentBuilder | null;
	} {
		const color = RACE_COLORS[c.race ?? ""] ?? SHENRON_THEME.gold;
		const img = asEmbedImage(c.portraitXv2 ?? c.image);
		const embed = new EmbedBuilder()
			.setAuthor({
				name: "ARCHIVES UNIVERSELLES DRAGON BALL · 戦士名鑑",
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTitle(`⚡ ${c.name}`)
			.setURL(`${SITE}/wiki`)
			.setColor(color)
			.setThumbnail(img.url)
			.setDescription(
				[
					c.description?.trim() ? `> *${c.description.trim().slice(0, 800)}*` : "",
					"",
					`${SHENRON_SEPARATORS.solid}`,
				]
					.filter(Boolean)
					.join("\n")
			)
			.addFields(
				{
					name: "🧬 Race & Origine",
					value: `**${c.race || "—"}**\n*Planète : ${c.originPlanet?.name ?? "Inconnue"}*`,
					inline: true,
				},
				{
					name: "⚔️ Affiliation",
					value: `**${c.affiliation || "Neutre / Inconnue"}**`,
					inline: true,
				},
				{
					name: "⚧ Genre",
					value: `**${c.gender || "—"}**`,
					inline: true,
				},
				{
					name: "⚡ Ki Initial",
					value: `\`${c.ki || "Non mesuré"}\``,
					inline: true,
				},
				{
					name: "💥 Ki Maximal",
					value: `\`${c.maxKi || "Incalculable"}\``,
					inline: true,
				},
				{
					name: "🌐 Registre",
					value: `ID #**${c.id}**`,
					inline: true,
				}
			)
			.setFooter({
				text: "Fiche Universelle Dragon Ball · dragonballfr.com/wiki",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		if (c.transformations.length) {
			embed.addFields({
				name: `🌀 Transformations & Éveils (${c.transformations.length})`,
				value: c.transformations
					.map((t) => `• **${t.name}** — Ki : \`${t.ki || "—"}\``)
					.join("\n")
					.slice(0, 1024),
				inline: false,
			});
		}
		return { embed, attachment: img.attachment };
	}

	private transformationEmbed(
		c: CharacterWithRelations,
		t: DBTransformation,
		idx: number
	): { embed: EmbedBuilder; attachment: AttachmentBuilder | null } {
		const color = RACE_COLORS[c.race ?? ""] ?? SHENRON_THEME.gold;
		const charImg = asEmbedImage(c.portraitXv2 ?? c.image);
		const transfoImg = asEmbedImage(t.image);
		const embed = new EmbedBuilder()
			.setAuthor({
				name: `Forme Martiale · ${c.name}`,
				iconURL: charImg.url.startsWith("attachment://") ? undefined : charImg.url,
			})
			.setTitle(`🌀 ${t.name}`)
			.setImage(transfoImg.url)
			.setColor(color)
			.setDescription(
				[
					`${SHENRON_SEPARATORS.solid}`,
					`> **Puissance déployée (Ki) :** \`${t.ki || "Incalculable"}\``,
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.setFooter({
				text: `Éveil martial ${idx + 1}/${c.transformations.length} · ${c.name} · dragonballfr.com`,
				iconURL: "https://dragonballfr.com/favicon.ico",
			});
		return { embed, attachment: transfoImg.attachment };
	}

	@Slash({ name: "wiki", description: "Consulter le wiki Dragon Ball (personnages et transformations)" })
	async wiki(
		@SlashOption({
			name: "personnage",
			description: "Nom du personnage (autocomplete)",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: true,
		})
		query: string,
		interaction: CommandInteraction | AutocompleteInteraction
	) {
		if (interaction.isAutocomplete()) {
			const focus = interaction.options.getFocused();
			const matches = await this.api.search(focus, 25);
			await interaction.respond(
				matches.map((c) => ({ name: `${c.name} (${c.race ?? "?"})`, value: String(c.id) }))
			);
			return;
		}

		await (interaction as CommandInteraction).deferReply();

		let char: CharacterWithRelations | null = null;
		const maybeId = parseInt(query, 10);
		if (!isNaN(maybeId)) char = await this.api.getCharacter(maybeId);
		if (!char) {
			const matches = await this.api.search(query, 1);
			if (matches.length > 0) char = await this.api.getCharacter(matches[0]!.id);
		}
		if (!char) {
			await (interaction as CommandInteraction).editReply({
				content: `❌ Personnage "${query}" introuvable. Lance \`/wiki\` avec l'autocomplete.`,
			});
			return;
		}

		// Pages: [fiche, ...transfo embeds]
		const pages: Array<{ embeds: APIEmbed[]; files?: AttachmentBuilder[] }> = [];
		const main = this.charEmbed(char);
		pages.push({ embeds: [main.embed.toJSON()], files: main.attachment ? [main.attachment] : [] });
		char.transformations.forEach((t, i) => {
			const e = this.transformationEmbed(char!, t, i);
			pages.push({ embeds: [e.embed.toJSON()], files: e.attachment ? [e.attachment] : [] });
		});

		const buttons = wikiButtons();

		if (pages.length === 1) {
			await (interaction as CommandInteraction).editReply({
				...pages[0]!,
				components: [buttons],
			});
			return;
		}
		const pagination = new Pagination(interaction as CommandInteraction, pages, {
			time: 120_000,
			buttons: {
				previous: { label: "Précédent" },
				next: { label: "Suivant" },
				exit: { label: "Fermer" },
			},
		});
		await pagination.send();
	}

	@Slash({ name: "races", description: "Liste les personnages par race" })
	async races(
		@SlashOption({
			name: "race",
			description: "Race (ex: Saiyan, Namekian)",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: true,
		})
		race: string,
		interaction: CommandInteraction | AutocompleteInteraction
	) {
		if (interaction.isAutocomplete()) {
			const races = await this.api.listRaces();
			const focus = interaction.options.getFocused().toLowerCase();
			await interaction.respond(
				races
					.filter((r) => r.name.toLowerCase().includes(focus))
					.slice(0, 25)
					.map((r) => ({ name: r.name, value: r.name }))
			);
			return;
		}

		await (interaction as CommandInteraction).deferReply({ flags: MessageFlags.Ephemeral });
		const filtered = await this.api.listByRace(race);
		if (filtered.length === 0) {
			await (interaction as CommandInteraction).editReply({
				content: `Aucun personnage trouvé pour la race « ${race} ».`,
			});
			return;
		}
		const embed = new EmbedBuilder()
			.setAuthor({
				name: "REGISTRE DES ESPÈCES · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTitle(`🧬 Race : ${race} (${filtered.length} combattants)`)
			.setColor(RACE_COLORS[race] ?? SHENRON_THEME.gold)
			.setDescription(
				[
					`*Liste des personnages répertoriés appartenant au peuple ${race}.*`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					...filtered.map((c) => `• **${c.name}** — Ki : \`${c.ki ?? "Non mesuré"}\``),
					`${SHENRON_SEPARATORS.solid}`,
				]
					.join("\n")
					.slice(0, 4000)
			)
			.setFooter({
				text: "Archives Universelles · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});
		await (interaction as CommandInteraction).editReply({
			embeds: [embed],
			components: [wikiButtons()],
		});
	}

	@Slash({ name: "planete", description: "Fiche d'une planète de l'univers Dragon Ball" })
	async planete(
		@SlashOption({
			name: "planete",
			description: "Nom de la planète",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: true,
		})
		query: string,
		interaction: CommandInteraction | AutocompleteInteraction
	) {
		if (interaction.isAutocomplete()) {
			const focus = interaction.options.getFocused().toLowerCase();
			const all = await this.api.listPlanets();
			await interaction.respond(
				all
					.filter((p) => p.name.toLowerCase().includes(focus))
					.slice(0, 25)
					.map((p) => ({ name: p.name, value: String(p.id) }))
			);
			return;
		}
		await (interaction as CommandInteraction).deferReply();
		const id = parseInt(query, 10);
		const planet = await this.api.getPlanet(isNaN(id) ? 0 : id);
		if (!planet) {
			await (interaction as CommandInteraction).editReply({ content: `Planète introuvable dans nos cartographies.` });
			return;
		}
		const img = asEmbedImage(planet.image);
		const embed = new EmbedBuilder()
			.setAuthor({
				name: "CARTOGRAPHIE GALACTIQUE · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTitle(`🌍 ${planet.name}`)
			.setColor(planet.isDestroyed ? SHENRON_THEME.majinRed : SHENRON_THEME.kiGreen)
			.setImage(img.url)
			.setDescription(
				[
					`**État cosmique :** ${planet.isDestroyed ? "💥 **Détruite / Disparue**" : "🪐 **Intacte / Existante**"}`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					planet.description?.trim() ? `> *${planet.description.trim().slice(0, 1200)}*` : "*Aucune donnée astronomique.*",
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.setFooter({
				text: `Cartographie de l'Univers · dragonballfr.com`,
				iconURL: "https://dragonballfr.com/favicon.ico",
			});
		await (interaction as CommandInteraction).editReply({
			embeds: [embed],
			files: img.attachment ? [img.attachment] : [],
			components: [wikiButtons()],
		});
	}
}
