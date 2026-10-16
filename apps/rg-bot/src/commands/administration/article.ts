/**
 * `/administration article` — l'état de publication des articles, depuis Discord.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * `/rg-chronique-admin list|publish|unpublish|archive|delete`. La reprise n'est
 * pas une recopie : les défauts ci-dessous étaient réels et mesurés sur la base
 * de production le 13/8/2026.
 *
 *  1. `published_at` ÉTAIT ÉCRASÉ À CHAQUE PUBLICATION. L'ancienne requête
 *     écrivait `published_at = COALESCE(<maintenant>, published_at)` : comme
 *     `<maintenant>` n'est jamais nul, `COALESCE` rendait toujours l'instant
 *     courant. Republier un article déjà publié — ce qu'on fait en corrigeant
 *     une coquille — remontait donc l'article en tête de `/article derniers` et
 *     de la page d'accueil des deux sites, en réécrivant sa date de parution.
 *     Ici la date d'origine est PRÉSERVÉE, et n'est posée que si elle manque.
 *
 *  2. La réponse ne nommait pas l'article. « ✓ Article `3cb183ae` publié » ne
 *     permet pas de vérifier qu'on a agi sur le bon : un UUID abrégé ne se
 *     relit pas. On répond désormais avec le titre RÉEL rendu par `RETURNING`,
 *     donc avec ce que la base contient après écriture, pas avec ce qu'on
 *     croyait y mettre.
 *
 *  3. Il fallait connaître l'UUID par cœur. L'option accepte maintenant l'UUID
 *     ou le slug, et l'autocomplétion propose les articles par titre — tous
 *     statuts confondus, brouillons compris, ce que la commande publique ne
 *     peut pas faire.
 *
 *  4. Aucune vérification préalable : archiver un article déjà archivé écrivait
 *     quand même et journalisait un changement qui n'avait pas eu lieu. On lit
 *     l'état avant, on n'écrit que s'il change, et l'audit porte « avant →
 *     après ».
 *
 *  5. `delete` faisait un `DELETE` sec, sans retour arrière possible. Il n'est
 *     PAS repris : `archiver` couvre le besoin réel (retirer du public) sans
 *     détruire un texte. Une suppression définitive reste possible depuis
 *     l'administration du site, avec la sauvegarde de la base derrière.
 *
 * ── LA COMMANDE PUBLIQUE `/article` EST L'AUTRE MOITIÉ ─────────────────────
 * `commands/article.ts` LIT (`derniers`, `lire`, `recherche`) et ne connaît que
 * les articles publiés. Ici on ÉCRIT. Les deux partagent la mise en forme
 * (`lib/communaute-format.ts` : `urlArticle`, `siteArticle`, `dateCourte`) : le
 * lien produit par un accusé de réception est exactement celui que le public
 * verra. Publier invalide aussi l'index d'autocomplétion de la commande
 * publique, sans quoi un article fraîchement publié restait introuvable
 * pendant trois minutes.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { dateCourte, siteArticle, urlArticle } from "../../lib/communaute-format";
import { sql } from "../../lib/db";
import { rgEmbed, truncate } from "../../lib/embeds";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import {
	CHOIX_STATUT_ARTICLE,
	badgeStatutArticle,
	decrireChangement,
	libelleStatutArticle,
	type StatutArticle,
} from "./valeurs";
import "./racine-gestion";
import { echec, piedTexte, repondre } from "../../lib/ui";

/**
 * Colonnes énumérées une par une.
 *
 * `articles` ne contient aucune donnée personnelle, mais `content` pèse
 * plusieurs dizaines de kilo-octets par ligne : le tirer pour afficher un titre
 * ferait transiter tout le corps de l'article à chaque `liste`.
 */
interface ArticleAdmin {
	id: string;
	title: string;
	slug: string;
	app: string;
	/** Nullable en base : la contrainte `articles_status_check` laisse passer NULL. */
	status: string | null;
	category: string | null;
	published_at: Date | string | null;
	updated_at: Date | string | null;
}

/** Index d'autocomplétion : court, et rafraîchi assez vite pour suivre une publication. */
const TTL_INDEX_MS = 30_000;
const CLEF_INDEX = "administration:article:index";
/** Index de la commande PUBLIQUE, à invalider dès qu'un statut change. */
const CLEF_INDEX_PUBLIC = "article:index";

const CHOIX_SITE = [
	{ name: "rosegriffon.fr", value: "website" },
	{ name: "Azalée (wiki IEVR)", value: "azalee" },
] as const;

/**
 * Liste filtrée.
 *
 * Les deux filtres sont facultatifs et passent par la même requête : le motif
 * `${x}::text IS NULL OR colonne = ${x}` laisse Postgres court-circuiter le
 * prédicat quand le paramètre est nul, et évite trois variantes de requête à
 * maintenir en parallèle (l'ancien `services/admin.ts` en gardait quatre).
 */
async function listerArticles(
	statut: string | null,
	app: string | null,
	limite: number
): Promise<ArticleAdmin[]> {
	return await sql<ArticleAdmin[]>`
		SELECT id::text, title::text, slug::text, app, status::text,
		       category::text, published_at, updated_at
		FROM articles
		WHERE (${statut}::text IS NULL OR status = ${statut})
		  AND (${app}::text IS NULL OR app = ${app})
		ORDER BY updated_at DESC NULLS LAST
		LIMIT ${limite}
	`;
}

/**
 * Résout la saisie en un article : UUID ou slug, indifféremment.
 *
 * `id::text = ${reference}` plutôt que `id = ${reference}` : comparer un `uuid`
 * à une saisie libre fait lever Postgres (« invalid input syntax for type
 * uuid ») dès qu'on tape un slug, et l'erreur remontait brute dans le salon.
 */
async function resoudreArticle(reference: string): Promise<ArticleAdmin | null> {
	const lignes = await sql<ArticleAdmin[]>`
		SELECT id::text, title::text, slug::text, app, status::text,
		       category::text, published_at, updated_at
		FROM articles
		WHERE id::text = ${reference} OR slug = ${reference}
		LIMIT 1
	`;
	return lignes[0] ?? null;
}

/**
 * Écrit le nouvel état et rend la ligne telle qu'elle est APRÈS écriture.
 *
 * `published_at` n'est posée que si elle manque : republier ne réécrit jamais
 * la date de parution (cf. l'en-tête de ce fichier). `updated_at` est mise à
 * jour à la main — il n'existe aucun déclencheur sur `articles` (vérifié :
 * `pg_trigger` ne rend aucune ligne non interne pour cette table).
 */
async function ecrireStatut(id: string, statut: StatutArticle): Promise<ArticleAdmin | null> {
	const lignes = await sql<ArticleAdmin[]>`
		UPDATE articles
		   SET status = ${statut},
		       published_at = CASE
		           WHEN ${statut}::text = 'published' AND published_at IS NULL THEN NOW()
		           ELSE published_at
		       END,
		       updated_at = NOW()
		 WHERE id::text = ${id}
		RETURNING id::text, title::text, slug::text, app, status::text,
		          category::text, published_at, updated_at
	`;
	return lignes[0] ?? null;
}

async function indexArticles(): Promise<ArticleAdmin[]> {
	return await cached(CLEF_INDEX, TTL_INDEX_MS, async () => {
		return await sql<ArticleAdmin[]>`
			SELECT id::text, title::text, slug::text, app, status::text,
			       category::text, published_at, updated_at
			FROM articles
			ORDER BY updated_at DESC NULLS LAST
			LIMIT 100
		`;
	});
}

/** Une ligne de liste : état, titre cliquable, site, catégorie, dernière retouche. */
function ligneArticle(article: ArticleAdmin): string {
	const site = siteArticle(article.app);
	const meta = [site.libelle];
	if (article.category) {
		meta.push(article.category);
	}
	meta.push(`modifié le ${dateCourte(article.updated_at)}`);
	return (
		`${badgeStatutArticle(article.status)} **[${truncate(article.title, 90)}]` +
		`(${urlArticle(article.app, article.slug)})**\n` +
		`\`${article.slug}\` · *${meta.join(" · ")}*`
	);
}

/**
 * Assemble une description sans jamais dépasser les 4 096 caractères d'un
 * embed : un dépassement fait rejeter le message ENTIER par Discord, pas
 * seulement la partie fautive.
 */
function descriptionListe(articles: readonly ArticleAdmin[]): string {
	const lignes: string[] = [];
	let taille = 0;
	for (const article of articles) {
		const ligne = ligneArticle(article);
		if (taille + ligne.length + 2 > 4_000) {
			break;
		}
		lignes.push(ligne);
		taille += ligne.length + 2;
	}
	return lignes.join("\n\n");
}

@Discord()
@SlashGroup({
	name: "article",
	description: "Publier, dépublier ou archiver un article des deux sites",
	root: "gestion",
})
@SlashGroup("article", "gestion")
export class AdministrationArticleCommand {
	@Slash({
		name: "liste",
		description: "Les articles des deux sites, brouillons et archives compris",
	})
	async liste(
		@SlashChoice(...CHOIX_STATUT_ARTICLE)
		@SlashOption({
			name: "statut",
			description: "N'afficher qu'un état (par défaut : tous)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		statut: string | undefined,
		@SlashChoice(...CHOIX_SITE)
		@SlashOption({
			name: "site",
			description: "N'afficher qu'un site (par défaut : les deux)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		site: string | undefined,
		@SlashOption({
			name: "nombre",
			description: "Nombre d'articles (1 à 25, 10 par défaut)",
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
		try {
			const articles = await listerArticles(statut ?? null, site ?? null, nombre ?? 10);
			const portee = [
				statut ? libelleStatutArticle(statut) : null,
				site ? siteArticle(site).libelle : null,
			].filter((morceau): morceau is string => morceau !== null);

			if (articles.length === 0) {
				await interaction.editReply({
					content:
						portee.length > 0
							? `Aucun article ne correspond à ce filtre (${portee.join(" · ")}).`
							: "La table `articles` ne contient aucune ligne.",
				});
				return;
			}

			// Le décompte par état est plus utile que le total : c'est lui qui dit
			// s'il reste des brouillons à publier.
			const parEtat = new Map<string, number>();
			for (const article of articles) {
				const etat = article.status ?? "sans état";
				parEtat.set(etat, (parEtat.get(etat) ?? 0) + 1);
			}
			const repartition = [...parEtat.entries()]
				.map(([etat, nb]) => `${badgeStatutArticle(etat)} ${nb} ${libelleStatutArticle(etat)}`)
				.join(" · ");

			const filtre = portee.length > 0 ? ` — ${portee.join(" · ")}` : "";
			const embed = rgEmbed()
				.setTitle(`${articles.length} article${articles.length > 1 ? "s" : ""}${filtre}`)
				.setDescription(descriptionListe(articles))
				.setFooter(
					piedTexte({
						note: `${repartition} · publier avec /administration article publier`,
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "publier", description: "Rendre un article visible du public" })
	async publier(
		@SlashOption({
			name: "article",
			description: "Titre de l'article (autocomplété), son slug ou son UUID",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: proposerArticles,
		})
		reference: string,
		interaction: ChatInputCommandInteraction
	) {
		await this.changerStatut(interaction, reference, "published");
	}

	@Slash({ name: "depublier", description: "Repasser un article en brouillon" })
	async depublier(
		@SlashOption({
			name: "article",
			description: "Titre de l'article (autocomplété), son slug ou son UUID",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: proposerArticles,
		})
		reference: string,
		interaction: ChatInputCommandInteraction
	) {
		await this.changerStatut(interaction, reference, "draft");
	}

	@Slash({
		name: "archiver",
		description: "Retirer un article du public sans le détruire",
	})
	async archiver(
		@SlashOption({
			name: "article",
			description: "Titre de l'article (autocomplété), son slug ou son UUID",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: proposerArticles,
		})
		reference: string,
		interaction: ChatInputCommandInteraction
	) {
		await this.changerStatut(interaction, reference, "archived");
	}

	/**
	 * Le corps commun aux trois transitions.
	 *
	 * L'ordre est imposé : différer d'abord (3 secondes seulement pour le premier
	 * accusé de réception), vérifier les droits ensuite, lire l'état avant
	 * d'écrire, et ne journaliser qu'un changement qui a réellement eu lieu.
	 */
	private async changerStatut(
		interaction: ChatInputCommandInteraction,
		reference: string,
		cible: StatutArticle
	): Promise<void> {
		await differerEnPrive(interaction);
		// Publier engage l'image de l'association : réservé au rôle `admin`, pas
		// au rôle `staff` que `requireRgAdmin` laisserait passer.
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}
		const saisie = reference.trim();
		try {
			const avant = await resoudreArticle(saisie);
			if (!avant) {
				await interaction.editReply({
					content:
						`Aucun article sous « ${truncate(saisie, 80)} ». ` +
						"Utilise l'autocomplétion, ou passe le slug exact.",
				});
				return;
			}
			if (avant.status === cible) {
				await interaction.editReply({
					content:
						`**${truncate(avant.title, 120)}** est déjà ${libelleStatutArticle(cible)} — ` +
						"rien n'a été écrit.",
				});
				return;
			}

			const apres = await ecrireStatut(avant.id, cible);
			if (!apres) {
				await interaction.editReply({
					content: "L'article a disparu entre la lecture et l'écriture. Rien n'a été modifié.",
				});
				return;
			}

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: `article.${cible}`,
				targetType: "article",
				targetId: apres.id,
				details: {
					slug: apres.slug,
					titre: apres.title,
					app: apres.app,
					statut_avant: avant.status,
					statut_apres: apres.status,
				},
			});

			// Sans ça, `/article lire` ne proposerait l'article qu'au bout des trois
			// minutes de son propre cache.
			invalidate(CLEF_INDEX);
			invalidate(CLEF_INDEX_PUBLIC);

			const site = siteArticle(apres.app);
			const embed = rgEmbed()
				.setTitle(`${badgeStatutArticle(apres.status)} ${truncate(apres.title, 240)}`)
				.setURL(urlArticle(apres.app, apres.slug))
				.setDescription(
					`État : ${decrireChangement(
						libelleStatutArticle(avant.status),
						libelleStatutArticle(apres.status)
					)}`
				)
				.addFields(
					{ name: "Site", value: site.libelle, inline: true },
					{ name: "Slug", value: `\`${truncate(apres.slug, 90)}\``, inline: true },
					{
						name: "Publié le",
						value: apres.published_at ? dateCourte(apres.published_at) : "jamais",
						inline: true,
					}
				)
				.setFooter(
					piedTexte({
						note:
							apres.status === "published"
								? "Visible du public · l'adresse ci-dessus est celle que voient les visiteurs"
								: "Retiré du public · l'adresse ci-dessus répondra 404 aux visiteurs",
					})
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}
}

/**
 * Autocomplétion partagée par les trois transitions.
 *
 * Elle propose TOUS les états (l'état est dans le libellé), parce que la moitié
 * du travail consiste justement à retrouver un brouillon. Une autocomplétion qui
 * lève laisse le champ figé sur « chargement… » : on répond une liste vide
 * plutôt que rien.
 */
async function proposerArticles(interaction: AutocompleteInteraction): Promise<void> {
	try {
		const saisie = String(interaction.options.getFocused() ?? "")
			.trim()
			.toLowerCase();
		const index = await indexArticles();
		const retenus = index
			.filter(
				(article) =>
					saisie.length === 0 ||
					article.title.toLowerCase().includes(saisie) ||
					article.slug.includes(saisie)
			)
			// Discord refuse au-delà de 25 propositions, et 100 caractères par champ.
			.slice(0, 25);
		await interaction.respond(
			retenus.map((article) => ({
				name: truncate(
					`${badgeStatutArticle(article.status)} ${article.title} — ${siteArticle(article.app).libelle}`,
					100
				),
				// La VALEUR est l'UUID, jamais le slug : Discord plafonne une valeur
				// d'autocomplétion à 100 caractères, et rien n'interdit un slug plus
				// long (le plus long en base fait 64 caractères aujourd'hui, mais un
				// titre à rallonge en produirait un qui serait tronqué — donc rendu
				// irrésolvable, alors même qu'il aurait été choisi dans la liste).
				// Un UUID fait toujours 36 caractères.
				value: article.id,
			}))
		);
	} catch {
		await interaction.respond([]);
	}
}
