/**
 * `/administration synchroniser` — la table `discord_members` remise au niveau
 * du serveur Discord.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * `/sync` (`commands/sync.ts`), qui répondait « ✓ Synced 1849/1849 members in
 * 42000ms » — en anglais, sans trace d'audit, et surtout sans jamais parler des
 * DÉPARTS. Un membre parti restait compté présent (les statistiques du site
 * filtrent sur `left_at IS NULL`) jusqu'au prochain passage de la tâche
 * `discord` du cron. Sur la base réelle au 13/8/2026 : 1 849 présents,
 * 226 partis, 2 075 lignes.
 *
 * ── POURQUOI LA BOUCLE EST ÉCRITE ICI ──────────────────────────────────────
 * `syncAllMembers` ne rend que des compteurs (`fetched`, `upserted`) : elle ne
 * dit pas QUI le serveur a rendu, donc elle ne permet pas de calculer les
 * arrivées, les retours et les départs. On garde son cœur — `syncOneMember`,
 * qui fait l'`INSERT … ON CONFLICT` et la mise à jour de l'avatar du compte lié
 * — et on tient nous-mêmes la liste rendue par la passerelle.
 *
 * ── DÉPARTS : DIFFÉRENCE D'ENSEMBLES, PAS HEURISTIQUE D'HORODATAGE ─────────
 * La réconciliation du cron marque partis « tous ceux dont `updated_at` est
 * antérieur au début du balayage ». Si l'écriture d'un membre échoue, il est
 * déclaré parti alors qu'il est là. Ici la comparaison porte sur les
 * IDENTIFIANTS rendus par Discord : un échec d'écriture reste un échec
 * d'écriture, il ne se transforme pas en départ fictif.
 *
 * ⚠ Contrairement au cron, cette commande NE SUPPRIME PAS les profils non
 * réclamés des membres partis. Effacer une ligne de `profiles` est irréversible
 * et n'a pas à se déclencher depuis un salon.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, type ChatInputCommandInteraction, type User } from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import { rgEmbed } from "../../lib/embeds";
import { syncOneMember, syncOneUser } from "../../services/syncMembers";
import { litteralTexteArray } from "../../services/tweets";
import { borner, formaterDuree, formaterNombre, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import { comparerMembres, departSuspect, type EtatMembreEnBase } from "./valeurs";
import "./racine";
import { echec, piedTexte, repondre } from "../../lib/ui";

/** Ce que la base sait des membres avant le balayage. */
async function lireEtatEnBase(): Promise<EtatMembreEnBase[]> {
  const lignes = await sql<Array<{ discord_id: string; parti: boolean }>>`
		SELECT discord_id, left_at IS NOT NULL AS parti FROM public.discord_members
	`;
  return lignes.map(ligne => ({ discordId: ligne.discord_id, parti: ligne.parti }));
}

/**
 * Marque partis les membres que le serveur n'a plus rendus.
 *
 * `left_at` remplace la suppression de la ligne (migration
 * `20260811_discord_departs.sql`) : l'historique reste consultable, et un
 * retour est rattrapé par `syncOneMember`, qui remet `left_at` à `NULL`.
 */
async function marquerPartis(identifiants: readonly string[]): Promise<number> {
  if (identifiants.length === 0) {
    return 0;
  }
  // Bun.SQL sérialise un tableau JS en `a,b`, que Postgres rejette
  // (« malformed array literal ») : on passe par le littéral `{"a","b"}`, qui
  // reste un PARAMÈTRE lié — jamais du SQL concaténé.
  const litteral = litteralTexteArray(identifiants);
  const touchees = await sql<Array<{ discord_id: string }>>`
		UPDATE public.discord_members
		   SET left_at = now(), updated_at = now()
		 WHERE left_at IS NULL AND discord_id = ANY(${litteral}::text[])
		RETURNING discord_id
	`;
  return touchees.length;
}

@Discord()
@SlashGroup({
  name: "synchroniser",
  description: "Synchronisation des membres Discord vers la base",
  root: "administration",
})
@SlashGroup("synchroniser", "administration")
export class AdministrationSynchroniserCommand {
  @Slash({
    name: "membres",
    description: "Balaie tout le serveur : arrivées, mises à jour, retours, départs (rôle admin)",
  })
  async membres(
    @SlashOption({
      name: "departs",
      description: "Marquer partis les membres absents du serveur (oui par défaut)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    departs: boolean | undefined,
    @SlashOption({
      name: "forcer",
      description: "Accepte une vague de départs anormalement grosse",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    forcer: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    // Le balayage réécrit ~2 000 lignes et peut marquer des départs : rôle
    // `admin`, jamais `staff`.
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }
    const serveur = interaction.guild;
    if (!serveur) {
      await interaction.editReply({
        content: "Commande utilisable seulement depuis un serveur, pas en message privé.",
      });
      return;
    }

    const debut = Date.now();
    try {
      const enBase = await lireEtatEnBase();
      // Liste AUTORITAIRE : ce que la passerelle rend maintenant, pas le cache
      // du client (qui garde les membres déjà vus, même partis).
      const membres = await serveur.members.fetch();
      const resume = comparerMembres(enBase, membres.keys());

      const echecs: Array<{ identifiant: string; raison: string }> = [];
      // Séquentiel, délibérément : `syncOneMember` fait deux requêtes par
      // membre, et ~2 000 membres lancés en parallèle ouvriraient d'un coup
      // autant d'écritures sur le même pool — la synchronisation ferait tomber
      // les commandes des autres. La boucle prend quelques secondes, très loin
      // des 15 minutes du jeton d'interaction.
      for (const membre of membres.values()) {
        try {
          await syncOneMember(membre);
        } catch (err) {
          echecs.push({
            identifiant: membre.id,
            raison: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Départs ──────────────────────────────────────────────────────────
      const presentsEnBase = enBase.filter(ligne => !ligne.parti).length;
      const suspect = departSuspect(resume.partis.length, presentsEnBase);
      let partisMarques = 0;
      let noteDeparts: string;
      if (departs === false) {
        noteDeparts = `${formaterNombre(resume.partis.length)} détecté(s), **aucun marqué** (option \`departs:false\`).`;
      } else if (suspect && forcer !== true) {
        noteDeparts =
          `⚠ ${formaterNombre(resume.partis.length)} départs pour ${formaterNombre(presentsEnBase)} présents : ` +
          "c'est la signature d'une liste de membres rendue incomplète par la passerelle, pas d'un " +
          "exode. **Rien n'a été marqué.** Relance avec `forcer:true` si c'est bien réel.";
      } else {
        partisMarques = await marquerPartis(resume.partis);
        noteDeparts = `${formaterNombre(partisMarques)} marqué(s) partis (\`left_at\`).`;
      }

      const dureeMs = Date.now() - debut;
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "synchroniser.membres",
        targetType: "discord_members",
        targetId: serveur.id,
        details: {
          rendus: membres.size,
          ajoutes: resume.ajoutes.length,
          mis_a_jour: resume.misAJour,
          revenus: resume.revenus.length,
          partis_detectes: resume.partis.length,
          partis_marques: partisMarques,
          echecs: echecs.length,
          duree_ms: dureeMs,
        },
      });

      const embed = rgEmbed()
        .setTitle("Synchronisation des membres — terminée")
        .setDescription(
          [
            `Rendus par Discord : **${formaterNombre(membres.size)}**`,
            `Connus en base avant : **${formaterNombre(enBase.length)}** (dont ${formaterNombre(presentsEnBase)} présents)`,
            `Durée : ${formaterDuree(dureeMs)}`,
          ].join("\n"),
        )
        .addFields(
          { name: "Arrivées", value: formaterNombre(resume.ajoutes.length), inline: true },
          { name: "Mises à jour", value: formaterNombre(resume.misAJour), inline: true },
          { name: "Retours", value: formaterNombre(resume.revenus.length), inline: true },
          { name: "Départs", value: noteDeparts },
        )
        .setFooter(
          piedTexte({
            note: "Les profils non réclamés ne sont PAS supprimés ici — c'est le rôle de la tâche discord du cron",
          }),
        );

      if (echecs.length > 0) {
        embed.addFields({
          name: `Écritures en échec — ${formaterNombre(echecs.length)}`,
          value: borner(
            echecs
              .slice(0, 5)
              .map(echec => `\`${echec.identifiant}\` — ${borner(echec.raison, 120)}`)
              .join("\n"),
            1_000,
          ),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "membre",
    description: "Resynchronise une seule personne, sans balayer tout le serveur",
  })
  async membre(
    @SlashOption({
      name: "utilisateur",
      description: "Personne à resynchroniser",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    utilisateur: User,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    // Une seule ligne réécrite, et rien n'est effacé : ouvert au staff.
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const serveur = interaction.guild;
    if (!serveur) {
      await interaction.editReply({
        content: "Commande utilisable seulement depuis un serveur, pas en message privé.",
      });
      return;
    }

    try {
      // `syncOneUser` retrouve le membre du serveur ; s'il n'y est plus, elle
      // rafraîchit tout de même la ligne (pseudo, avatar) sans toucher à
      // `left_at`, qui est la décision d'un balayage complet.
      await syncOneUser(utilisateur, serveur);

      // Relecture : la seule preuve que la ligne existe et que l'écriture a
      // porté. Aucune colonne personnelle n'est lue — `discord_members` ne
      // contient ni adresse électronique ni adresse postale, et rien de tel ne
      // sortira jamais dans un salon.
      const lignes = await sql<
        Array<{
          discord_id: string;
          username: string | null;
          display_name: string | null;
          nickname: string | null;
          roles: string[] | null;
          is_bot: boolean | null;
          left_at: Date | null;
          updated_at: Date | null;
        }>
      >`
				SELECT discord_id, username, display_name, nickname, roles, is_bot, left_at, updated_at
				FROM public.discord_members
				WHERE discord_id = ${utilisateur.id}
				LIMIT 1
			`;
      const ligne = lignes[0];
      if (!ligne) {
        await interaction.editReply({
          content:
            `Aucune ligne pour <@${utilisateur.id}> après synchronisation : cette personne n'est ` +
            "pas membre du serveur et n'a jamais été enregistrée.",
        });
        return;
      }

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "synchroniser.membre",
        targetType: "discord_members",
        targetId: utilisateur.id,
        details: { present: ligne.left_at === null },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle("Membre resynchronisé")
            .setDescription(`<@${ligne.discord_id}> — \`${ligne.discord_id}\``)
            .addFields(
              {
                name: "Pseudo",
                value: borner(ligne.username ?? "—", 200),
                inline: true,
              },
              {
                name: "Nom affiché",
                value: borner(ligne.nickname ?? ligne.display_name ?? "—", 200),
                inline: true,
              },
              {
                name: "Rôles",
                value: formaterNombre(ligne.roles?.length ?? 0),
                inline: true,
              },
              {
                name: "Présence",
                value: ligne.left_at ? `parti ${horodatageRelatif(ligne.left_at)}` : "présent sur le serveur",
                inline: true,
              },
              {
                name: "Ligne écrite",
                value: horodatageRelatif(ligne.updated_at),
                inline: true,
              },
              { name: "Compte de robot", value: ligne.is_bot ? "oui" : "non", inline: true },
            ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
