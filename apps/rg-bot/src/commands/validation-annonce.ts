import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

import { PROFIL_ANNONCEUR } from "../lib/config";
import { messageAnnonce, messagePing, urlTweet } from "../lib/tweets-format";
import {
	decoderValidation,
	texteCarteTranchee,
	PREFIXE_VALIDATION,
} from "../lib/validation-annonce";
import { lireTweet } from "../services/tweets";
import { resoudreSalon } from "../services/tweetsNotifier";
import { ANNONCEURS_AUTORISES } from "./x";

/**
 * LES BOUTONS DE LA CARTE DE VALIDATION.
 *
 * Le drain ne publie plus rien de lui-même quand le profil déclare un salon de
 * validation : il dépose une carte, et c'est ICI que l'annonce part — au clic
 * d'un humain habilité.
 *
 * ── CE QUI EST GARANTI ─────────────────────────────────────────────────────
 *  1. RIEN NE PART SANS CLIC. Le curseur a beau avoir avancé, aucune annonce
 *     n'est publiée tant que personne n'a tranché.
 *  2. UNE SEULE FOIS. Les boutons sont RETIRÉS dès le premier clic traité :
 *     deux personnes qui cliquent à une seconde d'intervalle ne produisent pas
 *     deux annonces. Le second reçoit un message éphémère qui le lui dit.
 *  3. LA CARTE NE MENT PAS SUR SON RÉSULTAT. Si l'envoi dans le salon d'annonce
 *     échoue — salon supprimé, permission retirée, panne Discord — la carte
 *     écrit « l'annonce a échoué » avec la raison, au lieu d'afficher un succès
 *     imaginaire que personne ne penserait à rattraper.
 *  4. LE GESTE EST NOMINATIF. `ANNONCEURS_AUTORISES` — la même liste que
 *     `/x annoncer`, et pour la même raison : ce bouton notifie deux mille
 *     personnes. Un rôle d'administrateur se donne et se retire au fil de
 *     l'eau ; ici on veut exactement trois personnes.
 */
@Discord()
export class ValidationAnnonce {
	@ButtonComponent({ id: new RegExp(`^${PREFIXE_VALIDATION}\\|`) })
	async trancher(interaction: ButtonInteraction): Promise<void> {
		const etat = decoderValidation(interaction.customId);
		if (!etat) {
			await interaction.reply({
				content: "Ce bouton n'est plus lisible. Relance la récolte pour obtenir une carte fraîche.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!ANNONCEURS_AUTORISES.has(interaction.user.id)) {
			await interaction.reply({
				content: "⛔ Seuls Yoyo, Inazo et Kolti peuvent valider une annonce.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const annonce = PROFIL_ANNONCEUR.annoncePosts;
		if (!annonce) {
			await interaction.reply({
				content: "Ce bot n'a pas de salon d'annonce dans son registre : il n'y a nulle part où publier.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// ⚠ ON RETIRE LES BOUTONS AVANT DE PUBLIER, pas après.
		// `deferUpdate` puis `editReply` laisserait une fenêtre de plusieurs
		// secondes — l'appel à Discord pour envoyer l'annonce — pendant laquelle un
		// second clic serait accepté et publierait le même post une seconde fois.
		// Éditer d'abord ferme la porte ; si l'envoi échoue ensuite, la carte le
		// dit, et la commande `/x annoncer` reste disponible pour rattraper.
		await interaction.update({ components: [] });

		const tweet = await lireTweet(etat.tweetId);
		const auteur = tweet?.author_username ?? "inconnu";
		const url = tweet ? urlTweet(tweet) : `https://x.com/i/status/${etat.tweetId}`;

		if (etat.decision === "non") {
			await interaction.editReply({
				content: texteCarteTranchee({
					auteur,
					decision: "non",
					parQui: interaction.user.id,
					url,
				}),
				allowedMentions: { parse: [] },
			});
			return;
		}

		if (!tweet) {
			await interaction.editReply({
				content: texteCarteTranchee({
					auteur,
					decision: "ok",
					echec: "ce post n'est plus dans l'archive.",
					parQui: interaction.user.id,
					url,
				}),
				allowedMentions: { parse: [] },
			});
			return;
		}

		const { salon, raison } = await resoudreSalon(interaction.client, annonce.salon);
		if (!salon) {
			await interaction.editReply({
				content: texteCarteTranchee({
					auteur,
					decision: "ok",
					echec: `salon \`${annonce.salon}\` injoignable (${raison ?? "le bot doit y voir et y écrire"}).`,
					parQui: interaction.user.id,
					url,
				}),
				allowedMentions: { parse: [] },
			});
			return;
		}

		try {
			// Le motif du salon, à la lettre : une amorce suivie de l'URL `fixvx.com`,
			// que Discord déplie en aperçu complet. Le ping part APRÈS, dans son
			// propre message — l'inclure empêcherait l'aperçu de se déplier.
			await salon.send({ content: messageAnnonce(tweet) });
			if (annonce.roleMention) {
				await salon.send({
					content: messagePing(annonce.roleMention),
					allowedMentions: { roles: [annonce.roleMention] },
				});
			}
			await interaction.editReply({
				content: texteCarteTranchee({
					auteur,
					decision: "ok",
					parQui: interaction.user.id,
					url,
				}),
				allowedMentions: { parse: [] },
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error("[validation] échec de l'annonce :", detail);
			await interaction.editReply({
				content: texteCarteTranchee({
					auteur,
					decision: "ok",
					echec: detail.slice(0, 200),
					parQui: interaction.user.id,
					url,
				}),
				allowedMentions: { parse: [] },
			});
		}
	}
}
