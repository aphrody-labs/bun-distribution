/**
 * `/staff web` — lire une page publique depuis Discord, sans ouvrir de session.
 *
 *   `page`   — rend une page en markdown (verbe IPC `scrape.page`).
 *   `google` — recherche web (verbe IPC `scrape.google`).
 *   `recon`  — diagnostic technique d'une page (verbe IPC `scrape.recon`).
 *
 * ── CE QUE LE CONTRAT IMPOSE D'AFFICHER ────────────────────────────────────
 * `scrape.google` renvoie un champ `moteur` qui vaut `"google"` ou
 * `"duckduckgo"`, et ce champ N'EST PAS décoratif : mesuré le 13/8/2026, Google
 * sert une page reCAPTCHA à l'adresse IP de ce VPS sur tous les transports, et
 * le verbe se rabat alors sur le rendu HTML de DuckDuckGo. Ne pas l'afficher
 * ferait passer des résultats DuckDuckGo pour des résultats Google — une
 * différence qui compte dès qu'on compare deux relevés.
 *
 * De même, `scrape.recon` distingue `octets` (ce qui a été RÉELLEMENT lu) de la
 * taille de la ressource, et pose `corpsTronque` quand la lecture s'est arrêtée
 * au plafond de 2 Mo. Afficher `octets` comme « poids de la page » serait faux
 * dans ce cas : l'embed dit donc « lus », et signale la troncature.
 *
 * ── CE QUE CETTE COMMANDE NE PEUT PAS ATTEINDRE ────────────────────────────
 * Le service refuse `localhost`, les plages privées et tout schéma autre que
 * http/https : le démon partage sa machine avec dix services en écoute sur
 * `127.0.0.1`. Une adresse interne ressort en `requete_invalide`, et c'est
 * voulu.
 *
 * ── QUAND LE PONT EST ABSENT ───────────────────────────────────────────────
 * `CronInjoignableError` ne veut PAS dire que le site visé est en panne. Le
 * message le dit explicitement (cf. `messagePanne`) : sans cette précision, un
 * échec de notre démon se lit comme un échec de la cible et envoie chercher au
 * mauvais endroit.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js";

import { appelerCron } from "../../lib/cron-ipc";
import { rgEmbed } from "../../lib/embeds";
import {
  borner,
  decouperEnChamps,
  echapperMarkdown,
  formaterEnTetes,
  formaterLatence,
  formaterNombre,
  formaterOctets,
  ligneResultatWeb,
  listeCourte,
  type ResultatRechercheWeb,
} from "./format";
import { differerEnPrive, exigerDroits, expliquerRefusScrape, messagePanne } from "./garde";
import "./racine";
import { echec, pied, piedTexte, repondre } from "../../lib/ui";

/** Marge de la socket au-delà du délai que le verbe s'accorde. */
const MARGE_IPC_MS = 10_000;

/** Délais du contrat, verbe par verbe (`scrape-service.ts`). */
const DELAIS_VERBE_MS: Record<string, number> = {
  "scrape.page": 45_000,
  "scrape.google": 40_000,
  "scrape.recon": 30_000,
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

/** Nom lisible du moteur ayant réellement répondu. */
function libelleMoteur(moteur: unknown): string {
  if (moteur === "google") {
    return "Google";
  }
  if (moteur === "duckduckgo") {
    return "DuckDuckGo (repli — Google bloque l'adresse IP de ce serveur)";
  }
  return "moteur inconnu";
}

@Discord()
@SlashGroup({
  name: "web",
  description: "Lecture et diagnostic d'une page publique, par le démon de tâches",
  root: "staff",
})
@SlashGroup("web", "staff")
export class StaffWebCommand {
  @Slash({ name: "page", description: "Rend une page publique en markdown lisible" })
  async page(
    @SlashOption({
      name: "url",
      description: "Adresse publique, en http ou https",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    url: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("scrape.page", { url });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      const adresse = typeof reponse.url === "string" ? reponse.url : url;
      const markdown = typeof reponse.markdown === "string" ? reponse.markdown : "";
      const embed = rgEmbed()
        .setTitle(borner(typeof reponse.titre === "string" && reponse.titre ? reponse.titre : adresse, 250))
        .setURL(adresse)
        // Le markdown vient d'une page tierce : le contrat le borne déjà à
        // 3500 caractères, on garde la marge sous les 4096 de Discord.
        .setDescription(borner(markdown, 3_900) || "*(page sans contenu textuel)*")
        .addFields(
          {
            name: "Réponse HTTP",
            value: typeof reponse.statut === "number" ? String(reponse.statut) : "inconnue",
            inline: true,
          },
          {
            // Le contrat le dit : `octets` = poids UTF-8 du HTML SOURCE, pas
            // le poids du markdown affiché ni celui de la page avec ses
            // ressources. Le libellé doit donc le nommer.
            name: "HTML source",
            value: formaterOctets(typeof reponse.octets === "number" ? reponse.octets : null),
            inline: true,
          },
          {
            name: "Rendu",
            value: "Aphrody Web CDP",
            inline: true,
          },
        )
        .setFooter(
          piedTexte({
            note:
              `Rendu en ${formaterLatence(reponse.ms ?? 0)}` +
              (reponse.tronque === true ? " · markdown tronqué à 3500 caractères" : ""),
          }),
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "google", description: "Recherche web, avec le moteur qui a réellement répondu" })
  async google(
    @SlashOption({
      name: "requete",
      description: "Texte à chercher (2 caractères au minimum)",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 2,
    })
    requete: string,
    @SlashOption({
      name: "limite",
      description: "Nombre de résultats (1 à 8, 5 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 8,
    })
    limite: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("scrape.google", { requete, limite });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      const resultats = Array.isArray(reponse.resultats) ? (reponse.resultats as ResultatRechercheWeb[]) : [];
      const embed = rgEmbed()
        .setTitle(`Recherche web — ${resultats.length} résultat${resultats.length > 1 ? "s" : ""}`)
        .setDescription(
          resultats.length > 0
            ? borner(resultats.map((resultat, rang) => ligneResultatWeb(resultat, rang + 1)).join("\n\n"), 3_900)
            : "Aucun résultat.",
        )
        .addFields({
          name: "Moteur",
          // Champ obligatoire : sans lui, un relevé DuckDuckGo se lit comme
          // un relevé Google.
          value: libelleMoteur(reponse.moteur),
        })
        .setFooter(
          piedTexte({
            note: `Requête « ${borner(String(reponse.requete ?? requete), 80)} » · ${formaterLatence(reponse.ms ?? 0)}`,
          }),
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "recon",
    description: "Diagnostic d'une page : en-têtes, technologies détectées, liens",
  })
  async recon(
    @SlashOption({
      name: "url",
      description: "Adresse publique, en http ou https",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    url: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const reponse = await appelerVerbe("scrape.recon", { url });
      if (!reponse.success) {
        await repondre(interaction, echec("Lecture impossible", expliquerRefusScrape(reponse.code, reponse.error)));
        return;
      }
      const adresse = typeof reponse.urlFinale === "string" ? reponse.urlFinale : url;
      const liens = (reponse.liens ?? {}) as Record<string, unknown>;
      const embed = rgEmbed()
        .setTitle(borner(typeof reponse.titre === "string" && reponse.titre ? reponse.titre : adresse, 250))
        .setURL(adresse)
        .setDescription(
          [
            `Demandée : \`${borner(String(reponse.url ?? url), 300)}\``,
            adresse !== reponse.url ? `Servie : \`${borner(adresse, 300)}\`` : null,
            `Statut : **${typeof reponse.statut === "number" ? reponse.statut : "?"}** ${
              typeof reponse.statutTexte === "string" ? reponse.statutTexte : ""
            }`.trim(),
            `Type : \`${borner(String(reponse.typeContenu ?? "—"), 120)}\``,
          ]
            .filter((ligne): ligne is string => ligne !== null)
            .join("\n"),
        )
        .addFields(
          {
            name: "Corps lu",
            value:
              formaterOctets(typeof reponse.octets === "number" ? reponse.octets : null) +
              (reponse.corpsTronque === true
                ? "\n⚠ lecture arrêtée au plafond de 2 Mo — la taille réelle n'est pas connue"
                : ""),
            inline: true,
          },
          {
            name: "Liens",
            value:
              typeof liens.total === "number"
                ? `${formaterNombre(liens.total)} au total\n${formaterNombre(
                    typeof liens.internes === "number" ? liens.internes : null,
                  )} internes · ${formaterNombre(typeof liens.externes === "number" ? liens.externes : null)} externes`
                : "—",
            inline: true,
          },
          {
            name: "Technologies détectées",
            value: listeCourte(reponse.technologies, 14, 1_000),
          },
        );

      for (const champ of decouperEnChamps(formaterEnTetes(reponse.enTetes), 1_024, 2)) {
        embed.addFields({ name: "En-têtes d'infrastructure", value: champ });
      }

      const exemples = Array.isArray(liens.exemples) ? (liens.exemples as unknown[]) : [];
      if (exemples.length > 0) {
        embed.addFields({
          name: "Quelques liens",
          value: borner(
            exemples
              .filter((lien): lien is string => typeof lien === "string")
              .map(lien => `• ${echapperMarkdown(lien)}`)
              .join("\n"),
            1_000,
          ),
        });
      }

      pied(embed, {
        note: `Diagnostic maison en ${formaterLatence(reponse.ms ?? 0)} · aucun en-tête d'authentification n'est affiché`,
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
