/**
 * `/membre` — qui est qui, côté site et côté serveur Discord.
 *
 * ── POURQUOI CETTE COMMANDE EXISTE ─────────────────────────────────────────
 * `/profil` regardait la table `profiles` (le compte sur rosegriffon.fr) et
 * `/member` la table `discord_members` (la présence sur le serveur). Deux
 * commandes voisines pour deux moitiés de la même personne : sur les
 * 1 850 profils, **1 832 portent un `discord_id` qui correspond à une ligne de
 * `discord_members`** (2 075 membres au total). Les séparer obligeait à taper
 * deux commandes pour voir un seul individu ; les réunir permet à chaque
 * sous-commande de montrer l'autre moitié quand elle existe — c'est tout
 * l'intérêt de la fusion.
 *
 * ── LIGNE ROUGE VIE PRIVÉE ─────────────────────────────────────────────────
 * `profiles` contient `email`, `full_name`, `address_line1`, `address_line2`,
 * `city`, `postal_code`, `country`, `patreon_id`. Aucune de ces colonnes ne sort
 * d'ici, pour personne, administrateur compris — ce sont EXACTEMENT celles que
 * le rôle `anon` n'a plus le droit de lire depuis le 11/8/2026 (droits par
 * colonne relevés en base le 13/8/2026 ; cf. `CLES_PII_PROFIL`). `full_name` en
 * fait partie : la migration le nomme « nom complet », et 2 des 33 valeurs
 * renseignées sont bel et bien un prénom suivi d'un nom. Le titre de l'embed
 * s'appuie donc sur le PSEUDO, jamais sur l'état civil.
 * Deux barrières, volontairement redondantes :
 *
 *   1. les requêtes ci-dessous énumèrent leurs colonnes une par une — il n'y a
 *      pas un seul `SELECT *` dans ce fichier ;
 *   2. `assainirProfil` (`lib/communaute-format.ts`) retire les clés
 *      personnelles de l'objet avant qu'il n'atteigne un embed.
 *
 * La seconde existe parce que le bot lit par la connexion Postgres directe, qui
 * contourne les droits par colonne posés par `20260811_profiles_pii.sql` :
 * ici, rien d'autre que notre propre discipline ne protège ces champs. Un
 * `SELECT *` ajouté un jour par distraction ne doit pas suffire à publier une
 * adresse postale dans un salon.
 *
 * ── AMÉLIORATION SUR `/member` ─────────────────────────────────────────────
 * L'ancienne commande n'affichait qu'un `roles_count`. Les 93 rôles du serveur
 * sont en base (`discord_roles`, avec `name` et `position`) : on rend les vrais
 * noms, du plus haut au plus bas comme Discord les ordonne.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	AttachmentBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";

import { cached } from "../lib/cache";
import { renderMemberList, renderProfileCard } from "../lib/canvas/cards";
import {
	ancienneteJours,
	assainirProfil,
	dateCourte,
	horodatageRelatif,
	indexerRoles,
	libelleAnciennete,
	ligneMembreDiscord,
	listerRoles,
	motifRecherche,
	nomAffiche,
	rechercheExploitable,
	resoudreRoles,
	type LigneMembreDiscord,
	type RoleDiscord,
} from "../lib/communaute-format";
import { sql } from "../lib/db";
import { rgEmbed, truncate } from "../lib/embeds";

/**
 * Le profil tel qu'il peut être affiché — la définition NE CONTIENT PAS les
 * colonnes personnelles, pour que le compilateur refuse une requête qui les
 * ramènerait par mégarde.
 */
interface ProfilPublic extends Record<string, unknown> {
	id: string;
	username: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	bio: string | null;
	role: string | null;
	twitter_handle: string | null;
	website: string | null;
	discord_id: string | null;
	badges: string[] | null;
	claimed_at: string | null;
}

const TTL_ROLES_MS = 10 * 60_000;

/** Les 93 rôles du serveur, relus toutes les 10 minutes — un rôle change rarement. */
async function indexRoles() {
	const roles = await cached<RoleDiscord[]>("membre:roles", TTL_ROLES_MS, async () => {
		return await sql<RoleDiscord[]>`
			SELECT role_id, name, position FROM discord_roles
		`;
	});
	return indexerRoles(roles);
}

async function profilPar(cle: string): Promise<ProfilPublic | null> {
	// `id` est un uuid : comparer en texte évite une erreur de conversion quand
	// la saisie est un pseudo ou un identifiant Discord.
	const lignes = await sql<ProfilPublic[]>`
		SELECT id::text, username, avatar_url, banner_url, bio, role,
		       twitter_handle, website, discord_id, badges, claimed_at::text
		FROM profiles
		WHERE username = ${cle} OR discord_id = ${cle} OR id::text = ${cle}
		LIMIT 1
	`;
	const profil = lignes[0];
	return profil ? (assainirProfil(profil) as ProfilPublic) : null;
}

/**
 * Repli sur le PSEUDO DISCORD.
 *
 * Un membre lit le pseudo de quelqu'un dans Discord et le tape ici ; or c'est le
 * pseudo du SITE que `profiles` indexe, et les deux divergent sur 3 des
 * 1 832 comptes liés (`fox.xx17` → `zever2emedunom_75078`, `imsupercrazy` →
 * `icanseefix`, `ayouninho.yb` → `ay78.`). Sans ce repli, ces trois-là
 * s'entendent répondre que le compte n'existe pas alors qu'il existe : la
 * fusion des deux moitiés doit justement servir à ça.
 */
async function profilParPseudoDiscord(pseudo: string): Promise<ProfilPublic | null> {
	const lignes = await sql<Array<{ discord_id: string }>>`
		SELECT discord_id FROM discord_members WHERE username = ${pseudo} LIMIT 1
	`;
	const identifiant = lignes[0]?.discord_id;
	return identifiant ? await profilPar(identifiant) : null;
}

async function membrePar(cle: string): Promise<LigneMembreDiscord | null> {
	const lignes = await sql<LigneMembreDiscord[]>`
		SELECT discord_id, username, display_name, nickname, avatar_url, roles,
		       joined_at, premium_since, left_at
		FROM discord_members
		WHERE discord_id = ${cle} OR username = ${cle}
		LIMIT 1
	`;
	return lignes[0] ?? null;
}

/** Le pseudo du compte site lié à un identifiant Discord, s'il y en a un. */
async function pseudoProfilLie(discordId: string): Promise<string | null> {
	const lignes = await sql<Array<{ username: string | null }>>`
		SELECT username FROM profiles WHERE discord_id = ${discordId} LIMIT 1
	`;
	return lignes[0]?.username ?? null;
}

function messageErreur(err: unknown): string {
	return `Impossible de lire les données de membre : ${err instanceof Error ? err.message : String(err)}`;
}

@Discord()
@SlashGroup({
	name: "membre",
	description: "Le compte site et la présence Discord d'un membre Rose Griffon",
})
@SlashGroup("membre")
export class MembreCommand {
	// `compte` et non `profil` : `/profil` désigne désormais la carte de
	// progression d'un membre (XP, niveau, jetons Kizuna). Deux « profil » dans la
	// même liste d'autocomplétion, personne ne sait lequel il déclenche.
	@Slash({ name: "compte", description: "Le compte d'un membre sur rosegriffon.fr" })
	async profil(
		@SlashOption({
			name: "qui",
			description: "Pseudo du site ou de Discord, identifiant Discord, identifiant de compte",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		qui: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		// Sans argument, on montre le compte de celui qui demande : c'est le cas
		// d'usage le plus courant, et il ne réclame aucune saisie.
		const cle = (qui ?? interaction.user.id).trim();
		try {
			// Deux passes : d'abord les clés du SITE, puis le pseudo Discord — un
			// membre tape le plus souvent le pseudo qu'il a sous les yeux.
			const profil = (await profilPar(cle)) ?? (await profilParPseudoDiscord(cle));
			if (!profil) {
				await interaction.editReply({
					content: qui
						? `Aucun compte rosegriffon.fr ne correspond à « ${truncate(cle, 80)} ».`
						: "Ton compte Discord n'est lié à aucun compte rosegriffon.fr. Connecte-toi sur le site avec Discord pour les rattacher.",
				});
				return;
			}

			const membre = profil.discord_id ? await membrePar(profil.discord_id) : null;

			const embed = rgEmbed()
				.setTitle(truncate(profil.username || "Membre Rose Griffon", 250))
				.setDescription(truncate(profil.bio, 1500) || "Ce compte n'a pas encore de présentation.")
				.addFields(
					{ name: "Pseudo", value: profil.username ?? "—", inline: true },
					{ name: "Rôle sur le site", value: profil.role ?? "membre", inline: true }
				);

			if (profil.badges && profil.badges.length > 0) {
				embed.addFields({
					name: `Badges (${profil.badges.length})`,
					value: truncate(profil.badges.join(", "), 1000),
					inline: false,
				});
			}

			// La moitié Discord de la personne — la raison d'être de la fusion.
			if (membre) {
				const index = await indexRoles();
				const roles = resoudreRoles(membre.roles, index);
				const arrivee = horodatageRelatif(membre.joined_at);
				embed.addFields({
					name: "Sur le serveur Discord",
					value: truncate(
						[
							`**${nomAffiche(membre)}** (\`${membre.username}\`)`,
							`Arrivé ${arrivee ?? "à une date inconnue"}`,
							`Rôles : ${listerRoles(roles, 8)}`,
						].join("\n"),
						1000
					),
					inline: false,
				});
			} else if (profil.discord_id) {
				embed.addFields({
					name: "Sur le serveur Discord",
					value: "Compte Discord lié, mais absent du serveur Rose Griffon.",
					inline: false,
				});
			}

			const liens: string[] = [];
			if (profil.website) liens.push(`[Site personnel](${profil.website})`);
			if (profil.twitter_handle) {
				const pseudo = profil.twitter_handle.replace(/^@/, "");
				liens.push(`[@${pseudo}](https://x.com/${pseudo})`);
			}
			if (liens.length > 0) {
				embed.addFields({ name: "Liens", value: liens.join(" · "), inline: false });
			}
			if (profil.claimed_at) {
				embed.addFields({
					name: "Compte réclamé le",
					value: dateCourte(profil.claimed_at),
					inline: true,
				});
			}
			if (profil.avatar_url) embed.setThumbnail(profil.avatar_url);

			// La carte image reprend la DA de l'ancienne `/profil`. Un échec de rendu
			// (avatar distant injoignable, police manquante) ne doit pas priver le
			// membre de l'embed, qui porte l'information.
			let fichiers: AttachmentBuilder[] = [];
			try {
				const png = await renderProfileCard({
					username: profil.username,
					// `renderProfileCard` met le nom complet en gros titre : on lui en
					// refuse un. La carte retombe sur le pseudo, comme l'embed — et la
					// colonne n'est de toute façon plus lue.
					full_name: null,
					avatar_url: profil.avatar_url,
					banner_url: profil.banner_url,
					bio: profil.bio,
					role: profil.role,
					twitter_handle: profil.twitter_handle,
					website: profil.website,
					discord_id: profil.discord_id,
				});
				fichiers = [new AttachmentBuilder(png, { name: "rg-profil.png" })];
			} catch (err) {
				console.warn("[membre] rendu de la carte de profil impossible :", err);
			}

			await interaction.editReply({ embeds: [embed], files: fichiers });
		} catch (err) {
			await interaction.editReply({ content: messageErreur(err) });
		}
	}

	@Slash({ name: "discord", description: "La fiche d'un membre du serveur Discord" })
	async discord(
		@SlashOption({
			name: "qui",
			description: "Membre du serveur (par défaut : toi)",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		qui: { id: string } | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		const identifiant = qui?.id ?? interaction.user.id;
		try {
			const membre = await membrePar(identifiant);
			if (!membre) {
				await interaction.editReply({
					content:
						"Ce membre n'est pas encore dans la base du serveur. La synchronisation tourne toutes les 30 minutes.",
				});
				return;
			}

			const index = await indexRoles();
			const roles = resoudreRoles(membre.roles, index);
			const maintenant = new Date();
			const jours = ancienneteJours(membre.joined_at, maintenant);
			const pseudoSite = await pseudoProfilLie(membre.discord_id);

			const embed = rgEmbed()
				.setTitle(truncate(nomAffiche(membre), 250))
				.setDescription(`\`${membre.username}\` · <@${membre.discord_id}>`)
				.addFields(
					{
						name: "Arrivé sur le serveur",
						value: membre.joined_at
							? `${dateCourte(membre.joined_at)}\n${horodatageRelatif(membre.joined_at)}`
							: "date inconnue",
						inline: true,
					},
					{ name: "Ancienneté", value: libelleAnciennete(jours), inline: true },
					{
						name: "Boost du serveur",
						value: membre.premium_since ? `depuis le ${dateCourte(membre.premium_since)}` : "non",
						inline: true,
					},
					{
						name: `Rôles (${roles.length})`,
						value: truncate(listerRoles(roles, 15), 1000),
						inline: false,
					},
					{
						name: "Compte rosegriffon.fr",
						value: pseudoSite ? `lié — \`${pseudoSite}\`` : "aucun compte lié",
						inline: false,
					}
				);

			if (membre.left_at) {
				embed.addFields({
					name: "Départ",
					value: `A quitté le serveur le ${dateCourte(membre.left_at)}`,
					inline: false,
				});
			}
			if (membre.avatar_url) embed.setThumbnail(membre.avatar_url);

			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await interaction.editReply({ content: messageErreur(err) });
		}
	}

	@Slash({ name: "recherche", description: "Chercher un membre par pseudo ou nom affiché" })
	async recherche(
		@SlashOption({
			name: "texte",
			description: "Pseudo, nom affiché ou surnom (2 caractères minimum)",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 2,
		})
		texte: string,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		if (!rechercheExploitable(texte)) {
			await interaction.editReply({ content: "Il faut au moins deux caractères pour chercher." });
			return;
		}
		const motif = motifRecherche(texte);
		try {
			// Une seule requête, jointure comprise : le rattachement au compte site
			// est ce que la fusion apporte, il doit apparaître dès la liste.
			const lignes = await sql<Array<LigneMembreDiscord & { profil: string | null }>>`
				SELECT d.discord_id, d.username, d.display_name, d.nickname, d.avatar_url,
				       d.roles, d.joined_at, d.premium_since, d.left_at,
				       p.username AS profil
				FROM discord_members d
				LEFT JOIN profiles p ON p.discord_id = d.discord_id
				WHERE d.is_bot = false
				  AND (d.username ILIKE ${motif} OR d.display_name ILIKE ${motif} OR d.nickname ILIKE ${motif})
				ORDER BY d.left_at NULLS FIRST, d.joined_at
				LIMIT 25
			`;

			if (lignes.length === 0) {
				await interaction.editReply({
					content: `Aucun membre ne correspond à « ${truncate(texte.trim(), 80)} ».`,
				});
				return;
			}

			const embed = rgEmbed()
				.setTitle(
					`${lignes.length} membre${lignes.length > 1 ? "s" : ""} pour « ${truncate(texte.trim(), 60)} »`
				)
				.setDescription(
					truncate(lignes.map((l) => ligneMembreDiscord(l, l.profil !== null)).join("\n"), 4000)
				);

			// La carte image reprend la DA de l'ancienne `/member` (30 lignes au plus).
			let fichiers: AttachmentBuilder[] = [];
			try {
				const png = await renderMemberList(
					lignes.map((l) => ({
						username: l.username,
						display_name: nomAffiche(l),
						avatar_url: l.avatar_url,
						roles_count: l.roles?.length ?? 0,
						joined_at: l.joined_at,
					}))
				);
				fichiers = [new AttachmentBuilder(png, { name: "rg-membres.png" })];
			} catch (err) {
				console.warn("[membre] rendu de la liste impossible :", err);
			}

			await interaction.editReply({ embeds: [embed], files: fichiers });
		} catch (err) {
			await interaction.editReply({ content: messageErreur(err) });
		}
	}
}
