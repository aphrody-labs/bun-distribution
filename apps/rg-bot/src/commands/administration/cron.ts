/**
 * `/administration cron` — ce qui DÉCLENCHE quelque chose sur `rg-cron.service`.
 *
 * ── LA COUPURE AVEC `/staff cron` ──────────────────────────────────────────
 * `taches`, `metriques`, `statut` et `telemetrie` sont restées sous
 * `/staff cron` : elles lisent. Ici il n'y a que deux verbes, et les deux
 * agissent — l'un lance une tâche de production, l'autre écrit dans un salon vu
 * par ~1 984 membres. C'est toute la raison de la séparation : dans l'ancien
 * `/cron`, `taches` et `lancer` se touchaient dans la même liste
 * d'autocomplétion.
 *
 * ── HONNÊTETÉ SUR LES TÂCHES LONGUES ───────────────────────────────────────
 * Côté cron, `executeTask` est lancé SANS `await` (`lib/ipc-unix.ts` : « le
 * résultat repart par `task.done` sur la connexion d'abonnement »). La commande
 * annonce donc « démarrée », jamais « réussie » — le verdict se relit avec
 * `/staff cron statut`.
 *
 * ── LA LISTE NOIRE N'EST PAS ÉCRITE ICI ────────────────────────────────────
 * `lib/cron-taches.ts` porte les quatre tâches jamais déclenchables à distance
 * et la phrase de refus ; `packages/cron/src/lib/ipc-unix.ts` applique la MÊME
 * liste de son côté. Un garde qui ne vit que chez l'appelant n'est pas un garde.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	ChannelType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	type GuildBasedChannel,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { appelerCron } from "../../lib/cron-ipc";
import { niveauTache, raisonRefus, resoudreTache, suggererTaches } from "../../lib/cron-taches";
import { sql } from "../../lib/db";
import { rgEmbed } from "../../lib/embeds";
import { resoudreSalon } from "../../services/tweetsNotifier";
import { borner, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import { urlIllustrationAbsolue } from "./valeurs";
import "./racine";
import { echec, refus as accesRefuse, repondre } from "../../lib/ui";

/** Une ligne de `public.articles`, réduite à ce qu'une annonce affiche. */
interface ArticleAnnoncable {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	featured_image_url: string | null;
	category: string | null;
	app: string;
	status: string;
	published_at: Date | null;
}

/**
 * Les deux applications qui publient des articles, avec leur origine et le
 * chemin réel de leurs pages.
 *
 * Vérifié le 13/8/2026 : `articles.app` ne contient que `azalee` et `website`,
 * `https://azalee.rosegriffon.fr/news/<slug>` et
 * `https://rosegriffon.fr/chroniques/<slug>` répondent 200. L'ancien
 * `/cron annonce` demandait ce couple à la MAIN (`type`, `titre`, `slug`,
 * `extrait`, `image`) : cinq occasions de publier un lien mort dans un salon
 * public, alors que la ligne existe en base.
 */
const APPLICATIONS: Record<string, { origine: string; chemin: string; titre: string }> = {
	azalee: {
		origine: "https://azalee.rosegriffon.fr",
		chemin: "/news/",
		titre: "Azalée — le wiki",
	},
	website: {
		origine: "https://rosegriffon.fr",
		chemin: "/chroniques/",
		titre: "rosegriffon.fr",
	},
};

/** Salon d'annonces attendu pour une application, sinon le salon d'actualités commun. */
function salonParDefaut(app: string): string | null {
	const dedie =
		app === "azalee"
			? Bun.env.DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID
			: Bun.env.DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID;
	return dedie ?? Bun.env.DISCORD_NEWS_CHANNEL_ID ?? null;
}

/** Propositions : les articles publiés, les plus récents d'abord. */
async function suggererArticles(interaction: AutocompleteInteraction): Promise<void> {
	const saisie = String(interaction.options.getFocused() ?? "")
		.trim()
		.toLowerCase();
	try {
		const motif = saisie.length > 0 ? `%${saisie}%` : null;
		const lignes = await sql<Array<{ slug: string; title: string; app: string }>>`
			SELECT slug, title, app
			FROM public.articles
			WHERE status = 'published'
			  AND (${motif}::text IS NULL OR slug ILIKE ${motif} OR title ILIKE ${motif})
			ORDER BY published_at DESC NULLS LAST
			LIMIT 25
		`;
		await interaction.respond(
			lignes.map((ligne) => ({
				name: borner(`${ligne.app} — ${ligne.title}`, 100),
				value: ligne.slug,
			}))
		);
	} catch {
		// Discord n'affiche aucune erreur d'autocomplétion : une liste vide vaut
		// mieux qu'un appel qui se perd.
		await interaction.respond([]);
	}
}

@Discord()
@SlashGroup({
	name: "cron",
	description: "Déclenchement des tâches du démon et annonces d'articles",
	root: "administration",
})
@SlashGroup("cron", "administration")
export class AdministrationCronCommand {
	@Slash({
		name: "lancer",
		description: "Déclenche une tâche du démon (le niveau requis dépend de la tâche)",
	})
	async lancer(
		@SlashOption({
			name: "tache",
			description: "Nom de la tâche",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: async (interaction: AutocompleteInteraction) => {
				// Les quatre tâches interdites ne sont même pas proposées : ne pas
				// faire miroiter une action qui sera refusée deux fois.
				await interaction.respond(
					suggererTaches(String(interaction.options.getFocused() ?? ""), {
						exclureInterdites: true,
					}).map((nom) => ({ name: nom, value: nom }))
				);
			},
		})
		tache: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}

		const nom = resoudreTache(tache);
		const niveau = niveauTache(tache);
		if (!nom || niveau === "interdit") {
			await repondre(interaction, accesRefuse(raisonRefus(tache)));
			return;
		}

		// Le niveau est propre à la tâche : `warm` s'ouvre au staff, `patreon`
		// exige `admin`. On revérifie donc, strictement cette fois, quand la tâche
		// l'impose — la première vérification ne prouvait que « admin ou staff ».
		const admin =
			niveau === "admin-strict"
				? await exigerDroits(interaction, { strict: true })
				: await exigerDroits(interaction);
		if (!admin) {
			return;
		}

		// Trace AVANT l'appel : si le démon tombe pendant l'exécution, l'audit
		// garde tout de même qui a demandé quoi.
		await logAdminAction({
			adminId: admin.profileId,
			discordId: admin.discordId,
			action: "cron.lancer",
			targetType: "cron-task",
			targetId: nom,
			details: { niveau },
		});

		try {
			const reponse = await appelerCron<{ success: boolean; error?: string; code?: string }>({
				cmd: "task.run",
				nom,
				discordId: admin.discordId,
				profileId: admin.profileId,
			});
			if (!reponse.success) {
				await repondre(
					interaction,
					echec("La commande a échoué", borner(reponse.error ?? "Refusé par le démon.", 1_500))
				);
				return;
			}
			await interaction.editReply({
				content:
					`▶ Tâche \`${nom}\` **démarrée** (niveau ${niveau}). Le démon l'exécute en tâche de ` +
					`fond : le verdict n'arrive qu'à la fin, et se relit avec \`/staff cron statut ${nom}\`.`,
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	/**
	 * Annonce d'un article dans le salon dédié.
	 *
	 * Publiée par le BOT, jamais par `POST :3006/announce` : ce chemin hérité
	 * écoute sur `*` et son secret retombe sur le littéral
	 * `"default-secret-key-12345"` écrit dans `packages/cron/src/index.ts` —
	 * n'importe qui sur Internet peut donc y publier un embed arbitraire. Tant
	 * qu'il n'est pas refermé, on ne bâtit rien de neuf dessus.
	 */
	@Slash({
		// Un VERBE : la commande publie maintenant, elle ne règle pas un
		// comportement (cf. la convention de nommage, `docs/bot-commandes.md`).
		name: "annoncer",
		description: "Publie l'annonce d'un article publié dans le salon dédié (rôle admin)",
	})
	async annonce(
		@SlashOption({
			name: "article",
			description: "Slug de l'article (proposé depuis la base)",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: suggererArticles,
		})
		article: string,
		@SlashOption({
			name: "salon",
			description: "Salon de destination (par défaut : le salon d'annonces de l'application)",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
			required: false,
		})
		salon: GuildBasedChannel | undefined,
		@SlashOption({
			name: "forcer",
			description: "Republie même si cet article a déjà été annoncé",
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		})
		forcer: boolean | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}

		const slug = article.trim().toLowerCase();
		try {
			// `articles.slug` porte une contrainte UNIQUE globale : le slug suffit,
			// et l'application se lit dans la ligne au lieu d'être ressaisie.
			const lignes = await sql<ArticleAnnoncable[]>`
				SELECT id, slug, title, excerpt, featured_image_url, category, app, status, published_at
				FROM public.articles
				WHERE slug = ${slug}
				LIMIT 1
			`;
			const ligne = lignes[0];
			if (!ligne) {
				await interaction.editReply({
					content: `Aucun article sous le slug \`${borner(slug, 80)}\`.`,
				});
				return;
			}
			if (ligne.status !== "published") {
				await interaction.editReply({
					content:
						`L'article « ${borner(ligne.title, 100)} » est en **${ligne.status}** : son lien ` +
						"public renverrait un 404. Publie-le d'abord (`/administration article publier`).",
				});
				return;
			}
			const application = APPLICATIONS[ligne.app];
			if (!application) {
				await interaction.editReply({
					content:
						`Application \`${borner(ligne.app, 40)}\` inconnue : impossible de construire un lien ` +
						"public sûr. Les deux valeurs attendues sont `azalee` et `website`.",
				});
				return;
			}

			// Une annonce part vers ~1 984 membres et ne se rattrape pas. Comme la
			// table n'a pas de colonne « annoncé le », on interroge le journal
			// d'audit — qui, lui, garde chaque publication passée.
			if (forcer !== true) {
				const dejaVu = await sql<Array<{ created_at: Date }>>`
					SELECT created_at
					FROM public.admin_audit_log
					WHERE action = 'cron.annonce' AND entity_id = ${slug}
					ORDER BY created_at DESC
					LIMIT 1
				`;
				if (dejaVu[0]) {
					await interaction.editReply({
						content:
							`Cet article a déjà été annoncé ${horodatageRelatif(dejaVu[0].created_at)}. ` +
							"Relance avec `forcer:true` si c'est délibéré.",
					});
					return;
				}
			}

			const salonId = salon?.id ?? salonParDefaut(ligne.app);
			if (!salonId) {
				await interaction.editReply({
					content:
						"Aucun salon d'annonces configuré : ni `DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID` / " +
						"`DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID`, ni `DISCORD_NEWS_CHANNEL_ID`. " +
						"Passe le salon en option.",
				});
				return;
			}
			// Vérifie que le bot peut RÉELLEMENT y écrire : une variable
			// d'environnement définie ne dit rien de ses droits sur le salon.
			const { salon: destination, raison } = await resoudreSalon(interaction.client, salonId);
			if (!destination) {
				await repondre(
					interaction,
					echec(
						"Rien n'a été fait",
						`Rien n'a été publié. ${borner(raison ?? "Salon injoignable.", 1_500)}`
					)
				);
				return;
			}

			const lien = `${application.origine}${application.chemin}${ligne.slug}`;
			const embed = rgEmbed()
				.setTitle(borner(ligne.title, 250))
				.setURL(lien)
				.setTimestamp(ligne.published_at ?? new Date());
			if (ligne.excerpt && ligne.excerpt.trim().length > 0) {
				embed.setDescription(borner(ligne.excerpt, 1_000));
			}
			if (ligne.category) {
				embed.addFields({ name: "Rubrique", value: borner(ligne.category, 200), inline: true });
			}
			const illustration = urlIllustrationAbsolue(ligne.featured_image_url, application.origine);
			if (illustration) {
				embed.setImage(illustration);
			}

			// Trace AVANT l'envoi : un message publié dont l'audit manquerait serait
			// invérifiable, alors qu'un audit sans message reste lisible et corrigeable.
			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: "cron.annonce",
				targetType: `article-${ligne.app}`,
				targetId: ligne.slug,
				details: {
					article_id: ligne.id,
					titre: ligne.title,
					lien,
					salon_id: salonId,
					republication: forcer === true,
				},
			});

			const message = await destination.send({ embeds: [embed] });
			await interaction.editReply({
				content: `✓ Annonce publiée dans <#${salonId}> — ${message.url}`,
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}
}
