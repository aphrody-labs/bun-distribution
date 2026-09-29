import { resolveSiteUrl } from "@shenron/config/public-urls";
import {
	Bot,
	Discord,
	Guard,
	MetadataStorage,
	SelectMenuComponent,
	Slash,
	type DApplicationCommand,
} from "discordx";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	PermissionsBitField,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	type CommandInteraction,
	type StringSelectMenuInteraction,
} from "discord.js";
import { env } from "~/lib/env";
import { GuildOnly } from "~/guards/GuildOnly";
import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

const SITE_URL = resolveSiteUrl(Bun.env);

interface CategoryDef {
	key: string;
	title: string;
	icon: string;
	description: string;
	color: number;
	cmds: Set<string>;
	groups?: Set<string>;
	modOnly?: boolean;
}

const CATEGORIES: CategoryDef[] = [
	{
		key: "profil",
		title: "Profil & Puissance",
		icon: "⚡",
		description: "Progression martiale, cartes de combattant et classements de puissance",
		color: SHENRON_THEME.saiyanBlue,
		cmds: new Set(["profil", "top", "stats", "scan", "eprofil"]),
	},
	{
		key: "eco",
		title: "Économie & Boutique",
		icon: "💰",
		description: "Gestion des Zénis, boutique cosmétique, inventaire et unions par fusion",
		color: SHENRON_THEME.gold,
		cmds: new Set(["solde", "shop", "buy", "inventaire", "fusion", "defusion"]),
	},
	{
		key: "wiki",
		title: "Wiki & Savoir Canonique",
		icon: "📜",
		description: "Arbitre de canonicité, fiches de personnages, planètes et databooks",
		color: SHENRON_THEME.kiGreen,
		cmds: new Set(["canon", "wiki", "races", "planete", "databooks"]),
	},
	{
		key: "fun",
		title: "Mini-Jeux & Tournois",
		icon: "🎮",
		description: "Défis ludiques, duels martiaux, pendu et mini-jeux de détente",
		color: SHENRON_THEME.beerusPurple,
		cmds: new Set(["gay", "raciste", "translate", "pendu", "morpion", "bingo", "pfc"]),
	},
	{
		key: "tickets",
		title: "Assistance & Salons Vocaux",
		icon: "🎫",
		description: "Gestion des tickets de support et salons vocaux dynamiques",
		color: SHENRON_THEME.orange,
		cmds: new Set(["close", "ticket", "voc"]),
	},
	{
		key: "giveaway",
		title: "Événements & Récompenses",
		icon: "🎁",
		description: "Tirages au sort et cadeaux de la communauté",
		color: SHENRON_THEME.gold,
		cmds: new Set(["giveaway"]),
	},
	{
		key: "mod",
		title: "Discipline & Modération",
		icon: "🛡️",
		description: "Outils de maintien de l'ordre et sanctions divines",
		color: SHENRON_THEME.majinRed,
		cmds: new Set([
			"warn",
			"unwarn",
			"warns",
			"clearwarns",
			"mute",
			"unmute",
			"jail",
			"unjail",
			"ban",
			"unban",
			"kick",
			"clear",
			"role",
			"sstats",
			"slowmode",
			"lock",
			"unlock",
			"nick",
			"note",
		]),
		modOnly: true,
	},
	{
		key: "admin",
		title: "Administration & Système",
		icon: "⚙️",
		description: "Paramétrage du sanctuaire, configuration des gains et succès",
		color: 0x475569,
		cmds: new Set(["niveau", "zeni", "custom", "ticket-panel", "ids"]),
		groups: new Set(["config", "succes", "admin"]),
		modOnly: true,
	},
];

function getLabelOf(c: DApplicationCommand): string {
	if (c.group && c.subgroup) return `/${c.group} ${c.subgroup} ${c.name}`;
	if (c.group) return `/${c.group} ${c.name}`;
	return `/${c.name}`;
}

function getGuildCommands(guildId: string): DApplicationCommand[] {
	const all = MetadataStorage.instance.applicationCommandSlashesFlat;
	return all.filter((c) => {
		const guilds = c.guilds ?? [];
		if (guilds.length === 0) return true;
		return guilds.some((g) => (Array.isArray(g) ? g.includes(guildId) : g === guildId));
	});
}

function buildHomeEmbed(canSeeMod: boolean, totalCmds: number): EmbedBuilder {
	const visibleCats = CATEGORIES.filter((cat) => !cat.modOnly || canSeeMod);

	return new EmbedBuilder()
		.setColor(SHENRON_THEME.orange)
		.setAuthor({
			name: "CENTRE D'AIDE ET DE DOCTRINE SHENRON",
			iconURL: "https://dragonballfr.com/favicon.ico",
		})
		.setTitle("🐉 Le Sanctuaire des Commandes Shenron · 神龍")
		.setDescription(
			[
				"Bienvenue, guerrier ! Shenron met à ta disposition l'ensemble des pouvoirs et connaissances de l'univers Dragon Ball.",
				"",
				`${SHENRON_SEPARATORS.solid}`,
				"**Sélectionne une catégorie ci-dessous** pour explorer les incantations disponibles :",
				"",
				...visibleCats.map(
					(cat) => `> ${cat.icon} **${cat.title}**\n> └ *${cat.description}*`
				),
				"",
				`${SHENRON_SEPARATORS.solid}`,
				`⚡ **${totalCmds} commandes actives** déployées sur ce sanctuaire.`,
				`📖 Base de données officielle & doctrine : [dragonballfr.com](${SITE_URL})`,
			].join("\n")
		)
		.setFooter({
			text: "Shenron Bot · L'autorité suprême de Dragon Ball",
		});
}

function buildCategoryEmbed(
	cat: CategoryDef,
	commands: DApplicationCommand[]
): EmbedBuilder {
	const lines = commands
		.map((c) => `• **\`${getLabelOf(c)}\`** — ${c.description || "Aucune description."}`)
		.toSorted();

	const embed = new EmbedBuilder()
		.setColor(cat.color)
		.setAuthor({
			name: "CENTRE D'AIDE SHENRON",
			iconURL: "https://dragonballfr.com/favicon.ico",
		})
		.setTitle(`${cat.icon} ${cat.title}`)
		.setDescription(
			[
				`*${cat.description}*`,
				"",
				`${SHENRON_SEPARATORS.solid}`,
				"",
				...(lines.length > 0 ? lines : ["*Aucune commande répertoriée.*"]),
				"",
				`${SHENRON_SEPARATORS.solid}`,
			].join("\n").slice(0, 4096)
		)
		.setFooter({
			text: `${commands.length} commande(s) dans ce grimoire · Sélectionne une autre catégorie ci-dessous`,
		});

	return embed;
}

function buildNavComponents(canSeeMod: boolean, currentKey = "home") {
	const visibleCats = CATEGORIES.filter((cat) => !cat.modOnly || canSeeMod);

	const select = new StringSelectMenuBuilder()
		.setCustomId("help:category")
		.setPlaceholder("🔮 Choisir un domaine de techniques…")
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel("Accueil Shenron")
				.setValue("home")
				.setDescription("Vue d'ensemble et guide du sanctuaire")
				.setEmoji("🐉")
				.setDefault(currentKey === "home"),
			...visibleCats.map((cat) =>
				new StringSelectMenuOptionBuilder()
					.setLabel(cat.title)
					.setValue(cat.key)
					.setDescription(cat.description.slice(0, 100))
					.setEmoji(cat.icon)
					.setDefault(currentKey === cat.key)
			)
		);

	const rowSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

	const rowButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Site Officiel")
			.setEmoji("🌐")
			.setURL(SITE_URL),
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Wiki Canon")
			.setEmoji("📜")
			.setURL(`${SITE_URL}/wiki/canon`),
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel("Databooks")
			.setEmoji("📚")
			.setURL(`${SITE_URL}/wiki/databooks`)
	);

	return [rowSelect, rowButtons];
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
export class HelpCommand {
	@Slash({ name: "help", description: "Consulter le centre d'aide interactif de Shenron" })
	async help(interaction: CommandInteraction) {
		const guildId = env.GUILD_ID;
		const onGuild = getGuildCommands(guildId);

		const memberPerms = interaction.memberPermissions ?? new PermissionsBitField();
		const canSeeMod =
			memberPerms.has(PermissionsBitField.Flags.ModerateMembers) ||
			memberPerms.has(PermissionsBitField.Flags.Administrator);

		const homeEmbed = buildHomeEmbed(canSeeMod, onGuild.length);
		const components = buildNavComponents(canSeeMod, "home");

		await interaction.reply({
			embeds: [homeEmbed],
			components,
			flags: MessageFlags.Ephemeral,
		});
	}

	@SelectMenuComponent({ id: "help:category" })
	async onSelectCategory(interaction: StringSelectMenuInteraction) {
		const selectedKey = interaction.values[0];
		const guildId = env.GUILD_ID;
		const onGuild = getGuildCommands(guildId);

		const memberPerms = interaction.memberPermissions ?? new PermissionsBitField();
		const canSeeMod =
			memberPerms.has(PermissionsBitField.Flags.ModerateMembers) ||
			memberPerms.has(PermissionsBitField.Flags.Administrator);

		if (selectedKey === "home" || !selectedKey) {
			const homeEmbed = buildHomeEmbed(canSeeMod, onGuild.length);
			const components = buildNavComponents(canSeeMod, "home");
			await interaction.update({ embeds: [homeEmbed], components });
			return;
		}

		const cat = CATEGORIES.find((c) => c.key === selectedKey);
		if (!cat) {
			await interaction.update({ content: "Catégorie inconnue.", embeds: [], components: [] });
			return;
		}

		// Filtre les commandes appartenant à cette catégorie
		const matchedCmds = onGuild.filter((c) => {
			if (cat.groups && c.group && cat.groups.has(c.group)) return true;
			return cat.cmds.has(c.name);
		});

		const embed = buildCategoryEmbed(cat, matchedCmds);
		const components = buildNavComponents(canSeeMod, cat.key);

		await interaction.update({ embeds: [embed], components });
	}
}

