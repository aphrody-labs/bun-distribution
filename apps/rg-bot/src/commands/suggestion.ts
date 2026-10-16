/**
 * `/suggestion` — la boîte à idées de la communauté.
 *
 * ── LE VOTE EST TENU PAR DISCORD, PAS PAR NOUS ─────────────────────────────
 * Le bot pose 👍 et 👎 sur chaque suggestion, et c'est tout : le registre de
 * qui a voté quoi reste chez Discord. Nous n'en lisons que les COMPTEURS, au
 * moment où le staff tranche. C'est la même ligne rouge que pour les sondages
 * (`lib/sondage-format.ts`) — la garantie ne repose pas sur notre discipline,
 * elle repose sur le fait que la donnée n'entre jamais en base.
 *
 * ── POURQUOI LA PROPOSITION EST PUBLIQUE ───────────────────────────────────
 * C'est la seule surface de ce bot dont la réponse publique est le but : une
 * suggestion est écrite pour être lue et votée par tout le serveur. Elle est
 * donc publiée dans le salon configuré — pas dans le salon où la commande a
 * été tapée, pour que la boîte reste un seul endroit.
 *
 * ── LE MOTIF DE DÉCISION EST OBLIGATOIRE ───────────────────────────────────
 * Une suggestion écartée sans raison est pire qu'une suggestion ignorée : elle
 * dit « non » à quelqu'un qui a pris le temps d'écrire, sans rien lui apprendre.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type ChatInputCommandInteraction,
	type Message,
	type TextBasedChannel,
} from "discord.js";

import { sql } from "../lib/db";
import { reglagesDe } from "../services/communaute";
import {
	intentionEtatSuggestion,
	libelleEtatSuggestion,
	libelleScore,
	LONGUEUR_SUGGESTION,
	prochainNumeroSuggestion,
	REACTION_CONTRE,
	REACTION_POUR,
	referenceSuggestion,
	score,
	validerProposition,
} from "../lib/suggestions";
import {
	attention,
	creerEmbed,
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

export interface Suggestion {
	id: number;
	guildId: string;
	numero: number;
	salonId: string;
	messageId: string | null;
	auteurId: string;
	texte: string;
	statut: string;
	decidePar: string | null;
	motif: string | null;
	creeLe: Date;
}

interface LigneSuggestion {
	id: string | number;
	guild_id: string;
	numero: number;
	salon_id: string;
	message_id: string | null;
	auteur_id: string;
	texte: string;
	statut: string;
	decide_par: string | null;
	motif: string | null;
	cree_le: Date;
}

export function versSuggestion(ligne: LigneSuggestion): Suggestion {
	return {
		auteurId: ligne.auteur_id,
		creeLe: ligne.cree_le,
		decidePar: ligne.decide_par,
		guildId: ligne.guild_id,
		id: Number(ligne.id),
		messageId: ligne.message_id,
		motif: ligne.motif,
		numero: ligne.numero,
		salonId: ligne.salon_id,
		statut: ligne.statut,
		texte: ligne.texte,
	};
}

export const COLONNES_SUGGESTION = sql`
	id, guild_id, numero, salon_id, message_id, auteur_id, texte, statut,
	decide_par, motif, cree_le
`;

export async function suggestionParNumero(
	guildId: string,
	numero: number
): Promise<Suggestion | null> {
	const lignes = await sql<LigneSuggestion[]>`
		SELECT ${COLONNES_SUGGESTION} FROM bot_suggestions
		 WHERE guild_id = ${guildId} AND numero = ${numero} LIMIT 1
	`;
	const ligne = lignes[0];
	return ligne ? versSuggestion(ligne) : null;
}

/**
 * L'embed d'une suggestion, dans l'état où elle est.
 *
 * Exporté : la commande de décision réécrit le MÊME message plutôt que d'en
 * poster un nouveau — sans quoi le salon accumule deux messages par suggestion
 * et le vote reste attaché à un message périmé.
 */
export function composerSuggestion(
	suggestion: Suggestion,
	options: { resultat?: string | null } = {}
): ReturnType<typeof creerEmbed> {
	const embed = creerEmbed({
		description: suggestion.texte,
		contexte: `Suggestion ${referenceSuggestion(suggestion.numero)} · ${libelleEtatSuggestion(suggestion.statut)}`,
		icone: "sondage",
		intention: intentionEtatSuggestion(suggestion.statut),
		titre: `Suggestion ${referenceSuggestion(suggestion.numero)}`,
	});
	embed.addFields({ name: "Proposée par", value: `<@${suggestion.auteurId}>`, inline: true });
	if (options.resultat) {
		embed.addFields({ name: "Vote", value: options.resultat, inline: true });
	}
	if (suggestion.motif) {
		embed.addFields({
			name: suggestion.statut === "refusee" ? "Pourquoi c'est écarté" : "Réponse du staff",
			value: suggestion.motif,
		});
	}
	if (suggestion.decidePar) {
		embed.addFields({ name: "Tranché par", value: `<@${suggestion.decidePar}>`, inline: true });
	}
	return pied(embed, {
		note:
			suggestion.statut === "ouverte"
				? `${REACTION_POUR} pour · ${REACTION_CONTRE} contre`
				: "décision du staff",
	});
}

/** Lit les compteurs de réactions d'un message de suggestion. */
export function lireScore(message: Message): ReturnType<typeof score> {
	const pour = message.reactions.cache.get(REACTION_POUR)?.count ?? 0;
	const contre = message.reactions.cache.get(REACTION_CONTRE)?.count ?? 0;
	return score(pour, contre);
}

@Discord()
@SlashGroup({ description: "Proposer une idée à la communauté", name: "suggestion" })
@SlashGroup("suggestion")
export class SuggestionCommand {
	@Slash({ description: "Proposer une idée", name: "proposer" })
	async proposer(
		@SlashOption({
			description: "Ce que tu proposes, et pourquoi",
			maxLength: LONGUEUR_SUGGESTION,
			minLength: 12,
			name: "idee",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		idee: string,
		interaction: ChatInputCommandInteraction
	) {
		// Éphémère : c'est la SUGGESTION qui est publique, pas la confirmation.
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(
				interaction,
				echec("Hors serveur", "Une suggestion s'adresse à une communauté.")
			);
			return;
		}

		const validation = validerProposition(idee);
		if (!validation.ok) {
			await repondre(interaction, attention("Suggestion refusée", validation.erreur, { prive: true }));
			return;
		}

		try {
			const reglages = await reglagesDe(guildId);
			const salonId = reglages.suggestions.salon;
			if (!reglages.suggestions.actif || !salonId) {
				await repondre(
					interaction,
					echec(
						"Boîte à suggestions fermée",
						"Aucun salon de suggestions n'est configuré. Le staff l'ouvre avec `/gestion suggestion salon`."
					)
				);
				return;
			}
			const salon = (await interaction.client.channels
				.fetch(salonId)
				.catch(() => null)) as TextBasedChannel | null;
			if (!salon || !("send" in salon)) {
				await repondre(
					interaction,
					echec("Salon illisible", `Le salon configuré (\`${salonId}\`) est introuvable.`)
				);
				return;
			}

			// La ligne d'abord, pour son numéro : c'est la contrainte d'unicité qui
			// tranche en cas de propositions simultanées.
			const [dernier] = await sql<Array<{ numero: number | null }>>`
				SELECT max(numero) AS numero FROM bot_suggestions WHERE guild_id = ${guildId}
			`;
			const numero = prochainNumeroSuggestion(dernier?.numero ?? null);
			const [ligne] = await sql<LigneSuggestion[]>`
				INSERT INTO bot_suggestions (guild_id, numero, salon_id, auteur_id, texte)
				VALUES (${guildId}, ${numero}, ${salonId}, ${interaction.user.id}, ${validation.texte})
				RETURNING ${COLONNES_SUGGESTION}
			`;
			if (!ligne) {
				await repondre(
					interaction,
					echec("Suggestion non enregistrée", "Réessaie : le numéro n'a pas pu être réservé.")
				);
				return;
			}
			const suggestion = versSuggestion(ligne);

			const message = await salon.send({
				// Le salon reçoit la suggestion, pas une notification : personne n'est
				// mentionné, pas même l'auteur.
				allowedMentions: { parse: [] },
				embeds: [composerSuggestion(suggestion)],
			});
			await sql`
				UPDATE bot_suggestions SET message_id = ${message.id}, maj_le = NOW()
				 WHERE id = ${suggestion.id}
			`;

			// Les deux réactions amorcent le vote. Elles comptent le bot : `score()`
			// le retire.
			await message.react(REACTION_POUR).catch(() => undefined);
			await message.react(REACTION_CONTRE).catch(() => undefined);

			await repondre(
				interaction,
				succes(
					`Suggestion ${referenceSuggestion(numero)} publiée`,
					`${message.url}\nLe vote se fait avec ${REACTION_POUR} et ${REACTION_CONTRE}.`,
					{ prive: true }
				)
			);
		} catch (err) {
			await repondre(
				interaction,
				echec("Publication impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Les suggestions en cours de vote", name: "liste" })
	async liste(
		@SlashOption({
			description: "Nombre de suggestions (10 par défaut)",
			maxValue: 25,
			minValue: 1,
			name: "nombre",
			required: false,
			type: ApplicationCommandOptionType.Integer,
		})
		nombre: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", "Les suggestions vivent sur un serveur."));
			return;
		}
		try {
			const lignes = await sql<LigneSuggestion[]>`
				SELECT ${COLONNES_SUGGESTION} FROM bot_suggestions
				 WHERE guild_id = ${guildId} AND statut = 'ouverte'
				 ORDER BY cree_le DESC
				 LIMIT ${Math.min(25, Math.max(1, Math.floor(nombre ?? 10)))}
			`;
			if (lignes.length === 0) {
				await repondre(
					interaction,
					vide("Aucune suggestion en vote", "`/suggestion proposer` en ouvre une.")
				);
				return;
			}
			const carte = fiche({
				icone: "sondage",
				titre: `${lignes.length} suggestion(s) en vote`,
			});
			carte.bloc(
				"En cours",
				lignes
					.map((ligne) => {
						const suggestion = versSuggestion(ligne);
						const lien = suggestion.messageId
							? `https://discord.com/channels/${guildId}/${suggestion.salonId}/${suggestion.messageId}`
							: null;
						const titre = suggestion.texte.split("\n")[0] ?? suggestion.texte;
						return `**${referenceSuggestion(suggestion.numero)}** ${lien ? `[${titre.slice(0, 70)}](${lien})` : titre.slice(0, 70)} · ${ilYA(suggestion.creeLe)}`;
					})
					.join("\n"),
				4
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

export { lireScore as lireScoreSuggestion, libelleScore };
