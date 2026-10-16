/**
 * `/administration utilisateur` — les 1 850 profils du site, depuis Discord.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * `/rg-user` (`commands/admin/user.ts`), reprise et corrigée. Les défauts
 * n'étaient pas cosmétiques :
 *
 *   1. ELLE FUITAIT DES DONNÉES PERSONNELLES. `info` affichait `profile.email`
 *      dans un champ d'embed, et `list` répétait l'adresse de chaque ligne. Un
 *      salon Discord n'est pas un espace privé. La table porte aussi les
 *      adresses postales des acheteurs de la boutique. Ici, aucune requête ne
 *      lit ces colonnes : voir `COLONNES_PROFIL_PRIVEES` dans `valeurs.ts`,
 *      et jamais de `SELECT *`.
 *   2. SES RÔLES N'EXISTAIENT PAS. La liste en dur (`user, premium, moderator,
 *      staff, admin, banned`) ignorait `member`, que portent 1 839 des 1 850
 *      profils : le filtre le plus utile était inatteignable, et `unban`
 *      remettait `user` — un rôle que 1 seul compte porte en base. On repart de
 *      `ROLES_ASSIGNABLES`, relevé sur la production.
 *   3. ELLE NE TROUVAIT PRESQUE PERSONNE. La résolution passait uniquement par
 *      la table `account` de Better Auth, qui compte 7 liaisons Discord, alors
 *      que 1 836 profils portent un `discord_id`. Mentionner un membre rendait
 *      donc « Utilisateur introuvable » dans 99 % des cas. On interroge
 *      maintenant les deux chemins.
 *   4. ELLE N'AVAIT AUCUNE CONFIRMATION. `ban` s'exécutait au premier Entrée,
 *      dans la même liste d'autocomplétion que `info`.
 *   5. ELLE LAISSAIT LE CACHE DE DROITS MENTIR. Après un changement de rôle,
 *      `lib/rbac.ts` gardait sa décision 60 s : un compte fraîchement banni
 *      restait administrateur une minute. On invalide désormais son entrée.
 *
 * ── PAGINATION ET CONFIRMATION : TOUT L'ÉTAT EST DANS LE BOUTON ────────────
 * La pagination n'a aucune mémoire de processus (`encoderEtatBouton`) : un
 * redémarrage du bot ne laisse jamais de bouton mort. La confirmation, elle,
 * garde une entrée en mémoire — parce qu'un motif d'action complet (raison de
 * bannissement comprise) ne tient pas dans les 100 caractères d'un `custom_id`,
 * et surtout parce qu'un bouton destructeur qui survit à un redémarrage est un
 * piège : après un redémarrage, il dit « expirée », ce qui est la vérité.
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
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type InteractionEditReplyOptions,
	type User,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import { rgEmbed } from "../../lib/embeds";
import {
	NotAdminError,
	invalidateRbacCache,
	requireRgAdmin,
	requireRgAdminStrict,
} from "../../lib/rbac";
import { borner, echapperMarkdown, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne, type RgAdmin } from "../staff/garde";
import {
	ROLES_ASSIGNABLES,
	ROLES_ATTRIBUABLES,
	abregerIdentifiant,
	decoderEtatBouton,
	decrireChangement,
	encoderEtatBouton,
	estIdentifiantDiscord,
	estUuid,
	ligneProfil,
	nomAffichable,
	verifierActionSurProfil,
} from "./valeurs";
import "./racine";
import { echec, piedTexte, refus as accesRefuse, repondre } from "../../lib/ui";

/** Dix profils par page : la description d'un embed tient 4 096 caractères. */
const TAILLE_PAGE = 10;

/** Préfixe des boutons de pagination des profils. */
const PREFIXE_PAGE_PROFILS = "admusr";

/**
 * Préfixe des boutons de confirmation de CETTE unité.
 *
 * `valeurs.ts` expose bien `construireIdConfirmation`, mais son préfixe
 * `rgconf` est commun à toutes les racines. Or `@ButtonComponent` associe UN
 * gestionnaire à une expression rationnelle : si deux fichiers enregistraient
 * `^rgconf\|`, un seul gestionnaire recevrait les clics, et les confirmations
 * de l'autre répondraient « expirée » sans jamais s'exécuter. Un préfixe par
 * unité supprime la question.
 */
const PREFIXE_CONFIRMATION = "admcnf";

/**
 * Deux minutes pour confirmer.
 *
 * Assez long pour relire ce qu'on s'apprête à faire, assez court pour qu'un
 * bouton oublié dans un historique ne bannisse personne une heure plus tard.
 */
const DELAI_CONFIRMATION_MS = 2 * 60_000;

/** Longueur maximale acceptée pour une raison de bannissement. */
const LONGUEUR_RAISON = 200;

// ─── Confirmation en deux temps ─────────────────────────────────────────────

interface ConfirmationEnAttente {
	/** Seul l'auteur de la commande peut confirmer sa propre action. */
	readonly acteurDiscordId: string;
	/** Ce qu'on s'apprête à faire, en une ligne, pour l'accusé d'annulation. */
	readonly resume: string;
	readonly expireLe: number;
	/** Rend la phrase de succès. Lève sur panne : l'appelant la traduit. */
	readonly executer: (acteur: RgAdmin) => Promise<string>;
}

/** Actions armées mais pas encore confirmées, indexées par interaction d'origine. */
const CONFIRMATIONS = new Map<string, ConfirmationEnAttente>();

/**
 * Retire les confirmations périmées.
 *
 * Sans ce balayage, la carte grossirait indéfiniment : chaque action annulée en
 * fermant Discord y laisserait une fermeture vivante, et avec elle le profil
 * visé, pour toute la durée de vie du processus.
 */
function purgerConfirmations(maintenant = Date.now()): void {
	for (const [graine, attente] of CONFIRMATIONS) {
		if (attente.expireLe <= maintenant) {
			CONFIRMATIONS.delete(graine);
		}
	}
}

/**
 * Arme une action destructrice et demande confirmation.
 *
 * Exporté parce que `/administration equipe` s'en sert aussi : le périmètre de
 * cette unité ne permet pas de créer un troisième fichier, et dupliquer une
 * mécanique de confirmation garantirait qu'une des deux copies diverge.
 */
export async function demanderConfirmation(
	interaction: ChatInputCommandInteraction,
	options: {
		readonly titre: string;
		readonly description: string;
		readonly libelle: string;
		readonly resume: string;
		readonly executer: (acteur: RgAdmin) => Promise<string>;
	}
): Promise<void> {
	purgerConfirmations();

	const graine = interaction.id;
	const idOui = encoderEtatBouton(PREFIXE_CONFIRMATION, { r: "oui", g: graine });
	const idNon = encoderEtatBouton(PREFIXE_CONFIRMATION, { r: "non", g: graine });
	if (idOui === null || idNon === null) {
		// Impossible en pratique (un flocon fait 19 chiffres) mais un `custom_id`
		// trop long ferait échouer l'envoi ENTIER du message, sans rien dire.
		await interaction.editReply({ content: "❌ Confirmation impossible à composer." });
		return;
	}

	CONFIRMATIONS.set(graine, {
		acteurDiscordId: interaction.user.id,
		resume: options.resume,
		expireLe: Date.now() + DELAI_CONFIRMATION_MS,
		executer: options.executer,
	});

	// Bornage ici plutôt que chez chaque appelant : un titre de plus de 256
	// caractères ou une description de plus de 4 096 fait refuser le message
	// ENTIER par l'API — donc pas d'écran de confirmation, donc une action
	// destructrice qui reste armée en mémoire sans que personne ne puisse la
	// confirmer NI l'annuler. Le libellé d'un bouton plafonne, lui, à 80.
	const embed = rgEmbed()
		.setTitle(borner(options.titre, 256))
		.setDescription(borner(options.description, 4_096))
		.setFooter(piedTexte({ note: `Sans réponse dans les 2 minutes, rien ne sera fait.` }));

	await interaction.editReply({
		embeds: [embed],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(idOui)
					.setLabel(borner(options.libelle, 80))
					.setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId(idNon).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
			),
		],
	});
}

// ─── Lecture des profils ────────────────────────────────────────────────────

interface LigneListeProfil {
	id: string;
	username: string | null;
	full_name: string | null;
	role: string | null;
	discord_id: string | null;
	updated_at: Date | null;
	/** `count(*) OVER ()` : le total AVANT pagination, en une seule requête. */
	total: number;
}

/**
 * Cherche des profils, page par page.
 *
 * La recherche ne porte PAS sur l'e-mail, contrairement à l'ancienne. Taper une
 * adresse dans un champ de commande Discord, c'est l'écrire chez Discord — même
 * quand la réponse est éphémère. Recherche donc sur le pseudo, le nom affiché,
 * l'identifiant Discord et l'uuid, ce qui couvre tous les usages réels.
 */
async function chercherProfils(
	recherche: string | null,
	role: string | null,
	offset: number
): Promise<LigneListeProfil[]> {
	const motif = recherche === null ? null : `%${recherche}%`;
	return await sql<LigneListeProfil[]>`
		SELECT p.id, p.username, p.full_name, p.role, p.discord_id, p.updated_at,
		       (count(*) OVER ())::int AS total
		FROM profiles p
		WHERE (${role}::text IS NULL OR p.role = ${role})
		  AND (${motif}::text IS NULL
		       OR p.username ILIKE ${motif}
		       OR p.full_name ILIKE ${motif}
		       OR p.discord_id = ${recherche}
		       OR p.id::text = ${recherche})
		ORDER BY p.updated_at DESC NULLS LAST, p.id
		LIMIT ${TAILLE_PAGE} OFFSET ${offset}
	`;
}

interface FicheProfil {
	id: string;
	username: string | null;
	full_name: string | null;
	role: string | null;
	discord_id: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	bio: string | null;
	website: string | null;
	twitter_handle: string | null;
	patreon_id: string | null;
	badges: string[] | null;
	claimed_at: Date | null;
	updated_at: Date | null;
	/** Une liaison Discord existe-t-elle dans `account` (Better Auth) ? */
	compte_lie: boolean;
	/** VRAI/FAUX seulement : la fiche de livraison n'est jamais lue ni affichée. */
	adresse_renseignee: boolean;
}

/**
 * Résout un profil par uuid OU par identifiant Discord.
 *
 * Deux chemins, parce que la base en a deux : `profiles.discord_id` (1 836
 * lignes, alimenté par la synchronisation du serveur) et la table `account` de
 * Better Auth (7 lignes, alimentée par la connexion OAuth). L'ancienne commande
 * n'interrogeait que la seconde et ne trouvait donc quasiment personne.
 */
async function resoudreProfil(cle: string): Promise<FicheProfil | null> {
	const lignes = await sql<FicheProfil[]>`
		SELECT p.id, p.username, p.full_name, p.role, p.discord_id, p.avatar_url, p.banner_url,
		       p.bio, p.website, p.twitter_handle, p.patreon_id, p.badges, p.claimed_at, p.updated_at,
		       EXISTS (
		         SELECT 1 FROM account a
		         WHERE a.provider_id = 'discord' AND a.user_id = p.id::text
		       ) AS compte_lie,
		       (p.address_line1 IS NOT NULL) AS adresse_renseignee
		FROM profiles p
		WHERE p.id::text = ${cle}
		   OR p.discord_id = ${cle}
		   OR p.id::text IN (
		        SELECT a.user_id FROM account a
		        WHERE a.provider_id = 'discord' AND a.account_id = ${cle}
		      )
		ORDER BY p.updated_at DESC NULLS LAST
		LIMIT 1
	`;
	return lignes[0] ?? null;
}

/** Ce qu'on cherche : la mention l'emporte sur la saisie libre. */
function cleDemandee(membre: User | undefined, identifiant: string | undefined): string | null {
	if (membre) {
		return membre.id;
	}
	const propre = identifiant?.trim() ?? "";
	return propre.length > 0 ? propre : null;
}

/** Une page de résultats, boutons compris. */
async function rendrePageProfils(
	recherche: string | null,
	role: string | null,
	offset: number
): Promise<InteractionEditReplyOptions> {
	const lignes = await chercherProfils(recherche, role, Math.max(0, offset));
	const filtres = [
		recherche ? `recherche « ${borner(echapperMarkdown(recherche), 60)} »` : null,
		role ? `rôle \`${role}\`` : null,
	].filter((filtre): filtre is string => filtre !== null);

	if (lignes.length === 0) {
		return {
			content:
				filtres.length > 0
					? `Aucun profil ne correspond (${filtres.join(", ")}).`
					: "Aucun profil.",
			embeds: [],
			components: [],
		};
	}

	const total = lignes[0]!.total;
	const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
	const page = Math.floor(offset / TAILLE_PAGE) + 1;

	const embed = rgEmbed()
		.setTitle(`Profils — ${total.toLocaleString("fr-FR")}`)
		.setDescription(lignes.map((ligne) => ligneProfil(ligne)).join("\n"))
		.setFooter(
			piedTexte({
				page,
				pages,
				note:
					(filtres.length > 0 ? `${filtres.join(" · ")} · ` : "") +
					"ni e-mail ni adresse : un salon n'est pas un espace privé",
			})
		);

	const etatCommun = { q: recherche ?? "", r: role ?? "" };
	const idPrecedent = encoderEtatBouton(PREFIXE_PAGE_PROFILS, {
		...etatCommun,
		o: Math.max(0, offset - TAILLE_PAGE),
	});
	const idSuivant = encoderEtatBouton(PREFIXE_PAGE_PROFILS, {
		...etatCommun,
		o: offset + TAILLE_PAGE,
	});

	// Une recherche très longue ne rentre pas dans un `custom_id` : on sert alors
	// la page sans boutons plutôt que de voir tout le message refusé par l'API.
	const composants =
		pages > 1 && idPrecedent !== null && idSuivant !== null
			? [
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
					),
				]
			: [];

	return { content: "", embeds: [embed], components: composants };
}

// ─── Écritures ──────────────────────────────────────────────────────────────

/**
 * Écrit un rôle, à condition que le précédent n'ait pas bougé entre-temps.
 *
 * `role IS NOT DISTINCT FROM` (et pas `=`) parce que la colonne est nullable :
 * `role = NULL` ne serait jamais vrai et la mise à jour ne s'appliquerait
 * silencieusement à personne. Zéro ligne rendue = quelqu'un d'autre est passé
 * avant nous, et l'accusé de réception doit le dire plutôt que de mentir.
 */
async function ecrireRole(
	profileId: string,
	roleAttendu: string | null,
	nouveauRole: string
): Promise<boolean> {
	const lignes = await sql<Array<{ id: string }>>`
		UPDATE profiles
		SET role = ${nouveauRole}, updated_at = NOW()
		WHERE id = ${profileId} AND role IS NOT DISTINCT FROM ${roleAttendu}::text
		RETURNING id
	`;
	return lignes.length > 0;
}

/**
 * Applique un changement de rôle, trace, et rend la phrase d'accusé.
 *
 * L'invalidation du cache RBAC est ici et pas ailleurs : `lib/rbac.ts` garde sa
 * décision 60 secondes par identifiant Discord. Sans ce rappel, un compte
 * fraîchement banni gardait ses droits d'administration une minute entière —
 * largement de quoi se débannir.
 */
async function appliquerRole(
	acteur: RgAdmin,
	cible: FicheProfil,
	nouveauRole: string,
	action: string,
	details: Record<string, unknown> = {}
): Promise<string> {
	const applique = await ecrireRole(cible.id, cible.role, nouveauRole);
	if (!applique) {
		return (
			`⚠ Rien n'a été écrit : le rôle de **${echapperMarkdown(nomAffichable(cible))}** n'est ` +
			`plus \`${cible.role ?? "aucun"}\`. Quelqu'un est passé avant toi — relance la commande ` +
			"pour repartir de l'état réel."
		);
	}

	await logAdminAction({
		adminId: acteur.profileId,
		discordId: acteur.discordId,
		action,
		targetType: "profile",
		targetId: cible.id,
		details: {
			avant: cible.role,
			apres: nouveauRole,
			cible_username: cible.username,
			cible_discord_id: cible.discord_id,
			...details,
		},
	});

	if (cible.discord_id) {
		invalidateRbacCache(cible.discord_id);
	}

	return (
		`✓ **${echapperMarkdown(nomAffichable(cible))}** (\`${abregerIdentifiant(cible.id)}\`) : ` +
		decrireChangement(cible.role, nouveauRole)
	);
}

/**
 * Prépare une action de changement de rôle : résolution, garde-fous,
 * confirmation. Les trois sous-commandes destructrices partagent ce chemin —
 * elles ne diffèrent que par le rôle visé et le libellé.
 */
async function preparerChangementDeRole(
	interaction: ChatInputCommandInteraction,
	acteur: RgAdmin,
	cle: string | null,
	nouveauRole: string,
	options: {
		readonly titre: string;
		readonly libelle: string;
		readonly action: string;
		readonly raison?: string | null;
		readonly exigerRoleActuel?: string;
	}
): Promise<void> {
	if (cle === null) {
		await interaction.editReply({
			content:
				"Indique un membre (mention) ou un identifiant (uuid de profil ou identifiant Discord).",
		});
		return;
	}
	if (!estUuid(cle) && !estIdentifiantDiscord(cle)) {
		await interaction.editReply({
			content:
				`\`${borner(echapperMarkdown(cle), 60)}\` n'est ni un uuid de profil ni un identifiant ` +
				"Discord (17 à 20 chiffres). Mentionne le membre, ou copie son identifiant.",
		});
		return;
	}

	const cible = await resoudreProfil(cle);
	if (!cible) {
		await interaction.editReply({
			content:
				"Aucun profil ne porte cet identifiant. Un membre du serveur Discord n'a pas forcément " +
				"de profil sur le site : il s'en crée un à sa première connexion.",
		});
		return;
	}

	if (options.exigerRoleActuel && cible.role !== options.exigerRoleActuel) {
		await interaction.editReply({
			content: `**${echapperMarkdown(nomAffichable(cible))}** est \`${cible.role ?? "aucun"}\`, pas \`${options.exigerRoleActuel}\` : il n'y a rien à faire.`,
		});
		return;
	}

	const verdict = verifierActionSurProfil({
		acteurProfileId: acteur.profileId,
		cibleProfileId: cible.id,
		roleCible: cible.role,
		nouveauRole,
	});
	if (!verdict.autorise) {
		await repondre(interaction, accesRefuse(verdict.raison));
		return;
	}

	const raison = options.raison?.trim() ? borner(options.raison.trim(), LONGUEUR_RAISON) : null;
	const lignes = [
		ligneProfil(cible),
		"",
		`Rôle : ${decrireChangement(cible.role, nouveauRole)}`,
		raison ? `Raison : ${echapperMarkdown(raison)}` : null,
		cible.discord_id ? `Membre Discord : <@${cible.discord_id}>` : null,
	].filter((ligne): ligne is string => ligne !== null);

	await demanderConfirmation(interaction, {
		titre: options.titre,
		description: lignes.join("\n"),
		libelle: options.libelle,
		resume: `${options.action} sur \`${abregerIdentifiant(cible.id)}\``,
		executer: async (confirmant) =>
			await appliquerRole(confirmant, cible, nouveauRole, options.action, {
				raison,
			}),
	});
}

// ─── Commandes ──────────────────────────────────────────────────────────────

/**
 * Rôles proposés en FILTRE de lecture : tous, `superadmin` compris.
 *
 * Filtrer sur `superadmin` est une consultation légitime — savoir qui le porte
 * (deux comptes en production) est justement la raison pour laquelle on ne peut
 * pas y toucher depuis Discord.
 */
const CHOIX_ROLE_FILTRE = ROLES_ASSIGNABLES.map((role) => ({ name: role, value: role }));

/**
 * Rôles proposés à l'ÉCRITURE : les mêmes, moins les intouchables.
 *
 * Proposer `superadmin` dans la liste déroulante de `/administration
 * utilisateur role` revenait à offrir un choix que `verifierActionSurProfil`
 * refuse systématiquement : on faisait taper une commande entière, avec sa
 * cible, pour ne rendre qu'un refus. Le retirer de la liste dit la règle au
 * moment où elle s'applique, sans supprimer le garde-fou — la vérification
 * reste faite côté serveur, une option Discord n'étant qu'une suggestion.
 */
const CHOIX_ROLE_ASSIGNABLE = ROLES_ATTRIBUABLES.map((role) => ({ name: role, value: role }));

@Discord()
@SlashGroup({
	name: "utilisateur",
	description: "Profils du site : consulter, changer un rôle, bannir",
	root: "administration",
})
@SlashGroup("utilisateur", "administration")
export class AdministrationUtilisateurCommand {
	@Slash({
		name: "liste",
		description: "Cherche des profils (pseudo, nom, identifiant) et filtre par rôle",
	})
	async liste(
		@SlashOption({
			name: "recherche",
			description: "Pseudo, nom affiché, identifiant Discord ou uuid de profil",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 64,
		})
		recherche: string | undefined,
		@SlashChoice(...CHOIX_ROLE_FILTRE)
		@SlashOption({
			name: "role",
			description: "Ne garder que ce rôle (« member » couvre 1 839 profils sur 1 850)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		role: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		try {
			await interaction.editReply(
				await rendrePageProfils(recherche?.trim() || null, role ?? null, 0)
			);
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "info",
		description: "Fiche d'un profil — sans e-mail ni adresse, jamais",
	})
	async info(
		@SlashOption({
			name: "membre",
			description: "Le membre Discord",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		membre: User | undefined,
		@SlashOption({
			name: "identifiant",
			description: "uuid de profil ou identifiant Discord, à défaut de mention",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 40,
		})
		identifiant: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}

		const cle = cleDemandee(membre, identifiant);
		if (cle === null) {
			await interaction.editReply({
				content: "Mentionne un membre, ou donne un uuid de profil / un identifiant Discord.",
			});
			return;
		}

		try {
			const profil = await resoudreProfil(cle);
			if (!profil) {
				await interaction.editReply({
					content:
						"Aucun profil ne porte cet identifiant. Un membre du serveur Discord n'a pas " +
						"forcément de profil sur le site : il s'en crée un à sa première connexion.",
				});
				return;
			}

			const embed = rgEmbed()
				.setTitle(echapperMarkdown(nomAffichable(profil)))
				.setDescription(`\`${profil.id}\``)
				.addFields(
					{ name: "Rôle", value: `\`${profil.role ?? "user"}\``, inline: true },
					{
						name: "Pseudo",
						value: profil.username ? echapperMarkdown(profil.username) : "—",
						inline: true,
					},
					{
						name: "Discord",
						value: profil.discord_id ? `<@${profil.discord_id}>` : "—",
						inline: true,
					},
					{
						name: "Connexion Discord",
						value: profil.compte_lie ? "liée (OAuth)" : "non liée",
						inline: true,
					},
					{
						name: "Patreon",
						value: profil.patreon_id ? "rattaché" : "—",
						inline: true,
					},
					{
						name: "Badges",
						value: profil.badges && profil.badges.length > 0 ? profil.badges.join(" · ") : "—",
						inline: true,
					},
					{
						name: "Profil réclamé",
						value: horodatageRelatif(profil.claimed_at),
						inline: true,
					},
					{
						name: "Mis à jour",
						value: horodatageRelatif(profil.updated_at),
						inline: true,
					},
					{
						// Présence seulement : le contenu de la fiche de livraison ne
						// sort jamais d'ici, c'est la ligne rouge de cette unité.
						name: "Fiche de livraison",
						value: profil.adresse_renseignee ? "renseignée" : "absente",
						inline: true,
					}
				)
				.setFooter(
					piedTexte({
						note: "Ni e-mail ni adresse : ces colonnes ne sont même pas lues par cette commande.",
					})
				);

			if (profil.bio) {
				embed.addFields({ name: "Bio", value: borner(echapperMarkdown(profil.bio), 1_000) });
			}
			// `website` est un champ libre du profil : sur les 1 850 lignes, 7 le
			// portent sans être une URL (des blancs). Non rogné, il produisait une
			// ligne « Site : » vide ; non échappé, un `*` ou un `_` déformait le
			// reste du champ.
			const site = profil.website?.trim() ?? "";
			const liens = [
				site.length > 0 ? `Site : ${echapperMarkdown(site)}` : null,
				profil.twitter_handle ? `X : @${echapperMarkdown(profil.twitter_handle)}` : null,
			].filter((lien): lien is string => lien !== null);
			if (liens.length > 0) {
				embed.addFields({ name: "Liens", value: borner(liens.join("\n"), 1_000) });
			}
			// La vignette n'est posée que si la valeur EST une URL : Discord refuse
			// l'embed ENTIER sur une image invalide, et le refus ne dit pas laquelle
			// des dix propriétés est en cause. Aujourd'hui les 1 850 avatars sont en
			// `https://`, mais la colonne est du texte libre — le jour où une ligne
			// dévie, mieux vaut une fiche sans vignette qu'une commande muette.
			if (profil.avatar_url?.startsWith("https://")) {
				embed.setThumbnail(profil.avatar_url);
			}

			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "role",
		description: "Change le rôle d'un profil (confirmation, journalisé)",
	})
	async role(
		@SlashChoice(...CHOIX_ROLE_ASSIGNABLE)
		@SlashOption({
			name: "role",
			description: "Le nouveau rôle",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		role: string,
		@SlashOption({
			name: "membre",
			description: "Le membre Discord",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		membre: User | undefined,
		@SlashOption({
			name: "identifiant",
			description: "uuid de profil ou identifiant Discord, à défaut de mention",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 40,
		})
		identifiant: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const acteur = await exigerDroits(interaction, { strict: true });
		if (!acteur) {
			return;
		}
		try {
			await preparerChangementDeRole(interaction, acteur, cleDemandee(membre, identifiant), role, {
				titre: "Changer le rôle de ce profil ?",
				libelle: "Changer le rôle",
				action: "utilisateur.role",
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "bannir",
		description: "Passe un profil en « banned » (confirmation, journalisé)",
	})
	async bannir(
		@SlashOption({
			name: "membre",
			description: "Le membre Discord",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		membre: User | undefined,
		@SlashOption({
			name: "identifiant",
			description: "uuid de profil ou identifiant Discord, à défaut de mention",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 40,
		})
		identifiant: string | undefined,
		@SlashOption({
			name: "raison",
			description: "Pourquoi — conservée dans le journal d'audit",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: LONGUEUR_RAISON,
		})
		raison: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const acteur = await exigerDroits(interaction, { strict: true });
		if (!acteur) {
			return;
		}
		try {
			await preparerChangementDeRole(
				interaction,
				acteur,
				cleDemandee(membre, identifiant),
				"banned",
				{
					titre: "Bannir ce profil ?",
					libelle: "Bannir",
					action: "utilisateur.bannir",
					raison,
				}
			);
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({
		name: "debannir",
		description: "Rend un profil banni à « member », le rôle par défaut réel",
	})
	async debannir(
		@SlashOption({
			name: "membre",
			description: "Le membre Discord",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		membre: User | undefined,
		@SlashOption({
			name: "identifiant",
			description: "uuid de profil ou identifiant Discord, à défaut de mention",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 40,
		})
		identifiant: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const acteur = await exigerDroits(interaction, { strict: true });
		if (!acteur) {
			return;
		}
		try {
			// « member », pas « user » : l'ancienne commande rendait un rôle que 1
			// seul compte porte en base, sortant le membre de la population normale
			// du site (1 839 profils sont `member`).
			await preparerChangementDeRole(
				interaction,
				acteur,
				cleDemandee(membre, identifiant),
				"member",
				{
					titre: "Lever le bannissement ?",
					libelle: "Débannir",
					action: "utilisateur.debannir",
					exigerRoleActuel: "banned",
				}
			);
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	/**
	 * Pagination de `/administration utilisateur liste`.
	 *
	 * Tout l'état vient du `custom_id` : aucune mémoire de processus, donc un
	 * redémarrage du bot ne laisse jamais de bouton mort. Les droits sont
	 * revérifiés — le message est éphémère, donc seul son destinataire peut
	 * cliquer, mais son rôle a pu lui être retiré entre-temps.
	 */
	@ButtonComponent({ id: new RegExp(`^${PREFIXE_PAGE_PROFILS}\\|`) })
	async paginerProfils(interaction: ButtonInteraction) {
		const etat = decoderEtatBouton(PREFIXE_PAGE_PROFILS, interaction.customId);
		if (etat === null) {
			await interaction.reply({
				content: "Pagination illisible.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.deferUpdate();
		try {
			// Même exigence que la sous-commande `liste` : lecture, donc garde
			// simple. Revérifiée ici parce qu'un rôle a pu être retiré depuis
			// l'affichage de la première page.
			await requireRgAdmin(interaction.user.id);
		} catch (err) {
			await interaction.editReply({
				content: `🚫 ${err instanceof NotAdminError ? err.message : "Impossible de vérifier tes droits."}`,
				embeds: [],
				components: [],
			});
			return;
		}
		try {
			const offset = Number.parseInt(etat.o ?? "0", 10);
			await interaction.editReply(
				await rendrePageProfils(
					etat.q && etat.q.length > 0 ? etat.q : null,
					etat.r && etat.r.length > 0 ? etat.r : null,
					Number.isFinite(offset) ? offset : 0
				)
			);
		} catch (err) {
			await interaction.followUp({
				content: `❌ ${messagePanne(err)}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

/**
 * Le gestionnaire des boutons de confirmation de `/administration`.
 *
 * Classe à part parce qu'il sert AUSSI `/administration equipe` : un seul
 * gestionnaire pour un préfixe, sinon les clics d'un des deux fichiers
 * partiraient dans le vide.
 *
 * Pourquoi un `@ButtonComponent` et pas un collecteur de composants : le filet
 * de `src/index.ts` répond « Commande inconnue ou expirée » à toute interaction
 * qu'aucun gestionnaire ne réclame. Un collecteur laisserait donc la course
 * s'installer entre notre confirmation et ce message d'erreur.
 */
@Discord()
export class ConfirmationAdministration {
	@ButtonComponent({ id: new RegExp(`^${PREFIXE_CONFIRMATION}\\|`) })
	async repondre(interaction: ButtonInteraction) {
		const etat = decoderEtatBouton(PREFIXE_CONFIRMATION, interaction.customId);
		const graine = etat?.g;
		if (!graine || (etat?.r !== "oui" && etat?.r !== "non")) {
			await interaction.reply({
				content: "Bouton de confirmation illisible.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		purgerConfirmations();
		const attente = CONFIRMATIONS.get(graine);
		if (!attente) {
			await interaction.update({
				content:
					"Cette confirmation a expiré (2 minutes) ou le bot a redémarré. Rien n'a été fait — " +
					"relance la commande.",
				embeds: [],
				components: [],
			});
			return;
		}
		if (interaction.user.id !== attente.acteurDiscordId) {
			await interaction.reply({
				content: "Cette confirmation appartient à quelqu'un d'autre.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Retirée AVANT toute attente : deux clics rapides sur « confirmer » ne
		// doivent pas exécuter l'action deux fois.
		CONFIRMATIONS.delete(graine);

		if (etat.r === "non") {
			await interaction.update({
				content: `Annulé — ${attente.resume}. Rien n'a été écrit.`,
				embeds: [],
				components: [],
			});
			return;
		}

		await interaction.deferUpdate();

		let acteur: RgAdmin;
		try {
			// Revérifié au moment d'écrire, pas au moment d'afficher : un rôle a pu
			// être retiré entre l'armement et le clic.
			acteur = await requireRgAdminStrict(interaction.user.id);
		} catch (err) {
			await interaction.editReply({
				content: `🚫 ${err instanceof NotAdminError ? err.message : "Impossible de vérifier tes droits."}`,
				embeds: [],
				components: [],
			});
			return;
		}

		try {
			const message = await attente.executer(acteur);
			await interaction.editReply({ content: message, embeds: [], components: [] });
		} catch (err) {
			await interaction.editReply({
				content: `❌ ${messagePanne(err)}`,
				embeds: [],
				components: [],
			});
		}
	}
}
