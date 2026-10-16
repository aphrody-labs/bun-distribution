/**
 * `/article` — les publications éditoriales de Rose Griffon dans Discord.
 *
 * ── POURQUOI CETTE COMMANDE EXISTE ─────────────────────────────────────────
 * Deux commandes se partageaient le sujet : `/chronique list|read` pour « les
 * articles du site » et `/azalee latest` pour « les articles du wiki ». Elles
 * n'auraient jamais dû être deux : la base ne connaît qu'UNE table d'articles,
 * `articles`, et une colonne `app` qui dit sur quel site chacun se publie.
 * Relevé du 13/8/2026 :
 *
 *     SELECT app, status, count(*) FROM articles GROUP BY 1,2;
 *      azalee  | published | 1
 *      website | published | 2
 *
 * Pire, `/chronique` n'interrogeait pas cette table mais `chronicles`, une
 * table héritée qui compte **0 ligne** : la commande ne pouvait rien afficher,
 * quel que soit l'argument. `/article` la remplace en lisant la table qui
 * contient réellement les articles — celle que servent les deux sites publics.
 *
 * ── UNE TABLE, DEUX URL ────────────────────────────────────────────────────
 * Le même slug se sert sous deux chemins différents, pour des raisons
 * historiques (le site a gardé `/chroniques` du temps de la table `chronicles`).
 * Les deux ont été vérifiés en HTTP 200 sur un slug réel, et `urlArticle`
 * (`lib/communaute-format.ts`) est le seul endroit qui le sait.
 *
 * ── PIÈGE `Bun.SQL` ────────────────────────────────────────────────────────
 * `app = ANY(${tableau})` ÉCHOUE ici : Bun sérialise le tableau en
 * `website,azalee` et Postgres répond « malformed array literal ». La forme qui
 * marche est `app IN ${sql(tableau)}`, qui développe en liste de paramètres
 * liés. Mesuré, pas supposé.
 *
 * ── PIÈGE IMAGE RELATIVE ───────────────────────────────────────────────────
 * `articles.featured_image_url` n'est PAS toujours une URL absolue : sur les
 * trois articles publiés, `mise-a-jour-du-site` porte `/rgtv/jude.webp`. Or
 * `EmbedBuilder.setImage("/rgtv/jude.webp")` LÈVE (« Received one or more
 * errors ») — `/article lire mise-a-jour-du-site` tombait donc dans son `catch`
 * et affichait un message d'erreur au lieu de l'article. `imageArticle` résout
 * le chemin contre l'origine du site qui publie, et borne au passage les images
 * du CDN (voir plus bas).
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { cached } from "../lib/cache";
import { renderChroniqueList } from "../lib/canvas/cards";
import {
  appsDemandees,
  dateCourte,
  libellePortee,
  nettoyerHtml,
  resumeArticle,
  siteArticle,
  urlArticle,
  type AppArticle,
  type LigneArticle,
} from "../lib/communaute-format";
import { sql } from "../lib/db";
import { rgEmbed, truncate } from "../lib/embeds";
import { piedTexte } from "../lib/ui";

/** Colonnes énumérées une par une : la table ne contient pas de PII, on reste explicite. */
interface Article extends LigneArticle {
  id: string;
  featured_image_url: string | null;
  view_count: number | null;
}

const CHOIX_SITE = [
  { name: "rosegriffon.fr", value: "rosegriffon" },
  { name: "Azalée (wiki IEVR)", value: "azalee" },
] as const;

/** Suffisamment court pour qu'une publication apparaisse vite, assez long pour tenir une rafale. */
const TTL_LISTE_MS = 3 * 60_000;

/**
 * Largeur demandée aux variantes du CDN.
 *
 * Une image `cdn.rosegriffon.fr` servie SANS `?w=` sort en original : la
 * couverture de l'article Azalée pèse 12 Mo en PNG brut contre ~42 Ko en
 * `?w=1600&format=webp`. Discord refuse de charger la première dans un embed.
 */
const LARGEUR_IMAGE_CDN = 1600;

/**
 * URL d'illustration exploitable dans un embed, ou `null`.
 *
 * Trois cas mesurés sur les articles publiés le 13/8/2026 :
 *  - `/rgtv/jude.webp` — chemin RELATIF, résolu contre l'origine du site qui
 *    publie l'article (vérifié 200 sur `https://rosegriffon.fr/rgtv/jude.webp`) ;
 *  - `https://cdn.rosegriffon.fr/…png` — complété en `?w=…&format=webp` s'il
 *    manque, sans jamais écraser une largeur déjà choisie ;
 *  - tout le reste (`https://pbs.twimg.com/…`) est laissé intact.
 * Ce qui ne donne pas une URL `http(s)` valide est écarté plutôt que passé à
 * Discord, qui rejetterait l'embed entier.
 */
function imageArticle(app: string | null | undefined, brut: string | null | undefined): string | null {
  const valeur = brut?.trim();
  if (!valeur) return null;
  let url: URL;
  try {
    url = new URL(valeur, `${siteArticle(app).base}/`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname === "cdn.rosegriffon.fr" && !url.searchParams.has("w")) {
    url.searchParams.set("w", String(LARGEUR_IMAGE_CDN));
    if (!url.searchParams.has("format")) url.searchParams.set("format", "webp");
  }
  return url.toString();
}

async function derniersArticles(
  apps: readonly AppArticle[],
  categorie: string | null,
  limite: number,
): Promise<Article[]> {
  return await sql<Article[]>`
		SELECT id::text, title::text, slug::text, excerpt, category::text, app,
		       featured_image_url, published_at, view_count
		FROM articles
		WHERE status = 'published' AND app IN ${sql([...apps])}
		  AND (${categorie}::text IS NULL OR category ILIKE ${categorie})
		ORDER BY published_at DESC NULLS LAST
		LIMIT ${limite}
	`;
}

/**
 * Recherche plein texte « pauvre » mais honnête : `ILIKE` sur le titre, le
 * chapô ET le corps.
 *
 * La colonne `search_vector` existe, mais elle n'est alimentée que par un
 * trigger côté site : sur les 3 articles publiés, chercher « victory » dans le
 * seul titre ne rend qu'une ligne alors que les deux articles en parlent. On
 * cherche donc aussi dans `content`, quitte à être plus lent — 3 lignes.
 */
async function chercherArticles(
  apps: readonly AppArticle[],
  categorie: string | null,
  motif: string,
  limite: number,
): Promise<Article[]> {
  return await sql<Article[]>`
		SELECT id::text, title::text, slug::text, excerpt, category::text, app,
		       featured_image_url, published_at, view_count
		FROM articles
		WHERE status = 'published' AND app IN ${sql([...apps])}
		  AND (${categorie}::text IS NULL OR category ILIKE ${categorie})
		  AND (title ILIKE ${motif} OR excerpt ILIKE ${motif} OR content ILIKE ${motif})
		ORDER BY published_at DESC NULLS LAST
		LIMIT ${limite}
	`;
}

async function lireArticle(slug: string): Promise<(Article & { content: string | null }) | null> {
  const lignes = await sql<Array<Article & { content: string | null }>>`
		SELECT id::text, title::text, slug::text, excerpt, category::text, app,
		       featured_image_url, published_at, view_count, content
		FROM articles
		WHERE status = 'published' AND slug = ${slug}
		LIMIT 1
	`;
  return lignes[0] ?? null;
}

/** Index léger pour l'autocomplétion : titre + slug + site, rien d'autre. */
async function indexAutocompletion(): Promise<Array<{ title: string; slug: string; app: string }>> {
  return await cached("article:index", TTL_LISTE_MS, async () => {
    return await sql<Array<{ title: string; slug: string; app: string }>>`
			SELECT title::text, slug::text, app
			FROM articles
			WHERE status = 'published'
			ORDER BY published_at DESC NULLS LAST
			LIMIT 100
		`;
  });
}

/**
 * Catégories réellement publiées, pour l'autocomplétion.
 *
 * `/chronique list` et `/azalee latest` acceptaient toutes deux un filtre de
 * catégorie en texte libre : la fusion aurait perdu cette capacité. On la rend,
 * en la nourrissant de la colonne `articles.category` — relevé du 13/8/2026 :
 * `coulisses` (2 articles) et `critique` (1). Proposer les valeurs réelles évite
 * qu'un membre tape « chronique » et reçoive un vide inexplicable.
 */
async function categoriesPubliees(): Promise<string[]> {
  return await cached("article:categories", TTL_LISTE_MS, async () => {
    const lignes = await sql<Array<{ category: string }>>`
			SELECT DISTINCT category::text
			FROM articles
			WHERE status = 'published' AND category IS NOT NULL AND category <> ''
			ORDER BY category
		`;
    return lignes.map(l => l.category);
  });
}

/** Autocomplétion de l'option `categorie`, bornée aux 25 propositions de Discord. */
async function completerCategorie(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const saisie = String(interaction.options.getFocused() ?? "")
      .trim()
      .toLowerCase();
    const categories = await categoriesPubliees();
    await interaction.respond(
      categories
        .filter(c => saisie.length === 0 || c.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(c => ({ name: truncate(c, 100), value: truncate(c, 100) })),
    );
  } catch {
    // Sans réponse, le champ reste figé sur « chargement… » côté client.
    await interaction.respond([]);
  }
}

/** Normalise l'option `categorie` : vide ou absente vaut « toutes ». */
function categorieDemandee(choix: string | null | undefined): string | null {
  const propre = choix?.trim();
  return propre && propre.length > 0 ? propre : null;
}

/** Une ligne d'article dans un embed : titre cliquable, site, catégorie, date. */
function ligneArticle(article: Article): string {
  const site = siteArticle(article.app);
  const meta = [site.libelle];
  if (article.category) meta.push(article.category);
  meta.push(dateCourte(article.published_at));
  const resume = resumeArticle(article, 170);
  const entete = `**[${truncate(article.title, 120)}](${urlArticle(article.app, article.slug)})**\n*${meta.join(" · ")}*`;
  return resume ? `${entete}\n${resume}` : entete;
}

/**
 * Assemble la description d'une liste sans jamais dépasser les 4 096 caractères
 * d'une description d'embed — un dépassement fait rejeter le message ENTIER par
 * Discord, pas seulement le champ fautif.
 */
function descriptionListe(articles: readonly Article[]): string {
  const lignes: string[] = [];
  let taille = 0;
  for (const article of articles) {
    const ligne = ligneArticle(article);
    if (taille + ligne.length + 2 > 4000) break;
    lignes.push(ligne);
    taille += ligne.length + 2;
  }
  return lignes.join("\n\n");
}

function messageErreur(err: unknown): string {
  return `Impossible de lire les articles : ${err instanceof Error ? err.message : String(err)}`;
}

@Discord()
@SlashGroup({
  name: "article",
  description: "Les articles publiés sur rosegriffon.fr et sur le wiki Azalée",
})
@SlashGroup("article")
export class ArticleCommand {
  @Slash({ name: "derniers", description: "Les articles les plus récents des deux sites" })
  async derniers(
    @SlashChoice(...CHOIX_SITE)
    @SlashOption({
      name: "site",
      description: "Limiter à un seul site (par défaut : les deux)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    site: string | undefined,
    @SlashOption({
      name: "categorie",
      description: "Ne garder qu'une catégorie (coulisses, critique…)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: completerCategorie,
    })
    categorie: string | undefined,
    @SlashOption({
      name: "nombre",
      description: "Nombre d'articles (1 à 10, 5 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 10,
    })
    nombre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    const apps = appsDemandees(site);
    const filtre = categorieDemandee(categorie);
    try {
      const articles = await derniersArticles(apps, filtre, nombre ?? 5);
      if (articles.length === 0) {
        await interaction.editReply({
          content: filtre
            ? `Aucun article publié en catégorie « ${truncate(filtre, 60)} » sur ${libellePortee(apps)}.`
            : `Aucun article publié sur ${libellePortee(apps)} pour le moment.`,
        });
        return;
      }

      const portee = filtre ? `${libellePortee(apps)} · ${truncate(filtre, 40)}` : libellePortee(apps);
      const embed = rgEmbed()
        .setTitle(truncate(`${articles.length} article${articles.length > 1 ? "s" : ""} — ${portee}`, 250))
        .setURL(siteArticle(apps.length === 1 ? apps[0] : "website").base)
        .setDescription(descriptionListe(articles));

      // La carte image reprend la mise en page de l'ancienne `/chronique list` :
      // elle donne la DA, l'embed donne les liens cliquables qu'une image ne
      // peut pas porter. Un échec de rendu ne doit pas emporter la réponse.
      let fichiers: AttachmentBuilder[] = [];
      try {
        const png = await renderChroniqueList(
          articles.map(a => ({
            title: a.title,
            slug: a.slug,
            excerpt: resumeArticle(a, 220) || null,
            category: a.category ?? siteArticle(a.app).libelle,
            views_count: a.view_count,
            // Même normalisation que pour l'embed : un chemin relatif ne se
            // télécharge pas, la vignette tombait sur le pictogramme de repli.
            featured_image: imageArticle(a.app, a.featured_image_url),
            created_at: a.published_at,
          })),
          filtre ? portee : apps.length === 1 ? libellePortee(apps) : undefined,
        );
        fichiers = [new AttachmentBuilder(png, { name: "rg-articles.png" })];
      } catch (err) {
        console.warn("[article] rendu de la carte impossible :", err);
      }

      await interaction.editReply({ embeds: [embed], files: fichiers });
    } catch (err) {
      await interaction.editReply({ content: messageErreur(err) });
    }
  }

  @Slash({ name: "lire", description: "Ouvrir un article précis" })
  async lire(
    @SlashOption({
      name: "article",
      description: "Titre de l'article (ou son slug)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        try {
          const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
          const index = await indexAutocompletion();
          const retenus = index
            .filter(a => saisie.length === 0 || a.title.toLowerCase().includes(saisie) || a.slug.includes(saisie))
            .slice(0, 25);
          await interaction.respond(
            retenus.map(a => ({
              name: truncate(`${a.title} — ${siteArticle(a.app).libelle}`, 100),
              value: truncate(a.slug, 100),
            })),
          );
        } catch {
          // Une autocomplétion qui lève laisse le champ figé sur « chargement… ».
          await interaction.respond([]);
        }
      },
    })
    slug: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const article = await lireArticle(slug.trim());
      if (!article) {
        await interaction.editReply({
          content: `Aucun article publié sous « ${truncate(slug, 80)} ». Utilise l'autocomplétion pour choisir un titre.`,
        });
        return;
      }

      const site = siteArticle(article.app);
      const corps = article.excerpt?.trim() || nettoyerHtml(article.content);
      const embed = rgEmbed()
        .setTitle(truncate(article.title, 250))
        .setURL(urlArticle(article.app, article.slug))
        .setDescription(truncate(corps, 1500) || "Cet article n'a pas encore de résumé.")
        .addFields(
          { name: "Site", value: site.libelle, inline: true },
          { name: "Catégorie", value: article.category ?? "—", inline: true },
          { name: "Publié le", value: dateCourte(article.published_at), inline: true },
          { name: "Vues", value: String(article.view_count ?? 0), inline: true },
        );
      const illustration = imageArticle(article.app, article.featured_image_url);
      if (illustration) embed.setImage(illustration);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: messageErreur(err) });
    }
  }

  @Slash({ name: "recherche", description: "Chercher un article par mot-clé, titre ou contenu" })
  async recherche(
    @SlashOption({
      name: "texte",
      description: "Mot-clé à chercher (2 caractères minimum)",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 2,
    })
    texte: string,
    @SlashChoice(...CHOIX_SITE)
    @SlashOption({
      name: "site",
      description: "Limiter à un seul site (par défaut : les deux)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    site: string | undefined,
    @SlashOption({
      name: "categorie",
      description: "Ne garder qu'une catégorie (coulisses, critique…)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: completerCategorie,
    })
    categorie: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    const terme = texte.trim();
    if (terme.length < 2) {
      await interaction.editReply({ content: "Il faut au moins deux caractères pour chercher." });
      return;
    }
    const apps = appsDemandees(site);
    const filtre = categorieDemandee(categorie);
    const portee = filtre ? `${libellePortee(apps)} · ${truncate(filtre, 40)}` : libellePortee(apps);
    try {
      // Le motif est échappé côté SQL : les jokers `%` et `_` d'une saisie
      // libre transformeraient sinon la recherche en « tout afficher ».
      const motif = `%${terme.replaceAll(/[\\%_]/g, c => `\\${c}`)}%`;
      const articles = await chercherArticles(apps, filtre, motif, 10);
      if (articles.length === 0) {
        await interaction.editReply({
          content: `Aucun article ne parle de « ${truncate(terme, 80)} » sur ${portee}.`,
        });
        return;
      }
      const embed = rgEmbed()
        .setTitle(
          truncate(`« ${truncate(terme, 60)} » — ${articles.length} résultat${articles.length > 1 ? "s" : ""}`, 250),
        )
        .setDescription(descriptionListe(articles))
        .setFooter(piedTexte({ note: truncate(`Recherche sur ${portee} · rosegriffon.fr`, 2000) }));
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: messageErreur(err) });
    }
  }
}
