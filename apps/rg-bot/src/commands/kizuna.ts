/**
 * `/kizuna` — la monnaie sociale du serveur.
 *
 * ── CE QUI RAPPORTE, ET CE QUI NE RAPPORTE PAS ─────────────────────────────
 * Trois sources, et l'absence délibérée d'une quatrième (cf. `lib/kizuna.ts`) :
 * le passage quotidien, les montées de niveau, les dons reçus. **Aucun gain par
 * message.** C'était le choix évident et c'est celui qui transforme un salon en
 * concours de messages d'un mot ; l'XP mesure déjà l'activité, et elle est
 * bornée par un délai anti-spam.
 *
 * ── LE JOURNAL EST PUBLIC POUR SON PROPRIÉTAIRE, ET POUR PERSONNE D'AUTRE ──
 * `/kizuna journal` ne montre que le sien, et en éphémère. Le journal dit qui a
 * donné à qui : c'est un graphe social, il n'a rien à faire dans l'historique
 * d'un salon. La table `bot_journal_kizuna` n'est d'ailleurs lisible par aucune
 * clé publique (RLS sans policy, cf. la migration).
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type ChatInputCommandInteraction,
	type User,
} from "discord.js";

import {
	DON,
	formaterDelta,
	formaterJetons,
	libelleMotif,
	QUOTIDIEN,
	validerDon,
} from "../lib/kizuna";
import {
	dejaDonneAujourdhui,
	journalDe,
	profilDe,
	reclamerQuotidien,
	transfererKizuna,
} from "../services/communaute";
import {
	attention,
	creerEmbed,
	differer,
	differerEnPrive,
	echec,
	entierLisible,
	fiche,
	ilYA,
	leJour,
	pied,
	piedDeCommande,
	repondre,
	vide,
} from "../lib/ui";

const HORS_GUILDE =
	"Cette commande n'a de sens que sur un serveur : les jetons Kizuna sont propres à chaque communauté.";

@Discord()
@SlashGroup({
	description: "Jetons Kizuna — solde, passage quotidien, dons",
	name: "kizuna",
})
@SlashGroup("kizuna")
export class KizunaCommand {
	@Slash({ description: "Ton solde de jetons Kizuna", name: "solde" })
	async solde(
		@SlashOption({
			description: "Le membre dont tu veux voir le solde (toi par défaut)",
			name: "membre",
			required: false,
			type: ApplicationCommandOptionType.User,
		})
		membre: User | undefined,
		@SlashOption({
			description: "Afficher le solde dans le salon (privé par défaut)",
			name: "partager",
			required: false,
			type: ApplicationCommandOptionType.Boolean,
		})
		partager: boolean | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differer(interaction, { prive: partager !== true });
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}
		const cible = membre ?? interaction.user;
		try {
			const profil = await profilDe(guildId, cible.id);
			const carte = fiche({
				icone: "kizuna",
				miniature: cible.displayAvatarURL({ extension: "png", size: 128 }),
				titre: `Amitié de ${cible.displayName}`,
			});
			carte
				.champ("Solde", formaterJetons(profil.jetons), { enLigne: true })
				.champ("Gagnés en tout", formaterJetons(profil.jetonsGagnes), { enLigne: true })
				.champ(
					"Série quotidienne",
					profil.serieQuotidienne > 0
						? `${entierLisible(profil.serieQuotidienne)} jour${profil.serieQuotidienne > 1 ? "s" : ""}`
						: "aucune en cours",
					{ enLigne: true }
				);
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Solde illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({
		description: `Ton passage du jour (${QUOTIDIEN.base} jetons, plus la prime de série)`,
		name: "quotidien",
	})
	async quotidien(interaction: ChatInputCommandInteraction) {
		// Toujours privé : c'est un geste qu'on répète tous les jours. Publié, il
		// remplirait un salon à lui seul.
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}
		try {
			// `reclamerQuotidien` est idempotent sur la journée : un double-clic ne
			// crédite pas deux fois, il retombe simplement dans la branche « déjà
			// passé » (la garde est dans le `WHERE` de l'UPDATE, pas ici).
			const resultat = await reclamerQuotidien(guildId, interaction.user.id);

			if (!resultat.reclame) {
				await repondre(
					interaction,
					attention(
						"Déjà passé aujourd'hui",
						`Reviens ${leJour(resultat.prochain, "R")} — la série se compte en jours civils, ` +
							"pas en tranches de 24 h : passer tard un soir ne t'empêche pas de repasser tôt le lendemain.",
						{ prive: true }
					)
				);
				return;
			}

			const carte = fiche({
				description: `${formaterDelta(resultat.gain)} jetons Kizuna.`,
				icone: "kizuna",
				intention: "succes",
				titre: "Passage du jour",
			});
			carte
				.champ(
					"Série",
					resultat.serieRompue
						? `repartie à 1 jour — la précédente s'est arrêtée`
						: `${entierLisible(resultat.serie)} jour${resultat.serie > 1 ? "s" : ""} d'affilée`,
					{ enLigne: true }
				)
				.champ("Solde", formaterJetons(resultat.solde), { enLigne: true })
				.champ("Prochain passage", leJour(resultat.prochain, "R"), { enLigne: true });
			if (resultat.serie < 11) {
				carte.champ(
					"Prime de série",
					`+${QUOTIDIEN.parJour} jetons par jour consécutif, jusqu'à +${QUOTIDIEN.primeMaximale} au onzième.`
				);
			}
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Passage impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Offrir des jetons Kizuna à un membre", name: "donner" })
	async donner(
		@SlashOption({
			description: "À qui",
			name: "membre",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		destinataire: User,
		@SlashOption({
			description: `Combien (de ${DON.minimum} à ${DON.maximum})`,
			maxValue: DON.maximum,
			minValue: DON.minimum,
			name: "montant",
			required: true,
			type: ApplicationCommandOptionType.Integer,
		})
		montant: number,
		interaction: ChatInputCommandInteraction
	) {
		// Le don est confirmé EN PRIVÉ au donateur, et annoncé au destinataire par
		// message direct. Publier chaque don remplirait le salon ; ne rien dire au
		// destinataire viderait le geste de son sens. Les deux personnes concernées
		// sont prévenues, et personne d'autre.
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}
		try {
			const [profil, dejaDonne] = await Promise.all([
				profilDe(guildId, interaction.user.id),
				dejaDonneAujourdhui(guildId, interaction.user.id),
			]);

			const validation = validerDon({
				dejaDonne,
				destinataireEstBot: destinataire.bot,
				destinataireId: destinataire.id,
				expediteurId: interaction.user.id,
				montant,
				solde: profil.jetons,
			});
			if (!validation.ok) {
				await repondre(interaction, attention("Don refusé", validation.erreur, { prive: true }));
				return;
			}

			const soldes = await transfererKizuna(
				guildId,
				interaction.user.id,
				destinataire.id,
				validation.montant
			);

			// Publique, et volontairement : la générosité est la seule chose que ce
			// système récompense socialement. Le JOURNAL, lui, reste privé.
			// Le destinataire est prévenu en message direct. S'il a fermé ses MP, on
			// n'insiste pas : ses jetons sont déjà crédités, et le forcer à voir
			// l'annonce dans un salon serait exactement le bruit qu'on refuse.
			await destinataire
				.send({
					embeds: [
						pied(
							creerEmbed({
								description: `${interaction.user.toString()} t'offre ${formaterJetons(validation.montant)}.`,
								icone: "kizuna",
								intention: "succes",
								titre: "Don reçu",
							}),
							{ note: "/kizuna solde pour voir ton compte" }
						),
					],
				})
				.catch(() => undefined);

			const carte = fiche({
				description: `Tu offres ${formaterJetons(validation.montant)} à ${destinataire.toString()}.`,
				icone: "kizuna",
				intention: "succes",
				titre: "Don envoyé",
			});
			carte
				.champ("Ton solde", formaterJetons(soldes.soldeExpediteur), { enLigne: true })
				.champ("Son solde", formaterJetons(soldes.soldeDestinataire), { enLigne: true });
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Don impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({ description: "Tes derniers mouvements de jetons (privé)", name: "journal" })
	async journal(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}
		try {
			const [profil, lignes] = await Promise.all([
				profilDe(guildId, interaction.user.id),
				journalDe(guildId, interaction.user.id, 12),
			]);
			if (lignes.length === 0) {
				await repondre(
					interaction,
					vide(
						"Journal vide",
						"Aucun mouvement pour l'instant. `/kizuna quotidien` en écrit un premier."
					)
				);
				return;
			}

			const carte = fiche({
				description: lignes
					.map((ligne) => {
						const contrepartie = ligne.contrepartie ? ` ↔ <@${ligne.contrepartie}>` : "";
						return `\`${formaterDelta(ligne.delta).padStart(7)}\` ${libelleMotif(ligne.motif)}${contrepartie} · ${ilYA(ligne.creeLe)}`;
					})
					.join("\n"),
				icone: "journal",
				titre: "Journal de tes jetons Kizuna",
			});
			carte.champ("Solde", formaterJetons(profil.jetons), { enLigne: true });
			await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
		} catch (err) {
			await repondre(
				interaction,
				echec("Journal illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}
