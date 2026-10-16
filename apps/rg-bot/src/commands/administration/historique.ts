/**
 * `/moderation historique` — le dossier de modération d'un membre.
 *
 * ── LA BOUCLE QUE CETTE COMMANDE FERME ─────────────────────────────────────
 * `avertir`, `exclure`, `expulser` et `bannir` écrivent tous dans
 * `admin_audit_log` depuis le premier jour, et le code de `avertir` dit
 * lui-même pourquoi : « c'est la trace qui compte pour la suite (une récidive
 * se juge sur l'historique) ».
 *
 * Personne ne pouvait lire cet historique depuis Discord. Le staff écrivait
 * dans un journal consultable uniquement en ouvrant Postgres — autrement dit
 * jamais, et la gradation des sanctions se faisait de mémoire.
 *
 * ── CE QUE LA COMMANDE NE FAIT PAS ─────────────────────────────────────────
 * Elle ne RECOMMANDE aucune sanction. « Trois avertissements ⇒ exclusion » est
 * une règle de communauté, pas une règle de code : l'écrire ici la rendrait
 * invisible à ceux qui l'appliquent, et une phrase du bot du genre « à bannir »
 * serait lue comme un avis.
 *
 * ── TOUJOURS EN PRIVÉ ──────────────────────────────────────────────────────
 * Un dossier de modération nomme des fautes et ceux qui les ont sanctionnées.
 * Il ne s'affiche pas dans un salon, même de staff : c'est une consultation
 * personnelle, et l'éphémère est exactement l'outil pour ça.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, type ChatInputCommandInteraction, type User } from "discord.js";

import { sql } from "../../lib/db";
import {
  ACTIONS_MODERATION,
  iconeAction,
  JOURS_RECENTS,
  libelleAction,
  libelleResume,
  resumer,
  type EntreeHistorique,
} from "../../lib/sanctions";
import { borner, echec, fiche, ilYA, leJour, piedDeCommande, repondre, vide } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-moderation";

/**
 * Le dossier d'un membre, lu dans `admin_audit_log`.
 *
 * `entity_id` porte l'identifiant Discord de la CIBLE (c'est ce que les
 * commandes de modération y écrivent), et `details` le motif ainsi que
 * l'identifiant du membre du staff. On ne lit que les actions `discord.*` de
 * modération : le journal contient aussi des écritures de contenu, qui n'ont
 * rien à faire dans un dossier de membre.
 */
async function dossierDe(discordId: string, limite: number): Promise<EntreeHistorique[]> {
  const lignes = await sql<Array<{ action: string; details: Record<string, unknown> | null; created_at: Date }>>`
		SELECT action, details, created_at
		  FROM admin_audit_log
		 WHERE entity_id = ${discordId}
		   AND action = ANY(${[...ACTIONS_MODERATION]}::text[])
		 ORDER BY created_at DESC
		 LIMIT ${Math.min(50, Math.max(1, Math.floor(limite)))}
	`;
  return lignes.map(ligne => ({
    action: ligne.action,
    le: ligne.created_at,
    motif: typeof ligne.details?.motif === "string" ? ligne.details.motif : null,
    parQui: typeof ligne.details?.discord_id === "string" ? ligne.details.discord_id : null,
  }));
}

@Discord()
@SlashGroup({
  description: "Consulter le dossier de modération d'un membre",
  name: "historique",
  root: "moderation",
})
@SlashGroup("historique", "moderation")
export class ModerationHistoriqueCommand {
  @Slash({ description: "Le dossier de modération d'un membre", name: "membre" })
  async membre(
    @SlashOption({
      description: "Le membre dont tu veux voir le dossier",
      name: "membre",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    cible: User,
    @SlashOption({
      description: "Nombre d'entrées à afficher (10 par défaut, 50 au plus)",
      maxValue: 50,
      minValue: 1,
      name: "nombre",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    nombre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const entrees = await dossierDe(cible.id, nombre ?? 10);
      if (entrees.length === 0) {
        await repondre(
          interaction,
          vide(
            `Dossier vierge — ${cible.displayName}`,
            "Aucune trace de modération pour ce membre. " +
              "Les avertissements donnés avant la mise en service du journal n'y figurent pas.",
          ),
        );
        return;
      }

      const resume = resumer(entrees);
      const carte = fiche({
        description: libelleResume(resume),
        icone: "journal",
        intention: resume.recentes > 0 ? "attention" : "marque",
        miniature: cible.displayAvatarURL({ extension: "png", size: 128 }),
        titre: `Dossier de ${cible.displayName}`,
      });

      // Le décompte d'abord : c'est ce qu'on regarde en premier pour juger
      // d'une récidive.
      carte.champ(
        "Décompte",
        resume.parAction
          .filter(entree => entree.nombre > 0)
          .map(entree => `${iconeAction(entree.action)} ${libelleAction(entree.action)} — **${entree.nombre}**`)
          .join("\n"),
      );
      carte.champ(
        `Depuis ${JOURS_RECENTS} jours`,
        resume.recentes > 0 ? `**${resume.recentes}** entrée(s)` : "aucune",
        { enLigne: true },
      );
      carte.champ("Dernière", resume.derniere ? ilYA(resume.derniere.le) : "—", {
        enLigne: true,
      });

      carte.bloc(
        "Journal",
        entrees
          .map(entree => {
            const parQui = entree.parQui ? ` par <@${entree.parQui}>` : "";
            const motif = entree.motif ? ` — ${borner(entree.motif, 120)}` : "";
            return `${iconeAction(entree.action)} ${leJour(entree.le, "d")}${parQui}${motif}`;
          })
          .join("\n"),
        4,
      );
      if (carte.tronquee) {
        carte.champ("Journal écourté", "Le dossier ne tient pas dans un message. Réduis l'option `nombre`.");
      }

      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Dossier illisible", messagePanne(err)));
    }
  }

  @Slash({
    description: "Les dernières actions de modération du serveur",
    name: "recentes",
  })
  async recentes(
    @SlashOption({
      description: "Nombre d'entrées (15 par défaut, 50 au plus)",
      maxValue: 50,
      minValue: 1,
      name: "nombre",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    nombre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const lignes = await sql<
        Array<{
          action: string;
          entity_id: string | null;
          details: Record<string, unknown> | null;
          created_at: Date;
        }>
      >`
				SELECT action, entity_id, details, created_at
				  FROM admin_audit_log
				 WHERE action = ANY(${[...ACTIONS_MODERATION]}::text[])
				 ORDER BY created_at DESC
				 LIMIT ${Math.min(50, Math.max(1, Math.floor(nombre ?? 15)))}
			`;
      if (lignes.length === 0) {
        await repondre(
          interaction,
          vide("Aucune action de modération", "Le journal ne contient encore aucune sanction. C'est plutôt bon signe."),
        );
        return;
      }
      const carte = fiche({
        icone: "journal",
        titre: `${lignes.length} dernière(s) action(s) de modération`,
      });
      carte.bloc(
        "Journal",
        lignes
          .map(ligne => {
            const cible = ligne.entity_id ? `<@${ligne.entity_id}>` : "cible inconnue";
            const parQui = typeof ligne.details?.discord_id === "string" ? ` par <@${ligne.details.discord_id}>` : "";
            return `${iconeAction(ligne.action)} ${cible}${parQui} · ${ilYA(ligne.created_at)}`;
          })
          .join("\n"),
        5,
      );
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Journal illisible", messagePanne(err)));
    }
  }
}
