/**
 * `/staff veille` — l'observation de X, en direct et en archive.
 *
 * ── QUATRE SOUS-COMMANDES, DEUX SOURCES ────────────────────────────────────
 *   `suivi`     — état de la NOTIFICATION des nouveaux posts : filtre, curseur,
 *                 salon de destination réellement joignable. Repris de
 *                 `commands/tweets.ts` (`/tweets suivi`). Source : notre base.
 *   `profil`    — fiche d'un compte X, LUE CHEZ X à l'instant.
 *   `posts`     — derniers posts d'un compte, LUS CHEZ X à l'instant.
 *   `recherche` — posts correspondant à une requête, LUS CHEZ X à l'instant.
 *
 * L'archive (13 000 posts déjà collectés) reste sous `/x` : ce n'est pas la
 * même question. Ici on demande « qu'est-ce que X dit MAINTENANT », là-bas
 * « qu'avons-nous gardé ».
 *
 * ── POURQUOI PAR LE CRON ───────────────────────────────────────────────────
 * Les moteurs `@aphrody/x` et le navigateur CDP Aphrody Web vivent dans
 * `packages/cron`, et n'iront pas dans le bot : les installer ici toucherait le
 * fichier de verrouillage, qui doit rester en version 1 pour la CI. Le bot
 * passe donc par la socket UNIX du démon, dont le contrat des six verbes est
 * écrit en tête de `packages/cron/src/tasks/ie-crawl/scrape-service.ts` — c'est
 * ce contrat qui fait foi, avec ses délais (25 à 45 s) et ses plafonds de débit
 * (1 requête en vol par verbe, 3 tous verbes confondus).
 *
 * Le délai d'attente côté bot est donc calé SUR CE CONTRAT, pas sur une valeur
 * ronde : attendre moins que le verbe ne s'accorde produirait un faux « le
 * démon ne répond pas » alors qu'il travaille encore.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js";

import { appelerCron } from "../../lib/cron-ipc";
import { rgEmbed } from "../../lib/embeds";
import { lireCurseur, lireFiltreNotification } from "../../services/tweets";
import { resoudreSalon } from "../../services/tweetsNotifier";
import {
  borner,
  decouperEnChamps,
  formaterLatence,
  formaterNombre,
  horodatageAbsolu,
  lignePostX,
  normaliserPseudoX,
  trierPostsParDate,
  type PostXAffichable,
} from "./format";
import { differerEnPrive, exigerDroits, expliquerRefusScrape, messagePanne } from "./garde";
import "./racine";
import { echec, pied, piedTexte, repondre } from "../../lib/ui";

/**
 * Marge ajoutée au délai du verbe pour l'attente côté bot.
 *
 * Le verbe le plus long s'accorde 45 s ; la socket, elle, n'est qu'un tube
 * local. 10 s de marge couvrent la sérialisation et l'ordonnancement sans
 * jamais s'approcher des 15 minutes du jeton d'interaction Discord.
 */
const MARGE_IPC_MS = 10_000;

/** Délais du contrat, verbe par verbe (`scrape-service.ts`). */
const DELAIS_VERBE_MS: Record<string, number> = {
  "x.profil": 25_000,
  "x.posts": 45_000,
  "x.recherche": 45_000,
};

interface ReponseVerbe {
  success: boolean;
  error?: string;
  code?: string;
  ms?: number;
  [clef: string]: unknown;
}

async function appelerVerbe(verbe: string, charge: Record<string, unknown>): Promise<ReponseVerbe> {
  return await appelerCron<ReponseVerbe>(
    { cmd: verbe, ...charge },
    { timeoutMs: (DELAIS_VERBE_MS[verbe] ?? 45_000) + MARGE_IPC_MS },
  );
}

/** Salon réellement utilisé par le drain : le réglage, sinon la variable d'env. */
function salonEffectif(filtre: { salon: string | null }): string | null {
  return filtre.salon ?? Bun.env.DISCORD_NEWS_CHANNEL_ID ?? null;
}

@Discord()
@SlashGroup({
  name: "veille",
  description: "Veille X : état de la notification et interrogation en direct",
  root: "staff",
})
@SlashGroup("veille", "staff")
export class StaffVeilleCommand {
  @Slash({
    name: "suivi",
    description: "État de la notification des nouveaux posts : filtre, curseur, salon",
  })
  async suivi(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const [filtre, curseur] = await Promise.all([lireFiltreNotification(), lireCurseur()]);
      const embed = rgEmbed()
        .setTitle("Notification des nouveaux posts X")
        .setDescription(
          [
            `État : **${filtre.actif ? "active" : "coupée"}**`,
            `Comptes suivis (${filtre.comptes.length}) : ${
              filtre.comptes.length > 0 ? borner(filtre.comptes.map(compte => `@${compte}`).join(", "), 900) : "*aucun*"
            }`,
            `Catégories exclues : ${
              filtre.categories_exclues.length > 0 ? filtre.categories_exclues.join(", ") : "*aucune*"
            } (+ leak, exclu en dur)`,
            `Lot détaillé au maximum : **${filtre.max_par_lot}** posts (au-delà : un embed de synthèse)`,
          ].join("\n"),
        )
        .addFields({
          name: "Curseur",
          value: curseur
            ? [
                `Position : ${horodatageAbsolu(curseur.curseurLe)}`,
                `Dernier post consommé : \`${curseur.dernierTweetId ?? "—"}\``,
                // Le compteur additionne des POSTS annoncés, pas des
                // messages : un lot résumé en compte autant qu'il contient
                // de posts.
                `Posts annoncés (cumul) : **${formaterNombre(curseur.annonces)}**`,
              ].join("\n")
            : "Jamais amorcé — il sera créé à `now()` au prochain drain, sans rejouer l'archive.",
        });

      // Le salon est le point de panne n°1 : une variable d'environnement
      // définie ne dit rien des droits du bot dessus. On vérifie en direct.
      const salonId = salonEffectif(filtre);
      if (salonId) {
        const { salon, raison } = await resoudreSalon(interaction.client, salonId);
        embed.addFields({
          name: "Salon de destination",
          value: salon ? `✓ <#${salonId}> — le bot peut y écrire.` : `⚠ ${borner(raison ?? "injoignable", 900)}`,
        });
      } else {
        embed.addFields({
          name: "Salon de destination",
          value: "**aucun** — ni réglage en base, ni `DISCORD_NEWS_CHANNEL_ID`.",
        });
      }
      pied(embed, { note: "Réglage : /administration veille regler" });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  // `compte` et non `profil` : depuis l'arrivée de `/profil` (la carte de
  // progression d'un membre), « profil » ne doit plus désigner qu'une seule
  // chose dans tout le bot.
  @Slash({ name: "compte", description: "Fiche d'un compte X, lue chez X à l'instant" })
  async profil(
    @SlashOption({
      name: "pseudo",
      description: "Pseudo du compte, avec ou sans @",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    pseudo: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("x.profil", { pseudo });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      const fiche = (reponse.fiche ?? {}) as Record<string, unknown>;
      // Le pseudo sert à fabriquer une URL de repli : il doit passer la même
      // grille que le service (`[A-Za-z0-9_]{1,15}`). Un pseudo brut saisi avec
      // une espace ferait lever `setURL` et ferait perdre TOUT l'embed alors
      // que l'appel, lui, avait réussi.
      const nomCompte = normaliserPseudoX(fiche.pseudo) || normaliserPseudoX(pseudo);
      const lien =
        typeof fiche.url === "string" && fiche.url.startsWith("https://")
          ? fiche.url
          : nomCompte
            ? `https://x.com/${nomCompte}`
            : null;
      const embed = rgEmbed()
        .setTitle(
          `${
            typeof fiche.nom === "string" && fiche.nom.length > 0 ? borner(fiche.nom, 200) : nomCompte || "compte X"
          }${fiche.certifie === true ? " ✔" : ""}`,
        )
        .setDescription(
          typeof fiche.description === "string" && fiche.description.length > 0
            ? borner(fiche.description, 1_000)
            : "*(pas de biographie)*",
        )
        .addFields(
          { name: "Pseudo", value: nomCompte ? `@${nomCompte}` : "—", inline: true },
          {
            name: "Abonnés",
            value: formaterNombre(typeof fiche.abonnes === "number" ? fiche.abonnes : null),
            inline: true,
          },
          {
            name: "Abonnements",
            value: formaterNombre(typeof fiche.abonnements === "number" ? fiche.abonnements : null),
            inline: true,
          },
          {
            name: "Compte créé",
            value: typeof fiche.creeLe === "string" ? horodatageAbsolu(fiche.creeLe) : "—",
            inline: true,
          },
          {
            name: "Identifiant X",
            value: typeof fiche.id === "string" ? `\`${fiche.id}\`` : "—",
            inline: true,
          },
        )
        .setFooter(piedTexte({ note: `Lu en direct chez X en ${formaterLatence(reponse.ms ?? 0)}` }));
      if (lien) {
        embed.setURL(lien);
      }
      if (typeof fiche.avatar === "string" && fiche.avatar.startsWith("https://")) {
        embed.setThumbnail(fiche.avatar);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "posts", description: "Derniers posts d'un compte X, lus chez X à l'instant" })
  async posts(
    @SlashOption({
      name: "pseudo",
      description: "Pseudo du compte, avec ou sans @",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    pseudo: string,
    @SlashOption({
      name: "limite",
      description: "Nombre de posts (1 à 10, 5 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 10,
    })
    limite: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("x.posts", { pseudo, limite });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      // X place le post ÉPINGLÉ en tête et le service ne trie pas : sans ce
      // tri, « derniers posts » affichait un post de juillet au-dessus d'un
      // post d'août (mesuré sur @inazuma_project le 13/8/2026).
      const posts = trierPostsParDate(Array.isArray(reponse.posts) ? (reponse.posts as PostXAffichable[]) : []);
      const compte = normaliserPseudoX(reponse.pseudo) || normaliserPseudoX(pseudo);
      const embed = rgEmbed()
        .setTitle(`${compte ? `@${compte}` : "Compte X"} — ${posts.length} post${posts.length > 1 ? "s" : ""}`)
        .setFooter(piedTexte({ note: `Lu en direct chez X en ${formaterLatence(reponse.ms ?? 0)}` }));
      if (compte) {
        embed.setURL(`https://x.com/${compte}`);
      }

      if (posts.length === 0) {
        embed.setDescription(
          "X n'a rendu aucun post original pour ce compte (chronologie vide, réservée, ou uniquement des réponses).",
        );
      } else {
        // Un champ par post : la description plafonne à 4096 et dix posts
        // bornés à 400 caractères la dépassent sans mal.
        for (const post of posts) {
          const [valeur] = decouperEnChamps(lignePostX(post), 1_024, 1);
          embed.addFields({
            name: typeof post.date === "string" ? `📅 ${post.date.slice(0, 10)}` : "📅 date inconnue",
            value: valeur ?? "—",
          });
        }
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "recherche",
    description: "Posts X correspondant à une requête, lus chez X à l'instant",
  })
  async recherche(
    @SlashOption({
      name: "requete",
      description: "Texte à chercher sur X (2 caractères au minimum)",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 2,
    })
    requete: string,
    @SlashOption({
      name: "limite",
      description: "Nombre de posts (1 à 10, 5 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 10,
    })
    limite: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("x.recherche", { requete, limite });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      // Le verbe demande le tri « Latest » à X, mais rien ne garantit l'ordre
      // de la charge rendue : on le rétablit ici, sinon la mention « tri le
      // plus récent » ci-dessous serait une promesse invérifiée.
      const posts = trierPostsParDate(Array.isArray(reponse.posts) ? (reponse.posts as PostXAffichable[]) : []);
      const embed = rgEmbed()
        .setTitle(`Recherche X — ${posts.length} résultat${posts.length > 1 ? "s" : ""}`)
        .setDescription(`Requête : « ${borner(requete, 200)} » · tri **le plus récent**.`)
        .setFooter(piedTexte({ note: `Lu en direct chez X en ${formaterLatence(reponse.ms ?? 0)}` }));

      if (posts.length === 0) {
        embed.addFields({
          name: "Aucun résultat",
          value: "X n'a rien renvoyé pour cette requête sur les posts récents.",
        });
      } else {
        for (const post of posts) {
          const [valeur] = decouperEnChamps(lignePostX(post), 1_024, 1);
          embed.addFields({
            name: typeof post.auteur === "string" && post.auteur.length > 0 ? `@${post.auteur}` : "compte inconnu",
            value: valeur ?? "—",
          });
        }
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
