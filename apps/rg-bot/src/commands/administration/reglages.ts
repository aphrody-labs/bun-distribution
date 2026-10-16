/**
 * `/administration reglages` — la table `public.settings`, en lecture et en
 * écriture.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * `/rg-settings list|get|set`. Trois défauts réels y sont corrigés :
 *
 *  1. **`interaction.reply` sans `deferReply` en cas de refus d'accès.**
 *     `withRgAdmin` vérifiait le rôle AVANT de différer : sur une base froide
 *     (le cache RBAC vit 60 s, donc vide au premier appel après un
 *     redémarrage), la vérification dépassait les 3 secondes accordées par
 *     Discord et l'interaction était perdue — sans message, sans trace. Ici on
 *     diffère TOUJOURS en premier (`differerEnPrive`).
 *  2. **Réponses publiques.** `deferReply()` sans `Ephemeral` déposait la
 *     valeur d'un réglage dans l'historique du salon. Un réglage n'a rien d'un
 *     secret, mais il n'a rien à faire non plus dans un fil de discussion.
 *  3. **Aucune garde sur la clé.** `set` faisait un `INSERT … ON CONFLICT` sur
 *     la chaîne saisie : « tweets.notifications » (un `s` de trop) créait une
 *     NEUVIÈME ligne que personne ne lit, pendant qu'on croyait avoir changé le
 *     réglage. Désormais la forme est vérifiée (`normaliserCleReglage`) et une
 *     clé inconnue exige un `creer:true` explicite.
 *
 * ── POURQUOI DEUX LECTURES VIVENT SOUS `/administration` ───────────────────
 * `liste` et `lire` ne modifient rien, et pourtant elles sont ici : elles
 * servent à préparer un `ecrire`, et les séparer de deux racines différentes
 * obligerait à sortir du groupe pour relire la valeur qu'on s'apprête à
 * remplacer. C'est la seule exception, et elle est bornée à ce groupe.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { rgEmbed } from "../../lib/embeds";
import { CLE_REGLAGE_TWEETS } from "../../lib/tweets-format";
import { getSettingDetail, listSettings, setSetting } from "../../services/admin";
import { blocJson, borner, decouperEnChamps, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import {
  analyserValeurReglage,
  bornerValeur,
  decrireChangement,
  normaliserCleReglage,
  refusValeurReglage,
} from "./valeurs";
import "./racine";
import { echec, piedTexte, refus as accesRefuse, repondre } from "../../lib/ui";

/**
 * Propositions d'autocomplétion : les clés RÉELLES de la table.
 *
 * Une liste écrite en dur divergerait au premier réglage ajouté par le site.
 * Discord n'accorde que 3 secondes à une autocomplétion et n'affiche aucune
 * erreur : si la base ne répond pas, on rend une liste vide plutôt que de
 * laisser l'appel se perdre.
 */
async function suggererCles(interaction: AutocompleteInteraction): Promise<void> {
  const saisie = String(interaction.options.getFocused() ?? "")
    .trim()
    .toLowerCase();
  try {
    const lignes = await listSettings();
    await interaction.respond(
      lignes
        .filter(ligne => saisie.length === 0 || ligne.key.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(ligne => ({ name: borner(ligne.key, 100), value: ligne.key })),
    );
  } catch {
    await interaction.respond([]);
  }
}

@Discord()
@SlashGroup({
  name: "reglages",
  description: "Réglages clé/valeur du site (table settings)",
  root: "administration",
})
@SlashGroup("reglages", "administration")
export class AdministrationReglagesCommand {
  @Slash({ name: "liste", description: "Toutes les clés de réglage, avec leur rôle" })
  async liste(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const lignes = await listSettings();
      if (lignes.length === 0) {
        await interaction.editReply({
          content: "La table `settings` est vide — aucun réglage à afficher.",
        });
        return;
      }
      const embed = rgEmbed()
        .setTitle(`Réglages — ${lignes.length} clés`)
        .setFooter(piedTexte({ note: "Lecture : /administration reglages lire · écriture : … ecrire" }));

      // Une clé + sa description dépasse vite les 4 096 caractères d'une
      // description d'embed quand la table grossit : on découpe en champs
      // bornés plutôt que de risquer un envoi refusé en entier.
      const corps = lignes
        .map(ligne => `\`${ligne.key}\` — ${borner(ligne.description ?? bornerValeur(ligne.value), 120)}`)
        .join("\n");
      // 5 champs de 1 000 caractères au plus : le total d'un embed est plafonné
      // à 6 000 par Discord, titre et pied compris.
      const morceaux = decouperEnChamps(corps, 1_000, 5);
      for (const [rang, morceau] of morceaux.entries()) {
        embed.addFields({
          name: rang === 0 ? "Clés" : `Clés (suite ${rang + 1})`,
          value: morceau,
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "lire", description: "Valeur exacte d'une clé, telle qu'elle est stockée" })
  async lire(
    @SlashOption({
      name: "clef",
      description: "Clé du réglage",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: suggererCles,
    })
    clef: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const cle = normaliserCleReglage(clef);
    if (!cle) {
      await interaction.editReply({
        content: `Clé « ${borner(clef, 60)} » mal formée (attendu : \`domaine.sous_clef\`, en minuscules).`,
      });
      return;
    }
    try {
      const ligne = await getSettingDetail(cle);
      if (!ligne) {
        await interaction.editReply({
          content: `Aucun réglage sous la clé \`${cle}\`. Voir \`/administration reglages liste\`.`,
        });
        return;
      }
      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle(`⚙ ${ligne.key}`)
            .setDescription(ligne.description ?? "*(sans description)*")
            .addFields(
              { name: "Valeur (jsonb)", value: blocJson(ligne.value, 1_000) },
              {
                name: "Dernière écriture",
                value: horodatageRelatif(ligne.updated_at),
                inline: true,
              },
            ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "ecrire",
    description: "Remplace la valeur d'une clé (rôle admin, destructif, tracé)",
  })
  async ecrire(
    @SlashOption({
      name: "clef",
      description: "Clé du réglage",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: suggererCles,
    })
    clef: string,
    @SlashOption({
      name: "valeur",
      description: 'Valeur JSON (60, true, "texte", {…}) ; sinon rangée telle quelle en chaîne',
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    valeur: string,
    @SlashOption({
      name: "description",
      description: "Description de la clé (laissée inchangée si omise)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    description: string | undefined,
    @SlashOption({
      name: "creer",
      description: "Autorise la création d'une clé qui n'existe pas encore",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    creer: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    // Écriture en production : rôle `admin`, jamais `staff`.
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }

    const cle = normaliserCleReglage(clef);
    if (!cle) {
      await interaction.editReply({
        content:
          `Clé « ${borner(clef, 60)} » refusée : attendu \`domaine.sous_clef\`, en minuscules, ` +
          "sans espace. La table n'a aucune contrainte de forme — une clé mal écrite créerait " +
          "une ligne jumelle que plus rien ne lit.",
      });
      return;
    }

    try {
      const avant = await getSettingDetail(cle);
      if (!avant && creer !== true) {
        await interaction.editReply({
          content:
            `La clé \`${cle}\` n'existe pas encore. Si c'est voulu, relance avec \`creer:true\` ; ` +
            "sinon vérifie l'orthographe dans `/administration reglages liste`.",
        });
        return;
      }

      const lue = analyserValeurReglage(valeur);
      // Certaines clés sont relues par un lecteur tolérant qui ignore en
      // silence une valeur mal formée : la refuser AVANT l'écriture est la
      // seule façon de ne pas perdre le réglage sans message.
      const refus = refusValeurReglage(cle, lue.valeur);
      if (refus) {
        await repondre(interaction, accesRefuse(borner(refus, 1_800)));
        return;
      }
      await setSetting(cle, lue.valeur, description);

      // On relit APRÈS écriture : c'est la seule preuve que la valeur a
      // atterri telle qu'annoncée (le passage par `jsonb` réordonne les clés
      // d'un objet et normalise les nombres).
      const apres = await getSettingDetail(cle);

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "reglages.ecrire",
        targetType: "settings",
        targetId: cle,
        details: {
          avant: avant?.value ?? null,
          apres: apres?.value ?? lue.valeur,
          creation: !avant,
          description_changee: description !== undefined,
        },
      });

      const embed = rgEmbed()
        .setTitle(avant ? `⚙ ${cle} — remplacé` : `⚙ ${cle} — créé`)
        .setDescription(decrireChangement(avant?.value ?? null, apres?.value ?? lue.valeur, 300))
        .addFields({
          name: "Valeur relue en base",
          value: blocJson(apres?.value ?? lue.valeur, 1_000),
        })
        .setFooter(
          piedTexte({
            note: lue.json
              ? "Saisie lue comme du JSON · écriture tracée dans admin_audit_log"
              : "Saisie rangée en chaîne (ce n'était pas du JSON) · écriture tracée dans admin_audit_log",
          }),
        );

      if (cle === CLE_REGLAGE_TWEETS) {
        // Écrire ce réglage à la main court-circuite la vérification du salon
        // faite par `/administration veille regler` : un salon que le bot ne
        // voit pas fait taire la notification sans le moindre message.
        embed.addFields({
          name: "⚠ Réglage piloté par une commande dédiée",
          value:
            "`/administration veille regler` vérifie que le bot peut réellement écrire dans le " +
            "salon avant d'enregistrer, et ne réécrit que les champs modifiés. Préfère-la.",
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
