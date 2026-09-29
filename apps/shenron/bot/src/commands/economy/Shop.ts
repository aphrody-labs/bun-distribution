import { resolveApiUrl, resolveSiteUrl } from "@shenron/config/public-urls";
import { injectable, inject } from "tsyringe";
import {
	Bot,
	ButtonComponent,
	Discord,
	Guard,
	SelectMenuComponent,
	Slash,
	SlashChoice,
	SlashOption,
} from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	type ButtonInteraction,
	type CommandInteraction,
	type Role,
	type StringSelectMenuInteraction,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { AdminOnly } from "~/guards/AdminOnly";
import { EconomyService } from "~/services/EconomyService";
import { formatXP } from "~/lib/xp";

import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

const TYPE_LABELS = {
	card: { label: "Cartes", icon: "🖼️" },
	badge: { label: "Badges", icon: "🎖️" },
	color: { label: "Couleurs", icon: "🎨" },
	title: { label: "Titres", icon: "📜" },
	banner: { label: "Bannières", icon: "🌌" },
} as const;

type ShopType = keyof typeof TYPE_LABELS;

const SITE = resolveSiteUrl(Bun.env);

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@injectable()
export class ShopPanelCommands {
	constructor(@inject(EconomyService) private eco: EconomyService) {}

	// ─────────────────────────────────────────────────────────────────
	// /shop-panel — pose le message persistant (admin)
	// ─────────────────────────────────────────────────────────────────
	@Slash({
		name: "shop-panel",
		description: "Publier le panel shop persistant du sanctuaire",
		defaultMemberPermissions: PermissionFlagsBits.Administrator,
	})
	@Guard(AdminOnly)
	async publishPanel(interaction: CommandInteraction) {
		const embed = new EmbedBuilder()
			.setAuthor({
				name: "SANCTUAIRE DRAGON BALL · BAZAR MYSTIQUE",
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTitle("🏪 La Grande Boutique de Shenron · 神龍の市")
			.setColor(SHENRON_THEME.gold)
			.setDescription(
				[
					"Bienvenue dans la boutique sacrée de Shenron. Dépense tes zénis pour acquérir des raretés et te démarquer parmi les guerriers du sanctuaire.",
					"",
					`${SHENRON_SEPARATORS.solid}`,
					"Clique sur **Ouvrir la boutique** pour parcourir les rayons disponibles.",
					"*Tes interactions d'achat sont totalement privées.*",
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.addFields(
				{ name: "🖼️ Cartes de Profil", value: "Arrière-plans et illustrations de profil", inline: true },
				{ name: "🎖️ Badges Honorifiques", value: "Pastilles distinctives auprès de ton nom", inline: true },
				{ name: "🎨 Auras & Couleurs", value: "Rôles cosmétiques et auras divines", inline: true },
				{ name: "📜 Titres de Guerrier", value: "Phrases de légende gravées dans ta carte", inline: true }
			)
			.setFooter({
				text: "Boutique Officielle Shenron · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Ouvrir la boutique")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Mon inventaire")
				.setEmoji("🎒")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setLabel("Catalogue Web")
				.setEmoji("🌐")
				.setURL(`${SITE}/wiki`)
		);

		await interaction.reply({ embeds: [embed], components: [row] });
	}

	// ─────────────────────────────────────────────────────────────────
	// Bouton "Ouvrir la boutique" → réponse éphémère avec select category
	// ─────────────────────────────────────────────────────────────────
	@ButtonComponent({ id: "shop:open" })
	async openShop(interaction: ButtonInteraction) {
		const select = new StringSelectMenuBuilder()
			.setCustomId("shop:category")
			.setPlaceholder("🔮 Choisis un rayon de la boutique…")
			.addOptions(
				...Object.entries(TYPE_LABELS).map(([value, { label, icon }]) => ({
					label: `Rayon ${label}`,
					value,
					description: `Parcourir tous les objets du rayon ${label.toLowerCase()}`,
					emoji: icon,
				}))
			);
		await interaction.reply({
			content: "Quel type d'objets souhaites-tu consulter ?",
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
			flags: MessageFlags.Ephemeral,
		});
	}

	// ─────────────────────────────────────────────────────────────────
	// Bouton "Mon inventaire" — fast-path /eprofil
	// ─────────────────────────────────────────────────────────────────
	@ButtonComponent({ id: "shop:eprofil" })
	async openProfile(interaction: ButtonInteraction) {
		const inv = await this.eco.listInventory(interaction.user.id);
		if (inv.length === 0) {
			const emptyEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setTitle("🎒 Inventaire Vide")
				.setDescription("Ton sac d'aventurier est vide pour l'instant.\nGagne des zénis en discutant et visite la boutique pour t'équiper !")
				.setFooter({ text: "Économie Shenron" });

			await interaction.reply({
				embeds: [emptyEmb],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const grouped: Record<ShopType, string[]> = {
			card: [],
			badge: [],
			color: [],
			title: [],
			banner: [],
		};
		for (const item of inv) grouped[item.itemType as ShopType].push(item.itemKey);
		const embed = new EmbedBuilder()
			.setAuthor({
				name: `Sac d'Aventurier · ${interaction.user.displayName ?? interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL({ size: 128 }),
			})
			.setTitle("🎒 Ton Inventaire d'Objets")
			.setColor(SHENRON_THEME.gold)
			.setDescription(
				[
					`Voici l'ensemble de tes possessions cosmétiques acquises au sanctuaire.`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.addFields(
				...Object.entries(grouped)
					.map(([type, keys]) => ({
						name: `${TYPE_LABELS[type as ShopType].icon} ${TYPE_LABELS[type as ShopType].label} (${keys.length})`,
						value: keys.length ? keys.map((k) => `\`${k}\``).join(", ") : "*Aucun*",
						inline: false,
					}))
			)
			.setFooter({
				text: "Utilise /inventaire equip ou /eprofil pour équiper un objet",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Visiter la boutique")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Primary)
		);

		await interaction.reply({
			embeds: [embed],
			components: [row],
			flags: MessageFlags.Ephemeral,
		});
	}

	// ─────────────────────────────────────────────────────────────────
	// Select menu → liste les items de la catégorie choisie
	// ─────────────────────────────────────────────────────────────────
	@SelectMenuComponent({ id: "shop:category" })
	async pickCategory(interaction: StringSelectMenuInteraction) {
		const type = interaction.values[0] as ShopType;
		const items = await this.eco.listShop(type);
		if (items.length === 0) {
			await interaction.update({
				content: `Aucun objet ${TYPE_LABELS[type].label.toLowerCase()} disponible pour le moment.`,
				components: [],
				embeds: [],
			});
			return;
		}

		const ownedSet = new Set(
			(await this.eco.listInventory(interaction.user.id))
				.filter((i) => i.itemType === type)
				.map((i) => i.itemKey)
		);

		let embedColor: number = SHENRON_THEME.gold;
		if ((type === "color" || type === "title" || type === "badge") && interaction.inCachedGuild()) {
			const withRole = items.filter((i) => i.roleId).toSorted((a, b) => b.price - a.price);
			for (const it of withRole) {
				const role = interaction.guild?.roles.cache.get(it.roleId!);
				if (role && role.color !== 0) {
					embedColor = role.color;
					break;
				}
			}
		}

		const embed = new EmbedBuilder()
			.setAuthor({
				name: `Rayon ${TYPE_LABELS[type].label} · Boutique Shenron`,
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTitle(`${TYPE_LABELS[type].icon} Objets Disponibles : ${TYPE_LABELS[type].label}`)
			.setColor(embedColor)
			.setDescription(
				[
					`*Clique sur un bouton ci-dessous pour acquérir l'objet de ton choix.*`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					...items.slice(0, 25).map((i) => {
						const owned = ownedSet.has(i.key) ? " ✅ *(Déjà possédé)*" : ` — **${formatXP(i.price)}** 𝓩`;
						const role = i.roleId ? ` · <@&${i.roleId}>` : "";
						return `• **${i.name}** (\`${i.key}\`)${role}${owned}\n> *${i.description ?? "Aucune description"}*`;
					}),
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			);

		if (type === "card" && items[0]) {
			const base = resolveApiUrl(Bun.env);
			embed.setImage(`${base}/assets/cards/${encodeURIComponent(items[0].key)}.png`);
		}

		// Boutons d'achat (5 max par row, 5 rows max)
		const rows: ActionRowBuilder<ButtonBuilder>[] = [];
		const buyable = items.slice(0, 25).filter((i) => !ownedSet.has(i.key));
		for (let i = 0; i < buyable.length; i += 5) {
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				...buyable.slice(i, i + 5).map((item) =>
					new ButtonBuilder()
						.setCustomId(`shop:buy:${item.key}`)
						.setLabel(`${item.name} · ${formatXP(item.price)}z`.slice(0, 80))
						.setStyle(ButtonStyle.Success)
				)
			);
			rows.push(row);
		}
		// Row "Retour & Inventaire"
		const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Autre catégorie")
				.setEmoji("←")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Mon Inventaire")
				.setEmoji("🎒")
				.setStyle(ButtonStyle.Secondary)
		);
		await interaction.update({
			content: "",
			embeds: [embed],
			components: [...rows.slice(0, 3), backRow],
		});
	}

	// ─────────────────────────────────────────────────────────────────
	// Bouton "Acheter <key>" — purchase + grant role si lié
	// ─────────────────────────────────────────────────────────────────
	@ButtonComponent({ id: /^shop:buy:.+$/ })
	async buyButton(interaction: ButtonInteraction) {
		const key = interaction.customId.slice("shop:buy:".length);
		const res = await this.eco.purchase(interaction.user.id, key);
		if (!res.ok) {
			await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
			return;
		}

		const successEmb = new EmbedBuilder()
			.setColor(SHENRON_THEME.kiGreen)
			.setTitle(`✅ Achat Réussi : \`${key}\``)
			.setDescription(
				[
					`Félicitations pour ton acquisition ! L'objet a été débité de ton compte pour **${res.price}** 𝓩.`,
					"",
					`Stocké dans ton inventaire — utilise \`/inventaire equip\` ou le bouton ci-dessous pour l'équiper immédiatement.`,
				].join("\n")
			)
			.setFooter({ text: "Boutique Shenron · dragonballfr.com" });

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Équiper maintenant")
				.setEmoji("✏️")
				.setStyle(ButtonStyle.Primary)
		);

		await interaction.reply({
			embeds: [successEmb],
			components: [row],
			flags: MessageFlags.Ephemeral,
		});
	}


	// ─────────────────────────────────────────────────────────────────
	// /shop-item — admin : add / set-role / toggle
	// ─────────────────────────────────────────────────────────────────
	@Slash({
		name: "shop-item",
		description: "Admin: ajouter/modifier un objet du shop",
		defaultMemberPermissions: PermissionFlagsBits.Administrator,
	})
	@Guard(AdminOnly)
	async shopItem(
		@SlashChoice({ name: "add", value: "add" })
		@SlashChoice({ name: "set-role", value: "set-role" })
		@SlashChoice({ name: "toggle", value: "toggle" })
		@SlashOption({
			name: "action",
			description: "add | set-role | toggle",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "add" | "set-role" | "toggle",
		@SlashOption({
			name: "cle",
			description: "Clé unique (ex: titre_legendaire)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		key: string,
		@SlashChoice({ name: "card", value: "card" })
		@SlashChoice({ name: "badge", value: "badge" })
		@SlashChoice({ name: "color", value: "color" })
		@SlashChoice({ name: "title", value: "title" })
		@SlashOption({
			name: "type",
			description: "Type (requis pour add)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		type: ShopType | undefined,
		@SlashOption({
			name: "nom",
			description: "Nom affiché (requis pour add)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		name: string | undefined,
		@SlashOption({
			name: "prix",
			description: "Prix en zéni (requis pour add)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		price: number | undefined,
		@SlashOption({
			name: "role",
			description: "Rôle attribué à l'achat (set-role / add)",
			type: ApplicationCommandOptionType.Role,
			required: false,
		})
		role: Role | undefined,
		@SlashOption({
			name: "description",
			description: "Description courte",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		description: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (action === "add") {
			if (!type || !name || price == null) {
				await interaction.editReply("❌ `type`, `nom` et `prix` sont requis pour `add`.");
				return;
			}
			await this.eco.upsertShopItem({
				key,
				type,
				name,
				price,
				roleId: role?.id ?? null,
				description: description ?? null,
				enabled: true,
			});
			await interaction.editReply(
				`✅ Item **${key}** (${type}, ${price}z) créé/mis à jour${role ? ` avec rôle <@&${role.id}>` : ""}.`
			);
			return;
		}
		if (action === "set-role") {
			const ok = await this.eco.setShopItemRole(key, role?.id ?? null);
			await interaction.editReply(
				ok
					? `✅ Rôle ${role ? `<@&${role.id}>` : "*(retiré)*"} associé à **${key}**.`
					: `❌ Item **${key}** introuvable.`
			);
			return;
		}
		// toggle
		const item = await this.eco.getShopItem(key);
		if (!item) {
			await interaction.editReply(`❌ Item **${key}** introuvable.`);
			return;
		}
		await this.eco.upsertShopItem({
			key: item.key,
			type: item.type,
			name: item.name,
			description: item.description,
			price: item.price,
			roleId: item.roleId,
			enabled: !item.enabled,
		});
		await interaction.editReply(`✅ Item **${key}** ${!item.enabled ? "activé" : "désactivé"}.`);
	}
}
