/**
 * `/staff discord` — l'état VIVANT du serveur Discord, tel que l'API le rend à
 * l'instant où on le demande.
 *
 * ── CE QUE CETTE COMMANDE N'EST PAS ────────────────────────────────────────
 * Ce n'est PAS `/staff stats discord`. Celle-ci lit les tables `discord_*`
 * peuplées par `rg-cron.service` : des compteurs historiques (messages
 * archivés, arrivées sur 30 jours, sondages) qui ne peuvent venir que d'une
 * base, parce que l'API Discord ne les tient pas. Celle-ci lit la passerelle et
 * l'API : la liste réelle des rôles, l'arborescence réelle des salons, les
 * bannis, les invitations, le journal d'audit — que la base ne connaît pas.
 *
 * Les deux se recoupent sur deux nombres, et c'est VOULU : le nombre de membres
 * et le nombre de salons. Leur écart n'est pas un doublon, c'est un diagnostic —
 * si `/staff discord serveur` annonce 1 984 membres et `/staff stats discord`
 * 1 849, c'est que la synchronisation du cron a pris du retard. Sans les deux
 * chiffres côte à côte, ce retard reste invisible jusqu'à ce qu'il fasse mal.
 *
 * ── RIEN NE MODIFIE ────────────────────────────────────────────────────────
 * Aucun appel de cette commande n'écrit quoi que ce soit : ni `create`, ni
 * `edit`, ni `delete`, ni `remove`. Tout ce qui modifie le serveur vit sous
 * `/administration`. Corollaire : aucune confirmation, aucun motif d'audit —
 * il n'y a rien à confirmer ni à tracer, on regarde.
 *
 * ── CE QUE LES INTENTS PERMETTENT ──────────────────────────────────────────
 * Le bot n'ouvre que `Guilds` et `GuildMembers` (`src/index.ts`). Tout ce qui
 * est affiché ici tient dans ces deux-là, ou passe par un appel REST (les
 * bannis, les invitations, le journal d'audit ne sont pas des événements de
 * passerelle). Ce qui exigerait `MessageContent` ou `GuildPresences` n'est PAS
 * implémenté à moitié : ça n'est pas implémenté du tout.
 */
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	MessageFlags,
	type AutocompleteInteraction,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type Guild,
	type GuildMember,
	type InteractionEditReplyOptions,
	type NonThreadGuildBasedChannel,
	type Role,
} from "discord.js";

import { cached } from "../../lib/cache";
import {
	analyserIdPageInspection,
	assemblerPageInspection,
	bornerPageInspection,
	compterHorsDePortee,
	construireIdPageInspection,
	diagnostiquerActions,
	dureeLisible,
	libelleEvenementAudit,
	libelleFonctionnaliteGuilde,
	libelleNiveauBoost,
	libelleNiveauVerification,
	libelleTypeSalon,
	manquantesParmi,
	MAX_LIGNES_PAGE_INSPECTION,
	nombreDePagesInspection,
	PERMISSIONS_LECTURE_INVITATIONS,
	permissionsManquantes,
	permissionsSensibles,
	pictoTypeSalon,
	trancheInspection,
} from "../../lib/discord-admin";
import { rgEmbed } from "../../lib/embeds";
import { NotAdminError, requireRgAdmin } from "../../lib/rbac";
import {
	borner,
	echapperMarkdown,
	formaterNombre,
	horodatageAbsolu,
	horodatageRelatif,
	listeCourte,
	pastilleEtat,
} from "./format";
import { differerEnPrive, exigerDroits, messagePanne } from "./garde";
import "./racine";
import { echec, pied, piedTexte, repondre } from "../../lib/ui";

/** Les trois listes assez longues pour mériter des boutons de page. */
const VUES_PAGINEES = ["roles", "bannissements", "invitations"] as const;
type VuePaginee = (typeof VUES_PAGINEES)[number];

function estVuePaginee(valeur: string): valeur is VuePaginee {
	return (VUES_PAGINEES as readonly string[]).includes(valeur);
}

/** Titre de chaque liste, pour n'écrire les libellés qu'une fois. */
const TITRES_VUE: Readonly<Record<VuePaginee, string>> = Object.freeze({
	roles: "Rôles du serveur",
	bannissements: "Bannissements",
	invitations: "Invitations actives",
});

/**
 * Plafond de la liste des bannis rendue par l'API en un appel.
 *
 * `GET /guilds/{id}/bans` accepte `limit` jusqu'à 1000 et pagine par `after`.
 * On ne pagine PAS côté API : au-delà de mille bannissements, le staff n'a plus
 * besoin d'une liste dans Discord mais d'un export. On le dit plutôt que de
 * laisser croire à une liste complète.
 */
const MAX_BANNISSEMENTS = 1_000;

/** Entrées du journal d'audit affichées. Borne volontaire, pas une limite d'API. */
const MAX_ENTREES_JOURNAL = 25;

/** Durée de vie du décompte des membres par rôle. */
const TTL_MEMBRES_MS = 300_000;

// ─── Accès au serveur ───────────────────────────────────────────────────────

/**
 * Le serveur de l'interaction, ou `null` après avoir dit pourquoi.
 *
 * En message privé, `interaction.guild` est `null` : sans ce garde, chaque
 * sous-commande partirait en `TypeError` et le membre lirait « la commande a
 * échoué », ce qui envoie chercher une panne là où il n'y a qu'un mauvais
 * endroit.
 */
async function serveurDeLInteraction(
	interaction: ChatInputCommandInteraction
): Promise<Guild | null> {
	if (!interaction.guild) {
		await interaction.editReply({
			content:
				"Cette commande lit l'état d'un serveur : elle n'a pas de sens en message privé. " +
				"Relance-la depuis un salon du serveur Rose Griffon.",
		});
		return null;
	}
	return interaction.guild;
}

/** Le membre « bot » sur ce serveur. `members.me` est vide tant qu'il n'a pas été résolu. */
async function membreBot(guild: Guild): Promise<GuildMember> {
	return guild.members.me ?? (await guild.members.fetchMe());
}

/** Décomptes tirés d'UNE seule récupération de la liste des membres. */
interface ResumeMembres {
	readonly total: number;
	readonly bots: number;
	/** Identifiant de rôle → nombre de membres qui le portent. */
	readonly parRole: Record<string, number>;
	/**
	 * Position du rôle le plus haut → nombre de membres à cette position.
	 *
	 * On range un HISTOGRAMME plutôt que les 1 984 positions : le résultat est
	 * mis en cache (donc sérialisé en JSON), et il reste exploitable pour
	 * n'importe quelle position du bot — y compris après que le rôle du bot a été
	 * déplacé, sans avoir à tout relire.
	 */
	readonly positionsHautes: Record<string, number>;
}

/**
 * Compte les membres par rôle, en UNE récupération.
 *
 * `role.members` n'est pas une requête : c'est un filtre sur le cache local.
 * Sans `guild.members.fetch()` préalable, il rend le nombre de membres que le
 * bot a croisés depuis son démarrage — un chiffre qui grandit tout seul et qui
 * n'a jamais été celui du serveur. On récupère donc explicitement, une fois,
 * et on garde le résultat cinq minutes : la liste complète, c'est ~1 984
 * membres sur la passerelle, et personne ne consulte les rôles deux fois par
 * seconde.
 */
async function resumeMembres(guild: Guild): Promise<ResumeMembres> {
	return await cached(`staff:discord:membres:${guild.id}`, TTL_MEMBRES_MS, async () => {
		const membres = await guild.members.fetch();
		const parRole: Record<string, number> = {};
		const positionsHautes: Record<string, number> = {};
		let bots = 0;
		for (const membre of membres.values()) {
			if (membre.user.bot) {
				bots += 1;
			}
			for (const identifiant of membre.roles.cache.keys()) {
				parRole[identifiant] = (parRole[identifiant] ?? 0) + 1;
			}
			const position = String(membre.roles.highest.position);
			positionsHautes[position] = (positionsHautes[position] ?? 0) + 1;
		}
		return { total: membres.size, bots, parRole, positionsHautes } satisfies ResumeMembres;
	});
}

/** Ré-étale l'histogramme des positions, pour le passer au compteur pur et testé. */
function* positionsDepuisHistogramme(histogramme: Record<string, number>): Generator<number> {
	for (const [position, nombre] of Object.entries(histogramme)) {
		for (let rang = 0; rang < nombre; rang += 1) {
			yield Number(position);
		}
	}
}

// ─── Mise en forme ──────────────────────────────────────────────────────────

/** Une ligne de rôle : rang, nom, effectif, et ce qu'il permet vraiment. */
function ligneRole(role: Role, membres: number): string {
	const pouvoirs = permissionsSensibles(role.permissions);
	const tete = `\`#${String(role.position).padStart(2, "0")}\` **${echapperMarkdown(borner(role.name, 60))}**`;
	const effectif = `${formaterNombre(membres)} membre${membres > 1 ? "s" : ""}`;
	const gere = role.managed ? " · *géré par une intégration*" : "";
	const detail =
		pouvoirs.length > 0
			? `\n   └ ${borner(pouvoirs.join(" · "), 240)}`
			: "\n   └ *aucune permission sensible*";
	return `${tete} — ${effectif}${gere}${detail}`;
}

/** Une ligne de bannissement : le pseudo, l'identifiant, le motif. Rien d'autre. */
function ligneBannissement(banni: {
	user: { username: string; id: string };
	reason?: string | null;
}): string {
	const motif = banni.reason?.trim();
	return (
		`**${echapperMarkdown(borner(banni.user.username, 60))}** — \`${banni.user.id}\`\n` +
		`   └ ${motif && motif.length > 0 ? echapperMarkdown(borner(motif, 200)) : "*aucun motif enregistré*"}`
	);
}

/** Une ligne d'invitation : code, auteur, salon, usage, expiration. */
function ligneInvitation(invitation: {
	code: string;
	uses: number | null;
	maxUses: number | null;
	maxAge: number | null;
	expiresAt: Date | null;
	temporary: boolean | null;
	inviter: { username: string; id: string } | null;
	// `Invite.channel` peut être un salon de groupe privé, dont le `name` est
	// `string | null` : typer `string | undefined` ici ferait échouer la
	// compilation sur un cas que l'API rend pour de vrai.
	channel: { name?: string | null } | null;
}): string {
	const usages = `${formaterNombre(invitation.uses ?? 0)}${
		invitation.maxUses && invitation.maxUses > 0 ? ` / ${formaterNombre(invitation.maxUses)}` : ""
	}`;
	const auteur = invitation.inviter
		? `**${echapperMarkdown(borner(invitation.inviter.username, 40))}**`
		: "*auteur inconnu*";
	const salon =
		invitation.channel && typeof invitation.channel.name === "string"
			? `#${echapperMarkdown(borner(invitation.channel.name, 40))}`
			: "*salon inconnu*";
	const details = [
		`utilisée ${usages} fois`,
		invitation.expiresAt
			? `expire ${horodatageRelatif(invitation.expiresAt)}`
			: invitation.maxAge && invitation.maxAge > 0
				? `valable ${dureeLisible(invitation.maxAge * 1000)}`
				: "sans expiration",
		invitation.temporary ? "adhésion temporaire" : null,
	].filter((morceau): morceau is string => morceau !== null);
	return `\`${invitation.code}\` — ${auteur} · ${salon}\n   └ ${details.join(" · ")}`;
}

/**
 * Les boutons de page.
 *
 * `construireIdPageInspection` rend `null` si l'identifiant dépasserait les 100
 * caractères de Discord : dans ce cas on affiche la page SANS boutons, parce
 * qu'un `custom_id` trop long fait refuser le message ENTIER, pas seulement le
 * bouton.
 */
function boutonsDePage(
	vue: VuePaginee,
	page: number,
	pages: number,
	graine: string
): Array<ActionRowBuilder<ButtonBuilder>> {
	if (pages <= 1) {
		return [];
	}
	const precedent = construireIdPageInspection({ vue, page: page - 1, graine });
	const suivant = construireIdPageInspection({ vue, page: page + 1, graine });
	if (!precedent || !suivant) {
		return [];
	}
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(precedent)
				.setLabel("Précédent")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page <= 1),
			// Repère de position, jamais cliquable : sur mobile le pied de l'embed se
			// lit mal, et sans lui on ne sait plus où l'on est dans la liste.
			new ButtonBuilder()
				.setCustomId(`${vue}-repere-page`)
				.setLabel(`${page} / ${pages}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(suivant)
				.setLabel("Suivant")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page >= pages)
		),
	];
}

/** Réponse commune : un embed d'explication, sans boutons. */
function reponseSimple(titre: string, description: string): InteractionEditReplyOptions {
	return {
		embeds: [rgEmbed().setTitle(titre).setDescription(borner(description, 4_000))],
		components: [],
	};
}

// ─── Rendu des trois listes paginées ────────────────────────────────────────

async function rendreRoles(
	guild: Guild,
	page: number,
	graine: string
): Promise<InteractionEditReplyOptions> {
	const [roles, membres] = await Promise.all([guild.roles.fetch(), resumeMembres(guild)]);
	// Du plus haut au plus bas : c'est l'ordre de la hiérarchie, donc celui qui
	// décide qui peut modérer qui. `@everyone` (position 0) ferme la liste.
	const ordonnes = [...roles.values()].toSorted((a, b) => b.position - a.position);
	const pages = nombreDePagesInspection(ordonnes.length);
	const courante = bornerPageInspection(page, ordonnes.length);
	const tranche = trancheInspection(ordonnes, courante);

	const embed = rgEmbed()
		.setTitle(`${TITRES_VUE.roles} — ${formaterNombre(ordonnes.length)}`)
		.setDescription(
			tranche.length > 0
				? assemblerPageInspection(
						tranche.map((role) => ligneRole(role, membres.parRole[role.id] ?? 0))
					)
				: "Ce serveur n'a aucun rôle."
		)
		.setFooter(
			piedTexte({
				note: `Page ${courante}/${pages} · effectifs relevés sur ${formaterNombre(membres.total)} membres, en cache 5 min`,
			})
		);

	return { embeds: [embed], components: boutonsDePage("roles", courante, pages, graine) };
}

async function rendreBannissements(
	guild: Guild,
	page: number,
	graine: string
): Promise<InteractionEditReplyOptions> {
	const bot = await membreBot(guild);
	const manquantes = permissionsManquantes(bot.permissions, "bannir");
	if (manquantes.length > 0) {
		return reponseSimple(
			TITRES_VUE.bannissements,
			`Le bot ne peut pas lire la liste des bannis : il lui manque **${manquantes.join("**, **")}**. ` +
				"Discord exige cette permission pour LIRE la liste, pas seulement pour bannir."
		);
	}

	const bannis = await guild.bans.fetch({ limit: MAX_BANNISSEMENTS });
	const liste = [...bannis.values()];
	const pages = nombreDePagesInspection(liste.length);
	const courante = bornerPageInspection(page, liste.length);
	const tranche = trancheInspection(liste, courante);

	const embed = rgEmbed()
		.setTitle(`${TITRES_VUE.bannissements} — ${formaterNombre(liste.length)}`)
		.setDescription(
			tranche.length > 0
				? assemblerPageInspection(tranche.map(ligneBannissement))
				: "Aucun bannissement en vigueur sur ce serveur."
		);

	if (liste.length >= MAX_BANNISSEMENTS) {
		embed.addFields({
			name: "Liste tronquée",
			value:
				`L'API en rend ${formaterNombre(MAX_BANNISSEMENTS)} au maximum par appel : au-delà, ` +
				"la liste affichée n'est plus complète. Passe par un export si le besoin est réel.",
		});
	}
	pied(embed, { page: courante, pages: pages, note: "lu en direct, aucun cache" });

	return { embeds: [embed], components: boutonsDePage("bannissements", courante, pages, graine) };
}

async function rendreInvitations(
	guild: Guild,
	page: number,
	graine: string
): Promise<InteractionEditReplyOptions> {
	const bot = await membreBot(guild);
	const manquantes = manquantesParmi(bot.permissions, PERMISSIONS_LECTURE_INVITATIONS);
	if (manquantes.length > 0) {
		return reponseSimple(
			TITRES_VUE.invitations,
			`Le bot ne peut pas lire les invitations : il lui manque **${manquantes.join("**, **")}**. ` +
				"C'est cette permission-là que Discord exige pour la liste du serveur — « Créer une " +
				"invitation » ne suffit pas."
		);
	}

	const invitations = await guild.invites.fetch();
	// De la plus utilisée à la moins utilisée : une invitation à 900 usages est
	// une porte d'entrée, une invitation à 0 est un oubli.
	const liste = [...invitations.values()].toSorted((a, b) => (b.uses ?? 0) - (a.uses ?? 0));
	const pages = nombreDePagesInspection(liste.length);
	const courante = bornerPageInspection(page, liste.length);
	const tranche = trancheInspection(liste, courante);
	const usagesCumules = liste.reduce((total, invitation) => total + (invitation.uses ?? 0), 0);

	const embed = rgEmbed()
		.setTitle(`${TITRES_VUE.invitations} — ${formaterNombre(liste.length)}`)
		.setDescription(
			tranche.length > 0
				? assemblerPageInspection(tranche.map(ligneInvitation))
				: "Aucune invitation active. Le serveur n'est joignable que par une URL personnalisée ou une découverte."
		)
		.setFooter(
			piedTexte({
				note: `Page ${courante}/${pages} · ${formaterNombre(usagesCumules)} arrivées cumulées par ces liens`,
			})
		);

	return { embeds: [embed], components: boutonsDePage("invitations", courante, pages, graine) };
}

/** Aiguillage unique : la commande et les boutons rendent EXACTEMENT la même chose. */
async function rendreListe(
	guild: Guild,
	vue: VuePaginee,
	page: number,
	graine: string
): Promise<InteractionEditReplyOptions> {
	switch (vue) {
		case "roles":
			return await rendreRoles(guild, page, graine);
		case "bannissements":
			return await rendreBannissements(guild, page, graine);
		case "invitations":
			return await rendreInvitations(guild, page, graine);
	}
}

@Discord()
@SlashGroup({
	name: "discord",
	description: "État vivant du serveur Discord : rôles, salons, bannis, invitations, journal",
	root: "staff",
})
@SlashGroup("discord", "staff")
export class StaffDiscordCommand {
	@Slash({
		name: "serveur",
		description: "Fiche du serveur : membres, salons, rôles, boosts, fonctionnalités, création",
	})
	async serveur(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			// Quatre lectures indépendantes : les enchaîner tripleraient l'attente
			// pour rien. Les caches de la passerelle ne suffisent pas — les émojis
			// et les autocollants n'y sont peuplés que si le bot les a vus passer.
			const [proprietaire, salons, roles, emojis, autocollants] = await Promise.all([
				guild.fetchOwner(),
				guild.channels.fetch(),
				guild.roles.fetch(),
				guild.emojis.fetch(),
				guild.stickers.fetch(),
			]);

			const reels = [...salons.values()].filter(
				(salon): salon is NonThreadGuildBasedChannel => salon !== null
			);
			const parType = new Map<number, number>();
			for (const salon of reels) {
				parType.set(salon.type, (parType.get(salon.type) ?? 0) + 1);
			}
			const repartitionSalons = [...parType.entries()]
				.toSorted((a, b) => b[1] - a[1])
				.map(([type, nombre]) => `${pictoTypeSalon(type)} ${libelleTypeSalon(type)} : ${nombre}`)
				.join("\n");

			const embed = rgEmbed()
				.setTitle(borner(guild.name, 200))
				.setDescription(
					guild.description
						? echapperMarkdown(borner(guild.description, 1_000))
						: "*Ce serveur n'a pas de description publique.*"
				)
				.addFields(
					{ name: "Identifiant", value: `\`${guild.id}\``, inline: true },
					{
						name: "Créé le",
						value: `${horodatageAbsolu(guild.createdAt)}\n${horodatageRelatif(guild.createdAt)}`,
						inline: true,
					},
					{
						name: "Propriétaire",
						value: `<@${proprietaire.id}>\n\`${proprietaire.id}\``,
						inline: true,
					},
					{
						name: "Membres à l'instant",
						value:
							`**${formaterNombre(guild.memberCount)}**` +
							(guild.maximumMembers ? `\nplafond ${formaterNombre(guild.maximumMembers)}` : ""),
						inline: true,
					},
					{
						name: "Rôles",
						value: formaterNombre(roles.size),
						inline: true,
					},
					{
						name: "Boosts",
						value:
							`${libelleNiveauBoost(guild.premiumTier)}\n` +
							`${formaterNombre(guild.premiumSubscriptionCount ?? 0)} boost(s)`,
						inline: true,
					},
					{
						name: `Salons (${formaterNombre(reels.length)})`,
						value: borner(repartitionSalons.length > 0 ? repartitionSalons : "*aucun*", 1_000),
						inline: true,
					},
					{
						name: "Expressions",
						value: `${formaterNombre(emojis.size)} émoji(s)\n${formaterNombre(autocollants.size)} autocollant(s)`,
						inline: true,
					},
					{
						name: "Entrée",
						value:
							`Vérification : ${libelleNiveauVerification(guild.verificationLevel)}\n` +
							`Langue : \`${guild.preferredLocale}\`` +
							(guild.vanityURLCode ? `\nURL : \`discord.gg/${guild.vanityURLCode}\`` : ""),
						inline: true,
					},
					{
						name: "Salons particuliers",
						value:
							[
								guild.rulesChannelId ? `Règles : <#${guild.rulesChannelId}>` : null,
								guild.systemChannelId ? `Système : <#${guild.systemChannelId}>` : null,
								guild.publicUpdatesChannelId
									? `Alertes Discord : <#${guild.publicUpdatesChannelId}>`
									: null,
								guild.afkChannelId
									? `Inactivité : <#${guild.afkChannelId}> après ${dureeLisible(guild.afkTimeout * 1000)}`
									: null,
							]
								.filter((ligne): ligne is string => ligne !== null)
								.join("\n") || "*aucun*",
					},
					{
						name: `Fonctionnalités (${guild.features.length})`,
						value: listeCourte(
							guild.features
								.map(libelleFonctionnaliteGuilde)
								.toSorted((a, b) => a.localeCompare(b, "fr")),
							40,
							1_000,
							"*aucune*"
						),
					}
				);

			const icone = guild.iconURL({ size: 256 });
			if (icone) {
				embed.setThumbnail(icone);
			}
			pied(embed, {
				note: "Rendu par l'API à l'instant · les compteurs historiques (messages, arrivées sur 30 j) sont dans /staff stats discord",
			});
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "roles",
		description: "Les rôles, leur rang dans la hiérarchie, leur effectif et ce qu'ils permettent",
	})
	async roles(
		@SlashOption({
			name: "page",
			description: "Numéro de page (25 rôles par page)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		page: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			await interaction.editReply(await rendreRoles(guild, page ?? 1, interaction.user.id));
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "salons",
		description: "L'arborescence des salons, catégorie par catégorie",
	})
	async salons(
		@SlashOption({
			name: "categorie",
			description: "Ne montrer qu'une catégorie (utile quand l'arbre est trop long)",
			type: ApplicationCommandOptionType.String,
			required: false,
			autocomplete: async (interaction: AutocompleteInteraction) => {
				try {
					const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
					const categories = interaction.guild
						? [...interaction.guild.channels.cache.values()].filter(
								(salon) => salon.type === ChannelType.GuildCategory
							)
						: [];
					await interaction.respond(
						categories
							.filter((salon) => saisie.length === 0 || salon.name.toLowerCase().includes(saisie))
							.toSorted((a, b) => a.rawPosition - b.rawPosition)
							// 25 est la borne DURE du nombre de propositions.
							.slice(0, 25)
							.map((salon) => ({ name: borner(salon.name, 100), value: salon.id }))
					);
				} catch (err) {
					console.error("[staff discord] autocomplétion des catégories :", err);
					await interaction.respond([]);
				}
			},
		})
		categorie: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			const salons = [...(await guild.channels.fetch()).values()].filter(
				(salon): salon is NonThreadGuildBasedChannel => salon !== null
			);
			const categories = salons
				.filter((salon) => salon.type === ChannelType.GuildCategory)
				.toSorted((a, b) => a.rawPosition - b.rawPosition);
			const retenues =
				categorie === undefined ? categories : categories.filter((salon) => salon.id === categorie);

			if (categorie !== undefined && retenues.length === 0) {
				await interaction.editReply({
					content:
						"Cette catégorie n'existe plus sur le serveur. Relance la commande sans l'option " +
						"pour voir l'arborescence entière.",
				});
				return;
			}

			const enfants = (parentId: string | null) =>
				salons
					.filter(
						(salon) => salon.type !== ChannelType.GuildCategory && salon.parentId === parentId
					)
					.toSorted((a, b) => a.rawPosition - b.rawPosition);

			const blocs: string[] = [];
			// Les salons sans catégorie s'affichent EN PREMIER, comme dans Discord.
			const orphelins = categorie === undefined ? enfants(null) : [];
			if (orphelins.length > 0) {
				blocs.push(
					`**Hors catégorie**\n` +
						orphelins
							.map((salon) => `${pictoTypeSalon(salon.type)} ${echapperMarkdown(salon.name)}`)
							.join("\n")
				);
			}
			for (const laCategorie of retenues) {
				const dedans = enfants(laCategorie.id);
				blocs.push(
					`**${pictoTypeSalon(laCategorie.type)} ${echapperMarkdown(borner(laCategorie.name, 60))}** — ${dedans.length}\n` +
						(dedans.length > 0
							? dedans
									.map(
										(salon) => `   ${pictoTypeSalon(salon.type)} ${echapperMarkdown(salon.name)}`
									)
									.join("\n")
							: "   *catégorie vide*")
				);
			}

			const arbre = blocs.join("\n\n");
			// La description d'un embed est plafonnée à 4096 : un serveur bien
			// fourni la dépasse. On tronque en le DISANT et en indiquant comment
			// voir la suite, plutôt que de rendre un arbre silencieusement amputé.
			const tronque = arbre.length > 4_000;
			const embed = rgEmbed()
				.setTitle(
					categorie === undefined
						? `Arborescence — ${formaterNombre(salons.length)} salons`
						: `Catégorie ${borner(retenues[0]!.name, 100)}`
				)
				.setDescription(borner(arbre.length > 0 ? arbre : "Ce serveur n'a aucun salon.", 4_000))
				.setFooter(
					piedTexte({
						note: tronque
							? "Arborescence tronquée — relance avec l'option « categorie » pour voir une catégorie en entier"
							: "Les fils ne sont pas listés : ils naissent et meurent trop vite pour un inventaire",
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "bannissements",
		description: "La liste des membres bannis, avec le motif enregistré",
	})
	async bannissements(
		@SlashOption({
			name: "page",
			description: "Numéro de page (25 bannissements par page)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		page: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			await interaction.editReply(await rendreBannissements(guild, page ?? 1, interaction.user.id));
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "invitations",
		description: "Les invitations actives : auteur, salon, usage, expiration",
	})
	async invitations(
		@SlashOption({
			name: "page",
			description: "Numéro de page (25 invitations par page)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		page: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			await interaction.editReply(await rendreInvitations(guild, page ?? 1, interaction.user.id));
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "journal",
		description: "Les dernières entrées du journal d'audit Discord (25 au maximum)",
	})
	async journal(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			const bot = await membreBot(guild);
			const manquantes = permissionsManquantes(bot.permissions, "journal");
			if (manquantes.length > 0) {
				await interaction.editReply({
					content: `Le bot ne peut pas lire le journal d'audit : il lui manque **${manquantes.join("**, **")}**.`,
				});
				return;
			}

			const journal = await guild.fetchAuditLogs({ limit: MAX_ENTREES_JOURNAL });
			const entrees = [...journal.entries.values()];
			const lignes = entrees.map((entree) => {
				// Aucune donnée personnelle au-delà du pseudo et de l'identifiant :
				// ni e-mail, ni adresse, ni contenu de message. `changes` porte parfois
				// des valeurs sensibles (un pseudo précédent, un sujet de salon) — on
				// ne l'affiche pas.
				const auteur = entree.executor
					? `**${echapperMarkdown(borner(entree.executor.username ?? "compte inconnu", 40))}**`
					: "*auteur inconnu*";
				const cible = entree.targetId ? ` → \`${entree.targetId}\`` : "";
				const motif = entree.reason?.trim();
				const detail =
					motif && motif.length > 0 ? `\n   └ ${echapperMarkdown(borner(motif, 160))}` : "";
				return `${libelleEvenementAudit(entree.action)} · ${auteur}${cible} · ${horodatageRelatif(entree.createdAt)}${detail}`;
			});

			const embed = rgEmbed()
				.setTitle(`Journal d'audit — ${lignes.length} dernière(s) entrée(s)`)
				.setDescription(
					lignes.length > 0
						? assemblerPageInspection(lignes)
						: "Le journal d'audit est vide : aucune action administrative récente."
				)
				.setFooter(
					piedTexte({
						note: "Pseudo et identifiant seulement · le détail des changements reste dans Discord",
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "permissions",
		description: "DIAGNOSTIC : ce que le bot peut réellement faire ici, action par action",
	})
	async permissions(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const guild = await serveurDeLInteraction(interaction);
		if (!guild) {
			return;
		}
		try {
			const bot = await membreBot(guild);
			const [roles, membres] = await Promise.all([guild.roles.fetch(), resumeMembres(guild)]);
			const positionBot = bot.roles.highest.position;
			const horsDePortee = compterHorsDePortee(
				positionsDepuisHistogramme(membres.positionsHautes),
				positionBot
			);
			// Les rôles STRICTEMENT au-dessus : ce sont eux qu'il faut redescendre (ou
			// au-dessus desquels remonter le bot) pour élargir sa portée.
			const rolesAuDessus = [...roles.values()]
				.filter((role) => role.position >= positionBot && role.id !== bot.roles.highest.id)
				.toSorted((a, b) => b.position - a.position);

			const diagnostic = diagnostiquerActions(bot.permissions);
			const possibles = diagnostic.filter((ligne) => ligne.possible).length;

			const embed = rgEmbed()
				.setTitle(`Pouvoirs du bot sur ${borner(guild.name, 120)}`)
				.setDescription(
					borner(
						`**${possibles}/${diagnostic.length}** familles d'actions sont réellement exécutables.\n` +
							diagnostic
								.map(
									(ligne) =>
										`${pastilleEtat(ligne.possible)} ${ligne.libelle}` +
										(ligne.possible
											? ""
											: `\n   └ il manque **${ligne.manquantes.join("**, **")}**`)
								)
								.join("\n"),
						4_000
					)
				)
				.addFields(
					{
						name: "Rang du bot",
						value:
							`Rôle le plus haut : **${echapperMarkdown(borner(bot.roles.highest.name, 60))}**\n` +
							`Position \`${positionBot}\` sur \`${roles.size}\` rôles`,
						inline: true,
					},
					{
						name: "Hors de portée",
						value:
							`**${formaterNombre(horsDePortee)}** membre(s)\n` +
							`sur ${formaterNombre(membres.total)}`,
						inline: true,
					},
					{
						name: "Propriétaire",
						value: `<@${guild.ownerId}>\n*intouchable par construction*`,
						inline: true,
					},
					{
						name: `Rôles au niveau du bot ou au-dessus (${rolesAuDessus.length})`,
						value: listeCourte(
							rolesAuDessus.map((role) => `${role.name} (#${role.position})`),
							15,
							1_000,
							"*aucun — le bot domine toute la hiérarchie*"
						),
					},
					{
						name: "Permissions sensibles réellement portées",
						value: listeCourte(permissionsSensibles(bot.permissions), 20, 1_000, "*aucune*"),
					},
					{
						name: "Lectures particulières",
						value: (() => {
							const manque = manquantesParmi(bot.permissions, PERMISSIONS_LECTURE_INVITATIONS);
							return (
								`${pastilleEtat(manque.length === 0)} Lister les invitations du serveur` +
								(manque.length === 0 ? "" : `\n   └ il manque **${manque.join("**, **")}**`)
							);
						})(),
					}
				)
				.setFooter(
					piedTexte({
						note: "Un rang égal est déjà un refus : Discord exige un rôle STRICTEMENT plus haut · intents ouverts : Guilds, GuildMembers",
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	/**
	 * Boutons de page des trois listes.
	 *
	 * Deux vérifications avant de répondre, et dans cet ordre :
	 *   1. la graine — un bouton ne répond QU'À la personne qui a lancé la
	 *      commande. Sans elle, n'importe qui pouvant voir le message pourrait
	 *      faire défiler la liste des bannis de quelqu'un d'autre ;
	 *   2. les droits Rose Griffon — ils ont pu être retirés depuis l'affichage
	 *      de la page, et un bouton n'est pas moins une porte qu'une commande.
	 */
	@ButtonComponent({ id: /^rgdisc\|/ })
	async paginer(interaction: ButtonInteraction) {
		const etat = analyserIdPageInspection(interaction.customId);
		if (!etat || !estVuePaginee(etat.vue)) {
			await interaction.reply({
				content: "Pagination illisible — relance la commande `/staff discord`.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (etat.graine !== interaction.user.id) {
			await interaction.reply({
				content:
					"Cette liste a été demandée par quelqu'un d'autre. Lance la tienne avec `/staff discord`.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!interaction.guild) {
			await interaction.reply({
				content: "Ce bouton n'a de sens que sur un serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			await requireRgAdmin(interaction.user.id);
		} catch (err) {
			await interaction.reply({
				content: `🚫 ${
					err instanceof NotAdminError
						? err.message
						: "Impossible de vérifier tes droits : la base des profils n'a pas répondu."
				}`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferUpdate();
		try {
			await interaction.editReply(
				await rendreListe(interaction.guild, etat.vue, etat.page, etat.graine)
			);
		} catch (err) {
			console.error("[staff discord] pagination :", err);
			await interaction.followUp({
				content: `❌ ${messagePanne(err)}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
