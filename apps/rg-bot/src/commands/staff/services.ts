/**
 * `/staff services` — l'état réel des services internes et des applications
 * Next servies par nginx.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * Rien : il n'existait aucun moyen de savoir depuis Discord si l'API, le
 * CDN ou le stockage répondaient. La seule façon de le voir était d'ouvrir une
 * session SSH. Une panne d'un service se manifestait donc par une commande qui
 * « ne marche pas », sans jamais dire quelle pièce était tombée.
 *
 * ── TROIS SOUS-COMMANDES, TROIS QUESTIONS ──────────────────────────────────
 *   `etat`        — tous, sondés EN PARALLÈLE (`sonderServices()`), avec la
 *                   latence, le détail rendu par la sonde et l'unité systemd à
 *                   regarder quand c'est rouge.
 *   `detail`      — un seul, en profondeur : rôle, base en boucle locale, URL
 *                   publique, sonde brute.
 *   `deploiement` — la version RÉELLEMENT servie par chaque application Next,
 *                   lue à la source (`state.json`, `live.env`, `RELEASE.json`).
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { rgEmbed } from "../../lib/embeds";
import { SERVICES, TOUS_LES_SERVICES, sonderServices, type NomService } from "../../lib/services";
import { borner, formaterLatence, horodatageAbsolu, horodatageRelatif, ligneSonde, pastilleEtat } from "./format";
import { APPLICATIONS_DEPLOYEES, lireEtatDeploiement, type EtatApplication } from "./deploiement";
import { differerEnPrive, exigerDroits, messagePanne } from "./garde";
import "./racine";
import { echec, pied, repondre } from "../../lib/ui";

/** Un service inconnu ne doit pas se transformer en appel vers une base vide. */
function resoudreService(saisie: string): NomService | null {
  const cible = saisie.trim().toLowerCase();
  return (TOUS_LES_SERVICES.find(service => service.nom === cible)?.nom as NomService | undefined) ?? null;
}

/** Une ligne de synthèse pour une application Next. */
function ligneApplication(etat: EtatApplication, sondeOk: boolean, latenceMs: number): string {
  const version = etat.version;
  const morceaux = [
    `${pastilleEtat(sondeOk)} **${etat.titre}** — slot \`${etat.slot ?? "?"}\``,
    etat.port ? `port ${etat.port}` : null,
    sondeOk ? formaterLatence(latenceMs) : "injoignable",
  ].filter(Boolean);
  const detail = version
    ? `\n   └ \`${version.buildId}\` · assemblée ${horodatageRelatif(version.assembleeLe)}`
    : "\n   └ version inconnue";
  return morceaux.join(" · ") + detail;
}

@Discord()
@SlashGroup({
  name: "services",
  description: "État des services internes et des applications déployées",
  root: "staff",
})
@SlashGroup("services", "staff")
export class StaffServicesCommand {
  @Slash({
    name: "etat",
    description: "Sonde les dix services internes en parallèle : vert/rouge, latence, unité",
  })
  async etat(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const sondes = await sonderServices();
      const debout = sondes.filter(sonde => sonde.ok).length;
      const tombes = sondes.filter(sonde => !sonde.ok);

      const embed = rgEmbed()
        .setTitle(`Services internes — ${debout}/${sondes.length} répondent`)
        // 1069 caractères mesurés le 13/8/2026 avec les dix services debout,
        // mais le détail vient des sondes elles-mêmes : une charge de santé
        // bavarde suffirait à franchir les 4096 et l'embed ENTIER serait
        // refusé. On borne plutôt que d'espérer.
        .setDescription(borner(sondes.map(ligneSonde).join("\n"), 4_000));

      if (tombes.length > 0) {
        // L'unité systemd est la SEULE information actionnable en panne :
        // on la sort du corps du tableau pour qu'elle ne se noie pas dedans.
        embed.addFields({
          name: "À regarder en premier",
          value: borner(
            tombes
              .map(sonde => `\`${sonde.service.unite ?? sonde.service.nom}\` — ${sonde.erreur ?? "injoignable"}`)
              .join("\n"),
            1_000,
          ),
        });
      }
      pied(embed, {
        note: "Une seule tentative, 3 s de délai — un tableau de bord, pas un diagnostic",
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "detail", description: "Fiche d'un service : rôle, adresses, sonde brute" })
  async detail(
    @SlashOption({
      name: "service",
      description: "Nom du service",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
        await interaction.respond(
          TOUS_LES_SERVICES.filter(
            service =>
              saisie.length === 0 || service.nom.includes(saisie) || service.titre.toLowerCase().includes(saisie),
          )
            .slice(0, 25)
            .map(service => ({ name: `${service.nom} — ${service.titre}`, value: service.nom })),
        );
      },
    })
    service: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const nom = resoudreService(service);
    if (!nom) {
      await interaction.editReply({
        content:
          `Service « ${borner(service, 60)} » inconnu. Les dix noms possibles : ` +
          TOUS_LES_SERVICES.map(s => `\`${s.nom}\``).join(", "),
      });
      return;
    }
    try {
      const description = SERVICES[nom];
      const [sonde] = await sonderServices([description]);
      const embed = rgEmbed()
        .setTitle(`${pastilleEtat(sonde!.ok)} ${description.titre}`)
        .setURL(description.publique)
        .setDescription(description.role)
        .addFields(
          { name: "Identifiant", value: `\`${description.nom}\``, inline: true },
          {
            name: "Unité systemd",
            value: description.unite ? `\`${description.unite}\`` : "*aucune*",
            inline: true,
          },
          { name: "Latence", value: formaterLatence(sonde!.latenceMs), inline: true },
          {
            name: "Base en boucle locale",
            value: `\`${description.base}${description.sante}\``,
          },
          { name: "URL publique", value: description.publique },
          {
            name: "Réponse de la sonde",
            value: sonde!.ok
              ? (sonde!.detail ?? "*réponse sans scalaire lisible*")
              : `⚠ ${sonde!.erreur ?? "injoignable"}`,
          },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "deploiement",
    description: "Version réellement servie par le wiki et le site, slot par slot",
  })
  async deploiement(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const [etats, sondes] = await Promise.all([
        lireEtatDeploiement(),
        sonderServices(APPLICATIONS_DEPLOYEES.map(application => SERVICES[application.service])),
      ]);

      const embed = rgEmbed()
        .setTitle("Déploiement bleu/vert — versions servies")
        .setDescription(
          borner(
            etats
              .map((etat, rang) => {
                const sonde = sondes[rang];
                return ligneApplication(etat, sonde?.ok ?? false, sonde?.latenceMs ?? 0);
              })
              .join("\n"),
            4_000,
          ),
        );

      for (const etat of etats) {
        const lignes = [
          `Version : \`${etat.version?.identifiant ?? "inconnue"}\``,
          `Précédente : \`${etat.versionPrecedente?.identifiant ?? "aucune"}\``,
          etat.commit ? `Commit : \`${etat.commit.slice(0, 12)}\` sur \`${etat.branche ?? "?"}\`` : null,
          etat.assembleeLe ? `Assemblée : ${horodatageAbsolu(etat.assembleeLe)}` : null,
          etat.unite ? `Unité servie : \`${etat.unite}\`` : null,
          etat.misAJourLe ? `Bascule : ${horodatageRelatif(etat.misAJourLe)}` : null,
          etat.previsualisation ? `⚠ Prévisualisation ouverte sur la doublure : \`${etat.previsualisation}\`` : null,
          etat.incoherence ? `⚠ Incohérence : ${etat.incoherence}` : null,
          etat.manquant.length > 0 ? `⚠ Non lisible : ${etat.manquant.map(f => `\`${f}\``).join(", ")}` : null,
          etat.historique[0]
            ? `Dernière action : \`${etat.historique[0].action}\` ${
                etat.historique[0].ok ? "réussie" : "**échouée**"
              } ${horodatageRelatif(etat.historique[0].at)}`
            : null,
        ].filter((ligne): ligne is string => ligne !== null);
        embed.addFields({ name: etat.titre, value: borner(lignes.join("\n"), 1_000) });
      }

      pied(embed, {
        note: "Lu dans state.json, live.env et RELEASE.json · mémoire et état systemd : bun run deploy status",
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
