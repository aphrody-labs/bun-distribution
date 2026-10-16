/**
 * `/sondage` — les sondages du serveur, dans le serveur.
 *
 *  - `/sondage liste` : navigation paginée, filtrable par état et par période ;
 *  - `/sondage voir`  : question, choix, barres de résultat et total.
 *
 * Les sondages sont extraits par le cron, rangés dans `discord_polls` /
 * `discord_poll_options` et publiés sur `rosegriffon.fr/sondages`. Jusqu'ici le
 * serveur d'où ils viennent n'y avait pas accès : ces deux sous-commandes
 * rendent l'archive consultable là où elle a été produite.
 *
 * ─── LIGNE ROUGE — VIE PRIVÉE ───────────────────────────────────────────────
 * Seuls des DÉCOMPTES AGRÉGÉS sont lus : voix par choix, total des votes, nombre
 * de participants. Le rattachement d'un membre à son choix n'est ni lu, ni
 * joint, ni compté, ni nommé — la table qui le porte n'apparaît nulle part dans
 * cette unité, et un contrôle mécanique (`lib/sondage-format.test.ts`) le
 * vérifie par balayage des fichiers. Aucun croisement par rôle non plus : sur un
 * serveur de quelques dizaines de comptes actifs, il ré-identifierait.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ ESTIMATION vs RÉSULTAT OFFICIEL. La colonne `discord_polls.source` distingue
 * les décomptes lus dans l'encart du bot (`embed`, chiffres officiels) de ceux
 * RECONSTITUÉS depuis les réactions archivées du salon (`reactions`, ± 1 vote).
 * Mesuré le 13/8/2026 : 26 sondages `embed`, 25 `reactions`. La moitié du
 * corpus est donc une estimation, et l'embed le dit en toutes lettres.
 *
 * ⚠ RLS TRANSCRITE EN SQL. `lib/db.ts` se connecte en service-role, donc HORS
 * RLS. La policy publique n'expose un sondage que si son salon est `suivi` :
 * cette jointure doit figurer EXPLICITEMENT dans chaque requête, sinon le bot
 * publierait des sondages qu'un visiteur du site ne verrait pas.
 */
import {
	ButtonComponent,
	Discord,
	Slash,
	SlashChoice,
	SlashGroup,
	SlashOption,
} from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	type AutocompleteInteraction,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type InteractionEditReplyOptions,
} from "discord.js";

import { cached } from "../lib/cache";
import { RG_BASE_URL } from "../lib/config";
import { sql } from "../lib/db";
import { rgEmbed, truncate } from "../lib/embeds";
import {
	aDesResultats,
	bornerPage,
	classement,
	couper,
	decoderEtatSondages,
	echapperMarkdown,
	encoderEtatSondages,
	estIdentifiantSondage,
	formaterNombre,
	gagnant,
	horodatageDate,
	libelleChoixAutorises,
	libelleEtat,
	libelleParticipation,
	libelleStatut,
	lienMessageSondage,
	ligneListeSondage,
	ligneResultat,
	mentionSource,
	nombreDePages,
	normaliserPeriode,
	normaliserSondage,
	normaliserStatut,
	PERIODES_RELATIVES,
	pourcentage,
	texteTitre,
	type EtatListeSondages,
	type LigneSondage,
	type Sondage,
	type StatutSondage,
} from "../lib/sondage-format";
import { echec, pied, repondre } from "../lib/ui";

/** Sondages par page de liste : cinq tiennent largement dans une description. */
const PAR_PAGE = 5;

/** Choix détaillés au maximum dans `/sondage voir` (limite dure : 25 champs). */
const CHOIX_MAX = 12;

const TTL_ANNEES_MS = 30 * 60_000;
const TTL_QUESTIONS_MS = 5 * 60_000;

/*
 * Colonnes lues, énumérées. `p.*` serait fragile : une colonne ajoutée demain
 * ne doit pas se retrouver publiée par accident.
 */
const COLONNES = `
	p.poll_id, p.provider, p.source, p.language, p.message_id, p.channel_id, p.guild_id,
	p.question, p.creator_username, p.command, p.max_choices, p.locked, p.ended,
	p.ends_at, p.created_at, p.total_votes, p.total_voters, p.results_hidden,
	p.visual_path, p.visual_width, p.visual_height, p.visual_alt
`;

/*
 * Les choix sont agrégés en JSON dans le même aller-retour : une page de cinq
 * sondages ne fait pas six requêtes.
 */
const CHOIX_AGREGES = `
	(SELECT jsonb_agg(
		jsonb_build_object(
			'position', o.position, 'emoji', o.emoji, 'label', o.label,
			'votes', o.votes, 'percentage', o.percentage
		) ORDER BY o.position)
	 FROM public.discord_poll_options o
	 WHERE o.poll_id = p.poll_id) AS options
`;

interface PageSondages {
	sondages: Sondage[];
	total: number;
	page: number;
}

/**
 * Page de sondages, filtrée par statut, période et texte de la question.
 *
 * `%` et `_` sont des jokers ILIKE : une recherche « 100_% » ne doit pas se
 * transformer en motif, d'où l'échappement avant bornage.
 */
async function listerSondages(etat: EtatListeSondages): Promise<PageSondages> {
	const statut = normaliserStatut(etat.statut);
	const periode = normaliserPeriode(etat.periode);
	const brut = etat.recherche?.trim() ?? "";
	const motif = brut.length > 0 ? `%${brut.slice(0, 120).replace(/[\\%_]/g, "\\$&")}%` : null;
	const page = Math.max(1, Math.trunc(etat.page));
	const decalage = (page - 1) * PAR_PAGE;

	const [total] = await sql<Array<{ total: number }>>`
		SELECT count(*)::int AS total
		FROM public.discord_polls p
		JOIN public.discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
		WHERE (${motif}::text IS NULL OR p.question ILIKE ${motif})
		  AND (${periode.depuis}::timestamptz IS NULL OR p.created_at >= ${periode.depuis})
		  AND (${periode.jusqua}::timestamptz IS NULL OR p.created_at < ${periode.jusqua})
		  AND (${statut}::text = 'tous'
		       OR (${statut}::text = 'en-cours' AND p.ended = false AND p.ends_at IS NOT NULL)
		       OR (${statut}::text = 'termines' AND p.ended = true)
		       OR (${statut}::text = 'etat-inconnu' AND p.ended = false AND p.ends_at IS NULL))
	`;

	const lignes = await sql<LigneSondage[]>`
		SELECT ${sql.unsafe(COLONNES)}, ${sql.unsafe(CHOIX_AGREGES)}
		FROM public.discord_polls p
		JOIN public.discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
		WHERE (${motif}::text IS NULL OR p.question ILIKE ${motif})
		  AND (${periode.depuis}::timestamptz IS NULL OR p.created_at >= ${periode.depuis})
		  AND (${periode.jusqua}::timestamptz IS NULL OR p.created_at < ${periode.jusqua})
		  AND (${statut}::text = 'tous'
		       OR (${statut}::text = 'en-cours' AND p.ended = false AND p.ends_at IS NOT NULL)
		       OR (${statut}::text = 'termines' AND p.ended = true)
		       OR (${statut}::text = 'etat-inconnu' AND p.ended = false AND p.ends_at IS NULL))
		ORDER BY p.created_at DESC, p.poll_id
		LIMIT ${PAR_PAGE} OFFSET ${decalage}
	`;

	return {
		page,
		sondages: lignes.map((ligne) => normaliserSondage(ligne, RG_BASE_URL)),
		total: total?.total ?? 0,
	};
}

/** Un sondage précis, ou `null` (identifiant inconnu, ou salon non suivi). */
async function lireSondage(pollId: string): Promise<Sondage | null> {
	if (!estIdentifiantSondage(pollId)) {
		return null;
	}
	const lignes = await sql<LigneSondage[]>`
		SELECT ${sql.unsafe(COLONNES)}, ${sql.unsafe(CHOIX_AGREGES)}
		FROM public.discord_polls p
		JOIN public.discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
		WHERE p.poll_id = ${pollId}
		LIMIT 1
	`;
	const ligne = lignes[0];
	return ligne ? normaliserSondage(ligne, RG_BASE_URL) : null;
}

/** Années réellement présentes dans l'archive — alimente l'autocomplétion. */
async function anneesConnues(): Promise<number[]> {
	return cached("sondages:annees", TTL_ANNEES_MS, async () => {
		const lignes = await sql<Array<{ an: number }>>`
			SELECT DISTINCT date_part('year', p.created_at)::int AS an
			FROM public.discord_polls p
			JOIN public.discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
			ORDER BY an DESC
		`;
		return lignes.map((ligne) => ligne.an);
	});
}

/** Questions connues — alimente l'autocomplétion de `/sondage voir`. */
async function questionsConnues(): Promise<Array<{ poll_id: string; question: string }>> {
	return cached("sondages:questions", TTL_QUESTIONS_MS, async () => {
		return sql<Array<{ poll_id: string; question: string }>>`
			SELECT p.poll_id, p.question
			FROM public.discord_polls p
			JOIN public.discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
			ORDER BY p.created_at DESC
			LIMIT 200
		`;
	});
}

/** Construit la réponse (embed + boutons) d'une page de liste. */
async function rendrePage(etat: EtatListeSondages): Promise<InteractionEditReplyOptions> {
	const premier = await listerSondages(etat);
	// Une page demandée au-delà de la dernière ne doit pas répondre « vide » :
	// on la ramène dans les bornes et on relit.
	const page = bornerPage(etat.page, premier.total, PAR_PAGE);
	const resultat = page === premier.page ? premier : await listerSondages({ ...etat, page });

	const periode = normaliserPeriode(etat.periode);
	const statut = normaliserStatut(etat.statut);
	const criteres = [
		statut === "tous" ? null : `état : ${libelleStatut(statut)}`,
		periode.cle === "tout" ? null : periode.libelle,
		etat.recherche ? `« ${etat.recherche} »` : null,
	]
		.filter((valeur): valeur is string => valeur !== null)
		.join(" · ");

	const pages = nombreDePages(resultat.total, PAR_PAGE);
	const embed = rgEmbed()
		.setTitle(
			`Sondages du serveur — ${formaterNombre(resultat.total)} ${resultat.total === 1 ? "sondage" : "sondages"}`
		)
		.setURL(`${RG_BASE_URL}/sondages`);
	if (criteres.length > 0) {
		embed.setAuthor({ name: `Filtres : ${truncate(criteres, 200)}` });
	}

	if (resultat.sondages.length === 0) {
		embed.setDescription("Aucun sondage ne correspond à ces filtres.");
	} else {
		const corps = resultat.sondages
			.map((sondage) => ligneListeSondage(sondage, RG_BASE_URL))
			.join("\n\n");
		const estimations = resultat.sondages.filter(
			(sondage) => sondage.source === "reactions"
		).length;
		const note =
			estimations > 0
				? `\n\n≈ ${estimations} ${estimations === 1 ? "décompte est une estimation" : "décomptes sont des estimations"} reconstituée${estimations === 1 ? "" : "s"} depuis les réactions archivées, pas un résultat officiel.`
				: "";
		embed.setDescription(truncate(`${corps}${note}`, 4096));
		pied(embed, { page: page, pages: pages });
	}

	const composants: Array<ActionRowBuilder<ButtonBuilder>> = [];
	const idPrecedent = encoderEtatSondages({ ...etat, page: page - 1 });
	const idSuivant = encoderEtatSondages({ ...etat, page: page + 1 });
	if (pages > 1 && idPrecedent && idSuivant) {
		composants.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(idPrecedent)
					.setLabel("Précédent")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page <= 1),
				new ButtonBuilder()
					.setCustomId(idSuivant)
					.setLabel("Suivant")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page >= pages)
			)
		);
	}
	return { components: composants, embeds: [embed] };
}

/**
 * Embed de détail d'un sondage.
 *
 * Les choix sont rendus dans la DESCRIPTION et non en champs : un champ est
 * limité à 1024 caractères et Discord en pose trois par ligne, ce qui casserait
 * l'alignement des barres. La description accepte 4096 caractères, largement de
 * quoi tenir douze choix.
 */
function rendreSondage(sondage: Sondage): InteractionEditReplyOptions {
	// Un titre d'embed ne rend ni markdown ni émoji personnalisé : `texteTitre`
	// ramène `<:IE_hey1:1089…>` à `:IE_hey1:` au lieu d'afficher l'identifiant.
	const embed = rgEmbed()
		.setTitle(truncate(texteTitre(sondage.question), 256))
		.setURL(`${RG_BASE_URL}/sondages/${sondage.pollId}`);

	const ordonnes = classement(sondage);
	const montres = ordonnes.slice(0, CHOIX_MAX);
	const reste = ordonnes.length - montres.length;
	const lignes = montres.map((option) => ligneResultat(option, sondage));
	if (reste > 0) {
		lignes.push(`*… et ${reste} autre${reste === 1 ? "" : "s"} choix, à voir sur le site.*`);
	}
	const mention = mentionSource(sondage);
	const corps = [
		lignes.join("\n"),
		mention,
		aDesResultats(sondage)
			? null
			: "*Ce sondage n'a jamais publié de décompte : aucun chiffre ne peut être affiché.*",
	]
		.filter((valeur): valeur is string => valeur !== null)
		.join("\n\n");
	embed.setDescription(truncate(corps, 4096));

	embed.addFields(
		{ inline: true, name: "État", value: libelleEtat(sondage) },
		{
			inline: true,
			name: "Participation",
			value: libelleParticipation(sondage) ?? "non publiée",
		},
		{ inline: true, name: "Règle de vote", value: libelleChoixAutorises(sondage) }
	);

	const meneur = gagnant(sondage);
	if (meneur) {
		embed.addFields({
			inline: false,
			name: "En tête",
			value: truncate(
				`${meneur.emoji ? `${meneur.emoji} ` : ""}${echapperMarkdown(couper(meneur.label, 200))} — ${formaterNombre(meneur.votes)} voix (${pourcentage(meneur, sondage).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)`,
				1024
			),
		});
	}

	const contexte: string[] = [`Ouvert le ${horodatageDate(sondage.createdAt)}`];
	if (sondage.endsAt) {
		contexte.push(`Clôture ${horodatageDate(sondage.endsAt)}`);
	}
	if (sondage.creatorUsername) {
		contexte.push(`Publié par ${echapperMarkdown(sondage.creatorUsername)}`);
	}
	const lien = lienMessageSondage(sondage);
	if (lien) {
		contexte.push(`[Message d'origine](${lien})`);
	}
	embed.addFields({ inline: false, name: "Contexte", value: truncate(contexte.join(" · "), 1024) });

	if (sondage.visuel) {
		embed.setImage(sondage.visuel.url);
	}
	pied(embed, {
		note: `${sondage.pollId} · ${sondage.source === "reactions" ? "décompte estimé" : "décompte publié par le bot"} · rosegriffon.fr`,
	});
	return { embeds: [embed] };
}

@Discord()
@SlashGroup({
	description: "Les sondages du serveur : archive, résultats et participation",
	name: "sondage",
})
@SlashGroup("sondage")
export class SondageCommand {
	@Slash({
		description: "Parcourt les sondages du serveur, filtrables par état et par période",
		name: "liste",
	})
	async liste(
		@SlashChoice(
			{ name: "Tous", value: "tous" },
			{ name: "En cours", value: "en-cours" },
			{ name: "Terminés", value: "termines" },
			{ name: "État non publié", value: "etat-inconnu" }
		)
		@SlashOption({
			description: "État du sondage",
			name: "etat",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		etat: string | undefined,
		@SlashOption({
			autocomplete: async (interaction: AutocompleteInteraction) => {
				try {
					const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
					const annees = await anneesConnues();
					const propositions = [
						{ name: "Toutes périodes", value: "tout" },
						...PERIODES_RELATIVES.map((entree) => ({
							name: entree.libelle,
							value: entree.cle,
						})),
						...annees.map((an) => ({ name: `Année ${an}`, value: String(an) })),
					];
					await interaction.respond(
						propositions.filter((entree) => entree.name.toLowerCase().includes(saisie)).slice(0, 25)
					);
				} catch {
					await interaction.respond([]);
				}
			},
			description: "Période (toutes, 30 jours, 12 mois, ou une année)",
			name: "periode",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		periode: string | undefined,
		@SlashOption({
			// Bornée à 120 caractères : c'est exactement ce que `listerSondages`
			// envoie à la base (le motif ILIKE est tronqué à 120). Sans cette borne,
			// l'embed annoncerait comme filtre une saisie dont seul le début a servi.
			description: "Texte à chercher dans la question",
			maxLength: 120,
			name: "recherche",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		recherche: string | undefined,
		@SlashOption({
			description: "Numéro de page",
			minValue: 1,
			name: "page",
			required: false,
			type: ApplicationCommandOptionType.Integer,
		})
		page: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		try {
			await interaction.editReply(
				await rendrePage({
					page: page ?? 1,
					periode: periode ?? "tout",
					recherche: recherche ?? null,
					statut: normaliserStatut(etat) as StatutSondage,
				})
			);
		} catch (err) {
			await repondre(
				interaction,
				echec("Lecture des sondages impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	/**
	 * Boutons de pagination. Tout l'état tient dans le `customId` : aucune
	 * mémoire de processus, donc un redémarrage du bot ne laisse pas de boutons
	 * morts derrière lui.
	 */
	@ButtonComponent({ id: /^sdg\|/ })
	async paginer(interaction: ButtonInteraction) {
		const etat = decoderEtatSondages(interaction.customId);
		if (!etat) {
			await interaction.reply({
				content: "Pagination illisible.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.deferUpdate();
		try {
			await interaction.editReply(await rendrePage(etat));
		} catch (err) {
			await interaction.followUp({
				content: `❌ ${err instanceof Error ? err.message : String(err)}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	@Slash({
		description: "Affiche un sondage : question, choix, barres de résultat et total",
		name: "voir",
	})
	async voir(
		@SlashOption({
			autocomplete: async (interaction: AutocompleteInteraction) => {
				try {
					const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
					const questions = await questionsConnues();
					await interaction.respond(
						questions
							.filter(
								(entree) =>
									entree.question.toLowerCase().includes(saisie) ||
									entree.poll_id.startsWith(saisie)
							)
							.slice(0, 25)
							.map((entree) => ({
								name: couper(entree.question, 100),
								value: entree.poll_id,
							}))
					);
				} catch {
					await interaction.respond([]);
				}
			},
			description: "Sondage (choisir dans la liste, ou coller son identifiant)",
			name: "sondage",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		identifiant: string,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		try {
			const sondage = await lireSondage(identifiant.trim().toLowerCase());
			if (!sondage) {
				await interaction.editReply({
					content: `Aucun sondage ne porte l'identifiant \`${truncate(identifiant, 40)}\`. Utilise \`/sondage liste\` pour le retrouver.`,
				});
				return;
			}
			await interaction.editReply(rendreSondage(sondage));
		} catch (err) {
			await repondre(
				interaction,
				echec("Lecture du sondage impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}
