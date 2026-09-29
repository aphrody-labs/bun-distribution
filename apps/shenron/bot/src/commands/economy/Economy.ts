import { injectable, inject } from "tsyringe";
import {
	Bot,
	ButtonComponent,
	Discord,
	Guard,
	ModalComponent,
	Slash,
	SlashChoice,
	SlashOption,
} from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	PermissionFlagsBits,
	type ButtonInteraction,
	type CommandInteraction,
	type ModalSubmitInteraction,
	type Role,
	type User,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { AdminOnly } from "~/guards/AdminOnly";
import { FeatureEnabled } from "~/guards/FeatureEnabled";
import { EconomyService } from "~/services/EconomyService";
import { FusionService } from "~/services/FusionService";
import { FusionRoleService } from "~/services/FusionRoleService";
import { formatXP } from "~/lib/xp";
import { fusionName } from "~/lib/fusion-names";
import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class EconomyCommands {
	constructor(
		@inject(EconomyService) private eco: EconomyService,
		@inject(FusionService) private fusionCanvas: FusionService,
		@inject(FusionRoleService) private fusionRoles: FusionRoleService
	) {}

	// /shop
	@Slash({ name: "shop", description: "Voir et acheter des objets du sanctuaire" })
	async shop(interaction: CommandInteraction) {
		const items = await this.eco.listShop();
		if (items.length === 0) {
			await interaction.reply({
				content: "La boutique du sanctuaire est vide pour le moment.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const grouped = {
			card: items.filter((i) => i.type === "card"),
			badge: items.filter((i) => i.type === "badge"),
			color: items.filter((i) => i.type === "color"),
			title: items.filter((i) => i.type === "title"),
		};

		const mkPage = (label: string, icon: string, list: typeof items) => ({
			embeds: [
				new EmbedBuilder()
					.setAuthor({
						name: "BOUTIQUE DU SANCTUAIRE · CATALOGUE",
						iconURL: "https://dragonballfr.com/favicon.ico",
					})
					.setTitle(`${icon} ${label}`)
					.setColor(SHENRON_THEME.gold)
					.setDescription(
						[
							`*Personnalise ton apparence et ton statut auprès de Shenron.*`,
							"",
							`${SHENRON_SEPARATORS.solid}`,
							list.length
								? list
										.map(
											(i) =>
												`• **${i.name}** (\`${i.key}\`) — **${formatXP(i.price)}** 𝓩\n> *${i.description ?? "Aucune description."}*`
										)
										.join("\n\n")
								: "*Rien en vente dans ce rayon pour l'instant.*",
							`${SHENRON_SEPARATORS.solid}`,
						].join("\n")
					)
					.setFooter({
						text: "Utilise /buy <clé> ou le panel interactif pour acheter · dragonballfr.com",
						iconURL: "https://dragonballfr.com/favicon.ico",
					})
					.toJSON(),
			],
		});

		const pages = [
			mkPage("Cartes de Profil", "🖼️", grouped.card),
			mkPage("Badges Honorifiques", "🎖️", grouped.badge),
			mkPage("Auras & Couleurs", "🎨", grouped.color),
			mkPage("Titres de Guerrier", "📜", grouped.title),
		];
		const pagination = new Pagination(interaction, pages, {
			time: 120_000,
			buttons: {
				previous: { label: "Précédent" },
				next: { label: "Suivant" },
				exit: { label: "Fermer" },
			},
		});
		await pagination.send();
	}

	// /buy
	@Slash({ name: "buy", description: "Acheter un objet de la boutique" })
	async buy(
		@SlashOption({
			name: "cle",
			description: "Clé de l'objet (ex: saiyan_blue, aura_or)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		key: string,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const res = await this.eco.purchase(interaction.user.id, key);
		if (!res.ok) {
			const errorEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.majinRed)
				.setTitle("❌ Échec de la transaction")
				.setDescription(res.reason ?? "Transaction impossible.")
				.setFooter({ text: "Économie Shenron" });
			await interaction.reply({ embeds: [errorEmb], flags: MessageFlags.Ephemeral });
			return;
		}

		const successEmb = new EmbedBuilder()
			.setColor(SHENRON_THEME.kiGreen)
			.setAuthor({
				name: "ACQUISITION RÉUSSIE · BOUTIQUE SHENRON",
				iconURL: interaction.user.displayAvatarURL({ size: 128 }),
			})
			.setTitle(`✅ Objet acquis : \`${key}\``)
			.setDescription(
				[
					`L'objet a été ajouté à ton inventaire avec succès.`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					`> **Montant déduit :** **${formatXP(res.price ?? 0)}** 𝓩`,
					`${SHENRON_SEPARATORS.solid}`,
					`Pour l'équiper, utilise \`/inventaire equip\` ou le bouton ci-dessous.`,
				].join("\n")
			)
			.setFooter({
				text: "Boutique du Sanctuaire · dragonballfr.com",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Équiper dans mon Profil")
				.setEmoji("✏️")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Continuer mes achats")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Secondary)
		);

		await interaction.reply({ embeds: [successEmb], components: [row] });
	}


	// /eprofil
	@Slash({ name: "eprofil", description: "Éditer votre profil (carte/bannière/badge/couleur/titre)" })
	async eprofil(interaction: CommandInteraction) {
		const inv = await this.eco.listInventory(interaction.user.id);
		const user = await this.eco.getUser(interaction.user.id);

		const group = {
			card: inv.filter((i) => i.itemType === "card"),
			banner: inv.filter((i) => i.itemType === "banner"),
			badge: inv.filter((i) => i.itemType === "badge"),
			color: inv.filter((i) => i.itemType === "color"),
			title: inv.filter((i) => i.itemType === "title"),
		};
		const fmt = (arr: typeof inv, equippedKey: string | null | undefined) => {
			if (!arr.length) return "*Aucun objet possédé*";
			return arr
				.map((i) => (i.itemKey === equippedKey ? `**\`${i.itemKey}\`** ⭐ *(équipé)*` : `\`${i.itemKey}\``))
				.join(", ");
		};

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.gold)
			.setAuthor({
				name: `Personnalisation Martiale · ${interaction.user.displayName ?? interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL({ size: 128 }),
			})
			.setTitle("✏️ Garde-Robe & Équipement du Combattant")
			.setDescription(
				[
					`Choisis un emplacement d'équipement ci-dessous pour modifier l'apparence de ta carte de profil.`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.addFields(
				{ name: "🖼️ Cartes de Fond", value: fmt(group.card, user?.equippedCard) },
				{ name: "🌌 Bannières de Profil", value: fmt(group.banner, user?.equippedBanner) },
				{ name: "🎖️ Badges Honorifiques", value: fmt(group.badge, user?.equippedBadge) },
				{ name: "🎨 Couleurs & Auras", value: fmt(group.color, user?.equippedColor) },
				{ name: "📜 Titres de Guerrier", value: fmt(group.title, user?.equippedTitle) }
			)
			.setFooter({
				text: "Utilise les boutons ci-dessous pour équiper un objet précis",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("eprofil:equip:card")
				.setLabel("Carte")
				.setEmoji("🖼️")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("eprofil:equip:banner")
				.setLabel("Bannière")
				.setEmoji("🌌")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("eprofil:equip:badge")
				.setLabel("Badge")
				.setEmoji("🎖️")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("eprofil:equip:color")
				.setLabel("Couleur")
				.setEmoji("🎨")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId("eprofil:equip:title")
				.setLabel("Titre")
				.setEmoji("📜")
				.setStyle(ButtonStyle.Secondary)
		);
		await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
	}

	@ButtonComponent({ id: /^eprofil:equip:(card|banner|badge|color|title)$/ })
	async equipBtn(interaction: ButtonInteraction) {
		const type = interaction.customId.split(":")[2] as "card" | "banner" | "badge" | "color" | "title";
		const modal = new ModalBuilder()
			.setCustomId(`eprofil:submit:${type}`)
			.setTitle(`Équiper un(e) ${type}`);
		const input = new TextInputBuilder()
			.setCustomId("key")
			.setLabel("Clé de l'objet (ex: saiyan_blue)")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);
		modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
		await interaction.showModal(modal);
	}

	@ModalComponent({ id: /^eprofil:submit:(card|banner|badge|color|title)$/ })
	async equipModal(interaction: ModalSubmitInteraction) {
		const type = interaction.customId.split(":")[2] as "card" | "banner" | "badge" | "color" | "title";
		const key = interaction.fields.getTextInputValue("key").trim();
		const ok = await this.eco.equip(interaction.user.id, type, key);
		await interaction.reply({
			content: ok ? `✅ ${type} \`${key}\` équipé avec succès !` : `❌ Tu ne possèdes pas cet objet dans ton inventaire.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	// /fusion (gardé par features.fusion ; /defusion reste libre pour défusionner même feature off)
	@Slash({ name: "fusion", description: "Proposer une fusion sacrée à un partenaire" })
	@Guard(FeatureEnabled("features.fusion", "La fusion"))
	async fusion(
		@SlashOption(
			{
				name: "membre",
				description: "Partenaire de fusion",
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			userTransformer
		)
		target: User,
		interaction: CommandInteraction
	) {
		if (target.id === interaction.user.id) {
			await interaction.reply({
				content: "Impossible de fusionner avec soi-même.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (target.bot) {
			await interaction.reply({
				content: "Les dieux et les androïdes ne fusionnent pas avec les mortels.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const existing = await this.eco.getFusion(interaction.user.id);
		if (existing) {
			await interaction.reply({
				content: "Tu es déjà uni(e) par une fusion active. Effectue `/defusion` au préalable.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply();
		const buf = await this.fusionCanvas.render({
			a: interaction.user,
			b: target,
			state: "propose",
		});

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.orange)
			.setAuthor({
				name: "RITUEL DE LA DANSE FUSION · 融合の儀式",
				iconURL: interaction.user.displayAvatarURL({ size: 128 }),
			})
			.setTitle("⚡ Demande de Fusion Sacrée")
			.setDescription(
				[
					`${target}, le guerrier ${interaction.user} souhaite harmoniser son Ki avec le tien !`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					`**Avantages de l'Union :**`,
					`> • **+10 % XP & Zénis partagés** sur chaque message et session vocale.`,
					`> • Rôle exclusif **Fusion** sur le sanctuaire.`,
					`> • Nom guerrier combiné canonique ou fusionné.`,
					`${SHENRON_SEPARATORS.solid}`,
					`*Seule la cible peut accepter ou décliner l'invitation.*`,
				].join("\n")
			)
			.setImage("attachment://fusion-propose.png")
			.setFooter({
				text: "La fusion peut être rompue à tout moment via /defusion",
				iconURL: "https://dragonballfr.com/favicon.ico",
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`fusion:accept:${interaction.user.id}:${target.id}`)
				.setLabel("Accepter l'Union")
				.setEmoji("💍")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`fusion:refuse:${interaction.user.id}:${target.id}`)
				.setLabel("Décliner")
				.setEmoji("❌")
				.setStyle(ButtonStyle.Danger)
		);

		await interaction.editReply({
			embeds: [embed],
			files: [new AttachmentBuilder(buf, { name: "fusion-propose.png" })],
			components: [row],
		});
	}

	@ButtonComponent({ id: /^fusion:(accept|refuse):\d+:\d+$/ })
	async fusionResponse(interaction: ButtonInteraction) {
		const [, action, proposerId, targetId] = interaction.customId.split(":");
		if (interaction.user.id !== targetId) {
			await interaction.reply({
				content: "Seule la cible de la proposition peut répondre.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (action === "refuse") {
			const refuseEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.majinRed)
				.setTitle("❌ Fusion Déclinée")
				.setDescription(`<@${targetId}> a préféré décliner l'invitation à la fusion de <@${proposerId}>.`)
				.setFooter({ text: "Danse de la fusion annulée" });

			await interaction.update({
				embeds: [refuseEmb],
				files: [],
				components: [],
			});
			return;
		}
		await this.eco.createFusion(proposerId!, targetId!);

		if (interaction.guild) {
			await this.fusionRoles.applyToPair(interaction.guild, proposerId!, targetId!);
		}

		const proposer = await interaction.client.users.fetch(proposerId!).catch(() => null);
		const target = await interaction.client.users.fetch(targetId!).catch(() => null);
		const a = proposer?.displayName || proposer?.username || "A";
		const b = target?.displayName || target?.username || "B";
		const fused = fusionName(a, b);

		if (proposer && target) {
			const buf = await this.fusionCanvas.render({
				a: proposer,
				b: target,
				state: "success",
				fusedName: fused,
			});

			const successEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setAuthor({
					name: "RÉUSSITE PARFAITE DE LA FUSION · 誕生",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`✨ NAISSANCE D'UN ÊTRE SUPRÊME : ${fused.toUpperCase()}`)
				.setDescription(
					[
						`Les esprits et forces de <@${proposerId}> et <@${targetId}> ne font désormais plus qu'un !`,
						"",
						`${SHENRON_SEPARATORS.solid}`,
						`> **Multiplicateur Actif :** **+10 % XP & Zénis partagés** sur toute activité.`,
						`> **Identité Guerrière :** **${fused}**`,
						`${SHENRON_SEPARATORS.solid}`,
					].join("\n")
				)
				.setImage("attachment://fusion-success.png")
				.setFooter({
					text: "Union scellée dans les registres du sanctuaire · dragonballfr.com",
					iconURL: "https://dragonballfr.com/favicon.ico",
				});

			await interaction.update({
				embeds: [successEmb],
				files: [new AttachmentBuilder(buf, { name: "fusion-success.png" })],
				components: [],
			});
		} else {
			const fallbackEmb = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setTitle(`✨ FUSION RÉUSSIE : ${fused.toUpperCase()}`)
				.setDescription(`<@${proposerId}> et <@${targetId}> sont désormais unis sous l'identité **${fused}** !`);

			await interaction.update({
				embeds: [fallbackEmb],
				files: [],
				components: [],
			});
		}
	}

	@Slash({ name: "defusion", description: "Annuler votre fusion active" })
	async defusion(interaction: CommandInteraction) {
		const partner = await this.eco.partnerOf(interaction.user.id);
		const ok = await this.eco.breakFusion(interaction.user.id);
		if (ok && partner && interaction.guild) {
			await this.fusionRoles.removeFromPair(interaction.guild, interaction.user.id, partner);
		}

		const embed = new EmbedBuilder()
			.setColor(ok ? SHENRON_THEME.majinRed : 0x71717a)
			.setTitle(ok ? "💔 Rupture de Fusion" : "ℹ️ Aucune Fusion")
			.setDescription(
				ok
					? `La fusion a été rompue. Toi et <@${partner}> avez repris vos identités distinctes et le bonus de +10 % a été retiré.`
					: "Tu ne possèdes aucune fusion active."
			)
			.setFooter({ text: "Économie Shenron" });

		await interaction.reply({
			embeds: [embed],
			flags: ok ? undefined : MessageFlags.Ephemeral,
		});
	}

	// /solde
	@Slash({ name: "solde", description: "Consulter votre fortune de zénis et statut financier" })
	async solde(
		@SlashOption(
			{
				name: "membre",
				description: "Membre dont vous souhaitez voir le solde",
				type: ApplicationCommandOptionType.User,
				required: false,
			},
			userTransformer
		)
		target: User | undefined,
		interaction: CommandInteraction
	) {
		const user = target ?? interaction.user;
		const bal = await this.eco.getBalance(user.id);
		const fusion = await this.eco.getFusion(user.id);
		const inv = await this.eco.listInventory(user.id);
		const partnerId = fusion?.userA === user.id ? fusion.userB : fusion?.userA;

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.gold)
			.setAuthor({
				name: `Coffre-Fort & Fortune · ${user.displayName ?? user.username}`,
				iconURL: user.displayAvatarURL({ size: 128 }),
			})
			.setTitle("💰 Trésor de Zénis · 財宝")
			.setDescription(
				[
					`*La monnaie officielle circulant dans tout le sanctuaire Dragon Ball.*`,
					"",
					`${SHENRON_SEPARATORS.solid}`,
					`> **Solde Disponible :** **${formatXP(bal)}** 𝓩 *(Zénis)*`,
					`${SHENRON_SEPARATORS.solid}`,
				].join("\n")
			)
			.addFields(
				{
					name: "🎒 Inventaire",
					value: `**${inv.length}** objet${inv.length > 1 ? "s" : ""}`,
					inline: true,
				},
				{
					name: "💫 Statut d'Union",
					value: partnerId ? `Uni(e) avec <@${partnerId}>\n*+10 % bonus partagé*` : "*Aucune fusion*",
					inline: true,
				}
			)
			.setFooter({
				text: "Économie Shenron · Utilise /shop pour acquérir des raretés",
				iconURL: "https://dragonballfr.com/favicon.ico",
			})
			.setTimestamp();

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("shop:open")
				.setLabel("Ouvrir la Boutique")
				.setEmoji("🏪")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("shop:eprofil")
				.setLabel("Inventaire")
				.setEmoji("🎒")
				.setStyle(ButtonStyle.Secondary)
		);

		await interaction.reply({ embeds: [embed], components: [row] });
	}


	// Admin: /zeni give|remove
	@Slash({
		name: "zeni",
		description: "Admin: donner/retirer des zéni",
		defaultMemberPermissions: PermissionFlagsBits.Administrator,
	})
	@Guard(AdminOnly)
	async zeniAdmin(
		@SlashChoice({ name: "give", value: "give" })
		@SlashChoice({ name: "remove", value: "remove" })
		@SlashOption({
			name: "action",
			description: "give/remove",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "give" | "remove",
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
			description: "Rôle (tous les membres avec ce rôle)",
			type: ApplicationCommandOptionType.Role,
			required: false,
		})
		role: Role | undefined,
		@SlashOption({
			name: "all",
			description: "Appliquer à tous les membres inscrits",
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		})
		all: boolean | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const signed = action === "give" ? amount : -amount;

		if (user) {
			if (signed > 0) await this.eco.addZeni(user.id, signed, { propagateFusion: false, source: "admin" });
			else await this.eco.removeZeni(user.id, -signed);
			await interaction.editReply({ content: `✅ ${user} : ${signed > 0 ? "+" : ""}${signed} z` });
			return;
		}
		if (role) {
			const members = await interaction.guild.members.fetch();
			let count = 0;
			for (const m of members.values()) {
				if (m.roles.cache.has(role.id)) {
					if (signed > 0) await this.eco.addZeni(m.id, signed, { propagateFusion: false, source: "admin" });
					else await this.eco.removeZeni(m.id, -signed);
					count++;
				}
			}
			await interaction.editReply({ content: `✅ Appliqué à ${count} membres avec ${role}.` });
			return;
		}
		if (all) {
			const ids = await this.eco.listRegisteredIds();
			for (const id of ids) {
				if (signed > 0) await this.eco.addZeni(id, signed, { propagateFusion: false, source: "admin" });
				else await this.eco.removeZeni(id, -signed);
			}
			await interaction.editReply({ content: `✅ Appliqué à ${ids.length} membres inscrits.` });
			return;
		}
		await interaction.editReply({ content: "Spécifiez un membre, un rôle, ou all:true." });
	}

	// Admin: /custom give|remove type key @cible
	@Slash({
		name: "custom",
		description: "Admin: donner/retirer un objet custom",
		defaultMemberPermissions: PermissionFlagsBits.Administrator,
	})
	@Guard(AdminOnly)
	async customAdmin(
		@SlashChoice({ name: "give", value: "give" })
		@SlashChoice({ name: "remove", value: "remove" })
		@SlashOption({
			name: "action",
			description: "give/remove",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "give" | "remove",
		@SlashChoice({ name: "card", value: "card" })
		@SlashChoice({ name: "badge", value: "badge" })
		@SlashChoice({ name: "color", value: "color" })
		@SlashChoice({ name: "title", value: "title" })
		@SlashChoice({ name: "succes", value: "succes" })
		@SlashOption({
			name: "type",
			description: "Type d'objet",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		type: "card" | "badge" | "color" | "title" | "succes",
		@SlashOption({
			name: "cle",
			description: "Clé",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		key: string,
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
			description: "Appliquer à tous les inscrits",
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		})
		all: boolean | undefined,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const targets: string[] = [];
		if (user) targets.push(user.id);
		else if (role) {
			const members = await interaction.guild.members.fetch();
			for (const m of members.values()) if (m.roles.cache.has(role.id)) targets.push(m.id);
		} else if (all) {
			const ids = await this.eco.listRegisteredIds();
			targets.push(...ids);
		} else {
			await interaction.editReply({ content: "Spécifiez un membre, un rôle, ou all:true." });
			return;
		}

		for (const uid of targets) {
			if (type === "succes") {
				if (action === "give") await this.eco.grantAchievement(uid, key);
				else await this.eco.revokeAchievement(uid, key);
			} else {
				if (action === "give") await this.eco.grantItem(uid, type, key);
				else await this.eco.removeItem(uid, type, key);
			}
		}
		await interaction.editReply({
			content: `✅ ${type}:${key} ${action === "give" ? "donné" : "retiré"} à ${targets.length} membre(s).`,
		});
	}
}
