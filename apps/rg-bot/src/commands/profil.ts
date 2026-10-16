/**
 * `/profil` et `/classement` — la progression d'un membre, en image.
 *
 * ── POURQUOI UNE CARTE ET PAS UN EMBED ─────────────────────────────────────
 * Un embed de niveaux, tout le monde en a vu : trois champs et une barre en
 * blocs `█`. Ici la carte est peinte avec les assets RÉELS du jeu — la plaque
 * de nom achetée par le membre en fond, le portrait de son joueur fétiche, le
 * rang nommé comme la rareté des joueurs d'Inazuma Eleven Victory Road. C'est
 * une image qui ne peut exister que sur ce serveur, et c'est le seul intérêt
 * d'avoir écrit un système de niveaux plutôt que d'en installer un.
 *
 * L'embed reste là quand même : une image ne se lit pas par un lecteur d'écran,
 * et Discord ne l'affiche pas toujours en connexion faible. Les chiffres qui
 * comptent sont donc AUSSI dans le texte de la réponse.
 *
 * ── LA COMMANDE NE CRÉE RIEN ───────────────────────────────────────────────
 * Regarder le profil de quelqu'un ne lui fabrique pas de ligne en base (cf.
 * `services/communaute.profilDe`). Un membre qui n'a jamais parlé voit une
 * carte de niveau 1, et n'apparaît dans aucun classement.
 *
 * ── RÉPONSES PRIVÉES PAR DÉFAUT ────────────────────────────────────────────
 * Sur un serveur de deux mille membres, une commande qui répond publiquement
 * est une commande qui pollue. Ces réponses sont donc ÉPHÉMÈRES par défaut —
 * visibles de qui les demande, et de personne d'autre — avec une option
 * `partager` pour celles qu'on veut montrer. C'est le membre qui décide de
 * faire du bruit, jamais le bot.
 */
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	type ButtonBuilder,
	type ChatInputCommandInteraction,
	type User,
} from "discord.js";

import { getCharacterFaceUrl, resolveAssetUrl } from "@rosegriffon/azalee";

import { formaterJetons } from "../lib/kizuna";
import { renderCarteClassement, renderCarteProfil } from "../lib/canvas/communaute";
import { libelleCompletion, resumerCollection } from "../lib/collection";
import { NIVEAU_MAX, prochainRang, progression, rangDe } from "../lib/experience";
import {
	classement,
	fichesPersonnages,
	nombreClasses,
	personnagesPossedes,
	plaques,
	profilDe,
	rangClassement,
	totalPersonnages,
	type ProfilCommunaute,
} from "../services/communaute";
import {
	boutonLien,
	differer,
	echec,
	entierLisible,
	fiche,
	piedDeCommande,
	repondre,
} from "../lib/ui";
import { rgUrl } from "../lib/embeds";
import { pseudoDuSite } from "../services/website";

/**
 * La guilde de l'interaction, ou `null` en message privé.
 *
 * Toute la progression est PAR GUILDE : sans guilde, il n'y a rien à montrer, et
 * répondre « niveau 1 » en privé laisserait croire à une remise à zéro.
 */
function guildeDe(interaction: ChatInputCommandInteraction): string | null {
	return interaction.guildId;
}

const HORS_GUILDE =
	"Cette commande n'a de sens que sur un serveur : la progression est propre à chaque communauté.";

/** URL du portrait du joueur fétiche, `null` si le code de modèle manque. */
function portraitDe(code: string | null): string | null {
	if (!code) {
		return null;
	}
	const url = getCharacterFaceUrl(code);
	// La bibliothèque rend un chemin local de repli (`/ievr.webp`) quand elle ne
	// sait pas : le poser dans un canvas produirait une image manquante.
	return url.startsWith("http") ? url : null;
}

/** URL CDN de la plaque équipée, `null` si aucune ou si elle n'existe plus. */
async function plaqueDe(profil: ProfilCommunaute): Promise<string | null> {
	if (!profil.plaque) {
		return null;
	}
	const catalogue = await plaques();
	const plaque = catalogue.find((entree) => entree.id === profil.plaque);
	return plaque?.cheminImage ? resolveAssetUrl(plaque.cheminImage) : null;
}

@Discord()
export class ProfilCommand {
	@Slash({
		description: "Ta carte de progression, ou celle d'un autre membre",
		name: "profil",
	})
	async profil(
		@SlashOption({
			description: "Le membre dont tu veux voir la carte (toi par défaut)",
			name: "membre",
			required: false,
			type: ApplicationCommandOptionType.User,
		})
		membre: User | undefined,
		@SlashOption({
			description: "Afficher la carte dans le salon (privé par défaut)",
			name: "partager",
			required: false,
			type: ApplicationCommandOptionType.Boolean,
		})
		partager: boolean | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differer(interaction, { prive: partager !== true });
		const guildId = guildeDe(interaction);
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}

		const cible = membre ?? interaction.user;
		try {
			const profil = await profilDe(guildId, cible.id);
			const avancement = progression(profil.xp);
			const rang = rangDe(avancement.niveau);

			const [position, total, collection, recense, plaqueUrl, pseudoSite] = await Promise.all([
				rangClassement(guildId, cible.id),
				nombreClasses(guildId),
				personnagesPossedes(guildId, cible.id),
				totalPersonnages(),
				plaqueDe(profil),
				// Le membre a-t-il une page publique ? Elle porte la MÊME progression,
				// affichée sur sa carte de joueur — d'où le bouton plutôt qu'un simple
				// rappel : les deux surfaces montrent le même niveau, il n'y a aucune
				// raison de les laisser s'ignorer.
				pseudoDuSite(cible.id),
			]);

			const favoriId = profil.persoFavori;
			const favori = favoriId ? (await fichesPersonnages([favoriId]))[0] : undefined;
			const resume = resumerCollection(
				collection.map((entree) => ({ objetId: entree.id, rarete: entree.rarete })),
				recense
			);

			const image = await renderCarteProfil({
				avatarUrl: cible.displayAvatarURL({ extension: "png", size: 256 }),
				collection: collection.length > 0 ? libelleCompletion(resume, recense) : null,
				favori: favori
					? { nom: favori.nom, portraitUrl: portraitDe(favori.code), rarete: favori.rarete }
					: null,
				messages: profil.messagesComptes,
				plaqueUrl,
				jetons: profil.jetons,
				jetonsGagnes: profil.jetonsGagnes,
				progression: avancement,
				pseudo: cible.displayName ?? cible.username,
				rang: position?.rang ?? null,
				serie: profil.serieQuotidienne,
				total: total || (position?.total ?? 0),
			});

			// Les mêmes chiffres en texte : une image ne se lit pas par un lecteur
			// d'écran, et Discord ne la charge pas toujours.
			const suivant = prochainRang(avancement.niveau);
			const carte = fiche({ icone: "niveau", titre: `Profil de ${cible.displayName}` });
			carte
				.champ("Niveau", `**${avancement.niveau}** / ${NIVEAU_MAX} · ${rang.nom}`, { enLigne: true })
				.champ(
					"Expérience",
					avancement.auMaximum
						? `${entierLisible(avancement.xp)} XP — plafond atteint`
						: `${entierLisible(avancement.xpDansNiveau)} / ${entierLisible(avancement.xpDuNiveau)} XP`,
					{ enLigne: true }
				)
				.champ("Jetons Kizuna", formaterJetons(profil.jetons), { enLigne: true })
				.champ(
					"Classement",
					position ? `${entierLisible(position.rang)}ᵉ sur ${entierLisible(total)}` : "non classé",
					{ enLigne: true }
				)
				.champ(
					"Prochain rang",
					suivant ? `${suivant.nom} au niveau ${suivant.depuis}` : "le plus haut est atteint",
					{ enLigne: true }
				)
				.champ(
					"Collection",
					collection.length > 0 ? libelleCompletion(resume, recense) : "aucun joueur recruté",
					{ enLigne: true }
				);

			// Un bouton de style `Link` n'a pas d'identifiant et ne déclenche aucune
			// interaction : il survit intact au redémarrage du bot, contrairement à
			// tout composant qu'il faudrait écouter.
			const versLeSite = pseudoSite
				? [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							boutonLien({
								libelle: "Voir sur rosegriffon.fr",
								url: rgUrl(`/profil/${encodeURIComponent(pseudoSite)}`),
							})
						),
					]
				: [];

			await interaction.editReply({
				components: versLeSite,
				embeds: [piedDeCommande(carte.embed, interaction)],
				files: [new AttachmentBuilder(image, { name: `profil-${cible.id}.png` })],
			});
		} catch (err) {
			await repondre(
				interaction,
				echec("Profil illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	@Slash({
		description: "Le classement du serveur, en niveaux ou en jetons Kizuna",
		name: "classement",
	})
	async classement(
		@SlashChoice({ name: "Niveaux", value: "xp" })
		@SlashChoice({ name: "Jetons Kizuna", value: "jetons_gagnes" })
		@SlashOption({
			description: "Sur quoi classer (niveaux par défaut)",
			name: "critere",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		critere: string | undefined,
		@SlashOption({
			description: "Page du classement (10 par page)",
			maxValue: 50,
			minValue: 1,
			name: "page",
			required: false,
			type: ApplicationCommandOptionType.Integer,
		})
		page: number | undefined,
		@SlashOption({
			description: "Afficher le classement dans le salon (privé par défaut)",
			name: "partager",
			required: false,
			type: ApplicationCommandOptionType.Boolean,
		})
		partager: boolean | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differer(interaction, { prive: partager !== true });
		const guildId = guildeDe(interaction);
		if (!guildId) {
			await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
			return;
		}

		const surJetons = critere === "jetons_gagnes";
		const numero = Math.max(1, Math.floor(page ?? 1));
		const decalage = (numero - 1) * 10;

		try {
			const [lignes, total] = await Promise.all([
				classement(guildId, {
					critere: surJetons ? "jetons_gagnes" : "xp",
					decalage,
					limite: 10,
				}),
				nombreClasses(guildId),
			]);

			// Les pseudos ne sont PAS lus en base : `discord_members` ne couvre que la
			// guilde Rose Griffon, et un pseudo change plus souvent qu'il n'est
			// synchronisé. On les résout auprès du cache de la guilde, avec repli sur
			// l'identifiant — un classement sans nom reste un classement.
			const guilde = interaction.guild;
			const membres = await Promise.all(
				lignes.map(async (ligne) => {
					const membre = guilde ? await guilde.members.fetch(ligne.discordId).catch(() => null) : null;
					return { ligne, membre };
				})
			);

			const image = await renderCarteClassement(
				surJetons ? "Classement des jetons Kizuna" : "Classement des niveaux",
				membres.map(({ ligne, membre }, index) => ({
					avatarUrl: membre?.displayAvatarURL({ extension: "png", size: 128 }) ?? null,
					moi: ligne.discordId === interaction.user.id,
					niveau: ligne.niveau,
					position: decalage + index + 1,
					pseudo: membre?.displayName ?? ligne.discordId,
					ratio: progression(ligne.xp).ratio,
					xp: surJetons ? ligne.jetonsGagnes : ligne.xp,
				})),
				{
					note: `${entierLisible(total)} membre${total > 1 ? "s" : ""} classé${total > 1 ? "s" : ""}`,
					unite: surJetons ? "pts" : "XP",
				}
			);

			const maPosition = await rangClassement(
				guildId,
				interaction.user.id,
				surJetons ? "jetons_gagnes" : "xp"
			);
			const carte = fiche({
				icone: "classement",
				titre: surJetons ? "Classement des jetons Kizuna" : "Classement des niveaux",
			});
			carte.champ(
				"Ta position",
				maPosition
					? `${entierLisible(maPosition.rang)}ᵉ sur ${entierLisible(maPosition.total)}`
					: "tu n'es pas encore classé — un message compté suffit",
				{ garderVide: true }
			);

			await interaction.editReply({
				embeds: [piedDeCommande(carte.embed, interaction, { page: numero })],
				files: [new AttachmentBuilder(image, { name: "classement.png" })],
			});
		} catch (err) {
			await repondre(
				interaction,
				echec("Classement illisible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}
