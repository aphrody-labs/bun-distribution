/**
 * Gain d'expérience sur les messages.
 *
 * ── ON COMPTE LES MESSAGES, ON NE LES LIT PAS ──────────────────────────────
 * Ce gestionnaire n'accède JAMAIS à `message.content`, et ce n'est pas de la
 * discipline : l'intent `MessageContent` est PRIVILÉGIÉ et n'est pas accordé à
 * ces applications. Sans lui, Discord livre l'événement `messageCreate` avec un
 * contenu vide — l'auteur, le salon et l'horodatage suffisent, et c'est tout ce
 * dont un système de niveaux a besoin.
 *
 * Conséquence directe, et voulue : aucune règle de gain ne peut dépendre de ce
 * qui est écrit (longueur minimale, mots interdits, détection de spam par
 * contenu). Le seul garde-fou est le DÉLAI, et il est suffisant — c'est celui
 * qu'utilisent tous les bots du domaine, Noctaly compris (60 s).
 *
 * ── POURQUOI CE FICHIER NE FAIT PRESQUE RIEN ───────────────────────────────
 * Il enchaîne trois décisions prises ailleurs : le délai (`consommerDelai`), le
 * gain (`gainDeMessage`, module pur), les rôles à poser
 * (`rolesPourNiveau`, testable). Ici il n'y a que du câblage et des
 * `catch` — parce que c'est du code qui tourne sur CHAQUE message d'un serveur
 * de deux mille membres, et qu'une exception non rattrapée y coûterait la
 * passerelle.
 *
 * ── LE CHEMIN RAPIDE EST LE CHEMIN NORMAL ──────────────────────────────────
 * L'écrasante majorité des messages ne rapporte rien (délai en cours). Ce cas
 * ne doit toucher NI Postgres NI Discord : il s'arrête au cache Redis, une
 * seule commande. Tout le reste — lecture des réglages, écriture de l'XP — est
 * derrière ce filtre.
 */
import { type ArgsOf, Discord, On } from "discordx";
import type { GuildMember, Message, TextBasedChannel } from "discord.js";

import { formaterJetons } from "../lib/kizuna";
import { gainDeMessage, meriteAnnonce, prochainRang, rangDe } from "../lib/experience";
import { filtrerRecompenses, type FaitsRoleVise } from "../lib/hierarchie";
import { ajouterExperience, consommerDelai, recompensesDe, reglagesDe, rolesPourNiveau } from "../services/communaute";
import { creerEmbed, entierLisible, pied } from "../lib/ui";

/**
 * Le message peut-il rapporter ?
 *
 * Les webhooks et les autres bots sont écartés d'office : compter leur activité
 * classerait un relais d'annonces devant les membres qu'il informe.
 */
function messageComptable(message: Message): boolean {
  if (!message.inGuild()) {
    return false;
  }
  if (message.author.bot || message.webhookId !== null) {
    return false;
  }
  // `system` couvre les messages d'arrivée, d'épinglage, de boost : ce ne sont
  // pas des messages du membre.
  return !message.system;
}

/** Le membre porte-t-il un rôle exclu du gain ? */
function porteUnRoleExclu(membre: GuildMember | null, exclus: readonly string[]): boolean {
  if (!membre || exclus.length === 0) {
    return false;
  }
  return exclus.some(roleId => membre.roles.cache.has(roleId));
}

/**
 * Pose et retire les rôles de palier.
 *
 * Chaque appel est isolé dans son propre `catch` : le bot peut très bien avoir
 * le droit de poser un rôle et pas un autre (hiérarchie Discord), et une seule
 * erreur ne doit pas empêcher les autres paliers d'être appliqués.
 */
async function appliquerRoles(membre: GuildMember, niveau: number, guildId: string): Promise<string[]> {
  const recompenses = await recompensesDe(guildId);
  if (recompenses.length === 0) {
    return [];
  }

  // ── SECOND VERROU DE HIÉRARCHIE ──────────────────────────────────────────
  // `/gestion niveaux recompense` refuse déjà d'enregistrer un rôle dangereux
  // ou hors de portée. On revérifie ICI, à chaque attribution, parce qu'une
  // ligne peut arriver autrement : import depuis un autre bot, écriture SQL
  // directe, ou simplement un rôle dont les permissions ont changé APRÈS son
  // enregistrement — c'est le cas le plus vicieux, et il ne déclenche aucune
  // alerte.
  const guilde = membre.guild;
  const faits = new Map<string, FaitsRoleVise>();
  for (const recompense of recompenses) {
    const role = guilde.roles.cache.get(recompense.roleId);
    if (role) {
      faits.set(role.id, {
        estEveryone: role.id === guilde.id,
        gereParIntegration: role.managed,
        id: role.id,
        nom: role.name,
        permissions: role.permissions.bitfield.toString(),
        position: role.position,
      });
    }
  }
  const bot = {
    peutGererRoles: guilde.members.me?.permissions.has("ManageRoles") ?? false,
    positionMax: guilde.members.me?.roles.highest.position ?? 0,
  };
  const { bloquees, posables } = filtrerRecompenses(recompenses, faits, bot);
  for (const bloquee of bloquees) {
    console.warn(`[xp] récompense niveau ${bloquee.recompense.niveau} NON appliquée : ${bloquee.motif}`);
  }
  if (posables.length === 0) {
    return [];
  }

  const { aPoser, aRetirer } = rolesPourNiveau(posables, niveau);
  const poses: string[] = [];

  for (const roleId of aPoser) {
    if (membre.roles.cache.has(roleId)) {
      continue;
    }
    try {
      await membre.roles.add(roleId, `Palier de niveau ${niveau}`);
      poses.push(roleId);
    } catch (err) {
      console.warn(
        `[xp] rôle ${roleId} impossible à poser sur ${membre.id} :`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  for (const roleId of aRetirer) {
    if (!membre.roles.cache.has(roleId)) {
      continue;
    }
    try {
      await membre.roles.remove(roleId, `Palier de niveau ${niveau} atteint`);
    } catch (err) {
      console.warn(
        `[xp] rôle ${roleId} impossible à retirer de ${membre.id} :`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return poses;
}

/**
 * Annonce d'une montée de niveau.
 *
 * `salon` sans salon configuré ne retombe PAS sur le salon courant : ce serait
 * transformer un réglage à moitié posé en pollution de tous les salons. On ne
 * dit rien, et le membre verra sa montée sur sa carte de profil.
 */
async function annoncer(
  message: Message<true>,
  niveauAvant: number,
  niveau: number,
  jetonsOfferts: number,
  rolesPoses: string[],
): Promise<void> {
  const reglages = await reglagesDe(message.guildId);
  const lieu = reglages.niveaux.annonce;
  if (lieu === "aucune") {
    return;
  }
  // Le filtre anti-bruit. Il vient AVANT toute construction d'embed : sur un
  // serveur actif, la très grande majorité des montées ne s'annonce pas, et ce
  // chemin doit rester le moins cher possible.
  if (
    !meriteAnnonce(niveauAvant, niveau, {
      annoncerRang: reglages.niveaux.annoncerRang,
      palier: reglages.niveaux.palierAnnonce,
    })
  ) {
    return;
  }

  const rang = rangDe(niveau);
  const suivant = prochainRang(niveau);
  const embed = creerEmbed({
    description: [
      `${message.author.toString()} passe **niveau ${niveau}** — rang ${rang.nom}.`,
      jetonsOfferts > 0 ? `${formaterJetons(jetonsOfferts)} en récompense.` : null,
      rolesPoses.length > 0 ? `Nouveau rôle : ${rolesPoses.map(id => `<@&${id}>`).join(", ")}.` : null,
      suivant ? `Prochain rang : ${suivant.nom} au niveau ${entierLisible(suivant.depuis)}.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    icone: "niveau",
    intention: "succes",
    titre: "Niveau supérieur",
  });
  pied(embed, { note: "/profil pour la carte complète" });

  try {
    if (lieu === "prive") {
      await message.author.send({ embeds: [embed] });
      return;
    }
    const cible: TextBasedChannel | null =
      lieu === "place"
        ? message.channel
        : reglages.niveaux.salonAnnonce
          ? ((await message.client.channels
              .fetch(reglages.niveaux.salonAnnonce)
              .catch(() => null)) as TextBasedChannel | null)
          : null;
    if (cible && "send" in cible) {
      await cible.send({ embeds: [embed] });
    }
  } catch (err) {
    // Un membre qui ferme ses messages privés, un salon supprimé : ce n'est pas
    // une raison de perdre l'XP qui vient d'être écrite.
    console.warn("[xp] annonce impossible :", err instanceof Error ? err.message : err);
  }
}

@Discord()
export class ExperienceEvents {
  @On({ event: "messageCreate" })
  async onMessage([message]: ArgsOf<"messageCreate">) {
    try {
      if (!messageComptable(message) || !message.inGuild()) {
        return;
      }
      const guildId = message.guildId;
      const reglages = await reglagesDe(guildId);
      if (!reglages.niveaux.actif) {
        return;
      }
      if (reglages.niveaux.salonsExclus.includes(message.channelId)) {
        return;
      }
      // Un fil hérite de l'exclusion de son salon parent : exclure
      // `🤖〡bots` sans exclure ses fils laisserait la porte grande ouverte.
      const parentId = message.channel.isThread() ? message.channel.parentId : null;
      if (parentId && reglages.niveaux.salonsExclus.includes(parentId)) {
        return;
      }
      if (porteUnRoleExclu(message.member, reglages.niveaux.rolesExclus)) {
        return;
      }

      // LE FILTRE. Tout ce qui suit ne s'exécute qu'une fois par minute et par
      // membre ; tout ce qui précède s'exécute sur chaque message du serveur.
      if (!(await consommerDelai(guildId, message.author.id, reglages.niveaux.gain.delaiSecondes))) {
        return;
      }

      const gain = gainDeMessage(reglages.niveaux.gain);
      const resultat = await ajouterExperience(guildId, message.author.id, gain);
      if (resultat.franchis.length === 0) {
        return;
      }

      const membre = message.member;
      const rolesPoses = membre ? await appliquerRoles(membre, resultat.niveauApres, guildId) : [];
      await annoncer(message, resultat.niveauAvant, resultat.niveauApres, resultat.jetonsOfferts, rolesPoses);
    } catch (err) {
      // Ce gestionnaire tourne sur chaque message : une exception qui remonte
      // jusqu'à la passerelle couperait le bot pour tout le monde.
      console.error("[xp] échec du gain :", err instanceof Error ? (err.stack ?? err.message) : err);
    }
  }
}
