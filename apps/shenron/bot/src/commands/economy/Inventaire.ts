import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type CommandInteraction,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { EconomyService } from "~/services/EconomyService";
import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

type ItemType = "card" | "badge" | "color" | "title" | "banner";

const TYPE_FIELD = {
	card: "equippedCard",
	badge: "equippedBadge",
	color: "equippedColor",
	title: "equippedTitle",
	banner: "equippedBanner",
} as const;

const TYPE_LABELS: Record<ItemType, string> = {
	card: "🖼️ Carte de Fond",
	banner: "🌌 Bannière de Profil",
	badge: "🎖️ Badge Honorifique",
	color: "🎨 Couleur & Aura",
	title: "📜 Titre de Guerrier",
};

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@SlashGroup({ name: "inventaire", description: "Gérer ton inventaire (carte/bannière/badge/couleur/titre)" })
@SlashGroup("inventaire")
@injectable()
export class InventaireCommands {
	constructor(@inject(EconomyService) private eco: EconomyService) {}

	@Slash({ name: "list", description: "Voir le contenu complet de ton inventaire" })
	async list(interaction: CommandInteraction) {
		const inv = await this.eco.listInventory(interaction.user.id);
		const user = await this.eco.getUser(interaction.user.id);

		if (inv.length === 0) {
			const emptyEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setTitle("🎒 Inventaire Vide")
				.setDescription("Ton sac d'aventurier est vide pour le moment.\nUtilise `/shop` pour explorer la boutique et débloquer tes premières parures !")
				.setFooter({ text: "Sanctuaire Shenron" });

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("shop:open")
					.setLabel("Ouvrir la Boutique")
					.setEmoji("🏪")
					.setStyle(ButtonStyle.Primary)
			);

			await interaction.reply({
				embeds: [emptyEmb],
				components: [row],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const grouped: Record<ItemType, string[]> = { card: [], banner: [], badge: [], color: [], title: [] };
		for (const it of inv) {
			if (grouped[it.itemType as ItemType]) {
				grouped[it.itemType as ItemType].push(it.itemKey);
			}
		}

		const fmt = (arr: string[], equippedKey: string | null | undefined) => {
			if (!arr.length) return "*Aucun objet dans cette catégorie*";
			return arr
				.map((k) => (k === equippedKey ? `**\`${k}\`** ⭐ *(Équipé)*` : `\`${k}\``))
				.join(", ");
		};

		const embed = new EmbedBuilder()
			.setAuthor({
				name: `Sacoche d'Aventurier · ${interaction.user.displayName ?? interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL({ size: 128 }),
			})
			.setTitle("🎒 Inventaire Personnel & Garde-Robe")
			.setColor(SHENRON_THEME.gold)
			.setDescription(
				[
					`Voici tous les objets cosmétiques et distinctions rattachés à ton compte.`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.addFields(
				{ name: "🖼️ Cartes de Fond", value: fmt(grouped.card, user?.equippedCard) },
				{ name: "🌌 Bannières de Profil", value: fmt(grouped.banner, user?.equippedBanner) },
				{ name: "🎖️ Badges Honorifiques", value: fmt(grouped.badge, user?.equippedBadge) },
				{ name: "🎨 Couleurs & Auras", value: fmt(grouped.color, user?.equippedColor) },
				{ name: "📜 Titres de Guerrier", value: fmt(grouped.title, user?.equippedTitle) }
			)
			.setFooter({
				text: "Utilise /inventaire equip ou /eprofil pour changer d'équipement",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Modifier mon profil")
				.setEmoji("✏️")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Boutique")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Secondary)
		);

		await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
	}

	@Slash({ name: "equip", description: "Équiper un objet de ton inventaire" })
	async equip(
		@SlashChoice({ name: "carte", value: "card" })
		@SlashChoice({ name: "bannière", value: "banner" })
		@SlashChoice({ name: "badge", value: "badge" })
		@SlashChoice({ name: "couleur", value: "color" })
		@SlashChoice({ name: "titre", value: "title" })
		@SlashOption({
			name: "type",
			description: "Type d'objet à équiper",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		type: ItemType,
		@SlashOption({
			name: "cle",
			description: "Clé de l'objet (ex: saiyan_blue)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		key: string,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const ok = await this.eco.equip(interaction.user.id, type, key);
		if (!ok) {
			const errEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.majinRed)
				.setTitle("❌ Objet Non Possédé")
				.setDescription(`Tu ne possèdes pas l'objet \`${key}\` dans ton inventaire.\nVisite \`/shop\` pour te le procurer.`)
				.setFooter({ text: "Inventaire Shenron" });

			await interaction.reply({
				embeds: [errEmb],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Attribution du rôle Discord si l'item shop est lié à un rôle
		if (type === "color" || type === "title" || type === "badge") {
			const item = await this.eco.getShopItem(key);
			if (item?.roleId) {
				try {
					await interaction.member.roles.add(item.roleId, `inventaire equip ${type}:${key}`);
				} catch {
					// hierarchy ou perms
				}
			}
		}

		const successEmb = new EmbedBuilder()
			.setColor(SHENRON_THEME.kiGreen)
			.setTitle("✨ Équipement Installé")
			.setDescription(
				[
					`L'élément **${TYPE_LABELS[type]}** \`${key}\` est désormais actif sur ton profil !`,
					"",
					`Visualise le rendu final avec la commande \`/profil\`.`,
				].join("\n")
			)
			.setFooter({
				text: "Profil Shenron · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		await interaction.reply({
			embeds: [successEmb],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "dequip", description: "Retirer l'objet équipé d'un type" })
	async dequip(
		@SlashChoice({ name: "carte", value: "card" })
		@SlashChoice({ name: "bannière", value: "banner" })
		@SlashChoice({ name: "badge", value: "badge" })
		@SlashChoice({ name: "couleur", value: "color" })
		@SlashChoice({ name: "titre", value: "title" })
		@SlashOption({
			name: "type",
			description: "Type à déséquiper",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		type: ItemType,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const dbs = this.eco;
		const u = await dbs.getUser(interaction.user.id);
		const currentKey = u?.[TYPE_FIELD[type]] as string | null | undefined;
		if (currentKey) {
			const item = await this.eco.getShopItem(currentKey);
			if (item?.roleId) {
				await interaction.member.roles
					.remove(item.roleId, `inventaire dequip ${type}`)
					.catch(() => {});
			}
		}
		await this.eco.setEquipped(interaction.user.id, type, null);

		const dequipEmb = new EmbedBuilder()
			.setColor(SHENRON_THEME.orange)
			.setTitle("🔄 Emplacement Libéré")
			.setDescription(`L'élément **${TYPE_LABELS[type]}** a été retiré de ton équipement actif.`)
			.setFooter({ text: "Profil Shenron" });

		await interaction.reply({
			embeds: [dequipEmb],
			flags: MessageFlags.Ephemeral,
		});
	}
}

