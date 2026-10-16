/**
 * `/administration evenement` — la table `events`, qui alimente l'agenda public.
 *
 * ── OÙ CES LIGNES ATTERRISSENT ─────────────────────────────────────────────
 * `apps/website/src/app/api/calendar-events/route.ts` interroge d'abord
 * `SELECT * FROM events ORDER BY start_time ASC`. **Si et seulement si** cette
 * table est vide, la route retombe sur Google Agenda. Écrire ici ne complète
 * donc pas l'agenda Google : ça le REMPLACE intégralement sur
 * `rosegriffon.fr/evenements` et dans la commande publique `/agenda`. La table
 * compte 0 ligne au 13/8/2026 — le premier événement créé depuis Discord fera
 * disparaître les cinq entrées Google actuellement affichées. `liste` le dit
 * quand la table est vide, plutôt que de laisser découvrir la bascule après
 * coup.
 *
 * ── CE QUE CETTE COMMANDE CORRIGE ──────────────────────────────────────────
 * Reprise de `/rg-event-admin list|create|edit|delete`, avec quatre défauts
 * réparés :
 *
 *  1. `parseDate` acceptait le 30 février. `new Date("2026-02-30")` ne lève
 *     pas : il reporte silencieusement au 2 mars. Une faute de frappe devenait
 *     une date valable, décalée de deux jours. `analyserDate` (module pur
 *     `valeurs.ts`) vérifie le calendrier arithmétiquement AVANT de construire
 *     la date, et refuse aussi `01/05/2026`, dont le sens dépend de la locale.
 *
 *  2. `edit` ne pouvait pas VIDER un champ. La requête écrivait
 *     `COALESCE(${valeur}, colonne)` : « option absente » et « option vidée »
 *     arrivaient toutes deux en `null`, donc effacer un lieu erroné était
 *     impossible depuis Discord. `lireChampTextuel` distingue les deux, et un
 *     `-` vide explicitement la colonne.
 *
 *  3. `delete` répondait « 🗑 supprimé » même quand l'UUID n'existait pas —
 *     Postgres ne bronche pas sur un `DELETE` qui ne touche aucune ligne. On
 *     s'appuie désormais sur `RETURNING` : pas de ligne rendue, pas de
 *     confirmation, et surtout pas de trace d'audit mensongère.
 *
 *  4. La cohérence de la plage n'était vérifiée qu'à la création. Une édition
 *     pouvait poser une fin antérieure au début : la contrainte `NOT NULL` de
 *     `end_time` passe, mais l'événement devient invisible côté site, dont
 *     toutes les requêtes filtrent sur `end_time >= NOW()`. La vérification
 *     porte maintenant sur la plage RÉSULTANTE, pas sur les seuls champs
 *     fournis.
 *
 * ── FUSEAU ─────────────────────────────────────────────────────────────────
 * Une saisie sans fuseau explicite est lue dans celui du serveur, `Etc/UTC` ici
 * (processus et Postgres). L'affichage, lui, passe par les horodatages natifs
 * de Discord : chaque membre lit l'heure dans SON fuseau, et la valeur reste
 * juste quand le message est relu des semaines plus tard.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { dateCourte } from "../../lib/communaute-format";
import { sql } from "../../lib/db";
import { rgEmbed, truncate } from "../../lib/embeds";
import { borner, horodatageAbsolu, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import {
	abregerIdentifiant,
	analyserDate,
	estConfirme,
	estUuid,
	lireChampTextuel,
	verifierPlageTemporelle,
} from "./valeurs";
import "./racine-gestion";
import { echec, piedTexte, repondre } from "../../lib/ui";

/** Les neuf colonnes de `events`, sans exception : la table n'en a pas d'autre. */
interface EvenementAdmin {
	id: string;
	title: string;
	description: string | null;
	start_time: Date | string;
	end_time: Date | string;
	location: string | null;
	image_url: string | null;
	created_at: Date | string;
	updated_at: Date | string;
}

type PorteeEvenement = "a-venir" | "passes" | "tous";

const CHOIX_PORTEE = [
	{ name: "À venir", value: "a-venir" },
	{ name: "Passés", value: "passes" },
	{ name: "Tous", value: "tous" },
] as const;

/** Format accepté par toutes les options de date, répété tel quel dans Discord. */
const FORMAT_DATE = "2026-05-01 20:00 (ou 2026-05-01T20:00:00+02:00)";

async function listerEvenements(
	portee: PorteeEvenement,
	limite: number
): Promise<EvenementAdmin[]> {
	// Trois requêtes plutôt qu'un prédicat paramétré : l'ORDRE change avec la
	// portée. Le prochain événement se lit du plus proche au plus lointain, les
	// passés du plus récent au plus ancien — l'inverse mettrait en tête un
	// événement de 2023 que personne ne cherche.
	if (portee === "passes") {
		return await sql<EvenementAdmin[]>`
			SELECT id::text, title, description, start_time, end_time, location, image_url,
			       created_at, updated_at
			FROM events
			WHERE end_time < NOW()
			ORDER BY start_time DESC
			LIMIT ${limite}
		`;
	}
	if (portee === "tous") {
		return await sql<EvenementAdmin[]>`
			SELECT id::text, title, description, start_time, end_time, location, image_url,
			       created_at, updated_at
			FROM events
			ORDER BY start_time DESC
			LIMIT ${limite}
		`;
	}
	return await sql<EvenementAdmin[]>`
		SELECT id::text, title, description, start_time, end_time, location, image_url,
		       created_at, updated_at
		FROM events
		WHERE end_time >= NOW()
		ORDER BY start_time ASC
		LIMIT ${limite}
	`;
}

async function lireEvenement(id: string): Promise<EvenementAdmin | null> {
	const lignes = await sql<EvenementAdmin[]>`
		SELECT id::text, title, description, start_time, end_time, location, image_url,
		       created_at, updated_at
		FROM events
		WHERE id::text = ${id}
		LIMIT 1
	`;
	return lignes[0] ?? null;
}

/**
 * Index d'autocomplétion des événements.
 *
 * `liste` n'affiche que les huit premiers caractères d'un identifiant, par
 * lisibilité — mais `modifier` et `supprimer` exigent l'UUID complet. Sans
 * autocomplétion, la seule voie praticable était d'aller chercher l'UUID dans
 * l'administration du site : la liste rendue par Discord ne permettait PAS
 * d'enchaîner sur une modification. L'index tient trente secondes, assez pour
 * qu'un événement créé à l'instant soit proposé aussitôt.
 */
const TTL_INDEX_MS = 30_000;
const CLEF_INDEX = "administration:evenement:index";

async function indexEvenements(): Promise<EvenementAdmin[]> {
	return await cached(CLEF_INDEX, TTL_INDEX_MS, async () => {
		return await sql<EvenementAdmin[]>`
			SELECT id::text, title, description, start_time, end_time, location, image_url,
			       created_at, updated_at
			FROM events
			ORDER BY start_time DESC
			LIMIT 100
		`;
	});
}

/** Compte total, pour dire « 3 affichés sur 12 » au lieu de laisser croire à 3. */
async function compterEvenements(): Promise<number> {
	const [ligne] = await sql<Array<{ total: number }>>`SELECT count(*)::int AS total FROM events`;
	return ligne?.total ?? 0;
}

/** Une ligne de liste : titre, plage lue dans le fuseau du lecteur, lieu. */
function ligneEvenement(evenement: EvenementAdmin): string {
	const morceaux = [
		`**${truncate(evenement.title, 90)}**`,
		`\`${abregerIdentifiant(evenement.id)}\``,
	];
	const detail = [
		`du ${horodatageAbsolu(evenement.start_time)} au ${horodatageAbsolu(evenement.end_time)}`,
		horodatageRelatif(evenement.start_time),
	];
	if (evenement.location) {
		detail.push(`📍 ${truncate(evenement.location, 40)}`);
	}
	return `${morceaux.join(" · ")}\n   └ ${detail.join(" · ")}`;
}

/** Fiche complète d'un événement, réutilisée par création, édition et suppression. */
function ficheEvenement(evenement: EvenementAdmin) {
	const embed = rgEmbed()
		.setTitle(truncate(evenement.title, 240))
		.addFields(
			{ name: "Début", value: horodatageAbsolu(evenement.start_time), inline: true },
			{ name: "Fin", value: horodatageAbsolu(evenement.end_time), inline: true },
			{ name: "Dans", value: horodatageRelatif(evenement.start_time), inline: true },
			// `?? ` ne suffit pas : une chaîne VIDE écrite depuis l'administration du
			// site ferait rejeter l'embed entier (Discord refuse un champ sans valeur).
			{
				name: "Lieu",
				value: evenement.location?.trim() ? truncate(evenement.location, 900) : "*non renseigné*",
				inline: true,
			},
			{ name: "Identifiant", value: `\`${evenement.id}\`` }
		);
	if (evenement.description) {
		embed.setDescription(borner(evenement.description, 1_500));
	}
	// L'URL n'est validée qu'à l'écriture DEPUIS DISCORD : une ligne posée par
	// l'administration du site peut porter un chemin relatif, que `setImage`
	// accepte sans broncher mais que l'API Discord rejette — et le rejet emporte
	// l'embed ENTIER, donc l'accusé de réception d'une écriture déjà faite.
	if (evenement.image_url && urlAcceptable(evenement.image_url)) {
		embed.setImage(evenement.image_url);
	}
	return embed;
}

@Discord()
@SlashGroup({
	name: "evenement",
	description: "Créer, modifier ou supprimer un événement de l'agenda public",
	root: "gestion",
})
@SlashGroup("evenement", "gestion")
export class AdministrationEvenementCommand {
	@Slash({ name: "liste", description: "Les événements enregistrés dans la table `events`" })
	async liste(
		@SlashChoice(...CHOIX_PORTEE)
		@SlashOption({
			name: "portee",
			description: "Quels événements afficher (par défaut : à venir)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		portee: string | undefined,
		@SlashOption({
			name: "nombre",
			description: "Nombre d'événements (1 à 25, 10 par défaut)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
			maxValue: 25,
		})
		nombre: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const choisie: PorteeEvenement = portee === "passes" || portee === "tous" ? portee : "a-venir";
		try {
			const [evenements, total] = await Promise.all([
				listerEvenements(choisie, nombre ?? 10),
				compterEvenements(),
			]);

			if (evenements.length === 0) {
				await interaction.editReply({
					content:
						total === 0
							? "La table `events` est **vide**. Tant qu'elle le reste, " +
								"`rosegriffon.fr/evenements` affiche l'agenda Google ; le premier " +
								"événement créé ici prendra sa place intégralement."
							: `Aucun événement dans cette portée (${total} au total). ` +
								"Essaie `portee: Tous`.",
				});
				return;
			}

			const libelle = CHOIX_PORTEE.find((choix) => choix.value === choisie)?.name ?? "À venir";
			const embed = rgEmbed()
				.setTitle(`${evenements.length} événement${evenements.length > 1 ? "s" : ""} — ${libelle}`)
				.setDescription(borner(evenements.map(ligneEvenement).join("\n\n"), 4_000))
				.setFooter(
					piedTexte({
						note: `${total} événement${total > 1 ? "s" : ""} en base · source de rosegriffon.fr/evenements`,
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "creer", description: "Ajouter un événement à l'agenda public" })
	async creer(
		@SlashOption({
			name: "titre",
			description: "Titre affiché sur le site",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 2,
			maxLength: 200,
		})
		titre: string,
		@SlashOption({
			name: "debut",
			description: `Début — ${FORMAT_DATE}`,
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		debut: string,
		@SlashOption({
			name: "fin",
			description: `Fin — ${FORMAT_DATE}`,
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		fin: string,
		@SlashOption({
			name: "lieu",
			description: "Lieu (facultatif)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		lieu: string | undefined,
		@SlashOption({
			name: "description",
			description: "Description (facultative)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		description: string | undefined,
		@SlashOption({
			name: "image",
			description: "URL de l'illustration (facultative)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		image: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}

		const debutLu = analyserDate(debut);
		const finLue = analyserDate(fin);
		if (!debutLu || !finLue) {
			await interaction.editReply({ content: refusDeDate(debutLu !== null, finLue !== null) });
			return;
		}
		const plage = verifierPlageTemporelle(debutLu, finLue);
		if (plage) {
			await repondre(interaction, echec("La commande a échoué", plage));
			return;
		}
		const imageLue = lireChampTextuel(image);
		if (imageLue.valeur && !urlAcceptable(imageLue.valeur)) {
			await interaction.editReply({
				content: "❌ L'illustration doit être une URL `http` ou `https` complète.",
			});
			return;
		}

		try {
			const [cree] = await sql<EvenementAdmin[]>`
				INSERT INTO events (title, description, start_time, end_time, location, image_url)
				VALUES (${titre.trim()}, ${lireChampTextuel(description).valeur},
				        ${debutLu}, ${finLue},
				        ${lireChampTextuel(lieu).valeur}, ${imageLue.valeur})
				RETURNING id::text, title, description, start_time, end_time, location, image_url,
				          created_at, updated_at
			`;
			if (!cree) {
				await interaction.editReply({
					content: "❌ La base n'a rendu aucune ligne à l'insertion.",
				});
				return;
			}

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: "evenement.creer",
				targetType: "event",
				targetId: cree.id,
				details: {
					titre: cree.title,
					debut: debutLu.toISOString(),
					fin: finLue.toISOString(),
					lieu: cree.location,
				},
			});

			// Sans ça, l'événement tout juste créé n'apparaîtrait dans
			// l'autocomplétion de `modifier` qu'au bout de trente secondes.
			invalidate(CLEF_INDEX);

			const embed = ficheEvenement(cree).setFooter(
				piedTexte({
					note: "Créé · la table `events` prend désormais le pas sur l'agenda Google",
				})
			);
			await interaction.editReply({ content: "✅ Événement créé.", embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "modifier",
		description: "Changer un événement — les champs omis restent inchangés, « - » les vide",
	})
	async modifier(
		@SlashOption({
			name: "identifiant",
			description: "Événement à modifier (autocomplété) ou son UUID complet",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: proposerEvenements,
		})
		identifiant: string,
		@SlashOption({
			name: "titre",
			description: "Nouveau titre",
			type: ApplicationCommandOptionType.String,
			required: false,
			minLength: 2,
			maxLength: 200,
		})
		titre: string | undefined,
		@SlashOption({
			name: "debut",
			description: `Nouveau début — ${FORMAT_DATE}`,
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		debut: string | undefined,
		@SlashOption({
			name: "fin",
			description: `Nouvelle fin — ${FORMAT_DATE}`,
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		fin: string | undefined,
		@SlashOption({
			name: "lieu",
			description: "Nouveau lieu, ou « - » pour l'effacer",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		lieu: string | undefined,
		@SlashOption({
			name: "description",
			description: "Nouvelle description, ou « - » pour l'effacer",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		description: string | undefined,
		@SlashOption({
			name: "image",
			description: "Nouvelle URL d'illustration, ou « - » pour l'effacer",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		image: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}

		const id = identifiant.trim();
		if (!estUuid(id)) {
			await interaction.editReply({
				content:
					"❌ L'identifiant doit être l'UUID complet de l'événement (36 caractères). " +
					"Choisis l'événement dans l'autocomplétion : elle en pose la valeur exacte.",
			});
			return;
		}

		const titreLu = lireChampTextuel(titre);
		const lieuLu = lireChampTextuel(lieu);
		const descriptionLue = lireChampTextuel(description);
		const imageLue = lireChampTextuel(image);
		const debutLu = debut === undefined ? null : analyserDate(debut);
		const finLue = fin === undefined ? null : analyserDate(fin);
		if ((debut !== undefined && !debutLu) || (fin !== undefined && !finLue)) {
			await interaction.editReply({
				content: refusDeDate(
					debut === undefined || debutLu !== null,
					fin === undefined || finLue !== null
				),
			});
			return;
		}
		// Un titre est `NOT NULL` en base : le vider ferait échouer l'écriture.
		if (titreLu.fourni && titreLu.valeur === null) {
			await interaction.editReply({
				content: "❌ Le titre ne peut pas être vidé : il est obligatoire.",
			});
			return;
		}
		if (imageLue.fourni && imageLue.valeur !== null && !urlAcceptable(imageLue.valeur)) {
			await interaction.editReply({
				content: "❌ L'illustration doit être une URL `http` ou `https` complète.",
			});
			return;
		}
		const rienAFaire =
			!titreLu.fourni &&
			!lieuLu.fourni &&
			!descriptionLue.fourni &&
			!imageLue.fourni &&
			debutLu === null &&
			finLue === null;
		if (rienAFaire) {
			await interaction.editReply({
				content: "Aucun champ fourni : il n'y avait rien à modifier.",
			});
			return;
		}

		try {
			const avant = await lireEvenement(id);
			if (!avant) {
				await interaction.editReply({
					content: `Aucun événement sous \`${truncate(id, 40)}\`.`,
				});
				return;
			}

			// La cohérence se juge sur la plage RÉSULTANTE : ne changer que la fin
			// pouvait la faire passer avant un début resté en base.
			const debutFinal = debutLu ?? new Date(avant.start_time);
			const finFinale = finLue ?? new Date(avant.end_time);
			const plage = verifierPlageTemporelle(debutFinal, finFinale);
			if (plage) {
				await repondre(interaction, echec("La commande a échoué", plage));
				return;
			}

			const [apres] = await sql<EvenementAdmin[]>`
				UPDATE events SET
					title       = COALESCE(${titreLu.valeur}::text, title),
					start_time  = COALESCE(${debutLu}::timestamptz, start_time),
					end_time    = COALESCE(${finLue}::timestamptz, end_time),
					location    = CASE WHEN ${lieuLu.fourni}::boolean THEN ${lieuLu.valeur}::text ELSE location END,
					description = CASE WHEN ${descriptionLue.fourni}::boolean THEN ${descriptionLue.valeur}::text ELSE description END,
					image_url   = CASE WHEN ${imageLue.fourni}::boolean THEN ${imageLue.valeur}::text ELSE image_url END,
					updated_at  = NOW()
				WHERE id::text = ${id}
				RETURNING id::text, title, description, start_time, end_time, location, image_url,
				          created_at, updated_at
			`;
			if (!apres) {
				await interaction.editReply({
					content: "L'événement a disparu entre la lecture et l'écriture. Rien n'a été modifié.",
				});
				return;
			}

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: "evenement.modifier",
				targetType: "event",
				targetId: apres.id,
				details: {
					titre_avant: avant.title,
					titre_apres: apres.title,
					debut_avant: new Date(avant.start_time).toISOString(),
					debut_apres: new Date(apres.start_time).toISOString(),
					fin_avant: new Date(avant.end_time).toISOString(),
					fin_apres: new Date(apres.end_time).toISOString(),
					lieu_avant: avant.location,
					lieu_apres: apres.location,
				},
			});

			invalidate(CLEF_INDEX);
			const embed = ficheEvenement(apres).setFooter(piedTexte({ note: "Modifié" }));
			await interaction.editReply({ content: "✅ Événement mis à jour.", embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "supprimer", description: "Retirer définitivement un événement de l'agenda" })
	async supprimer(
		@SlashOption({
			name: "identifiant",
			description: "Événement à supprimer (autocomplété) ou son UUID complet",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: proposerEvenements,
		})
		identifiant: string,
		@SlashOption({
			name: "confirmation",
			description: "Tape « oui » — la suppression est définitive",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		confirmation: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}
		if (!estConfirme(confirmation)) {
			await interaction.editReply({
				content: "Suppression annulée : il faut écrire « oui » dans `confirmation`.",
			});
			return;
		}
		const id = identifiant.trim();
		if (!estUuid(id)) {
			await interaction.editReply({
				content:
					"❌ L'identifiant doit être l'UUID complet de l'événement (36 caractères). " +
					"Choisis l'événement dans l'autocomplétion : elle en pose la valeur exacte.",
			});
			return;
		}

		try {
			// `RETURNING` est ce qui distingue « supprimé » de « n'existait pas » :
			// un DELETE qui ne touche aucune ligne réussit sans rien dire.
			const [supprime] = await sql<EvenementAdmin[]>`
				DELETE FROM events
				WHERE id::text = ${id}
				RETURNING id::text, title, description, start_time, end_time, location, image_url,
				          created_at, updated_at
			`;
			if (!supprime) {
				await interaction.editReply({
					content: `Aucun événement sous \`${truncate(id, 40)}\` : rien n'a été supprimé.`,
				});
				return;
			}

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: "evenement.supprimer",
				targetType: "event",
				targetId: supprime.id,
				details: {
					titre: supprime.title,
					debut: new Date(supprime.start_time).toISOString(),
					fin: new Date(supprime.end_time).toISOString(),
					lieu: supprime.location,
				},
			});

			// Un événement supprimé ne doit plus être proposé à la modification.
			invalidate(CLEF_INDEX);
			const restants = await compterEvenements();
			// Dire ce que la table contient APRÈS coup : à zéro ligne, le site
			// rebascule sur l'agenda Google, ce qui change ce que voient les
			// visiteurs sans que personne n'ait retouché le site.
			const suite =
				restants === 0
					? "La table `events` est de nouveau vide : le site repasse sur l'agenda Google."
					: `${restants} événement${restants > 1 ? "s" : ""} restant${restants > 1 ? "s" : ""}.`;
			await interaction.editReply({
				content: `🗑 **${truncate(supprime.title, 120)}** supprimé de l'agenda.\n${suite}`,
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}
}

/**
 * Autocomplétion des événements, partagée par `modifier` et `supprimer`.
 *
 * La valeur rendue est l'UUID COMPLET — 36 caractères, toujours sous les 100
 * qu'autorise Discord — parce que c'est ce qu'attendent les deux commandes. Le
 * libellé, lui, porte le titre et la date : c'est ce qui permet de reconnaître
 * l'événement, ce qu'un UUID ne fait pas.
 *
 * Une autocomplétion qui lève laisse le champ figé sur « chargement… » : on
 * répond une liste vide plutôt que rien du tout.
 */
async function proposerEvenements(interaction: AutocompleteInteraction): Promise<void> {
	try {
		const saisie = String(interaction.options.getFocused() ?? "")
			.trim()
			.toLowerCase();
		const index = await indexEvenements();
		const retenus = index
			.filter(
				(evenement) =>
					saisie.length === 0 ||
					evenement.title.toLowerCase().includes(saisie) ||
					evenement.id.startsWith(saisie)
			)
			// Discord refuse au-delà de 25 propositions.
			.slice(0, 25);
		await interaction.respond(
			retenus.map((evenement) => ({
				name: truncate(`${evenement.title} — ${dateCourte(evenement.start_time)}`, 100),
				value: evenement.id,
			}))
		);
	} catch {
		await interaction.respond([]);
	}
}

/**
 * Message de refus qui désigne LAQUELLE des deux dates est illisible.
 *
 * L'ancien `/rg-event-admin create` répondait « ❌ Date invalide » pour les deux
 * champs à la fois : quand on en saisit deux, il faut savoir laquelle relire.
 */
function refusDeDate(debutOk: boolean, finOk: boolean): string {
	const fautives = [debutOk ? null : "`debut`", finOk ? null : "`fin`"].filter(
		(morceau): morceau is string => morceau !== null
	);
	return (
		`❌ Date illisible : ${fautives.join(" et ")}. Format attendu : \`${FORMAT_DATE}\`. ` +
		"Le jour doit exister (le 30 février est refusé), et la date doit commencer " +
		"par l'année — `01/05/2026` est ambigu."
	);
}

/**
 * L'illustration part dans `setImage` d'un embed puis sur le site.
 *
 * Discord rejette l'embed ENTIER si l'URL n'est pas absolue, et une valeur en
 * `javascript:` ou `data:` n'a rien à faire dans un `<img src>` côté site.
 */
function urlAcceptable(valeur: string): boolean {
	try {
		const url = new URL(valeur);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
