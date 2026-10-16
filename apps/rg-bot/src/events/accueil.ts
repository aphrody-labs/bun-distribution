/**
 * Accueil des nouveaux membres.
 *
 * ── CE QUE ÇA REMPLACE ─────────────────────────────────────────────────────
 * Le message de bienvenue d'un bot tiers. Trois différences qui comptent :
 *
 *  1. **`aucune` par défaut.** Un serveur qui reçoit vingt arrivées par jour
 *     n'a peut-être aucune envie de vingt messages. Le staff dit où, ou rien
 *     n'est publié.
 *  2. **Le rôle d'arrivée passe par la garde stricte.** Un rôle posé à CHAQUE
 *     arrivée est la surface de distribution la plus large qui existe — plus
 *     large qu'un menu en libre-service, où il faut au moins cliquer. Il est
 *     donc soumis aux mêmes refus que les récompenses de niveau
 *     (`lib/hierarchie.ts`), et revérifié à chaque arrivée.
 *  3. **Aucune mention de masse.** Le message mentionne l'arrivant, personne
 *     d'autre : `allowedMentions` le borne explicitement, pour qu'un `@everyone`
 *     glissé dans le texte configurable par le staff ne devienne pas un ping de
 *     deux mille personnes.
 *
 * ── POURQUOI PAS DE DÉPART ─────────────────────────────────────────────────
 * Pas de message d'au revoir : sur un serveur de cette taille, il annonce
 * publiquement chaque départ, y compris ceux qui suivent un conflit ou une
 * sanction. C'est une information qui appartient au staff, et le journal
 * d'audit de Discord la porte déjà.
 */
import { type ArgsOf, Discord, On } from "discordx";
import { AttachmentBuilder, type GuildMember, type TextBasedChannel } from "discord.js";

import { renderCarteAccueil } from "../lib/canvas/communaute";
import { remplirGabarit } from "../lib/accueil-gabarit";
import { verifierAttributionAutomatique } from "../lib/hierarchie";
import { reglagesDe } from "../services/communaute";
import { creerEmbed, pied } from "../lib/ui";

/** Pose le rôle d'arrivée, si et seulement si il est sûr. */
async function poserRoleArrivee(membre: GuildMember, roleId: string): Promise<void> {
  const role = membre.guild.roles.cache.get(roleId);
  if (!role) {
    console.warn(`[accueil] rôle d'arrivée ${roleId} introuvable sur ${membre.guild.id}.`);
    return;
  }
  const moi = membre.guild.members.me;
  const verdict = verifierAttributionAutomatique(
    {
      estEveryone: role.id === membre.guild.id,
      gereParIntegration: role.managed,
      id: role.id,
      nom: role.name,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
    },
    {
      peutGererRoles: moi?.permissions.has("ManageRoles") ?? false,
      positionMax: moi?.roles.highest.position ?? 0,
    },
  );
  if (!verdict.ok) {
    console.warn(`[accueil] rôle d'arrivée REFUSÉ (${role.name}) : ${verdict.motif}`);
    return;
  }
  try {
    await membre.roles.add(role.id, "Rôle d'arrivée");
  } catch (err) {
    console.warn(`[accueil] rôle d'arrivée non posé sur ${membre.id} :`, err instanceof Error ? err.message : err);
  }
}

@Discord()
export class AccueilEvents {
  @On({ event: "guildMemberAdd" })
  async surArrivee([membre]: ArgsOf<"guildMemberAdd">) {
    try {
      const reglages = await reglagesDe(membre.guild.id);
      if (!reglages.accueil.actif) {
        return;
      }

      if (reglages.accueil.roleArrivee) {
        await poserRoleArrivee(membre, reglages.accueil.roleArrivee);
      }

      const lieu = reglages.accueil.lieu;
      if (lieu === "aucune") {
        return;
      }

      const compte = membre.guild.memberCount;
      const texte = reglages.accueil.texte
        ? remplirGabarit(reglages.accueil.texte, {
            compte,
            membre: membre.toString(),
            serveur: membre.guild.name,
          })
        : `${membre.toString()} vient d'arriver sur **${membre.guild.name}**.`;

      const embed = creerEmbed({
        description: texte,
        icone: "membre",
        intention: "succes",
        titre: "Bienvenue",
      });
      pied(embed, { note: `${compte} membres` });

      const fichiers: AttachmentBuilder[] = [];
      if (reglages.accueil.carte) {
        try {
          const image = await renderCarteAccueil({
            avatarUrl: membre.displayAvatarURL({ extension: "png", size: 256 }),
            message: reglages.accueil.texte
              ? remplirGabarit(reglages.accueil.texte, {
                  compte,
                  membre: membre.displayName,
                  serveur: membre.guild.name,
                })
              : null,
            pseudo: membre.displayName,
            rang: compte,
            serveur: membre.guild.name,
          });
          fichiers.push(new AttachmentBuilder(image, { name: "bienvenue.png" }));
        } catch (err) {
          // Une carte qui échoue ne doit pas faire disparaître l'accueil.
          console.warn("[accueil] carte non rendue :", err instanceof Error ? err.message : err);
        }
      }

      if (lieu === "prive") {
        await membre.send({ embeds: [embed], files: fichiers }).catch(() => undefined);
        return;
      }

      if (!reglages.accueil.salon) {
        // `salon` sans salon configuré ne retombe pas sur un salon au hasard.
        return;
      }
      const salon = (await membre.client.channels
        .fetch(reglages.accueil.salon)
        .catch(() => null)) as TextBasedChannel | null;
      if (salon && "send" in salon) {
        await salon.send({
          // La borne qui compte : le texte d'accueil est réglable par le staff,
          // et un `@everyone` qui s'y glisse ne doit pas devenir un ping de deux
          // mille personnes.
          allowedMentions: { users: [membre.id] },
          embeds: [embed],
          files: fichiers,
        });
      }
    } catch (err) {
      console.error("[accueil] échec :", err instanceof Error ? (err.stack ?? err.message) : err);
    }
  }
}
