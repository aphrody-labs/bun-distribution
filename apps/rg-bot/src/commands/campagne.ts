/**
 * `/campagne` — les campagnes à hashtag de Rose Griffon, dans le serveur.
 *
 *  - `/campagne liste` : les campagnes publiées, avec leur volume de participation ;
 *  - `/campagne voir`  : une campagne, ses participations, ses métriques agrégées
 *                        et les créations récoltées.
 *
 * Trois tables, une seule vue : `x_campagnes` (l'éditorial), `x_campagne_posts`
 * (les publications X retenues, dont le contenu vit dans `tweets`) et
 * `campagne_creations_discord` (les créations déposées dans les salons de dépôt).
 *
 * ⚠ RLS TRANSCRITE EN SQL. `lib/db.ts` se connecte en service-role, donc HORS
 * RLS. `c.publiee`, `not p.masque` et `p.a_media` doivent figurer EXPLICITEMENT
 * dans chaque requête : s'appuyer sur les policies publierait ici les campagnes
 * dépubliées et les publications retirées par la modération.
 *
 * ⚠ HASHTAGS DE RATTRAPAGE. `x_campagnes.hashtags_rattrapage` porte les
 * variantes récoltées en silence (la coquille d'une affiche, une faute
 * répandue). Elle n'est JAMAIS renvoyée : le hashtag d'un post est ramené à
 * `null` quand il n'appartient pas aux hashtags publics, et le texte du post
 * passe par `public.x_masquer_hashtags()` — sans quoi le premier participant qui
 * recopie la coquille la reproduirait dans nos embeds.
 *
 * ⚠ VISUELS. Les pièces jointes Discord sont servies signées et périment en
 * moins de 24 h : seule la copie recopiée dans le seau public `assets` est
 * republiable. `lib/sondage-format.ts` refuse tout lien `cdn.discordapp.com`,
 * y compris s'il arrivait par une colonne qu'on croyait propre.
 */
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
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
	bornerPage,
	cheminCampagne,
	couper,
	decoderEtatCampagnes,
	echapperMarkdown,
	encoderEtatCampagnes,
	entier,
	estSlugCampagne,
	etatCampagne,
	formaterNombre,
	hashtagsAffichables,
	horodatageRelatif,
	imagePost,
	libelleEtatCampagne,
	ligneListeCampagne,
	ligneMetriques,
	ligneParticipations,
	lignePost,
	nombreDePages,
	normaliserCampagne,
	noteCampagneVide,
	periodeCampagne,
	pluriel,
	versDate,
	type Campagne,
	type EtatListeCampagnes,
	type LigneCampagne,
	type PostCampagne,
	type StatsCampagne,
} from "../lib/sondage-format";
import { echec, pied, repondre } from "../lib/ui";

/** Campagnes par page : sept existent aujourd'hui, cinq gardent l'embed lisible. */
const PAR_PAGE = 5;

/** Publications montrées dans le détail d'une campagne. */
const POSTS_MONTRES = 3;

/** Participants les plus actifs listés dans le détail. */
const TOP_AUTEURS = 5;

const TTL_SLUGS_MS = 10 * 60_000;

/*
 * Colonnes de campagne, énumérées. `hashtags_rattrapage` en est ABSENTE et doit
 * le rester : ne pas la sélectionner est ce qui garantit qu'aucun embed n'a le
 * moyen de l'afficher.
 */
const COLONNES_CAMPAGNE = `
	c.slug, c.titre, c.sur_titre, c.description, c.image_couverture, c.image_affiche,
	c.hashtags, c.hashtags_affichage, c.salons_depot, c.debut_le, c.fin_le,
	c.actif, c.principale, c.collecte_le
`;

/*
 * Agrégats d'une campagne, calculés en base.
 *
 * Deux sous-requêtes plutôt qu'une jointure unique : croiser les publications X
 * et les créations Discord dans le même `group by` multiplierait les lignes et
 * gonflerait toutes les sommes (produit cartésien). Les `bigint` de `sum()`
 * reviennent en CHAÎNE côté Bun.SQL — `entier()` les normalise.
 */
const AGREGATS = `
	(SELECT jsonb_build_object(
			'posts', count(*),
			'auteurs', count(DISTINCT t.author_username),
			'jaime', coalesce(sum((t.metrics->>'like_count')::bigint), 0),
			'repartages', coalesce(sum((t.metrics->>'retweet_count')::bigint), 0),
			'vues', coalesce(sum((t.metrics->>'view_count')::bigint), 0),
			'derniere', max(p.publie_le))
	 FROM public.x_campagne_posts p
	 JOIN public.tweets t ON t.id = p.tweet_id
	 WHERE p.campagne_slug = c.slug AND NOT p.masque AND p.a_media) AS agregats_x,
	(SELECT count(*)
	 FROM public.campagne_creations_discord d
	 WHERE d.campagne_slug = c.slug AND NOT d.masque) AS creations
`;

interface LigneCampagneAgregee extends LigneCampagne {
	agregats_x: unknown;
	creations: number | string | null;
}

/** Agrégats bruts → `StatsCampagne` typées. */
function versStats(ligne: LigneCampagneAgregee): StatsCampagne {
	const brut =
		ligne.agregats_x && typeof ligne.agregats_x === "object"
			? (ligne.agregats_x as Record<string, unknown>)
			: {};
	return {
		auteurs: entier(brut.auteurs) ?? 0,
		creations: entier(ligne.creations) ?? 0,
		derniere: versDate(brut.derniere as string | null),
		jaime: entier(brut.jaime) ?? 0,
		posts: entier(brut.posts) ?? 0,
		repartages: entier(brut.repartages) ?? 0,
		vues: entier(brut.vues) ?? 0,
	};
}

interface PageCampagnes {
	entrees: Array<{ campagne: Campagne; stats: StatsCampagne }>;
	total: number;
	page: number;
}

/**
 * Page de campagnes publiées.
 *
 * `enCours` retient les campagnes ouvertes ou à venir. Le tri place la campagne
 * à la une en tête, puis les plus récentes : c'est l'ordre du site, et deux
 * écrans qui listent la même chose ne doivent pas la lister différemment.
 */
async function listerCampagnes(etat: EtatListeCampagnes): Promise<PageCampagnes> {
	const page = Math.max(1, Math.trunc(etat.page));
	const decalage = (page - 1) * PAR_PAGE;
	const seulementOuvertes = etat.enCours;

	const [total] = await sql<Array<{ total: number }>>`
		SELECT count(*)::int AS total
		FROM public.x_campagnes c
		WHERE c.publiee
		  AND (${seulementOuvertes}::boolean = false
		       OR c.fin_le IS NULL OR c.fin_le >= now())
	`;

	const lignes = await sql<LigneCampagneAgregee[]>`
		SELECT ${sql.unsafe(COLONNES_CAMPAGNE)}, ${sql.unsafe(AGREGATS)}
		FROM public.x_campagnes c
		WHERE c.publiee
		  AND (${seulementOuvertes}::boolean = false
		       OR c.fin_le IS NULL OR c.fin_le >= now())
		ORDER BY c.principale DESC, c.debut_le DESC NULLS LAST, c.slug
		LIMIT ${PAR_PAGE} OFFSET ${decalage}
	`;

	return {
		entrees: lignes.map((ligne) => ({
			campagne: normaliserCampagne(ligne),
			stats: versStats(ligne),
		})),
		page,
		total: total?.total ?? 0,
	};
}

/** Une campagne publiée précise, avec ses agrégats. */
async function lireCampagne(
	slug: string
): Promise<{ campagne: Campagne; stats: StatsCampagne } | null> {
	if (!estSlugCampagne(slug)) {
		return null;
	}
	const lignes = await sql<LigneCampagneAgregee[]>`
		SELECT ${sql.unsafe(COLONNES_CAMPAGNE)}, ${sql.unsafe(AGREGATS)}
		FROM public.x_campagnes c
		WHERE c.publiee AND c.slug = ${slug}
		LIMIT 1
	`;
	const ligne = lignes[0];
	return ligne ? { campagne: normaliserCampagne(ligne), stats: versStats(ligne) } : null;
}

/**
 * Dernières publications d'une campagne.
 *
 * Le hashtag est ramené dans la CASSE de la campagne (`hashtags_affichage`,
 * aligné index par index sur `hashtags`) et mis à `null` quand il ne fait pas
 * partie des hashtags publics : un hashtag de rattrapage ne doit jamais
 * ressortir. Le texte, lui, est nettoyé par `x_masquer_hashtags()`.
 */
async function dernieresPublications(slug: string, limite: number): Promise<PostCampagne[]> {
	const lignes = await sql<
		Array<{
			tweet_id: string;
			author_username: string | null;
			text: string | null;
			publie_le: Date | string | null;
			hashtag_trouve: string | null;
			media: unknown;
		}>
	>`
		SELECT p.tweet_id,
		       t.author_username,
		       public.x_masquer_hashtags(t.text, c.hashtags_rattrapage) AS text,
		       p.publie_le,
		       CASE WHEN p.hashtag_trouve = ANY (c.hashtags)
		            THEN coalesce(
		                   c.hashtags_affichage[array_position(c.hashtags, p.hashtag_trouve)],
		                   p.hashtag_trouve)
		       END AS hashtag_trouve,
		       t.media
		FROM public.x_campagne_posts p
		JOIN public.tweets t ON t.id = p.tweet_id
		JOIN public.x_campagnes c ON c.slug = p.campagne_slug AND c.publiee
		WHERE p.campagne_slug = ${slug} AND NOT p.masque AND p.a_media
		ORDER BY p.publie_le DESC, p.tweet_id DESC
		LIMIT ${limite}
	`;
	return lignes.map((ligne) => ({
		auteur: ligne.author_username,
		hashtag: ligne.hashtag_trouve,
		image: imagePost(ligne.media),
		publieLe: versDate(ligne.publie_le),
		texte: ligne.text,
		tweetId: ligne.tweet_id,
	}));
}

/** Comptes X les plus actifs sur une campagne. */
async function participantsLesPlusActifs(
	slug: string,
	limite: number
): Promise<Array<{ compte: string; n: number }>> {
	const lignes = await sql<Array<{ compte: string | null; n: number }>>`
		SELECT t.author_username AS compte, count(*)::int AS n
		FROM public.x_campagne_posts p
		JOIN public.tweets t ON t.id = p.tweet_id
		JOIN public.x_campagnes c ON c.slug = p.campagne_slug AND c.publiee
		WHERE p.campagne_slug = ${slug} AND NOT p.masque AND p.a_media
		  AND t.author_username IS NOT NULL
		GROUP BY t.author_username
		ORDER BY n DESC, compte
		LIMIT ${limite}
	`;
	return lignes
		.filter((ligne): ligne is { compte: string; n: number } => ligne.compte !== null)
		.map((ligne) => ({ compte: ligne.compte, n: ligne.n }));
}

/** Slugs et titres publiés — alimente l'autocomplétion. */
async function campagnesConnues(): Promise<Array<{ slug: string; titre: string }>> {
	return cached("campagnes:slugs", TTL_SLUGS_MS, async () => {
		return sql<Array<{ slug: string; titre: string }>>`
			SELECT c.slug, c.titre
			FROM public.x_campagnes c
			WHERE c.publiee
			ORDER BY c.principale DESC, c.debut_le DESC NULLS LAST, c.slug
			LIMIT 100
		`;
	});
}

/** Construit la réponse (embed + boutons) d'une page de liste. */
async function rendrePage(etat: EtatListeCampagnes): Promise<InteractionEditReplyOptions> {
	const premier = await listerCampagnes(etat);
	const page = bornerPage(etat.page, premier.total, PAR_PAGE);
	const resultat = page === premier.page ? premier : await listerCampagnes({ ...etat, page });
	const pages = nombreDePages(resultat.total, PAR_PAGE);

	const embed = rgEmbed()
		.setTitle(
			`Campagnes — ${formaterNombre(resultat.total)} ${pluriel(resultat.total, "campagne", "campagnes")}`
		)
		.setURL(`${RG_BASE_URL}/iergday`);
	if (etat.enCours) {
		embed.setAuthor({ name: "Filtre : campagnes ouvertes ou à venir" });
	}

	if (resultat.entrees.length === 0) {
		embed.setDescription("Aucune campagne publiée ne correspond.");
	} else {
		embed.setDescription(
			truncate(
				resultat.entrees
					.map((entree) => ligneListeCampagne(entree.campagne, entree.stats, RG_BASE_URL))
					.join("\n\n"),
				4096
			)
		);
		pied(embed, { page: page, pages: pages });
	}

	const composants: Array<ActionRowBuilder<ButtonBuilder>> = [];
	const idPrecedent = encoderEtatCampagnes({ ...etat, page: page - 1 });
	const idSuivant = encoderEtatCampagnes({ ...etat, page: page + 1 });
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

/** Embed de détail d'une campagne. */
function rendreCampagne(
	campagne: Campagne,
	stats: StatsCampagne,
	posts: PostCampagne[],
	actifs: Array<{ compte: string; n: number }>
): InteractionEditReplyOptions {
	const embed = rgEmbed()
		.setTitle(truncate(campagne.titre, 256))
		.setURL(`${RG_BASE_URL}${cheminCampagne(campagne)}`);

	const entete = [
		campagne.surTitre ? `*${echapperMarkdown(couper(campagne.surTitre, 120))}*` : null,
		campagne.description ? echapperMarkdown(couper(campagne.description, 600)) : null,
	]
		.filter((valeur): valeur is string => valeur !== null)
		.join("\n\n");
	if (entete.length > 0) {
		embed.setDescription(truncate(entete, 4096));
	}

	const periode = periodeCampagne(campagne);
	embed.addFields(
		{ inline: true, name: "État", value: libelleEtatCampagne(campagne) },
		{ inline: true, name: "Période", value: periode ?? "non publiée" },
		{
			inline: true,
			name: "Hashtags",
			value:
				hashtagsAffichables(campagne).length > 0
					? truncate(echapperMarkdown(hashtagsAffichables(campagne).join(" ")), 1024)
					: "aucun",
		}
	);

	const vide = noteCampagneVide(campagne, stats);
	embed.addFields({
		inline: false,
		name: "Participations",
		value: truncate(
			vide ? `${ligneParticipations(stats)}\n${vide}` : ligneParticipations(stats),
			1024
		),
	});

	// Les métriques n'ont de sens que s'il y a des publications X : « 0 · 0 · 0 »
	// en face d'une campagne dont les créations sont sur Discord se lirait comme
	// un échec, alors que c'est simplement une autre source.
	if (stats.posts > 0) {
		embed.addFields({
			inline: false,
			name: "Métriques agrégées (X)",
			value: truncate(
				`${ligneMetriques(stats)}\nDernière publication ${horodatageRelatif(stats.derniere)}`,
				1024
			),
		});
	}

	if (actifs.length > 0) {
		embed.addFields({
			inline: false,
			name: `Comptes les plus actifs (${actifs.length})`,
			value: truncate(
				actifs
					.map(
						(entree) =>
							`[@${echapperMarkdown(entree.compte)}](https://x.com/${encodeURIComponent(entree.compte)}) — ${entree.n} ${pluriel(entree.n, "publication", "publications")}`
					)
					.join("\n"),
				1024
			),
		});
	}

	if (posts.length > 0) {
		embed.addFields({
			inline: false,
			name: `Dernières publications (${posts.length})`,
			value: truncate(posts.map((post) => lignePost(post)).join("\n\n"), 1024),
		});
	}

	if (campagne.salonsDepot.length > 0) {
		embed.addFields({
			inline: false,
			name: "Salons de dépôt",
			value: truncate(campagne.salonsDepot.map((salon) => `<#${salon}>`).join(" · "), 1024),
		});
	}

	// Une image de post ne remplace pas le visuel officiel : la couverture, puis
	// l'affiche, puis à défaut la dernière création récoltée.
	const visuel =
		campagne.imageCouverture ??
		campagne.imageAffiche ??
		posts.find((post) => post.image !== null)?.image ??
		null;
	if (visuel) {
		embed.setImage(visuel);
	}

	const etat = etatCampagne(campagne);
	pied(embed, {
		note: `${campagne.slug} · ${etat === "en-cours" && campagne.actif ? "récolte en cours" : "récolte close"} · rosegriffon.fr`,
	});
	return { embeds: [embed] };
}

@Discord()
@SlashGroup({
	description: "Les campagnes à hashtag : participations, métriques et créations",
	name: "campagne",
})
@SlashGroup("campagne")
export class CampagneCommand {
	@Slash({
		description: "Liste les campagnes publiées et leur volume de participation",
		name: "liste",
	})
	async liste(
		@SlashOption({
			description: "Ne montrer que les campagnes ouvertes ou à venir",
			name: "en-cours",
			required: false,
			type: ApplicationCommandOptionType.Boolean,
		})
		enCours: boolean | undefined,
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
			await interaction.editReply(await rendrePage({ enCours: enCours === true, page: page ?? 1 }));
		} catch (err) {
			await repondre(
				interaction,
				echec("Lecture des campagnes impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}

	/** Boutons de pagination — état intégral dans le `customId` (cf. `/sondage`). */
	@ButtonComponent({ id: /^cmp\|/ })
	async paginer(interaction: ButtonInteraction) {
		const etat = decoderEtatCampagnes(interaction.customId);
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
		description: "Affiche une campagne : participations, métriques et créations récoltées",
		name: "voir",
	})
	async voir(
		@SlashOption({
			autocomplete: async (interaction: AutocompleteInteraction) => {
				try {
					const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
					const campagnes = await campagnesConnues();
					await interaction.respond(
						campagnes
							.filter(
								(entree) =>
									entree.titre.toLowerCase().includes(saisie) || entree.slug.includes(saisie)
							)
							.slice(0, 25)
							.map((entree) => ({
								name: couper(entree.titre, 100),
								value: entree.slug,
							}))
					);
				} catch {
					await interaction.respond([]);
				}
			},
			description: "Campagne (choisir dans la liste, ou saisir son slug)",
			name: "campagne",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		slug: string,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		try {
			const propre = slug.trim().toLowerCase();
			const trouvee = await lireCampagne(propre);
			if (!trouvee) {
				await interaction.editReply({
					content: `Aucune campagne publiée ne porte le slug \`${truncate(slug, 40)}\`. Utilise \`/campagne liste\` pour la retrouver.`,
				});
				return;
			}
			const [posts, actifs] = await Promise.all([
				dernieresPublications(propre, POSTS_MONTRES),
				participantsLesPlusActifs(propre, TOP_AUTEURS),
			]);
			await interaction.editReply(rendreCampagne(trouvee.campagne, trouvee.stats, posts, actifs));
		} catch (err) {
			await repondre(
				interaction,
				echec("Lecture de la campagne impossible", err instanceof Error ? err.message : String(err))
			);
		}
	}
}
