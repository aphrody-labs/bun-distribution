/**
 * `/ticket` — ouvrir, prendre, rendre, fermer. Et le panneau à boutons.
 *
 * ── CE QUI REMPLACE LA TRANSCRIPTION ───────────────────────────────────────
 * `ticketsbot` exportait chaque conversation vers `dashboard.ticketsbot.net`.
 * Ici, la conversation ne quitte jamais Discord : à la fermeture, le fil est
 * ARCHIVÉ et VERROUILLÉ — donc toujours lisible par le staff, comme sa consigne
 * le demande (« On peut lire les tickets déjà fermés ») — et une carte part
 * dans `📦〡ticket-history` avec les mêmes champs que celles des trois années
 * précédentes, pour que l'historique reste homogène.
 *
 * ── LE MOTIF EST OBLIGATOIRE ───────────────────────────────────────────────
 * La consigne épinglée du salon d'entrée dit « **TOUJOURS** fermer avec motif ».
 * `ticketsbot` la laissait facultative : sur la carte la plus récente de
 * l'historique, *Reason* vaut « No reason specified ». Ici l'option est
 * `required: true` — une consigne qu'aucun outil ne fait respecter n'est pas
 * une consigne.
 */
import { ButtonComponent, Discord, ModalComponent, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type GuildTextBasedChannel,
	type ModalSubmitInteraction,
	type ThreadChannel,
} from "discord.js";

import {
	CATEGORIES_TICKET,
	categorieTicket,
	identifiantComposant,
	libelleCategorieTicket,
	libelleEtatTicket,
	LONGUEUR_MOTIF,
	LONGUEUR_SUJET,
	lireComposant,
	manqueDeConfiguration,
	motifPropre,
	referenceTicket,
	refusTransition,
	sujetPropre,
	transitionPermise,
	verifierOuverture,
} from "../lib/tickets";
import { reglagesDe } from "../services/communaute";
import {
	categorieDe,
	clore,
	compterTickets,
	fermerTicket,
	ouvrirTicket,
	prendreTicket,
	publierFermeture,
	reconcilierTicketsOuverts,
	rendreTicket,
	ticketDuSalon,
	ticketsOuverts,
	ticketsOuvertsDe,
	porteDesFils,
	type SalonAFils,
	type Ticket,
} from "../services/tickets";
import {
	attention,
	creerEmbed,
	differer,
	differerEnPrive,
	echec,
	fiche,
	ilYA,
	pied,
	piedDeCommande,
	repondre,
	succes,
	vide,
} from "../lib/ui";

const HORS_GUILDE = "Les tickets n'existent que sur un serveur.";

/** Identifiant de la fenêtre de saisie du sujet, par catégorie. */
function identifiantFenetre(categorieCle: string): string {
	return identifiantComposant("ouvrir", categorieCle);
}

/**
 * Le salon du panneau, résolu et vérifié.
 *
 * Rend `null` en disant pourquoi : un système de tickets à moitié configuré doit
 * nommer le réglage qui manque, pas répondre « erreur ».
 */
async function salonPanneauDe(
	interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction
): Promise<{ salon: SalonAFils } | { erreur: string }> {
	const guildId = interaction.guildId;
	if (!guildId) {
		return { erreur: HORS_GUILDE };
	}
	const reglages = await reglagesDe(guildId);
	if (!reglages.tickets.actif) {
		return { erreur: "Les tickets sont désactivés sur ce serveur." };
	}
	if (!reglages.tickets.salonPanneau) {
		return {
			erreur:
				"Aucun salon de tickets n'est configuré. Le staff le pose avec `/gestion ticket reglages`.",
		};
	}
	const salon = await interaction.client.channels
		.fetch(reglages.tickets.salonPanneau)
		.catch(() => null);
	if (!salon || !salon.isTextBased() || salon.isDMBased()) {
		return {
			erreur: `Le salon de tickets configuré (\`${reglages.tickets.salonPanneau}\`) est introuvable ou n'est pas un salon textuel.`,
		};
	}
	if (!porteDesFils(salon as GuildTextBasedChannel)) {
		return {
			erreur:
				`Le salon de tickets configuré (\`${reglages.tickets.salonPanneau}\`) ne peut pas porter de fils. ` +
				"Choisis un salon textuel ou d'annonces — ni un fil, ni un salon de conférence.",
		};
	}
	return { salon: salon as SalonAFils };
}

/** Le membre fait-il partie du staff habilité sur ce ticket ? */
async function estStaff(
	guildId: string,
	membreRoles: readonly string[],
	pourLaDirection: boolean
): Promise<boolean> {
	const reglages = await reglagesDe(guildId);
	const habilites = pourLaDirection
		? reglages.tickets.rolesDirection
		: [...reglages.tickets.rolesStaff, ...reglages.tickets.rolesDirection];
	return habilites.some((roleId) => membreRoles.includes(roleId));
}

/** Carte d'accueil déposée dans le fil au moment de l'ouverture. */
function carteAccueil(ticket: Ticket): ReturnType<typeof creerEmbed> {
	const categorie = categorieDe(ticket);
	const embed = creerEmbed({
		description: [
			ticket.sujet ? `**${ticket.sujet}**\n` : null,
			categorie?.description ?? null,
			"\nDécris ta demande ici. Le staff répond dans ce fil.",
			"`/ticket fermer` le clôt — le fil reste lisible ensuite, il n'est jamais supprimé.",
		]
			.filter(Boolean)
			.join("\n"),
		icone: "ticket",
		titre: `Ticket ${referenceTicket(ticket.numero)} — ${libelleCategorieTicket(ticket.categorie)}`,
	});
	return pied(embed, { note: `Ouvert par le membre · ${libelleEtatTicket(ticket.statut)}` });
}

/** Boutons du fil : prendre en charge, fermer. */
function boutonsDuFil(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(identifiantComposant("prendre"))
			.setEmoji("🙋")
			.setLabel("Prendre en charge")
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(identifiantComposant("fermer"))
			.setEmoji("🔒")
			.setLabel("Fermer")
			.setStyle(ButtonStyle.Secondary)
	);
}

/**
 * Ouvre effectivement un ticket. Chemin commun à la commande et au bouton.
 *
 * Rend le message à afficher : les deux appelantes n'ont pas le même mode de
 * réponse (l'une a différé en éphémère, l'autre répond à une fenêtre modale).
 */
async function ouvrir(
	interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
	categorieCle: string,
	sujetBrut: string | null
): Promise<{ ok: true; fil: ThreadChannel; ticket: Ticket } | { ok: false; message: string }> {
	const guildId = interaction.guildId;
	if (!guildId || !interaction.guild) {
		return { message: HORS_GUILDE, ok: false };
	}

	// Les fils supprimés ne se ferment pas tout seuls en base : sans ce passage,
	// un ticket dont le fil a disparu mure son auteur pour toujours.
	const dejaOuverts = await reconcilierTicketsOuverts(
		interaction.guild,
		await ticketsOuvertsDe(guildId, interaction.user.id)
	);
	const verification = verifierOuverture(
		categorieCle,
		sujetBrut,
		dejaOuverts.map((ticket) => ticket.salonId)
	);
	if (!verification.ok) {
		return {
			message: verification.salonExistant
				? `${verification.erreur}\n<#${verification.salonExistant}>`
				: verification.erreur,
			ok: false,
		};
	}

	const reglages = await reglagesDe(guildId);
	const manque = manqueDeConfiguration(verification.categorie, {
		rolesDirection: reglages.tickets.rolesDirection,
		rolesStaff: reglages.tickets.rolesStaff,
	});
	if (manque) {
		return { message: manque, ok: false };
	}

	const panneau = await salonPanneauDe(interaction);
	if ("erreur" in panneau) {
		return { message: panneau.erreur, ok: false };
	}

	const { fil, ticket } = await ouvrirTicket({
		auteurId: interaction.user.id,
		categorie: verification.categorie,
		guilde: interaction.guild,
		rolesDirection: reglages.tickets.rolesDirection,
		rolesStaff: reglages.tickets.rolesStaff,
		salonPanneau: panneau.salon,
		sujet: verification.sujet,
	});

	await fil
		.send({ components: [boutonsDuFil()], embeds: [carteAccueil(ticket)] })
		.catch((err: unknown) =>
			console.warn("[tickets] accueil non posé :", err instanceof Error ? err.message : err)
		);

	return { fil, ok: true, ticket };
}

@Discord()
@SlashGroup({ description: "Ouvrir et suivre un ticket d'assistance", name: "ticket" })
@SlashGroup("ticket")
export class TicketCommand {
	@Slash({ description: "Ouvrir un ticket auprès du staff", name: "ouvrir" })
	async ouvrirCommande(
		@SlashChoice(
			...CATEGORIES_TICKET.map((categorie) => ({
				name: `${categorie.emoji} ${categorie.libelle}`,
				value: categorie.cle,
			}))
		)
		@SlashOption({
			description: "De quoi veux-tu parler ?",
			name: "categorie",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		categorieCle: string,
		@SlashOption({
			description: "En une phrase — c'est le nom que portera ton ticket",
			maxLength: LONGUEUR_SUJET,
			name: "sujet",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		sujet: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		try {
			const resultat = await ouvrir(interaction, categorieCle, sujet ?? null);
			if (!resultat.ok) {
				await repondre(interaction, attention("Ticket non ouvert", resultat.message, { prive: true }));
				return;
			}
			await repondre(
				interaction,
				succes(
					`Ticket ${referenceTicket(resultat.ticket.numero)} ouvert`,
					`Continue dans ${resultat.fil.toString()}.`,
					{ prive: true }
				)
			);
		} catch (err) {
			await repondre(
				interaction,
				echec("Ouverture impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Fermer le ticket de ce fil, avec son motif", name: "fermer" })
	async fermer(
		@SlashOption({
			description: "Problème + solution, en une phrase — obligatoire",
			maxLength: LONGUEUR_MOTIF,
			minLength: 3,
			name: "motif",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		motifBrut: string,
		interaction: ChatInputCommandInteraction
	) {
		await differer(interaction);
		try {
			const ticket = await ticketDuSalon(interaction.channelId);
			if (!ticket) {
				await repondre(
					interaction,
					attention(
						"Pas un ticket",
						"Cette commande se lance DANS le fil du ticket à fermer.",
						{ prive: true }
					)
				);
				return;
			}
			if (!transitionPermise(ticket.statut, "ferme")) {
				await repondre(
					interaction,
					attention("Fermeture impossible", refusTransition(ticket.statut, "ferme"), { prive: true })
				);
				return;
			}

			const motif = motifPropre(motifBrut);
			if (!motif) {
				await repondre(
					interaction,
					echec("Motif vide", "La consigne du staff est claire : toujours fermer avec un motif.")
				);
				return;
			}

			// L'auteur peut fermer son propre ticket ; le staff peut fermer n'importe
			// lequel. Personne d'autre — un fil privé n'est pas censé accueillir un
			// tiers, mais la garde est écrite quand même.
			const categorie = categorieDe(ticket);
			const roles = interaction.member?.roles;
			const listeRoles = Array.isArray(roles)
				? roles
				: roles && "cache" in roles
					? [...roles.cache.keys()]
					: [];
			const autorise =
				ticket.auteurId === interaction.user.id ||
				(await estStaff(ticket.guildId, listeRoles, categorie?.pourLaDirection ?? false));
			if (!autorise) {
				await repondre(
					interaction,
					attention("Pas à toi", "Seuls l'auteur du ticket et le staff peuvent le fermer.", {
						prive: true,
					})
				);
				return;
			}

			const ferme = await fermerTicket(ticket.id, interaction.user.id, motif);
			if (!ferme) {
				await repondre(interaction, attention("Déjà fermé", "Quelqu'un a été plus rapide.", { prive: true }));
				return;
			}

			const fil = interaction.channel?.isThread() ? (interaction.channel as ThreadChannel) : null;
			await publierFermeture({
				client: interaction.client,
				fermePar: interaction.user.id,
				guildId: ferme.guildId,
				motif,
				ticket: ferme,
				urlFil: fil?.url ?? null,
			});

			await interaction.editReply({
				embeds: [
					pied(
						creerEmbed({
							description: `**Motif** ${motif}\n\nCe fil reste lisible : il est archivé, pas supprimé.`,
							icone: "ticket",
							intention: "succes",
							titre: `Ticket ${referenceTicket(ferme.numero)} fermé`,
						}),
						{ note: "une carte est partie dans l'historique" }
					),
				],
			});

			if (fil) {
				await clore(fil, `Fermé par ${interaction.user.tag} — ${motif}`);
			}
		} catch (err) {
			await repondre(
				interaction,
				echec("Fermeture impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Prendre en charge le ticket de ce fil (staff)", name: "prendre" })
	async prendre(interaction: ChatInputCommandInteraction) {
		await differer(interaction);
		await basculerPriseEnCharge(interaction, "prendre");
	}

	@Slash({ description: "Rendre le ticket de ce fil au staff (staff)", name: "rendre" })
	async rendre(interaction: ChatInputCommandInteraction) {
		await differer(interaction);
		await basculerPriseEnCharge(interaction, "rendre");
	}

	@Slash({ description: "L'état du ticket de ce fil", name: "info" })
	async infoTicket(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		try {
			const ticket = await ticketDuSalon(interaction.channelId);
			if (!ticket) {
				await repondre(
					interaction,
					vide("Pas un ticket", "Cette commande se lance dans le fil d'un ticket.")
				);
				return;
			}
			const carte = fiche({
				icone: "ticket",
				titre: `Ticket ${referenceTicket(ticket.numero)}`,
			});
			carte
				.champ("État", libelleEtatTicket(ticket.statut), { enLigne: true })
				.champ("Catégorie", libelleCategorieTicket(ticket.categorie), { enLigne: true })
				.champ("Ouvert par", `<@${ticket.auteurId}>`, { enLigne: true })
				.champ("Ouvert", ilYA(ticket.ouvertLe), { enLigne: true })
				.champ("Pris par", ticket.prisPar ? `<@${ticket.prisPar}>` : "personne", { enLigne: true })
				.champ("Sujet", ticket.sujet ?? "—");
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Ticket illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Les tickets encore ouverts (staff)", name: "liste" })
	async liste(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}
		try {
			const roles = interaction.member?.roles;
			const listeRoles = Array.isArray(roles)
				? roles
				: roles && "cache" in roles
					? [...roles.cache.keys()]
					: [];
			if (!(await estStaff(guildId, listeRoles, false))) {
				await repondre(
					interaction,
					attention("Réservé au staff", "Cette liste nomme des demandes d'autres membres.", {
						prive: true,
					})
				);
				return;
			}

			const [ouverts, compte] = await Promise.all([
				ticketsOuverts(guildId),
				compterTickets(guildId),
			]);
			if (ouverts.length === 0) {
				await repondre(
					interaction,
					vide("Aucun ticket ouvert", `${compte.ferme} ticket(s) fermé(s) au total.`)
				);
				return;
			}
			const carte = fiche({
				description: ouverts
					.map(
						(ticket) =>
							`${libelleEtatTicket(ticket.statut)} **${referenceTicket(ticket.numero)}** ` +
							`<#${ticket.salonId}> · ${libelleCategorieTicket(ticket.categorie)} · ${ilYA(ticket.ouvertLe)}`
					)
					.join("\n"),
				icone: "ticket",
				titre: `${ouverts.length} ticket(s) ouvert(s)`,
			});
			carte.champ(
				"Total",
				`${compte.ouvert} en attente · ${compte.pris} pris en charge · ${compte.ferme} fermés`
			);
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Liste illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}

/** Prise en charge / restitution — même garde, deux sens. */
async function basculerPriseEnCharge(
	interaction: ChatInputCommandInteraction,
	sens: "prendre" | "rendre"
): Promise<void> {
	try {
		const ticket = await ticketDuSalon(interaction.channelId);
		if (!ticket) {
			await repondre(
				interaction,
				attention("Pas un ticket", "Cette commande se lance dans le fil d'un ticket.", {
					prive: true,
				})
			);
			return;
		}
		const vers = sens === "prendre" ? "pris" : "ouvert";
		if (!transitionPermise(ticket.statut, vers)) {
			await repondre(
				interaction,
				attention("Impossible", refusTransition(ticket.statut, vers), { prive: true })
			);
			return;
		}

		const categorie = categorieDe(ticket);
		const roles = interaction.member?.roles;
		const listeRoles = Array.isArray(roles)
			? roles
			: roles && "cache" in roles
				? [...roles.cache.keys()]
				: [];
		if (!(await estStaff(ticket.guildId, listeRoles, categorie?.pourLaDirection ?? false))) {
			await repondre(
				interaction,
				attention(
					"Réservé au staff",
					categorie?.pourLaDirection
						? "Ce ticket est réservé à la direction : elle seule le prend en charge."
						: "Seuls les rôles de prise en charge peuvent le faire.",
					{ prive: true }
				)
			);
			return;
		}

		const apres =
			sens === "prendre"
				? await prendreTicket(ticket.id, interaction.user.id)
				: await rendreTicket(ticket.id);
		if (!apres) {
			await repondre(interaction, attention("Trop tard", "L'état a changé entre-temps.", { prive: true }));
			return;
		}

		await interaction.editReply({
			embeds: [
				pied(
					creerEmbed({
						description:
							sens === "prendre"
								? `${interaction.user.toString()} prend ce ticket en charge.`
								: `${interaction.user.toString()} rend ce ticket au staff.`,
						icone: "ticket",
						intention: sens === "prendre" ? "succes" : "attention",
						titre: `Ticket ${referenceTicket(apres.numero)} — ${libelleEtatTicket(apres.statut)}`,
					}),
					{ note: null }
				),
			],
		});
	} catch (err) {
		await repondre(
			interaction,
			echec("Action impossible", err instanceof Error ? err.message : String(err))
		);
	}
}

/**
 * Les composants du panneau et des fils.
 *
 * Ce module ne déclare aucune commande de plus, mais discordx doit l'importer
 * pour que ses boutons répondent — c'est le même mécanisme que
 * `commands/validation-annonce.ts`.
 */
@Discord()
export class TicketComposants {
	/** Bouton d'ouverture du panneau : ouvre une fenêtre pour le sujet. */
	@ButtonComponent({ id: /^ticket:ouvrir:/ })
	async surOuvrir(interaction: ButtonInteraction) {
		const composant = lireComposant(interaction.customId);
		const categorie = composant?.argument ? categorieTicket(composant.argument) : null;
		if (!categorie) {
			await interaction.reply({
				content: "Ce bouton pointe vers une catégorie qui n'existe plus. Utilise `/ticket ouvrir`.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const fenetre = new ModalBuilder()
			.setCustomId(identifiantFenetre(categorie.cle))
			.setTitle(`Ticket — ${categorie.libelle}`.slice(0, 45))
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("sujet")
						.setLabel("En une phrase")
						.setMaxLength(LONGUEUR_SUJET)
						.setPlaceholder(categorie.description.slice(0, 100))
						.setRequired(true)
						.setStyle(TextInputStyle.Short)
				)
			);
		await interaction.showModal(fenetre);
	}

	/** Retour de la fenêtre : c'est ici que le ticket naît vraiment. */
	@ModalComponent({ id: /^ticket:ouvrir:/ })
	async surFenetre(interaction: ModalSubmitInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const composant = lireComposant(interaction.customId);
		try {
			const resultat = await ouvrir(
				interaction,
				composant?.argument ?? "",
				interaction.fields.getTextInputValue("sujet")
			);
			if (!resultat.ok) {
				await interaction.editReply(
					attention("Ticket non ouvert", resultat.message, { prive: true })
				);
				return;
			}
			await interaction.editReply(
				succes(
					`Ticket ${referenceTicket(resultat.ticket.numero)} ouvert`,
					`Continue dans ${resultat.fil.toString()}.`,
					{ prive: true }
				)
			);
		} catch (err) {
			await interaction.editReply(
				echec("Ouverture impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@ButtonComponent({ id: "ticket:prendre" })
	async surPrendre(interaction: ButtonInteraction) {
		await interaction.deferReply();
		await basculerParBouton(interaction, "prendre");
	}

	/**
	 * Bouton « Fermer » : il demande le motif, il ne ferme pas tout de suite.
	 *
	 * Un bouton qui ferme au clic produit exactement ce que l'historique de
	 * `ticketsbot` montre — « No reason specified ». La fenêtre est le seul
	 * moyen d'exiger le motif sans transformer le bouton en commande.
	 */
	@ButtonComponent({ id: "ticket:fermer" })
	async surFermer(interaction: ButtonInteraction) {
		const fenetre = new ModalBuilder()
			.setCustomId(identifiantComposant("confirmer"))
			.setTitle("Fermer le ticket")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("motif")
						.setLabel("Motif — problème et solution")
						.setMaxLength(LONGUEUR_MOTIF)
						.setPlaceholder("Ce qui était demandé, ce qui a été fait.")
						.setRequired(true)
						.setStyle(TextInputStyle.Paragraph)
				)
			);
		await interaction.showModal(fenetre);
	}

	@ModalComponent({ id: "ticket:confirmer" })
	async surConfirmation(interaction: ModalSubmitInteraction) {
		await interaction.deferReply();
		try {
			const ticket = await ticketDuSalon(interaction.channelId ?? "");
			if (!ticket) {
				await interaction.editReply(
					attention("Pas un ticket", "Ce fil n'est rattaché à aucun ticket.", { prive: true })
				);
				return;
			}
			const motif = motifPropre(interaction.fields.getTextInputValue("motif"));
			if (!motif) {
				await interaction.editReply(echec("Motif vide", "Toujours fermer avec un motif."));
				return;
			}
			if (!transitionPermise(ticket.statut, "ferme")) {
				await interaction.editReply(
					attention("Fermeture impossible", refusTransition(ticket.statut, "ferme"), { prive: true })
				);
				return;
			}

			const ferme = await fermerTicket(ticket.id, interaction.user.id, motif);
			if (!ferme) {
				await interaction.editReply(
					attention("Déjà fermé", "Quelqu'un a été plus rapide.", { prive: true })
				);
				return;
			}

			const fil = interaction.channel?.isThread() ? (interaction.channel as ThreadChannel) : null;
			await publierFermeture({
				client: interaction.client,
				fermePar: interaction.user.id,
				guildId: ferme.guildId,
				motif,
				ticket: ferme,
				urlFil: fil?.url ?? null,
			});
			await interaction.editReply({
				embeds: [
					pied(
						creerEmbed({
							description: `**Motif** ${motif}\n\nCe fil reste lisible : il est archivé, pas supprimé.`,
							icone: "ticket",
							intention: "succes",
							titre: `Ticket ${referenceTicket(ferme.numero)} fermé`,
						}),
						{ note: null }
					),
				],
			});
			if (fil) {
				await clore(fil, `Fermé par ${interaction.user.tag} — ${motif}`);
			}
		} catch (err) {
			await interaction.editReply(
				echec("Fermeture impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}

/** Prise en charge depuis un bouton — même règle que la commande. */
async function basculerParBouton(
	interaction: ButtonInteraction,
	sens: "prendre" | "rendre"
): Promise<void> {
	try {
		const ticket = await ticketDuSalon(interaction.channelId);
		if (!ticket) {
			await interaction.editReply(
				attention("Pas un ticket", "Ce fil n'est rattaché à aucun ticket.", { prive: true })
			);
			return;
		}
		const vers = sens === "prendre" ? "pris" : "ouvert";
		if (!transitionPermise(ticket.statut, vers)) {
			await interaction.editReply(
				attention("Impossible", refusTransition(ticket.statut, vers), { prive: true })
			);
			return;
		}
		const categorie = categorieDe(ticket);
		const roles = interaction.member?.roles;
		const listeRoles = Array.isArray(roles)
			? roles
			: roles && "cache" in roles
				? [...roles.cache.keys()]
				: [];
		if (!(await estStaff(ticket.guildId, listeRoles, categorie?.pourLaDirection ?? false))) {
			await interaction.editReply(
				attention("Réservé au staff", "Seuls les rôles de prise en charge peuvent le faire.", {
					prive: true,
				})
			);
			return;
		}
		const apres = await prendreTicket(ticket.id, interaction.user.id);
		if (!apres) {
			await interaction.editReply(attention("Trop tard", "L'état a changé entre-temps.", { prive: true }));
			return;
		}
		await interaction.editReply({
			embeds: [
				pied(
					creerEmbed({
						description: `${interaction.user.toString()} prend ce ticket en charge.`,
						icone: "ticket",
						intention: "succes",
						titre: `Ticket ${referenceTicket(apres.numero)} — ${libelleEtatTicket(apres.statut)}`,
					}),
					{ note: null }
				),
			],
		});
	} catch (err) {
		await interaction.editReply(
			echec("Action impossible", err instanceof Error ? err.message : String(err))
		);
	}
}

/** Le panneau public — exporté pour que `/gestion ticket panneau` le publie. */
export function construirePanneau(): {
	embeds: Array<ReturnType<typeof creerEmbed>>;
	components: Array<ActionRowBuilder<ButtonBuilder>>;
} {
	const embed = creerEmbed({
		description: `Besoin du staff ? Choisis la porte qui correspond. Un **fil privé** s'ouvre, visible de toi et du staff concerné, et de personne d'autre.\n\n${CATEGORIES_TICKET.map(
			(categorie) => `${categorie.emoji} **${categorie.libelle}** — ${categorie.description}`
		).join("\n")}`,
		icone: "ticket",
		titre: "Ouvrir un ticket",
	});
	pied(embed, { note: "un seul ticket ouvert à la fois · le fil reste lisible après fermeture" });

	const rangee = new ActionRowBuilder<ButtonBuilder>().addComponents(
		CATEGORIES_TICKET.map((categorie) =>
			new ButtonBuilder()
				.setCustomId(identifiantComposant("ouvrir", categorie.cle))
				.setEmoji(categorie.emoji)
				.setLabel(categorie.libelle)
				.setStyle(categorie.sensible ? ButtonStyle.Danger : ButtonStyle.Secondary)
		)
	);
	return { components: [rangee], embeds: [embed] };
}
